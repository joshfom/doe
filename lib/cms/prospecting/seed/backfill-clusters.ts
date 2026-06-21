/**
 * Prospecting Workspace (S7 increment) — Project_Cluster backfill seed
 * (Design §1 "Backfill"; Requirement 13.2). **CC-Synthetic — demo/seed only.**
 *
 * This is a seed/migration step run on the container tier, NOT runtime code on
 * the request path. It completes the own hierarchy `communities → projects →
 * Project_Cluster → ai_units` by deriving structured `project_clusters` rows
 * from the existing free-text `ai_units.cluster` label, grouped by
 * `(projectId, normalizeClusterSlug(cluster))`.
 *
 * For each group it aggregates:
 *   - `unitTypes`       — distinct raw `ai_units.unit_type` values (string[])
 *   - `bedroomsMin/Max` — from the project's `floorplans` matched to those types
 *   - `priceMin/MaxAed` — min/max `purchasePrice` over the group's priced units
 *   - `avgPricePerSqft`  — Σ(purchasePrice) / Σ(areaSqm) over priced+measured
 *                          units (per the design formula; AED per sqm)
 *   - `handoverDate`     — max `estimatedHandoverDate`
 *   - `totalUnits`       — group size
 *   - `segment`          — derived from the avg-price band, else null (allowed)
 *
 * It then upserts `project_clusters` on the `(projectId, slug)` unique index and
 * links each affected unit via `ai_units.cluster_id`. The operation is
 * **idempotent**: re-running upserts on `(projectId, slug)` and never creates a
 * duplicate cluster row. Whitespace-only / empty cluster labels are skipped —
 * those units keep `cluster_id = null`.
 *
 * Production cluster authorship is staff-driven; backfilled rows are demo seed
 * data and are never rendered on the public site (clusters are a
 * prospecting-internal grouping, not a page-builder entity — Decision 7).
 */

import { and, inArray, isNotNull } from "drizzle-orm";

import type { Database } from "../../db";
import { aiUnits, projectClusters, projects } from "../../schema";
import { generateSlug } from "../../utils/slug";

// ── Public contract ──────────────────────────────────────────────────────────

export interface BackfillClustersResult {
  /** Number of distinct `(projectId, slug)` cluster rows newly created. */
  clustersCreated: number;
  /** Number of `ai_units` rows linked to a derived cluster via `cluster_id`. */
  unitsLinked: number;
}

/** Premium segment ladder, same values as `market_projects.segment`. */
type Segment = "ultra_luxury" | "luxury" | "premium" | "mid";

/**
 * Normalize a free-text cluster label into the stable per-project cluster key
 * (e.g. `"Views 3"` → `"views-3"`). Exported so the resolver (§2) and the
 * backfill property test use one identical normalization.
 */
export function normalizeClusterSlug(label: string): string {
  return generateSlug(label);
}

/**
 * Derive `project_clusters` rows from the existing free-text `ai_units.cluster`
 * label and link each affected unit. Idempotent on `(projectId, slug)`.
 *
 * Demo/seed only (CC-Synthetic) — never invoked on the request path.
 */
export async function backfillProjectClusters(
  db: Database
): Promise<BackfillClustersResult> {
  // 1. Load every own unit carrying a cluster label under a relational project.
  const units = await db
    .select({
      id: aiUnits.id,
      projectId: aiUnits.projectId,
      cluster: aiUnits.cluster,
      unitType: aiUnits.unitType,
      areaSqm: aiUnits.areaSqm,
      purchasePrice: aiUnits.purchasePrice,
      estimatedHandoverDate: aiUnits.estimatedHandoverDate,
    })
    .from(aiUnits)
    .where(and(isNotNull(aiUnits.cluster), isNotNull(aiUnits.projectId)));

  // 2. Group by (projectId, normalized-cluster-slug). Whitespace-only / empty
  //    labels (and labels that normalize to an empty slug) are skipped — those
  //    units keep cluster_id = null.
  const groups = new Map<string, ClusterGroup>();
  for (const u of units) {
    if (u.projectId === null || u.cluster === null) continue;
    const label = u.cluster.trim();
    if (label.length === 0) continue;
    const slug = normalizeClusterSlug(label);
    if (slug.length === 0) continue;

    const key = `${u.projectId}::${slug}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        projectId: u.projectId,
        slug,
        name: label,
        units: [],
      };
      groups.set(key, group);
    }
    group.units.push(u);
  }

  if (groups.size === 0) {
    return { clustersCreated: 0, unitsLinked: 0 };
  }

  // 3. Load the floorplans for every project referenced by a group so bedroom
  //    bands can be sourced from the project brochure model.
  const projectIds = [...new Set([...groups.values()].map((g) => g.projectId))];
  const projectRows = await db
    .select({ id: projects.id, floorplans: projects.floorplans })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  const floorplansByProject = new Map<string, Floorplan[]>();
  for (const p of projectRows) {
    floorplansByProject.set(p.id, parseFloorplans(p.floorplans));
  }

  // 4. Determine which (projectId, slug) rows already exist so `clustersCreated`
  //    counts only genuinely new rows (the operation is otherwise an upsert).
  const existing = await db
    .select({
      projectId: projectClusters.projectId,
      slug: projectClusters.slug,
    })
    .from(projectClusters)
    .where(inArray(projectClusters.projectId, projectIds));
  const existingKeys = new Set(
    existing.map((r) => `${r.projectId}::${r.slug}`)
  );

  let clustersCreated = 0;
  let unitsLinked = 0;

  // 5. For each group: aggregate, upsert the cluster, link its units.
  for (const group of groups.values()) {
    // Deterministic ordering by id for stable representative name + reductions.
    const ordered = [...group.units].sort((a, b) => (a.id < b.id ? -1 : 1));

    const unitTypes = [
      ...new Set(ordered.map((u) => u.unitType)),
    ].sort();

    const floorplans = floorplansByProject.get(group.projectId) ?? [];
    const { bedroomsMin, bedroomsMax } = bedroomBand(floorplans, unitTypes);

    const prices = ordered
      .map((u) => u.purchasePrice)
      .filter((p): p is number => p !== null && Number.isFinite(p));
    const priceMinAed = prices.length > 0 ? Math.min(...prices) : null;
    const priceMaxAed = prices.length > 0 ? Math.max(...prices) : null;

    const avgPricePerSqft = computeAvgPricePerSqft(ordered);
    const segment = deriveSegment(avgPricePerSqft);

    const handoverDate = maxDate(
      ordered.map((u) => u.estimatedHandoverDate)
    );

    const key = `${group.projectId}::${group.slug}`;
    const isNew = !existingKeys.has(key);

    const values = {
      projectId: group.projectId,
      name: group.name,
      slug: group.slug,
      segment,
      unitTypes,
      bedroomsMin,
      bedroomsMax,
      priceMinAed,
      priceMaxAed,
      avgPricePerSqft,
      handoverDate,
      totalUnits: ordered.length,
    };

    const [row] = await db
      .insert(projectClusters)
      .values(values)
      .onConflictDoUpdate({
        target: [projectClusters.projectId, projectClusters.slug],
        set: {
          name: values.name,
          segment: values.segment,
          unitTypes: values.unitTypes,
          bedroomsMin: values.bedroomsMin,
          bedroomsMax: values.bedroomsMax,
          priceMinAed: values.priceMinAed,
          priceMaxAed: values.priceMaxAed,
          avgPricePerSqft: values.avgPricePerSqft,
          handoverDate: values.handoverDate,
          totalUnits: values.totalUnits,
          updatedAt: new Date(),
        },
      })
      .returning({ id: projectClusters.id });

    if (isNew) clustersCreated += 1;

    // 6. Link every unit in the group to the (possibly new) cluster id.
    const unitIds = ordered.map((u) => u.id);
    await db
      .update(aiUnits)
      .set({ clusterId: row.id })
      .where(inArray(aiUnits.id, unitIds));
    unitsLinked += unitIds.length;
  }

  return { clustersCreated, unitsLinked };
}

// ── Private helpers ────────────────────────────────────────────────────────────

interface ClusterUnit {
  id: string;
  projectId: string | null;
  cluster: string | null;
  unitType: string;
  areaSqm: number | null;
  purchasePrice: number | null;
  estimatedHandoverDate: string | null;
}

interface ClusterGroup {
  projectId: string;
  slug: string;
  /** Representative human label (the first label in id order). */
  name: string;
  units: ClusterUnit[];
}

interface Floorplan {
  unitType?: string | null;
  bedrooms?: number | null;
}

/** Parse the projects.floorplans jsonb into a defensively-typed array. */
function parseFloorplans(raw: unknown): Floorplan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is Floorplan => typeof f === "object" && f !== null);
}

/**
 * Bedroom band from the project's floorplans whose `unitType` is one of the
 * cluster's unit types. Returns `{ null, null }` when no floorplan matches or
 * none carry a numeric `bedrooms` value.
 */
function bedroomBand(
  floorplans: Floorplan[],
  unitTypes: string[]
): { bedroomsMin: number | null; bedroomsMax: number | null } {
  const typeSet = new Set(unitTypes);
  const bedrooms = floorplans
    .filter((f) => f.unitType != null && typeSet.has(f.unitType))
    .map((f) => f.bedrooms)
    .filter((b): b is number => b !== null && b !== undefined && Number.isFinite(b));

  if (bedrooms.length === 0) {
    return { bedroomsMin: null, bedroomsMax: null };
  }
  return { bedroomsMin: Math.min(...bedrooms), bedroomsMax: Math.max(...bedrooms) };
}

/**
 * Average price per unit area over the group's priced + measured units,
 * computed as Σ(purchasePrice) / Σ(areaSqm) per the design formula. Summed in a
 * deterministic (id-sorted) order for reproducible floating point. Returns null
 * when no unit carries both a price and an area, or total area is non-positive.
 */
function computeAvgPricePerSqft(unitsInIdOrder: ClusterUnit[]): number | null {
  let sumPrice = 0;
  let sumArea = 0;
  for (const u of unitsInIdOrder) {
    if (
      u.purchasePrice !== null &&
      Number.isFinite(u.purchasePrice) &&
      u.areaSqm !== null &&
      Number.isFinite(u.areaSqm) &&
      u.areaSqm > 0
    ) {
      sumPrice += u.purchasePrice;
      sumArea += u.areaSqm;
    }
  }
  if (sumArea <= 0) return null;
  return sumPrice / sumArea;
}

/**
 * Derive the premium segment from the average price band (else null — allowed).
 * Bands are over AED per unit area (sumPrice / sumArea, sqm-based per the
 * design formula).
 */
function deriveSegment(avgPrice: number | null): Segment | null {
  if (avgPrice === null || !Number.isFinite(avgPrice) || avgPrice <= 0) {
    return null;
  }
  if (avgPrice >= 40_000) return "ultra_luxury";
  if (avgPrice >= 25_000) return "luxury";
  if (avgPrice >= 15_000) return "premium";
  return "mid";
}

/**
 * Max `date` value (`YYYY-MM-DD` strings compare lexicographically) over the
 * non-null entries. Returns null when none is present.
 */
function maxDate(dates: (string | null)[]): string | null {
  let max: string | null = null;
  for (const d of dates) {
    if (d === null) continue;
    if (max === null || d > max) max = d;
  }
  return max;
}
