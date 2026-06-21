import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";

/**
 * Property 9 — Rejecting blocks the send and releases the claim
 * (Requirements 4.4; Design §5 Approval Queue, §Property 9).
 *
 * *For any* `pending` Queued_Item, rejecting it
 *   (a) sets its single status field to `rejected`,
 *   (b) performs NO external send, and
 *   (c) releases the cross-rep claim on the candidate's identity so the prospect
 *       becomes claimable again by a DIFFERENT rep.
 *
 * The property drives the REAL production handler — `POST /api/prospecting/
 * queue/:id/reject` in `lib/cms/api/routes/prospecting.ts` — in-process via
 * Elysia's `app.handle(new Request(...))` (the SAME mechanism the Next mount
 * uses, mirroring the sibling `prospecting.queue.test.ts`). The handler runs
 * against a REAL Drizzle handle backed by an in-memory Postgres (pg-mem) with
 * the genuine `drizzle/0040_agentic_prospecting_batch.sql` applied, so the real
 * `UPDATE … status='rejected'` and the real `releaseClaim` DELETE execute. The
 * claim is taken with the REAL `claimTarget` and released by the REAL
 * `releaseClaim` (neither is mocked) — exercising the actual claim lifecycle.
 *
 * "No external send" (b) is pinned by mocking `dispatchTool` (the single audited
 * send choke point) and asserting it is NEVER invoked by the reject path — the
 * `send_outreach` dispatch the approve path would issue never happens.
 *
 * The pg-mem harness is reused from the sibling batch property tests
 * (`send-cap.exactly-once` / `eligibility.coldeligible`): the
 * statement-breakpoint splitter, `gen_random_uuid()` registration, and the
 * `INSERT … ON CONFLICT DO NOTHING … RETURNING` fidelity shim that
 * `claimTarget`'s cross-rep collision detection relies on.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 9: Rejecting blocks the send and releases the claim
 */

// `claimTarget` / `releaseClaim` salt-hash phone numbers via `computePhoneHash`,
// which requires PHONE_HASH_SALT. Set a deterministic test salt before imports.
process.env.PHONE_HASH_SALT = "queue-reject-property-test-salt";

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// The real 0040 migration, read once.
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "drizzle", MIGRATION_FILE),
  "utf-8"
);

// Minimal stubs for the PRE-existing tables 0040's FKs resolve against. The
// reject route reads `targets.email` + `targets.raw_phone` (to rebuild the
// ClaimIdentity for release) and joins `prospecting_batch_runs.owner_rep`.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text,
    "raw_phone" text
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "subject" text,
    "body" text,
    "status" text NOT NULL DEFAULT 'draft'
  );
`;

// ── Configurable holders (read by the module mocks below) ────────────────────
//
// The route imports `db` and `userId` (via identityGuard) at module scope; both
// are served from these holders so each property iteration can swap in a fresh
// pg-mem handle and the seeded rep id.
const h = vi.hoisted(() => ({
  db: null as unknown,
  userId: "" as string,
  // The audited send choke point — asserted to NEVER be invoked by reject.
  dispatchTool: vi.fn(),
}));

// `db` → the current pg-mem-backed Drizzle handle (a live getter so every access
// re-reads the holder, exactly as the sibling queue route test does).
vi.mock("../../db", () => ({
  get db() {
    return h.db;
  },
}));

// RBAC: pass through as an authenticated employee whose id is the seeded rep
// (the Batch_Run owner the reject route scopes to).
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: h.userId, userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// The audited send choke point — mocked so the reject path can be asserted to
// NEVER dispatch a send (`send_outreach`).
vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: h.dispatchTool }));

// Collaborators the reject route does not touch — mocked so the import of the
// route module stays lean (mirrors the sibling queue route test). `claim`,
// `optout`, and `rerun-key` are deliberately LEFT REAL.
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));
vi.mock("../own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("./send-cap", () => ({
  capExhausted: vi.fn(),
  recordSend: vi.fn(),
  incrementScope: vi.fn(),
}));
vi.mock("./activity", () => ({ readActivity: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "../../api/routes/prospecting";
// REAL claim lifecycle (NOT mocked) — the claim under test is taken and read
// back through the genuine module.
import { claimTarget, releaseClaim } from "./claim";

// ── pg-mem harness (reused from the sibling batch property tests) ────────────

/** Stand up a fresh pg-mem with the prerequisite stubs + 0040 applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  // Impure so each row gets a fresh uuid rather than a cached single value.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  // The reject route publishes via the (mocked) event bus, but the schema's
  // timestamp DEFAULTs use now(); pg-mem ships now(), so nothing else needed.

  mem.public.none(PREREQUISITE_SQL);

  for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
  //
  // It ALSO deviates from real Postgres on `INSERT … ON CONFLICT DO NOTHING …
  // RETURNING`: on a conflicting (no-op) insert, real Postgres returns ZERO
  // rows, but pg-mem returns the EXISTING row. That deviation would defeat
  // `claimTarget`'s cross-rep collision detection (it keys "freshly inserted"
  // off a non-empty RETURNING), so faithful semantics are restored here by
  // comparing the target table's row count before/after and stripping the
  // erroneously-returned row when nothing was actually inserted.
  const countRows = (table: string): number =>
    Number(
      (
        mem.public.many(`SELECT count(*) AS c FROM "${table}"`) as Array<{
          c: number | string;
        }>
      )[0].c
    );

  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const text = String(cfg.text ?? "");
      const lower = text.toLowerCase();
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;

      const conflictDoNothingReturning =
        lower.includes("on conflict") &&
        lower.includes("do nothing") &&
        lower.includes("returning");

      const shapeRows = (rows: Record<string, unknown>[]) =>
        wantArray ? rows.map((row) => Object.values(row)) : rows;

      if (conflictDoNothingReturning) {
        const table = text.match(/insert\s+into\s+"?([\w.]+)"?/i)?.[1] ?? null;
        const before = table ? countRows(table) : null;
        const result = originalQuery(clean, values, cb);
        return Promise.resolve(
          result as Promise<{ rows: Record<string, unknown>[] }>
        ).then((r) => {
          const after = table ? countRows(table) : null;
          const inserted =
            before === null || after === null ? true : after > before;
          const rows = inserted ? (r.rows ?? []) : [];
          return { ...r, rows: shapeRows(rows), rowCount: rows.length };
        });
      }

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
  }) as typeof pool.query;

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db, pool };
}

// ── Shared pg-mem harness ────────────────────────────────────────────────────
// Build the in-memory Postgres + Drizzle handle ONCE for the whole file, then
// revert to the empty-schema restore point before each fast-check iteration.
// pg-mem's O(1) backup/restore gives every iteration the same isolation a fresh
// DB would, without re-instantiating pg-mem (and leaking an adapter pool) ~100
// times per property — the instantiation volume that made the suite flaky.
// `h.db` is the route's `db` import, pinned once to the shared handle.
let mem!: IMemoryDb;
let db!: Database;
let dbPool!: { end: () => Promise<void> };
let backup!: { restore: () => void };

beforeAll(() => {
  ({ mem, db, pool: dbPool } = buildDb());
  backup = mem.backup();
  h.db = db;
});

afterAll(async () => {
  await dbPool?.end?.();
});

/** Seed a users row, returning its id. */
function seedUser(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${id}')`);
  return id;
}

/** Seed a `prospecting_batch_runs` row owned by `ownerRep`; return its id. */
function seedBatchRun(mem: IMemoryDb, ownerRep: string): string {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${id}', '${ownerRep}', '{}'::jsonb, 10, '${randomUUID()}')`
  );
  return id;
}

/** Seed a `targets` row carrying the candidate identity; return its id. */
function seedTarget(mem: IMemoryDb, email: string, phone: string | null): string {
  const id = randomUUID();
  const phoneVal = phone === null ? "NULL" : `'${phone}'`;
  mem.public.none(
    `INSERT INTO "targets" ("id", "email", "raw_phone") ` +
      `VALUES ('${id}', '${email}', ${phoneVal})`
  );
  return id;
}

/** Seed an unsent `outreach_drafts` row; return its id. */
function seedDraft(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO "outreach_drafts" ("id", "subject", "body", "status") ` +
      `VALUES ('${id}', 'Subject', 'Body', 'draft')`
  );
  return id;
}

/** Seed a PENDING `prospecting_queue_items` row; return its id. */
function seedQueueItem(
  mem: IMemoryDb,
  batchRunId: string,
  targetId: string,
  draftId: string | null
): string {
  const id = randomUUID();
  const draftVal = draftId === null ? "NULL" : `'${draftId}'`;
  mem.public.none(
    `INSERT INTO "prospecting_queue_items" ` +
      `("id", "batch_run_id", "target_id", "draft_id", "eligibility", "status") ` +
      `VALUES ('${id}', '${batchRunId}', '${targetId}', ${draftVal}, 'cold_eligible', 'pending')`
  );
  return id;
}

/** Count claim rows for an exact (kind, value) identity key. */
function claimCount(mem: IMemoryDb, matchKind: string, matchValue: string): number {
  return Number(
    (
      mem.public.many(
        `SELECT count(*) AS c FROM "prospecting_target_claims" ` +
          `WHERE "match_kind" = '${matchKind}' AND "match_value" = '${matchValue}'`
      ) as Array<{ c: number | string }>
    )[0].c
  );
}

/** Read a queue item's single status field. */
function statusOf(mem: IMemoryDb, queueItemId: string): string {
  return (
    mem.public.many(
      `SELECT "status" FROM "prospecting_queue_items" WHERE "id" = '${queueItemId}'`
    ) as Array<{ status: string }>
  )[0].status;
}

function createApp() {
  return new Elysia().use(prospectingRoutes);
}

/** Drive the real reject route in-process. */
async function reject(
  queueItemId: string
): Promise<{ status: number; body: { queueItemId?: string; status?: string; error?: string } }> {
  const res = await createApp().handle(
    new Request(`http://localhost/prospecting/queue/${queueItemId}/reject`, {
      method: "POST",
      headers: { Cookie: "ora_session=valid", "Content-Type": "application/json" },
    })
  );
  return { status: res.status, body: await res.json() };
}

// ── Generators ────────────────────────────────────────────────────────────────

// A unique, SQL-safe, already-normalized (lower-case) email per candidate. A
// fresh DB per run plus a unique email keeps each iteration's claim isolated.
const emailArb = fc.uuid().map((u) => `cand-${u}@example.com`);

// An optional E.164 phone so the candidate sometimes carries a SECOND identity
// key (exercising the salted phone-hash path in claim/release normalization).
const phoneArb = fc.option(
  fc.integer({ min: 500_000_000, max: 599_999_999 }).map((n) => `+971${n}`),
  { nil: null }
);

// Whether the queue item carries a grounded draft (cold-eligible items do; the
// reject path treats both the same and never sends either way).
const hasDraftArb = fc.boolean();

describe("Feature: agentic-prospecting-batch, Property 9: Rejecting blocks the send and releases the claim", () => {
  beforeEach(() => {
    h.dispatchTool.mockReset();
  });

  it("rejecting a pending item sets status=rejected, performs NO external send, and releases the claim so a DIFFERENT rep can claim again (Req 4.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        phoneArb,
        hasDraftArb,
        async (email, phone, hasDraft) => {
          backup.restore();

          const repId = seedUser(mem);
          const otherRep = seedUser(mem);
          h.userId = repId; // the reject route scopes to the Batch_Run owner

          const batchRunId = seedBatchRun(mem, repId);
          const targetId = seedTarget(mem, email, phone);
          const draftId = hasDraft ? seedDraft(mem) : null;
          const queueItemId = seedQueueItem(mem, batchRunId, targetId, draftId);

          // Take the cross-rep claim on the candidate's identity for THIS rep,
          // through the genuine claimTarget (Design §3 claim mechanism).
          const identity = { email, phone: phone ?? undefined };
          const claim = await claimTarget(db, identity, {
            ownerRep: repId,
            batchRunId,
            queueItemId,
          });
          expect(claim.kind).toBe("held");
          // Sanity: the identity is currently claimed (email key always present).
          expect(claimCount(mem, "email", email)).toBe(1);

          // ── Exercise the real reject route ───────────────────────────────
          const res = await reject(queueItemId);

          // (a) Status → rejected (single status field, Req 4.4 / 4.5).
          expect(res.status).toBe(200);
          expect(res.body.queueItemId).toBe(queueItemId);
          expect(res.body.status).toBe("rejected");
          expect(statusOf(mem, queueItemId)).toBe("rejected");

          // (b) NO external send: the audited send choke point was never hit, so
          //     `send_outreach` was never dispatched.
          expect(h.dispatchTool).not.toHaveBeenCalled();

          // (c) The claim is released → the identity is claimable again. Both
          //     identity keys are gone, and a DIFFERENT rep now claims it freely.
          expect(claimCount(mem, "email", email)).toBe(0);
          const reclaim = await claimTarget(db, identity, {
            ownerRep: otherRep,
            batchRunId,
            queueItemId,
          });
          expect(reclaim.kind).toBe("held");

          // Cleanup: release the re-claim so generators stay independent (a
          // fresh DB per run already isolates state, but be tidy).
          await releaseClaim(db, identity);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
