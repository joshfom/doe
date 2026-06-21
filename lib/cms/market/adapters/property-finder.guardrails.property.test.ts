import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  PropertyFinderAdapter,
  InMemoryLocationCache,
  InMemoryPageCache,
  encodeCursor,
  normalizeAreaName,
  AUTOCOMPLETE_PATH,
  AUTOCOMPLETE_QUERY_PARAM,
  GET_TRANSACTIONS_PATH,
} from "./property-finder";
import { isUnconfigured } from "../adapter";
import type { HttpResponse, HttpTransport } from "../../prospecting/providers/transport";

/**
 * Property test for the Property Finder reseller adapter free-tier cost
 * guardrails (task 10.12, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 15: For any sequence of resolve/fetch operations within the cache window, the Location AutoComplete endpoint is called at most once per distinct normalized area name, repeated fetches of the same (locationId, page, period) within the page-cache TTL hit the transport at most once, and a 429 response triggers backoff — the adapter returns an empty batch and retains the cursor rather than re-hammering the provider.**
 *
 * **Validates: Requirements 14.3, 14.6**
 *
 * The adapter is driven exclusively through the injectable {@link HttpTransport}
 * seam with a COUNTING fake (mirrors the `property-finder.test.ts` mock pattern)
 * — the suite NEVER hits the network. The injectable `InMemoryLocationCache` /
 * `InMemoryPageCache` plus an injected fixed clock make every run deterministic.
 *
 * A single property covers all three guardrails:
 *   (a) Location AutoComplete is called at most once per distinct normalized
 *       area name across a whole sequence of fetches (Req 14.3).
 *   (b) Repeated fetches of the same (locationId, page, period) within the
 *       page-cache TTL produce at most one `/get-transactions` transport call
 *       (Req 14.6).
 *   (c) A 429 → the fetch returns an empty batch (no transactions/priceIndex)
 *       and the returned cursor equals the incoming cursor (retained), and the
 *       adapter backs off — it does not re-call the transport on the next tick
 *       within the backoff window (Req 14.6).
 */

// Pinned at EXACTLY the non-optional property floor.
const NUM_RUNS = 100;

const NOW = new Date("2026-02-01T00:00:00.000Z");
/** A TTL comfortably larger than the (zero-advance) clock window of each run. */
const PAGE_TTL_MS = 6 * 60 * 60 * 1000;

/** A minimal well-formed `/get-transactions` envelope (one txn + summary). */
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
            property_size: 1000,
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

// ── Counting transport mock (never hits the network) ─────────────────────────

interface CountingTransport {
  transport: HttpTransport;
  /** Raw `query=` values seen by the AutoComplete endpoint, in call order. */
  autoCompleteQueries: string[];
  /** `/get-transactions` call counts keyed by the exact request URL. */
  txnCallsByUrl: Map<string, number>;
}

/**
 * Build a status-aware counting transport. AutoComplete always succeeds and
 * returns a location id derived from the NORMALIZED query, so a cursor's
 * `locationId` is reconstructable as `LOC::${normalizeAreaName(area)}`. The
 * `/get-transactions` status is configurable (200 by default, 429 to drive the
 * backoff path).
 */
function makeCountingTransport(opts: { txnStatus?: number } = {}): CountingTransport {
  const autoCompleteQueries: string[] = [];
  const txnCallsByUrl = new Map<string, number>();
  const transport: HttpTransport = async (url) => {
    if (url.includes(AUTOCOMPLETE_PATH)) {
      const raw = url.split(`${AUTOCOMPLETE_QUERY_PARAM}=`)[1] ?? "";
      const query = decodeURIComponent(raw);
      autoCompleteQueries.push(query);
      const norm = normalizeAreaName(query);
      const body: HttpResponse = {
        ok: true,
        status: 200,
        json: async () => ({ data: { data: [{ id: `LOC::${norm}`, name: query }] } }),
      };
      return body;
    }
    // `/get-transactions`
    txnCallsByUrl.set(url, (txnCallsByUrl.get(url) ?? 0) + 1);
    const status = opts.txnStatus ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => TXN_PAYLOAD };
  };
  return { transport, autoCompleteQueries, txnCallsByUrl };
}

function sumCounts(m: Map<string, number>): number {
  let total = 0;
  for (const v of m.values()) total += v;
  return total;
}

// ── Generators ───────────────────────────────────────────────────────────────

const BASE_AREAS = ["Dubai Marina", "Palm Jumeirah", "Downtown", "JBR"];

/**
 * A scenario carrying:
 *   - `selected`: the distinct own areas the adapter is configured with;
 *   - `variants`: extra case-variant duplicates of selected areas (config
 *     entries that NORMALIZE onto an already-present area — they must not
 *     trigger a second AutoComplete call);
 *   - `ops`: a sequence of `fetchSince` cursors over the selected areas, with
 *     small page numbers so identical (locationId, page, period) triples recur;
 *   - `backoff`: an independent (area, page) used to drive the 429 path.
 */
const scenarioArb = fc
  .uniqueArray(fc.constantFrom(...BASE_AREAS), { minLength: 1, maxLength: 4 })
  .chain((selected) =>
    fc.record({
      selected: fc.constant(selected),
      variants: fc.array(fc.constantFrom(...selected), { maxLength: 3 }),
      ops: fc.array(
        fc.record({
          area: fc.constantFrom(...selected),
          page: fc.integer({ min: 1, max: 3 }),
        }),
        { minLength: 1, maxLength: 8 }
      ),
      backoff: fc.record({
        area: fc.constantFrom(...selected),
        page: fc.integer({ min: 1, max: 3 }),
      }),
    })
  );

function cursorFor(area: string, page: number): string {
  return encodeCursor({
    locationId: `LOC::${normalizeAreaName(area)}`,
    page,
    period: "1y",
  });
}

describe("Property 15: Property Finder free-tier cost guardrails", () => {
  it(
    "resolves AutoComplete at most once per normalized area, page-caches repeats, and backs off on 429",
    async () => {
      await fc.assert(
        fc.asyncProperty(scenarioArb, async (scenario) => {
          // ── (a) + (b): location-resolution caching + page caching ──────────
          const clock = () => NOW;
          const counting = makeCountingTransport();

          const configAreas = [
            ...scenario.selected,
            ...scenario.variants.map((v) => v.toUpperCase()), // dup-by-normalization
          ];

          const adapter = new PropertyFinderAdapter(
            { apiKey: "k", areas: configAreas, period: "1y" },
            {
              transport: counting.transport,
              clock,
              locationCache: new InMemoryLocationCache(),
              pageCache: new InMemoryPageCache(PAGE_TTL_MS, () => NOW.getTime()),
            }
          );

          for (const op of scenario.ops) {
            const res = await adapter.fetchSince(cursorFor(op.area, op.page));
            expect(isUnconfigured(res)).toBe(false);
          }

          // (a) AutoComplete called at most once per distinct normalized area.
          const autoCompleteByNorm = new Map<string, number>();
          for (const q of counting.autoCompleteQueries) {
            const n = normalizeAreaName(q);
            autoCompleteByNorm.set(n, (autoCompleteByNorm.get(n) ?? 0) + 1);
          }
          for (const count of autoCompleteByNorm.values()) {
            expect(count).toBeLessThanOrEqual(1);
          }

          // (b) Each distinct (locationId, page, period) hits the transport ≤ 1×.
          for (const [url, count] of counting.txnCallsByUrl.entries()) {
            expect(url).toContain(GET_TRANSACTIONS_PATH);
            expect(count).toBeLessThanOrEqual(1);
          }

          // ── (c): 429 → empty batch, cursor retained, backoff (no re-hammer) ─
          const counting429 = makeCountingTransport({ txnStatus: 429 });
          const backoffAdapter = new PropertyFinderAdapter(
            { apiKey: "k", areas: [scenario.backoff.area], period: "1y" },
            {
              transport: counting429.transport,
              clock,
              locationCache: new InMemoryLocationCache(),
              pageCache: new InMemoryPageCache(PAGE_TTL_MS, () => NOW.getTime()),
            }
          );

          const cursor = cursorFor(scenario.backoff.area, scenario.backoff.page);

          const r1 = await backoffAdapter.fetchSince(cursor);
          if (isUnconfigured(r1)) throw new Error("unexpected unconfigured (429 r1)");
          expect(r1.transactions).toHaveLength(0); // empty batch
          expect(r1.priceIndex).toHaveLength(0);
          expect(r1.cursor).toBe(cursor); // cursor retained
          expect(sumCounts(counting429.txnCallsByUrl)).toBe(1);

          // Next tick within the backoff window: must NOT re-call the transport.
          const r2 = await backoffAdapter.fetchSince(cursor);
          if (isUnconfigured(r2)) throw new Error("unexpected unconfigured (429 r2)");
          expect(r2.transactions).toHaveLength(0);
          expect(r2.priceIndex).toHaveLength(0);
          expect(r2.cursor).toBe(cursor); // cursor still retained
          expect(sumCounts(counting429.txnCallsByUrl)).toBe(1); // backed off — no re-hammer
        }),
        { numRuns: NUM_RUNS }
      );
    },
    30_000
  );
});
