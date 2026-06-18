import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Unit test for the Lead Engine (S3) inbound_leads migration (task 1.6).
 *
 * Applies the Drizzle migration `drizzle/0036_inbound_leads.sql` under an
 * in-memory Postgres (pg-mem) and asserts:
 *   - the `inbound_leads` table exists (Requirement 3.1),
 *   - its expected columns exist with the correct shape (Requirement 3.1, 3.7),
 *   - the source/status enum constraints accept the canonical values,
 *   - the durable defaults route a fresh row to the start of the parsed-or-queued
 *     state machine: `status` defaults to 'received' and `attempts` defaults to 0
 *     (Requirement 3.1, 3.7),
 *   - the idempotency unique index is enforced (Requirement 3.3 — at most one row
 *     per idempotency key), and the status / party_id indexes exist.
 *
 * The full migration chain (0000–0035) cannot be replayed under pg-mem because
 * earlier migrations enable the `vector` (pgvector) extension, which pg-mem does
 * not support. Task 1.6 only concerns what migration 0036 introduces, so we
 * stand up a minimal stub for the `parties` table it references via foreign key,
 * then apply migration 0036 exactly as the production migration runner does.
 *
 * Harness mirrors `lib/cms/schema.agentic-foundation.migration.test.ts`.
 *
 * Design reference: §Data Models (inbound_leads); Requirements: 3.1, 3.7
 */

const MIGRATION_FILE = "0036_inbound_leads.sql";

// `inbound_leads.party_id` references `parties.id`; stand up the minimal
// pre-existing `parties` table the FK constraint depends on.
const PREREQUISITE_SQL = `
  CREATE TABLE "parties" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** Expected columns on the inbound_leads table. */
const EXPECTED_COLUMNS = [
  "id",
  "source",
  "idempotency_key",
  "status",
  "name",
  "email",
  "phone_hash",
  "raw_phone",
  "content",
  "raw_payload",
  "attribution",
  "structured",
  "party_id",
  "attempts",
  "last_error",
  "created_at",
  "updated_at",
] as const;

/** Indexes migration 0036 must create. */
const EXPECTED_INDEXES = [
  "inbound_leads_idempotency_key_ux",
  "inbound_leads_status_idx",
  "inbound_leads_party_id_idx",
] as const;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) =>
      // 0036 carries no statement-breakpoint markers, so fall back to
      // splitting on the statement terminator after stripping line comments.
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildMigratedDb(): IMemoryDb {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  // Stand up the pre-existing `parties` table that migration 0036 references.
  mem.public.none(PREREQUISITE_SQL);

  // Apply the real migration, statement-by-statement.
  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  return mem;
}

describe("Lead Engine migration 0036 (inbound_leads intake ledger)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── table exists ────────────────────────────────────────────────────────────
  describe("inbound_leads table exists", () => {
    it("creates the inbound_leads table", () => {
      const rows = mem.public.many(
        `SELECT table_name FROM information_schema.tables`
      ) as Array<{ table_name: string }>;
      const names = new Set(rows.map((r) => r.table_name));
      expect(names.has("inbound_leads")).toBe(true);
    });
  });

  // ── columns exist ────────────────────────────────────────────────────────────
  describe("inbound_leads has its expected columns", () => {
    it.each(EXPECTED_COLUMNS)('has the "%s" column', (column) => {
      const rows = mem.public.many(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'inbound_leads' AND column_name = '${column}'`
      );
      expect(rows).toHaveLength(1);
    });
  });

  // ── indexes exist ────────────────────────────────────────────────────────────
  // pg-mem does not expose `pg_catalog.pg_indexes`, so we introspect the table's
  // index definitions directly (the same set the migration's CREATE INDEX
  // statements produce).
  describe("inbound_leads has its expected indexes", () => {
    it.each(EXPECTED_INDEXES)('creates the "%s" index', (indexName) => {
      const indices = mem.public
        .getTable("inbound_leads")
        .listIndices() as Array<{ name?: string }>;
      const names = new Set(indices.map((ix) => ix.name));
      expect(names.has(indexName)).toBe(true);
    });

    it("the idempotency_key index is unique", () => {
      const indices = mem.public
        .getTable("inbound_leads")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const idem = indices.find(
        (ix) => ix.name === "inbound_leads_idempotency_key_ux"
      );
      expect(idem?.unique).toBe(true);
    });
  });

  // ── Requirement 3.1 / 3.7 — durable defaults start the state machine ─────────
  describe("Requirement 3.1, 3.7 — defaults start the parsed-or-queued state machine", () => {
    it("status defaults to 'received' and attempts defaults to 0", () => {
      const [row] = mem.public.many(
        `INSERT INTO inbound_leads (source, idempotency_key)
         VALUES ('web_form', 'idem-defaults-1')
         RETURNING status, attempts, content`
      ) as Array<{ status: string; attempts: number; content: string }>;

      expect(row.status).toBe("received");
      expect(Number(row.attempts)).toBe(0);
      // content is NOT NULL DEFAULT '' so the row is always durable
      expect(row.content).toBe("");
    });

    it("accepts each canonical source value", () => {
      for (const source of [
        "web_form",
        "email",
        "whatsapp",
        "meta_lead_ads",
        "portal",
      ]) {
        expect(() =>
          mem.public.none(
            `INSERT INTO inbound_leads (source, idempotency_key)
             VALUES ('${source}', 'idem-src-${source}')`
          )
        ).not.toThrow();
      }
    });

    it("accepts each canonical status value", () => {
      for (const status of ["received", "parsed", "queued", "failed"]) {
        expect(() =>
          mem.public.none(
            `INSERT INTO inbound_leads (source, idempotency_key, status)
             VALUES ('email', 'idem-status-${status}', '${status}')`
          )
        ).not.toThrow();
      }
    });
  });

  // ── Requirement 3.3 — idempotency key is unique (at most one row per key) ─────
  describe("Requirement 3.3 — idempotency_key is unique", () => {
    it("rejects a second row with the same idempotency_key", () => {
      mem.public.none(
        `INSERT INTO inbound_leads (source, idempotency_key)
         VALUES ('portal', 'idem-dup-key')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO inbound_leads (source, idempotency_key)
           VALUES ('portal', 'idem-dup-key')`
        )
      ).toThrow();
    });
  });
});
