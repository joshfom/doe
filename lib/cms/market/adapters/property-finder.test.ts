import { describe, it, expect, vi } from "vitest";

import {
  PropertyFinderAdapter,
  PROPERTY_FINDER_SOURCE,
  SQFT_TO_SQM,
  InMemoryLocationCache,
  InMemoryPageCache,
  decodeCursor,
  encodeCursor,
  buildTransactionsUrl,
  parseTransactionsPayload,
  mapTransactions,
  mapSummary,
  extractLocationFromAutoComplete,
  type LocationResolutionCache,
} from "./property-finder";
import { isUnconfigured } from "../adapter";
import type { HttpResponse, HttpTransport } from "../../prospecting/providers/transport";

/**
 * Unit tests for the Property Finder reseller `MarketDataAdapter` (task 10.7).
 *
 * Per [deps]: the HTTP transport is ALWAYS mocked — the suite never hits the
 * network. The dedicated property tests (Properties 13/14/15) live in tasks
 * 10.10/10.11/10.12; these unit tests cover the contract behaviour:
 *   - Req 14.1 — absent key → `{ unconfigured: true }` with NO transport call.
 *   - Req 14.2 — the field map (incl. property_size sqft → areaSqm sqm) + summary.
 *   - Req 14.3 — AutoComplete resolves once per area, then serves the cache.
 *   - Req 14.6 — page cache + 429 backoff (empty batch, cursor retained).
 */

const ASOF = new Date("2026-02-01T00:00:00.000Z");
const FIXED_CLOCK = () => ASOF;

const TXN_PAYLOAD = {
  data: {
    data: {
      attributes: {
        transactions: [
          {
            id: "TX-1",
            high_level_location_name: "Dubai Marina",
            location_name: "Marina Gate 1",
            price: 2_500_000,
            price_per_sqft: 2129,
            property_size: 1000, // sqft
            bedrooms: 2,
            property_type: "Apartment",
            status: "sold",
            transaction_date: "2026-01-15",
          },
        ],
        summary: {
          sale_avg_price: 2_400_000,
          sale_avg_price_change: 4.2,
          sale_avg_price_per_sqft: 2100,
          sale_avg_price_per_sqft_change: 5.6,
          roi: 6.1,
          volume: 312,
        },
        total_pages: 1,
        total_items: 1,
      },
    },
  },
};

const AUTOCOMPLETE_PAYLOAD = {
  data: { data: [{ id: "LOC-MARINA", name: "Dubai Marina" }] },
};

/** A status-aware transport mock: AutoComplete → location, otherwise → txns. */
function mockTransport(opts?: {
  txnStatus?: number;
  txnBody?: unknown;
}): { transport: HttpTransport; calls: () => string[] } {
  const urls: string[] = [];
  const fn = vi.fn(async (url: string): Promise<HttpResponse> => {
    urls.push(url);
    if (url.includes("/autocomplete-location")) {
      return { ok: true, status: 200, json: async () => AUTOCOMPLETE_PAYLOAD };
    }
    const status = opts?.txnStatus ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts?.txnBody ?? TXN_PAYLOAD,
    };
  });
  return { transport: fn, calls: () => urls };
}

describe("PropertyFinderAdapter — unconfigured (Req 14.1)", () => {
  it("returns { unconfigured: true } with NO transport call when key absent", async () => {
    const { transport, calls } = mockTransport();
    const adapter = new PropertyFinderAdapter(
      { apiKey: "", areas: ["Dubai Marina"] },
      { transport, clock: FIXED_CLOCK }
    );
    const result = await adapter.fetchSince(null);
    expect(isUnconfigured(result)).toBe(true);
    expect(calls()).toHaveLength(0);
  });

  it("exposes the reseller source discriminator", () => {
    const adapter = new PropertyFinderAdapter({ apiKey: "k" });
    expect(adapter.source).toBe(PROPERTY_FINDER_SOURCE);
  });
});

describe("PropertyFinderAdapter — /get-transactions mapping (Req 14.2)", () => {
  it("maps transactions + summary, converting sqft → sqm and stamping asOf", async () => {
    const { transport } = mockTransport();
    const adapter = new PropertyFinderAdapter(
      { apiKey: "k", areas: ["Dubai Marina"], period: "1y" },
      { transport, clock: FIXED_CLOCK }
    );
    const result = await adapter.fetchSince(null);
    if (isUnconfigured(result)) throw new Error("unexpected unconfigured");

    expect(result.transactions).toHaveLength(1);
    const txn = result.transactions[0];
    expect(txn.sourceRef).toBe("TX-1");
    expect(txn.areaName).toBe("Dubai Marina");
    expect(txn.communityName).toBe("Dubai Marina");
    expect(txn.txnType).toBe("sale");
    expect(txn.txnDate).toBe("2026-01-15");
    expect(txn.unitType).toBe("Apartment");
    expect(txn.bedrooms).toBe(2);
    expect(txn.priceAed).toBe(2_500_000);
    expect(txn.pricePerSqft).toBe(2129);
    expect(txn.areaSqm).toBeCloseTo(1000 * SQFT_TO_SQM, 6);
    expect(txn.asOf).toEqual(ASOF);

    expect(result.priceIndex).toHaveLength(1);
    const idx = result.priceIndex[0];
    expect(idx.areaName).toBe("Dubai Marina");
    expect(idx.avgPricePerSqft).toBe(2100);
    expect(idx.yoyPct).toBe(5.6);
    expect(idx.roiPct).toBe(6.1);
    expect(idx.volume).toBe(312);
    expect(idx.trend).toEqual({ saleAvgPrice: 2_400_000, saleAvgPriceChange: 4.2 });
    expect(idx.asOf).toEqual(ASOF);
  });
});

describe("PropertyFinderAdapter — location resolution caching (Req 14.3)", () => {
  it("calls AutoComplete at most once per distinct area then serves the cache", async () => {
    const { transport, calls } = mockTransport();
    const locationCache = new InMemoryLocationCache();
    const adapter = new PropertyFinderAdapter(
      { apiKey: "k", areas: ["Dubai Marina"] },
      { transport, clock: FIXED_CLOCK, locationCache }
    );

    const first = await adapter.fetchSince(null);
    if (isUnconfigured(first)) throw new Error("unexpected unconfigured");
    // Second fetch with a fresh page cursor still must not re-resolve location.
    await adapter.fetchSince(first.cursor);

    const autoCompleteCalls = calls().filter((u) => u.includes("/autocomplete-location"));
    expect(autoCompleteCalls).toHaveLength(1);
  });

  it("skips AutoComplete entirely on a pre-seeded cache hit", async () => {
    const seeded: LocationResolutionCache = {
      get: async () => "LOC-PRESEEDED",
      put: async () => {},
    };
    const { transport, calls } = mockTransport();
    const adapter = new PropertyFinderAdapter(
      { apiKey: "k", areas: ["Dubai Marina"] },
      { transport, clock: FIXED_CLOCK, locationCache: seeded }
    );
    await adapter.fetchSince(null);
    expect(calls().some((u) => u.includes("/autocomplete-location"))).toBe(false);
  });
});

describe("PropertyFinderAdapter — free-tier guardrails (Req 14.6)", () => {
  it("serves a repeated (locationId, page, period) from the page cache", async () => {
    const { transport, calls } = mockTransport();
    const pageCache = new InMemoryPageCache(60_000, () => ASOF.getTime());
    const adapter = new PropertyFinderAdapter(
      { apiKey: "k", areas: ["Dubai Marina"] },
      { transport, clock: FIXED_CLOCK, pageCache }
    );

    const seedCursor = encodeCursor({
      locationId: "LOC-MARINA",
      page: 1,
      period: "1y",
    });
    await adapter.fetchSince(seedCursor);
    const txnCallsAfterFirst = calls().filter((u) =>
      u.includes("/get-transactions")
    ).length;
    await adapter.fetchSince(seedCursor);
    const txnCallsAfterSecond = calls().filter((u) =>
      u.includes("/get-transactions")
    ).length;

    expect(txnCallsAfterFirst).toBe(1);
    expect(txnCallsAfterSecond).toBe(1); // served from page cache, no re-bill
  });

  it("on 429 returns an empty batch and retains the cursor", async () => {
    const { transport } = mockTransport({ txnStatus: 429 });
    const adapter = new PropertyFinderAdapter(
      { apiKey: "k", areas: ["Dubai Marina"] },
      { transport, clock: FIXED_CLOCK }
    );
    const seedCursor = encodeCursor({
      locationId: "LOC-MARINA",
      page: 1,
      period: "1y",
    });
    const result = await adapter.fetchSince(seedCursor);
    if (isUnconfigured(result)) throw new Error("unexpected unconfigured");
    expect(result.transactions).toHaveLength(0);
    expect(result.priceIndex).toHaveLength(0);
    expect(result.cursor).toBe(seedCursor); // cursor retained
  });
});

describe("PropertyFinderAdapter — pure helpers", () => {
  it("round-trips the base64 cursor and rejects malformed input", () => {
    const state = { locationId: "L1", page: 3, period: "1y" };
    expect(decodeCursor(encodeCursor(state))).toEqual(state);
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-base64-json")).toBeNull();
  });

  it("builds the confirmed /get-transactions query", () => {
    const url = buildTransactionsUrl("host.test", {
      locationId: "L1",
      page: 2,
      period: "1y",
    });
    expect(url).toContain("/get-transactions?");
    expect(url).toContain("transaction_type=sold");
    expect(url).toContain("page=2");
    expect(url).toContain("location_id=L1");
    expect(url).toContain("period=1y");
    // Empty optional filters must NOT be sent (the reseller 400s on an empty
    // `property_type` enum).
    expect(url).not.toContain("property_type=");
    expect(url).not.toContain("bedrooms=");
  });

  it("parses a malformed payload into empty arrays (no invented rows)", () => {
    const parsed = parseTransactionsPayload({ data: {} });
    expect(parsed.transactions).toHaveLength(0);
    expect(parsed.summary).toBeNull();
    expect(parsed.totalPages).toBe(1);
  });

  it("drops transactions without a stable id", () => {
    const mapped = mapTransactions(
      [{ id: "ok", transaction_date: "2026-01-01" }, { transaction_date: "2026-01-02" }],
      ASOF
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0].sourceRef).toBe("ok");
  });

  it("yields no RawIndex for a missing summary or area name", () => {
    expect(mapSummary(null, "Area", "1y", ASOF)).toHaveLength(0);
    expect(mapSummary({ roi: 5 }, null, "1y", ASOF)).toHaveLength(0);
  });

  it("extracts a location across common envelope shapes", () => {
    expect(extractLocationFromAutoComplete(AUTOCOMPLETE_PAYLOAD)).toEqual({
      id: "LOC-MARINA",
      name: "Dubai Marina",
    });
    expect(
      extractLocationFromAutoComplete({ results: [{ location_id: 7 }] })
    ).toEqual({ id: "7", name: null });
    expect(extractLocationFromAutoComplete({})).toBeNull();
  });
});
