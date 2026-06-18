import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../schema";
import { sfOutbox } from "../schema";
import { enqueueOutbox, type OutboxKind } from "./index";
import type { Database } from "../db";

/**
 * Property test for the Salesforce outbox (task 3.2).
 *
 *   Property 1 — Outbox idempotency by jobKey: for an arbitrary sequence of
 *     `(jobKey, kind, payload)` enqueue calls, the `sf_outbox` table contains
 *     at most one row per distinct `jobKey`. Equivalently, grouping by
 *     `job_key` always yields a count of 1, and the number of distinct
 *     `jobKey`s equals the total row count. Repeated `enqueueOutbox` calls with
 *     the same `jobKey` return the SAME row id (Requirement 8.2).
 *
 * **Validates: Requirements 8.2**
 *
 * Runs against a REAL Drizzle instance backed by an in-memory Postgres
 * (pg-mem), so `enqueueOutbox` executes its actual
 * `INSERT ... ON CONFLICT (job_key) DO NOTHING ... RETURNING` SQL against the
 * unique `sf_outbox.job_key` constraint. The harness mirrors
 * `lib/cms/realtime/events.property.test.ts`: migration 0029 is applied
 * statement-by-statement and `gen_random_uuid()` is registered (pg-mem ships
 * neither). `enqueueOutbox` issues no transaction or `pg_notify`, but we mirror
 * the DB setup exactly.
 */

// Reduced fast-check budget — each generated case stands up a fresh in-memory
// DB, so keep run counts and sequence sizes small for speed.
const NUM_RUNS = 25;
const MAX_SEQUENCE = 12;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references (see migration test).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

const OUTBOX_KINDS: OutboxKind[] = ["lead_upsert", "task", "event"];

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
 * Drizzle handle (shaped like the production `Database`) bound to it.
 *
 * Uses Drizzle's pg-proxy driver with a pg-mem-backed executor (the node-postgres
 * driver attaches `types.getTypeParser` and array row-mode for `.returning()`,
 * both of which pg-mem rejects). The proxy driver runs Drizzle's generated SQL
 * straight against pg-mem and shapes the results ourselves.
 */
function buildOutboxDb(): { db: Snapshot; mem: IMemoryDb } {
  const mem = newDb();

  // pg-mem doesn't ship gen_random_uuid — register it so the real SQL resolves.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  // Single in-memory pg connection used by the proxy executor.
  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    // pg-proxy maps rows positionally when fields are present ("all"); raw
    // object rows are returned for "execute".
    return {
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  const db = drizzle(executor as never, { schema }) as unknown as Database;

  return { db, mem };
}

/** Read every persisted outbox row (id + jobKey) as plain objects. */
async function readAllOutbox(db: Snapshot) {
  return db
    .select({ id: sfOutbox.id, jobKey: sfOutbox.jobKey })
    .from(sfOutbox);
}

describe("enqueueOutbox — Property 1: outbox idempotency by jobKey (Req 8.2)", () => {
  it("keeps at most one row per jobKey and returns a stable id for repeats", async () => {
    await fc.assert(
      fc.asyncProperty(
        // An arbitrary sequence of enqueueOutbox calls. jobKeys are drawn from a
        // SMALL pool so duplicates/collisions are common — the case that
        // exercises ON CONFLICT (job_key) DO NOTHING.
        fc.array(
          fc.record({
            jobKey: fc.constantFrom(
              "jk-a",
              "jk-b",
              "jk-c",
              "jk-d"
            ),
            kind: fc.constantFrom(...OUTBOX_KINDS),
            payload: fc
              .record({
                subject: fc.string({ maxLength: 24 }),
                n: fc.integer({ min: 0, max: 1000 }),
              })
              // Real call sites always hand the outbox plain JSON-serializable
              // payloads; the round-trip keeps the generator in that input space.
              .map((r) => JSON.parse(JSON.stringify(r)) as Record<string, unknown>),
          }),
          { minLength: 1, maxLength: MAX_SEQUENCE }
        ),
        async (sequence) => {
          const { db } = buildOutboxDb();

          // jobKey -> id returned by the FIRST enqueue for that key.
          const idByJobKey = new Map<string, string>();

          for (const call of sequence) {
            const id = await enqueueOutbox(
              db,
              call.kind,
              call.payload,
              call.jobKey
            );

            const firstId = idByJobKey.get(call.jobKey);
            if (firstId === undefined) {
              idByJobKey.set(call.jobKey, id);
            } else {
              // Repeated enqueue with the same jobKey returns the SAME row id.
              expect(id).toBe(firstId);
            }
          }

          const rows = await readAllOutbox(db);
          const distinctJobKeys = new Set(rows.map((r) => r.jobKey));

          // At most one row per distinct jobKey: total rows == distinct jobKeys.
          expect(rows.length).toBe(distinctJobKeys.size);

          // Grouping by job_key always yields a count of exactly 1.
          const countByJobKey = new Map<string, number>();
          for (const r of rows) {
            countByJobKey.set(r.jobKey, (countByJobKey.get(r.jobKey) ?? 0) + 1);
          }
          for (const count of countByJobKey.values()) {
            expect(count).toBe(1);
          }

          // The rows present are exactly the distinct jobKeys we enqueued.
          expect(distinctJobKeys).toEqual(new Set(idByJobKey.keys()));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
