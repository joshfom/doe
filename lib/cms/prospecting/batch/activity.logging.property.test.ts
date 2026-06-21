import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import type { Database } from "../../db";
import {
  appendActivity,
  readActivity,
  type ActivityAction,
  type SkipReason,
} from "./activity";

/**
 * Property 6 — Every decision point is logged with action and reason
 * (Requirements 3.2, 3.3).
 *
 * The Batch_Run reaches a sequence of decision points per candidate
 * (`discovered → crm_checked → scored → eligibility → drafted`, or a terminal
 * `skipped` / `warm_path`). For each one it appends exactly one
 * `prospecting_batch_activity` row via {@link appendActivity}. The contract
 * under test:
 *
 *   (Req 3.2) Every decision point appended is later retrievable, in order, with
 *     an `action` that matches the decision that produced it — one stored entry
 *     per decision, no entry dropped or invented.
 *
 *   (Req 3.3) Every `skipped` decision carries a `reason` drawn from the skip
 *     taxonomy (`opted_out | missing_lawful_basis | claimed_by_other_rep |
 *     already_in_salesforce | cap_reached`).
 *
 *   (ordering) The per-run `seq` is strictly monotonic `1, 2, 3, …`, so the log
 *     reads back in the exact order the decisions were reached.
 *
 * Runs against a REAL Drizzle handle backed by an in-memory Postgres (pg-mem,
 * node-postgres adapter) so `appendActivity`'s genuine monotonic-`seq`
 * transaction + `.returning()` and `readActivity`'s ordered read execute. The
 * harness mirrors the sibling `activity.test.ts` (task 5.1).
 *
 * Tag: Feature: agentic-prospecting-batch, Property 6: Every decision point is
 * logged with action and reason
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);

// Minimal DDL: only what the activity module touches, mirroring
// drizzle/0040_agentic_prospecting_batch.sql + the events table (matches the
// task 5.1 unit-test harness).
const DDL = `
  CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());

  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
    "subject" jsonb NOT NULL,
    "cluster_id" text,
    "target_count" integer NOT NULL,
    "status" text NOT NULL DEFAULT 'running',
    "rerun_key" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );

  CREATE TABLE "prospecting_batch_activity" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "batch_run_id" uuid NOT NULL REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
    "seq" integer NOT NULL,
    "action" text NOT NULL,
    "reason" text,
    "target_id" uuid,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );

  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()` — register both
  // (the latter as a no-op) so the real SQL resolves.
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

  mem.public.none(DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping.
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

async function seedRun(db: Database): Promise<string> {
  // Insert the FK owner via raw SQL: the real `users` table has many NOT-NULL
  // columns the minimal test DDL omits, so a Drizzle insert would reference
  // columns this harness does not create.
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);
  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      subject: { kind: "cluster", clusterId: "c1" },
      targetCount: 5,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return run.id;
}

// ── Generators ───────────────────────────────────────────────────────────────

const SKIP_REASONS: readonly SkipReason[] = [
  "opted_out",
  "missing_lawful_basis",
  "claimed_by_other_rep",
  "already_in_salesforce",
  "cap_reached",
];

const NON_SKIP_ACTIONS: readonly ActivityAction[] = [
  "discovered",
  "crm_checked",
  "scored",
  "eligibility",
  "drafted",
  "warm_path",
];

/**
 * One generated decision: any of the seven {@link ActivityAction}s. A `skipped`
 * decision additionally carries a {@link SkipReason} from the taxonomy (Req 3.3);
 * a non-skip decision carries an optional free-form note.
 */
type GeneratedDecision =
  | { action: "skipped"; reason: SkipReason; targetId: string }
  | { action: Exclude<ActivityAction, "skipped">; reason: string | null; targetId: string };

const skipDecisionArb: fc.Arbitrary<GeneratedDecision> = fc.record({
  action: fc.constant("skipped" as const),
  reason: fc.constantFrom(...SKIP_REASONS),
  targetId: fc.uuid(),
});

const nonSkipDecisionArb: fc.Arbitrary<GeneratedDecision> = fc.record({
  action: fc.constantFrom(...NON_SKIP_ACTIONS),
  reason: fc.option(fc.constantFrom("via:crm", "via:local_party", "ok"), {
    nil: null,
  }),
  targetId: fc.uuid(),
});

const decisionArb: fc.Arbitrary<GeneratedDecision> = fc.oneof(
  nonSkipDecisionArb,
  skipDecisionArb
);

// A non-empty sequence of decisions, like the per-candidate decision points a
// single Batch_Run reaches over its lifetime.
const decisionsArb = fc.array(decisionArb, { minLength: 1, maxLength: 25 });

describe("Feature: agentic-prospecting-batch, Property 6: Every decision point is logged with action and reason", () => {
  it("records one entry per decision whose action matches, skipped entries carry a valid skip_reason, and seq is monotonic (Req 3.2, 3.3)", async () => {
    await fc.assert(
      fc.asyncProperty(decisionsArb, async (decisions) => {
        backup.restore();
        const runId = await seedRun(db);

        // Reach each decision point in order, logging one activity row each.
        for (const d of decisions) {
          await appendActivity(db, {
            batchRunId: runId,
            action: d.action,
            reason: d.reason,
            targetId: d.targetId,
          });
        }

        const rows = await readActivity(db, runId);

        // (Req 3.2) Exactly one stored entry per decision — none dropped, none
        // invented.
        expect(rows).toHaveLength(decisions.length);

        // (ordering) seq is strictly monotonic 1, 2, 3, … so the log reads back
        // in the exact order the decisions were reached.
        expect(rows.map((r) => r.seq)).toEqual(
          decisions.map((_, i) => i + 1)
        );

        // (Req 3.2) Each entry's action matches the decision that produced it.
        expect(rows.map((r) => r.action)).toEqual(
          decisions.map((d) => d.action)
        );

        // Per-entry assertions.
        for (let i = 0; i < decisions.length; i++) {
          const row = rows[i];
          const decision = decisions[i];

          // The candidate is referenced by an internal id, in order.
          expect(row.targetId).toBe(decision.targetId);

          if (decision.action === "skipped") {
            // (Req 3.3) A skipped entry carries a reason drawn from the skip
            // taxonomy.
            expect(SKIP_REASONS).toContain(row.reason as SkipReason);
            expect(row.reason).toBe(decision.reason);
          } else {
            // Non-skip entries carry whatever note (or null) they were given.
            expect(row.reason).toBe(decision.reason);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
