import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import {
  jobs as jobsTable,
  outreachDrafts,
  targets,
  prospectOptouts,
  sfOutbox,
} from "../schema";
import type { Database } from "../db";
import { enqueueJob, runJob, type JobHandlerRegistry } from "./index";
import { createOutreachSendHandler } from "./outreach-send";
import type {
  ChannelAdapter,
  ChannelMessage,
} from "./channel-adapter";

/**
 * Tests for the `outreach_send` job handler (task 6.3).
 *
 * The property this job exists to guarantee (Design §Architecture "job
 * extensions"; Requirements 7.2, 8.2 / CC-Idem):
 *
 *   For a given send jobKey, ANY number of retries (sequential or concurrent)
 *   produce AT MOST ONE external send and AT MOST ONE outbox side effect.
 *
 * The at-most-once guarantee comes from the job spine (`runJob`'s atomic claim +
 * terminal-state no-op) plus the outbox `ON CONFLICT (job_key) DO NOTHING`, NOT
 * from anything inside the handler — so these tests wire the REAL handler with a
 * fake counting ChannelAdapter and let the spine drive the re-runs.
 *
 * Harness mirrors `lib/cms/jobs/side-effect-idempotency.test.ts`: migrations
 * 0029 (jobs / events / parties / sf_outbox) and 0038 (prospecting tables) are
 * applied under an in-memory Postgres so the real tables exist with their true
 * column shapes and the unique `job_key` constraints. `gen_random_uuid()` and
 * `pg_notify` are stubbed (pg-mem ships neither).
 */

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0038 = "0038_prospecting.sql";

// Pre-existing tables migration 0029 ALTERs / references.
const PREREQUISITE_0029 = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// Tables 0038's FKs reference that aren't created by 0029 (parties IS created by
// 0029, so it is NOT stubbed here).
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

/** A fake channel that counts every send (the modelled external side effect). */
class CountingChannelAdapter implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

async function seedTarget(
  db: Database,
  overrides: Partial<typeof targets.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(targets)
    .values({
      targetType: "person",
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
      email: "buyer@example.com",
      ...overrides,
    })
    .returning({ id: targets.id });
  return row.id;
}

async function seedDraft(
  db: Database,
  targetId: string,
  channel: "email" | "whatsapp" | "message" = "email"
): Promise<string> {
  const [row] = await db
    .insert(outreachDrafts)
    .values({
      targetId,
      channel,
      language: "en",
      body: "A discreet, data-grounded note.",
      grounding: [],
      status: "approved",
    })
    .returning({ id: outreachDrafts.id });
  return row.id;
}

function makeRegistry(adapter: ChannelAdapter): JobHandlerRegistry {
  const noop = async () => {};
  return {
    post_call_processing: noop,
    compile_and_email_report: noop,
    morning_briefing: noop,
    send_whatsapp_brief: noop,
    lead_nudge: noop,
    briefing_assembly: noop,
    outreach_send: createOutreachSendHandler(adapter),
    enrichment_fetch: noop,
    market_sync: noop,
  };
}

async function statusOf(db: Database, draftId: string): Promise<string> {
  const [row] = await db
    .select({ status: outreachDrafts.status })
    .from(outreachDrafts)
    .where(eq(outreachDrafts.id, draftId));
  return row.status;
}

async function outboxCount(db: Database, jobKey: string): Promise<number> {
  const rows = await db
    .select({ id: sfOutbox.id })
    .from(sfOutbox)
    .where(eq(sfOutbox.jobKey, `${jobKey}:sf-task`));
  return rows.length;
}

describe("outreach_send handler (task 6.3, Req 7.2, 7.3, 8.2)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("sends exactly one message + one outbox row across repeated re-runs of the same jobKey", async () => {
    const adapter = new CountingChannelAdapter();
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    const jobKey = `outreach_send:${draftId}`;
    const jobId = await enqueueJob(db, "outreach_send", { draftId }, jobKey);

    await runJob(db, jobId, makeRegistry(adapter));
    await runJob(db, jobId, makeRegistry(adapter));
    await runJob(db, jobId, makeRegistry(adapter));

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].to).toBe("buyer@example.com");
    expect(await outboxCount(db, jobKey)).toBe(1);
    expect(await statusOf(db, draftId)).toBe("sent");
  });

  it("concurrent re-runs of one jobKey still yield at most one send + one outbox row", async () => {
    const adapter = new CountingChannelAdapter();
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    const jobKey = `outreach_send:${draftId}`;
    const jobId = await enqueueJob(db, "outreach_send", { draftId }, jobKey);

    await Promise.all([
      runJob(db, jobId, makeRegistry(adapter)),
      runJob(db, jobId, makeRegistry(adapter)),
      runJob(db, jobId, makeRegistry(adapter)),
      runJob(db, jobId, makeRegistry(adapter)),
    ]);

    expect(adapter.sent).toHaveLength(1);
    expect(await outboxCount(db, jobKey)).toBe(1);
    expect(await statusOf(db, draftId)).toBe("sent");
  });

  it("re-enqueuing the same jobKey never produces a duplicate send (one row, one send)", async () => {
    const adapter = new CountingChannelAdapter();
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    const jobKey = `outreach_send:${draftId}`;

    const id1 = await enqueueJob(db, "outreach_send", { draftId }, jobKey);
    const id2 = await enqueueJob(db, "outreach_send", { draftId }, jobKey);
    expect(id2).toBe(id1); // ON CONFLICT DO NOTHING collapses to one row

    await runJob(db, id1, makeRegistry(adapter));
    await runJob(db, id1, makeRegistry(adapter));

    expect(adapter.sent).toHaveLength(1);
    expect(await outboxCount(db, jobKey)).toBe(1);
  });

  it("refuses to send to an opted-out Target — no send, no outbox row, draft suppressed (Req 7.3)", async () => {
    const adapter = new CountingChannelAdapter();
    const targetId = await seedTarget(db, { email: "optout@example.com" });
    const draftId = await seedDraft(db, targetId);
    // Opt-out is matched on the normalized email key.
    await db
      .insert(prospectOptouts)
      .values({ matchKind: "email", matchValue: "optout@example.com" });

    const jobKey = `outreach_send:${draftId}`;
    const jobId = await enqueueJob(db, "outreach_send", { draftId }, jobKey);
    await runJob(db, jobId, makeRegistry(adapter));

    expect(adapter.sent).toHaveLength(0);
    expect(await outboxCount(db, jobKey)).toBe(0);
    expect(await statusOf(db, draftId)).toBe("suppressed");
  });

  it("a failed send stays re-runnable and then sends exactly once (no double-send across the failure)", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    const jobKey = `outreach_send:${draftId}`;
    const jobId = await enqueueJob(db, "outreach_send", { draftId }, jobKey);

    let attempts = 0;
    const flakySends: ChannelMessage[] = [];
    const flaky: ChannelAdapter = {
      provider: "flaky",
      async send(message: ChannelMessage) {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
        flakySends.push(message);
        return { messageId: "ok", provider: "flaky" };
      },
    };

    await runJob(db, jobId, makeRegistry(flaky));
    expect(await statusOf(db, draftId)).toBe("approved"); // not sent on failure
    expect(flakySends).toHaveLength(0);

    await runJob(db, jobId, makeRegistry(flaky));
    await runJob(db, jobId, makeRegistry(flaky));

    expect(flakySends).toHaveLength(1);
    expect(await statusOf(db, draftId)).toBe("sent");
    expect(await outboxCount(db, jobKey)).toBe(1);
  });

  it("property: any retry count / concurrency yields at most one send + one outbox row", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        async (runCount, concurrent) => {
          const { db: freshDb } = buildDb();
          const adapter = new CountingChannelAdapter();
          const targetId = await seedTarget(freshDb);
          const draftId = await seedDraft(freshDb, targetId);
          const jobKey = `outreach_send:${draftId}`;
          const jobId = await enqueueJob(
            freshDb,
            "outreach_send",
            { draftId },
            jobKey
          );

          const runs = Array.from({ length: runCount }, () =>
            runJob(freshDb, jobId, makeRegistry(adapter))
          );
          if (concurrent) {
            await Promise.all(runs);
          } else {
            for (const r of runs) await r;
          }

          expect(adapter.sent.length).toBeLessThanOrEqual(1);
          expect(adapter.sent).toHaveLength(1); // exactly once on the happy path
          expect(await outboxCount(freshDb, jobKey)).toBe(1);
          expect(await statusOf(freshDb, draftId)).toBe("sent");
        }
      ),
      { numRuns: 25 }
    );
  });
});
