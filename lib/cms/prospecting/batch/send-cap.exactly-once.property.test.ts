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
 * Property 12 — Send-cap increments are exactly-once and independent
 * (Requirements 7.5, 7.6).
 *
 * `recordSend` records one completed send against the rep cap and the cluster
 * cap as two INDEPENDENT, exactly-once increments. The contract under test:
 *
 *   (a) Exactly-once (Req 7.5): driving `recordSend` for the SAME draft any
 *       number of times advances each scope's consumed counter by exactly one.
 *       The `(draft_id, scope_kind)` ledger row is the idempotency guard — the
 *       first writer performs the `+1`, every retry no-ops.
 *
 *   (b) Independence (Req 7.6): forcing ONE scope's increment to fail must not
 *       prevent the OTHER scope from applying. The surviving scope still
 *       advances by exactly one, and the failed scope leaves no ledger row — so
 *       a later retry can still apply it exactly once.
 *
 * The properties run against a REAL Drizzle handle backed by an in-memory
 * Postgres (pg-mem), applying the real `drizzle/0040_agentic_prospecting_batch.sql`
 * migration so `recordSend`'s genuine `INSERT … ON CONFLICT` SQL executes
 * (the ledger guard + the counter upsert). The pg-mem harness mirrors the
 * sibling `migration-0040.test.ts` (statement-breakpoint splitter +
 * `gen_random_uuid()` registration) and the node-postgres adapter wiring from
 * `lib/cms/prospecting/optout.test.ts`.
 *
 * 0040 is purely additive and references the PRE-existing `users`, `targets`,
 * and `outreach_drafts` tables; those are stood up here as minimal stubs so the
 * real migration applies verbatim and `prospecting_send_ledger.draft_id`'s FK to
 * `outreach_drafts.id` resolves.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 12: Send-cap increments are
 * exactly-once and independent
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

/**
 * Wrap a Drizzle handle so that any INSERT carrying `scopeKind === failScope`
 * rejects, while every other operation passes through to the real handle. This
 * simulates a transient DB failure isolated to ONE scope's increment, exercising
 * the independence half of the property (Req 7.6).
 */
function withFailingScope(db: Database, failScope: SendScopeKind): Database {
  const err = new Error(`injected ${failScope} scope failure`);
  const rejectingChain = {
    onConflictDoNothing: () => rejectingChain,
    onConflictDoUpdate: () => Promise.reject(err),
    returning: () => Promise.reject(err),
  };
  return new Proxy(db as object, {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return (table: unknown) => {
          const real = (target as Database).insert(table as never);
          return {
            values(vals: Record<string, unknown>) {
              if (vals && vals.scopeKind === failScope) {
                return rejectingChain;
              }
              return (real as { values: (v: unknown) => unknown }).values(vals);
            },
          };
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Database;
}

// Realistic, SQL-safe generators. scope_id / period_bucket are plain text; all
// values reach the DB through Drizzle's parameterized inserts.
const repIdArb = fc.uuid();
const clusterIdArb = fc.uuid();
const periodBucketArb = fc
  .integer({ min: 1, max: 28 })
  .map((d) => `2026-01-${String(d).padStart(2, "0")}`);

describe("Feature: agentic-prospecting-batch, Property 12: Send-cap increments are exactly-once and independent", () => {
  it("(a) advances each scope counter by exactly one no matter how many times recordSend is retried (Req 7.5)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        periodBucketArb,
        fc.integer({ min: 1, max: 8 }),
        async (repId, clusterId, periodBucket, retries) => {
          backup.restore();
          const draftId = seedDraft(mem);

          const results = [];
          for (let i = 0; i < retries; i++) {
            results.push(
              await recordSend(db, { draftId, repId, clusterId, periodBucket })
            );
          }

          // Exactly-once: each scope counter advanced by exactly one across all
          // retries for this single send.
          expect(await consumed(db, "rep", repId, periodBucket)).toBe(1);
          expect(await consumed(db, "cluster", clusterId, periodBucket)).toBe(1);

          // The first call applied both scopes; every retry no-ops (no double).
          expect(results[0].rep).toMatchObject({ applied: true });
          expect(results[0].cluster).toMatchObject({ applied: true });
          for (let i = 1; i < results.length; i++) {
            expect(results[i].rep).toMatchObject({ applied: false });
            expect(results[i].cluster).toMatchObject({ applied: false });
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(b) a forced single-scope failure still lets the OTHER scope apply exactly once, and the failed scope can still apply later (Req 7.6)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        periodBucketArb,
        fc.constantFrom<SendScopeKind>("rep", "cluster"),
        async (repId, clusterId, periodBucket, failScope) => {
          backup.restore();
          const draftId = seedDraft(mem);

          const otherScope: SendScopeKind =
            failScope === "rep" ? "cluster" : "rep";
          const scopeId = (s: SendScopeKind) =>
            s === "rep" ? repId : clusterId;

          // Record the send with the failing scope's increment forced to throw.
          const faulty = withFailingScope(db, failScope);
          const result = await recordSend(faulty, {
            draftId,
            repId,
            clusterId,
            periodBucket,
          });

          // The failing scope reports the error and did NOT apply; the other
          // scope applied independently.
          expect(result[failScope]).toMatchObject({ applied: false });
          expect("error" in result[failScope]).toBe(true);
          expect(result[otherScope]).toMatchObject({ applied: true });

          // Counters: failed scope untouched (0), surviving scope advanced once.
          expect(
            await consumed(db, failScope, scopeId(failScope), periodBucket)
          ).toBe(0);
          expect(
            await consumed(db, otherScope, scopeId(otherScope), periodBucket)
          ).toBe(1);

          // Retrying under the SAME fault must not double-count the survivor —
          // its ledger row already exists, so it stays at exactly one.
          await recordSend(faulty, { draftId, repId, clusterId, periodBucket });
          expect(
            await consumed(db, otherScope, scopeId(otherScope), periodBucket)
          ).toBe(1);

          // Once the fault clears, the previously-failed scope can apply — and
          // exactly once: it left no ledger row, so its first healthy write is
          // the authoritative +1.
          const healed = await recordSend(db, {
            draftId,
            repId,
            clusterId,
            periodBucket,
          });
          expect(healed[failScope]).toMatchObject({ applied: true });
          expect(healed[otherScope]).toMatchObject({ applied: false });
          expect(
            await consumed(db, failScope, scopeId(failScope), periodBucket)
          ).toBe(1);
          expect(
            await consumed(db, otherScope, scopeId(otherScope), periodBucket)
          ).toBe(1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
