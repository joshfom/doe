import { describe, it, expect, beforeEach } from "vitest";
import { newDb, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

import type { Database } from "../db";
import * as schema from "../schema";
import {
  marketBuildings,
  marketDevelopers,
  marketPriceIndex,
  marketProjects,
  marketTransactions,
} from "../schema";
import type { MarketBatch } from "./adapter";
import { ingestMarketBatch } from "./ingest";

/**
 * Unit tests for the market-catalog migration + idempotent ingest (task 1.6).
 *
 * Stands up the `market_*` mirror under an in-memory Postgres (pg-mem) using DDL
 * that mirrors migration `0037_market_catalog.sql`, then exercises
 * `ingestMarketBatch`:
 *   - the `demo` column DEFAULTs to false (CC-Provenance / Req 11.1),
 *   - the unique `(source, source_ref)` indexes exist and behave,
 *   - re-ingesting the SAME `(source, source_ref)` batch leaves row counts
 *     unchanged and rows field-identical (CC-Idem / Req 11.2).
 *
 * pg-mem harness mirrors the node-postgres adapter pattern used across
 * `lib/cms/**` tests (see prospecting/optout.test.ts).
 *
 * `project_comparables` references `projects`/`users`, which are not exercised
 * by ingest, so it is omitted from the standalone DDL.
 */

// Mirrors drizzle/0037_market_catalog.sql for the five ingested tables. Cross
// market_* FKs are preserved (ingest resolves them parent-first); the
// project_comparables bridge is omitted (its FKs are irrelevant to ingest).
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

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
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
  // `rowMode: "array"`; strip both, but honour drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
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

const SOURCE = "dubai_pulse";

// A small but cross-linked batch: developer → project → building → transaction,
// plus a standalone price-index row. References use the parent's sourceRef.
function sampleBatch(): MarketBatch {
  return {
    developers: [
      {
        sourceRef: "dev-1",
        name: "Emaar Properties",
        country: "AE",
        asOf: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    projects: [
      {
        sourceRef: "proj-1",
        developerSourceRef: "dev-1",
        name: "Marina Heights",
        communityName: "Dubai Marina",
        city: "Dubai",
        segment: "luxury",
        status: "under_construction",
        totalUnits: 240,
        unitTypes: ["1BR", "2BR", "3BR"],
        priceMin: 1_500_000,
        priceMax: 9_000_000,
        avgPricePerSqft: 2100,
        branded: true,
        brandName: "Address",
        asOf: new Date("2026-01-02T00:00:00Z"),
      },
    ],
    buildings: [
      {
        sourceRef: "bld-1",
        projectSourceRef: "proj-1",
        name: "Tower A",
        floors: 52,
        totalUnits: 120,
        completionYear: 2027,
        asOf: new Date("2026-01-03T00:00:00Z"),
      },
    ],
    transactions: [
      {
        sourceRef: "txn-1",
        projectSourceRef: "proj-1",
        buildingSourceRef: "bld-1",
        communityName: "Dubai Marina",
        areaName: "Marina",
        txnType: "sale",
        txnDate: "2026-01-10",
        unitType: "2BR",
        areaSqm: 120,
        bedrooms: 2,
        priceAed: 4_200_000,
        pricePerSqft: 2200,
        isCash: true,
        buyerSegment: "family_office",
        buyerNationality: "GCC",
        asOf: new Date("2026-01-11T00:00:00Z"),
      },
    ],
    priceIndex: [
      {
        areaName: "Marina",
        segment: "luxury",
        period: "2026-Q1",
        indexValue: 134.5,
        avgPricePerSqft: 2150,
        yoyPct: 8.2,
        asOf: new Date("2026-01-15T00:00:00Z"),
      },
    ],
    cursor: "cursor-1",
  };
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

describe("market catalog migration + idempotent ingest", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("stands up the market_* tables (migration DDL applies cleanly)", async () => {
    // A successful select from each mirror table proves the table exists.
    const rows = await allRows(db);
    expect(rows.developers).toEqual([]);
    expect(rows.projects).toEqual([]);
    expect(rows.buildings).toEqual([]);
    expect(rows.transactions).toEqual([]);
    expect(rows.priceIndex).toEqual([]);
  });

  it("defaults the demo column to false when not supplied", async () => {
    // Insert WITHOUT a demo value — the column DEFAULT must apply (Req 11.1).
    await db.insert(marketDevelopers).values({
      name: "No-Demo Dev",
      nameNormalized: "no-demo dev",
      source: SOURCE,
      sourceRef: "dev-default",
    });

    const [row] = await db.select().from(marketDevelopers);
    expect(row.demo).toBe(false);
  });

  it("enforces the unique (source, source_ref) index on a mirror table", async () => {
    await db.insert(marketDevelopers).values({
      name: "Dup Dev",
      nameNormalized: "dup dev",
      source: SOURCE,
      sourceRef: "dup-1",
    });

    // A second plain insert with the same (source, source_ref) must be rejected
    // by the unique index.
    await expect(
      db.insert(marketDevelopers).values({
        name: "Dup Dev Again",
        nameNormalized: "dup dev again",
        source: SOURCE,
        sourceRef: "dup-1",
      })
    ).rejects.toThrow();
  });

  it("allows the same source_ref under a different source (index is composite)", async () => {
    await db.insert(marketDevelopers).values({
      name: "Dev DP",
      nameNormalized: "dev dp",
      source: "dubai_pulse",
      sourceRef: "shared-ref",
    });
    await expect(
      db.insert(marketDevelopers).values({
        name: "Dev PM",
        nameNormalized: "dev pm",
        source: "property_monitor",
        sourceRef: "shared-ref",
      })
    ).resolves.not.toThrow();

    const rows = await db.select().from(marketDevelopers);
    expect(rows).toHaveLength(2);
  });

  it("ingests a batch, stamping demo=false and resolving cross-record refs", async () => {
    await ingestMarketBatch(db, SOURCE, sampleBatch());

    const rows = await allRows(db);
    expect(rows.developers).toHaveLength(1);
    expect(rows.projects).toHaveLength(1);
    expect(rows.buildings).toHaveLength(1);
    expect(rows.transactions).toHaveLength(1);
    expect(rows.priceIndex).toHaveLength(1);

    // Every ingested row is stamped live (demo=false).
    for (const group of Object.values(rows)) {
      for (const r of group) {
        expect((r as { demo: boolean }).demo).toBe(false);
        expect((r as { source: string }).source).toBe(SOURCE);
      }
    }

    // Parent refs resolved to mirror ids.
    expect(rows.projects[0].developerId).toBe(rows.developers[0].id);
    expect(rows.buildings[0].marketProjectId).toBe(rows.projects[0].id);
    expect(rows.transactions[0].marketProjectId).toBe(rows.projects[0].id);
    expect(rows.transactions[0].marketBuildingId).toBe(rows.buildings[0].id);
  });

  it("re-ingesting the SAME batch is idempotent: counts unchanged, rows field-identical", async () => {
    const batch = sampleBatch();

    await ingestMarketBatch(db, SOURCE, batch);
    const first = await allRows(db);

    // Re-ingest the exact same batch.
    await ingestMarketBatch(db, SOURCE, batch);
    const second = await allRows(db);

    // Counts unchanged on every mirror table.
    expect(second.developers).toHaveLength(first.developers.length);
    expect(second.projects).toHaveLength(first.projects.length);
    expect(second.buildings).toHaveLength(first.buildings.length);
    expect(second.transactions).toHaveLength(first.transactions.length);
    expect(second.priceIndex).toHaveLength(first.priceIndex.length);

    // Rows are field-identical (same ids, same values, same timestamps) — the
    // upsert is a true no-op for an unchanged record (Req 11.2).
    expect(second).toEqual(first);
  });

  it("re-ingest after a value change updates in place without duplicating", async () => {
    await ingestMarketBatch(db, SOURCE, sampleBatch());
    const before = await db.select().from(marketProjects);

    const changed = sampleBatch();
    changed.projects[0].avgPricePerSqft = 2500; // same source_ref, new value
    await ingestMarketBatch(db, SOURCE, changed);

    const after = await db.select().from(marketProjects);
    expect(after).toHaveLength(1); // no duplicate row
    expect(after[0].id).toBe(before[0].id); // same row updated in place
    expect(after[0].avgPricePerSqft).toBe(2500);
  });
});
