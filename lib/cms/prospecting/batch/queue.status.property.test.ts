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
import { eq } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";

/**
 * Property 7 — Queue item status invariant (Requirement 4.5).
 *
 *   **Feature: agentic-prospecting-batch, Property 7: Queue item status
 *   invariant.**
 *
 * **Validates: Requirements 4.5**
 *
 * *For any* sequence of Approval_Queue actions applied to a set of Queued_Items
 * — single approve, single reject, edit (PUT), and bulk-approve, in any order,
 * over any subset of items — every Queued_Item's persisted `status` field
 * SHALL, after EVERY action, hold EXACTLY ONE value drawn from the externally
 * visible review-inbox set `{ pending, approved, rejected, sent }`: never null,
 * never empty, never an out-of-set value, and never two values at once (the
 * `status` column is single-valued by construction — this property guards that
 * the transitions the routes apply keep it inside the allowed set).
 *
 * The decisive seam is the real Elysia Approval_Queue routes in
 * `lib/cms/api/routes/prospecting.ts`:
 *   - `POST /queue/:id/approve`   pending → sent (on a confirmed send), else
 *                                 unchanged (Req 4.3, 4.5);
 *   - `POST /queue/:id/reject`    → rejected, no send (Req 4.4, 4.5);
 *   - `PUT  /queue/:id`           edits the draft, leaves queue status untouched
 *                                 (Req 4.2);
 *   - `POST /queue/bulk-approve`  applies the per-item approve gate over a set
 *                                 (Req 5).
 * The routes are driven in-process via `app.handle(new Request(...))` against a
 * real Drizzle handle over an in-memory Postgres (pg-mem) carrying the actual
 * `drizzle/0040_agentic_prospecting_batch.sql` schema, so the status field the
 * property reads back is the one the real route persisted.
 *
 * Mocked seams (none of them the subject of this property):
 *   - `../../db` — points at the per-iteration pg-mem handle.
 *   - `../../rbac/middleware` — injects the seeded rep identity so items resolve.
 *   - `../../ai/tools/dispatch` — `approve_outreach` issues a single-use token;
 *     `send_outreach` reports sent / suppressed per the generated outcome.
 *   - send-cap / opt-out / claim / activity / events / gateway / subscribe —
 *     stubbed so the status transition (not the guardrail) is exercised.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 7: Queue item status invariant
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// A fixed rep identity, shared by the RBAC mock and the seeded Batch_Run owner
// so every queue item resolves under the requesting rep.
const REP_ID = "11111111-1111-1111-1111-111111111111";

// The externally-visible review-inbox status set (Req 4.5).
const ALLOWED_STATUSES = new Set(["pending", "approved", "rejected", "sent"]);

// A mutable holder the module mocks read at call time. `db` is swapped per
// iteration; `sendSucceeds` is set by the action before each request.
const h = vi.hoisted(() => ({
  db: null as unknown,
  sendSucceeds: true as boolean,
}));

// ── Module mocks (registered before the route module is imported) ────────────

vi.mock("../../db", () => ({
  get db() {
    return h.db;
  },
}));

// RBAC: pass through with the seeded employee identity (leads:read).
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: REP_ID, userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// dispatchTool: `approve_outreach` issues a single-use token; `send_outreach`
// reports the generated outcome (sent vs suppressed).
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(
    async (_db: unknown, toolName: string, input: Record<string, unknown>) => {
      if (toolName === "approve_outreach") {
        const draftId = input.draftId as string;
        return { ok: true, result: { token: `tok-${draftId}`, status: "approved" } };
      }
      if (toolName === "send_outreach") {
        return h.sendSucceeds
          ? { ok: true, result: { sent: true, status: "sent", messageId: "msg-1" } }
          : {
              ok: true,
              result: { sent: false, status: "suppressed", reason: "blocked" },
            };
      }
      throw new Error(`unexpected tool dispatched: ${toolName}`);
    }
  ),
}));

// Guardrail / side-effect collaborators the status invariant does not exercise.
vi.mock("../../prospecting/batch/send-cap", () => ({
  capExhausted: vi.fn(async () => false),
  recordSend: vi.fn(async () => {}),
  incrementScope: vi.fn(async () => {}),
}));
vi.mock("../../prospecting/optout", () => ({ isOptedOut: vi.fn(async () => false) }));
vi.mock("../../prospecting/batch/claim", () => ({ releaseClaim: vi.fn(async () => {}) }));
vi.mock("../../prospecting/batch/activity", () => ({ readActivity: vi.fn() }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../prospecting/own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "../../api/routes/prospecting";

// Minimal stubs for the PRE-existing tables 0040 references via FK (`users`,
// `targets`, `outreach_drafts`) plus the `events` table the publish mirror (if
// any) touches. 0040 is purely additive over these.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "brief_id" uuid,
    "target_type" text NOT NULL,
    "display_name" text,
    "company_name" text,
    "title" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "country" text,
    "attributes" jsonb,
    "source_provider" text NOT NULL,
    "source_ref" text,
    "lawful_basis" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "party_id" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
    "brief_id" uuid,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "approved_by" uuid,
    "job_key" text,
    "ai_original_subject" text,
    "ai_original_body" text,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

/** Stand up a fresh pg-mem with the prerequisites + 0040 applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => null,
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migration = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
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
  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
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

/**
 * Seed one Batch_Run owned by `REP_ID` plus `count` cold-eligible, pending
 * Queued_Items, each bound to a fresh Target + grounded Outreach_Draft. Returns
 * the queue item ids (in creation order).
 */
function seed(mem: IMemoryDb, count: number): string[] {
  const runId = randomUUID();
  mem.public.none(
    `INSERT INTO "users" ("id") VALUES ('${REP_ID}') ON CONFLICT DO NOTHING`
  );
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${runId}', '${REP_ID}', '{"kind":"icp"}'::jsonb, ${count}, '${runId}')`
  );

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const targetId = randomUUID();
    const draftId = randomUUID();
    const queueId = randomUUID();
    mem.public.none(
      `INSERT INTO "targets" ("id", "target_type", "display_name", "email", ` +
        `"source_provider", "lawful_basis") ` +
        `VALUES ('${targetId}', 'person', 'Candidate ${i}', ` +
        `'cand${i}-${targetId}@example.com', 'demo', 'legitimate_interest')`
    );
    mem.public.none(
      `INSERT INTO "outreach_drafts" ("id", "target_id", "channel", ` +
        `"language", "subject", "body", "grounding") ` +
        `VALUES ('${draftId}', '${targetId}', 'email', 'en', 'Subject ${i}', ` +
        `'Body ${i}', '[]'::jsonb)`
    );
    mem.public.none(
      `INSERT INTO "prospecting_queue_items" ("id", "batch_run_id", ` +
        `"target_id", "draft_id", "eligibility", "status") ` +
        `VALUES ('${queueId}', '${runId}', '${targetId}', '${draftId}', ` +
        `'cold_eligible', 'pending')`
    );
    ids.push(queueId);
  }
  return ids;
}

function createApp() {
  return new Elysia().use(prospectingRoutes);
}

const HDRS = { Cookie: "ora_session=valid", "Content-Type": "application/json" };

async function approve(id: string): Promise<void> {
  await createApp().handle(
    new Request(`http://localhost/prospecting/queue/${id}/approve`, {
      method: "POST",
      headers: HDRS,
    })
  );
}

async function reject(id: string): Promise<void> {
  await createApp().handle(
    new Request(`http://localhost/prospecting/queue/${id}/reject`, {
      method: "POST",
      headers: HDRS,
    })
  );
}

async function edit(id: string, subject: string, body: string): Promise<void> {
  await createApp().handle(
    new Request(`http://localhost/prospecting/queue/${id}`, {
      method: "PUT",
      headers: HDRS,
      body: JSON.stringify({ subject, body }),
    })
  );
}

async function bulkApprove(ids: string[]): Promise<void> {
  await createApp().handle(
    new Request(`http://localhost/prospecting/queue/bulk-approve`, {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({ ids }),
    })
  );
}

/** Read every queue item's persisted status from the live DB. */
async function readStatuses(db: Database): Promise<(string | null)[]> {
  const rows = await db
    .select({ status: schema.prospectingQueueItems.status })
    .from(schema.prospectingQueueItems);
  return rows.map((r) => r.status as string | null);
}

/** Assert the single-valued status invariant over all queue items (Req 4.5). */
async function assertInvariant(db: Database): Promise<void> {
  const statuses = await readStatuses(db);
  for (const s of statuses) {
    // Exactly one well-defined value from the allowed set — never null/empty,
    // never out-of-set, and (being a single scalar column) never two at once.
    expect(typeof s).toBe("string");
    expect(ALLOWED_STATUSES.has(s as string)).toBe(true);
  }
}

// ── Generators ───────────────────────────────────────────────────────────────

type Action =
  | { kind: "approve"; idx: number; sendSucceeds: boolean }
  | { kind: "reject"; idx: number }
  | { kind: "edit"; idx: number; subject: string; body: string }
  | { kind: "bulk"; idxs: number[]; sendSucceeds: boolean };

/** An action over an item set of `count` items (indices resolved at run time). */
function actionArb(count: number): fc.Arbitrary<Action> {
  const idx = fc.integer({ min: 0, max: count - 1 });
  return fc.oneof(
    fc.record({
      kind: fc.constant("approve" as const),
      idx,
      sendSucceeds: fc.boolean(),
    }),
    fc.record({ kind: fc.constant("reject" as const), idx }),
    fc.record({
      kind: fc.constant("edit" as const),
      idx,
      subject: fc.string({ maxLength: 24 }),
      body: fc.string({ maxLength: 48 }),
    }),
    fc.record({
      kind: fc.constant("bulk" as const),
      idxs: fc.uniqueArray(idx, { minLength: 1, maxLength: count }),
      sendSucceeds: fc.boolean(),
    })
  );
}

const scenarioArb = fc
  .integer({ min: 1, max: 5 })
  .chain((count) =>
    fc.record({
      count: fc.constant(count),
      actions: fc.array(actionArb(count), { minLength: 1, maxLength: 14 }),
    })
  );

describe("**Feature: agentic-prospecting-batch, Property 7: Queue item status invariant.**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Validates: Requirements 4.5 — after any sequence of approve/reject/edit/bulk actions every queue item status is exactly one of pending|approved|rejected|sent", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ count, actions }) => {
        backup.restore();
        const ids = seed(mem, count);

        // Invariant holds from the initial seeded state.
        await assertInvariant(db);

        for (const action of actions) {
          if (action.kind === "approve") {
            h.sendSucceeds = action.sendSucceeds;
            await approve(ids[action.idx]);
          } else if (action.kind === "reject") {
            await reject(ids[action.idx]);
          } else if (action.kind === "edit") {
            await edit(ids[action.idx], action.subject, action.body);
          } else {
            h.sendSucceeds = action.sendSucceeds;
            await bulkApprove(action.idxs.map((i) => ids[i]));
          }
          // After EVERY action the single-valued status invariant must hold.
          await assertInvariant(db);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
