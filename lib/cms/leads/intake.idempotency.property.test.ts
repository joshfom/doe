import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "@/lib/cms/schema";
import { inboundLeads } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import { recordInbound } from "./intake";
import { LEAD_SOURCES, type InboundLead } from "./inbound";

/**
 * Property test for idempotent intake (task 1.5, not optional).
 *
 * **Feature: lead-engine, Property 2: Two records with the same idempotencyKey yield at most one inbound_leads row; the second is acknowledged against the first.**
 *
 * **Validates: Requirements 3.2, 3.3**
 *
 * `recordInbound` is idempotent by `idempotencyKey` (Req 3.2, 3.3): the durable
 * `inbound_leads` ledger carries a UNIQUE index on `idempotency_key`, and the
 * insert uses `ON CONFLICT (idempotency_key) DO NOTHING`. So for ANY sequence of
 * records sharing one key — even when their other fields differ — at most one
 * row may ever exist for that key: the FIRST call performs the insert and
 * returns `{ deduped: false }`; every later call is acknowledged against that
 * first row with `{ deduped: true }` and the SAME `id`.
 *
 * The intake helper runs against a REAL Drizzle instance backed by an in-memory
 * Postgres (pg-mem), applying migration `0036_inbound_leads.sql`
 * statement-by-statement exactly as the migration runner does — mirroring
 * `intake.migration.test.ts` and the dedupe property tests. `recordInbound`
 * publishes a `lead.ingested` event inside a transaction, so the genuine
 * `events` table is stood up too and `pg_notify` is stubbed (its payload is
 * irrelevant to this property — only the `inbound_leads` row count matters).
 *
 * The full migration chain cannot be replayed under pg-mem because earlier
 * migrations enable the `vector` (pgvector) extension, so we apply only 0036
 * over a minimal `parties` stub (its FK target) plus an `events` stub.
 */

// `recordInbound` hashes any supplied phone via `computePhoneHash`, which reads
// PHONE_HASH_SALT from the environment; set a stable test salt.
process.env.PHONE_HASH_SALT ??= "intake-idempotency-test-salt";

// Iteration count is env-configurable for fast local runs; the spec mandates
// ≥100 for this non-optional idempotent-intake property, so CI sets PBT_NUM_RUNS=100.
const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 10);

const MIGRATION_FILE = "0036_inbound_leads.sql";

// Migration 0036 references `parties` via FK and `recordInbound` writes to
// `events`; stand up both in their minimal shapes. `events` mirrors the real
// schema (id/type/payload/at) so the transactional publishEvent insert works.
const PREREQUISITE_SQL = `
  CREATE TABLE "parties" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) =>
      // 0036 carries no statement-breakpoint markers, so fall back to splitting
      // on the statement terminator after stripping line comments.
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up a fresh pg-mem with migration 0036 applied; return a Drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it. Mark impure
  // so every row gets a distinct uuid (a pure fn is cached to a single value).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  // publishEvent issues `SELECT pg_notify(channel, id)`; pg-mem lacks it. The
  // NOTIFY side effect is irrelevant to row-count idempotency, so stub it.
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
  // sends on every query: `types.getTypeParser` and `rowMode: "array"`. Pool
  // and Client are the same MemPg instance and `connect()` returns `this`, so
  // patching the one `query` here also covers the transaction path used by
  // publishEvent. We strip both options and, when drizzle asked for array-mode
  // rows, convert pg-mem's object rows back into positional arrays (in select
  // order) so drizzle's row mapper stays happy.
  //
  // We ALSO repair a pg-mem fidelity gap that this property depends on: real
  // Postgres returns NO rows from `INSERT … ON CONFLICT DO NOTHING … RETURNING`
  // when the row already existed (the insert did nothing), whereas pg-mem
  // returns the pre-existing row with rowCount 1. `recordInbound` distinguishes
  // a fresh insert from a dedup ack precisely by that empty-vs-nonempty
  // RETURNING result, so without this repair the harness — not the production
  // code — would mis-report every conflict as a fresh insert. We detect the
  // idiom, measure the table's row-count delta around the statement, and blank
  // the RETURNING result when no row was actually inserted (matching Postgres).
  const originalQuery = pool.query.bind(pool);

  const countRows = async (table: string): Promise<number> => {
    const r = (await originalQuery({
      text: `SELECT count(*)::int AS c FROM "${table}"`,
    })) as { rows: Array<{ c: number }> };
    return Number(r.rows[0]?.c ?? 0);
  };

  const insertOnConflictReturning =
    /insert\s+into\s+"(\w+)"[\s\S]*on\s+conflict[\s\S]*do\s+nothing[\s\S]*returning/i;

  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;

      const text = typeof cfg.text === "string" ? cfg.text : "";
      const conflictMatch = insertOnConflictReturning.exec(text);

      const shape = (r: { rows: Record<string, unknown>[] }) =>
        wantArray ? { ...r, rows: r.rows.map((row) => Object.values(row)) } : r;

      if (conflictMatch) {
        // Emulate Postgres RETURNING-empty-on-conflict via a row-count delta.
        const table = conflictMatch[1];
        return (async () => {
          const before = await countRows(table);
          const result = (await originalQuery(clean, values)) as {
            rows: Record<string, unknown>[];
            rowCount?: number;
          };
          const after = await countRows(table);
          const inserted = after > before;
          const repaired = inserted
            ? result
            : { ...result, rows: [], rowCount: 0 };
          return shape(repaired);
        })();
      }

      const result = originalQuery(clean, values, cb);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          shape
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;

  return { mem, db };
}

// ── Generators ────────────────────────────────────────────────────────────────

// A phone that `normalizePhoneToE164` accepts cleanly (UAE local mobile form).
const phoneArb = fc.option(
  fc
    .integer({ min: 0, max: 9_999_999 })
    .map((n) => `+9715${String(n).padStart(7, "0")}`),
  { nil: undefined }
);

// A safe key generator: fast-check's `fc.dictionary` will otherwise emit keys
// like `__proto__`/`constructor`, producing null-prototype objects that break
// drizzle's `.values()` entity check. Real source payloads never carry those.
// We also constrain to a simple alphabet: these objects are persisted as
// `jsonb`, and pg-mem's JSON literal parser rejects backslash escapes that real
// Postgres accepts — UTM/attribution data is plain strings in practice anyway.
const SAFE_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.".split("");

const safeStr = (maxLength: number) =>
  fc
    .array(fc.constantFrom(...SAFE_ALPHABET), { maxLength })
    .map((a) => a.join(""));

const safeKey = safeStr(12).filter((k) => k.length >= 1);

const plainObjectArb = fc
  .dictionary(safeKey, safeStr(40))
  .map((d) => ({ ...d }));

// One InboundLead variant. `idempotencyKey` is injected by the caller so a set
// of variants can deliberately SHARE a key while differing in every other field.
function variantArb(idempotencyKey: string): fc.Arbitrary<InboundLead> {
  return fc.record({
    source: fc.constantFrom(...LEAD_SOURCES),
    capturedAt: fc
      .date({
        min: new Date("2020-01-01T00:00:00Z"),
        max: new Date("2030-01-01T00:00:00Z"),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString()),
    name: fc.option(fc.string({ maxLength: 80 }), { nil: undefined }),
    email: fc.option(
      fc.emailAddress().filter((e) => e.length <= 254),
      { nil: undefined }
    ),
    phone: phoneArb,
    content: fc.string({ maxLength: 200 }),
    rawPayload: plainObjectArb,
    attribution: fc.option(plainObjectArb, { nil: undefined }),
    idempotencyKey: fc.constant(idempotencyKey),
  });
}

// A full generated case: a shared key body plus 2..5 InboundLead variants that
// all carry that same idempotencyKey but differ in their other fields. `chain`
// keeps shrinking well-behaved (the variants stay consistent with the key).
const caseArb = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((s) => s.trim().length > 0)
  .chain((keyBody) =>
    fc.record({
      keyBody: fc.constant(keyBody),
      variants: fc.array(variantArb(keyBody), { minLength: 2, maxLength: 5 }),
    })
  );

describe("Lead_Intake — Property 2: idempotent intake by idempotencyKey (Req 3.2, 3.3)", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildDb());
  });

  it("collapses any number of same-key records to one row; later calls ack the first", async () => {
    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(caseArb, async ({ keyBody, variants }) => {
        // Namespace the key per iteration so the single shared DB never
        // cross-contaminates keys between generated cases.
        const key = `it${iteration++}:${keyBody}`.slice(0, 255);
        const records = variants.map((v) => ({ ...v, idempotencyKey: key }));

        // First record performs the insert.
        const first = await recordInbound(db, records[0]);
        expect(first.deduped).toBe(false);

        // Every later record — even with differing fields — is acknowledged
        // against the first row with the SAME id and deduped: true (Req 3.3).
        for (let i = 1; i < records.length; i++) {
          const ack = await recordInbound(db, records[i]);
          expect(ack.deduped).toBe(true);
          expect(ack.id).toBe(first.id);
        }

        // At most one inbound_leads row exists for that key (Req 3.2, 3.3).
        const rows = await db
          .select({ id: inboundLeads.id })
          .from(inboundLeads)
          .where(eq(inboundLeads.idempotencyKey, key));
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(first.id);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
