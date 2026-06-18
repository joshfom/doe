/**
 * MarketDataAdapter — the provider-agnostic contract for market-intelligence
 * sources (Design §Components #2; Requirements 11.1, 11.2).
 *
 * It mirrors the existing `ChannelAdapter` pattern: a thin, swappable seam so the
 * official source of record (Dubai Pulse / DRSPI) and a commercial reseller
 * (Property Monitor / Reidin) can be wired interchangeably WITHOUT changing the
 * ingestion path or the SQL readers (`find_comparables` / `market_comps`). The
 * adapter only *fetches and shapes* raw provider records; it never writes to the
 * database — `ingestMarketBatch` (see `ingest.ts`) owns the idempotent,
 * provenance-stamped upsert into the `market_*` mirror.
 *
 * Every raw record carries the provenance the ingest step stamps onto the mirror
 * row: a `sourceRef` (the provider's own stable id, the upsert key together with
 * the adapter `source`) and an `asOf` (the provider's as-of timestamp). The
 * adapter `source` discriminator becomes the row `source`; `demo` is always
 * stamped `false` for live ingest (synthetic data flows only through seed paths,
 * CC-Synthetic).
 *
 * Cross-record links are expressed by the PARENT's `sourceRef` (e.g. a project's
 * `developerSourceRef`), never by an internal UUID — the ingest step resolves
 * those references to mirror ids, so an adapter never needs to know our schema.
 */

/** Provider discriminator. Becomes the `source` column on every ingested row. */
export type MarketSource = "property_monitor" | "dubai_pulse";

/** A raw competitor developer record from a provider. */
export interface RawDeveloper {
  /** Provider-stable id; the upsert key together with `source`. */
  sourceRef: string;
  name: string;
  /** Optional pre-normalized name; ingest derives one from `name` when absent. */
  nameNormalized?: string;
  country?: string | null;
  /** Provider as-of timestamp for this record. */
  asOf?: Date | string | null;
}

/** A raw competitor project (development) record from a provider. */
export interface RawProject {
  sourceRef: string;
  /** The owning developer's `sourceRef`; resolved to `developerId` at ingest. */
  developerSourceRef?: string | null;
  name: string;
  nameNormalized?: string;
  communityName?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  segment?: "ultra_luxury" | "luxury" | "premium" | "mid" | null;
  status?:
    | "planning"
    | "off_plan"
    | "under_construction"
    | "completed"
    | "archived"
    | null;
  /** ISO date string (YYYY-MM-DD). */
  launchDate?: string | null;
  /** ISO date string (YYYY-MM-DD). */
  handoverDate?: string | null;
  totalUnits?: number | null;
  unitTypes?: string[] | null;
  priceMin?: number | null;
  priceMax?: number | null;
  avgPricePerSqft?: number | null;
  branded?: boolean | null;
  brandName?: string | null;
  asOf?: Date | string | null;
}

/** A raw building/tower record within a project. */
export interface RawBuilding {
  sourceRef: string;
  /** The owning project's `sourceRef`; resolved to `marketProjectId` at ingest. */
  projectSourceRef?: string | null;
  name: string;
  floors?: number | null;
  totalUnits?: number | null;
  completionYear?: number | null;
  asOf?: Date | string | null;
}

/** A raw transaction (comp) record — DLD/Ejari/reseller. */
export interface RawTransaction {
  sourceRef: string;
  /** Optional owning project's `sourceRef`; resolved to `marketProjectId`. */
  projectSourceRef?: string | null;
  /** Optional owning building's `sourceRef`; resolved to `marketBuildingId`. */
  buildingSourceRef?: string | null;
  communityName?: string | null;
  areaName?: string | null;
  txnType: "sale" | "rent" | "off_plan";
  /** ISO date string (YYYY-MM-DD). */
  txnDate: string;
  unitType?: string | null;
  areaSqm?: number | null;
  bedrooms?: number | null;
  priceAed?: number | null;
  pricePerSqft?: number | null;
  isCash?: boolean | null;
  /** AGGREGATE/segment label only — never individual buyer PII (Decision 4). */
  buyerSegment?: string | null;
  /** Aggregate nationality label only — never individual buyer PII. */
  buyerNationality?: string | null;
  asOf?: Date | string | null;
}

/**
 * A raw area/segment price-index record (DRSPI-style). Keyed in the mirror on
 * `(areaName, segment, period, source)` rather than a `sourceRef`.
 */
export interface RawIndex {
  areaName: string;
  segment?: string | null;
  /** e.g. "2026-Q1". */
  period: string;
  indexValue?: number | null;
  avgPricePerSqft?: number | null;
  yoyPct?: number | null;
  asOf?: Date | string | null;
}

/** A single incremental batch of raw market records pulled from a provider. */
export interface MarketBatch {
  developers: RawDeveloper[];
  projects: RawProject[];
  buildings: RawBuilding[];
  transactions: RawTransaction[];
  priceIndex: RawIndex[];
  /** Opaque cursor for the next incremental `fetchSince` poll. */
  cursor: string;
}

/** Returned by a fetch when the provider's credentials are unconfigured (Req 11.5). */
export interface UnconfiguredSource {
  unconfigured: true;
}

/**
 * Provider-agnostic market source. `fetchSince` pulls everything changed since
 * `cursor` (or everything, when `cursor` is `null`) as a single `MarketBatch`,
 * or signals `{ unconfigured: true }` when its credentials are absent so the
 * caller can record an unconfigured-source indication and continue (Req 11.5).
 */
export interface MarketDataAdapter {
  readonly source: MarketSource;
  fetchSince(cursor: string | null): Promise<MarketBatch | UnconfiguredSource>;
}

/** Type guard: narrows a fetch result to the unconfigured signal. */
export function isUnconfigured(
  result: MarketBatch | UnconfiguredSource
): result is UnconfiguredSource {
  return (result as UnconfiguredSource).unconfigured === true;
}
