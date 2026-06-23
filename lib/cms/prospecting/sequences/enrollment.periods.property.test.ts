import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";
import {
  enrollmentConsumed,
  enrollmentRemaining,
  insertEnrollment,
} from "./enrollment";

/**
 * Property 8 — Enrollment-cap periods are independent (Requirements 11.3).
 *
 * The enrollment cap "resets by period" with NO scheduled reset job: a period is
 * just a `period_bucket` value on the per-Sequence enrollment ledger
 * (`prospecting_sequence_enrollments`), and the consumed count is a COUNT(*) of
 * rows keyed by `(sequence_id, period_bucket)`. A new period is therefore a
 * brand-new bucket whose consumed starts at zero (design §Components #3 +
 * §Data Models, `periodBucket` / `enrollmentConsumed` / `enrollmentRemaining`).
 * The contract under test, for the SAME Sequence across DISTINCT buckets:
 *
 *   (a) Independence: recording enrollments in one `period_bucket` does NOT
 *       change the consumed count of any other `period_bucket`. Each bucket
 *       accumulates exactly its own enrollments.
 *
 *   (b) Fresh period reads zero: a never-used `period_bucket` reads
 *       `consumed = 0` — this is how the cap "resets" for the new period.
 *
 *   (c) Full budget on reset: with a configured `enrollment_cap`, a fresh
 *       bucket's `remaining` equals the full cap (nothing consumed yet), so the
 *       new period starts with the whole enrollment budget available (Req 11.3).
 *
 * The property runs against a REAL Drizzle handle backed by an in-memory
 * Postgres (pg-mem), applying the real `drizzle/0043_prospecting_sequences.sql`
 * migration so `insertEnrollment`'s genuine `INSERT … ON CONFLICT DO NOTHING …
 * RETURNING` SQL and `enrollmentConsumed`'s `COUNT(*)` execute. The harness is
 * reused from the sibling `batch/send-cap.periods.property.test.ts`
 * (statement-breakpoint splitter, `gen_random_uuid()` / `now()` registration,
 * and the node-postgres adapter wrapper restoring faithful `ON CONFLICT DO
 * NOTHING … RETURNING` semantics).
 *
 * Tag: Feature: prospecting-sequences, Property 8: Enrollment-cap periods are
 * independent
 */

// The design mandates a minimum of 100 iterations for every property test; clamp
// the configurable run count so it can be raised but never fall below the floor.
const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const MIGRATION_FILE = "0043_prospecting_sequences.sql";

// Minimal stubs for the PRE-existing tables 0043 references (mirrors
// migration-0043.test.ts). `prospecting_sequences` is the ALTER TABLE target
// (and FK target of `prospecting_sequence_enrollments.sequence_id`); `targets`
// is the FK target of `…target_id`; `prospecting_batch_runs` is the FK target of
// `…batch_run_id`. Those tables are owned by earlier migrations, so they are
// stood up as minimal stubs here so the real 0043 applies verbatim.
const PREREQUISITE_SQL = `
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid,
    "name" text,
    "mode" text
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

/** Stand up a fresh pg-mem with 0043 applied + a real Drizzle handle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor a timestamptz `now()`; register
  // both so the ledger's column DEFAULTs resolve. Impure so each row gets a
  // fresh value rather than a cached single value.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "now",
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const sql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of sql.split("--> statement-breakpoint")) {
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
  // rows, but pg-mem returns the EXISTING row. That deviation would defeat the
  // idempotency guard (`insertEnrollment` keys "already enrolled" off an empty
  // RETURNING), so we restore faithful semantics: for such a statement we
  // compare the target table's row count before/after; if no row was actually
  // inserted (a conflict), we strip the erroneously-returned row so RETURNING is
  // empty — exactly as Postgres behaves.
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
// DB would, without re-instantiating pg-mem (and leaking an adapter pool) per run.
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

/** Insert a minimal sequence and return its id (FK anchor + cap subject). */
function seedSequence(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO prospecting_sequences (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal target and return its id (FK anchor for the ledger). */
function seedTarget(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO targets (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal batch run and return its id (FK anchor for the ledger). */
function seedBatchRun(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO prospecting_batch_runs (id) VALUES ('${id}')`);
  return id;
}

/**
 * Enroll one distinct prospect into `sequenceId` under `bucket`. Each enrollment
 * carries a fresh `ref` identity (unique `match_value`) so it never collides on
 * the unique `(sequence_id, match_kind, match_value)` index — the count under
 * test reflects genuine, distinct enrollments.
 */
async function enrollOne(
  db: Database,
  args: { sequenceId: string; targetId: string; batchRunId: string; bucket: string }
): Promise<void> {
  const { inserted } = await insertEnrollment(db, {
    sequenceId: args.sequenceId,
    matchKind: "ref",
    matchValue: `demo:${randomUUID()}`,
    targetId: args.targetId,
    batchRunId: args.batchRunId,
    periodBucket: args.bucket,
  });
  // A distinct identity must always be a fresh enrollment.
  expect(inserted).toBe(true);
}

// A period-bucket label. uniqueArray (by bucket) guarantees the buckets in a
// single run are DISTINCT periods. Spans months/years so day|week|month styles
// are all represented as opaque distinct keys.
const periodBucketArb = fc
  .integer({ min: 1, max: 999 })
  .map((n) => `2026-${String(n).padStart(3, "0")}`);

describe("Feature: prospecting-sequences, Property 8: Enrollment-cap periods are independent", () => {
  it("(a) enrollments in one period_bucket never affect another bucket's consumed count (Req 11.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 2–5 DISTINCT period buckets, each with its own number of enrollments.
        fc.uniqueArray(
          fc.record({
            bucket: periodBucketArb,
            enrollments: fc.integer({ min: 1, max: 5 }),
          }),
          { minLength: 2, maxLength: 5, selector: (e) => e.bucket }
        ),
        async (periods) => {
          backup.restore();
          const sequenceId = seedSequence(mem);
          const targetId = seedTarget(mem);
          const batchRunId = seedBatchRun(mem);

          // Enroll `enrollments` distinct prospects into each bucket.
          for (const { bucket, enrollments } of periods) {
            for (let i = 0; i < enrollments; i++) {
              await enrollOne(db, { sequenceId, targetId, batchRunId, bucket });
            }
          }

          // Independence: each bucket's consumed count equals EXACTLY the
          // enrollments recorded into that bucket — no bucket leaks into another,
          // even though every enrollment shares one Sequence.
          for (const { bucket, enrollments } of periods) {
            expect(await enrollmentConsumed(db, sequenceId, bucket)).toBe(
              enrollments
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(b) a fresh/never-used period reads consumed = 0 even after another period is fully used (Req 11.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Two distinct buckets: one used, one untouched.
        fc.uniqueArray(periodBucketArb, { minLength: 2, maxLength: 2 }),
        fc.integer({ min: 1, max: 6 }),
        async ([usedBucket, freshBucket], enrollments) => {
          backup.restore();
          const sequenceId = seedSequence(mem);
          const targetId = seedTarget(mem);
          const batchRunId = seedBatchRun(mem);

          // Consume the first period.
          for (let i = 0; i < enrollments; i++) {
            await enrollOne(db, {
              sequenceId,
              targetId,
              batchRunId,
              bucket: usedBucket,
            });
          }

          // The used period reflects its enrollments...
          expect(await enrollmentConsumed(db, sequenceId, usedBucket)).toBe(
            enrollments
          );
          // ...while the never-used period reads zero — the cap has effectively
          // "reset" for the new period (Req 11.3).
          expect(await enrollmentConsumed(db, sequenceId, freshBucket)).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(c) a fresh period starts with the FULL enrollment budget when a cap is configured (Req 11.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(periodBucketArb, { minLength: 2, maxLength: 2 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 50 }),
        async ([usedBucket, freshBucket], enrollments, cap) => {
          backup.restore();
          const sequenceId = seedSequence(mem);
          const targetId = seedTarget(mem);
          const batchRunId = seedBatchRun(mem);

          // Exhaust some of the cap in the FIRST period (bounded by the cap).
          const used = Math.min(enrollments, cap);
          for (let i = 0; i < used; i++) {
            await enrollOne(db, {
              sequenceId,
              targetId,
              batchRunId,
              bucket: usedBucket,
            });
          }

          // The used period consumed exactly `used`, leaving `cap - used`.
          const usedRemaining = await enrollmentRemaining(
            db,
            { id: sequenceId, enrollmentCap: cap },
            usedBucket
          );
          expect(usedRemaining).toBe(cap - used);

          // The new period reads the FULL cap as remaining — its consumed is 0,
          // independent of however much the prior period consumed (Req 11.3).
          expect(await enrollmentConsumed(db, sequenceId, freshBucket)).toBe(0);
          const freshRemaining = await enrollmentRemaining(
            db,
            { id: sequenceId, enrollmentCap: cap },
            freshBucket
          );
          expect(freshRemaining).toBe(cap);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
