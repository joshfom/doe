/**
 * Demo seed for the market catalog (`market_*` mirror) — Prospecting Workspace.
 *
 * The live market source (Property Finder reseller via RapidAPI) is gated by
 * `RAPIDAPI_KEY`; absent that — or when the provider's request quota is
 * exhausted — the workspace falls back to this seed. It is built from REAL Dubai
 * competitor data captured from the live reseller (see
 * `scripts/capture-market-data.ts` → `scripts/gen-market-demo-data.ts` →
 * `market-demo-data.ts`): real project names, real prices, real price-per-sqft,
 * and the real per-area Area_Trend summary — so `find_comparables` /
 * `market_comps` return believable, AREA-VARIED comparables (not a fixed-seed
 * synthetic set that rotates the same rows for every brief), a derived
 * Buyer_Hypothesis, and an Area_Trend headline. Stamped `demo = true`
 * (CC-Synthetic, Decision 10) so it is honestly distinguishable from live rows.
 *
 * It writes ONLY through the real, idempotent `ingestMarketBatch` keyed on
 * `(source, source_ref)`, so re-running is a field-identical no-op. No tool,
 * schema, or reader changes — this is pure data.
 */

import type { Database } from "../db";
import type {
  MarketBatch,
  RawDeveloper,
  RawIndex,
  RawProject,
  RawTransaction,
} from "../market/adapter";
import { ingestMarketBatch } from "../market/ingest";
import {
  DEMO_DEVELOPERS,
  DEMO_PRICE_INDEX,
  DEMO_PROJECTS,
  DEMO_TRANSACTIONS,
} from "./market-demo-data";

/** The reseller source discriminator — same posture as the live demo feed. */
const SOURCE = "property_finder_reseller";

/**
 * Build the full demo {@link MarketBatch} from the captured real data. Pure +
 * deterministic (the underlying data is static); only the `asOf` provenance
 * stamp reflects the seed run time.
 */
export function buildMarketDemoBatch(asOf: Date = new Date()): MarketBatch {
  const developers: RawDeveloper[] = DEMO_DEVELOPERS.map((d) => ({
    sourceRef: d.sourceRef,
    name: d.name,
    country: "AE",
    asOf,
  }));

  const projects: RawProject[] = DEMO_PROJECTS.map((p) => ({
    sourceRef: p.ref,
    developerSourceRef: p.developerRef,
    name: p.name,
    communityName: p.area,
    city: "Dubai",
    region: "Dubai",
    country: "AE",
    locationLat: p.lat ?? null,
    locationLng: p.lng ?? null,
    segment: p.segment,
    status: "completed",
    unitTypes: p.unitTypes,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    avgPricePerSqft: p.avgPricePerSqft,
    asOf,
  }));

  const transactions: RawTransaction[] = DEMO_TRANSACTIONS.map((t) => ({
    sourceRef: t.sourceRef,
    projectSourceRef: t.projectSourceRef,
    communityName: t.communityName,
    areaName: t.areaName,
    txnType: t.txnType,
    txnDate: t.txnDate,
    unitType: t.unitType,
    areaSqm: t.areaSqm,
    bedrooms: t.bedrooms,
    priceAed: t.priceAed,
    pricePerSqft: t.pricePerSqft,
    buyerSegment: t.buyerSegment,
    buyerNationality: t.buyerNationality,
    asOf,
  }));

  const priceIndex: RawIndex[] = DEMO_PRICE_INDEX.map((i) => ({
    areaName: i.areaName,
    segment: i.segment,
    period: i.period,
    indexValue: i.indexValue,
    avgPricePerSqft: i.avgPricePerSqft,
    yoyPct: i.yoyPct,
    roiPct: i.roiPct,
    volume: i.volume,
    trend: i.trend,
    asOf,
  }));

  return {
    developers,
    projects,
    buildings: [],
    transactions,
    priceIndex,
    cursor: "demo",
  };
}

export interface MarketDemoSummary {
  developers: number;
  projects: number;
  transactions: number;
  priceIndex: number;
}

/** Seed the demo market catalog via the real idempotent ingest. */
export async function seedMarketDemo(
  db: Database
): Promise<MarketDemoSummary> {
  const batch = buildMarketDemoBatch();
  await ingestMarketBatch(db, SOURCE, batch, { demo: true });
  return {
    developers: batch.developers.length,
    projects: batch.projects.length,
    transactions: batch.transactions.length,
    priceIndex: batch.priceIndex.length,
  };
}
