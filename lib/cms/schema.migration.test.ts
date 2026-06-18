import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Unit test for the DOE Voice Surface schema migration (task 1.3).
 *
 * Applies the Drizzle migration `drizzle/0029_demonic_mandrill.sql` under an
 * in-memory Postgres (pg-mem) and asserts:
 *   - the genuinely new tables exist (Requirement 11.2),
 *   - the new columns added to the existing ai_* tables exist (Requirement 11.1/11.2),
 *   - demo-scoped tables default their `demo` flag to false (Requirement 11.4).
 *
 * The full migration chain (0000–0028) cannot be replayed under pg-mem because
 * migration 0008 enables the `vector` (pgvector) extension, which pg-mem does
 * not support. Task 1.3 only concerns what migration 0029 introduces, so we
 * stand up minimal stubs for the pre-existing tables it ALTERs / references,
 * then apply migration 0029 statement-by-statement exactly as the production
 * migration runner (`scripts/migrate-direct.ts`) does.
 *
 * Design reference: §9.3; Requirements: 11.2, 11.4
 */

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Tables that pre-exist before migration 0029 runs. Migration 0029 either
// ALTERs them (ai_appointments/ai_conversations/ai_messages) or references them
// via foreign keys (ai_clients/ai_tenants). Only the columns needed to satisfy
// those operations are stubbed here.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** The new tables migration 0029 must create (Requirement 11.2). */
const NEW_TABLES = [
  "parties",
  "party_identities",
  "leads_mirror",
  "reps",
  "viewing_slots",
  "events",
  "sf_outbox",
  "jobs",
  "report_jobs",
] as const;

/** New columns added to existing tables (Requirement 11.1/11.2). */
const NEW_COLUMNS: Record<string, string[]> = {
  ai_conversations: ["sentiment", "summary", "party_id"],
  ai_messages: ["t_ms", "latency_ms"],
  ai_appointments: ["rep_id", "slot_id", "sf_event_id", "project"],
};

/** Demo-scoped tables that must default `demo` to false (Requirement 11.4). */
const DEMO_SCOPED_TABLES = [
  "parties",
  "leads_mirror",
  "reps",
  "viewing_slots",
] as const;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
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
  });

  // Stand up the pre-existing tables that migration 0029 depends on.
  mem.public.none(PREREQUISITE_SQL);

  // Apply the real migration, statement-by-statement.
  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  return mem;
}

describe("DOE Voice Surface migration 0029 (schema foundations)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── Requirement 11.2: new tables exist ─────────────────────────────────────
  describe("Requirement 11.2 — new tables exist", () => {
    it.each(NEW_TABLES)('creates the "%s" table', (table) => {
      const rows = mem.public.many(
        `SELECT table_name FROM information_schema.tables`
      ) as Array<{ table_name: string }>;
      const names = new Set(rows.map((r) => r.table_name));
      expect(names.has(table)).toBe(true);
    });
  });

  // ── Requirement 11.1/11.2: new columns on existing tables ──────────────────
  describe("Requirement 11.2 — new columns on existing ai_* tables", () => {
    for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
      for (const column of columns) {
        it(`adds "${column}" to "${table}"`, () => {
          const rows = mem.public.many(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = '${table}' AND column_name = '${column}'`
          );
          expect(rows).toHaveLength(1);
        });
      }
    }
  });

  // ── Requirement 11.2: key indexes / constraints exist ──────────────────────
  // The (kind, value) index on party_identities and the (project, starts_at)
  // index on viewing_slots are exercised implicitly: their CREATE INDEX
  // statements execute during buildMigratedDb(); a parse/exec failure there
  // would abort the whole suite. We assert the unique constraints behaviourally.
  it("enforces a unique job_key on sf_outbox", () => {
    mem.public.none(
      `INSERT INTO sf_outbox (kind, job_key, payload) VALUES ('task', 'dup-key', '{}'::jsonb)`
    );
    expect(() =>
      mem.public.none(
        `INSERT INTO sf_outbox (kind, job_key, payload) VALUES ('task', 'dup-key', '{}'::jsonb)`
      )
    ).toThrow();
  });

  // ── Requirement 11.4: demo defaults to false ───────────────────────────────
  describe("Requirement 11.4 — demo-scoped tables default `demo` to false", () => {
    it("every demo-scoped table has a `demo` column", () => {
      for (const table of DEMO_SCOPED_TABLES) {
        const rows = mem.public.many(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = '${table}' AND column_name = 'demo'`
        );
        expect(rows, `${table}.demo column`).toHaveLength(1);
      }
    });

    it("parties.demo defaults to false", () => {
      const [row] = mem.public.many(
        `INSERT INTO parties (name) VALUES ('Test Party') RETURNING id, demo`
      ) as Array<{ id: string; demo: boolean }>;
      expect(row.demo).toBe(false);
    });

    it("reps.demo defaults to false", () => {
      const [row] = mem.public.many(
        `INSERT INTO reps (name) VALUES ('Test Rep') RETURNING demo`
      ) as Array<{ demo: boolean }>;
      expect(row.demo).toBe(false);
    });

    it("viewing_slots.demo defaults to false", () => {
      const [row] = mem.public.many(
        `INSERT INTO viewing_slots (project, starts_at) VALUES ('Marina', now()) RETURNING demo`
      ) as Array<{ demo: boolean }>;
      expect(row.demo).toBe(false);
    });

    it("leads_mirror.demo defaults to false", () => {
      const partyId = randomUUID();
      mem.public.none(
        `INSERT INTO parties (id, name) VALUES ('${partyId}', 'Mirror Party')`
      );
      const [row] = mem.public.many(
        `INSERT INTO leads_mirror (party_id) VALUES ('${partyId}') RETURNING demo`
      ) as Array<{ demo: boolean }>;
      expect(row.demo).toBe(false);
    });
  });
});
