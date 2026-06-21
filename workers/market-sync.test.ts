import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "@/lib/cms/schema";
import { events, marketProjects, marketTransactions } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import type {
  MarketBatch,
  MarketDataAdapter,
  MarketSource,
  UnconfiguredSource,
} from "@/lib/cms/market/adapter";
import {
  PROPERTY_FINDER_SOURCE,
  PropertyFinderAdapter,
} from "@/lib/cms/market/adapters/property-finder";
import {
  MARKET_SYNC_DEFAULT_INTERVAL_MS,
  MarketSyncTierError,
  assertMarketSyncContainerTier,
  resolveMarketAdapter,
  resolveMarketSyncIntervalMs,
  runMarketSyncTick,
} from "./market-sync";

/**
 * Tests for the market-sync worker (task 8.3).
 *
 * The worker owns only the cadence + the held ingest cursor; the testable unit
 * is `runMarketSyncTick`, exercised here against `pg-mem` with a FAKE adapter so
 * no network is touched ([deps]). Covers: a synced tick ingests + advances the
 * cursor (Req 11.2), re-ingest is idempotent (Req 11.2), an unconfigured source
 * and a missing adapter both idle without crashing (Req 11.5), the container
 * tier guard refuses serverless (CC-Next16), and the interval env default.
 */

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0037 = "0037_market_catalog.sql";

const PREREQUISITE_0029 = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;
const PREREQUISITE_0037 = `
  CREATE TABLE "users"    ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "projects" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyMigration(mem: IMemoryDb, file: string): void {
  const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const stmt of splitStatements(sql)) mem.public.none(stmt);
}

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_0029);
  applyMigration(mem, MIGRATION_0029);
  mem.public.none(PREREQUISITE_0037);
  applyMigration(mem, MIGRATION_0037);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
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
  };
  return { mem, db: drizzle(pool, { schema }) as unknown as Database };
}

function sampleBatch(cursor = "c1"): MarketBatch {
  return {
    developers: [{ sourceRef: "dev-1", name: "Emaar" }],
    projects: [
      {
        sourceRef: "proj-1",
        developerSourceRef: "dev-1",
        name: "Palm Tower",
        communityName: "Palm Jumeirah",
        segment: "ultra_luxury",
      },
    ],
    buildings: [],
    transactions: [
      {
        sourceRef: "txn-1",
        projectSourceRef: "proj-1",
        txnType: "sale",
        txnDate: "2026-03-01",
        priceAed: 40_000_000,
      },
    ],
    priceIndex: [],
    cursor,
  };
}

/** A fake adapter that counts fetches, echoes the cursor it saw, and advances. */
class FakeMarketAdapter implements MarketDataAdapter {
  readonly source = "property_monitor" as const;
  fetches = 0;
  lastCursor: string | null = null;
  async fetchSince(cursor: string | null): Promise<MarketBatch> {
    this.fetches += 1;
    this.lastCursor = cursor;
    return sampleBatch(`cursor-${this.fetches}`);
  }
}

/** An adapter that always signals unconfigured (no credentials). */
class UnconfiguredMarketAdapter implements MarketDataAdapter {
  readonly source = "dubai_pulse" as const;
  async fetchSince(_cursor: string | null): Promise<UnconfiguredSource> {
    return { unconfigured: true };
  }
}

async function projectCount(db: Database): Promise<number> {
  const rows = await db.select({ id: marketProjects.id }).from(marketProjects);
  return rows.length;
}
async function txnCount(db: Database): Promise<number> {
  const rows = await db
    .select({ id: marketTransactions.id })
    .from(marketTransactions);
  return rows.length;
}
async function eventTypes(db: Database): Promise<string[]> {
  const rows = await db.select({ type: events.type }).from(events);
  return rows.map((r) => r.type);
}

describe("market-sync worker tick (task 8.3, Req 11.2, 11.5)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("ingests a fetched batch, advances the cursor, and emits market.synced", async () => {
    const adapter = new FakeMarketAdapter();
    const outcome = await runMarketSyncTick(db, adapter, null);

    expect(outcome.status).toBe("synced");
    if (outcome.status === "synced") {
      expect(outcome.cursor).toBe("cursor-1");
      expect(outcome.counts.projects).toBe(1);
      expect(outcome.counts.transactions).toBe(1);
    }
    expect(adapter.lastCursor).toBeNull();
    expect(await projectCount(db)).toBe(1);
    expect(await txnCount(db)).toBe(1);
    expect(await eventTypes(db)).toContain("market.synced");
  });

  it("holds + advances the cursor across ticks (Req 11.2)", async () => {
    const adapter = new FakeMarketAdapter();
    const first = await runMarketSyncTick(db, adapter, null);
    expect(first.status).toBe("synced");
    const nextCursor = first.status === "synced" ? first.cursor : null;

    const second = await runMarketSyncTick(db, adapter, nextCursor);
    // The second fetch must be handed the cursor advanced by the first tick.
    expect(adapter.lastCursor).toBe("cursor-1");
    expect(second.status).toBe("synced");

    // Idempotent re-ingest: the same (source, source_ref) rows are not duplicated.
    expect(await projectCount(db)).toBe(1);
    expect(await txnCount(db)).toBe(1);
  });

  it("idles (no rows, cursor held) and emits market.source.unconfigured when the source is unconfigured (Req 11.5)", async () => {
    const adapter = new UnconfiguredMarketAdapter();
    const outcome = await runMarketSyncTick(db, adapter, "held");

    expect(outcome.status).toBe("unconfigured");
    if (outcome.status === "unconfigured") {
      expect(outcome.cursor).toBe("held");
      expect(outcome.reason).toBe("source_unconfigured");
    }
    expect(await projectCount(db)).toBe(0);
    expect(await eventTypes(db)).toContain("market.source.unconfigured");
  });

  it("idles when no adapter is wired, recording market.source.unconfigured (no_adapter)", async () => {
    const outcome = await runMarketSyncTick(db, null, null);

    expect(outcome.status).toBe("unconfigured");
    if (outcome.status === "unconfigured") {
      expect(outcome.reason).toBe("no_adapter");
    }
    expect(await projectCount(db)).toBe(0);
    expect(await eventTypes(db)).toContain("market.source.unconfigured");
  });
});

describe("market-sync worker config + tier guard (task 8.3)", () => {
  it("refuses to start on the serverless tier (CC-Next16)", () => {
    expect(() => assertMarketSyncContainerTier(true)).toThrow(
      MarketSyncTierError
    );
  });

  it("permits a container/worker invocation", () => {
    expect(() => assertMarketSyncContainerTier(false)).not.toThrow();
  });

  it("resolves the interval from env, falling back to the default", () => {
    expect(resolveMarketSyncIntervalMs({ MARKET_SYNC_INTERVAL_MS: "60000" })).toBe(
      60000
    );
    expect(resolveMarketSyncIntervalMs({})).toBe(MARKET_SYNC_DEFAULT_INTERVAL_MS);
    expect(
      resolveMarketSyncIntervalMs({ MARKET_SYNC_INTERVAL_MS: "0" })
    ).toBe(MARKET_SYNC_DEFAULT_INTERVAL_MS);
    expect(
      resolveMarketSyncIntervalMs({ MARKET_SYNC_INTERVAL_MS: "nope" })
    ).toBe(MARKET_SYNC_DEFAULT_INTERVAL_MS);
  });

  it("resolves no adapter when no RapidAPI key is wired ([deps], Req 14.1)", () => {
    expect(resolveMarketAdapter({})).toBeNull();
    // A non-RapidAPI key alone does not wire the reseller adapter.
    expect(
      resolveMarketAdapter({ PROPERTY_MONITOR_API_KEY: "k" })
    ).toBeNull();
  });

  it("resolves the PropertyFinderAdapter when RAPIDAPI_KEY is present (Req 14.1)", () => {
    const adapter = resolveMarketAdapter({ RAPIDAPI_KEY: "rk" });
    expect(adapter).toBeInstanceOf(PropertyFinderAdapter);
    expect(adapter?.source).toBe(PROPERTY_FINDER_SOURCE);
  });

  it("resolves the PropertyFinderAdapter via the UAE_REE_API_KEY fallback (Req 14.1)", () => {
    const adapter = resolveMarketAdapter({ UAE_REE_API_KEY: "rk" });
    expect(adapter).toBeInstanceOf(PropertyFinderAdapter);
    expect(adapter?.source).toBe("property_finder_reseller");
  });

  it("stamps the reseller flag + reserves a swappable official source (Req 14.9)", () => {
    // The live reseller source the adapter emits on every ingested row.
    expect(PROPERTY_FINDER_SOURCE).toBe("property_finder_reseller");
    // The MarketSource union reserves `dld_official` for the future swap to an
    // official DLD source behind the same MarketDataAdapter contract — a
    // code-only union member (market_*.source is plain text, no migration).
    const reserved: MarketSource = "dld_official";
    expect(reserved).toBe("dld_official");
  });
});
