import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, like } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { inboundLeads } from "../schema";
import type { Database } from "../db";
import { LEAD_SOURCES, type InboundLead } from "./inbound";
import {
  recordInbound,
  markParsed,
  markQueued,
  markFailed,
  type IntakeStatus,
} from "./intake";

/**
 * Property test for the Lead_Intake lifecycle (task 1.4, not optional).
 *
 * **Feature: lead-engine, Property 1: Every recorded Inbound_Lead sits in exactly one of {received, parsed, queued, failed}, is recorded received before parsing, and is never discarded.**
 *
 * **Validates: Requirements 3.1, 3.7**
 *
 * `Lead_Intake` is the P-NoDrop spine: `recordInbound` durably records an
 * Inbound_Lead with status `received` BEFORE any parsing is attempted (Req
 * 3.1), and the four writers (`recordInbound` + `markParsed`/`markQueued`/
 * `markFailed`) are the only code that touches `inbound_leads.status`. Across
 * any random interleaving of records and status transitions, three invariants
 * must hold for the durable ledger (Req 3.7):
 *
 *   (a) Single-status — every recorded row's `status` is exactly one of
 *       {received, parsed, queued, failed} at all times.
 *   (b) Received-before-parse — a freshly recorded NEW row reads back
 *       `received` (Req 3.1); no parse transition has touched it yet.
 *   (c) Never-discarded — the row count equals the number of distinct
 *       idempotency keys ever recorded and is monotonically non-decreasing;
 *       no transition ever deletes a row (Req 3.7).
 *
 * The intake writers run against a REAL Drizzle instance over an in-memory
 * Postgres (pg-mem). Migration `0036_inbound_leads.sql` is applied
 * statement-by-statement (exactly as the migration runner does) over minimal
 * stub `parties` (FK target) and `events` (publishEvent sink) tables — the
 * same approach as `intake.migration.test.ts`. The full migration chain cannot
 * be replayed under pg-mem because earlier migrations enable the `vector`
 * (pgvector) extension, so only what intake depends on is stood up.
 *
 * pg-mem ships neither `gen_random_uuid()` (DEFAULTs) nor `pg_notify` (issued
 * by `publishEvent` inside `recordInbound`), so both are registered as stubs —
 * the NOTIFY payload is irrelevant to the lifecycle invariants.
 */

// `recordInbound` hashes a present phone via computePhoneHash, which reads
// PHONE_HASH_SALT from the environment; set a stable test salt.
process.env.PHONE_HASH_SALT ??= "intake-lifecycle-test-salt";

// Iteration count is env-configurable for fast local runs; the spec mandates
// ≥100 for this non-optional P-NoDrop property, so CI sets PBT_NUM_RUNS=100.
const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 10);

const MIGRATION_FILE = "0036_inbound_leads.sql";

/** The canonical, allowed intake statuses (Req 3.7). */
const ALLOWED_STATUSES: ReadonlySet<IntakeStatus> = new Set([
  "received",
  "parsed",
  "queued",
  "failed",
]);

// Migration 0036 references `parties.id` via FK and `recordInbound` publishes a
// `lead.ingested` event, so stub both pre-existing tables in their minimal
// shape before applying 0036.
const PREREQUISITE_SQL = `
  CREATE TABLE "parties" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

/** Split a Drizzle migration into individual statements (0036 has no breakpoints). */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0036 applied and return a drizzle handle. */
function buildIntakeDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it. Mark impure
  // so each row gets a fresh uuid (otherwise the second insert collides on PK).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  // publishEvent issues `SELECT pg_notify(channel, id)`; pg-mem lacks it.
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects two options this drizzle version
  // sends on every query: `types.getTypeParser` (custom result parsers) and
  // `rowMode: "array"`. Pool and Client are the same MemPg instance and
  // `connect()` returns `this`, so patching `query` here also covers the
  // transaction path used by publishEvent. We strip both options and, when
  // drizzle asked for array-mode rows, convert pg-mem's object rows back to
  // positional arrays (in select order) so drizzle's row mapper stays happy.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
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
  };

  const db = drizzle(pool, { schema }) as unknown as Database;

  return { mem, db };
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

// A small idempotency-key pool so the operation stream exercises duplicate
// records (the dedupe / never-discarded path) as well as fresh ones.
const KEY_POOL_SIZE = 5;
const keyArb = fc
  .integer({ min: 0, max: KEY_POOL_SIZE - 1 })
  .map((i) => `idem-${i}`);

// Valid E.164 phone (+971 + 9 digits) so computePhoneHash's normalization never
// throws; absent on roughly half the leads.
const phoneArb = fc.option(
  fc.integer({ min: 500_000_000, max: 599_999_999 }).map((n) => `+971${n}`),
  { nil: undefined }
);

/** Safe jsonb key/value generators: pg-mem's JSON lexer rejects backslashes and
 * quotes inside jsonb string literals (real Postgres accepts them), so restrict
 * generated `rawPayload`/`attribution` content to an alphanumeric+space set.
 * The key is prefixed so it is always non-empty after sanitization. */
const safeKeyArb = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => `k${s.replace(/[^a-zA-Z0-9]/g, "")}`);
const safeValueArb = fc
  .string({ maxLength: 20 })
  .map((s) => s.replace(/[^a-zA-Z0-9 ]/g, ""));

/** Free-text generator sanitized to a charset pg-mem's param lexer accepts
 * (backslashes/quotes in a substituted param break its parser, even for text
 * columns; real Postgres accepts them). The lifecycle property is independent
 * of payload byte content, so this does not weaken the invariants under test. */
const safeFreeText = (max: number) =>
  fc.string({ maxLength: max }).map((s) => s.replace(/[^a-zA-Z0-9 ]/g, ""));

/** A generated canonical InboundLead (constructed to match the Zod-derived type). */
const leadArb: fc.Arbitrary<InboundLead> = fc.record({
  source: fc.constantFrom(...LEAD_SOURCES),
  capturedAt: fc.constant(new Date().toISOString()),
  name: fc.option(safeFreeText(40), { nil: undefined }),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  phone: phoneArb,
  content: safeFreeText(200),
  rawPayload: fc
    .dictionary(safeKeyArb, safeValueArb)
    // fc.dictionary can emit null-prototype objects; drizzle's internal value
    // check reads `.constructor`, so normalize to a plain-prototype object
    // (real adapter payloads are always plain objects).
    .map((o) => ({ ...o })),
  attribution: fc.option(
    fc.dictionary(safeKeyArb, safeValueArb).map((o) => ({ ...o })),
    { nil: undefined }
  ),
  idempotencyKey: keyArb,
}) as fc.Arbitrary<InboundLead>;

type Op =
  | { kind: "record"; lead: InboundLead }
  | { kind: "transition"; pick: number; to: "parsed" | "queued" | "failed" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("record" as const), lead: leadArb }),
  fc.record({
    kind: fc.constant("transition" as const),
    pick: fc.nat(),
    to: fc.constantFrom("parsed" as const, "queued" as const, "failed" as const),
  })
);

describe("Lead_Intake — Property 1: parsed-or-queued lifecycle (Req 3.1, 3.7)", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildIntakeDb());
  });

  it("keeps every recorded row in exactly one status, records 'received' before parsing, and never discards a row", async () => {
    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 16 }),
        async (ops) => {
          // Namespace idempotency keys per iteration so iterations share the
          // single migrated DB without interfering, while still exercising
          // duplicate records WITHIN an iteration.
          const ns = `it${iteration++}`;

          const recordedIds: string[] = [];
          const distinctKeys = new Set<string>();
          let prevCount = await rowCount(db, ns);

          for (const op of ops) {
            if (op.kind === "record") {
              const key = `${ns}:${op.lead.idempotencyKey}`;
              const lead: InboundLead = { ...op.lead, idempotencyKey: key };

              // Decide newness from the keys WE have recorded rather than the
              // returned `deduped` flag: pg-mem's `ON CONFLICT DO NOTHING ...
              // RETURNING` returns the existing row on conflict (real Postgres
              // returns nothing), so the flag is not faithful under the
              // in-memory engine. The durable row count is faithful, and that
              // is what the never-discarded invariant checks below.
              const isNew = !distinctKeys.has(key);

              const { id } = await recordInbound(db, lead);

              if (isNew) {
                // (b) Received-before-parse: a brand-new row, untouched by any
                // transition, must read back 'received' (Req 3.1).
                const status = await statusOf(db, id);
                expect(status).toBe("received");
                recordedIds.push(id);
                distinctKeys.add(key);
              }
              // A duplicate key acknowledges the existing row — no new row is
              // created (verified by the never-discarded count check below).
            } else if (recordedIds.length > 0) {
              const id = recordedIds[op.pick % recordedIds.length];
              if (op.to === "parsed") await markParsed(db, id);
              else if (op.to === "queued") await markQueued(db, id);
              else await markFailed(db, id, "synthetic failure");
            }

            // (a) Single-status — every row this iteration owns is in exactly
            // one allowed status.
            const statuses = await statusesFor(db, ns);
            for (const s of statuses) {
              expect(ALLOWED_STATUSES.has(s as IntakeStatus)).toBe(true);
            }

            // (c) Never-discarded — row count equals distinct keys recorded and
            // is monotonically non-decreasing (no transition deletes a row).
            const count = await rowCount(db, ns);
            expect(count).toBe(distinctKeys.size);
            expect(count).toBeGreaterThanOrEqual(prevCount);
            prevCount = count;
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Query helpers (scoped to this iteration's namespaced keys) ────────────────

async function statusOf(db: Database, id: string): Promise<string> {
  const [row] = await db
    .select({ status: inboundLeads.status })
    .from(inboundLeads)
    .where(eq(inboundLeads.id, id))
    .limit(1);
  return row.status;
}

async function statusesFor(db: Database, ns: string): Promise<string[]> {
  const rows = await db
    .select({ status: inboundLeads.status })
    .from(inboundLeads)
    .where(like(inboundLeads.idempotencyKey, `${ns}:%`));
  return rows.map((r) => r.status);
}

async function rowCount(db: Database, ns: string): Promise<number> {
  const rows = await db
    .select({ id: inboundLeads.id })
    .from(inboundLeads)
    .where(like(inboundLeads.idempotencyKey, `${ns}:%`));
  return rows.length;
}
