import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../schema";
import { targets } from "../schema";
import type { Database } from "../db";
import { enqueueJob, runJob, type JobHandlerRegistry } from "./index";
import { createEnrichmentFetchHandler } from "./enrichment-fetch";
import type {
  EnrichmentProvider,
  ProspectFilter,
  ProviderEnrichment,
  TargetRef,
} from "../prospecting/providers";

/**
 * Tests for the `enrichment_fetch` job handler (task 6.3).
 *
 * The handler fans a Target's enrichment out across the configured providers and
 * persists the merged provenanced attributes. Running it as a job makes a retry
 * idempotent by `jobKey`, bounding the (billable) provider fetch to AT MOST ONE
 * charge per jobKey via the spine's at-most-once claim (Req 3.1, 3.2, 8.2).
 */

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0038 = "0038_prospecting.sql";

const PREREQUISITE_0029 = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;
const PREREQUISITE_0038 = `
  CREATE TABLE "users"    ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "projects" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_units" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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
  mem.public.none(PREREQUISITE_0038);
  applyMigration(mem, MIGRATION_0038);

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

/** A fake provider that counts every enrich call (the modelled provider charge). */
class CountingApolloProvider implements EnrichmentProvider {
  readonly id = "apollo" as const;
  enrichCalls = 0;
  async search(_filter: ProspectFilter) {
    return [];
  }
  async enrich(_target: TargetRef): Promise<ProviderEnrichment> {
    this.enrichCalls += 1;
    return {
      sourceProvider: this.id,
      sourceRef: "apollo-1",
      attributes: {
        seniority: {
          value: "Founder",
          source: "apollo",
          asOf: "2026-05-01T00:00:00.000Z",
          lawfulBasis: "legitimate_interest",
        },
      },
    };
  }
}

async function seedTarget(db: Database): Promise<string> {
  const [row] = await db
    .insert(targets)
    .values({
      targetType: "person",
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
      displayName: "A. Buyer",
      email: "buyer@example.com",
    })
    .returning({ id: targets.id });
  return row.id;
}

function makeRegistry(provider: EnrichmentProvider): JobHandlerRegistry {
  const noop = async () => {};
  return {
    post_call_processing: noop,
    compile_and_email_report: noop,
    morning_briefing: noop,
    send_whatsapp_brief: noop,
    lead_nudge: noop,
    briefing_assembly: noop,
    outreach_send: noop,
    enrichment_fetch: createEnrichmentFetchHandler([provider]),
    market_sync: noop,
  };
}

describe("enrichment_fetch handler (task 6.3, Req 3.1, 3.2, 8.2)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("persists merged provenanced attributes onto the Target", async () => {
    const provider = new CountingApolloProvider();
    const targetId = await seedTarget(db);
    const jobKey = `enrichment_fetch:apollo:${targetId}`;
    const jobId = await enqueueJob(db, "enrichment_fetch", { targetId }, jobKey);

    await runJob(db, jobId, makeRegistry(provider));

    const [row] = await db
      .select({ attributes: targets.attributes, status: targets.status })
      .from(targets)
      .where(eq(targets.id, targetId));
    const attrs = row.attributes as Record<string, { value: string; source: string }>;
    expect(attrs.seniority.value).toBe("Founder");
    expect(attrs.seniority.source).toBe("apollo");
    expect(row.status).toBe("researching");
  });

  it("charges the provider at most once across repeated re-runs of the same jobKey (CC-Idem)", async () => {
    const provider = new CountingApolloProvider();
    const targetId = await seedTarget(db);
    const jobKey = `enrichment_fetch:apollo:${targetId}`;
    const jobId = await enqueueJob(db, "enrichment_fetch", { targetId }, jobKey);

    await runJob(db, jobId, makeRegistry(provider));
    await runJob(db, jobId, makeRegistry(provider));
    await runJob(db, jobId, makeRegistry(provider));

    expect(provider.enrichCalls).toBe(1);
  });

  it("concurrent re-runs of one jobKey still charge the provider at most once", async () => {
    const provider = new CountingApolloProvider();
    const targetId = await seedTarget(db);
    const jobKey = `enrichment_fetch:apollo:${targetId}`;
    const jobId = await enqueueJob(db, "enrichment_fetch", { targetId }, jobKey);

    await Promise.all([
      runJob(db, jobId, makeRegistry(provider)),
      runJob(db, jobId, makeRegistry(provider)),
      runJob(db, jobId, makeRegistry(provider)),
    ]);

    expect(provider.enrichCalls).toBe(1);
  });
});
