/**
 * Prospecting Workspace (S7 increment) — Own_Subject → Comparison_Spec resolver
 * (Design §2; Requirements 13.4, 13.5, 13.6).
 *
 * A rep picks an **Own_Subject** from ORA's own catalog — a community, a
 * project, a `project_clusters` cluster, or a single `ai_units` unit — and this
 * module resolves it into a **Comparison_Spec**: the very same `BriefSpec` the
 * implemented comparables ranker (`lib/cms/market/comparables.ts`) and the
 * `find_comparables` / `market_comps` catalog tools already consume. The rep no
 * longer types the comparison parameters by hand; they are read from stored own
 * records.
 *
 * Hard constraints (Design §2):
 *  - PURE SQL read over the OWN catalog ONLY — `communities` + `projects` +
 *    `project_clusters` + that cluster's `ai_units`. It NEVER reads `market_*`;
 *    the market read still happens only inside `find_comparables`/`market_comps`,
 *    so the audited boundary is unchanged.
 *  - DETERMINISTIC — no clock, no randomness, no provider. Identical DB state +
 *    selector ⇒ identical output (CC-SQL, Property 12). Every aggregation is
 *    order-independent or explicitly tie-broken, so row order never leaks in.
 *  - NEVER invents a value — a parameter that cannot be sourced from a real own
 *    record is reported in `gaps` (and only the unfillable ones), while the
 *    Own_Subject selector is retained for the rep to fill manually (Req 13.6).
 */

import { eq } from "drizzle-orm";

import type { Database } from "../db";
import { aiUnits, communities, projectClusters, projects } from "../schema";
import type { BriefSpec } from "./brief";

// ── Public contract ──────────────────────────────────────────────────────────

/**
 * Which own entity the rep picked. At least one field should be set; the
 * narrowest provided node and its ancestors are resolved
 * (`aiUnitId → cluster → project → community`).
 */
export interface OwnSubjectSelector {
  communityId?: string;
  projectId?: string;
  clusterId?: string;
  aiUnitId?: string;
}

/** Where each resolved spec field came from (CC-Provenance for own data). */
export interface ComparisonSpecProvenance {
  area?: "community" | "project";
  segment?: "cluster" | "derived_from_units";
  unitType?: "cluster_units";
  bedrooms?: "cluster_units" | "project_floorplans";
  priceBand?: "cluster_fields" | "cluster_units" | "project_units";
  coords?: "community";
}

export interface ResolvedComparisonSpec {
  /** The BriefSpec the existing ranker / find_comparables consume (Req 13.5). */
  spec: BriefSpec;
  /** Optional lat/lng carried from the community for future geo-ranking. */
  coords?: { lat: number; lng: number } | null;
  provenance: ComparisonSpecProvenance;
  /** Unfillable parameters the rep must supply manually (Req 13.6). */
  gaps?: Array<keyof BriefSpec>;
}

/** Spec parameters the resolver attempts to source from the own catalog. */
const CANDIDATE_FIELDS = [
  "area",
  "segment",
  "unitType",
  "bedrooms",
  "priceMinAed",
  "priceMaxAed",
] as const satisfies ReadonlyArray<keyof BriefSpec>;

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve an Own_Subject selection into a Comparison_Spec from the OWN catalog
 * ONLY. Deterministic and read-only (Req 13.5). A parameter that cannot be
 * sourced from a real own record is reported in `gaps`, never guessed
 * (Req 13.6).
 */
export async function resolveComparisonSpec(
  db: Database,
  selector: OwnSubjectSelector
): Promise<ResolvedComparisonSpec> {
  // 1. Resolve the narrowest provided node and its ancestors.
  const nodes = await resolveNodes(db, selector);
  const { community, project, cluster } = nodes;

  // Units used to derive figures: the cluster's units when a cluster resolved,
  // else the single selected unit (aiUnitId without a cluster). Always real own
  // rows — never invented.
  const clusterUnits = cluster
    ? await unitsForCluster(db, cluster.id)
    : nodes.unit
      ? [nodes.unit]
      : [];

  const spec: BriefSpec = { features: [] };
  const provenance: ComparisonSpecProvenance = {};

  // 2. area ← community.nameEn (fallback project.nameEn); coords ← community.
  if (community?.nameEn) {
    spec.area = community.nameEn;
    provenance.area = "community";
  } else if (project?.nameEn) {
    spec.area = project.nameEn;
    provenance.area = "project";
  }
  let coords: { lat: number; lng: number } | null = null;
  if (
    community?.locationLat != null &&
    community?.locationLng != null
  ) {
    coords = { lat: community.locationLat, lng: community.locationLng };
    provenance.coords = "community";
  }

  // 3. segment ← cluster.segment, else derived from cluster.avgPricePerSqft band.
  if (cluster?.segment) {
    spec.segment = cluster.segment;
    provenance.segment = "cluster";
  } else if (cluster?.avgPricePerSqft != null) {
    const derived = segmentFromPricePerSqft(cluster.avgPricePerSqft);
    if (derived) {
      spec.segment = derived;
      provenance.segment = "derived_from_units";
    }
  }

  // 4. unitType ← dominant type across the cluster's units, mapped to the brief
  //    enum; else a single unambiguous type listed on the cluster.
  const unitType = resolveUnitType(clusterUnits, cluster?.unitTypes);
  if (unitType) {
    spec.unitType = unitType;
    provenance.unitType = "cluster_units";
  }

  // 5. bedrooms ← midpoint of cluster bedroomsMin/Max, else project floorplans.
  const clusterBedrooms = midpointBedrooms(
    cluster?.bedroomsMin ?? null,
    cluster?.bedroomsMax ?? null
  );
  if (clusterBedrooms != null) {
    spec.bedrooms = clusterBedrooms;
    provenance.bedrooms = "cluster_units";
  } else {
    const fpBedrooms = floorplanBedrooms(project?.floorplans);
    if (fpBedrooms != null) {
      spec.bedrooms = fpBedrooms;
      provenance.bedrooms = "project_floorplans";
    }
  }

  // 6. price ← cluster.price{Min,Max}Aed, else min/max purchasePrice of the
  //    cluster's units, else min/max purchasePrice of the project's units.
  const priceBand = await resolvePriceBand(db, cluster, clusterUnits, project);
  if (priceBand) {
    if (priceBand.min != null) spec.priceMinAed = priceBand.min;
    if (priceBand.max != null) spec.priceMaxAed = priceBand.max;
    provenance.priceBand = priceBand.source;
  }

  // 7. Any candidate field not populated above is an unfillable gap (Req 13.6).
  const gaps = CANDIDATE_FIELDS.filter((f) => spec[f] === undefined);

  return {
    spec,
    coords,
    provenance,
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

// ── Node resolution (narrowest → ancestors) ──────────────────────────────────

type CommunityRow = typeof communities.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type ClusterRow = typeof projectClusters.$inferSelect;
type UnitRow = typeof aiUnits.$inferSelect;

interface ResolvedNodes {
  community: CommunityRow | null;
  project: ProjectRow | null;
  cluster: ClusterRow | null;
  unit: UnitRow | null;
}

/**
 * Resolve the chain `aiUnit → cluster → project → community`, walking up from
 * whichever node the selector pins. IDs discovered on a child override the
 * (optional) ancestor ids the selector supplied, since the stored FK is the
 * source of truth.
 */
async function resolveNodes(
  db: Database,
  selector: OwnSubjectSelector
): Promise<ResolvedNodes> {
  let { communityId, projectId, clusterId } = selector;
  let unit: UnitRow | null = null;
  let cluster: ClusterRow | null = null;
  let project: ProjectRow | null = null;
  let community: CommunityRow | null = null;

  if (selector.aiUnitId) {
    unit = await fetchOne(db, aiUnits, aiUnits.id, selector.aiUnitId);
    if (unit) {
      clusterId = clusterId ?? unit.clusterId ?? undefined;
      projectId = projectId ?? unit.projectId ?? undefined;
      communityId = communityId ?? unit.communityId ?? undefined;
    }
  }

  if (clusterId) {
    cluster = await fetchOne(
      db,
      projectClusters,
      projectClusters.id,
      clusterId
    );
    if (cluster) projectId = projectId ?? cluster.projectId;
  }

  if (projectId) {
    project = await fetchOne(db, projects, projects.id, projectId);
    if (project) communityId = communityId ?? project.communityId;
  }

  if (communityId) {
    community = await fetchOne(db, communities, communities.id, communityId);
  }

  return { community, project, cluster, unit };
}

/** All `ai_units` linked to a cluster via `cluster_id`. */
async function unitsForCluster(
  db: Database,
  clusterId: string
): Promise<UnitRow[]> {
  return db.select().from(aiUnits).where(eq(aiUnits.clusterId, clusterId));
}

// ── Field derivations (pure, order-independent / deterministically tie-broken) ─

/** Brief unit-type enum values, in a stable order for deterministic tie-breaks. */
const BRIEF_UNIT_TYPES = [
  "apartment",
  "office",
  "penthouse",
  "townhouse",
  "villa",
] as const;
type BriefUnitType = (typeof BRIEF_UNIT_TYPES)[number];

/** Map a raw own unit-type string to the brief enum, or null if unmappable. */
function mapUnitType(raw: string): BriefUnitType | null {
  const n = raw.trim().toLowerCase();
  switch (n) {
    case "apartment":
      return "apartment";
    case "villa":
      return "villa";
    case "townhouse":
      return "townhouse";
    case "office":
      return "office";
    // `ai_units.unitType` has no `penthouse`, but the cluster may name it
    // explicitly — honour it only when the source actually says so.
    case "penthouse":
      return "penthouse";
    default:
      return null;
  }
}

/**
 * The dominant brief unit type: the most common mappable `unitType` across the
 * cluster's units, tie-broken by `BRIEF_UNIT_TYPES` order for determinism. When
 * there are no units, fall back to the cluster's `unitTypes` list only when it
 * names exactly one mappable type (an unambiguous dominant).
 */
function resolveUnitType(
  units: UnitRow[],
  clusterUnitTypes: unknown
): BriefUnitType | null {
  const counts = new Map<BriefUnitType, number>();
  for (const u of units) {
    const mapped = u.unitType ? mapUnitType(u.unitType) : null;
    if (mapped) counts.set(mapped, (counts.get(mapped) ?? 0) + 1);
  }

  if (counts.size > 0) {
    let best: BriefUnitType | null = null;
    let bestCount = -1;
    // Iterate in stable enum order so equal counts resolve deterministically.
    for (const t of BRIEF_UNIT_TYPES) {
      const c = counts.get(t) ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = t;
      }
    }
    return best;
  }

  // No units: only commit when the cluster names exactly one mappable type.
  if (Array.isArray(clusterUnitTypes)) {
    const mapped = new Set<BriefUnitType>();
    for (const t of clusterUnitTypes) {
      if (typeof t === "string") {
        const m = mapUnitType(t);
        if (m) mapped.add(m);
      }
    }
    if (mapped.size === 1) return [...mapped][0];
  }

  return null;
}

/**
 * Premium segment derived from an average price-per-sqft figure (AED/sqft),
 * using a fixed, deterministic band ladder. Heuristic — used only when the
 * cluster carries no explicit `segment`.
 */
function segmentFromPricePerSqft(
  ppsf: number
): BriefSpec["segment"] | null {
  if (!Number.isFinite(ppsf) || ppsf <= 0) return null;
  if (ppsf >= 5000) return "ultra_luxury";
  if (ppsf >= 2500) return "luxury";
  if (ppsf >= 1500) return "premium";
  return "mid";
}

/** Clamp to the brief's bedroom range [0, 20] and round to an integer. */
function clampBedrooms(n: number): number {
  return Math.min(20, Math.max(0, Math.round(n)));
}

/** Midpoint of a cluster's bedroom band; tolerates a one-sided band. */
function midpointBedrooms(
  min: number | null,
  max: number | null
): number | null {
  if (min != null && max != null) return clampBedrooms((min + max) / 2);
  if (min != null) return clampBedrooms(min);
  if (max != null) return clampBedrooms(max);
  return null;
}

/** Midpoint bedroom count derived from a project's `floorplans` jsonb. */
function floorplanBedrooms(floorplans: unknown): number | null {
  if (!Array.isArray(floorplans)) return null;
  const beds: number[] = [];
  for (const fp of floorplans) {
    if (fp && typeof fp === "object" && "bedrooms" in fp) {
      const b = (fp as { bedrooms?: unknown }).bedrooms;
      if (typeof b === "number" && Number.isFinite(b)) beds.push(b);
    }
  }
  if (beds.length === 0) return null;
  const lo = Math.min(...beds);
  const hi = Math.max(...beds);
  return clampBedrooms((lo + hi) / 2);
}

interface PriceBand {
  min: number | null;
  max: number | null;
  source: NonNullable<ComparisonSpecProvenance["priceBand"]>;
}

/**
 * Resolve the price band, in priority order:
 *   1. cluster `priceMinAed` / `priceMaxAed` fields,
 *   2. min/max `purchasePrice` of the cluster's units,
 *   3. min/max `purchasePrice` of the project's units.
 * Returns null when no own record carries a price (→ gap).
 */
async function resolvePriceBand(
  db: Database,
  cluster: ClusterRow | null,
  clusterUnits: UnitRow[],
  project: ProjectRow | null
): Promise<PriceBand | null> {
  if (cluster && (cluster.priceMinAed != null || cluster.priceMaxAed != null)) {
    return {
      min: cluster.priceMinAed,
      max: cluster.priceMaxAed,
      source: "cluster_fields",
    };
  }

  const fromCluster = priceRangeOfUnits(clusterUnits);
  if (fromCluster) return { ...fromCluster, source: "cluster_units" };

  if (project) {
    const projectUnits = await db
      .select()
      .from(aiUnits)
      .where(eq(aiUnits.projectId, project.id));
    const fromProject = priceRangeOfUnits(projectUnits);
    if (fromProject) return { ...fromProject, source: "project_units" };
  }

  return null;
}

/** Min/max of the non-null `purchasePrice` across units; null when none priced. */
function priceRangeOfUnits(
  units: UnitRow[]
): { min: number; max: number } | null {
  const prices = units
    .map((u) => u.purchasePrice)
    .filter((p): p is number => p != null && Number.isFinite(p));
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// ── Tiny query helper ─────────────────────────────────────────────────────────

/** Fetch a single row by an id column, or null. (Drizzle table/column typing
 *  is internal; the `any` params are confined to this one-line helper.) */
async function fetchOne<T extends { id: unknown }>(
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idColumn: any,
  id: string
): Promise<T | null> {
  const [row] = await db.select().from(table).where(eq(idColumn, id)).limit(1);
  return (row as T | undefined) ?? null;
}
