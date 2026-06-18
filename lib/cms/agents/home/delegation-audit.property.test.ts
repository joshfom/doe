// Feature: agentic-home, Property 2: Every state-mutating Delegated_Action produces exactly one audit-log entry, attributed to the requesting user with the Catalog_Entry name as the action, for both success and failure.
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import fc from "fast-check";

/**
 * Property test for Property 2 (P-Audited) of the Agent-First Home surface
 * (Design §Components #8 "Audited delegation", §Property → test-placement
 * table). S5 consumes the S1 `dispatchTool` UNCHANGED as the audited boundary
 * for every Delegated_Action, so this property guards that boundary's audit
 * invariant for home delegations:
 *
 *   For every state-mutating Delegated_Action dispatched through `dispatchTool`
 *   into a home `Catalog_Entry`:
 *     • EXACTLY ONE audit-log row is written for the dispatch — for BOTH a
 *       successful and a failed dispatch (Req 8.1);
 *     • that row records the actor as the REQUESTING USER's identity (never
 *       `agent:home-twin`) and the action as the Catalog_Entry name (Req 8.2);
 *     • the same user + same tool always records the same actor + action
 *       attribution, regardless of which surface issued it (Req 8.3);
 *     • when the tool arguments fail the entry's Zod validation, the dispatch
 *       is REJECTED, the handler runs NOT AT ALL, persistent state is left
 *       UNCHANGED, exactly ONE audit row records the validation failure, and a
 *       validation-error result is returned (Req 8.4).
 *
 * MODELLING THE BOUNDARY (per task 4.4's guidance — "the property is about the
 * dispatcher's audit invariant; keep it focused"). Rather than wire the full
 * tickets persistence the real `add_stack_item` / `complete_stack_item`
 * handlers walk (`createTicket` / `transitionTicketStatus`, each of which
 * writes its OWN domain audit rows — `ticket_create`, `ticket_status_change` —
 * that would confound an "exactly one row" count), this test dispatches two
 * REPRESENTATIVE mutating home Catalog_Entries (`add_stack_item`,
 * `complete_stack_item`) whose stub handlers perform a single audited mutation
 * (an INSERT into a representative `stack_items` table) and write no audit row
 * themselves. The ONLY audit row a dispatch can produce is therefore the one
 * `dispatchTool` writes — making "exactly one audit row per mutating dispatch"
 * a precise, unconfounded assertion. The entries carry the real home identity
 * (`agent:home-twin`) as their catalog `auditActor` and the real
 * `home:tool:<name>` permission, exercising the genuine dispatcher pipeline.
 *
 * REQUESTING-USER ATTRIBUTION (Req 8.2). The dispatcher records `ctx.actor` as
 * the audited user. A home Delegated_Action is dispatched on behalf of the
 * signed-in user, so the dispatch carries the requesting USER's identity as
 * `ctx.actor` — and the property asserts the audit row is attributed to that
 * user and NOT to `agent:home-twin` (the catalog `auditActor` field is never
 * what the dispatcher records as the audited user).
 *
 * HARNESS. Mirrors `lib/cms/ai/tools/dispatch.audit.property.test.ts` and
 * `lib/cms/ai/tools/lead-capabilities.property.test.ts`: a node-postgres
 * adapter over `pg-mem`, with `getTool` widened to resolve the representative
 * home entries so the REAL `dispatchTool` (Zod → RBAC → OTP → audit → execute)
 * + the real RBAC permission resolution + the real `logAudit` insert all run
 * against in-memory Postgres. `audit_log` and the four RBAC tables are created
 * inline; `audit_log.user_id` is `text` so the string actor persists and the
 * property can assert it.
 */

const NUM_RUNS = 100;

// Shared constants, hoisted so the (hoisted) `vi.mock` factory AND the test
// body can both reference them.
//   • HOME_AGENT_ACTOR mirrors `HOME_AGENT_ACTOR` in
//     `lib/cms/ai/tools/home-capabilities.ts` — the catalog `auditActor` field.
//     The property proves the dispatcher records the requesting USER as the
//     audited actor, never this value.
//   • ADD_TOOL / COMPLETE_TOOL are the two representative mutating home
//     Catalog_Entry names.
const { HOME_AGENT_ACTOR, ADD_TOOL, COMPLETE_TOOL, homeToolPermission } =
  vi.hoisted(() => ({
    HOME_AGENT_ACTOR: "agent:home-twin",
    ADD_TOOL: "add_stack_item",
    COMPLETE_TOOL: "complete_stack_item",
    homeToolPermission: (name: string) => `home:tool:${name}`,
  }));

// ── Widen the dispatcher's tool resolution to representative home entries ──────
//
// `dispatch.ts` resolves tools via `getTool()` from the (voice) registry; the
// merged Tool_Catalog the design assembles also contains the home capabilities.
// We keep every real registry export and only widen `getTool` to resolve the
// representative home `CatalogEntry` objects, so the REAL dispatcher pipeline +
// the entries' handlers run. Each handler performs ONE audited mutation (an
// INSERT into `stack_items`) and writes NO audit row of its own — so the only
// audit row per dispatch is the one the dispatcher writes.
vi.mock("../../ai/tools/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ai/tools/registry")>();
  const { z } = await import("zod");

  const addStackItem = {
    name: ADD_TOOL,
    description: "Representative mutating Stack_Item create (test double).",
    inputSchema: z.object({
      title: z.string().min(1),
      fail: z.boolean().default(false),
    }),
    outputSchema: z.object({ id: z.string(), title: z.string() }),
    requiresOtp: false,
    permission: homeToolPermission(ADD_TOOL),
    auditActor: HOME_AGENT_ACTOR,
    handler: async (
      db: import("../../db").Database,
      ctx: { actor: string; userId?: string },
      input: { title: string; fail: boolean }
    ) => {
      // A failed dispatch: the handler throws AFTER validation, so the
      // dispatcher still writes exactly one (failure) audit row (Req 8.1).
      if (input.fail) throw new Error("simulated add_stack_item failure");
      const id = randomUUID();
      await db.execute(
        sql`INSERT INTO stack_items (id, user_id, title, status) VALUES (${id}, ${
          ctx.userId ?? ctx.actor
        }, ${input.title}, 'open')`
      );
      return { id, title: input.title };
    },
  };

  const completeStackItem = {
    name: COMPLETE_TOOL,
    description: "Representative mutating Stack_Item completion (test double).",
    inputSchema: z.object({
      id: z.string().min(1),
      fail: z.boolean().default(false),
    }),
    outputSchema: z.object({ id: z.string(), status: z.literal("done") }),
    requiresOtp: false,
    permission: homeToolPermission(COMPLETE_TOOL),
    auditActor: HOME_AGENT_ACTOR,
    handler: async (
      db: import("../../db").Database,
      ctx: { actor: string; userId?: string },
      input: { id: string; fail: boolean }
    ) => {
      if (input.fail) throw new Error("simulated complete_stack_item failure");
      const rowId = randomUUID();
      await db.execute(
        sql`INSERT INTO stack_items (id, user_id, title, status) VALUES (${rowId}, ${
          ctx.userId ?? ctx.actor
        }, ${input.id}, 'done')`
      );
      return { id: input.id, status: "done" as const };
    },
  };

  const homeRep = new Map<string, unknown>([
    [ADD_TOOL, addStackItem],
    [COMPLETE_TOOL, completeStackItem],
  ]);

  return {
    ...actual,
    getTool: (name: string) => homeRep.get(name) ?? actual.getTool(name),
  };
});

import * as schema from "../../schema";
import { auditLog } from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../../ai/identity";
import { dispatchTool, type DispatchErrorCode } from "../../ai/tools/dispatch";
import type { ToolContext } from "../../ai/tools/registry";

// ── pg-mem harness ────────────────────────────────────────────────────────────

const VISITOR: IdentityResult = { type: "visitor", units: [] };

// `audit_log` (with a `text` user_id so the string actor persists, no FK) and
// the four RBAC tables the dispatcher's permission check resolves against, plus
// the representative `stack_items` mutation target. None of these live in a
// single migration, so they are created inline — the dispatcher's audit insert
// and its RBAC permission resolution both run for real against pg-mem.
const PREREQUISITE_SQL = `
  CREATE TABLE "audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "action" text NOT NULL,
    "entity_type" text NOT NULL,
    "entity_id" text NOT NULL,
    "summary" text NOT NULL,
    "changes" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "user_type" text NOT NULL,
    "is_system" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "resource" text NOT NULL,
    "action" text NOT NULL,
    "description" text
  );
  CREATE TABLE "role_permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "role_id" uuid NOT NULL,
    "permission_id" uuid NOT NULL
  );
  CREATE TABLE "user_roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "role_id" uuid NOT NULL,
    "granted_by" uuid,
    "granted_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "stack_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "title" text NOT NULL,
    "status" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling dispatch tests.
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

/**
 * Seed a requesting user holding the two `home:tool:*` permissions through a
 * role, so the dispatcher's RBAC check ADMITS the home mutations under that
 * user's identity. Returns the user id (a uuid, recorded as the audit actor).
 */
async function seedHomeUser(db: Database): Promise<string> {
  const userId = randomUUID();
  const roleId = randomUUID();

  await db.execute(
    sql`INSERT INTO roles (id, name, display_name, user_type) VALUES (${roleId}, 'home-user', 'Home User', 'employee')`
  );
  for (const tool of [ADD_TOOL, COMPLETE_TOOL]) {
    const permId = randomUUID();
    await db.execute(
      sql`INSERT INTO permissions (id, resource, action) VALUES (${permId}, ${"home:tool"}, ${tool})`
    );
    await db.execute(
      sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleId}, ${permId})`
    );
  }
  await db.execute(
    sql`INSERT INTO user_roles (user_id, role_id) VALUES (${userId}, ${roleId})`
  );

  return userId;
}

async function stackItemCount(db: Database): Promise<number> {
  const res = (await db.execute(
    sql`SELECT count(*)::int AS n FROM stack_items`
  )) as unknown as { rows: { n: number }[] };
  return Number(res.rows[0]?.n ?? 0);
}

// ── Generators ────────────────────────────────────────────────────────────────

type Mode = "success" | "handler_fail" | "zod_invalid";

interface Step {
  tool: typeof ADD_TOOL | typeof COMPLETE_TOOL;
  mode: Mode;
  input: unknown;
  /** undefined ⇒ ok; otherwise the structured error code the dispatch returns. */
  expectedCode?: DispatchErrorCode;
}

const titleArb = fc.string({ minLength: 1, maxLength: 40 });
const idArb = fc.string({ minLength: 1, maxLength: 40 });

/** Inputs that must FAIL the entry's Zod schema (handler must never run). */
const addInvalidArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant({}), // missing title
  fc.constant({ title: "" }), // min(1) violated
  fc.integer().map((n) => ({ title: n })), // wrong type
  fc.constantFrom(42, "not-an-object", null, true)
);
const completeInvalidArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant({}), // missing id
  fc.constant({ id: "" }), // min(1) violated
  fc.integer().map((n) => ({ id: n })), // wrong type
  fc.constantFrom(42, "not-an-object", null, true)
);

const addStepArb: fc.Arbitrary<Step> = fc.oneof(
  titleArb.map((title) => ({
    tool: ADD_TOOL,
    mode: "success" as const,
    input: { title, fail: false },
    expectedCode: undefined,
  })),
  titleArb.map((title) => ({
    tool: ADD_TOOL,
    mode: "handler_fail" as const,
    input: { title, fail: true },
    expectedCode: "handler_error" as const,
  })),
  addInvalidArb.map((input) => ({
    tool: ADD_TOOL,
    mode: "zod_invalid" as const,
    input,
    expectedCode: "validation_error" as const,
  }))
);

const completeStepArb: fc.Arbitrary<Step> = fc.oneof(
  idArb.map((id) => ({
    tool: COMPLETE_TOOL,
    mode: "success" as const,
    input: { id, fail: false },
    expectedCode: undefined,
  })),
  idArb.map((id) => ({
    tool: COMPLETE_TOOL,
    mode: "handler_fail" as const,
    input: { id, fail: true },
    expectedCode: "handler_error" as const,
  })),
  completeInvalidArb.map((input) => ({
    tool: COMPLETE_TOOL,
    mode: "zod_invalid" as const,
    input,
    expectedCode: "validation_error" as const,
  }))
);

const stepArb: fc.Arbitrary<Step> = fc.oneof(addStepArb, completeStepArb);

// ── Property 2 ──────────────────────────────────────────────────────────────

describe("home delegation audit — Property 2: delegated mutations are audited exactly once (Req 8.1, 8.2, 8.3, 8.4)", () => {
  it(
    "Feature: agentic-home, Property 2: every state-mutating Delegated_Action produces exactly one audit row (actor = requesting user, action = tool name) for success AND failure; Zod-invalid args reject with no handler run, state unchanged, and one audit row",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(stepArb, { minLength: 1, maxLength: 8 }),
          async (steps) => {
            const { db } = buildDb();
            const userId = await seedHomeUser(db);

            // The (actor, action) pair each dispatch SHOULD be audited under:
            // the REQUESTING USER's identity (never agent:home-twin) + the tool.
            const expected: Array<{ userId: string; action: string }> = [];
            let successes = 0;

            for (const step of steps) {
              const ctx: ToolContext = {
                actor: userId, // the requesting user's identity (Req 8.2)
                conversationId: randomUUID(),
                identity: VISITOR,
                language: "en",
                otpVerificationState: "not_required",
                userId,
              };

              const before = await stackItemCount(db);
              const result = await dispatchTool(db, step.tool, step.input, ctx);
              const after = await stackItemCount(db);

              if (step.expectedCode === undefined) {
                // Success → the mutation persisted (state changed by exactly 1).
                expect(result.ok).toBe(true);
                expect(after).toBe(before + 1);
                successes += 1;
              } else {
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.error.code).toBe(step.expectedCode);
                // Failure AND validation rejection leave persistent state
                // unchanged — the handler never committed a mutation (Req 8.4).
                expect(after).toBe(before);
              }

              expected.push({ userId, action: step.tool });
            }

            const rows = await db
              .select({ userId: auditLog.userId, action: auditLog.action })
              .from(auditLog);

            // (Req 8.1) EXACTLY ONE audit row per dispatch — success or failure.
            expect(rows.length).toBe(steps.length);

            // (Req 8.2) Every audit row is attributed to the requesting USER and
            // NEVER to agent:home-twin.
            for (const r of rows) {
              expect(r.userId).toBe(userId);
              expect(r.userId).not.toBe(HOME_AGENT_ACTOR);
            }

            // (Req 8.2, 8.3) The recorded (actor, action) multiset equals what
            // was issued — actor = user, action = the Catalog_Entry name — order
            // independent. Same user + same tool ⇒ identical attribution however
            // many surfaces issue it.
            const key = (r: { userId: string; action: string }) =>
              `${r.userId}\u0000${r.action}`;
            expect(rows.map(key).sort()).toEqual(expected.map(key).sort());

            // State changed only for the successful mutating dispatches.
            expect(await stackItemCount(db)).toBe(successes);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    }
  );
});

// ── Explicit examples — one per outcome (Req 8.1, 8.2, 8.4) ────────────────────

describe("home delegation audit — explicit examples (Req 8.1, 8.2, 8.3, 8.4)", () => {
  async function auditRows(db: Database) {
    return db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
  }

  function userCtx(userId: string): ToolContext {
    return {
      actor: userId,
      conversationId: randomUUID(),
      identity: VISITOR,
      language: "en",
      otpVerificationState: "not_required",
      userId,
    };
  }

  it("success: one audit row, actor = requesting user, action = tool name", async () => {
    const { db } = buildDb();
    const userId = await seedHomeUser(db);

    const result = await dispatchTool(
      db,
      ADD_TOOL,
      { title: "Call the architect" },
      userCtx(userId)
    );
    expect(result.ok).toBe(true);

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].userId).not.toBe(HOME_AGENT_ACTOR);
    expect(rows[0].action).toBe(ADD_TOOL);
    expect(await stackItemCount(db)).toBe(1);
  });

  it("handler failure: one audit row recording the failed dispatch, state unchanged", async () => {
    const { db } = buildDb();
    const userId = await seedHomeUser(db);

    const result = await dispatchTool(
      db,
      COMPLETE_TOOL,
      { id: "stack-1", fail: true },
      userCtx(userId)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("handler_error");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].action).toBe(COMPLETE_TOOL);
    expect(await stackItemCount(db)).toBe(0);
  });

  it("Zod-invalid args: reject, no handler run, state unchanged, exactly one audit row", async () => {
    const { db } = buildDb();
    const userId = await seedHomeUser(db);

    const result = await dispatchTool(
      db,
      ADD_TOOL,
      { title: "" }, // min(1) violated → validation rejection
      userCtx(userId)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].action).toBe(ADD_TOOL);
    // Handler never ran → no mutation committed.
    expect(await stackItemCount(db)).toBe(0);
  });

  it("Req 8.3: a home-chat delegation and the equivalent classic-panel action record the same actor + action", async () => {
    const { db } = buildDb();
    const userId = await seedHomeUser(db);

    // Two dispatches of the same mutating tool under the same requesting user,
    // modelling the two surfaces — the dispatcher is surface-agnostic.
    await dispatchTool(db, ADD_TOOL, { title: "from home chat" }, userCtx(userId));
    await dispatchTool(db, ADD_TOOL, { title: "from classic panel" }, userCtx(userId));

    const rows = await auditRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].userId).toBe(rows[1].userId);
    expect(rows[0].action).toBe(rows[1].action);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].action).toBe(ADD_TOOL);
  });
});
