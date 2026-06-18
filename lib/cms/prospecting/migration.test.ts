import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Unit test for the Prospecting domain migration (task 2.4).
 *
 * Applies the real `drizzle/0038_prospecting.sql` migration under an in-memory
 * Postgres (pg-mem) and asserts the schema foundations the design depends on:
 *   - the four prospecting tables exist (prospecting_briefs, targets,
 *     outreach_drafts, prospect_optouts) with their expected columns
 *   - status defaults: `targets.status = 'new'`, `outreach_drafts.status =
 *     'draft'`, `prospecting_briefs.status = 'draft'`
 *   - the brief/party/status indexes on `targets` exist
 *   - the unique constraints behave: a duplicate `outreach_drafts.job_key` is
 *     rejected, and a duplicate `(match_kind, match_value)` on
 *     `prospect_optouts` is rejected
 *
 * The 0038 migration carries FKs to `users`, `projects`, `ai_units`, and
 * `parties`; those tables are stood up as minimal stubs (id-only) so the real
 * migration applies verbatim and its FK references resolve. The cross-table
 * shapes themselves are owned by other migrations and out of scope here.
 *
 * Harness mirrors `lib/cms/schema.salesforce-lead-core.migration.test.ts` and
 * the pg-mem index introspection in `lib/cms/leads/intake.migration.test.ts`.
 *
 * Design reference: §Data Models (Prospecting domain); Requirements: 1.2, 7.3.
 */

const MIGRATION_FILE = "0038_prospecting.sql";

// Minimal id-only stubs for the tables 0038's FKs reference. These are the
// PRE-existing tables owned by earlier migrations; only their `id` PK matters
// for the FK targets here.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "ai_units" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

function buildMigratedDb(): IMemoryDb {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  // Mark impure so each row gets a fresh uuid rather than a cached single value.
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
  mem.public.none(sql);

  return mem;
}

/** Does a column exist on a table? (information_schema is supported by pg-mem.) */
function columnExists(mem: IMemoryDb, table: string, column: string): boolean {
  const rows = mem.public.many(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = '${table}' AND column_name = '${column}'`
  );
  return rows.length === 1;
}

/** A user id to satisfy prospecting_briefs.created_by (NOT NULL FK). */
function seedUser(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO users (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal Target and return its id. */
function seedTarget(mem: IMemoryDb): string {
  const [row] = mem.public.many(
    `INSERT INTO targets (target_type, source_provider, lawful_basis)
     VALUES ('person', 'apollo', 'legitimate_interest')
     RETURNING id`
  ) as Array<{ id: string }>;
  return row.id;
}

describe("Prospecting migration 0038 (schema foundations)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── tables exist ─────────────────────────────────────────────────────────────
  describe("tables", () => {
    const NEW_TABLES = [
      "prospecting_briefs",
      "targets",
      "outreach_drafts",
      "prospect_optouts",
    ];

    it.each(NEW_TABLES)('creates the "%s" table', (table) => {
      const rows = mem.public.many(
        `SELECT table_name FROM information_schema.tables`
      ) as Array<{ table_name: string }>;
      const names = new Set(rows.map((r) => r.table_name));
      expect(names.has(table)).toBe(true);
    });
  });

  // ── columns exist ────────────────────────────────────────────────────────────
  describe("columns", () => {
    const EXPECTED_COLUMNS: Array<[string, string]> = [
      // prospecting_briefs
      ["prospecting_briefs", "created_by"],
      ["prospecting_briefs", "project_id"],
      ["prospecting_briefs", "ai_unit_id"],
      ["prospecting_briefs", "spec"],
      ["prospecting_briefs", "buyer_hypothesis"],
      ["prospecting_briefs", "status"],
      // targets — provenance + privacy + promotion columns
      ["targets", "brief_id"],
      ["targets", "target_type"],
      ["targets", "email"],
      ["targets", "phone_hash"],
      ["targets", "raw_phone"],
      ["targets", "attributes"],
      ["targets", "source_provider"],
      ["targets", "lawful_basis"],
      ["targets", "status"],
      ["targets", "party_id"],
      // outreach_drafts — grounding + idempotency + approval columns
      ["outreach_drafts", "target_id"],
      ["outreach_drafts", "channel"],
      ["outreach_drafts", "language"],
      ["outreach_drafts", "body"],
      ["outreach_drafts", "grounding"],
      ["outreach_drafts", "status"],
      ["outreach_drafts", "approved_by"],
      ["outreach_drafts", "job_key"],
      // prospect_optouts — do-not-contact store
      ["prospect_optouts", "match_kind"],
      ["prospect_optouts", "match_value"],
      ["prospect_optouts", "reason"],
    ];

    it.each(EXPECTED_COLUMNS)('"%s" has the "%s" column', (table, column) => {
      expect(columnExists(mem, table, column)).toBe(true);
    });
  });

  // ── status defaults ──────────────────────────────────────────────────────────
  describe("status defaults", () => {
    it("targets.status defaults to 'new' (Req 1.2)", () => {
      const [row] = mem.public.many(
        `INSERT INTO targets (target_type, source_provider, lawful_basis)
         VALUES ('person', 'apollo', 'legitimate_interest')
         RETURNING status`
      ) as Array<{ status: string }>;
      expect(row.status).toBe("new");
    });

    it("outreach_drafts.status defaults to 'draft' (Req 7.3)", () => {
      const targetId = seedTarget(mem);
      const [row] = mem.public.many(
        `INSERT INTO outreach_drafts (target_id, channel, language, body, grounding)
         VALUES ('${targetId}', 'email', 'en', 'hello', '[]')
         RETURNING status`
      ) as Array<{ status: string }>;
      expect(row.status).toBe("draft");
    });

    it("prospecting_briefs.status defaults to 'draft'", () => {
      const userId = seedUser(mem);
      const [row] = mem.public.many(
        `INSERT INTO prospecting_briefs (created_by, spec)
         VALUES ('${userId}', '{}')
         RETURNING status`
      ) as Array<{ status: string }>;
      expect(row.status).toBe("draft");
    });
  });

  // ── indexes exist (best-effort introspection) ────────────────────────────────
  describe("indexes", () => {
    const EXPECTED_TARGET_INDEXES = [
      "targets_brief_idx",
      "targets_party_idx",
      "targets_status_idx",
    ];

    it.each(EXPECTED_TARGET_INDEXES)('targets has the "%s" index', (idx) => {
      const indices = mem.public
        .getTable("targets")
        .listIndices() as Array<{ name?: string }>;
      const names = new Set(indices.map((ix) => ix.name));
      expect(names.has(idx)).toBe(true);
    });

    it("outreach_drafts has the unique job_key index", () => {
      const indices = mem.public
        .getTable("outreach_drafts")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const jobKeyIx = indices.find(
        (ix) => ix.name === "outreach_drafts_job_key_ux"
      );
      expect(jobKeyIx).toBeDefined();
      expect(jobKeyIx?.unique).toBe(true);
    });

    it("prospect_optouts has the unique (match_kind, match_value) index", () => {
      const indices = mem.public
        .getTable("prospect_optouts")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const matchIx = indices.find(
        (ix) => ix.name === "prospect_optouts_match_ux"
      );
      expect(matchIx).toBeDefined();
      expect(matchIx?.unique).toBe(true);
    });
  });

  // ── unique constraints behave ─────────────────────────────────────────────────
  describe("unique constraints", () => {
    it("rejects a duplicate outreach_drafts.job_key (CC-Idem, Req 7.2/8.2)", () => {
      const targetId = seedTarget(mem);
      mem.public.none(
        `INSERT INTO outreach_drafts (target_id, channel, language, body, grounding, job_key)
         VALUES ('${targetId}', 'email', 'en', 'first', '[]', 'send:dup-1')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO outreach_drafts (target_id, channel, language, body, grounding, job_key)
           VALUES ('${targetId}', 'whatsapp', 'ar', 'second', '[]', 'send:dup-1')`
        )
      ).toThrow();
    });

    it("allows multiple outreach_drafts with a NULL job_key", () => {
      const targetId = seedTarget(mem);
      mem.public.none(
        `INSERT INTO outreach_drafts (target_id, channel, language, body, grounding)
         VALUES ('${targetId}', 'email', 'en', 'a', '[]')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO outreach_drafts (target_id, channel, language, body, grounding)
           VALUES ('${targetId}', 'email', 'en', 'b', '[]')`
        )
      ).not.toThrow();
    });

    it("rejects a duplicate (match_kind, match_value) opt-out", () => {
      mem.public.none(
        `INSERT INTO prospect_optouts (match_kind, match_value)
         VALUES ('email', 'dupe@example.com')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospect_optouts (match_kind, match_value)
           VALUES ('email', 'dupe@example.com')`
        )
      ).toThrow();
    });

    it("allows the same match_value under a different match_kind", () => {
      mem.public.none(
        `INSERT INTO prospect_optouts (match_kind, match_value)
         VALUES ('email', 'shared-value')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospect_optouts (match_kind, match_value)
           VALUES ('phone_hash', 'shared-value')`
        )
      ).not.toThrow();
    });
  });
});
