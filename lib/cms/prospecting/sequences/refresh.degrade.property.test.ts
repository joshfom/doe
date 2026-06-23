import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS } from "../providers";

/**
 * Property 15 — A failed or fully-degraded refresh keeps the Sequence live
 * (Requirements 14.2, 14.4).
 *
 *   **Feature: prospecting-sequences, Property 15: A failed or fully-degraded
 *   refresh keeps the Sequence live.**
 *
 * **Validates: Requirements 14.2, 14.4**
 *
 * *For any* Sequence Refresh_Run that either (a) finds EVERY provider
 * unconfigured / failed, or (b) hits a forced terminal failure, the campaign
 * itself is never errored: the Sequence stays `live` and its `next_refresh_at`
 * (set at schedule time) is intact, so the next tick still fires (Req 14.2,
 * 14.4). In the degraded case the run completes gracefully with zero new
 * Enrollments and an `unconfigured_providers` reason; in the terminal-failure
 * case the Batch_Run is marked `failed` but the Sequence is untouched.
 *
 * The decisive seam is the SAME durable batch handler the ad-hoc path uses —
 * `runProspectingBatch` (`lib/cms/prospecting/batch/run.ts`) — driven in its
 * SEQUENCE-SCOPED mode (the Batch_Run row carries a `sequence_id`). The Sequence
 * is seeded `live` with a FIXED `next_refresh_at` slot; the property runs the
 * refresh under each degradation mode and asserts the Sequence's status and
 * `next_refresh_at` are unchanged and no enrollment was written.
 *
 *   - Degraded: `prospect_search` returns zero candidates + every provider
 *     unconfigured → `completeBatchRun(reason = "unconfigured_providers")`. The
 *     completion hook stamps `last_refreshed_at` but NEVER touches
 *     `next_refresh_at` or `status` (Req 14.2).
 *   - Terminal failure: `prospect_search` throws → the handler's catch stamps
 *     the Batch_Run `failed` and rethrows, NEVER touching the Sequence row, so
 *     it stays `live` with its slot intact (Req 14.4).
 */

const h = vi.hoisted(() => ({
  mode: "degraded" as "degraded" | "failed",
}));

vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(async (_db: unknown, toolName: string) => {
    if (toolName === "prospect_search") {
      if (h.mode === "failed") {
        // Forced terminal failure: an unexpected throw out of discovery
        // propagates to the handler's catch (Batch_Run → failed + rethrow).
        throw new Error("forced terminal failure in prospect_search");
      }
      // Forced full degradation: every provider unconfigured, zero candidates.
      return {
        ok: true,
        result: {
          candidates: [],
          unconfiguredProviders: [...PROVIDER_IDS],
          failedProviders: [],
        },
      };
    }
    throw new Error(`unexpected tool ${toolName}`);
  }),
}));

vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(async () => ({
    configured: true,
    found: false,
    matches: [],
    checkedEmail: null,
  })),
}));

import { runProspectingBatch } from "../batch/run";

const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

// A fixed schedule slot, seeded onto the Sequence so the property can assert it
// is intact after a degraded / failed refresh.
const SCHEDULED_SLOT = new Date("2026-03-15T09:00:00.000Z");

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
  CREATE TABLE "prospect_optouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "match_kind" text NOT NULL,
    "match_value" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "prospect_optouts_match_ux" ON "prospect_optouts" ("match_kind", "match_value");
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
});

afterAll(async () => {
  await dbPool?.end?.();
});

/**
 * Seed a `live` Sequence with a FIXED `next_refresh_at` slot plus its
 * sequence-scoped Refresh_Run. Returns both ids so the property can re-read the
 * Sequence and the run after the degraded / failed refresh.
 */
async function seedSequenceRun(
  db: Database
): Promise<{ sequenceId: string; runId: string }> {
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);

  const [sequence] = await db
    .insert(schema.prospectingSequences)
    .values({
      ownerRep,
      name: `seq-${randomUUID()}`,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 100,
      mode: "live",
      status: "live",
      nextRefreshAt: SCHEDULED_SLOT,
      refreshIntervalMinutes: 1440,
      enrollmentCap: null,
      enrollmentPeriod: "month",
    })
    .returning({ id: schema.prospectingSequences.id });

  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      sequenceId: sequence.id,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 100,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return { sequenceId: sequence.id, runId: run.id };
}

async function readSequence(
  db: Database,
  sequenceId: string
): Promise<{ status: string | null; nextRefreshAt: Date | null }> {
  const [row] = await db
    .select({
      status: schema.prospectingSequences.status,
      nextRefreshAt: schema.prospectingSequences.nextRefreshAt,
    })
    .from(schema.prospectingSequences)
    .where(eq(schema.prospectingSequences.id, sequenceId));
  return row;
}

describe("**Feature: prospecting-sequences, Property 15: A failed or fully-degraded refresh keeps the Sequence live.**", () => {
  it("Validates: Requirements 14.2, 14.4 — a degraded (all-providers-unconfigured) or terminally-failed refresh leaves the Sequence live with its next_refresh_at intact and writes no enrollment", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<"degraded" | "failed">("degraded", "failed"),
        async (mode) => {
          backup.restore();
          h.mode = mode;
          const { sequenceId, runId } = await seedSequenceRun(db);

          if (mode === "failed") {
            // The terminal failure propagates — the campaign is never errored,
            // only the Batch_Run is marked failed.
            await expect(
              runProspectingBatch(db, { batchRunId: runId }, {} as never)
            ).rejects.toThrow();

            const [run] = await db
              .select({ status: schema.prospectingBatchRuns.status })
              .from(schema.prospectingBatchRuns)
              .where(eq(schema.prospectingBatchRuns.id, runId));
            expect(run.status).toBe("failed");
          } else {
            // The degraded run completes gracefully (no throw).
            await runProspectingBatch(db, { batchRunId: runId }, {} as never);

            const [run] = await db
              .select({
                status: schema.prospectingBatchRuns.status,
                reason: schema.prospectingBatchRuns.reason,
              })
              .from(schema.prospectingBatchRuns)
              .where(eq(schema.prospectingBatchRuns.id, runId));
            expect(run.status).toBe("completed");
            expect(run.reason).toBe("unconfigured_providers");
          }

          // (Req 14.2, 14.4) Either way: the Sequence stays `live` and its
          // schedule slot is intact, so the next tick still fires.
          const seq = await readSequence(db, sequenceId);
          expect(seq.status).toBe("live");
          expect(seq.nextRefreshAt).not.toBeNull();
          expect(seq.nextRefreshAt!.getTime()).toBe(SCHEDULED_SLOT.getTime());

          // No Enrollment was written by a degraded / failed refresh.
          const [enrollmentCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.prospectingSequenceEnrollments)
            .where(eq(schema.prospectingSequenceEnrollments.sequenceId, sequenceId));
          expect(enrollmentCount.count).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
