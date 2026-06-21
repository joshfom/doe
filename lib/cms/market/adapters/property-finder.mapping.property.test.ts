import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  parseTransactionsPayload,
  mapTransactions,
  mapSummary,
  SQFT_TO_SQM,
} from "./property-finder";

/**
 * Property test for the Property Finder reseller adapter mapping (task 10.10,
 * NOT optional).
 *
 * **Feature: prospecting-workspace, Property 13: For any well-formed /get-transactions payload delivered through the mocked HttpTransport, every provider transaction maps to a RawTransaction with the specified field correspondence (id→sourceRef, high_level_location_name→areaName, price→priceAed, price_per_sqft→pricePerSqft, property_size(sqft)→areaSqm = sqft × 0.092903, bedrooms→bedrooms, property_type→unitType, transaction_date→txnDate) with txnType = "sale", and the summary block maps to a RawIndex/Area_Trend carrying avgPricePerSqft, yoyPct, roiPct, volume, and the raw trend figures.**
 *
 * **Validates: Requirements 14.2**
 *
 * The field map + sqft→sqm conversion live in the PURE helpers
 * `parseTransactionsPayload` / `mapTransactions` / `mapSummary` (and the
 * `SQFT_TO_SQM` constant) in `./property-finder.ts` — the same helpers the
 * adapter drives after a (mocked) `HttpTransport` call returns. This test takes
 * the fastest faithful path (Design / task note): it generates well-formed
 * `/get-transactions` payloads (an array of provider transaction objects + a
 * summary block + total_pages), runs them through the real `parseTransactionsPayload`
 * envelope reader, then asserts the field-by-field correspondence and the
 * float-tolerant sqft→sqm conversion on the output of `mapTransactions` /
 * `mapSummary`. No network is touched (no transport at all on this path).
 */

// Pinned at the non-optional >= 100 iteration floor. Kept EXACTLY at 100 — the
// mapping is a deterministic pure function, so 100 well-formed payloads fully
// exercise the field map without inflating the (fast) suite.
const NUM_RUNS = 100;

const ASOF = new Date("2026-02-01T00:00:00.000Z");

// ── Generators ───────────────────────────────────────────────────────────────

const AREAS = ["Dubai Marina", "Palm Jumeirah", "Downtown", "JBR", "Business Bay"];
const UNIT_TYPES = ["Apartment", "Villa", "Penthouse", "Townhouse", "Office"];

/** A finite, JSON-safe numeric value (mirrors what the reseller returns). */
const finiteNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** A two-digit-padded ISO date string within a plausible window. */
const isoDateArb: fc.Arbitrary<string> = fc
  .record({
    y: fc.integer({ min: 2020, max: 2026 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

interface GenTxn {
  id: string | number;
  high_level_location_name: string | null;
  price: number | null;
  price_per_sqft: number | null;
  property_size: number | null;
  bedrooms: number | null;
  property_type: string | null;
  transaction_date: string | null;
}

// Every generated transaction carries a stable, non-empty id so it is KEPT by
// mapTransactions (the adapter drops only unkeyable rows) — this lets the test
// assert "every provider transaction maps" by stable index alignment.
const txnArb: fc.Arbitrary<GenTxn> = fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 1e9 })),
  high_level_location_name: fc.option(fc.constantFrom(...AREAS), { nil: null }),
  price: fc.option(finiteNumber(100_000, 100_000_000), { nil: null }),
  price_per_sqft: fc.option(finiteNumber(200, 12_000), { nil: null }),
  property_size: fc.option(finiteNumber(100, 50_000), { nil: null }),
  bedrooms: fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }),
  property_type: fc.option(fc.constantFrom(...UNIT_TYPES), { nil: null }),
  transaction_date: fc.option(isoDateArb, { nil: null }),
});

const summaryArb = fc.record({
  sale_avg_price: fc.option(finiteNumber(100_000, 100_000_000), { nil: null }),
  sale_avg_price_change: fc.option(finiteNumber(-50, 50), { nil: null }),
  sale_avg_price_per_sqft: fc.option(finiteNumber(200, 12_000), { nil: null }),
  sale_avg_price_per_sqft_change: fc.option(finiteNumber(-50, 50), { nil: null }),
  roi: fc.option(finiteNumber(0, 30), { nil: null }),
  volume: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: null }),
});

/** Wrap generated rows in the CONFIRMED `/get-transactions` envelope shape. */
function envelope(
  transactions: GenTxn[],
  summary: Record<string, unknown>,
  totalPages: number
): unknown {
  return {
    data: { data: { attributes: { transactions, summary, total_pages: totalPages } } },
  };
}

describe("Property 13: Property Finder /get-transactions field map + sqft→sqm", () => {
  it(
    "maps every transaction field-for-field (txnType=sale, areaSqm=sqft×0.092903) and the summary→RawIndex",
    () => {
      fc.assert(
        fc.property(
          fc.array(txnArb, { maxLength: 12 }),
          summaryArb,
          fc.constantFrom(...AREAS),
          fc.constantFrom("1y", "6m", "3m", "5y"),
          fc.integer({ min: 1, max: 50 }),
          (transactions, summary, areaName, period, totalPages) => {
            const payload = envelope(transactions, summary, totalPages);

            // 1) The real envelope reader returns the array + summary + pages verbatim.
            const parsed = parseTransactionsPayload(payload);
            expect(parsed.transactions).toEqual(transactions);
            expect(parsed.summary).toEqual(summary);
            expect(parsed.totalPages).toBe(totalPages);

            // 2) Transaction field correspondence (every row maps, order preserved).
            const mapped = mapTransactions(parsed.transactions, ASOF);
            expect(mapped).toHaveLength(transactions.length);

            for (let i = 0; i < transactions.length; i++) {
              const t = transactions[i];
              const m = mapped[i];

              expect(m.sourceRef).toBe(String(t.id)); // id → sourceRef
              expect(m.areaName).toBe(t.high_level_location_name ?? null); // → areaName
              expect(m.communityName).toBe(t.high_level_location_name ?? null);
              expect(m.priceAed).toBe(t.price ?? null); // price → priceAed
              expect(m.pricePerSqft).toBe(t.price_per_sqft ?? null); // → pricePerSqft
              expect(m.bedrooms).toBe(t.bedrooms ?? null); // → bedrooms
              expect(m.unitType).toBe(t.property_type ?? null); // property_type → unitType
              expect(m.txnDate).toBe(t.transaction_date ?? ""); // → txnDate
              expect(m.txnType).toBe("sale"); // always a sale
              expect(m.asOf).toEqual(ASOF); // stamped from the clock

              // property_size (sqft) → areaSqm = sqft × 0.092903 (float tolerant).
              if (t.property_size == null) {
                expect(m.areaSqm).toBeNull();
              } else {
                expect(m.areaSqm).not.toBeNull();
                expect(m.areaSqm as number).toBeCloseTo(
                  t.property_size * SQFT_TO_SQM,
                  6
                );
                // And the constant itself is the documented factor.
                expect(SQFT_TO_SQM).toBe(0.092903);
              }
            }

            // 3) The summary block → exactly one RawIndex/Area_Trend row.
            const index = mapSummary(parsed.summary, areaName, period, ASOF);
            expect(index).toHaveLength(1);
            const idx = index[0];
            expect(idx.areaName).toBe(areaName);
            expect(idx.segment).toBeNull();
            expect(idx.period).toBe(period);
            expect(idx.avgPricePerSqft).toBe(summary.sale_avg_price_per_sqft ?? null);
            expect(idx.yoyPct).toBe(summary.sale_avg_price_per_sqft_change ?? null);
            expect(idx.roiPct).toBe(summary.roi ?? null);
            expect(idx.volume).toBe(summary.volume ?? null);
            // The raw trend figures are carried verbatim (never model-computed).
            expect(idx.trend).toEqual({
              saleAvgPrice: summary.sale_avg_price ?? null,
              saleAvgPriceChange: summary.sale_avg_price_change ?? null,
            });
            expect(idx.asOf).toEqual(ASOF);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    },
    30_000
  );
});
