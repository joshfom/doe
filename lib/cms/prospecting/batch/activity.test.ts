import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../schema";
import { events, prospectingBatchActivity } from "../../schema";
import type { Database } from "../../db";
import {
  appendActivity,
  assertPrivacySafe,
  publishBatch,
  readActivity,
} from "./activity";

/**
 * Unit tests for the Agent_Activity_Log persistence + event mirroring module
 * (task 5.1; Requirements 3.2, 3.3, 3.4).
 *
 * Stands up the minimal `users` / `prospecting_batch_runs` /
 * `prospecting_batch_activity` / `events` tables under an in-memory Postgres
 * (pg-mem, node-postgres adapter — mirrors `lib/cms/market/ingest.test.ts`) so
 * `appendActivity` / `readActivity` / `publishBatch` execute their real SQL
 * (monotonic-`seq` transaction, `.returning()`, and the `publishEvent`
 * insert + `pg_notify`).
 */

// Minimal DDL: only what the activity module touches, mirroring
// drizzle/0040_agentic_prospecting_batch.sql + the events table.
const DDL = `
  CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());

  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
    "subject" jsonb NOT NULL,
    "cluster_id" text,
    "target_count" integer NOT NULL,
    "status" text NOT NULL DEFAULT 'running',
    "rerun_key" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );

  CREATE TABLE "prospecting_batch_activity" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "batch_run_id" uuid NOT NULL REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
    "seq" integer NOT NULL,
    "action" text NOT NULL,
    "reason" text,
    "target_id" uuid,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );

  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()` — register both
  // (the latter as a no-op) so the real SQL resolves.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => null,
    impure: true,
  });

  mem.public.none(DDL);

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

async function seedRun(db: Database): Promise<string> {
  // Insert the FK owner via raw SQL: the real `users` table has many NOT-NULL
  // columns the minimal test DDL omits, so a Drizzle insert would reference
  // columns this harness does not create.
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);
  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      subject: { kind: "cluster", clusterId: "c1" },
      targetCount: 5,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return run.id;
}

describe("appendActivity", () => {
  let db: Database;
  beforeEach(() => {
    db = buildDb().db;
  });

  it("assigns a monotonic per-run seq starting at 1", async () => {
    const runId = await seedRun(db);

    const a = await appendActivity(db, { batchRunId: runId, action: "discovered" });
    const b = await appendActivity(db, { batchRunId: runId, action: "crm_checked" });
    const c = await appendActivity(db, { batchRunId: runId, action: "scored" });

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
  });

  it("scopes seq independently per run", async () => {
    const run1 = await seedRun(db);
    const run2 = await seedRun(db);

    await appendActivity(db, { batchRunId: run1, action: "discovered" });
    const r2first = await appendActivity(db, {
      batchRunId: run2,
      action: "discovered",
    });
    const r1second = await appendActivity(db, {
      batchRunId: run1,
      action: "scored",
    });

    // Each run keeps its own 1,2,… sequence.
    expect(r2first.seq).toBe(1);
    expect(r1second.seq).toBe(2);
  });

  it("persists action, reason, targetId, and payload", async () => {
    const runId = await seedRun(db);
    const targetId = randomUUID();

    const row = await appendActivity(db, {
      batchRunId: runId,
      action: "skipped",
      reason: "already_in_salesforce",
      targetId,
      payload: { via: "crm" },
    });

    expect(row.action).toBe("skipped");
    expect(row.reason).toBe("already_in_salesforce");
    expect(row.targetId).toBe(targetId);
    expect(row.payload).toEqual({ via: "crm" });
  });

  it("rejects a payload carrying a raw phone number (CC-Privacy, Req 3.4)", async () => {
    const runId = await seedRun(db);

    await expect(
      appendActivity(db, {
        batchRunId: runId,
        action: "discovered",
        payload: { contact: "+971501234567" },
      })
    ).rejects.toThrow(/raw phone/i);

    // Nothing persisted on the rejected append.
    const rows = await db
      .select()
      .from(prospectingBatchActivity)
      .where(eq(prospectingBatchActivity.batchRunId, runId));
    expect(rows).toHaveLength(0);
  });
});

describe("readActivity", () => {
  it("returns rows ordered by seq", async () => {
    const { db } = buildDb();
    const runId = await seedRun(db);

    await appendActivity(db, { batchRunId: runId, action: "discovered" });
    await appendActivity(db, { batchRunId: runId, action: "crm_checked" });
    await appendActivity(db, { batchRunId: runId, action: "drafted" });

    const rows = await readActivity(db, runId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.action)).toEqual([
      "discovered",
      "crm_checked",
      "drafted",
    ]);
  });
});

describe("publishBatch", () => {
  it("publishes an event whose payload merges batchRunId and extra", async () => {
    const { db } = buildDb();
    const runId = await seedRun(db);

    await publishBatch(db, "prospecting.batch.progress", { id: runId }, {
      queued: 3,
    });

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("prospecting.batch.progress");
    expect(rows[0].payload).toEqual({ batchRunId: runId, queued: 3 });
  });

  it("rejects an event payload carrying a raw phone number", async () => {
    const { db } = buildDb();
    const runId = await seedRun(db);

    await expect(
      publishBatch(db, "prospecting.queue.item.queued", { id: runId }, {
        phone: "+971501234567",
      })
    ).rejects.toThrow(/raw phone/i);

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(0);
  });
});

describe("assertPrivacySafe", () => {
  it("accepts internal ids, counts, scores, reasons, and salted hashes", () => {
    expect(() =>
      assertPrivacySafe({
        batchRunId: randomUUID(),
        targetId: randomUUID(),
        queued: 12,
        fitScore: 0.83,
        skipReason: "opted_out",
        periodBucket: "2026-01-15",
        phoneHash: "a".repeat(64),
      })
    ).not.toThrow();
  });

  it("throws on an E.164 phone and on a long national digit run", () => {
    expect(() => assertPrivacySafe({ p: "+971501234567" })).toThrow(/raw phone/i);
    expect(() => assertPrivacySafe(["ok", { nested: "0501234567" }])).toThrow(
      /raw phone/i
    );
  });
});
