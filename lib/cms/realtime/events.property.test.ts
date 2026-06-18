import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../schema";
import { events } from "../schema";
import { publishEvent, type DoeEventType } from "./events";
import type { Database } from "../db";

/**
 * Property tests for the DOE SSE event bus (task 2.2).
 *
 *   Property 2 — Events are append-only: the `events` table length only grows,
 *     `at` is non-decreasing across inserts, and no previously-inserted row's
 *     id/type/payload/at mutates after subsequent publishes (Requirement 11.3).
 *
 *   Property 9 — Phone privacy: no raw phone number ever appears in any
 *     published `events` payload; safe call sites carry only a salted
 *     `phone_hash` (Requirement 14.5).
 *
 * **Validates: Requirements 11.3, 14.5**
 *
 * These run against a REAL Drizzle instance backed by an in-memory Postgres
 * (pg-mem), so `publishEvent` executes its actual transaction + NOTIFY SQL.
 * The migration is applied statement-by-statement exactly as the migration
 * runner does (mirroring schema.migration.test.ts). pg-mem ships neither
 * `gen_random_uuid()` nor `pg_notify()`, so both are registered (the latter as
 * a no-op) so `publishEvent`'s `SELECT pg_notify(...)` does not fail.
 */

// Reduced fast-check budget — these tests stand up a fresh in-memory DB per
// generated case, so we keep run counts and sequence sizes small for speed.
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

const DOE_EVENT_TYPES: DoeEventType[] = [
  "session.created",
  "call.connected",
  "call.ended",
  "call.processed",
  "turn.appended",
  "tool.called",
  "decision.made",
  "outbox.queued",
  "outbox.sent",
  "outbox.dead",
  "job.queued",
  "job.running",
  "job.done",
  "job.failed",
  "report.sent",
];

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
 * We use Drizzle's pg-proxy driver with a pg-mem-backed executor rather than
 * the node-postgres driver: the latter attaches `types.getTypeParser` and uses
 * array row-mode for `.returning()`, both of which pg-mem rejects. The proxy
 * driver lets us run Drizzle's generated SQL straight against pg-mem and shape
 * the results ourselves. `publishEvent` wraps its insert + NOTIFY in a
 * `db.transaction`, which the proxy driver does not implement, so we provide a
 * thin BEGIN/COMMIT/ROLLBACK transaction over the single in-memory connection.
 */
function buildEventsDb(): { db: Snapshot; mem: IMemoryDb } {
  const mem = newDb();

  // pg-mem ships neither of these — register them so the real SQL resolves.
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

/** Read every persisted event row, newest-or-not, as plain objects. */
async function readAllEvents(db: Snapshot) {
  return db
    .select({ id: events.id, type: events.type, payload: events.payload, at: events.at })
    .from(events);
}

function atMillis(at: unknown): number {
  return new Date(at as string | Date).getTime();
}

describe("publishEvent — Property 2: events are append-only (Req 11.3)", () => {
  it("table length only grows, `at` is non-decreasing, and prior rows never mutate", async () => {
    await fc.assert(
      fc.asyncProperty(
        // An arbitrary sequence of publishEvent calls.
        fc.array(
          fc.record({
            type: fc.constantFrom(...DOE_EVENT_TYPES),
            payload: fc.option(
              fc
                .record({
                  partyId: fc.uuid(),
                  note: fc.string({ maxLength: 24 }),
                  n: fc.integer({ min: 0, max: 1000 }),
                })
                // Real call sites always hand the bus plain JSON-serializable
                // payloads; the round-trip keeps the generator inside that
                // input space (and off exotic null-prototype objects).
                .map((r) => JSON.parse(JSON.stringify(r)) as Record<string, unknown>),
              { nil: null }
            ),
          }),
          { minLength: 1, maxLength: MAX_SEQUENCE }
        ),
        async (sequence) => {
          const { db } = buildEventsDb();

          // id -> committed { type, payload, at } captured right after insert.
          const committed = new Map<
            string,
            { type: string; payload: unknown; at: number }
          >();

          for (const e of sequence) {
            await publishEvent(db, { type: e.type, payload: e.payload });

            const rows = await readAllEvents(db);

            // Monotonic growth: exactly one new row per publish.
            expect(rows.length).toBe(committed.size + 1);

            const newRows = rows.filter((r) => !committed.has(r.id));
            expect(newRows).toHaveLength(1);
            const inserted = newRows[0];

            // `at` non-decreasing across inserts.
            if (committed.size > 0) {
              const prevMaxAt = Math.max(
                ...[...committed.values()].map((c) => c.at)
              );
              expect(atMillis(inserted.at)).toBeGreaterThanOrEqual(prevMaxAt);
            }

            // No previously-inserted row mutates outside reset.
            for (const row of rows) {
              const prior = committed.get(row.id);
              if (!prior) continue;
              expect(row.type).toBe(prior.type);
              expect(row.payload).toEqual(prior.payload);
              expect(atMillis(row.at)).toBe(prior.at);
            }

            committed.set(inserted.id, {
              type: inserted.type,
              payload: inserted.payload,
              at: atMillis(inserted.at),
            });
          }

          // Final length equals number of publishes — only grew, never shrank.
          const finalRows = await readAllEvents(db);
          expect(finalRows.length).toBe(sequence.length);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Phone privacy ─────────────────────────────────────────────────────────────

const TEST_PHONE_HASH_SALT = "doe-voice-test-salt";

/** Salted SHA-256 phone hash, as the safe call sites compute it (design §6). */
function phoneHash(e164: string): string {
  return createHash("sha256").update(`${TEST_PHONE_HASH_SALT}:${e164}`).digest("hex");
}

/**
 * Build a privacy-safe event payload the way a real call site does: it carries
 * a salted `phone_hash` and ordinary fields, but NEVER the raw phone number.
 */
function buildSafePayload(rawPhone: string, partyId: string, tier: string) {
  return {
    partyId,
    phone_hash: phoneHash(rawPhone),
    tier,
    known: true,
  };
}

describe("publishEvent — Property 9: phone privacy (Req 14.5)", () => {
  it("no raw phone appears in any persisted events payload (only the salted hash)", async () => {
    // E.164-ish generator, +971 default region, 7–9 trailing digits.
    const e164 = fc
      .tuple(
        fc.constantFrom("+971", "+1", "+44", "+966"),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 9 })
      )
      .map(([cc, digits]) => `${cc}${digits.join("")}`);

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            type: fc.constantFrom(...DOE_EVENT_TYPES),
            phone: e164,
            partyId: fc.uuid(),
            tier: fc.constantFrom("HOT", "WARM", "NURTURE"),
          }),
          { minLength: 1, maxLength: MAX_SEQUENCE }
        ),
        async (calls) => {
          const { db } = buildEventsDb();

          const rawPhones: string[] = [];
          for (const c of calls) {
            rawPhones.push(c.phone);
            await publishEvent(db, {
              type: c.type,
              payload: buildSafePayload(c.phone, c.partyId, c.tier),
            });
          }

          const rows = await readAllEvents(db);
          expect(rows.length).toBe(calls.length);

          for (const row of rows) {
            const serialized = JSON.stringify(row.payload);
            // No raw phone — from this or any other call — leaks into a payload.
            for (const raw of rawPhones) {
              expect(serialized).not.toContain(raw);
            }
            // Sanity: the safe payload actually carried the salted hash instead.
            const payload = row.payload as { phone_hash?: string } | null;
            expect(payload?.phone_hash).toMatch(/^[0-9a-f]{64}$/);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
