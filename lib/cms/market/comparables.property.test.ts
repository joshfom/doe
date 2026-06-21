import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../schema";
import { marketTransactions } from "../schema";
import type { Database } from "../db";

// The spec pins this non-optional property (Property 3) at the >= 100 iteration
// floor. Restored to 100 for final verification (task 9.1); still overridable
// upward via FAST_CHECK_NUM_RUNS for CI. Never below the 100 floor.
const NUM_RUNS = Math.max(100, Number(process.env.FAST_CHECK_NUM_RUNS) || 0);
import {
  rankComparables,
  type MarketProjectRow,
  type BriefSpecInput,
  SEGMENT_LADDER,
} from "./comparables";
import { comparableStats } from "./stats";

/**
 * Property test for SQL comparables determinism (task 1.5, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 3: For the same brief over unchanged market_* data, find_comparables returns identical ranked comparables and identical stats, sourced only from market_*.**
 *
 * **Validates: Requirements 11.3, 11.4, 10.4**
 *
 * find_comparables composes two pieces: the PURE similarity ranker
 * (`rankComparables`, lib/cms/market/comparables.ts) and the SQL stat reader
 * (`comparableStats`, lib/cms/market/stats.ts) which reads ONLY `market_*`
 * tables. This test seeds randomly generated market data into an in-memory
 * Postgres (pg-mem) and a randomly generated brief, then asserts:
 *
 *  1. ranking the same brief over the same projects twice is deeply equal;
 *  2. reading stats over the same (unchanged) market_* data twice is deeply
 *     equal;
 *  3. every figure the stats reader returns is sourced from the seeded
 *     `market_*` rows (the `source` stamp and the surfaced value both trace to
 *     a seeded market transaction) — never invented / model-computed.
 *
 * The harness mirrors lib/cms/market/stats.test.ts (pg-mem + pg-proxy).
 */

// Only the table the SQL reader touches. comparableStats reads market_*
// transactions exclusively, so seeding this table is sufficient to exercise the
// "sourced only from market_*" property.
const DDL = `
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

/** Build a `market_projects` row with sensible defaults (mirrors stats/comparables tests). */
function project(overrides: Partial<MarketProjectRow>): MarketProjectRow {
  const now = new Date();
  return {
    id: randomUUID(),
    developerId: null,
    name: "Project",
    nameNormalized: "project",
    communityName: null,
    city: null,
    region: null,
    country: null,
    locationLat: null,
    locationLng: null,
    segment: null,
    status: null,
    launchDate: null,
    handoverDate: null,
    totalUnits: null,
    unitTypes: null,
    priceMin: null,
    priceMax: null,
    avgPricePerSqft: null,
    branded: false,
    brandName: null,
    source: "test",
    sourceRef: null,
    asOf: null,
    demo: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MarketProjectRow;
}

// ── Generators ──────────────────────────────────────────────────────────────

const AREAS = ["Palm Jumeirah", "Dubai Marina", "Downtown", "Emirates Hills", "JBR"];
const UNIT_TYPES = ["villa", "apartment", "penthouse", "townhouse", "office"];
const SOURCES = ["dubai_pulse", "property_monitor"];
const SEGMENTS = SEGMENT_LADDER;

const briefArb: fc.Arbitrary<BriefSpecInput> = fc.record(
  {
    area: fc.option(fc.constantFrom(...AREAS), { nil: undefined }),
    segment: fc.option(fc.constantFrom(...SEGMENTS), { nil: undefined }),
    unitType: fc.option(fc.constantFrom(...UNIT_TYPES), { nil: undefined }),
    bedrooms: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
    priceMinAed: fc.option(fc.integer({ min: 1_000_000, max: 50_000_000 }), {
      nil: undefined,
    }),
    priceMaxAed: fc.option(fc.integer({ min: 1_000_000, max: 80_000_000 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: [] }
);

/** A generated project row (only the fields the ranker reads vary). */
function projectArb(id: string): fc.Arbitrary<MarketProjectRow> {
  return fc
    .record({
      communityName: fc.option(fc.constantFrom(...AREAS), { nil: null }),
      city: fc.option(fc.constantFrom("Dubai", "Abu Dhabi"), { nil: null }),
      segment: fc.option(fc.constantFrom(...SEGMENTS), { nil: null }),
      unitTypes: fc.option(
        fc.uniqueArray(fc.constantFrom(...UNIT_TYPES), { minLength: 1, maxLength: 3 }),
        { nil: null }
      ),
      priceMin: fc.option(fc.integer({ min: 1_000_000, max: 40_000_000 }), {
        nil: null,
      }),
      priceMax: fc.option(fc.integer({ min: 1_000_000, max: 90_000_000 }), {
        nil: null,
      }),
    })
    .map((p) => project({ id, ...p }));
}

interface GenTxn {
  txnType: "sale" | "rent" | "off_plan";
  txnDate: string;
  priceAed: number | null;
  pricePerSqft: number | null;
  buyerSegment: string | null;
  source: string;
  asOf: Date | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const txnArb: fc.Arbitrary<GenTxn> = fc.record({
  txnType: fc.constantFrom("sale" as const, "rent" as const, "off_plan" as const),
  txnDate: fc
    .record({
      y: fc.integer({ min: 2022, max: 2026 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`),
  priceAed: fc.option(fc.integer({ min: 500_000, max: 100_000_000 }), { nil: null }),
  pricePerSqft: fc.option(fc.integer({ min: 500, max: 8000 }), { nil: null }),
  buyerSegment: fc.option(
    fc.constantFrom("founder", "family_office", "uhnwi", "golden_visa"),
    { nil: null }
  ),
  source: fc.constantFrom(...SOURCES),
  asOf: fc.option(
    fc
      .integer({ min: Date.UTC(2022, 0, 1), max: Date.UTC(2026, 11, 31) })
      .map((ms) => new Date(ms)),
    { nil: null }
  ),
});

describe("Property 3: find_comparables determinism + market_* sourcing", () => {
  it(
    "ranks identically and reads identical, market-sourced stats over unchanged data",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          briefArb,
          fc.integer({ min: 1, max: 6 }),
          fc.array(fc.array(txnArb, { maxLength: 8 }), { maxLength: 6 }),
          async (spec, projectCount, txnGroups) => {
            // Build distinct project ids + rows.
            const ids = Array.from({ length: projectCount }, () => randomUUID());
            const projectRows = await Promise.all(
              ids.map((id) => fc.sample(projectArb(id), 1)[0])
            );

            // Fresh in-memory DB per run; seed market_transactions for these projects.
            const db = buildDb();
            const seededSources = new Set<string>();
            // Map projectId -> set of seeded sale prices (for sourcing assertion).
            const seededSalePrices = new Map<string, Set<number>>();
            const seededSourcesByProject = new Map<string, Set<string>>();
            for (const id of ids) {
              seededSalePrices.set(id, new Set());
              seededSourcesByProject.set(id, new Set());
            }

            for (let i = 0; i < ids.length; i++) {
              const group = txnGroups[i] ?? [];
              for (const t of group) {
                await db.insert(marketTransactions).values({
                  marketProjectId: ids[i],
                  txnType: t.txnType,
                  txnDate: t.txnDate,
                  priceAed: t.priceAed,
                  pricePerSqft: t.pricePerSqft,
                  buyerSegment: t.buyerSegment,
                  source: t.source,
                  asOf: t.asOf,
                });
                seededSources.add(t.source);
                if (t.txnType === "sale") {
                  seededSourcesByProject.get(ids[i])!.add(t.source);
                  if (t.priceAed !== null) {
                    seededSalePrices.get(ids[i])!.add(t.priceAed);
                  }
                }
              }
            }

            // 1) PURE ranker is deterministic over identical inputs.
            const rank1 = rankComparables({ spec }, projectRows);
            const rank2 = rankComparables({ spec }, projectRows);
            expect(rank2).toEqual(rank1);

            // Ranking covers exactly the supplied projects.
            expect(new Set(rank1.map((r) => r.marketProjectId))).toEqual(new Set(ids));

            // 2) SQL stats are deterministic over unchanged market_* data.
            const orderedIds = rank1.map((r) => r.marketProjectId);
            const stats1 = await comparableStats(db, orderedIds);
            const stats2 = await comparableStats(db, orderedIds);
            expect(stats2).toEqual(stats1);

            // 3) Every figure is sourced from seeded market_* rows (never invented).
            for (const s of stats1) {
              const pSources = seededSourcesByProject.get(s.marketProjectId)!;
              const pPrices = seededSalePrices.get(s.marketProjectId)!;

              for (const fig of [
                s.recentSalePriceAed,
                s.avgPricePerSqft,
                s.velocitySalesLast12m,
                s.buyerSegmentMix,
              ]) {
                if (fig.source !== null) {
                  // Provenance source must be one actually seeded into market_*.
                  expect(seededSources.has(fig.source)).toBe(true);
                  expect(pSources.has(fig.source)).toBe(true);
                }
              }

              // The surfaced recent sale price must be a real seeded value.
              if (s.recentSalePriceAed.value !== null) {
                expect(pPrices.has(s.recentSalePriceAed.value)).toBe(true);
              }

              // Buyer-segment mix is aggregate-only: percentages sum to ~100
              // when present, and counts never exceed the sale count.
              const mix = s.buyerSegmentMix.value;
              if (mix.length > 0) {
                const totalCount = mix.reduce((a, e) => a + e.count, 0);
                expect(totalCount).toBeLessThanOrEqual(s.txnCount);
                const pctSum = mix.reduce((a, e) => a + e.pct, 0);
                expect(Math.abs(pctSum - 100)).toBeLessThanOrEqual(0.5);
              }
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    },
    30_000
  );
});
