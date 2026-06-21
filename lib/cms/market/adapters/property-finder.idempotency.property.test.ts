import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { newDb, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

import type { Database } from "../../db";
import * as schema from "../../schema";
import {
  marketBuildings,
  marketDevelopers,
  marketPriceIndex,
  marketProjects,
  marketTransactions,
} from "../../schema";
import type { MarketBatch } from "../adapter";
import { ingestMarketBatch } from "../ingest";
import { mapSummary, mapTransactions, PROPERTY_FINDER_SOURCE } from "./property-finder";

/**
 * Property test for Property Finder reseller ingest idempotency (task 10.11,
 * NOT optional).
 *
 * **Feature: prospecting-workspace, Property 14: For any MarketBatch produced by the Property Finder adapter, ingesting it twice via ingestMarketBatch yields a field-identical row set with no duplicates — re-ingesting an already-stored transaction (keyed (source="property_finder_reseller", source_ref=id)) is a no-op at the row level.**
 *
 * **Validates: Requirements 14.5**
 *
 * Batches are built exactly the way the adapter produces them: generated
 * well-formed `/get-transactions` provider payloads are shaped through the SAME
 * pure `mapTransactions` / `mapSummary` helpers the adapter drives after a
 * (mocked) `HttpTransport` call (the preferred, fastest faithful path — Design /
 * task note). The reseller adapter emits only transactions + the Area_Trend
 * price index (never developers/projects/buildings), so those arrays stay empty.
 *
 * The batch is then ingested twice via the real `ingestMarketBatch` into an
 * in-memory Postgres (pg-mem) standing up the `market_*` mirror (DDL mirrors
 * migration `0037` incl. the post-`0039` `roi_pct`/`volume`/`trend` columns).
 * We snapshot every `market_*` row after the first ingest, ingest the SAME batch
 * again, and assert the row set is field-identical — same count, same rows, no
 * duplicates — keyed on `(source, source_ref)` for transactions and
 * `(area, segment, period, source)` for the price index.
 */

// Non-optional property floor; pinned EXACTLY at 100. The mirror is rebuilt per
// run (beforeEach) and kept lean (only the ingested tables, shared schema).
const NUM_RUNS = 100;

const SOURCE = PROPERTY_FINDER_SOURCE; // "property_finder_reseller"
const ASOF = new Date("2026-02-01T00:00:00.000Z");

// ── pg-mem harness (mirrors lib/cms/market/ingest.test.ts) ───────────────────
// Mirrors drizzle/0037_market_catalog.sql for the five ingested tables, incl.
// the additive post-0039 market_price_index roi_pct/volume/trend columns.
const MARKET_DDL = `
  CREATE TABLE "market_developers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "name_normalized" text NOT NULL,
    "country" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "developer_id" uuid REFERENCES "market_developers"("id") ON DELETE SET NULL,
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
  CREATE TABLE "market_buildings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_project_id" uuid REFERENCES "market_projects"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "floors" integer,
    "total_units" integer,
    "completion_year" integer,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_project_id" uuid REFERENCES "market_projects"("id") ON DELETE SET NULL,
    "market_building_id" uuid REFERENCES "market_buildings"("id") ON DELETE SET NULL,
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
  CREATE UNIQUE INDEX "market_developers_source_ref_ux" ON "market_developers" ("source", "source_ref");
  CREATE UNIQUE INDEX "market_projects_source_ref_ux" ON "market_projects" ("source", "source_ref");
  CREATE INDEX "market_projects_segment_idx" ON "market_projects" ("segment");
  CREATE INDEX "market_projects_community_idx" ON "market_projects" ("community_name");
  CREATE UNIQUE INDEX "market_buildings_source_ref_ux" ON "market_buildings" ("source", "source_ref");
  CREATE UNIQUE INDEX "market_transactions_source_ref_ux" ON "market_transactions" ("source", "source_ref");
  CREATE INDEX "market_transactions_project_idx" ON "market_transactions" ("market_project_id");
  CREATE INDEX "market_transactions_date_idx" ON "market_transactions" ("txn_date");
  CREATE UNIQUE INDEX "market_price_index_key_ux" ON "market_price_index" ("area_name", "segment", "period", "source");
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  mem.public.none(MARKET_DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping.
  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
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
  }) as typeof pool.query;

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

async function allRows(db: Database) {
  return {
    developers: await db.select().from(marketDevelopers),
    projects: await db.select().from(marketProjects),
    buildings: await db.select().from(marketBuildings),
    transactions: await db.select().from(marketTransactions),
    priceIndex: await db.select().from(marketPriceIndex),
  };
}

// ── Generators (well-formed `/get-transactions` provider records) ────────────

const AREAS = ["Dubai Marina", "Palm Jumeirah", "Downtown", "JBR", "Business Bay"];
const UNIT_TYPES = ["Apartment", "Villa", "Penthouse", "Townhouse", "Office"];

const finiteNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const isoDateArb: fc.Arbitrary<string> = fc
  .record({
    y: fc.integer({ min: 2020, max: 2026 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ y, m, d }) =>
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  );

interface GenTxn {
  id: string;
  high_level_location_name: string | null;
  price: number | null;
  price_per_sqft: number | null;
  property_size: number | null;
  bedrooms: number | null;
  property_type: string | null;
  transaction_date: string; // always present — txn_date is NOT NULL in the mirror
}

const txnArb: fc.Arbitrary<GenTxn> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  high_level_location_name: fc.option(fc.constantFrom(...AREAS), { nil: null }),
  price: fc.option(finiteNumber(100_000, 100_000_000), { nil: null }),
  price_per_sqft: fc.option(finiteNumber(200, 12_000), { nil: null }),
  property_size: fc.option(finiteNumber(100, 50_000), { nil: null }),
  bedrooms: fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }),
  property_type: fc.option(fc.constantFrom(...UNIT_TYPES), { nil: null }),
  transaction_date: isoDateArb,
});

interface GenSummary {
  area: string;
  period: string;
  sale_avg_price: number | null;
  sale_avg_price_change: number | null;
  sale_avg_price_per_sqft: number | null;
  sale_avg_price_per_sqft_change: number | null;
  roi: number | null;
  volume: number | null;
}

const summaryArb: fc.Arbitrary<GenSummary> = fc.record({
  area: fc.constantFrom(...AREAS),
  period: fc.constantFrom("1y", "6m", "3m", "5y"),
  sale_avg_price: fc.option(finiteNumber(100_000, 100_000_000), { nil: null }),
  sale_avg_price_change: fc.option(finiteNumber(-50, 50), { nil: null }),
  sale_avg_price_per_sqft: fc.option(finiteNumber(200, 12_000), { nil: null }),
  sale_avg_price_per_sqft_change: fc.option(finiteNumber(-50, 50), { nil: null }),
  roi: fc.option(finiteNumber(0, 30), { nil: null }),
  volume: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: null }),
});

/**
 * Build a MarketBatch the way the adapter does: shape generated provider
 * transactions + per-area summary blocks through the SAME pure helpers the
 * adapter drives. De-dupe on the ingest keys ((source, source_ref) for txns,
 * (area, segment, period, source) for the index) so "no duplicates" is a
 * meaningful count assertion (the adapter never emits two rows with the same
 * upsert key in a single batch).
 */
function buildBatch(txns: GenTxn[], summaries: GenSummary[]): MarketBatch {
  const byId = new Map<string, GenTxn>();
  for (const t of txns) byId.set(t.id, t); // unique source_ref = id
  const transactions = mapTransactions([...byId.values()], ASOF);

  const bySummaryKey = new Map<string, GenSummary>();
  for (const s of summaries) bySummaryKey.set(`${s.area}|${s.period}`, s); // unique (area, period)
  const priceIndex = [...bySummaryKey.values()].flatMap((s) =>
    mapSummary(
      {
        sale_avg_price: s.sale_avg_price,
        sale_avg_price_change: s.sale_avg_price_change,
        sale_avg_price_per_sqft: s.sale_avg_price_per_sqft,
        sale_avg_price_per_sqft_change: s.sale_avg_price_per_sqft_change,
        roi: s.roi,
        volume: s.volume,
      },
      s.area,
      s.period,
      ASOF
    )
  );

  return {
    developers: [],
    projects: [],
    buildings: [],
    transactions,
    priceIndex,
    cursor: "cursor-1",
  };
}

describe("Property 14: Property Finder reseller ingest idempotency", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it(
    "ingesting a reseller batch twice yields a field-identical row set with no duplicates",
    () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(txnArb, { maxLength: 12 }),
          fc.array(summaryArb, { maxLength: 5 }),
          async (txns, summaries) => {
            // Fresh mirror per run so prior runs never leak rows.
            ({ db } = buildDb());

            const batch = buildBatch(txns, summaries);
            const distinctTxnKeys = new Set(batch.transactions.map((t) => t.sourceRef));
            const distinctIndexKeys = new Set(
              batch.priceIndex.map((i) => `${i.areaName}|${i.segment ?? ""}|${i.period}`)
            );

            // First ingest → snapshot every market_* row.
            await ingestMarketBatch(db, SOURCE, batch);
            const first = await allRows(db);

            // The reseller adapter emits only transactions + price index.
            expect(first.developers).toEqual([]);
            expect(first.projects).toEqual([]);
            expect(first.buildings).toEqual([]);

            // No duplicates: one row per distinct upsert key, all stamped source.
            expect(first.transactions).toHaveLength(distinctTxnKeys.size);
            expect(first.priceIndex).toHaveLength(distinctIndexKeys.size);
            for (const r of first.transactions) {
              expect((r as { source: string }).source).toBe(SOURCE);
              expect((r as { txnType: string }).txnType).toBe("sale");
            }
            for (const r of first.priceIndex) {
              expect((r as { source: string }).source).toBe(SOURCE);
            }

            // Re-ingest the SAME batch.
            await ingestMarketBatch(db, SOURCE, batch);
            const second = await allRows(db);

            // Counts unchanged on every mirror table — re-ingest added no rows.
            expect(second.transactions).toHaveLength(first.transactions.length);
            expect(second.priceIndex).toHaveLength(first.priceIndex.length);

            // Row set is field-identical (same ids, values, provenance, asOf):
            // re-ingesting an already-stored row is a true no-op at the row level.
            expect(second).toEqual(first);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    },
    60_000
  );
});
