import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../../schema";
import type { Database } from "../../db";
import { aiUnits, projectClusters } from "../../schema";
import {
  backfillProjectClusters,
  normalizeClusterSlug,
} from "./backfill-clusters";

/**
 * Property test for the Project_Cluster backfill seed (task 10.4).
 *
 * **Feature: prospecting-workspace, Property 11: For any set of own ai_units carrying free-text cluster labels under their projects, running the backfill produces exactly one project_clusters row per distinct (projectId, normalized-cluster-slug), links every clustered unit to the cluster of its own (project, cluster), and re-running creates no additional cluster rows (idempotent on (projectId, slug)).**
 *
 * **Validates: Requirements 13.2**
 *
 * `backfillProjectClusters` groups the free-text `ai_units.cluster` label by
 * `(projectId, normalizeClusterSlug(cluster))`, upserts exactly one
 * `project_clusters` row per distinct group on the `(project_id, slug)` unique
 * index, and links each affected unit via `ai_units.cluster_id`. Units whose
 * cluster is null / whitespace-only / normalizes to an empty slug are skipped
 * and keep `cluster_id = null`. The operation is idempotent: a second run
 * upserts onto the same `(project_id, slug)` rows and creates no new cluster.
 *
 * The backfill runs against a REAL Drizzle instance backed by an in-memory
 * Postgres (pg-mem). We hand-write the minimal DDL for the three tables the
 * seed touches — `projects` (FK target + `floorplans` source), `ai_units` (the
 * backfill source + `cluster_id` link target), and `project_clusters` (the
 * upsert target, with its `(project_id, slug)` unique index so
 * `onConflictDoUpdate` resolves) — mirroring the harness in
 * `migration-0039.test.ts` and the sibling pg-mem property tests
 * (`tickets/crm/dedupe.idempotence.property.test.ts`). The full migration chain
 * cannot replay under pg-mem (earlier migrations enable the pgvector
 * extension), so only the columns this seed reads/writes are stood up.
 *
 * `normalizeClusterSlug` (exported from the module under test) is used in the
 * expectations so the test's notion of a distinct cluster key matches the
 * seed's exactly.
 */

// ≥100 iterations as mandated for this non-optional property. Each generated
// case stands up a fresh in-memory DB, so the seeded set per run is kept small
// for speed.
const NUM_RUNS = 100;

// Minimal DDL for the three tables the backfill touches. Column names + types
// mirror `lib/cms/schema.ts` (projects / ai_units / project_clusters) and the
// `0039_project_clusters.sql` migration; only the subset the seed reads/writes
// is created. The `(project_id, slug)` unique index is required for the
// `onConflictDoUpdate` upsert path to resolve.
const SCHEMA_SQL = `
  CREATE TABLE "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "floorplans" jsonb
  );
  CREATE TABLE "ai_units" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid,
    "unit_type" text NOT NULL,
    "area_sqm" numeric,
    "purchase_price" numeric,
    "estimated_handover_date" date,
    "cluster" text,
    "cluster_id" uuid
  );
  CREATE TABLE "project_clusters" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "name" text NOT NULL,
    "name_ar" text,
    "slug" text NOT NULL,
    "segment" text,
    "unit_types" jsonb,
    "bedrooms_min" integer,
    "bedrooms_max" integer,
    "price_min_aed" numeric,
    "price_max_aed" numeric,
    "avg_price_per_sqft" numeric,
    "handover_date" date,
    "total_units" integer,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "project_clusters_project_slug_ux"
    ON "project_clusters" ("project_id", "slug");
  CREATE INDEX "project_clusters_project_idx"
    ON "project_clusters" ("project_id");
`;

/**
 * Stand up a fresh in-memory Postgres with the minimal schema applied and
 * return a Drizzle handle (shaped like the production `Database`) plus the raw
 * pg-mem handle (for direct seed inserts). Uses Drizzle's pg-proxy driver over
 * pg-mem (node-postgres' type parsing + array row-mode are rejected by pg-mem);
 * the proxy lets Drizzle's generated SQL run straight against pg-mem.
 */
function buildBackfillDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  // Mark impure so each row gets a fresh uuid rather than a cached value.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(SCHEMA_SQL);

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

  return { db, mem };
}

/** SQL single-quote escape for literal seed values. */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ── Generators ───────────────────────────────────────────────────────────────

const UNIT_TYPES = ["apartment", "villa", "townhouse", "office"] as const;

// A pool of free-text cluster labels exercising the backfill's grouping:
//   - distinct labels that normalize to the SAME slug ("Views 3" / "views 3" /
//     "VIEWS 3" → "views-3") must collapse into one cluster;
//   - whitespace-only / empty / punctuation-only labels (normalize to an empty
//     slug) must be SKIPPED — their units keep cluster_id null.
const CLUSTER_LABELS = [
  "Views 3",
  "views 3",
  "VIEWS 3",
  "Marina Vista",
  "Palm Tower",
  "Bay Residences 2",
  "   ",
  "",
  "\t",
  "!!!",
  "---",
];

const HANDOVER_DATES = ["2025-12-15", "2026-06-30", "2027-03-01"];

const unitArb = fc.record({
  // Which seeded project this unit belongs to (taken modulo the project count).
  projectIndex: fc.integer({ min: 0, max: 2 }),
  // The free-text cluster label, or null (no cluster at all → skipped).
  cluster: fc.option(fc.constantFrom(...CLUSTER_LABELS), { nil: null }),
  unitType: fc.constantFrom(...UNIT_TYPES),
  areaSqm: fc.option(fc.integer({ min: 50, max: 2000 }), { nil: null }),
  purchasePrice: fc.option(fc.integer({ min: 500_000, max: 80_000_000 }), {
    nil: null,
  }),
  handover: fc.option(fc.constantFrom(...HANDOVER_DATES), { nil: null }),
});

interface SeededUnit {
  id: string;
  projectId: string;
  cluster: string | null;
  /** The (projectId, slug) group key, or null when the unit must be skipped. */
  groupKey: string | null;
}

describe("backfillProjectClusters — Property 11: cluster backfill (Req 13.2)", () => {
  it("produces one cluster per distinct (projectId, slug), links every clustered unit, and is idempotent", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.array(unitArb, { minLength: 0, maxLength: 12 }),
        async (projectCount, units) => {
          const { db, mem } = buildBackfillDb();

          // ── Seed projects (floorplans null — bedroom band is out of scope
          //    for this property, which is about cluster identity + linkage). ──
          const projectIds: string[] = [];
          for (let i = 0; i < projectCount; i++) {
            const id = randomUUID();
            mem.public.none(
              `INSERT INTO projects (id, floorplans) VALUES ('${id}', NULL)`
            );
            projectIds.push(id);
          }

          // ── Seed units + compute the expected (projectId, slug) grouping. ──
          const seeded: SeededUnit[] = [];
          for (const u of units) {
            const id = randomUUID();
            const projectId = projectIds[u.projectIndex % projectCount];

            // Mirror the seed's skip logic to derive the expected group key.
            let groupKey: string | null = null;
            if (u.cluster !== null) {
              const label = u.cluster.trim();
              if (label.length > 0) {
                const slug = normalizeClusterSlug(label);
                if (slug.length > 0) groupKey = `${projectId}::${slug}`;
              }
            }

            mem.public.none(
              `INSERT INTO ai_units
                 (id, project_id, unit_type, area_sqm, purchase_price,
                  estimated_handover_date, cluster, cluster_id)
               VALUES (
                 '${id}',
                 '${projectId}',
                 ${lit(u.unitType)},
                 ${u.areaSqm === null ? "NULL" : u.areaSqm},
                 ${u.purchasePrice === null ? "NULL" : u.purchasePrice},
                 ${u.handover === null ? "NULL" : lit(u.handover)},
                 ${u.cluster === null ? "NULL" : lit(u.cluster)},
                 NULL
               )`
            );

            seeded.push({ id, projectId, cluster: u.cluster, groupKey });
          }

          const expectedGroups = new Map<string, string[]>(); // key → unitIds
          for (const u of seeded) {
            if (u.groupKey === null) continue;
            const arr = expectedGroups.get(u.groupKey);
            if (arr === undefined) expectedGroups.set(u.groupKey, [u.id]);
            else arr.push(u.id);
          }
          const expectedClusteredUnitIds = new Set(
            seeded.filter((u) => u.groupKey !== null).map((u) => u.id)
          );

          // ── Run the backfill. ──
          const result = await backfillProjectClusters(db);

          // The return value reflects exactly the distinct groups + linked units.
          expect(result.clustersCreated).toBe(expectedGroups.size);
          expect(result.unitsLinked).toBe(expectedClusteredUnitIds.size);

          // ── Assert: exactly one cluster row per distinct (projectId, slug). ──
          const clusterRows = await db
            .select({
              id: projectClusters.id,
              projectId: projectClusters.projectId,
              slug: projectClusters.slug,
            })
            .from(projectClusters);

          expect(clusterRows.length).toBe(expectedGroups.size);

          const clusterIdByKey = new Map<string, string>();
          for (const row of clusterRows) {
            clusterIdByKey.set(`${row.projectId}::${row.slug}`, row.id);
          }
          // Keys match exactly (no missing, no extra).
          expect(new Set(clusterIdByKey.keys())).toEqual(
            new Set(expectedGroups.keys())
          );

          // ── Assert: every clustered unit links to its own (project, cluster)
          //    cluster id; every skipped unit keeps cluster_id null. ──
          const unitRows = await db
            .select({ id: aiUnits.id, clusterId: aiUnits.clusterId })
            .from(aiUnits);
          const clusterIdByUnit = new Map<string, string | null>();
          for (const row of unitRows) {
            clusterIdByUnit.set(row.id, row.clusterId);
          }

          for (const u of seeded) {
            const linked = clusterIdByUnit.get(u.id) ?? null;
            if (u.groupKey === null) {
              expect(linked).toBeNull();
            } else {
              expect(linked).toBe(clusterIdByKey.get(u.groupKey));
            }
          }

          // ── Assert: re-running is idempotent — no new cluster rows, links
          //    stable (idempotent on (projectId, slug)). ──
          const result2 = await backfillProjectClusters(db);
          expect(result2.clustersCreated).toBe(0);
          expect(result2.unitsLinked).toBe(expectedClusteredUnitIds.size);

          const clusterRows2 = await db
            .select({
              id: projectClusters.id,
              projectId: projectClusters.projectId,
              slug: projectClusters.slug,
            })
            .from(projectClusters);
          // Same count and the very same row ids (upsert reused, not recreated).
          expect(clusterRows2.length).toBe(expectedGroups.size);
          expect(new Set(clusterRows2.map((r) => r.id))).toEqual(
            new Set(clusterRows.map((r) => r.id))
          );

          const unitRows2 = await db
            .select({ id: aiUnits.id, clusterId: aiUnits.clusterId })
            .from(aiUnits);
          for (const row of unitRows2) {
            expect(row.clusterId ?? null).toBe(clusterIdByUnit.get(row.id) ?? null);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
