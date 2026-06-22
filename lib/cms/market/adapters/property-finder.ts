/**
 * Property Finder reseller `MarketDataAdapter` (S7 increment, Design §3;
 * Requirements 14.1, 14.2, 14.3, 14.6, 14.9). **[deps]**
 *
 * A single concrete adapter implementing the EXISTING {@link MarketDataAdapter}
 * contract (`../adapter`), wired (by task 10.9) into the EXISTING
 * `resolveMarketAdapter()` seam in `workers/market-sync.ts`. It is the only new
 * code that talks to a provider, and it does so exclusively through the
 * injectable {@link HttpTransport} seam reused from the prospecting providers
 * (`../../prospecting/providers/transport`) — it NEVER calls `fetch` directly,
 * so tests inject a fake transport and the suite never hits the network.
 *
 * `source = "property_finder_reseller"` is an UNOFFICIAL / scraped reseller
 * source (RapidAPI `uae-real-estate-data-api1`), acceptable for the demo with
 * provenance stamped on every row, and swappable to an official `"dld_official"`
 * adapter behind this same contract with zero changes to the mirror schema, the
 * readers, or the tools (Req 14.9). When the API key is absent it returns
 * `{ unconfigured: true }` WITHOUT any network call so the worker idles cleanly
 * (Req 14.1).
 *
 * The adapter only *fetches and shapes* raw provider records into the existing
 * {@link RawTransaction} / {@link RawIndex} shapes; the EXISTING
 * `ingestMarketBatch` owns the idempotent, provenance-stamped upsert into the
 * `market_*` mirror keyed `(source, source_ref)` (Req 14.5), so re-ingest is a
 * row-level no-op (Property 14).
 */

import type {
  MarketBatch,
  MarketDataAdapter,
  RawIndex,
  RawProject,
  RawTransaction,
  UnconfiguredSource,
} from "../adapter";
import {
  defaultClock,
  defaultTransport,
  type Clock,
  type HttpTransport,
} from "../../prospecting/providers/transport"; // reuse the existing seam

// ── Constants ────────────────────────────────────────────────────────────────

/** The confirmed reseller host (override via `PROPERTY_FINDER_HOST`). */
export const PROPERTY_FINDER_DEFAULT_HOST =
  "uae-real-estate-data-api1.p.rapidapi.com";

/** The reseller `source` discriminator stamped onto every ingested row. */
export const PROPERTY_FINDER_SOURCE = "property_finder_reseller" as const;

/** Square-feet → square-metres conversion factor (Req 14.2, Property 13). */
export const SQFT_TO_SQM = 0.092903;

/** The confirmed `/get-transactions` path (transactions + Area_Trend summary). */
export const GET_TRANSACTIONS_PATH = "/get-transactions";

/**
 * Location AutoComplete path + query param.
 *
 * CONFIRMED (Req 14.3) against the live reseller endpoint:
 *   GET /autocomplete-location?query=Dubai%20Marina
 *   → { success, data: [{ id, name, coordinates: { lat, lon } }, …] }
 * The first `data[]` element is the matched area (e.g. id 50 = "Dubai Marina");
 * subsequent elements are buildings/towers within it. The response is parsed by
 * {@link extractLocationFromAutoComplete}, which reads `data[0].id`/`.name`.
 * The call stays behind the {@link HttpTransport} seam so tests mock it.
 */
export const AUTOCOMPLETE_PATH = "/autocomplete-location";
/** The AutoComplete query parameter carrying the area name. */
export const AUTOCOMPLETE_QUERY_PARAM = "query";

/** Default period window for the transactions query. */
const DEFAULT_PERIOD = "1y";
/** Default page-cache TTL (free-tier hard cache, Req 14.6). */
const DEFAULT_PAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
/** Base backoff after a 429, doubled per consecutive 429 (Req 14.6). */
const BACKOFF_BASE_MS = 60 * 1000; // 1m
/** Cap on the exponential backoff window. */
const BACKOFF_MAX_MS = 60 * 60 * 1000; // 1h

// ── Config + injectable deps ─────────────────────────────────────────────────

export interface PropertyFinderConfig {
  /** RapidAPI key (`RAPIDAPI_KEY` or `UAE_REE_API_KEY`). Absent → unconfigured. */
  apiKey: string;
  /** RapidAPI host. Defaults to {@link PROPERTY_FINDER_DEFAULT_HOST}. */
  host?: string;
  /** Own area/community names to resolve + poll (drives location resolution). */
  areas?: string[];
  /** Period window for the transactions query. Defaults to `"1y"`. */
  period?: string;
  /** Stamp ingested rows `demo` (threaded by the worker via `ingestMarketBatch`). */
  demo?: boolean;
}

/**
 * DB-backed cache mapping an own area name → the provider `location_id`
 * (Req 14.3). Injected so the adapter stays DB-agnostic and testable; the
 * worker tier (task 10.9) supplies a `location_resolutions`-table-backed
 * implementation. A cache hit skips the AutoComplete call entirely.
 */
export interface LocationResolutionCache {
  get(source: string, areaNameNormalized: string): Promise<string | null>;
  put(
    source: string,
    areaNameNormalized: string,
    locationId: string,
    displayName: string | null,
    asOf: Date
  ): Promise<void>;
}

/** A single mapped, cacheable page of `/get-transactions` results. */
export interface CachedPage {
  transactions: RawTransaction[];
  priceIndex: RawIndex[];
  /** Competitor projects derived from this page's transactions (Req 14.x). */
  projects: RawProject[];
  totalPages: number;
}

/**
 * Hard page cache keyed on `(locationId, page, period)` (Req 14.6). Repeated
 * ticks within the TTL serve from cache rather than re-billing the provider.
 * Injected so the worker can persist it; defaults to an in-memory TTL cache.
 */
export interface PageCache {
  get(key: string): Promise<CachedPage | null>;
  set(key: string, page: CachedPage): Promise<void>;
}

export interface PropertyFinderDeps {
  /** HTTP transport; defaults to the platform `fetch`. Tests inject a fake. */
  transport?: HttpTransport;
  /** Clock for `asOf` stamps; defaults to wall-clock. Tests inject a fixed one. */
  clock?: Clock;
  /** Location-id resolution cache (Req 14.3); defaults to an in-memory cache. */
  locationCache?: LocationResolutionCache;
  /** Free-tier hard page cache (Req 14.6); defaults to an in-memory TTL cache. */
  pageCache?: PageCache;
}

// ── Cursor ───────────────────────────────────────────────────────────────────

interface CursorState {
  locationId: string;
  page: number;
  period: string;
}

/** Encode a cursor as base64 `{ locationId, page, period }`. */
export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64");
}

/** Decode a base64 cursor; returns `null` on absent/malformed input. */
export function decodeCursor(cursor: string | null): CursorState | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64").toString("utf8")
    ) as Partial<CursorState>;
    if (
      typeof parsed.locationId === "string" &&
      typeof parsed.page === "number" &&
      typeof parsed.period === "string"
    ) {
      return { locationId: parsed.locationId, page: parsed.page, period: parsed.period };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Default in-memory caches ─────────────────────────────────────────────────

/** A process-local TTL {@link PageCache} (the worker tier may inject a DB one). */
export class InMemoryPageCache implements PageCache {
  private readonly store = new Map<string, { page: CachedPage; expiresAt: number }>();
  constructor(
    private readonly ttlMs: number = DEFAULT_PAGE_CACHE_TTL_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  async get(key: string): Promise<CachedPage | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (this.now() >= hit.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return hit.page;
  }

  async set(key: string, page: CachedPage): Promise<void> {
    this.store.set(key, { page, expiresAt: this.now() + this.ttlMs });
  }
}

/** A process-local {@link LocationResolutionCache} fallback. */
export class InMemoryLocationCache implements LocationResolutionCache {
  private readonly store = new Map<string, string>();
  private key(source: string, area: string): string {
    return `${source}::${area}`;
  }
  async get(source: string, areaNameNormalized: string): Promise<string | null> {
    return this.store.get(this.key(source, areaNameNormalized)) ?? null;
  }
  async put(
    source: string,
    areaNameNormalized: string,
    locationId: string
  ): Promise<void> {
    this.store.set(this.key(source, areaNameNormalized), locationId);
  }
}

// ── Normalization (mirrors the mirror's trim/lower/collapse rule) ────────────

/** Deterministic name normalization: trim, lower-case, collapse whitespace. */
export function normalizeAreaName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Provider payload shapes (the subset this adapter reads) ──────────────────

interface PfTransaction {
  id?: string | number;
  high_level_location_name?: string | null;
  location_name?: string | null;
  location_slug?: string | null;
  price?: number | null;
  price_per_sqft?: number | null;
  property_size?: number | null; // sqft
  bedrooms?: number | null;
  property_type?: string | null;
  status?: string | null;
  transaction_date?: string | null;
}

interface PfSummary {
  sale_avg_price?: number | null;
  sale_avg_price_change?: number | null;
  sale_avg_price_per_sqft?: number | null;
  sale_avg_price_per_sqft_change?: number | null;
  roi?: number | null;
  volume?: number | null;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

const EMPTY_BATCH = (cursor: string): MarketBatch => ({
  developers: [],
  projects: [],
  buildings: [],
  transactions: [],
  priceIndex: [],
  cursor,
});

export class PropertyFinderAdapter implements MarketDataAdapter {
  readonly source = PROPERTY_FINDER_SOURCE;

  private readonly transport: HttpTransport;
  private readonly clock: Clock;
  private readonly locationCache: LocationResolutionCache;
  private readonly pageCache: PageCache;

  /** Wall-clock millis until which the adapter is backing off after a 429. */
  private backoffUntil = 0;
  /** Count of consecutive 429s (drives the exponential backoff). */
  private backoffAttempt = 0;

  constructor(
    private readonly config: PropertyFinderConfig,
    deps: PropertyFinderDeps = {}
  ) {
    this.transport = deps.transport ?? defaultTransport;
    this.clock = deps.clock ?? defaultClock;
    this.locationCache = deps.locationCache ?? new InMemoryLocationCache();
    this.pageCache = deps.pageCache ?? new InMemoryPageCache();
  }

  private get host(): string {
    return this.config.host ?? PROPERTY_FINDER_DEFAULT_HOST;
  }

  private get authHeaders(): Record<string, string> {
    return {
      "X-RapidAPI-Key": this.config.apiKey,
      "X-RapidAPI-Host": this.host,
    };
  }

  async fetchSince(
    cursor: string | null
  ): Promise<MarketBatch | UnconfiguredSource> {
    // No key → unconfigured, with NO network call (Req 14.1).
    if (!this.config.apiKey) return { unconfigured: true };

    const period = this.config.period ?? DEFAULT_PERIOD;
    const areas = (this.config.areas ?? []).filter((a) => a.trim().length > 0);

    // Resolve the ordered configured areas → location ids (cached; Req 14.3).
    const resolved = await this.resolveAreas(areas, period);
    if (resolved.length === 0) {
      // Nothing configured to poll — idle with an empty, advance-free batch.
      return EMPTY_BATCH(cursor ?? "");
    }

    // Seed from the cursor, or from the first resolved area at page 1.
    const decoded = decodeCursor(cursor);
    let current = this.normalizeCursor(decoded, resolved, period);
    const incomingCursor = encodeCursor(current);

    const areaName = this.areaNameForLocation(current.locationId, resolved);
    const cacheKey = pageCacheKey(current);

    // 1. Hard page cache hit → serve without a transport call (Req 14.6).
    const cached = await this.pageCache.get(cacheKey);
    if (cached) {
      const next = this.advance(current, cached.totalPages, resolved, period);
      return {
        ...EMPTY_BATCH(encodeCursor(next)),
        projects: cached.projects ?? [],
        transactions: cached.transactions,
        priceIndex: cached.priceIndex,
      };
    }

    // 2. In a backoff window after a recent 429 → idle, keep the cursor.
    if (this.clock().getTime() < this.backoffUntil) {
      return EMPTY_BATCH(incomingCursor);
    }

    // 3. Billable transport call.
    const url = buildTransactionsUrl(this.host, current);
    const res = await this.transport(url, {
      method: "GET",
      headers: this.authHeaders,
    });

    // 429 → exponential backoff, empty batch, KEEP the cursor (Req 14.6).
    if (res.status === 429) {
      this.enterBackoff();
      return EMPTY_BATCH(incomingCursor);
    }
    if (!res.ok) {
      throw new Error(
        `property_finder /get-transactions failed (${res.status})`
      );
    }
    this.resetBackoff();

    const payload = await res.json();
    const asOf = this.clock();
    const { transactions, summary, totalPages } = parseTransactionsPayload(payload);

    const mappedTxns = mapTransactions(transactions, asOf);
    const mappedIndex = mapSummary(summary, areaName, period, asOf);

    // Derive competitor projects from this page's transactions and link each
    // mapped transaction to its project, so `find_comparables` ranks LIVE
    // projects (not just demo-seeded ones).
    const { projects, projectRefByTxnId } = deriveProjects(transactions, asOf);
    for (const m of mappedTxns) {
      const ref = projectRefByTxnId.get(m.sourceRef);
      if (ref) m.projectSourceRef = ref;
    }

    const page: CachedPage = {
      transactions: mappedTxns,
      priceIndex: mappedIndex,
      projects,
      totalPages,
    };
    await this.pageCache.set(cacheKey, page);

    const next = this.advance(current, totalPages, resolved, period);
    return {
      ...EMPTY_BATCH(encodeCursor(next)),
      projects,
      transactions: mappedTxns,
      priceIndex: mappedIndex,
    };
  }

  // ── Location resolution ────────────────────────────────────────────────────

  /** Resolve the configured areas → `{ name, normalized, locationId }`, cached. */
  private async resolveAreas(
    areas: string[],
    _period: string
  ): Promise<Array<{ name: string; normalized: string; locationId: string }>> {
    const out: Array<{ name: string; normalized: string; locationId: string }> = [];
    for (const name of areas) {
      const normalized = normalizeAreaName(name);
      if (out.some((r) => r.normalized === normalized)) continue; // dedupe
      const locationId = await this.resolveLocation(name, normalized);
      if (locationId) out.push({ name, normalized, locationId });
    }
    return out;
  }

  /**
   * Resolve a single area name → provider `location_id`, hitting the
   * AutoComplete endpoint at most once per distinct normalized name (Req 14.3).
   */
  private async resolveLocation(
    name: string,
    normalized: string
  ): Promise<string | null> {
    const cached = await this.locationCache.get(this.source, normalized);
    if (cached) return cached; // cache hit → no AutoComplete call

    const url = `https://${this.host}${AUTOCOMPLETE_PATH}?${AUTOCOMPLETE_QUERY_PARAM}=${encodeURIComponent(name)}`;
    const res = await this.transport(url, {
      method: "GET",
      headers: this.authHeaders,
    });
    if (res.status === 429) {
      this.enterBackoff();
      return null;
    }
    if (!res.ok) return null;

    const payload = await res.json();
    const loc = extractLocationFromAutoComplete(payload);
    if (!loc) return null;

    await this.locationCache.put(
      this.source,
      normalized,
      loc.id,
      loc.name ?? null,
      this.clock()
    );
    return loc.id;
  }

  // ── Cursor helpers ──────────────────────────────────────────────────────────

  /** Snap a decoded cursor onto a valid resolved location, else seed page 1. */
  private normalizeCursor(
    decoded: CursorState | null,
    resolved: Array<{ locationId: string }>,
    period: string
  ): CursorState {
    if (
      decoded &&
      resolved.some((r) => r.locationId === decoded.locationId) &&
      decoded.page >= 1
    ) {
      return { ...decoded, period };
    }
    return { locationId: resolved[0].locationId, page: 1, period };
  }

  /** Find the configured area name for a resolved location id. */
  private areaNameForLocation(
    locationId: string,
    resolved: Array<{ name: string; locationId: string }>
  ): string | null {
    return resolved.find((r) => r.locationId === locationId)?.name ?? null;
  }

  /**
   * Compute the next cursor: advance the page within the current location until
   * `total_pages`, then roll to the next configured area, wrapping to page 1 of
   * the first area for the next refresh cycle.
   */
  private advance(
    current: CursorState,
    totalPages: number,
    resolved: Array<{ locationId: string }>,
    period: string
  ): CursorState {
    if (current.page < totalPages) {
      return { ...current, page: current.page + 1 };
    }
    const idx = resolved.findIndex((r) => r.locationId === current.locationId);
    const nextIdx = idx + 1 < resolved.length ? idx + 1 : 0;
    return { locationId: resolved[nextIdx].locationId, page: 1, period };
  }

  // ── Backoff ──────────────────────────────────────────────────────────────────

  private enterBackoff(): void {
    this.backoffAttempt += 1;
    const wait = Math.min(
      BACKOFF_BASE_MS * 2 ** (this.backoffAttempt - 1),
      BACKOFF_MAX_MS
    );
    this.backoffUntil = this.clock().getTime() + wait;
  }

  private resetBackoff(): void {
    this.backoffAttempt = 0;
    this.backoffUntil = 0;
  }
}

// ── Pure helpers (exported for the property tests, tasks 10.10/10.12) ────────

/** Page-cache key for a `(locationId, page, period)` triple. */
export function pageCacheKey(c: CursorState): string {
  return `${c.locationId}|${c.page}|${c.period}`;
}

/** Build the `/get-transactions` request URL for a cursor (CONFIRMED query). */
export function buildTransactionsUrl(host: string, c: CursorState): string {
  // Only the required params — the reseller rejects an EMPTY `property_type` /
  // `bedrooms` (invalid_enum_value), so optional filters are omitted, not sent
  // blank.
  const params = new URLSearchParams({
    page: String(c.page),
    period: c.period,
    location_id: c.locationId,
    transaction_type: "sold",
  });
  return `https://${host}${GET_TRANSACTIONS_PATH}?${params.toString()}`;
}

/**
 * Defensively read the `/get-transactions` envelope:
 * transactions at `data.data.attributes.transactions`, the Area_Trend at
 * `data.data.attributes.summary`, and `total_pages` on the same attributes
 * block. A malformed payload yields empty arrays — never invented rows
 * (Design §Error Handling, CC-SQL).
 */
export function parseTransactionsPayload(payload: unknown): {
  transactions: PfTransaction[];
  summary: PfSummary | null;
  totalPages: number;
} {
  const root = payload as Record<string, any> | null | undefined;
  const attrs = root?.data?.data?.attributes ?? root?.data?.attributes;
  const transactions: PfTransaction[] = Array.isArray(attrs?.transactions)
    ? attrs.transactions
    : [];
  const summary: PfSummary | null =
    attrs?.summary && typeof attrs.summary === "object" ? attrs.summary : null;
  const rawTotal = Number(attrs?.total_pages);
  const totalPages = Number.isFinite(rawTotal) && rawTotal >= 1 ? rawTotal : 1;
  return { transactions, summary, totalPages };
}

/**
 * Map provider transactions → {@link RawTransaction}[], stamping `asOf` from the
 * injected clock. Transactions without a stable `id` are dropped (untrusted
 * source — never invented), since `id` is the `(source, source_ref)` key.
 */
export function mapTransactions(
  transactions: PfTransaction[],
  asOf: Date
): RawTransaction[] {
  const out: RawTransaction[] = [];
  for (const t of transactions) {
    if (t.id == null || String(t.id).length === 0) continue; // unkeyable → drop
    const sqft = numOrNull(t.property_size);
    out.push({
      sourceRef: String(t.id),
      areaName: t.high_level_location_name ?? null,
      communityName: t.high_level_location_name ?? null,
      txnType: "sale", // query is transaction_type=sold
      txnDate: t.transaction_date ?? "",
      unitType: t.property_type ?? null,
      areaSqm: sqft != null ? sqft * SQFT_TO_SQM : null,
      bedrooms: numOrNull(t.bedrooms),
      priceAed: numOrNull(t.price),
      pricePerSqft: numOrNull(t.price_per_sqft),
      asOf,
    });
  }
  return out;
}

/**
 * Map the `summary` block → a single Area_Trend {@link RawIndex} for
 * `(areaName, segment, period)`. A missing summary or area name yields no row
 * (Design §Error Handling — no guessed figures). `yoyPct` is sourced from
 * `sale_avg_price_per_sqft_change`; the raw avg-price + change figures are
 * carried verbatim in `trend` so nothing is model-computed.
 */
export function mapSummary(
  summary: PfSummary | null,
  areaName: string | null,
  period: string,
  asOf: Date
): RawIndex[] {
  if (!summary || !areaName) return [];
  // `summary.volume` is a (possibly fractional) volume-change figure, but the
  // mirror's `volume` column is an integer — round it so ingest never fails on a
  // float (the raw figure is still carried verbatim in `trend`).
  const rawVolume = numOrNull(summary.volume);
  return [
    {
      areaName,
      segment: null,
      period,
      avgPricePerSqft: numOrNull(summary.sale_avg_price_per_sqft),
      yoyPct: numOrNull(summary.sale_avg_price_per_sqft_change),
      roiPct: numOrNull(summary.roi),
      volume: rawVolume == null ? null : Math.round(rawVolume),
      trend: {
        saleAvgPrice: summary.sale_avg_price ?? null,
        saleAvgPriceChange: summary.sale_avg_price_change ?? null,
      },
      asOf,
    },
  ];
}

/** Slugify a name for a stable project sourceRef fallback. */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Classify a project's market segment from its average price-per-sqft (AED). */
function segmentFromPpsf(
  ppsf: number
): "ultra_luxury" | "luxury" | "premium" | "mid" {
  if (ppsf >= 3500) return "ultra_luxury";
  if (ppsf >= 2200) return "luxury";
  if (ppsf >= 1500) return "premium";
  return "mid";
}

/** Map a provider `property_type` → the mirror's unit-type vocabulary. */
function projectUnitType(t: string | null | undefined): string {
  const s = (t ?? "").toLowerCase();
  if (s.includes("villa")) return "villa";
  if (s.includes("penthouse")) return "penthouse";
  if (s.includes("town")) return "townhouse";
  if (s.includes("office") || s.includes("retail") || s.includes("commercial"))
    return "office";
  return "apartment";
}

/**
 * Derive competitor {@link RawProject}s from a page of provider transactions,
 * grouping by `location_slug` (or a slug of `location_name`). Each project's
 * price band + avg price-per-sqft + segment + unit mix are aggregated from its
 * transactions on this page, and a `projectSourceRef → txn id` map is returned
 * so the caller can link each mapped transaction to its project (which lets
 * `find_comparables` rank LIVE projects, not just demo-seeded ones). Re-ingest
 * stays idempotent because the project `sourceRef` is stable per `(source, ref)`.
 */
export function deriveProjects(
  transactions: PfTransaction[],
  asOf: Date
): { projects: RawProject[]; projectRefByTxnId: Map<string, string> } {
  interface Group {
    name: string;
    area: string | null;
    ppsfs: number[];
    prices: number[];
    unitTypes: Set<string>;
  }
  const groups = new Map<string, Group>();
  const projectRefByTxnId = new Map<string, string>();

  for (const t of transactions) {
    const name = (t.location_name ?? "").trim();
    if (!name || t.id == null || String(t.id).length === 0) continue;
    const slug = (t.location_slug ?? "").trim() || slugifyName(name);
    const ref = `pf-proj-${slug}`;
    projectRefByTxnId.set(String(t.id), ref);

    let g = groups.get(ref);
    if (!g) {
      g = {
        name,
        area: t.high_level_location_name ?? null,
        ppsfs: [],
        prices: [],
        unitTypes: new Set(),
      };
      groups.set(ref, g);
    }
    if (typeof t.price_per_sqft === "number" && t.price_per_sqft > 0)
      g.ppsfs.push(t.price_per_sqft);
    if (typeof t.price === "number" && t.price > 0) g.prices.push(t.price);
    g.unitTypes.add(projectUnitType(t.property_type));
  }

  const projects: RawProject[] = [];
  for (const [ref, g] of groups) {
    const avgPpsf =
      g.ppsfs.length > 0
        ? Math.round(g.ppsfs.reduce((a, b) => a + b, 0) / g.ppsfs.length)
        : null;
    projects.push({
      sourceRef: ref,
      name: g.name,
      communityName: g.area,
      city: "Dubai",
      region: "Dubai",
      country: "AE",
      segment: avgPpsf != null ? segmentFromPpsf(avgPpsf) : null,
      status: "completed",
      unitTypes: [...g.unitTypes],
      priceMin: g.prices.length > 0 ? Math.min(...g.prices) : null,
      priceMax: g.prices.length > 0 ? Math.max(...g.prices) : null,
      avgPricePerSqft: avgPpsf,
      asOf,
    });
  }
  return { projects, projectRefByTxnId };
}

/**
 * Extract `{ id, name }` from an AutoComplete payload across the common RapidAPI
 * envelope shapes. Returns `null` when no location is present. See the
 * {@link AUTOCOMPLETE_PATH} assumption note.
 */
export function extractLocationFromAutoComplete(
  payload: unknown
): { id: string; name: string | null } | null {
  const root = payload as Record<string, any> | null | undefined;
  const candidates: unknown =
    root?.data?.data ??
    root?.data ??
    root?.results ??
    root?.locations ??
    root;
  const first = Array.isArray(candidates)
    ? candidates[0]
    : Array.isArray((candidates as any)?.attributes?.locations)
      ? (candidates as any).attributes.locations[0]
      : undefined;
  if (!first || typeof first !== "object") return null;
  const el = first as Record<string, any>;
  const rawId =
    el.id ?? el.location_id ?? el.attributes?.id ?? el.attributes?.location_id;
  if (rawId == null || String(rawId).length === 0) return null;
  const name =
    el.name ?? el.location_name ?? el.attributes?.name ?? el.display_name ?? null;
  return { id: String(rawId), name: name != null ? String(name) : null };
}

/** Coerce a possibly-null/NaN numeric to `number | null`. */
function numOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
