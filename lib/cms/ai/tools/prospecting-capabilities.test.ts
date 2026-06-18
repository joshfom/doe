import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";

import * as schema from "../../schema";
import { marketProjects, marketTransactions, marketPriceIndex } from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import {
  prospectingCapabilityEntries,
  loadProspectingCapabilities,
  PROSPECTING_CAPABILITY_NAMES,
  PROSPECTING_AGENT_ACTOR,
  prospectingToolPermission,
} from "./prospecting-capabilities";
import type { CatalogEntry } from "./catalog";

/**
 * Unit tests for the read/SQL prospecting capabilities (task 3.2):
 * `find_comparables` and `market_comps`.
 *
 * Both read ONLY the `market_*` mirror under an in-memory Postgres (pg-mem):
 * ranking is the PURE rankComparables, stats come from the SQL reader
 * comparableStats, and every figure carries its source + as-of date
 * (Requirements 11.3, 11.4). When the catalog is empty, find_comparables
 * returns no comparables and flags it unconfigured (Requirement 11.5).
 */

// Minimal DDL — only the market_* tables the read handlers touch. FK columns are
// plain uuids so the test needs no referenced tables.
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

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

let db: Database;

beforeEach(() => {
  db = buildDb();
});

async function insertProject(row: {
  name: string;
  communityName?: string;
  segment?: "ultra_luxury" | "luxury" | "premium" | "mid";
  unitTypes?: string[];
  priceMin?: number;
  priceMax?: number;
  source: string;
  asOf?: Date | null;
}): Promise<string> {
  const [r] = await db
    .insert(marketProjects)
    .values({
      name: row.name,
      nameNormalized: row.name.toLowerCase(),
      communityName: row.communityName ?? null,
      segment: row.segment ?? null,
      unitTypes: row.unitTypes ?? null,
      priceMin: row.priceMin ?? null,
      priceMax: row.priceMax ?? null,
      source: row.source,
      asOf: row.asOf ?? null,
    })
    .returning({ id: marketProjects.id });
  return r.id;
}

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

describe("prospecting capabilities — catalog wiring", () => {
  it("assembles cleanly through loadCatalog with the two read entries", () => {
    const result = loadProspectingCapabilities();
    expect(result.ok).toBe(true);
    expect(PROSPECTING_CAPABILITY_NAMES).toEqual(
      expect.arrayContaining(["find_comparables", "market_comps"])
    );
  });

  it("exposes both reads as un-gated, agent:prospecting-permissioned entries", () => {
    for (const name of ["find_comparables", "market_comps"]) {
      const e = capability(name);
      expect(e.requiresOtp).toBe(false);
      expect(e.permission).toBe(prospectingToolPermission(name));
      expect(e.auditActor).toBe(PROSPECTING_AGENT_ACTOR);
    }
  });
});

describe("find_comparables", () => {
  const brief = {
    spec: {
      area: "Palm Jumeirah",
      segment: "ultra_luxury" as const,
      unitType: "villa" as const,
      priceMinAed: 30_000_000,
      priceMaxAed: 50_000_000,
      features: [],
    },
  };

  it("returns no comparables and flags unconfigured when the catalog is empty", async () => {
    const out = (await capability("find_comparables").handler(db, CTX, {
      brief,
    })) as { comparables: unknown[]; unconfigured: boolean };
    expect(out.comparables).toEqual([]);
    expect(out.unconfigured).toBe(true);
  });

  it("ranks comparables by similarity and stamps each project + stat figure with provenance", async () => {
    const palmId = await insertProject({
      name: "Palm Villa Collection",
      communityName: "Palm Jumeirah",
      segment: "ultra_luxury",
      unitTypes: ["villa"],
      priceMin: 35_000_000,
      priceMax: 55_000_000,
      source: "dubai_pulse",
      asOf: new Date("2026-02-01T00:00:00Z"),
    });
    // A far-off, non-matching project should be excluded (score 0).
    await insertProject({
      name: "Downtown Studios",
      communityName: "Downtown Dubai",
      segment: "mid",
      unitTypes: ["apartment"],
      priceMin: 1_000_000,
      priceMax: 2_000_000,
      source: "property_monitor",
    });

    await insertTxn({
      marketProjectId: palmId,
      txnDate: "2026-01-15",
      priceAed: 40_000_000,
      pricePerSqft: 9000,
      buyerSegment: "founder",
      source: "dubai_pulse",
      asOf: new Date("2026-02-01T00:00:00Z"),
    });

    const out = (await capability("find_comparables").handler(db, CTX, {
      brief,
    })) as {
      comparables: Array<{
        marketProjectId: string;
        source: string;
        asOf: string | null;
        score: number;
        stats: { recentSalePriceAed: { value: number | null; source: string | null; asOf: string | null } };
      }>;
      unconfigured: boolean;
    };

    expect(out.unconfigured).toBe(false);
    expect(out.comparables).toHaveLength(1);
    const top = out.comparables[0];
    expect(top.marketProjectId).toBe(palmId);
    expect(top.score).toBeGreaterThan(0);
    // Project provenance is stamped.
    expect(top.source).toBe("dubai_pulse");
    expect(top.asOf).toBe("2026-02-01T00:00:00.000Z");
    // SQL-sourced stat figure carries its own source + asOf.
    expect(top.stats.recentSalePriceAed.value).toBe(40_000_000);
    expect(top.stats.recentSalePriceAed.source).toBe("dubai_pulse");
    expect(top.stats.recentSalePriceAed.asOf).toBe("2026-02-01T00:00:00.000Z");
  });

  it("is deterministic across repeated reads over unchanged data", async () => {
    await insertProject({
      name: "Palm Villa Collection",
      communityName: "Palm Jumeirah",
      segment: "ultra_luxury",
      unitTypes: ["villa"],
      priceMin: 35_000_000,
      priceMax: 55_000_000,
      source: "dubai_pulse",
    });
    const e = capability("find_comparables");
    const first = await e.handler(db, CTX, { brief });
    const second = await e.handler(db, CTX, { brief });
    expect(second).toEqual(first);
  });
});

describe("market_comps", () => {
  it("returns comps + index figures for an area, each stamped with source + as-of", async () => {
    const palmId = await insertProject({
      name: "Palm Villa Collection",
      communityName: "Palm Jumeirah",
      segment: "ultra_luxury",
      source: "dubai_pulse",
    });
    await insertTxn({
      marketProjectId: palmId,
      txnDate: "2026-03-01",
      priceAed: 42_000_000,
      pricePerSqft: 9500,
      buyerSegment: "family_office",
      source: "dubai_pulse",
      asOf: new Date("2026-03-15T00:00:00Z"),
    });
    await db.insert(marketPriceIndex).values({
      areaName: "Palm Jumeirah",
      segment: "ultra_luxury",
      period: "2026-Q1",
      indexValue: 312.5,
      avgPricePerSqft: 9400,
      yoyPct: 12.4,
      source: "dld_drspi",
      asOf: new Date("2026-04-01T00:00:00Z"),
    });

    const out = (await capability("market_comps").handler(db, CTX, {
      area: "Palm Jumeirah",
    })) as {
      area: string | null;
      comps: Array<{ marketProjectId: string; recentSalePriceAed?: unknown }>;
      priceIndex: Array<{ areaName: string; source: string; asOf: string | null; indexValue: number | null }>;
      unconfigured: boolean;
    };

    expect(out.area).toBe("Palm Jumeirah");
    expect(out.unconfigured).toBe(false);
    expect(out.comps).toHaveLength(1);
    expect(out.comps[0].marketProjectId).toBe(palmId);
    expect(out.priceIndex).toHaveLength(1);
    expect(out.priceIndex[0]).toMatchObject({
      areaName: "Palm Jumeirah",
      source: "dld_drspi",
      asOf: "2026-04-01T00:00:00.000Z",
      indexValue: 312.5,
    });
  });

  it("flags unconfigured when no comps or index figures exist for the area", async () => {
    const out = (await capability("market_comps").handler(db, CTX, {
      area: "Nowhere Island",
    })) as { comps: unknown[]; priceIndex: unknown[]; unconfigured: boolean };
    expect(out.comps).toEqual([]);
    expect(out.priceIndex).toEqual([]);
    expect(out.unconfigured).toBe(true);
  });

  it("filters by segment when provided", async () => {
    await insertProject({
      name: "Ultra Tower",
      communityName: "Business Bay",
      segment: "ultra_luxury",
      source: "dubai_pulse",
    });
    await insertProject({
      name: "Mid Block",
      communityName: "Business Bay",
      segment: "mid",
      source: "dubai_pulse",
    });

    const out = (await capability("market_comps").handler(db, CTX, {
      area: "Business Bay",
      segment: "ultra_luxury",
    })) as { comps: Array<{ marketProjectId: string }> };
    // Only the ultra_luxury project's stats are returned (one comp row).
    expect(out.comps).toHaveLength(1);
  });
});
