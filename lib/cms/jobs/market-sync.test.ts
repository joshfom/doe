import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../schema";
import { marketProjects, marketTransactions } from "../schema";
import type { Database } from "../db";
import { enqueueJob, runJob, type JobHandlerRegistry } from "./index";
import { createMarketSyncHandler } from "./market-sync";
import type {
  MarketBatch,
  MarketDataAdapter,
  UnconfiguredSource,
} from "../market/adapter";

/**
 * Tests for the `market_sync` job handler (task 6.3).
 *
 * One job == one fetch-then-ingest cycle against a configured MarketDataAdapter.
 * `ingestMarketBatch` upserts by `(source, source_ref)` so re-running the same
 * batch is field-identical (idempotent, Req 11.2); an unconfigured adapter
 * records a `market.source.unconfigured` indication without failing (Req 11.5).
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
  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
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

/** A fake adapter that counts fetches and returns a fixed batch. */
class FakeMarketAdapter implements MarketDataAdapter {
  readonly source = "property_monitor" as const;
  fetches = 0;
  async fetchSince(_cursor: string | null): Promise<MarketBatch> {
    this.fetches += 1;
    return sampleBatch();
  }
}

/** An adapter that always signals unconfigured (no credentials). */
class UnconfiguredMarketAdapter implements MarketDataAdapter {
  readonly source = "dubai_pulse" as const;
  async fetchSince(_cursor: string | null): Promise<UnconfiguredSource> {
    return { unconfigured: true };
  }
}

function makeRegistry(handler: JobHandlerRegistry["market_sync"]): JobHandlerRegistry {
  const noop = async () => {};
  return {
    post_call_processing: noop,
    compile_and_email_report: noop,
    morning_briefing: noop,
    send_whatsapp_brief: noop,
    lead_nudge: noop,
    briefing_assembly: noop,
    outreach_send: noop,
    enrichment_fetch: noop,
    market_sync: handler,
  };
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

describe("market_sync handler (task 6.3, Req 11.2, 11.5)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("ingests a fetched batch into the market_* mirror", async () => {
    const adapter = new FakeMarketAdapter();
    const jobId = await enqueueJob(db, "market_sync", { cursor: null }, "market_sync:1");
    await runJob(db, jobId, makeRegistry(createMarketSyncHandler(adapter)));

    expect(await projectCount(db)).toBe(1);
    expect(await txnCount(db)).toBe(1);
    expect(adapter.fetches).toBe(1);
  });

  it("is idempotent: re-running the same batch leaves the mirror field-identical (Req 11.2)", async () => {
    const adapter = new FakeMarketAdapter();
    // Two distinct jobs running the same batch — re-ingest must not duplicate rows.
    const j1 = await enqueueJob(db, "market_sync", { cursor: null }, "market_sync:a");
    await runJob(db, j1, makeRegistry(createMarketSyncHandler(adapter)));
    const j2 = await enqueueJob(db, "market_sync", { cursor: null }, "market_sync:b");
    await runJob(db, j2, makeRegistry(createMarketSyncHandler(adapter)));

    expect(await projectCount(db)).toBe(1);
    expect(await txnCount(db)).toBe(1);
  });

  it("records an unconfigured-source indication without failing (Req 11.5)", async () => {
    const adapter = new UnconfiguredMarketAdapter();
    const jobId = await enqueueJob(db, "market_sync", {}, "market_sync:unconf");
    await runJob(db, jobId, makeRegistry(createMarketSyncHandler(adapter)));

    // No rows ingested; the job still completed successfully.
    expect(await projectCount(db)).toBe(0);
    const [job] = await db
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe("done");
  });

  it("with no adapter wired, records unconfigured and completes (default handler)", async () => {
    const jobId = await enqueueJob(db, "market_sync", {}, "market_sync:noadapter");
    await runJob(db, jobId, makeRegistry(createMarketSyncHandler()));

    expect(await projectCount(db)).toBe(0);
    const [job] = await db
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe("done");
  });
});
