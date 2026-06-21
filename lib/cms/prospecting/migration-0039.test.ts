import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Unit test for the prospecting increment migration (task 10.2).
 *
 * Applies the real `drizzle/0039_project_clusters.sql` migration under an
 * in-memory Postgres (pg-mem) and asserts the additive schema the increment
 * depends on:
 *   - the NEW `project_clusters` table with its columns, the unique
 *     `(project_id, slug)` index, and the `(project_id)` index
 *   - the NEW nullable `ai_units.cluster_id` FK column + its index
 *   - the NEW `location_resolutions` cache table with its columns and the
 *     unique `(source, area_name_normalized)` index
 *   - the NEW nullable `market_price_index` columns `roi_pct`, `volume`,
 *     `trend`
 *
 * 0039 is purely additive and references `projects` (FK target),
 * `ai_units` (ADD COLUMN), and `market_price_index` (ADD COLUMN). Those
 * PRE-existing tables (owned by earlier migrations 0037/0038 and the base
 * schema) are stood up as minimal stubs so the real migration applies verbatim
 * and its references resolve. The cross-table shapes themselves are owned by
 * the earlier migrations and out of scope here.
 *
 * Harness mirrors the sibling migration tests:
 *   - the `--> statement-breakpoint` splitter + verbatim apply from
 *     `lib/cms/prospecting/migration.test.ts` (0038), and
 *   - the `market_price_index` staging DDL from `lib/cms/market/ingest.test.ts`
 *     (0037).
 *
 * Design reference: §1 (own hierarchy / DDL sketch), §3 (location cache +
 * price-index extension), §4. Requirements: 13.1.
 */

const MIGRATION_FILE = "0039_project_clusters.sql";

// Minimal stubs for the PRE-existing tables 0039 references. `projects` is the
// FK target of `project_clusters.project_id`; `ai_units` receives the new
// `cluster_id` column; `market_price_index` receives the new trend columns.
// `market_price_index` mirrors the relevant subset of drizzle/0037 so the
// ALTERs land on a realistic table.
const PREREQUISITE_SQL = `
  CREATE TABLE "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "ai_units" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "cluster" text
  );
  CREATE TABLE "market_price_index" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "area_name" text NOT NULL,
    "segment" text,
    "period" text NOT NULL,
    "index_value" numeric,
    "avg_price_per_sqft" numeric,
    "yoy_pct" numeric,
    "source" text NOT NULL,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
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

  // Drizzle separates statements with the `--> statement-breakpoint` marker;
  // apply each statement in order (mirrors the sibling migration harness).
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }

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

/** Insert a minimal project and return its id. */
function seedProject(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO projects (id) VALUES ('${id}')`);
  return id;
}

describe("Prospecting increment migration 0039 (additive schema)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── tables exist ─────────────────────────────────────────────────────────────
  describe("tables", () => {
    const NEW_TABLES = ["project_clusters", "location_resolutions"];

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
      // project_clusters — own hierarchy cluster record
      ["project_clusters", "project_id"],
      ["project_clusters", "name"],
      ["project_clusters", "name_ar"],
      ["project_clusters", "slug"],
      ["project_clusters", "segment"],
      ["project_clusters", "unit_types"],
      ["project_clusters", "bedrooms_min"],
      ["project_clusters", "bedrooms_max"],
      ["project_clusters", "price_min_aed"],
      ["project_clusters", "price_max_aed"],
      ["project_clusters", "avg_price_per_sqft"],
      ["project_clusters", "handover_date"],
      ["project_clusters", "total_units"],
      // ai_units — new nullable cluster_id FK (legacy free-text cluster retained)
      ["ai_units", "cluster_id"],
      ["ai_units", "cluster"],
      // market_price_index — Area_Trend extension columns
      ["market_price_index", "roi_pct"],
      ["market_price_index", "volume"],
      ["market_price_index", "trend"],
      // location_resolutions — provider location_id cache
      ["location_resolutions", "source"],
      ["location_resolutions", "area_name_normalized"],
      ["location_resolutions", "location_id"],
      ["location_resolutions", "display_name"],
      ["location_resolutions", "as_of"],
    ];

    it.each(EXPECTED_COLUMNS)('"%s" has the "%s" column', (table, column) => {
      expect(columnExists(mem, table, column)).toBe(true);
    });
  });

  // ── ai_units.cluster_id is nullable ──────────────────────────────────────────
  describe("ai_units.cluster_id", () => {
    it("allows inserting an ai_unit with a NULL cluster_id (nullable FK, Req 13.1)", () => {
      const id = randomUUID();
      expect(() =>
        mem.public.none(`INSERT INTO ai_units (id) VALUES ('${id}')`)
      ).not.toThrow();

      const [row] = mem.public.many(
        `SELECT cluster_id FROM ai_units WHERE id = '${id}'`
      ) as Array<{ cluster_id: string | null }>;
      expect(row.cluster_id).toBeNull();
    });
  });

  // ── indexes exist (best-effort introspection) ────────────────────────────────
  describe("indexes", () => {
    it("project_clusters has the unique (project_id, slug) index", () => {
      const indices = mem.public
        .getTable("project_clusters")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const slugIx = indices.find(
        (ix) => ix.name === "project_clusters_project_slug_ux"
      );
      expect(slugIx).toBeDefined();
      expect(slugIx?.unique).toBe(true);
    });

    it("project_clusters has the (project_id) index", () => {
      const indices = mem.public
        .getTable("project_clusters")
        .listIndices() as Array<{ name?: string }>;
      const names = new Set(indices.map((ix) => ix.name));
      expect(names.has("project_clusters_project_idx")).toBe(true);
    });

    it("ai_units has the cluster_id index", () => {
      const indices = mem.public
        .getTable("ai_units")
        .listIndices() as Array<{ name?: string }>;
      const names = new Set(indices.map((ix) => ix.name));
      expect(names.has("ai_units_cluster_id_idx")).toBe(true);
    });

    it("location_resolutions has the unique (source, area_name_normalized) index", () => {
      const indices = mem.public
        .getTable("location_resolutions")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const keyIx = indices.find(
        (ix) => ix.name === "location_resolutions_key_ux"
      );
      expect(keyIx).toBeDefined();
      expect(keyIx?.unique).toBe(true);
    });
  });

  // ── unique constraints behave ─────────────────────────────────────────────────
  describe("unique constraints", () => {
    it("rejects a duplicate (project_id, slug) cluster (Property 11 backfill key)", () => {
      const projectId = seedProject(mem);
      mem.public.none(
        `INSERT INTO project_clusters (project_id, name, slug)
         VALUES ('${projectId}', 'Views 3', 'views-3')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO project_clusters (project_id, name, slug)
           VALUES ('${projectId}', 'Views 3 (dup)', 'views-3')`
        )
      ).toThrow();
    });

    it("allows the same slug under a different project (index is composite)", () => {
      const projectA = seedProject(mem);
      const projectB = seedProject(mem);
      mem.public.none(
        `INSERT INTO project_clusters (project_id, name, slug)
         VALUES ('${projectA}', 'Shared', 'shared-slug')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO project_clusters (project_id, name, slug)
           VALUES ('${projectB}', 'Shared', 'shared-slug')`
        )
      ).not.toThrow();
    });

    it("rejects a duplicate (source, area_name_normalized) location resolution", () => {
      mem.public.none(
        `INSERT INTO location_resolutions (source, area_name_normalized, location_id)
         VALUES ('property_finder_reseller', 'dubai marina', 'loc-1')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO location_resolutions (source, area_name_normalized, location_id)
           VALUES ('property_finder_reseller', 'dubai marina', 'loc-2')`
        )
      ).toThrow();
    });

    it("allows the same area under a different source (key is composite)", () => {
      mem.public.none(
        `INSERT INTO location_resolutions (source, area_name_normalized, location_id)
         VALUES ('property_finder_reseller', 'palm jumeirah', 'pf-1')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO location_resolutions (source, area_name_normalized, location_id)
           VALUES ('dld_official', 'palm jumeirah', 'dld-1')`
        )
      ).not.toThrow();
    });
  });
});
