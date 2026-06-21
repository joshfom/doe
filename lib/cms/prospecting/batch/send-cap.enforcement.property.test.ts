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
  capExhausted,
  type SendScopeKind,
} from "./send-cap";

/**
 * Property 11 — Send-cap enforcement (Requirements 1.5, 7.2, 7.3).
 *
 * The cap-enforcement READS are `remainingBudget` and `capExhausted`. Every
 * gate in the feature — the Batch_Run loop that stops drafting (Req 7.3), the
 * approve / bulk-approve route that blocks a send that would exceed the cap
 * (Req 7.2), and the Batch_Run start guard (Req 1.5) — is expressed in terms of
 * these two reads: a send is *blocked with `cap_reached`* precisely when
 * `capExhausted` is true, and the remaining budget is whatever `remainingBudget`
 * reports. This property nails down that gating relationship:
 *
 *   (a) For a finite cap C and any consumed count, `capExhausted` becomes true
 *       *exactly when* `remaining <= 0` (i.e. `consumed >= cap`), and
 *       `remaining = max(0, cap - consumed)`.
 *   (b) Recording sends *up to* the cap leaves `remaining = 0` and
 *       `capExhausted = true`; a further send is then blocked (`cap_reached`)
 *       and performs no increment.
 *   (c) Below the cap, `capExhausted` is false and `remaining = cap - consumed`,
 *       so the send is allowed.
 *   (d) An unlimited cap (`null`) is never exhausted — neither when supplied
 *       explicitly nor when read from the persisted (absent) `cap` column.
 *
 * "A send that would push consumed over the cap is blocked and performs no
 * send" is modelled as a `capExhausted`-gated send: the guard is consulted
 * before recording, and when it reports exhaustion no `recordSend` runs, so the
 * consumed counter is unchanged — exactly the send/draft-time behaviour the
 * routes and the batch loop implement.
 *
 * The properties run against a REAL Drizzle handle backed by an in-memory
 * Postgres (pg-mem), applying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` migration so the genuine cap
 * counter SQL executes. The pg-mem harness is reused verbatim from the sibling
 * `send-cap.exactly-once.property.test.ts` (Property 12) for consistency: the
 * statement-breakpoint splitter, `gen_random_uuid()` registration, and the
 * `INSERT … ON CONFLICT DO NOTHING … RETURNING` fidelity wrapper.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 11: Send-cap enforcement
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// Minimal stubs for the PRE-existing tables 0040 references (mirrors the
// sibling exactly-once test). `outreach_drafts` is the FK target of
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
  // deviation would defeat the idempotency guard `recordSend` relies on, so we
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

/**
 * Drive a scope's consumed counter by recording `n` real, distinct sends — the
 * genuine increment path. Each `recordSend` advances BOTH the rep and cluster
 * counters by one, so after this the rep scope (`repId`) and cluster scope
 * (`clusterId`) each read `consumed = n`.
 */
async function recordSends(
  db: Database,
  mem: IMemoryDb,
  repId: string,
  clusterId: string,
  periodBucket: string,
  n: number
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const draftId = seedDraft(mem);
    await recordSend(db, { draftId, repId, clusterId, periodBucket });
  }
}

/** Read a scope's consumed counter (0 when no row exists yet). */
async function consumedOf(
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

// Realistic, SQL-safe generators. scope ids are uuids; all values reach the DB
// through Drizzle's parameterized inserts.
const repIdArb = fc.uuid();
const clusterIdArb = fc.uuid();
const periodBucketArb = fc
  .integer({ min: 1, max: 28 })
  .map((d) => `2026-01-${String(d).padStart(2, "0")}`);
const scopeKindArb = fc.constantFrom<SendScopeKind>("rep", "cluster");
// Finite caps and consumed counts span below / at / above the cap.
const capArb = fc.integer({ min: 1, max: 10 });
const consumedArb = fc.integer({ min: 0, max: 12 });

describe("Feature: agentic-prospecting-batch, Property 11: Send-cap enforcement", () => {
  it("(a) capExhausted is true exactly when remaining <= 0 (consumed >= cap), with remaining = max(0, cap - consumed) (Req 7.2, 7.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        periodBucketArb,
        scopeKindArb,
        capArb,
        consumedArb,
        async (repId, clusterId, periodBucket, scopeKind, cap, sends) => {
          backup.restore();
          await recordSends(db, mem, repId, clusterId, periodBucket, sends);

          const scopeId = scopeKind === "rep" ? repId : clusterId;
          const ref = { scopeKind, scopeId, periodBucket, cap };

          const reading = await remainingBudget(db, ref);
          const exhausted = await capExhausted(db, ref);

          // consumed reflects exactly the sends recorded for this scope.
          expect(reading.consumed).toBe(sends);
          expect(reading.cap).toBe(cap);
          // remaining is the cap minus consumed, floored at zero.
          expect(reading.remaining).toBe(Math.max(0, cap - sends));
          // exhausted iff no budget remains iff consumed has reached the cap.
          expect(exhausted).toBe(reading.remaining !== null && reading.remaining <= 0);
          expect(exhausted).toBe(sends >= cap);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(b) recording sends up to the cap exhausts it (remaining 0), and a further send is blocked with cap_reached and performs no send (Req 1.5, 7.2, 7.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        periodBucketArb,
        scopeKindArb,
        capArb,
        async (repId, clusterId, periodBucket, scopeKind, cap) => {
          backup.restore();
          // Fill the period exactly to the cap.
          await recordSends(db, mem, repId, clusterId, periodBucket, cap);

          const scopeId = scopeKind === "rep" ? repId : clusterId;
          const ref = { scopeKind, scopeId, periodBucket, cap };

          const reading = await remainingBudget(db, ref);
          expect(reading.consumed).toBe(cap);
          expect(reading.remaining).toBe(0);
          expect(await capExhausted(db, ref)).toBe(true);

          // Model a cap-gated send: consult the guard, and only send if budget
          // remains. The cap is exhausted, so the send is blocked.
          const before = await consumedOf(db, scopeKind, scopeId, periodBucket);
          let reason: string | null = null;
          if (await capExhausted(db, ref)) {
            reason = "cap_reached";
          } else {
            const draftId = seedDraft(mem);
            await recordSend(db, { draftId, repId, clusterId, periodBucket });
          }
          const after = await consumedOf(db, scopeKind, scopeId, periodBucket);

          // Blocked with cap_reached, and no send was performed (no increment).
          expect(reason).toBe("cap_reached");
          expect(after).toBe(before);
          expect(after).toBe(cap);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(c) below the cap, capExhausted is false, remaining = cap - consumed, and a cap-gated send is allowed (Req 7.2, 7.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        periodBucketArb,
        scopeKindArb,
        // Pick a cap strictly greater than the sends so we are always below it.
        fc.integer({ min: 0, max: 9 }).chain((sends) =>
          fc
            .integer({ min: sends + 1, max: sends + 10 })
            .map((cap) => ({ sends, cap }))
        ),
        async (repId, clusterId, periodBucket, scopeKind, { sends, cap }) => {
          backup.restore();
          await recordSends(db, mem, repId, clusterId, periodBucket, sends);

          const scopeId = scopeKind === "rep" ? repId : clusterId;
          const ref = { scopeKind, scopeId, periodBucket, cap };

          const reading = await remainingBudget(db, ref);
          expect(reading.consumed).toBe(sends);
          expect(reading.remaining).toBe(cap - sends);
          expect(reading.remaining).toBeGreaterThan(0);
          expect(await capExhausted(db, ref)).toBe(false);

          // A cap-gated send below the cap is allowed and advances consumed.
          let allowed = false;
          if (!(await capExhausted(db, ref))) {
            allowed = true;
            const draftId = seedDraft(mem);
            await recordSend(db, { draftId, repId, clusterId, periodBucket });
          }
          expect(allowed).toBe(true);
          expect(await consumedOf(db, scopeKind, scopeId, periodBucket)).toBe(
            sends + 1
          );
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(d) an unlimited cap (null) is never exhausted — supplied explicitly or read from the absent persisted cap column (Req 7.2, 7.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        repIdArb,
        clusterIdArb,
        periodBucketArb,
        scopeKindArb,
        consumedArb,
        async (repId, clusterId, periodBucket, scopeKind, sends) => {
          backup.restore();
          await recordSends(db, mem, repId, clusterId, periodBucket, sends);

          const scopeId = scopeKind === "rep" ? repId : clusterId;

          // Explicit null cap → unlimited.
          const explicit = await remainingBudget(db, {
            scopeKind,
            scopeId,
            periodBucket,
            cap: null,
          });
          expect(explicit.cap).toBeNull();
          expect(explicit.remaining).toBeNull();
          expect(
            await capExhausted(db, {
              scopeKind,
              scopeId,
              periodBucket,
              cap: null,
            })
          ).toBe(false);

          // No explicit cap → falls back to the persisted `cap` column, which
          // `recordSend` never sets, so it is null → unlimited.
          const persisted = await remainingBudget(db, {
            scopeKind,
            scopeId,
            periodBucket,
          });
          expect(persisted.cap).toBeNull();
          expect(persisted.remaining).toBeNull();
          expect(
            await capExhausted(db, { scopeKind, scopeId, periodBucket })
          ).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
