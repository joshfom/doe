import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";

import * as schema from "../schema";
import { marketTransactions } from "../schema";
import type { Database } from "../db";
import { comparableStats } from "./stats";

/**
 * Unit tests for the SQL stat reader `comparableStats` (task 1.4).
 *
 * Verifies real aggregation over `market_transactions` under an in-memory
 * Postgres (pg-mem): recent price, avg price/sqft, 12-month velocity, and the
 * AGGREGATE-only buyer-segment mix — each figure carrying source + asOf. No
 * individual buyer PII is read or returned (Decision 4 / Requirement 11.4).
 */

// Minimal standalone DDL — only the table the reader touches. FK columns are
// kept as plain uuids so the test needs no referenced tables.
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

const PROJ_A = randomUUID();
const PROJ_B = randomUUID();

let db: Database;

beforeEach(async () => {
  db = buildDb();
});

async function insertTxn(row: {
  marketProjectId: string;
  txnType?: "sale" | "rent" | "off_plan";
  txnDate: string;
  priceAed?: number | null;
  pricePerSqft?: number | null;
  buyerSegment?: string | null;
  source: string;
  asOf?: Date | null;
}) {
  await db.insert(marketTransactions).values({
    marketProjectId: row.marketProjectId,
    txnType: row.txnType ?? "sale",
    txnDate: row.txnDate,
    priceAed: row.priceAed ?? null,
    pricePerSqft: row.pricePerSqft ?? null,
    buyerSegment: row.buyerSegment ?? null,
    source: row.source,
    asOf: row.asOf ?? null,
  });
}

describe("comparableStats", () => {
  it("returns one zeroed CompStats per id when there are no transactions", async () => {
    const stats = await comparableStats(db, [PROJ_A, PROJ_B]);
    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({
      marketProjectId: PROJ_A,
      txnCount: 0,
      recentSalePriceAed: { value: null, source: null, asOf: null },
      avgPricePerSqft: { value: null, source: null, asOf: null },
      velocitySalesLast12m: { value: null, source: null, asOf: null },
      buyerSegmentMix: { value: [], source: null, asOf: null },
    });
  });

  it("returns [] for an empty id list", async () => {
    expect(await comparableStats(db, [])).toEqual([]);
  });

  it("computes recent price, avg price/sqft, velocity and aggregate segment mix", async () => {
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2026-01-15",
      priceAed: 10_000_000,
      pricePerSqft: 2000,
      buyerSegment: "founder",
      source: "dubai_pulse",
      asOf: new Date("2026-02-01T00:00:00Z"),
    });
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2026-03-20",
      priceAed: 12_000_000,
      pricePerSqft: 2400,
      buyerSegment: "family_office",
      source: "dubai_pulse",
      asOf: new Date("2026-04-01T00:00:00Z"),
    });
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2026-02-10",
      priceAed: 8_000_000,
      pricePerSqft: 1600,
      buyerSegment: "founder",
      source: "property_monitor",
      asOf: new Date("2026-02-15T00:00:00Z"),
    });
    // A rent txn must be excluded from sale-based stats.
    await insertTxn({
      marketProjectId: PROJ_A,
      txnType: "rent",
      txnDate: "2026-05-01",
      priceAed: 500_000,
      source: "property_monitor",
    });

    const [a] = await comparableStats(db, [PROJ_A]);

    expect(a.txnCount).toBe(3); // sales only
    // Recent = latest priced sale (2026-03-20).
    expect(a.recentSalePriceAed.value).toBe(12_000_000);
    expect(a.recentSalePriceAed.source).toBe("dubai_pulse");
    expect(a.recentSalePriceAed.asOf).toBe("2026-04-01T00:00:00.000Z");
    // Avg price/sqft = (2000 + 2400 + 1600) / 3 = 2000.
    expect(a.avgPricePerSqft.value).toBe(2000);
    // Velocity = all 3 sales fall within 12 months of latest sale.
    expect(a.velocitySalesLast12m.value).toBe(3);
    // Aggregate mix: founder x2 (66.7%), family_office x1 (33.3%).
    expect(a.buyerSegmentMix.value).toEqual([
      { segment: "founder", count: 2, pct: 66.7 },
      { segment: "family_office", count: 1, pct: 33.3 },
    ]);
  });

  it("excludes sales older than 12 months from velocity", async () => {
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2026-06-01",
      priceAed: 5_000_000,
      source: "dubai_pulse",
    });
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2024-01-01", // > 12 months before the latest (2026-06-01)
      priceAed: 4_000_000,
      source: "dubai_pulse",
    });

    const [a] = await comparableStats(db, [PROJ_A]);
    expect(a.txnCount).toBe(2);
    expect(a.velocitySalesLast12m.value).toBe(1);
  });

  it("is deterministic: identical results across repeated reads", async () => {
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2026-01-15",
      priceAed: 10_000_000,
      pricePerSqft: 2000,
      buyerSegment: "founder",
      source: "dubai_pulse",
      asOf: new Date("2026-02-01T00:00:00Z"),
    });
    await insertTxn({
      marketProjectId: PROJ_A,
      txnDate: "2026-03-20",
      priceAed: 12_000_000,
      pricePerSqft: 2400,
      buyerSegment: "family_office",
      source: "property_monitor",
      asOf: new Date("2026-04-01T00:00:00Z"),
    });

    const first = await comparableStats(db, [PROJ_A]);
    const second = await comparableStats(db, [PROJ_A]);
    expect(second).toEqual(first);
  });

  it("preserves caller order and de-duplicates ids", async () => {
    await insertTxn({
      marketProjectId: PROJ_B,
      txnDate: "2026-01-01",
      priceAed: 1_000_000,
      source: "dubai_pulse",
    });
    const stats = await comparableStats(db, [PROJ_B, PROJ_A, PROJ_B]);
    expect(stats.map((s) => s.marketProjectId)).toEqual([PROJ_B, PROJ_A]);
  });
});
