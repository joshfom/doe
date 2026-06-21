import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";

/**
 * Property 8 — Editing a draft retains the AI original (Requirement 4.2).
 *
 *   **Feature: agentic-prospecting-batch, Property 8: Editing a draft retains
 *   the AI original.**
 *
 * **Validates: Requirements 4.2**
 *
 * *For any* Queued_Item bound to an AI-drafted `outreach_drafts` row, applying
 * an arbitrary sequence of one-or-more edits through the real
 * `PUT /api/prospecting/queue/:id` route leaves the LIVE draft subject/body
 * equal to the LAST edit's content, while the `ai_original_subject` /
 * `ai_original_body` columns still hold the VERY FIRST (AI-drafted) content —
 * copied across on the first edit and never clobbered by any later edit
 * (Req 4.2 — "retain the original AI-drafted content for audit").
 *
 * The decisive seam is the bridge route in `lib/cms/api/routes/prospecting.ts`:
 * on the first edit (`ai_original_body === null`, since a fresh draft's body is
 * NOT NULL) it copies the draft's current subject/body into the additive
 * `ai_original_*` columns BEFORE overwriting them with the new content; on every
 * subsequent edit those columns are left untouched.
 *
 * This property drives the ACTUAL route in-process via Elysia's
 * `app.handle(new Request(...))` (mirroring the sibling
 * `prospecting.queue.test.ts` harness) against a real Drizzle handle over an
 * in-memory Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` schema (the additive
 * `ai_original_*` columns + the queue/batch tables). The DB module is mocked to
 * hand the route a fresh per-iteration pg-mem handle; RBAC is stubbed to an
 * authenticated rep that owns the seeded Batch_Run; the heavy collaborators the
 * edit route never touches are mocked away. Every edit is a full HTTP
 * round-trip, so the persisted state carries across the whole edit sequence and
 * the first-edit-preservation logic is exercised for real.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 8: Editing a draft retains the AI original
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// The authenticated rep the RBAC stub derives; it owns the seeded Batch_Run so
// the route's owner-scoped queue-item lookup resolves.
const REP_ID = "11111111-1111-1111-1111-111111111111";

// ── Configurable db holder (set per fast-check iteration, before the route
//    accesses `db`). The mock's getter returns whatever handle the current
//    iteration installed, so each property run drives a fresh pg-mem DB.
const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../db", () => ({
  get db() {
    return h.db;
  },
}));

// RBAC: pass through with an authenticated employee identity (leads:read) bound
// to REP_ID — the owner of the seeded Batch_Run.
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

// Collaborators the edit route does NOT touch — mocked so the import stays lean
// (mirrors the sibling prospecting.queue.test.ts harness).
vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: vi.fn() }));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));
vi.mock("../../prospecting/own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../prospecting/batch/send-cap", () => ({
  capExhausted: vi.fn(),
  recordSend: vi.fn(),
  incrementScope: vi.fn(),
}));
vi.mock("../../prospecting/batch/activity", () => ({ readActivity: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "../../api/routes/prospecting";

// Minimal stubs for the PRE-existing tables 0040 references (FKs). 0040 is
// purely additive over these; we only need the columns the edit path reads.
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
`;

/** Stand up a fresh pg-mem with the prerequisites + 0040 applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: unknown;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()`; register both.
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
    if (trimmed.length > 0) mem.public.none(trimmed);
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

  const db = drizzle(pool, { schema }) as unknown;
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
let db!: unknown;
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
 * Seed one cold-eligible Queued_Item bound to a fresh AI-drafted
 * `outreach_drafts` row owned (via its Batch_Run) by REP_ID. Returns the queue
 * item id and the seeded AI original content. `ai_original_*` start null (no
 * edit recorded yet).
 */
async function seedQueueItem(
  mem: IMemoryDb,
  db: unknown,
  aiSubject: string,
  aiBody: string
): Promise<{ queueItemId: string }> {
  const d = db as ReturnType<typeof drizzle>;

  // Owner rep (FK target) — fixed id matches the RBAC stub's userId.
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${REP_ID}')`);

  const [target] = await d
    .insert(schema.targets)
    .values({
      targetType: "person",
      displayName: "Seed Candidate",
      email: `${randomUUID()}@example.com`,
      sourceProvider: "demo",
      lawfulBasis: "legitimate_interest",
    })
    .returning({ id: schema.targets.id });

  const [draft] = await d
    .insert(schema.outreachDrafts)
    .values({
      targetId: target.id,
      channel: "email",
      language: "en",
      subject: aiSubject,
      body: aiBody,
      grounding: [],
      // ai_original_* intentionally left null → "no edit recorded yet".
    })
    .returning({ id: schema.outreachDrafts.id });

  const [run] = await d
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep: REP_ID,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 5,
      rerunKey: randomUUID(),
    })
    .returning({ id: schema.prospectingBatchRuns.id });

  const [item] = await d
    .insert(schema.prospectingQueueItems)
    .values({
      batchRunId: run.id,
      targetId: target.id,
      draftId: draft.id,
      eligibility: "cold_eligible",
      status: "pending",
    })
    .returning({ id: schema.prospectingQueueItems.id });

  return { queueItemId: item.id };
}

/** Drive the REAL PUT /queue/:id route in-process via Elysia. */
async function putQueue(
  id: string,
  payload: { subject: string; body: string }
): Promise<number> {
  const app = new Elysia().use(prospectingRoutes);
  const res = await app.handle(
    new Request(`http://localhost/prospecting/queue/${id}`, {
      method: "PUT",
      headers: {
        Cookie: "ora_session=valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  );
  return res.status;
}

// ── Generators ───────────────────────────────────────────────────────────────

// DB-safe text: subject/body are written verbatim into `outreach_drafts` text
// columns through the real route, and pg-mem's node-postgres adapter
// double-unescapes parameters — a generated backslash (or control char) makes
// its parser throw "Bad escaped character in JSON", returning a spurious 500.
// Constraining to an alphanumeric + common-punctuation charset (no backslash,
// no control chars) keeps the harness deterministic without weakening Req 4.2:
// the round-trip equality (live draft == last edit; ai_original_* retains the
// first content) holds identically for representative alphanumeric text. The
// charset is supplied as the string `unit` so `body`'s minLength:1 still yields
// a non-empty value (which the first-edit detector relies on).
const SAFE_TEXT_CHAR = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,'-".split(
    ""
  )
);

// The AI-drafted original. Subject may be empty; body is non-empty (the column
// is NOT NULL on a fresh draft, which is what the first-edit detector relies on).
const aiOriginalArb = fc.record({
  subject: fc.string({ unit: SAFE_TEXT_CHAR, maxLength: 80 }),
  body: fc.string({ unit: SAFE_TEXT_CHAR, minLength: 1, maxLength: 200 }),
});

// A sequence of 1..N rep edits, each carrying a full subject + body.
const editsArb = fc.array(
  fc.record({
    subject: fc.string({ unit: SAFE_TEXT_CHAR, maxLength: 80 }),
    body: fc.string({ unit: SAFE_TEXT_CHAR, minLength: 1, maxLength: 200 }),
  }),
  { minLength: 1, maxLength: 6 }
);

describe("**Feature: agentic-prospecting-batch, Property 8: Editing a draft retains the AI original.**", () => {
  it("Validates: Requirements 4.2 — after any sequence of edits the live draft equals the last edit and ai_original_* retains the first AI content", async () => {
    await fc.assert(
      fc.asyncProperty(aiOriginalArb, editsArb, async (aiOriginal, edits) => {
        backup.restore();

        const { queueItemId } = await seedQueueItem(
          mem,
          db,
          aiOriginal.subject,
          aiOriginal.body
        );

        // Apply every edit through the real route; each is a full round-trip so
        // persisted state carries across the whole sequence.
        for (const edit of edits) {
          const status = await putQueue(queueItemId, edit);
          expect(status).toBe(200);
        }

        // Read the live draft back from the DB.
        const d = db as ReturnType<typeof drizzle>;
        const item = await d
          .select({ draftId: schema.prospectingQueueItems.draftId })
          .from(schema.prospectingQueueItems)
          .where(eq(schema.prospectingQueueItems.id, queueItemId))
          .limit(1);
        const [draft] = await d
          .select({
            subject: schema.outreachDrafts.subject,
            body: schema.outreachDrafts.body,
            aiOriginalSubject: schema.outreachDrafts.aiOriginalSubject,
            aiOriginalBody: schema.outreachDrafts.aiOriginalBody,
          })
          .from(schema.outreachDrafts)
          .where(eq(schema.outreachDrafts.id, item[0].draftId as string))
          .limit(1);

        const last = edits[edits.length - 1];

        // (a) The LIVE draft equals the LAST edit's content.
        expect(draft.subject).toBe(last.subject);
        expect(draft.body).toBe(last.body);

        // (b) The AI original is retained verbatim — copied on the first edit
        // and never clobbered by any later edit (the core of Req 4.2).
        expect(draft.aiOriginalSubject).toBe(aiOriginal.subject);
        expect(draft.aiOriginalBody).toBe(aiOriginal.body);
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
