import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../../schema";
import { marketPriceIndex } from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import {
  prospectingCapabilityEntries,
  PROSPECTING_AGENT_ACTOR,
} from "./prospecting-capabilities";
import type { CatalogEntry } from "./catalog";

/**
 * Property test for the Area_Trend provenance of `market_comps` (task 10.14 — a
 * non-optional CC-Provenance boundary test).
 *
 *   **Feature: prospecting-workspace, Property 16: For any market_price_index state, the Area_Trend figures returned by market_comps (avg price/sqft, YoY change, ROI, volume, and the raw trend figures) are each stamped with their source and as_of; no trend figure is returned without provenance.**
 *
 * **Validates: Requirements 14.7**
 *
 * Task 10.13 extended the `market_comps` price-index rows so each carries the
 * Area_Trend headline — `avgPricePerSqft`, `yoyPct`, `roiPct`, `volume`, and the
 * raw `trend` summary block — alongside a single row-level `source` + `asOf`
 * shared by every figure in the row (the figures are read straight from the
 * `market_*` mirror; the model narrates them, never computes them).
 *
 * Property 16 is the CC-Provenance guarantee for that headline: across ANY
 * `market_price_index` state, every Area_Trend figure `market_comps` surfaces is
 * stamped with provenance (`source` + `as_of`); a trend figure is NEVER returned
 * bare. Concretely, for each returned `priceIndex` row:
 *
 *   1. `source` is always present (non-empty) — the mirror stamps every row; and
 *   2. whenever ANY Area_Trend figure (`avgPricePerSqft`, `yoyPct`, `roiPct`,
 *      `volume`, `trend`) is present (non-null), the row also carries both
 *      `source` AND `asOf` (its full provenance) — no trend figure escapes
 *      without provenance.
 *
 * The generator seeds random `market_price_index` rows over varied
 * area/segment/period with each Area_Trend figure independently present-or-null.
 * Every seeded row is stamped with `source` + `asOf`, mirroring how ingestion
 * stamps provenance on every mirror row it writes (Req 11.1/11.2) — i.e. the
 * generator ranges over the market_price_index states actually reachable in the
 * system, and the property confirms `market_comps` never strips that provenance
 * from any figure it surfaces.
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres / pg-proxy adapter) over the same minimal market_*
 * DDL the sibling `prospecting-capabilities.test.ts` uses — the
 * `market_price_index` table already carries the additive `roi_pct`/`volume`/
 * `trend` Area_Trend columns (task 10.1). `market_comps` reads ONLY this mirror
 * (SQL); no network, no model, no provider. The handler is invoked directly
 * through its `CatalogEntry`, exactly as the existing market_comps unit tests do.
 */

// Minimal DDL — only the market_* tables the read handler touches, with the
// additive Area_Trend columns (roi_pct/volume/trend) the increment surfaces.
const DDL = `
  CREATE TABLE "market_projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "developer_id" uuid,
    "name" text NOT NULL,
    "name_normalized" text NOT NULL,
    "community_name" text,
    "city" text,
    "region" text,
    "country" text,
    "location_lat" numeric,
    "location_lng" numeric,
    "segment" text,
    "status" text,
    "launch_date" date,
    "handover_date" date,
    "total_units" integer,
    "unit_types" jsonb,
    "price_min" numeric,
    "price_max" numeric,
    "avg_price_per_sqft" numeric,
    "branded" boolean DEFAULT false,
    "brand_name" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_project_id" uuid,
    "market_building_id" uuid,
    "community_name" text,
    "area_name" text,
    "txn_type" text NOT NULL,
    "txn_date" date NOT NULL,
    "unit_type" text,
    "area_sqm" numeric,
    "bedrooms" integer,
    "price_aed" numeric,
    "price_per_sqft" numeric,
    "is_cash" boolean,
    "buyer_segment" text,
    "buyer_nationality" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_price_index" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "area_name" text NOT NULL,
    "segment" text,
    "period" text NOT NULL,
    "index_value" numeric,
    "avg_price_per_sqft" numeric,
    "yoy_pct" numeric,
    "roi_pct" numeric,
    "volume" integer,
    "trend" jsonb,
    "source" text NOT NULL,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): Database {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.none(DDL);

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  return drizzle(executor as never, { schema }) as unknown as Database;
}

const CTX: ToolContext = { actor: PROSPECTING_AGENT_ACTOR };

function marketComps(): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === "market_comps");
  if (!e) throw new Error('capability "market_comps" not found');
  return e;
}

// The spec mandates ≥100 iterations for this non-optional CC-Provenance
// property; pin to exactly 100 so a bare `vitest --run` honors the floor.
const NUM_RUNS = 100;

// ── Generated market_price_index row ──────────────────────────────────────────

// A nullable money/percentage figure. Bounded + finite so it round-trips
// through pg numeric; `null` models "this Area_Trend figure was not carried".
const nullableNumber = fc.option(
  fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
  { nil: null }
);

// The raw summary block (`trend`), as ingested — null when absent.
const nullableTrend = fc.option(
  fc.record({
    saleAvgPrice: fc.double({ min: 0, max: 5_000_000, noNaN: true, noDefaultInfinity: true }),
    saleAvgPriceChange: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
    label: fc.constantFrom("rising", "flat", "softening"),
  }),
  { nil: null }
);

interface SeedRow {
  areaName: string;
  segment: string | null;
  period: string;
  indexValue: number | null;
  avgPricePerSqft: number | null;
  yoyPct: number | null;
  roiPct: number | null;
  volume: number | null;
  trend: Record<string, unknown> | null;
  source: string;
  asOf: Date;
}

const rowArb: fc.Arbitrary<SeedRow> = fc.record({
  areaName: fc.constantFrom(
    "Palm Jumeirah",
    "Dubai Marina",
    "Downtown Dubai",
    "Business Bay",
    "Emirates Hills"
  ),
  segment: fc.option(
    fc.constantFrom("ultra_luxury", "luxury", "premium", "mid"),
    { nil: null }
  ),
  period: fc.constantFrom(
    "2025-Q1",
    "2025-Q2",
    "2025-Q3",
    "2025-Q4",
    "2026-Q1",
    "2026-Q2"
  ),
  indexValue: nullableNumber,
  avgPricePerSqft: nullableNumber,
  yoyPct: fc.option(
    fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
    { nil: null }
  ),
  roiPct: fc.option(
    fc.double({ min: 0, max: 25, noNaN: true, noDefaultInfinity: true }),
    { nil: null }
  ),
  volume: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: null }),
  trend: nullableTrend,
  // Provenance: the mirror stamps every row it writes with a source + as-of, so
  // the generator ranges only over reachable market_price_index states.
  source: fc.constantFrom(
    "dld_drspi",
    "property_finder_reseller",
    "dubai_pulse",
    "property_monitor"
  ),
  asOf: fc.date({
    min: new Date("2020-01-01T00:00:00.000Z"),
    max: new Date("2030-01-01T00:00:00.000Z"),
    noInvalidDate: true,
  }),
});

// The Area_Trend figures whose provenance the property guards.
const AREA_TREND_FIGURE_KEYS = [
  "avgPricePerSqft",
  "yoyPct",
  "roiPct",
  "volume",
  "trend",
] as const;

interface ReturnedRow {
  areaName: string;
  source: string;
  asOf: string | null;
  avgPricePerSqft: number | null;
  yoyPct: number | null;
  roiPct?: number | null;
  volume?: number | null;
  trend?: unknown;
}

describe("market_comps — Property 16: Area_Trend provenance (Req 14.7)", () => {
  let db: Database;

  beforeEach(() => {
    db = buildDb();
  });

  it("every Area_Trend figure market_comps returns is stamped with source + as_of; no trend figure is returned without provenance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { minLength: 1, maxLength: 12 }),
        async (rows) => {
          // Fresh mirror per run — Property 16 is over ANY market_price_index
          // state, so isolate each generated state.
          db = buildDb();

          for (const r of rows) {
            await db.insert(marketPriceIndex).values({
              areaName: r.areaName,
              segment: r.segment,
              period: r.period,
              indexValue: r.indexValue,
              avgPricePerSqft: r.avgPricePerSqft,
              yoyPct: r.yoyPct,
              roiPct: r.roiPct,
              volume: r.volume,
              // Re-wrap into a fresh plain object: fast-check records can carry a
              // null prototype, which drizzle's internal type guard rejects.
              trend: r.trend ? { ...r.trend } : null,
              source: r.source,
              asOf: r.asOf,
            });
          }

          // No area/segment filter → market_comps surfaces every seeded index row.
          const out = (await marketComps().handler(db, CTX, {})) as {
            priceIndex: ReturnedRow[];
            unconfigured: boolean;
          };

          // Provenance survives the read: no row is dropped, none invented.
          expect(out.priceIndex).toHaveLength(rows.length);
          // With index rows present, the area/profile is configured.
          expect(out.unconfigured).toBe(false);

          for (const row of out.priceIndex) {
            // (1) Every surfaced row carries a non-empty source — the mirror's
            //     row-level provenance is always present.
            expect(typeof row.source).toBe("string");
            expect(row.source.length).toBeGreaterThan(0);

            // (2) Whenever ANY Area_Trend figure is present, the row carries its
            //     FULL provenance (source + as_of) — no trend figure escapes
            //     without provenance.
            const figures = AREA_TREND_FIGURE_KEYS.map(
              (k) => (row as unknown as Record<string, unknown>)[k]
            );
            const anyFigurePresent = figures.some(
              (v) => v !== null && v !== undefined
            );
            if (anyFigurePresent) {
              expect(row.source.length).toBeGreaterThan(0);
              expect(row.asOf).not.toBeNull();
              expect(typeof row.asOf).toBe("string");
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
