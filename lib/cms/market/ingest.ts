/**
 * ingestMarketBatch — idempotent, provenance-stamped upsert of a `MarketBatch`
 * into the `market_*` mirror (Design §Components #2; Requirements 11.1, 11.2).
 *
 * The one guarantee this module exists to provide is IDEMPOTENCY (CC-Idem,
 * Req 11.2): every ingested row is keyed by `(source, source_ref)` — or, for the
 * price index, by `(area_name, segment, period, source)` — and upserted with
 * `onConflictDoUpdate`, so re-ingesting the same record leaves the row
 * field-identical rather than creating a duplicate. The upsert deliberately does
 * NOT touch `created_at`/`updated_at`, so re-ingesting an unchanged batch is a
 * true no-op at the data level; freshness is tracked by the provenance `as_of`
 * column instead.
 *
 * Every row is stamped with provenance the readers later surface: `source`
 * (the adapter discriminator), the record's `source_ref`, and its `as_of`
 * timestamp. Live ingest always stamps `demo = false`; synthetic rows flow only
 * through seed paths (CC-Synthetic).
 *
 * Cross-record foreign keys arrive as the PARENT's `source_ref` (e.g. a
 * project's `developerSourceRef`). Records are ingested parent-first
 * (developers → projects → buildings → transactions → price index) and, after
 * each parent level, a `(source_ref → id)` map is read back from the mirror so
 * references resolve even to rows ingested in an EARLIER batch.
 */

import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../db";
import {
  marketBuildings,
  marketDevelopers,
  marketPriceIndex,
  marketProjects,
  marketTransactions,
} from "../schema";
import type {
  MarketBatch,
  RawBuilding,
  RawDeveloper,
  RawIndex,
  RawProject,
  RawTransaction,
} from "./adapter";

/** Deterministic name normalization: trim, lower-case, collapse whitespace. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Coerce a provider as-of value to a `Date`, or `null` when absent. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Read back a `(source_ref → id)` map for the given source from a mirror table,
 * scoped to the `source_ref`s actually referenced by the current batch. Includes
 * rows ingested in earlier batches so cross-batch references resolve.
 */
async function buildDeveloperIdMap(
  db: Database,
  source: string,
  sourceRefs: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const refs = [...new Set(sourceRefs.filter((r): r is string => Boolean(r)))];
  if (refs.length === 0) return new Map();
  const rows = await db
    .select({ id: marketDevelopers.id, sourceRef: marketDevelopers.sourceRef })
    .from(marketDevelopers)
    .where(
      and(
        eq(marketDevelopers.source, source),
        inArray(marketDevelopers.sourceRef, refs)
      )
    );
  const map = new Map<string, string>();
  for (const r of rows) if (r.sourceRef) map.set(r.sourceRef, r.id);
  return map;
}

async function buildProjectIdMap(
  db: Database,
  source: string,
  sourceRefs: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const refs = [...new Set(sourceRefs.filter((r): r is string => Boolean(r)))];
  if (refs.length === 0) return new Map();
  const rows = await db
    .select({ id: marketProjects.id, sourceRef: marketProjects.sourceRef })
    .from(marketProjects)
    .where(
      and(
        eq(marketProjects.source, source),
        inArray(marketProjects.sourceRef, refs)
      )
    );
  const map = new Map<string, string>();
  for (const r of rows) if (r.sourceRef) map.set(r.sourceRef, r.id);
  return map;
}

async function buildBuildingIdMap(
  db: Database,
  source: string,
  sourceRefs: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const refs = [...new Set(sourceRefs.filter((r): r is string => Boolean(r)))];
  if (refs.length === 0) return new Map();
  const rows = await db
    .select({ id: marketBuildings.id, sourceRef: marketBuildings.sourceRef })
    .from(marketBuildings)
    .where(
      and(
        eq(marketBuildings.source, source),
        inArray(marketBuildings.sourceRef, refs)
      )
    );
  const map = new Map<string, string>();
  for (const r of rows) if (r.sourceRef) map.set(r.sourceRef, r.id);
  return map;
}

async function upsertDevelopers(
  db: Database,
  source: string,
  developers: RawDeveloper[]
): Promise<void> {
  for (const d of developers) {
    const set = {
      name: d.name,
      nameNormalized: d.nameNormalized ?? normalizeName(d.name),
      country: d.country ?? null,
      asOf: toDate(d.asOf),
      demo: false,
    };
    await db
      .insert(marketDevelopers)
      .values({ ...set, source, sourceRef: d.sourceRef })
      .onConflictDoUpdate({
        target: [marketDevelopers.source, marketDevelopers.sourceRef],
        set,
      });
  }
}

async function upsertProjects(
  db: Database,
  source: string,
  projects: RawProject[],
  developerIdMap: Map<string, string>
): Promise<void> {
  for (const p of projects) {
    const set = {
      developerId: p.developerSourceRef
        ? (developerIdMap.get(p.developerSourceRef) ?? null)
        : null,
      name: p.name,
      nameNormalized: p.nameNormalized ?? normalizeName(p.name),
      communityName: p.communityName ?? null,
      city: p.city ?? null,
      region: p.region ?? null,
      country: p.country ?? null,
      locationLat: p.locationLat ?? null,
      locationLng: p.locationLng ?? null,
      segment: p.segment ?? null,
      status: p.status ?? null,
      launchDate: p.launchDate ?? null,
      handoverDate: p.handoverDate ?? null,
      totalUnits: p.totalUnits ?? null,
      unitTypes: p.unitTypes ?? null,
      priceMin: p.priceMin ?? null,
      priceMax: p.priceMax ?? null,
      avgPricePerSqft: p.avgPricePerSqft ?? null,
      branded: p.branded ?? false,
      brandName: p.brandName ?? null,
      asOf: toDate(p.asOf),
      demo: false,
    };
    await db
      .insert(marketProjects)
      .values({ ...set, source, sourceRef: p.sourceRef })
      .onConflictDoUpdate({
        target: [marketProjects.source, marketProjects.sourceRef],
        set,
      });
  }
}

async function upsertBuildings(
  db: Database,
  source: string,
  buildings: RawBuilding[],
  projectIdMap: Map<string, string>
): Promise<void> {
  for (const b of buildings) {
    const set = {
      marketProjectId: b.projectSourceRef
        ? (projectIdMap.get(b.projectSourceRef) ?? null)
        : null,
      name: b.name,
      floors: b.floors ?? null,
      totalUnits: b.totalUnits ?? null,
      completionYear: b.completionYear ?? null,
      asOf: toDate(b.asOf),
      demo: false,
    };
    await db
      .insert(marketBuildings)
      .values({ ...set, source, sourceRef: b.sourceRef })
      .onConflictDoUpdate({
        target: [marketBuildings.source, marketBuildings.sourceRef],
        set,
      });
  }
}

async function upsertTransactions(
  db: Database,
  source: string,
  transactions: RawTransaction[],
  projectIdMap: Map<string, string>,
  buildingIdMap: Map<string, string>
): Promise<void> {
  for (const t of transactions) {
    const set = {
      marketProjectId: t.projectSourceRef
        ? (projectIdMap.get(t.projectSourceRef) ?? null)
        : null,
      marketBuildingId: t.buildingSourceRef
        ? (buildingIdMap.get(t.buildingSourceRef) ?? null)
        : null,
      communityName: t.communityName ?? null,
      areaName: t.areaName ?? null,
      txnType: t.txnType,
      txnDate: t.txnDate,
      unitType: t.unitType ?? null,
      areaSqm: t.areaSqm ?? null,
      bedrooms: t.bedrooms ?? null,
      priceAed: t.priceAed ?? null,
      pricePerSqft: t.pricePerSqft ?? null,
      isCash: t.isCash ?? null,
      buyerSegment: t.buyerSegment ?? null,
      buyerNationality: t.buyerNationality ?? null,
      asOf: toDate(t.asOf),
      demo: false,
    };
    await db
      .insert(marketTransactions)
      .values({ ...set, source, sourceRef: t.sourceRef })
      .onConflictDoUpdate({
        target: [marketTransactions.source, marketTransactions.sourceRef],
        set,
      });
  }
}

async function upsertPriceIndex(
  db: Database,
  source: string,
  priceIndex: RawIndex[]
): Promise<void> {
  for (const i of priceIndex) {
    const set = {
      indexValue: i.indexValue ?? null,
      avgPricePerSqft: i.avgPricePerSqft ?? null,
      yoyPct: i.yoyPct ?? null,
      asOf: toDate(i.asOf),
      demo: false,
    };
    await db
      .insert(marketPriceIndex)
      .values({
        ...set,
        areaName: i.areaName,
        segment: i.segment ?? null,
        period: i.period,
        source,
      })
      .onConflictDoUpdate({
        target: [
          marketPriceIndex.areaName,
          marketPriceIndex.segment,
          marketPriceIndex.period,
          marketPriceIndex.source,
        ],
        set,
      });
  }
}

/**
 * Upsert a `MarketBatch` into the `market_*` mirror. Every row is stamped with
 * `source` + `source_ref` + `as_of` and `demo = false`; upserts key on
 * `(source, source_ref)` (price index: `(area_name, segment, period, source)`)
 * so re-ingesting the same record is field-identical (idempotent, Req 11.2).
 *
 * Records are ingested parent-first so foreign keys resolve, including to rows
 * persisted by an earlier batch.
 */
export async function ingestMarketBatch(
  db: Database,
  source: string,
  batch: MarketBatch
): Promise<void> {
  await upsertDevelopers(db, source, batch.developers);

  const developerIdMap = await buildDeveloperIdMap(
    db,
    source,
    batch.projects.map((p) => p.developerSourceRef)
  );
  await upsertProjects(db, source, batch.projects, developerIdMap);

  const projectIdMapForBuildings = await buildProjectIdMap(
    db,
    source,
    batch.buildings.map((b) => b.projectSourceRef)
  );
  await upsertBuildings(db, source, batch.buildings, projectIdMapForBuildings);

  const projectIdMapForTxns = await buildProjectIdMap(
    db,
    source,
    batch.transactions.map((t) => t.projectSourceRef)
  );
  const buildingIdMapForTxns = await buildBuildingIdMap(
    db,
    source,
    batch.transactions.map((t) => t.buildingSourceRef)
  );
  await upsertTransactions(
    db,
    source,
    batch.transactions,
    projectIdMapForTxns,
    buildingIdMapForTxns
  );

  await upsertPriceIndex(db, source, batch.priceIndex);
}
