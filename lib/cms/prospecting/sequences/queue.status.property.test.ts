import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
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
 * Property 12 — Queue item status invariant (Requirement 8.7).
 *
 *   **Feature: prospecting-sequences, Property 12: Queue item status invariant.**
 *
 * **Validates: Requirements 8.7**
 *
 * *For any* sequence of Review_Inbox actions (approve / reject / edit / bulk-
 * approve) over the SEQUENCE-SCOPED Queued_Items of a Sequence — after every
 * action each item's persisted `status` is exactly one of
 * `pending | approved | rejected | sent` (Req 8.7). The Sequence reuses the
 * agentic-batch Review_Inbox unchanged: its items are the
 * `prospecting_queue_items` rows of a Batch_Run whose `sequence_id` is non-null
 * (a Refresh_Run). This property drives the SAME owner-scoped inbox routes
 * (`lib/cms/api/routes/prospecting.ts`) over sequence-scoped items and asserts
 * the single-valued status invariant holds throughout.
 *
 * The persistence runs for real against an in-memory Postgres (pg-mem) carrying
 * the real `drizzle/0040_agentic_prospecting_batch.sql` +
 * `drizzle/0043_prospecting_sequences.sql` schemas; only the external send /
 * approval collaborators are stubbed so the status transition (not the
 * guardrail) is exercised.
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

const REP_ID = "11111111-1111-1111-1111-111111111111";

// The externally-visible review-inbox status set (Req 8.7).
const ALLOWED_STATUSES = new Set(["pending", "approved", "rejected", "sent"]);

const h = vi.hoisted(() => ({
  db: null as unknown,
  sendSucceeds: true as boolean,
}));

vi.mock("../../db", () => ({
  get db() {
    return h.db;
  },
}));

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

vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(
    async (_db: unknown, toolName: string, input: Record<string, unknown>) => {
      if (toolName === "approve_outreach") {
        const draftId = input.draftId as string;
        return {
          ok: true,
          result: { token: `tok-${draftId}`, status: "approved" },
        };
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

import { Elysia } from "elysia";
import { prospectingRoutes } from "../../api/routes/prospecting";

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
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer NOT NULL DEFAULT 10,
    "mode" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function applyMigration(mem: IMemoryDb, file: string): void {
  const migration = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) mem.public.none(trimmed);
  }
}

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
  mem.public.registerFunction({
    name: "now",
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  applyMigration(mem, BATCH_MIGRATION_FILE);
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );
  applyMigration(mem, SEQUENCE_MIGRATION_FILE);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

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
 * Seed one `live` Sequence and a sequence-scoped Refresh_Run (a
 * `prospecting_batch_runs` row whose `sequence_id` points at it) owned by
 * `REP_ID`, plus `count` cold-eligible, pending Queued_Items each bound to a
 * fresh Target + grounded Outreach_Draft. Returns the queue item ids in
 * creation order.
 */
function seed(mem: IMemoryDb, count: number): string[] {
  const sequenceId = randomUUID();
  const runId = randomUUID();
  mem.public.none(
    `INSERT INTO "users" ("id") VALUES ('${REP_ID}') ON CONFLICT DO NOTHING`
  );
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "target_count", "mode", "status") ` +
      `VALUES ('${sequenceId}', '${REP_ID}', 'seq', '{"kind":"icp"}'::jsonb, ${count}, 'live', 'live')`
  );
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "sequence_id", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${runId}', '${REP_ID}', '${sequenceId}', '{"kind":"icp"}'::jsonb, ${count}, '${runId}')`
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

async function readStatuses(db: Database): Promise<(string | null)[]> {
  const rows = await db
    .select({ status: schema.prospectingQueueItems.status })
    .from(schema.prospectingQueueItems);
  return rows.map((r) => r.status as string | null);
}

async function assertInvariant(db: Database): Promise<void> {
  const statuses = await readStatuses(db);
  for (const s of statuses) {
    expect(typeof s).toBe("string");
    expect(ALLOWED_STATUSES.has(s as string)).toBe(true);
  }
}

type Action =
  | { kind: "approve"; idx: number; sendSucceeds: boolean }
  | { kind: "reject"; idx: number }
  | { kind: "edit"; idx: number; subject: string; body: string }
  | { kind: "bulk"; idxs: number[]; sendSucceeds: boolean };

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

describe("**Feature: prospecting-sequences, Property 12: Queue item status invariant.**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Validates: Requirements 8.7 — after any sequence of approve/reject/edit/bulk actions over a Sequence's Queued_Items, every status is exactly one of pending|approved|rejected|sent", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ count, actions }) => {
        backup.restore();
        const ids = seed(mem, count);

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
          await assertInvariant(db);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
