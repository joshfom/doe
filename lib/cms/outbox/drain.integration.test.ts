import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { sfOutbox } from "../schema";
import { enqueueOutbox, drainOnce } from "./index";
import type { Database } from "../db";
import { SfHttpError, type SalesforceAdapter } from "../tickets/crm/salesforce";

/**
 * Integration test for the Salesforce outbox drainer (task 3.4 / 4.2).
 *
 * Exercises `drainOnce` end-to-end against a REAL Drizzle instance backed by an
 * in-memory Postgres (pg-mem), with a FAKE `SalesforceAdapter` whose `requestJson`
 * transport the `drainOnce`-constructed `SalesforceObjectClient` (via the
 * Object_Router) drives. The fake counts its create (POST) calls. No real
 * Salesforce sandbox is involved.
 *
 *   1. Happy path (Req 8.4): enqueue → drain with a succeeding transport → row
 *      becomes `sent`, `sfId` is stored, exactly one Salesforce object is
 *      created, and `drainOnce` returns `{ sent: 1 }`.
 *
 *   2. Failure → dead (Req 8.5, 8.6): a fake transport that always rejects the
 *      write drives a row's `attempts` up by one on each eligible drain, leaving
 *      it `pending` with `attempts < 5`, then flipping it to `dead` (with an
 *      `outbox.dead` event and `{ dead: 1 }`) on the 5th attempt.
 *
 *   3. At-most-once — Property 1, drain side (Req 8.7): regardless of how many
 *      times `drainOnce` runs and how often the same `jobKey` is (idempotently)
 *      enqueued, the router produces at most one Salesforce record per
 *      `jobKey` — one create per flushed row, each with a distinct id.
 *
 * **Validates: Requirements 8.4, 8.5, 8.6, 8.7**
 *
 * The harness mirrors `lib/cms/realtime/events.property.test.ts`: migration 0029
 * is applied statement-by-statement over pg-mem; `gen_random_uuid()` and a no-op
 * `pg_notify()` are registered (pg-mem ships neither); and a thin
 * BEGIN/COMMIT/ROLLBACK transaction shim is layered over the single connection
 * because `drainOnce` calls `publishEvent`, which wraps its insert + NOTIFY in
 * `db.transaction` (unsupported by the pg-proxy driver out of the box).
 *
 * NOTE on backoff: a failed row stays `pending` but is only re-attempted once it
 * has waited out `backoffMs(attempts)` (2s, 4s, 8s, 16s) since its `updatedAt`.
 * To drive a row to 5 attempts across successive `drainOnce` calls without real
 * waits, we backdate the row's `updated_at` far into the past between drains so
 * it is immediately eligible again. This is a test-only fast-forward of the
 * backoff clock; production relies on the real ~2s drain cadence.
 */

const NUM_RUNS = 25;
const MAX_SEQUENCE = 10;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references (see migration test).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type Snapshot = Database;

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle (shaped like the production `Database`) bound to it. Mirrors
 * the events-bus harness so `drainOnce` → `publishEvent` runs its real SQL.
 */
function buildOutboxDb(): { db: Snapshot; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  // publishEvent issues SELECT pg_notify(...) — register a no-op so it resolves.
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => null,
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  const db = drizzle(executor as never, { schema }) as unknown as Database;

  // The proxy driver throws on .transaction(); provide a real one over the
  // single connection so publishEvent's atomic insert + NOTIFY runs.
  (db as unknown as { transaction: unknown }).transaction = async (
    fn: (tx: Database) => Promise<unknown>
  ) => {
    await executor("BEGIN", [], "execute");
    try {
      const result = await fn(db);
      await executor("COMMIT", [], "execute");
      return result;
    } catch (err) {
      await executor("ROLLBACK", [], "execute");
      throw err;
    }
  };

  return { db, mem };
}

// ── Fake Salesforce adapter ───────────────────────────────────────────────────

/**
 * A fake `SalesforceAdapter` exposing only the `requestJson` transport the
 * `SalesforceObjectClient` (driven by the Object_Router inside `drainOnce`)
 * actually calls. It records every create (POST) so we can count
 * records-per-row, and either succeeds (returning a synthetic create response)
 * or rejects the write with a terminal error, depending on `mode`.
 *
 * A `fail`-mode rejection is a terminal (non-transient) `SfHttpError` so the
 * object client's `withRetry` surfaces it immediately rather than sleeping
 * through the 1s/2s/4s backoff schedule on every drain.
 */
function makeFakeAdapter(mode: "succeed" | "fail") {
  const creates: Array<{ path: string; body: Record<string, unknown> }> = [];
  const createdIds: string[] = [];
  let seq = 0;

  const adapter = {
    name: "fake-salesforce",
    async requestJson<T>(
      method: string,
      path: string,
      body?: Record<string, unknown>
    ): Promise<T> {
      if (method === "POST") {
        creates.push({ path, body: body ?? {} });
        if (mode === "fail") {
          throw new SfHttpError("simulated Salesforce failure", 400, false);
        }
        seq += 1;
        const id = `sf-${seq}`;
        createdIds.push(id);
        return { id, success: true, errors: [] } as T;
      }
      if (method === "PATCH") {
        if (mode === "fail") {
          throw new SfHttpError("simulated Salesforce failure", 400, false);
        }
        return {} as T; // 204 No Content
      }
      throw new Error(`unexpected Salesforce ${method} ${path}`);
    },
  };

  return {
    adapter: adapter as unknown as SalesforceAdapter,
    creates,
    createdIds,
    /** How many Salesforce object creates (POSTs) were attempted. */
    get createCount() {
      return creates.length;
    },
  };
}

/** Backdate a row's updated_at far into the past so it skips its backoff window. */
async function backdate(db: Snapshot, jobKey: string): Promise<void> {
  await db
    .update(sfOutbox)
    .set({ updatedAt: new Date(0) })
    .where(eq(sfOutbox.jobKey, jobKey));
}

async function readRow(db: Snapshot, jobKey: string) {
  const rows = await db
    .select()
    .from(sfOutbox)
    .where(eq(sfOutbox.jobKey, jobKey))
    .limit(1);
  return rows[0];
}

// ── 1. Happy path ───────────────────────────────────────────────────────────

describe("drainOnce — happy path (Req 8.4)", () => {
  it("sends a pending row, stores sfId, calls the adapter once, returns { sent: 1 }", async () => {
    const { db } = buildOutboxDb();
    const fake = makeFakeAdapter("succeed");

    await enqueueOutbox(
      db,
      "lead_upsert",
      { subject: "New lead", name: "Ada" },
      "jk-happy"
    );

    const result = await drainOnce(db, fake.adapter);

    expect(result).toEqual({ sent: 1, dead: 0 });
    expect(fake.createCount).toBe(1);
    // A lead_upsert row routes to a Salesforce Lead (never a Case).
    expect(fake.creates[0].path).toContain("/Lead");

    const row = await readRow(db, "jk-happy");
    expect(row.status).toBe("sent");
    expect(row.sfId).toBe("sf-1");
    expect(row.lastError).toBeNull();

    // A second drain has nothing pending to do and never re-calls the transport.
    const again = await drainOnce(db, fake.adapter);
    expect(again).toEqual({ sent: 0, dead: 0 });
    expect(fake.createCount).toBe(1);
  });
});

// ── 2. Failure → dead at 5 attempts ───────────────────────────────────────────

describe("drainOnce — failure path to dead-letter (Req 8.5, 8.6)", () => {
  it("increments attempts on each eligible drain and flips to dead at the 5th", async () => {
    const { db } = buildOutboxDb();
    const fake = makeFakeAdapter("fail");

    await enqueueOutbox(db, "task", { subject: "log call" }, "jk-dead");

    // Attempts 1..4: row stays pending, attempts climbs, no dead yet.
    for (let expectedAttempts = 1; expectedAttempts <= 4; expectedAttempts++) {
      const result = await drainOnce(db, fake.adapter);
      expect(result).toEqual({ sent: 0, dead: 0 });

      const row = await readRow(db, "jk-dead");
      expect(row.attempts).toBe(expectedAttempts);
      expect(row.status).toBe("pending");
      expect(row.lastError).toBe("simulated Salesforce failure");

      // Fast-forward past the backoff window so the next drain re-attempts it.
      await backdate(db, "jk-dead");
    }

    // 5th attempt → dead, with an outbox.dead publish and { dead: 1 }.
    const result = await drainOnce(db, fake.adapter);
    expect(result).toEqual({ sent: 0, dead: 1 });

    const row = await readRow(db, "jk-dead");
    expect(row.attempts).toBe(5);
    expect(row.status).toBe("dead");

    // The transport was attempted once per drain — 5 times total.
    expect(fake.createCount).toBe(5);

    // A dead row is no longer pending, so further drains never touch it.
    await backdate(db, "jk-dead");
    const after = await drainOnce(db, fake.adapter);
    expect(after).toEqual({ sent: 0, dead: 0 });
    expect(fake.createCount).toBe(5);
  });

  it("respects backoff: a freshly-failed row is skipped on an immediate re-drain", async () => {
    const { db } = buildOutboxDb();
    const fake = makeFakeAdapter("fail");

    await enqueueOutbox(db, "task", { subject: "log call" }, "jk-backoff");

    // First drain attempts the row (attempts 0 is always eligible) → attempts 1.
    await drainOnce(db, fake.adapter);
    expect(fake.createCount).toBe(1);

    // Immediately drain again WITHOUT backdating: the row is inside its 2s
    // backoff window, so it is skipped and the transport is not re-called.
    const result = await drainOnce(db, fake.adapter);
    expect(result).toEqual({ sent: 0, dead: 0 });
    expect(fake.createCount).toBe(1);

    const row = await readRow(db, "jk-backoff");
    expect(row.attempts).toBe(1);
    expect(row.status).toBe("pending");
  });
});

// ── 3. At-most-once Salesforce record per jobKey (Property 1, drain side) ──────

describe("drainOnce — Property 1 (drain side): at most one SF record per jobKey (Req 8.7)", () => {
  it("never produces more than one create per jobKey across repeated enqueues and drains", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Interleaved operations over a SMALL pool of jobKeys: enqueues (often
        // duplicated — the idempotency case) and drains. Duplicate jobKeys and
        // repeated drains are exactly what could double-send if the drainer
        // weren't at-most-once.
        fc.array(
          fc.oneof(
            fc.record({
              op: fc.constant("enqueue" as const),
              jobKey: fc.constantFrom("jk-1", "jk-2", "jk-3"),
              kind: fc.constantFrom(
                "lead_upsert" as const,
                "task" as const,
                "event" as const
              ),
            }),
            fc.record({ op: fc.constant("drain" as const) })
          ),
          { minLength: 1, maxLength: MAX_SEQUENCE }
        ),
        async (operations) => {
          const { db } = buildOutboxDb();
          const fake = makeFakeAdapter("succeed");

          for (const operation of operations) {
            if (operation.op === "enqueue") {
              await enqueueOutbox(
                db,
                operation.kind,
                { subject: `for ${operation.jobKey}` },
                operation.jobKey
              );
            } else {
              await drainOnce(db, fake.adapter);
            }
          }

          // Drain once more to flush anything still pending.
          await drainOnce(db, fake.adapter);

          // Every persisted row is unique per jobKey and, once flushed, sent.
          const rows = await db
            .select({ jobKey: sfOutbox.jobKey, status: sfOutbox.status })
            .from(sfOutbox);
          const distinct = new Set(rows.map((r) => r.jobKey));
          expect(rows.length).toBe(distinct.size);

          for (const row of rows) {
            expect(row.status).toBe("sent");
          }

          // Core invariant (at most one SF record per jobKey): each flushed row
          // produced exactly one create, and every created id is distinct — so
          // no jobKey ever maps to two Salesforce records.
          expect(fake.createCount).toBe(rows.length);
          expect(new Set(fake.createdIds).size).toBe(fake.createCount);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
