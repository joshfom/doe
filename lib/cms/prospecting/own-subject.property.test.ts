import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { aiUnits, communities, projectClusters, projects } from "../schema";
import type { Database } from "../db";
import type { BriefSpec } from "./brief";
import {
  resolveComparisonSpec,
  type OwnSubjectSelector,
  type ResolvedComparisonSpec,
} from "./own-subject";

/**
 * Property test for the Comparison_Spec resolver (task 10.6, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 12: For any own-catalog state and Own_Subject selector, resolveComparisonSpec returns the same BriefSpec on repeated calls over unchanged data, every populated spec field traces to a real own record with no fabricated value, and when the selected cluster has no units and no cluster-level fields to source a parameter, that parameter (and only unfillable parameters) appears in gaps while the selector is retained.**
 *
 * **Validates: Requirements 13.5, 13.6**
 *
 * `resolveComparisonSpec` (lib/cms/prospecting/own-subject.ts) is a PURE SQL
 * read over the OWN catalog only (`communities` + `projects` +
 * `project_clusters` + the cluster's `ai_units`). It NEVER reads `market_*`,
 * never invents a value, and is deterministic. This property pins all three
 * guarantees over random own-catalog graphs:
 *
 *  (a) **Determinism** — two calls over an unchanged DB return deeply-equal
 *      results (Req 13.5).
 *  (b) **Own-sourcing / no fabrication** — every populated spec field equals a
 *      value computed solely from the real seeded own records. The expected
 *      spec is recomputed here directly from the seeded rows (read back from the
 *      same DB so jsonb/numeric representations match exactly), so any invented
 *      value the resolver might emit would diverge and fail (Req 13.5).
 *  (c) **Gaps** — a parameter that cannot be sourced appears in `gaps`, ONLY
 *      unfillable parameters appear there, and the Own_Subject selector is
 *      retained (the function still returns a spec object) (Req 13.6).
 *
 * Baseline for this non-optional property is 100 iterations.
 *
 * Harness mirrors the sibling node-postgres + pg-mem setup
 * (`lib/cms/prospecting/phone.test.ts`).
 */

const NUM_RUNS = 100;

// ── Minimal DDL — the four own-catalog tables the resolver reads ─────────────
// Full column sets (matching schema.ts) are required because drizzle's
// `select()` emits every schema column; lenient types/no FKs keep pg-mem lean.
const DDL = `
  CREATE TABLE "communities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL,
    "name_en" text NOT NULL,
    "name_ar" text,
    "description_en" text,
    "description_ar" text,
    "city" text,
    "region" text,
    "country" text DEFAULT 'AE',
    "location_lat" numeric,
    "location_lng" numeric,
    "hero_image_id" uuid,
    "logo_image_id" uuid,
    "status" text NOT NULL DEFAULT 'active',
    "seo_meta" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "community_id" uuid NOT NULL,
    "slug" text NOT NULL,
    "name_en" text NOT NULL,
    "name_ar" text,
    "short_description_en" text,
    "short_description_ar" text,
    "long_description_en" text,
    "long_description_ar" text,
    "status" text NOT NULL DEFAULT 'planning',
    "hero_image_id" uuid,
    "logo_image_id" uuid,
    "brochure_pdf_id" uuid,
    "brochure_gallery" jsonb,
    "floorplans" jsonb,
    "amenities" jsonb,
    "location_lat" numeric,
    "location_lng" numeric,
    "location_highlights" jsonb,
    "payment_plans" jsonb,
    "expected_handover_date" date,
    "total_units" integer,
    "available_units" integer,
    "developer" text,
    "contractor" text,
    "architect" text,
    "seo_meta" jsonb,
    "landing_page_data" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
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
  CREATE TABLE "ai_units" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_name" text NOT NULL,
    "project_id" uuid,
    "community_id" uuid,
    "unit_number" text NOT NULL,
    "unit_type" text NOT NULL,
    "floor_number" integer,
    "area_sqm" numeric,
    "status" text NOT NULL DEFAULT 'available',
    "construction_progress" integer,
    "estimated_handover_date" date,
    "cluster" text,
    "cluster_id" uuid,
    "purchase_price" numeric,
    "client_id" uuid,
    "tenant_id" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): Database {
  const mem: IMemoryDb = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both and rebuild positional rows when array-mode
  // was requested (mirrors the sibling harnesses).
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
  return drizzle(pool, { schema }) as unknown as Database;
}

// ── Reference derivations (independent mirror of the documented resolver) ─────
// These compute the expected spec SOLELY from real seeded rows, so the
// own-sourcing property is meaningful: a fabricated value would not match.

const BRIEF_UNIT_TYPES = [
  "apartment",
  "office",
  "penthouse",
  "townhouse",
  "villa",
] as const;
type BriefUnitType = (typeof BRIEF_UNIT_TYPES)[number];

const CANDIDATE_FIELDS = [
  "area",
  "segment",
  "unitType",
  "bedrooms",
  "priceMinAed",
  "priceMaxAed",
] as const satisfies ReadonlyArray<keyof BriefSpec>;

function mapUnitType(raw: string): BriefUnitType | null {
  switch (raw.trim().toLowerCase()) {
    case "apartment":
      return "apartment";
    case "villa":
      return "villa";
    case "townhouse":
      return "townhouse";
    case "office":
      return "office";
    case "penthouse":
      return "penthouse";
    default:
      return null;
  }
}

function dominantUnitType(
  units: UnitRow[],
  clusterUnitTypes: unknown
): BriefUnitType | null {
  const counts = new Map<BriefUnitType, number>();
  for (const u of units) {
    const m = u.unitType ? mapUnitType(u.unitType) : null;
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let best: BriefUnitType | null = null;
    let bestCount = -1;
    for (const t of BRIEF_UNIT_TYPES) {
      const c = counts.get(t) ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = t;
      }
    }
    return best;
  }
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

function segmentFromPricePerSqft(ppsf: number): BriefSpec["segment"] | null {
  if (!Number.isFinite(ppsf) || ppsf <= 0) return null;
  if (ppsf >= 5000) return "ultra_luxury";
  if (ppsf >= 2500) return "luxury";
  if (ppsf >= 1500) return "premium";
  return "mid";
}

function clampBedrooms(n: number): number {
  return Math.min(20, Math.max(0, Math.round(n)));
}

function midpointBedrooms(
  min: number | null,
  max: number | null
): number | null {
  if (min != null && max != null) return clampBedrooms((min + max) / 2);
  if (min != null) return clampBedrooms(min);
  if (max != null) return clampBedrooms(max);
  return null;
}

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
  return clampBedrooms((Math.min(...beds) + Math.max(...beds)) / 2);
}

function priceRangeOfUnits(
  units: UnitRow[]
): { min: number; max: number } | null {
  const prices = units
    .map((u) => u.purchasePrice)
    .filter((p): p is number => p != null && Number.isFinite(p));
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

type CommunityRow = typeof communities.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type ClusterRow = typeof projectClusters.$inferSelect;
type UnitRow = typeof aiUnits.$inferSelect;

interface ResolvedNodes {
  community: CommunityRow | null;
  project: ProjectRow | null;
  cluster: ClusterRow | null;
  clusterUnits: UnitRow[];
  projectUnits: UnitRow[];
}

/** Compute the expected ResolvedComparisonSpec from the seeded rows. */
function computeExpected(nodes: ResolvedNodes): ResolvedComparisonSpec {
  const { community, project, cluster, clusterUnits, projectUnits } = nodes;
  const spec: BriefSpec = { features: [] };
  const provenance: ResolvedComparisonSpec["provenance"] = {};

  // area + coords
  if (community?.nameEn) {
    spec.area = community.nameEn;
    provenance.area = "community";
  } else if (project?.nameEn) {
    spec.area = project.nameEn;
    provenance.area = "project";
  }
  let coords: { lat: number; lng: number } | null = null;
  if (community?.locationLat != null && community?.locationLng != null) {
    coords = { lat: community.locationLat, lng: community.locationLng };
    provenance.coords = "community";
  }

  // segment
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

  // unitType
  const unitType = dominantUnitType(clusterUnits, cluster?.unitTypes);
  if (unitType) {
    spec.unitType = unitType;
    provenance.unitType = "cluster_units";
  }

  // bedrooms
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

  // price band (source priority: cluster fields → cluster units → project units)
  let band:
    | { min: number | null; max: number | null; source: "cluster_fields" | "cluster_units" | "project_units" }
    | null = null;
  if (cluster && (cluster.priceMinAed != null || cluster.priceMaxAed != null)) {
    band = {
      min: cluster.priceMinAed,
      max: cluster.priceMaxAed,
      source: "cluster_fields",
    };
  } else {
    const fromCluster = priceRangeOfUnits(clusterUnits);
    if (fromCluster) {
      band = { ...fromCluster, source: "cluster_units" };
    } else if (project) {
      const fromProject = priceRangeOfUnits(projectUnits);
      if (fromProject) band = { ...fromProject, source: "project_units" };
    }
  }
  if (band) {
    if (band.min != null) spec.priceMinAed = band.min;
    if (band.max != null) spec.priceMaxAed = band.max;
    provenance.priceBand = band.source;
  }

  const gaps = CANDIDATE_FIELDS.filter((f) => spec[f] === undefined);

  return {
    spec,
    coords,
    provenance,
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

// ── Tiny query helper ─────────────────────────────────────────────────────────

async function rowById<T>(
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idColumn: any,
  id: string | null | undefined
): Promise<T | null> {
  if (!id) return null;
  const [row] = await db.select().from(table).where(eq(idColumn, id)).limit(1);
  return (row as T | undefined) ?? null;
}

// ── Generators ────────────────────────────────────────────────────────────────

const optInt = (min: number, max: number) =>
  fc.option(fc.integer({ min, max }), { nil: null });

const unitArb = fc.record({
  unitType: fc.constantFrom("apartment", "villa", "townhouse", "office"),
  areaSqm: optInt(20, 1000),
  purchasePrice: optInt(100_000, 80_000_000),
});

const floorplanArb = fc.record({
  unitType: fc.constantFrom(
    "apartment",
    "villa",
    "townhouse",
    "office",
    "penthouse"
  ),
  bedrooms: fc.integer({ min: 0, max: 12 }),
});

const clusterArb = fc.record({
  segment: fc.option(
    fc.constantFrom("ultra_luxury", "luxury", "premium", "mid"),
    { nil: null }
  ),
  unitTypes: fc.option(
    fc.array(
      fc.constantFrom("apartment", "villa", "townhouse", "office", "penthouse"),
      { maxLength: 3 }
    ),
    { nil: null }
  ),
  bedroomsMin: optInt(0, 15),
  bedroomsMax: optInt(0, 20),
  priceMinAed: optInt(100_000, 50_000_000),
  priceMaxAed: optInt(100_000, 50_000_000),
  avgPricePerSqft: fc.option(fc.integer({ min: 1, max: 9000 }), { nil: null }),
  // Clusters with NO units (and possibly no cluster-level fields) drive the
  // gap clause of the property.
  units: fc.array(unitArb, { maxLength: 4 }),
});

const modelArb = fc.record({
  community: fc.record({
    nameEn: fc.string({ minLength: 1, maxLength: 24 }),
    lat: optInt(-90, 90),
    lng: optInt(-180, 180),
  }),
  project: fc.record({
    nameEn: fc.string({ minLength: 1, maxLength: 24 }),
    floorplans: fc.option(fc.array(floorplanArb, { maxLength: 4 }), {
      nil: null,
    }),
  }),
  clusters: fc.array(clusterArb, { maxLength: 4 }),
  looseUnits: fc.array(unitArb, { maxLength: 3 }),
  selMode: fc.constantFrom("community", "project", "cluster", "unit"),
  selSeed: fc.nat(),
});

type Model = typeof modelArb extends fc.Arbitrary<infer T> ? T : never;

interface SeededIds {
  communityId: string;
  projectId: string;
  clusterIds: string[];
  /** All unit ids (cluster + loose), with their resolved clusterId (or null). */
  units: Array<{ id: string; clusterId: string | null }>;
}

async function seedModel(
  db: Database,
  model: Model
): Promise<SeededIds> {
  const [comm] = await db
    .insert(communities)
    .values({
      slug: `comm-${randomUUID()}`,
      nameEn: model.community.nameEn,
      locationLat: model.community.lat,
      locationLng: model.community.lng,
    })
    .returning({ id: communities.id });

  const [proj] = await db
    .insert(projects)
    .values({
      communityId: comm.id,
      slug: `proj-${randomUUID()}`,
      nameEn: model.project.nameEn,
      floorplans: model.project.floorplans ?? undefined,
    })
    .returning({ id: projects.id });

  const clusterIds: string[] = [];
  const units: Array<{ id: string; clusterId: string | null }> = [];

  for (let i = 0; i < model.clusters.length; i++) {
    const c = model.clusters[i];
    const [row] = await db
      .insert(projectClusters)
      .values({
        projectId: proj.id,
        name: `Cluster ${i}`,
        slug: `cluster-${i}`,
        segment: c.segment ?? undefined,
        unitTypes: c.unitTypes ?? undefined,
        bedroomsMin: c.bedroomsMin,
        bedroomsMax: c.bedroomsMax,
        priceMinAed: c.priceMinAed,
        priceMaxAed: c.priceMaxAed,
        avgPricePerSqft: c.avgPricePerSqft,
      })
      .returning({ id: projectClusters.id });
    clusterIds.push(row.id);

    for (const u of c.units) {
      const [unitRow] = await db
        .insert(aiUnits)
        .values({
          projectName: model.project.nameEn,
          projectId: proj.id,
          communityId: comm.id,
          unitNumber: `U-${randomUUID()}`,
          unitType: u.unitType,
          areaSqm: u.areaSqm,
          purchasePrice: u.purchasePrice,
          clusterId: row.id,
        })
        .returning({ id: aiUnits.id });
      units.push({ id: unitRow.id, clusterId: row.id });
    }
  }

  // Loose units: clustered to no cluster (cluster_id = null) but under project.
  for (const u of model.looseUnits) {
    const [unitRow] = await db
      .insert(aiUnits)
      .values({
        projectName: model.project.nameEn,
        projectId: proj.id,
        communityId: comm.id,
        unitNumber: `U-${randomUUID()}`,
        unitType: u.unitType,
        areaSqm: u.areaSqm,
        purchasePrice: u.purchasePrice,
        clusterId: null,
      })
      .returning({ id: aiUnits.id });
    units.push({ id: unitRow.id, clusterId: null });
  }

  return { communityId: comm.id, projectId: proj.id, clusterIds, units };
}

interface SelectionPlan {
  selector: OwnSubjectSelector;
  /** Ids the resolver chain should resolve to, for expectation building. */
  communityId: string | null;
  projectId: string | null;
  clusterId: string | null;
  unitId: string | null;
}

function planSelection(
  ids: SeededIds,
  mode: string,
  seed: number
): SelectionPlan {
  let m = mode;
  if (m === "cluster" && ids.clusterIds.length === 0) m = "project";
  if (m === "unit" && ids.units.length === 0) m = "project";

  switch (m) {
    case "community":
      return {
        selector: { communityId: ids.communityId },
        communityId: ids.communityId,
        projectId: null,
        clusterId: null,
        unitId: null,
      };
    case "project":
      return {
        selector: { projectId: ids.projectId },
        communityId: ids.communityId,
        projectId: ids.projectId,
        clusterId: null,
        unitId: null,
      };
    case "cluster": {
      const clusterId = ids.clusterIds[seed % ids.clusterIds.length];
      return {
        selector: { clusterId },
        communityId: ids.communityId,
        projectId: ids.projectId,
        clusterId,
        unitId: null,
      };
    }
    case "unit": {
      const unit = ids.units[seed % ids.units.length];
      return {
        selector: { aiUnitId: unit.id },
        communityId: ids.communityId,
        projectId: ids.projectId,
        clusterId: unit.clusterId,
        unitId: unit.id,
      };
    }
    default:
      throw new Error(`unreachable mode ${m}`);
  }
}

async function resolvedNodesFor(
  db: Database,
  plan: SelectionPlan
): Promise<ResolvedNodes> {
  const community = await rowById<CommunityRow>(
    db,
    communities,
    communities.id,
    plan.communityId
  );
  const project = await rowById<ProjectRow>(
    db,
    projects,
    projects.id,
    plan.projectId
  );
  const cluster = await rowById<ClusterRow>(
    db,
    projectClusters,
    projectClusters.id,
    plan.clusterId
  );

  // clusterUnits: the cluster's units when a cluster resolved, else the single
  // selected unit (aiUnit without a cluster), else none — mirrors the resolver.
  let clusterUnits: UnitRow[] = [];
  if (cluster) {
    clusterUnits = await db
      .select()
      .from(aiUnits)
      .where(eq(aiUnits.clusterId, cluster.id));
  } else if (plan.unitId) {
    const unit = await rowById<UnitRow>(db, aiUnits, aiUnits.id, plan.unitId);
    clusterUnits = unit ? [unit] : [];
  }

  const projectUnits = project
    ? await db.select().from(aiUnits).where(eq(aiUnits.projectId, project.id))
    : [];

  return { community, project, cluster, clusterUnits, projectUnits };
}

// ── Property ──────────────────────────────────────────────────────────────────

describe("Feature: prospecting-workspace, Property 12: Comparison_Spec resolver", () => {
  it(
    "is deterministic, own-sourced (no fabrication), and reports only unfillable parameters as gaps",
    async () => {
      await fc.assert(
        fc.asyncProperty(modelArb, async (model) => {
          const db = buildDb();
          const ids = await seedModel(db, model);
          const plan = planSelection(ids, model.selMode, model.selSeed);

          // (a) Determinism — two calls over unchanged data are deeply equal.
          const first = await resolveComparisonSpec(db, plan.selector);
          const second = await resolveComparisonSpec(db, plan.selector);
          expect(second).toEqual(first);

          // Selector retained: the function returns a spec object regardless
          // (Req 13.6) — never null/undefined, always a BriefSpec with features.
          expect(first).toBeTruthy();
          expect(typeof first.spec).toBe("object");
          expect(Array.isArray(first.spec.features)).toBe(true);

          // (b)+(c) Own-sourcing + gaps — the expected result computed solely
          // from the real seeded rows must match exactly. A fabricated value or
          // a wrongly-populated/wrongly-gapped field would diverge here.
          const nodes = await resolvedNodesFor(db, plan);
          const expected = computeExpected(nodes);
          expect(first).toEqual(expected);

          // "Only unfillable parameters appear in gaps": every gap field is
          // genuinely unpopulated, and every unpopulated candidate is a gap.
          const gaps = first.gaps ?? [];
          for (const f of gaps) {
            expect(first.spec[f]).toBeUndefined();
          }
          for (const f of CANDIDATE_FIELDS) {
            if (first.spec[f] === undefined) {
              expect(gaps).toContain(f);
            } else {
              expect(gaps).not.toContain(f);
            }
          }

          // Headline gap clause (Req 13.6): a selected cluster with NO units and
          // no cluster-level source for a parameter ⇒ that parameter is a gap.
          if (plan.clusterId && nodes.cluster && nodes.clusterUnits.length === 0) {
            const c = nodes.cluster;
            if (c.segment == null && c.avgPricePerSqft == null) {
              expect(gaps).toContain("segment");
            }
            const utArr = Array.isArray(c.unitTypes) ? c.unitTypes : [];
            const mappedTypes = new Set(
              utArr
                .filter((t): t is string => typeof t === "string")
                .map(mapUnitType)
                .filter((t): t is BriefUnitType => t !== null)
            );
            if (mappedTypes.size !== 1) {
              expect(gaps).toContain("unitType");
            }
            if (
              c.bedroomsMin == null &&
              c.bedroomsMax == null &&
              floorplanBedrooms(nodes.project?.floorplans) == null
            ) {
              expect(gaps).toContain("bedrooms");
            }
            if (
              c.priceMinAed == null &&
              c.priceMaxAed == null &&
              priceRangeOfUnits(nodes.projectUnits) == null
            ) {
              expect(gaps).toContain("priceMinAed");
              expect(gaps).toContain("priceMaxAed");
            }
          }
        }),
        { numRuns: NUM_RUNS }
      );
    },
    120_000
  );
});
