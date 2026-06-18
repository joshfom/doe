import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import * as schema from "@/lib/cms/schema";
import { adminConfirmations } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import type { ToolContext } from "@/lib/cms/ai/tools/registry";
import type { CatalogEntry } from "@/lib/cms/ai/tools/catalog";
import {
  ADMIN_AGENT_ACTOR,
  ADMIN_REISSUE_PROMPT,
  ADMIN_DESTRUCTIVE_KINDS,
  type AdminDestructiveKind,
  type ConfirmedAdminActionExecutor,
  adminConfirmationCapabilities,
  getAdminConfirmationStore,
  setAdminConfirmationStore,
  createDurableAdminConfirmationStore,
  setConfirmedAdminActionExecutor,
  _resetAdminConfirmationStoreForTests,
  _resetConfirmedAdminActionExecutorForTests,
} from "@/lib/cms/ai/tools/admin-capabilities";

/**
 * Property test for the Admin_Confirmation_Flow (task 4.5).
 *
 * **Feature: agentic-foundation, Property 23: For any destructive admin
 * request, the proposal returns a token bound to the requesting user with a
 * future expiry and performs no mutation in that step; confirming with a valid
 * token executes exactly one audited action through the dispatcher and marks
 * the token consumed; and a token that is expired, already consumed, or
 * presented by a different user is refused with a re-issue prompt and performs
 * no action.**
 *
 * **Validates: Requirements 9.3, 9.4, 9.5**
 *
 * This is the non-negotiable CC-Audit / CC-Idem boundary test for the
 * human-in-the-loop confirmation flow. It exercises the real durable store —
 * {@link createDurableAdminConfirmationStore} backed by the genuine
 * `admin_confirmations` table under pg-mem — so the atomic single-use consume
 * (conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now AND
 * user_id = $u RETURNING`) is what's under test, not a stub. The bound-action
 * executor is replaced with a counting fake via
 * {@link setConfirmedAdminActionExecutor} so we can assert the bound action runs
 * EXACTLY ONCE per consumed token and NEVER for a refused token.
 *
 * The property has three parts, all checked per generated case:
 *   (1) `propose_admin_action` returns a token bound to the requesting user with
 *       a FUTURE expiry and performs NO mutation in that step — the bound-action
 *       executor is not called and the persisted token is unconsumed (Req 9.3).
 *   (2) `confirm_admin_action` with a valid token executes the bound action
 *       EXACTLY ONCE through the executor (the dispatcher seam) and marks the
 *       token consumed — a second confirm of the same token is refused and runs
 *       nothing further (single-use, Req 9.4).
 *   (3) A token that is expired / already-consumed / presented by a DIFFERENT
 *       user is refused with the re-issue prompt and performs no action — the
 *       executor is never called for it (Req 9.5).
 *
 * Harness mirrors `migration-switch.property.test.ts`: migration 0032 is applied
 * under an in-memory Postgres (pg-mem) so the real `admin_confirmations` table
 * exists with its true column shapes/defaults and FK to `users`; a Drizzle
 * handle is wired over the same pg-mem instance via the node-postgres adapter so
 * the durable store runs genuine SQL. `gen_random_uuid()` is registered because
 * pg-mem does not ship it, and the adapter's `rowMode`/`types` quirks are patched.
 */

// ≥100 iterations as required for property tests; each run exercises real SQL
// against a fresh table state across all three parts of the property.
const NUM_RUNS = 100;

const MIGRATION_FILE = "0032_concerned_typhoid_mary.sql";

// A small pool of pre-seeded users — `admin_confirmations.user_id` has an FK to
// `users.id`, so every token must be bound to a user that already exists.
const USER_POOL: readonly string[] = Array.from({ length: 4 }, () => randomUUID());

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0032 applied and return a Drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so migration 0032's
  // admin_confirmations DEFAULT resolves. Marked impure so each row is unique.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  // The FK target: a minimal `users` table carrying only the `id` the
  // admin_confirmations FK constraint in migration 0032 depends on.
  mem.public.none(
    `CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());`
  );

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  // Seed the user pool the generated tokens bind to.
  for (const id of USER_POOL) {
    mem.public.none(`INSERT INTO "users" ("id") VALUES ('${id}');`);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` (custom result
  // parsers) and `rowMode: "array"` that this Drizzle version sends. Strip both
  // and, when array-mode was requested, convert pg-mem's object rows back into
  // positional arrays (in select order) so Drizzle's mapper stays happy.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (
        wantArray &&
        result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) })
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Feature: agentic-foundation, Property 23: For any destructive admin request, the proposal returns a token bound to the requesting user with a future expiry and performs no mutation in that step; confirming with a valid token executes exactly one audited action through the dispatcher and marks the token consumed; and a token that is expired, already consumed, or presented by a different user is refused with a re-issue prompt and performs no action.", () => {
  let db: Database;
  let mem: IMemoryDb;

  // The counting fake executor stands in for the audited dispatcher path so we
  // can prove the bound action runs EXACTLY ONCE per consumed token. Each call
  // records the (kind, args) it was invoked with.
  const executions: { kind: AdminDestructiveKind; args: Record<string, unknown> }[] = [];
  const countingExecutor: ConfirmedAdminActionExecutor = async (_db, _userId, kind, args) => {
    executions.push({ kind, args });
    return { response: `executed ${kind}`, executed: { kind, affected: 1 } };
  };

  // Look up the propose/confirm Catalog_Entries by name.
  const entries = new Map<string, CatalogEntry>(
    adminConfirmationCapabilities.map((e) => [e.name, e])
  );
  const proposeEntry = entries.get("propose_admin_action")!;
  const confirmEntry = entries.get("confirm_admin_action")!;

  function ctxFor(userId: string): ToolContext {
    return { actor: ADMIN_AGENT_ACTOR, userId };
  }

  async function propose(
    userId: string,
    kind: AdminDestructiveKind,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const input = proposeEntry.inputSchema.parse({ kind, args });
    return (await proposeEntry.handler(db, ctxFor(userId), input)) as Record<string, unknown>;
  }

  async function confirm(
    userId: string,
    token: string
  ): Promise<Record<string, unknown>> {
    const input = confirmEntry.inputSchema.parse({ token });
    return (await confirmEntry.handler(db, ctxFor(userId), input)) as Record<string, unknown>;
  }

  beforeAll(() => {
    ({ db, mem } = buildDb());
    // Exercise the REAL durable, admin_confirmations-backed store (task 4.4).
    setAdminConfirmationStore(createDurableAdminConfirmationStore());
    setConfirmedAdminActionExecutor(countingExecutor);
  });

  afterAll(() => {
    _resetAdminConfirmationStoreForTests();
    _resetConfirmedAdminActionExecutorForTests();
  });

  beforeEach(() => {
    executions.length = 0;
  });

  it("proposes a future-dated, user-bound token without mutating; a valid confirm executes exactly once and consumes; expired/consumed/wrong-user are refused with the re-issue prompt and never act", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Two DISTINCT users from the seeded pool: the requester and an impostor.
        fc
          .uniqueArray(fc.constantFrom(...USER_POOL), {
            minLength: 2,
            maxLength: 2,
          })
          .map(([owner, impostor]) => ({ owner, impostor })),
        fc.constantFrom<AdminDestructiveKind>(...ADMIN_DESTRUCTIVE_KINDS),
        // Bound-action arguments, replayed verbatim on confirm. Spread into a
        // plain object — fc.dictionary yields null-prototype objects, which the
        // Drizzle insert builder rejects (and which jsonb never produces).
        fc
          .dictionary(
            fc.string({ minLength: 1, maxLength: 8 }),
            fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            { maxKeys: 4 }
          )
          .map((d) => ({ ...d })),
        async ({ owner, impostor }, kind, args) => {
          // Fresh token state per iteration.
          await db.delete(adminConfirmations);
          executions.length = 0;

          // ── Part 1: propose returns a user-bound, future-dated token and
          //    mutates NOTHING in that step (Req 9.3). ──────────────────────
          const before = Date.now();
          const proposal = await propose(owner, kind, args);

          expect(UUID_RE.test(String(proposal.token))).toBe(true);
          expect(proposal.kind).toBe(kind);
          expect(proposal.requiresConfirmation).toBe(true);
          // Future expiry.
          const expiresAtMs = new Date(String(proposal.expiresAt)).getTime();
          expect(expiresAtMs).toBeGreaterThan(before);
          // No action performed in the propose step.
          expect(executions).toHaveLength(0);

          // The persisted token is bound to the requesting user and unconsumed.
          const token = String(proposal.token);
          const [row] = await db
            .select()
            .from(adminConfirmations)
            .where(eq(adminConfirmations.token, token));
          expect(row).toBeDefined();
          expect(row.userId).toBe(owner);
          expect(row.consumedAt).toBeNull();
          expect(row.expiresAt.getTime()).toBeGreaterThan(before);

          // ── Part 2: a valid confirm executes the bound action EXACTLY ONCE
          //    through the executor and consumes the token; a second confirm is
          //    refused and runs nothing further (single-use, Req 9.4). ───────
          const confirmed = await confirm(owner, token);
          expect(confirmed.executed).toBe(true);
          expect(confirmed.kind).toBe(kind);
          expect(executions).toHaveLength(1);
          // The bound action was replayed with the proposed kind/args verbatim.
          expect(executions[0].kind).toBe(kind);
          expect(executions[0].args).toEqual(args);

          // Token is now marked consumed in the durable store.
          const [afterRow] = await db
            .select()
            .from(adminConfirmations)
            .where(eq(adminConfirmations.token, token));
          expect(afterRow.consumedAt).not.toBeNull();

          // Replay the same token → refused as already_consumed, no further act.
          const replay = await confirm(owner, token);
          expect(replay.executed).toBe(false);
          expect(replay.reason).toBe("already_consumed");
          expect(replay.message).toBe(ADMIN_REISSUE_PROMPT);
          expect(executions).toHaveLength(1);

          // ── Part 3a: a token presented by a DIFFERENT user is refused with
          //    the re-issue prompt and performs no action (Req 9.5). ─────────
          const wrongUserProposal = await propose(owner, kind, args);
          const wrongUserToken = String(wrongUserProposal.token);
          executions.length = 0;
          const wrongUser = await confirm(impostor, wrongUserToken);
          expect(wrongUser.executed).toBe(false);
          expect(wrongUser.reason).toBe("wrong_user");
          expect(wrongUser.message).toBe(ADMIN_REISSUE_PROMPT);
          expect(executions).toHaveLength(0);
          // The rightful owner's token was NOT consumed by the refused attempt:
          // it can still be confirmed exactly once.
          const rightful = await confirm(owner, wrongUserToken);
          expect(rightful.executed).toBe(true);
          expect(executions).toHaveLength(1);

          // ── Part 3b: an EXPIRED token is refused with the re-issue prompt and
          //    performs no action (Req 9.5). ─────────────────────────────────
          executions.length = 0;
          // Issue a token whose expiry is already in the past (negative TTL),
          // straight through the durable store.
          const expired = await getAdminConfirmationStore().issue(
            db,
            owner,
            kind,
            args,
            -1_000
          );
          const expiredResult = await confirm(owner, expired.token);
          expect(expiredResult.executed).toBe(false);
          expect(expiredResult.reason).toBe("expired");
          expect(expiredResult.message).toBe(ADMIN_REISSUE_PROMPT);
          expect(executions).toHaveLength(0);

          // ── Part 3c: an unknown token is refused (not_found) with no action.
          const unknown = await confirm(owner, randomUUID());
          expect(unknown.executed).toBe(false);
          expect(unknown.reason).toBe("not_found");
          expect(unknown.message).toBe(ADMIN_REISSUE_PROMPT);
          expect(executions).toHaveLength(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
