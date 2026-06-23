import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, asc } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";

/**
 * Property 14 — Editing preserves enrollments and applies forward
 * (Requirements 7.3, 10.1, 10.2).
 *
 *   **Feature: prospecting-sequences, Property 14: Editing preserves enrollments
 *   and applies forward.**
 *
 * **Validates: Requirements 7.3, 10.1, 10.2**
 *
 * *For any* edit payload (keeping a resolvable Subject) applied to a `live` /
 * `paused` Sequence that already has enrollments: the updated configuration is
 * persisted (and is what the next Refresh_Run reads — Req 10.1), while EVERY
 * existing Enrolled_Prospect and its pending Queued_Items are retained unchanged
 * (Req 10.2). The edit route (`PATCH /prospecting/sequences/:id` →
 * `updateSequenceConfig`) only mutates the Sequence's own config row; it never
 * touches the enrollment ledger or the queue.
 *
 * Driven through the real Elysia route against an in-memory Postgres (pg-mem)
 * carrying the real `drizzle/0040_agentic_prospecting_batch.sql` +
 * `drizzle/0043_prospecting_sequences.sql` schemas.
 */

const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

const REP_ID = "11111111-1111-1111-1111-111111111111";

const h = vi.hoisted(() => ({ db: null as unknown }));

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

vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: vi.fn() }));
vi.mock("../../prospecting/batch/send-cap", () => ({
  capExhausted: vi.fn(async () => false),
  recordSend: vi.fn(async () => {}),
  incrementScope: vi.fn(async () => {}),
}));
vi.mock("../../prospecting/optout", () => ({ isOptedOut: vi.fn(async () => false) }));
vi.mock("../../prospecting/batch/claim", () => ({ releaseClaim: vi.fn(async () => {}) }));
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
    "target_type" text NOT NULL,
    "display_name" text,
    "company_name" text,
    "title" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "country" text,
    "source_provider" text NOT NULL,
    "lawful_basis" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
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

beforeEach(() => {
  vi.clearAllMocks();
});

interface Seeded {
  sequenceId: string;
  enrollmentIds: string[];
  queueIds: string[];
}

/**
 * Seed a `live` / `paused` Sequence owned by `REP_ID` with a sequence-scoped
 * Refresh_Run, `count` enrolled prospects (ledger rows) and a pending
 * cold-eligible Queued_Item for each.
 */
function seed(mem: IMemoryDb, status: "live" | "paused", count: number): Seeded {
  const sequenceId = randomUUID();
  const runId = randomUUID();
  mem.public.none(
    `INSERT INTO "users" ("id") VALUES ('${REP_ID}') ON CONFLICT DO NOTHING`
  );
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "target_count", "mode", "status", ` +
      `"enrollment_cap", "enrollment_period", "refresh_interval_minutes") ` +
      `VALUES ('${sequenceId}', '${REP_ID}', 'orig name', ` +
      `'{"kind":"icp","icpFilter":{"targetType":"person"}}'::jsonb, 10, ` +
      `'${status === "live" ? "live" : "draft"}', '${status}', 200, 'month', 1440)`
  );
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "sequence_id", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${runId}', '${REP_ID}', '${sequenceId}', '{"kind":"icp"}'::jsonb, 10, '${runId}')`
  );

  const enrollmentIds: string[] = [];
  const queueIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const targetId = randomUUID();
    const draftId = randomUUID();
    const queueId = randomUUID();
    const enrollmentId = randomUUID();
    mem.public.none(
      `INSERT INTO "targets" ("id", "target_type", "display_name", "email", ` +
        `"source_provider", "lawful_basis") ` +
        `VALUES ('${targetId}', 'person', 'Cand ${i}', 'c${i}-${targetId}@x.com', ` +
        `'demo', 'legitimate_interest')`
    );
    mem.public.none(
      `INSERT INTO "outreach_drafts" ("id", "target_id", "channel", "language", ` +
        `"subject", "body", "grounding") ` +
        `VALUES ('${draftId}', '${targetId}', 'email', 'en', 'S${i}', 'B${i}', '[]'::jsonb)`
    );
    mem.public.none(
      `INSERT INTO "prospecting_queue_items" ("id", "batch_run_id", "target_id", ` +
        `"draft_id", "eligibility", "status") ` +
        `VALUES ('${queueId}', '${runId}', '${targetId}', '${draftId}', 'cold_eligible', 'pending')`
    );
    mem.public.none(
      `INSERT INTO "prospecting_sequence_enrollments" ("id", "sequence_id", ` +
        `"match_kind", "match_value", "target_id", "batch_run_id", "period_bucket") ` +
        `VALUES ('${enrollmentId}', '${sequenceId}', 'email', 'c${i}-${targetId}@x.com', ` +
        `'${targetId}', '${runId}', '2026-01')`
    );
    enrollmentIds.push(enrollmentId);
    queueIds.push(queueId);
  }
  return { sequenceId, enrollmentIds, queueIds };
}

function app() {
  return new Elysia().use(prospectingRoutes);
}

const HDRS = { "Content-Type": "application/json" };

async function patchSequence(id: string, body: unknown) {
  return app().handle(
    new Request(`http://localhost/prospecting/sequences/${id}`, {
      method: "PATCH",
      headers: HDRS,
      body: JSON.stringify(body),
    })
  );
}

async function readEnrollments(sequenceId: string) {
  return db
    .select({
      id: schema.prospectingSequenceEnrollments.id,
      targetId: schema.prospectingSequenceEnrollments.targetId,
      matchValue: schema.prospectingSequenceEnrollments.matchValue,
    })
    .from(schema.prospectingSequenceEnrollments)
    .where(eq(schema.prospectingSequenceEnrollments.sequenceId, sequenceId))
    .orderBy(asc(schema.prospectingSequenceEnrollments.id));
}

async function readQueueItems(runOwnerSeq: string) {
  return db
    .select({
      id: schema.prospectingQueueItems.id,
      status: schema.prospectingQueueItems.status,
      targetId: schema.prospectingQueueItems.targetId,
    })
    .from(schema.prospectingQueueItems)
    .innerJoin(
      schema.prospectingBatchRuns,
      eq(schema.prospectingBatchRuns.id, schema.prospectingQueueItems.batchRunId)
    )
    .where(eq(schema.prospectingBatchRuns.sequenceId, runOwnerSeq))
    .orderBy(asc(schema.prospectingQueueItems.id));
}

describe("**Feature: prospecting-sequences, Property 14: Editing preserves enrollments and applies forward.**", () => {
  it("Validates: Requirements 7.3, 10.1, 10.2 — an edit (keeping a resolvable subject) persists the new config and retains every enrolled prospect and its pending queue items unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          status: fc.constantFrom<"live" | "paused">("live", "paused"),
          count: fc.integer({ min: 1, max: 5 }),
          name: fc.option(
            fc.string({ minLength: 1, maxLength: 24 }).map((s) => s.trim()),
            { nil: undefined }
          ),
          targetCount: fc.option(fc.integer({ min: 1, max: 500 }), {
            nil: undefined,
          }),
          refreshIntervalMinutes: fc.option(fc.integer({ min: 60, max: 20_160 }), {
            nil: undefined,
          }),
          enrollmentCap: fc.option(fc.integer({ min: 1, max: 1000 }), {
            nil: undefined,
          }),
          // Sometimes re-supply a resolvable subject in the edit.
          withSubject: fc.boolean(),
        }),
        async (cfg) => {
          backup.restore();
          const { sequenceId, enrollmentIds, queueIds } = seed(
            mem,
            cfg.status,
            cfg.count
          );

          const before = await readEnrollments(sequenceId);
          const beforeQueue = await readQueueItems(sequenceId);

          const payload: Record<string, unknown> = {};
          if (cfg.name && cfg.name.length > 0) payload.name = cfg.name;
          if (cfg.targetCount !== undefined) payload.targetCount = cfg.targetCount;
          if (cfg.refreshIntervalMinutes !== undefined) {
            payload.refreshIntervalMinutes = cfg.refreshIntervalMinutes;
          }
          if (cfg.enrollmentCap !== undefined) {
            payload.enrollmentCap = cfg.enrollmentCap;
          }
          if (cfg.withSubject) {
            payload.subject = {
              kind: "icp",
              icpFilter: { targetType: "company" },
            };
          }

          const res = await patchSequence(sequenceId, payload);
          expect(res.status).toBe(200);

          // (Req 10.1) The new config is persisted — the next refresh reads this.
          const [row] = await db
            .select()
            .from(schema.prospectingSequences)
            .where(eq(schema.prospectingSequences.id, sequenceId));
          if (cfg.name && cfg.name.length > 0) {
            expect(row.name).toBe(cfg.name);
          }
          if (cfg.targetCount !== undefined) {
            expect(row.targetCount).toBe(cfg.targetCount);
          }
          if (cfg.refreshIntervalMinutes !== undefined) {
            expect(row.refreshIntervalMinutes).toBe(cfg.refreshIntervalMinutes);
          }
          if (cfg.enrollmentCap !== undefined) {
            expect(row.enrollmentCap).toBe(cfg.enrollmentCap);
          }
          if (cfg.withSubject) {
            expect((row.subject as { icpFilter: { targetType: string } }).icpFilter.targetType).toBe(
              "company"
            );
          }
          // The lifecycle status is untouched by an edit.
          expect(row.status).toBe(cfg.status);

          // (Req 10.2) Every enrolled prospect is retained unchanged.
          const after = await readEnrollments(sequenceId);
          expect(after.map((e) => e.id).sort()).toEqual(
            [...enrollmentIds].sort()
          );
          expect(after).toEqual(before);

          // (Req 10.2) Every pending queue item is retained unchanged.
          const afterQueue = await readQueueItems(sequenceId);
          expect(afterQueue.map((q) => q.id).sort()).toEqual(
            [...queueIds].sort()
          );
          expect(afterQueue).toEqual(beforeQueue);
          for (const q of afterQueue) {
            expect(q.status).toBe("pending");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
