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
  recordSend,
  remainingBudget,
  type SendScopeKind,
} from "./send-cap";

/**
 * Property 13 — Send-cap periods are independent (Requirements 7.4).
 *
 * The cap "resets by period" with NO scheduled reset job: a period is just a
 * `period_bucket` value, and `prospecting_send_counters` is keyed by
 * `(scope_kind, scope_id, period_bucket)`. A new period is therefore a brand-new
 * bucket whose `consumed` starts at zero (design §6 "Send caps"). The contract
 * under test, for the SAME scope (rep / cluster) across DISTINCT buckets:
 *
 *   (a) Independence: recording sends in one `period_bucket` does NOT change the
 *       consumed count of any other `period_bucket`. Each bucket accumulates
 *       exactly its own sends.
 *
 *   (b) Fresh period reads zero: a never-used `period_bucket` reads
 *       `consumed = 0` — this is how the cap "resets" for the new period.
 *
 *   (c) Full budget on reset: with a configured cap, a fresh bucket's
 *       `remaining` equals the full cap (nothing consumed yet), so the new
 *       period starts with the whole budget available (Req 7.4).
 *
 * The property runs against a REAL Drizzle handle backed by an in-memory
 * Postgres (pg-mem), applying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` migration so `recordSend`'s
 * genuine `INSERT … ON CONFLICT` SQL executes. The harness is reused verbatim
 * from the sibling `send-cap.exactly-once.property.test.ts` (statement-breakpoint
 * splitter, `gen_random_uuid()` registration, and the node-postgres adapter
 * wrapper restoring faithful `ON CONFLICT DO NOTHING … RETURNING` semantics).
 *
 * Tag: Feature: agentic-prospecting-batch, Property 13: Send-cap periods are
 * independent
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// Minimal stubs for the PRE-existing tables 0040 references (mirrors
// migration-0040.test.ts). `outreach_drafts` is the FK target of
// `prospecting_send_ledger.draft_id`.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "subject" text,
    "body" text
  );
`;

/** Stand up a fresh pg-mem with 0040 applied + a real Drizzle handle. */
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
  // rows, but pg-mem returns the EXISTING row (and reports rowCount 1). That
  // deviation would defeat the idempotency guard under test
  // (`incrementScope` keys "already counted" off an empty RETURNING), so we
  // restore faithful semantics here: for such a statement we compare the target
  // table's row count before/after; if no row was actually inserted (a
  // conflict), we strip the erroneously-returned row so RETURNING is empty —
  // exactly as Postgres behaves.
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

/** Insert a minimal outreach_draft and return its id (FK anchor for the ledger). */
function seedDraft(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO outreach_drafts (id) VALUES ('${id}')`);
  return id;
}

/** Read a scope's consumed counter (0 when no row exists yet). */
async function consumed(
  db: Database,
  scopeKind: SendScopeKind,
  scopeId: string,
  periodBucket: string
): Promise<number> {
  const { consumed } = await remainingBudget(db, {
    scopeKind,
    scopeId,
    periodBucket,
  });
  return consumed;
}

// Realistic, SQL-safe generators. scope_id / period_bucket are plain text; all
// values reach the DB through Drizzle's parameterized inserts.
const repIdArb = fc.uuid();
const clusterIdArb = fc.uuid();
// A period bucket label (a calendar day). uniqueArray below guarantees the
// buckets in a single run are DISTINCT periods.
const periodBucketArb = fc
  .integer({ min: 1, max: 28 })
  .map((d) => `2026-01-${String(d).padStart(2, "0")}`);

describe("Feature: agentic-prospecting-batch, Property 13: Send-cap periods are independent", () => {
  it("(a) sends in one period_bucket never affect another bucket's consumed count, for both scopes (Req 7.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        // 2–5 DISTINCT period buckets, each with its own number of sends.
        fc
          .uniqueArray(
            fc.record({
              bucket: periodBucketArb,
              sends: fc.integer({ min: 1, max: 5 }),
            }),
            {
              minLength: 2,
              maxLength: 5,
              selector: (entry) => entry.bucket,
            }
          ),
        async (repId, clusterId, periods) => {
          backup.restore();

          // Record `sends` distinct sends (each its own draft) into each bucket.
          for (const { bucket, sends } of periods) {
            for (let i = 0; i < sends; i++) {
              const draftId = seedDraft(mem);
              await recordSend(db, {
                draftId,
                repId,
                clusterId,
                periodBucket: bucket,
              });
            }
          }

          // Independence: each bucket's consumed count equals EXACTLY the sends
          // recorded into that bucket — neither scope leaks across periods, even
          // though the same rep/cluster id is used for every bucket.
          for (const { bucket, sends } of periods) {
            expect(await consumed(db, "rep", repId, bucket)).toBe(sends);
            expect(await consumed(db, "cluster", clusterId, bucket)).toBe(sends);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(b) a fresh/never-used period reads consumed = 0 even after another period is fully used (Req 7.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        // Two distinct buckets: one used, one untouched.
        fc.uniqueArray(periodBucketArb, { minLength: 2, maxLength: 2 }),
        fc.integer({ min: 1, max: 6 }),
        async (repId, clusterId, [usedBucket, freshBucket], sends) => {
          backup.restore();

          // Consume the first period.
          for (let i = 0; i < sends; i++) {
            const draftId = seedDraft(mem);
            await recordSend(db, {
              draftId,
              repId,
              clusterId,
              periodBucket: usedBucket,
            });
          }

          // The used period reflects its sends...
          expect(await consumed(db, "rep", repId, usedBucket)).toBe(sends);
          expect(await consumed(db, "cluster", clusterId, usedBucket)).toBe(
            sends
          );

          // ...while the never-used period reads zero for both scopes — the cap
          // has effectively "reset" for the new period.
          expect(await consumed(db, "rep", repId, freshBucket)).toBe(0);
          expect(await consumed(db, "cluster", clusterId, freshBucket)).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(c) a fresh period starts with the FULL budget when a cap is configured (Req 7.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        fc.uniqueArray(periodBucketArb, { minLength: 2, maxLength: 2 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 20 }),
        async (repId, clusterId, [usedBucket, freshBucket], sends, cap) => {
          backup.restore();

          // Exhaust some of the cap in the FIRST period.
          for (let i = 0; i < sends; i++) {
            const draftId = seedDraft(mem);
            await recordSend(db, {
              draftId,
              repId,
              clusterId,
              periodBucket: usedBucket,
            });
          }

          // The new period reads the FULL cap as remaining — its consumed is 0,
          // independent of however much the prior period consumed.
          const freshRep = await remainingBudget(db, {
            scopeKind: "rep",
            scopeId: repId,
            periodBucket: freshBucket,
            cap,
          });
          expect(freshRep.consumed).toBe(0);
          expect(freshRep.remaining).toBe(cap);

          const freshCluster = await remainingBudget(db, {
            scopeKind: "cluster",
            scopeId: clusterId,
            periodBucket: freshBucket,
            cap,
          });
          expect(freshCluster.consumed).toBe(0);
          expect(freshCluster.remaining).toBe(cap);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
