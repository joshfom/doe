import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit sanity tests for the `lead_nudge` job handler (task 6.2).
 *
 * Drives the REAL handler THROUGH THE JOB SPINE (`enqueueJob` + `runJob`) with a
 * fake `ChannelAdapter`, asserting the four behaviours the requirements pin on
 * it: notify the owner by qualification facts (Req 10.3), keep the raw phone out
 * of every event payload (Req 10.4/10.6, 13), suppress on a fresh interaction
 * (Req 11.5) and on the per-lead rate cap (Req 11.3), and stay re-runnable with
 * at-most-once external delivery (Req 11.2). The property coverage for the cap
 * and idempotency lives in tasks 6.4 / 6.5.
 *
 * pg-mem harness mirrors `lib/cms/jobs/side-effect-idempotency.test.ts`:
 * migration 0029 is applied under an in-memory Postgres so the real
 * `parties` / `reps` / `leads_mirror` / `jobs` / `events` / `sf_outbox` tables
 * exist with their true shapes and unique `job_key` constraints.
 */

import * as schema from "../schema";
import {
  parties,
  leadsMirror,
  reps,
  jobs as jobsTable,
  events as eventsTable,
  sfOutbox,
} from "../schema";
import type { Database } from "../db";
import { enqueueJob, runJob, type JobHandlerRegistry, type JobHandler } from "./index";
import { composeNudge, createLeadNudgeHandler } from "./lead-nudge";
import { nudgeJobKey, DEFAULT_NUDGE_POLICY } from "../leads/nudge";
import type { ChannelAdapter, ChannelMessage } from "./channel-adapter";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

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

/** A fake channel that counts and records every send. */
class CountingChannelAdapter implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

const REP_PHONE = "+971500000009";

/** Seed a rep and an owned lead. `staleHoursAgo`/`fresh` shape the timing. */
async function seedOwnedLead(
  db: Database,
  opts: { lastInteractionHoursAgo: number | null }
): Promise<{ repId: string; partyId: string }> {
  const [rep] = await db
    .insert(reps)
    .values({
      name: "Aisha",
      languages: ["en"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
      phone: REP_PHONE,
    })
    .returning({ id: reps.id });

  const [party] = await db
    .insert(parties)
    .values({ type: "person", name: "Lina", language: "en" })
    .returning({ id: parties.id });

  const lastInteractionAt =
    opts.lastInteractionHoursAgo === null
      ? null
      : new Date(Date.now() - opts.lastInteractionHoursAgo * 3600_000);

  await db.insert(leadsMirror).values({
    partyId: party.id,
    tier: "HOT",
    projectInterest: "Bayn",
    budgetBand: "2M-3M",
    lastInteractionSummary: "Keen on a 2-bed.",
    lastInteractionAt,
    assignedRepId: rep.id,
  });

  return { repId: rep.id, partyId: party.id };
}

function registryWith(adapter: ChannelAdapter): JobHandlerRegistry {
  const noop: JobHandler = async () => {};
  return {
    post_call_processing: noop,
    compile_and_email_report: noop,
    morning_briefing: noop,
    send_whatsapp_brief: noop,
    lead_nudge: createLeadNudgeHandler(adapter),
    briefing_assembly: noop,
  };
}

async function eventsOfType(db: Database, type: string) {
  return db
    .select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(eq(eventsTable.type, type));
}

describe("composeNudge (pure)", () => {
  it("describes the lead by qualification facts and never includes a phone", () => {
    const body = composeNudge({
      repName: "Aisha",
      leadName: "Lina",
      tier: "HOT",
      projectInterest: "Bayn",
      unitInterest: "2-bed",
      budgetBand: "2M-3M",
      lastInteractionSummary: "Keen on a 2-bed.",
    });
    expect(body).toContain("Aisha");
    expect(body).toContain("Lina");
    expect(body).toContain("HOT");
    expect(body).toContain("Bayn");
    expect(body).not.toContain("+971");
  });
});

describe("lead_nudge handler (task 6.2)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("notifies the owner, enqueues a Salesforce side effect, and leaks no raw phone (Req 10.3–10.6)", async () => {
    const adapter = new CountingChannelAdapter();
    const { partyId } = await seedOwnedLead(db, { lastInteractionHoursAgo: 48 });
    const now = new Date();
    const jobKey = nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY);
    const jobId = await enqueueJob(db, "lead_nudge", { partyId, type: "stale" }, jobKey);

    await runJob(db, jobId, registryWith(adapter));

    // One notification, addressed to the rep's phone (only the adapter sees it).
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].to).toBe(REP_PHONE);

    // A delivered-nudge event was recorded and a Salesforce task enqueued.
    expect(await eventsOfType(db, "lead.nudged")).toHaveLength(1);
    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].jobKey).toBe(`${jobKey}:sf-task`);

    // PRIVACY: the rep phone appears in NO event payload (Req 10.6, 13.2).
    const allEvents = await db
      .select({ payload: eventsTable.payload })
      .from(eventsTable);
    const dump = JSON.stringify(allEvents);
    expect(dump).not.toContain(REP_PHONE);
  });

  it("suppresses on a fresh interaction and emits lead.nudge.suppressed (Req 11.5)", async () => {
    const adapter = new CountingChannelAdapter();
    const { partyId } = await seedOwnedLead(db, { lastInteractionHoursAgo: 1 });
    const now = new Date();
    const jobKey = nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY);
    const jobId = await enqueueJob(db, "lead_nudge", { partyId, type: "stale" }, jobKey);

    await runJob(db, jobId, registryWith(adapter));

    expect(adapter.sent).toHaveLength(0);
    const suppressed = await eventsOfType(db, "lead.nudge.suppressed");
    expect(suppressed).toHaveLength(1);
    expect((suppressed[0].payload as { reason: string }).reason).toBe(
      "fresh_interaction"
    );
  });

  it("suppresses when the per-lead rate cap is already met in the window (Req 11.3)", async () => {
    const adapter = new CountingChannelAdapter();
    const { partyId } = await seedOwnedLead(db, { lastInteractionHoursAgo: 48 });
    const now = new Date();

    // A prior delivered nudge in this window (a `done` job sharing the prefix).
    await db.insert(jobsTable).values({
      kind: "lead_nudge",
      jobKey: `nudge:stale:${partyId}:prior`,
      status: "done",
      payload: { partyId, type: "stale" },
      updatedAt: now,
    });

    const jobKey = nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY);
    const jobId = await enqueueJob(db, "lead_nudge", { partyId, type: "stale" }, jobKey);
    await runJob(db, jobId, registryWith(adapter));

    expect(adapter.sent).toHaveLength(0);
    const suppressed = await eventsOfType(db, "lead.nudge.suppressed");
    expect(suppressed).toHaveLength(1);
    expect((suppressed[0].payload as { reason: string }).reason).toBe("rate_capped");
  });

  it("is idempotent: repeated re-runs of one jobKey deliver at most one nudge (Req 11.2)", async () => {
    const adapter = new CountingChannelAdapter();
    const { partyId } = await seedOwnedLead(db, { lastInteractionHoursAgo: 48 });
    const now = new Date();
    const jobKey = nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY);
    const jobId = await enqueueJob(db, "lead_nudge", { partyId, type: "stale" }, jobKey);
    const registry = registryWith(adapter);

    await runJob(db, jobId, registry);
    await runJob(db, jobId, registry);
    await runJob(db, jobId, registry);

    expect(adapter.sent).toHaveLength(1);
    const [job] = await db
      .select({ status: jobsTable.status })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    expect(job.status).toBe("done");
  });

  it("on delivery failure stays re-runnable and counts as no delivered nudge (Req 10.5)", async () => {
    const { partyId } = await seedOwnedLead(db, { lastInteractionHoursAgo: 48 });
    const now = new Date();
    const jobKey = nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY);
    const jobId = await enqueueJob(db, "lead_nudge", { partyId, type: "stale" }, jobKey);

    let attempts = 0;
    const sent: ChannelMessage[] = [];
    const flaky: ChannelAdapter = {
      provider: "flaky",
      async send(m: ChannelMessage) {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
        sent.push(m);
        return { messageId: "ok", provider: "flaky" };
      },
    };
    const registry = registryWith(flaky);

    // First run: delivery throws → job failed, no nudge recorded, no outbox row.
    await runJob(db, jobId, registry);
    const [failed] = await db
      .select({ status: jobsTable.status, lastError: jobsTable.lastError })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    expect(failed.status).toBe("failed");
    // The failure indication carries NO raw phone (Req 10.5 privacy-safe).
    expect(failed.lastError ?? "").not.toContain(REP_PHONE);
    expect(await eventsOfType(db, "lead.nudged")).toHaveLength(0);
    expect(await db.select().from(sfOutbox)).toHaveLength(0);

    // Re-run succeeds exactly once.
    await runJob(db, jobId, registry);
    expect(sent).toHaveLength(1);
    expect(await eventsOfType(db, "lead.nudged")).toHaveLength(1);
  });
});
