import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit tests for job side-effect idempotency (task 16.9).
 *
 * Reinforces Property 7 (Req 9.2, 9.3, 9.7) at the LEVEL OF THE REAL HEAVY
 * HANDLERS: rather than the generic counting handlers of
 * `idempotency.property.test.ts` (task 4.2), these tests run each genuine
 * heavy handler — `compile_and_email_report`, `morning_briefing`, and
 * `send_whatsapp_brief` — THROUGH THE JOB SPINE (`enqueueJob` + `runJob`)
 * MORE THAN ONCE for the SAME `jobKey`, with FAKE email/WhatsApp adapters
 * (and fake metrics / PDF). The external side effect (Graph mail send, or
 * WhatsApp send) must happen AT MOST ONCE across every re-run.
 *
 * The point of Property 7 is that the at-most-once guarantee comes from the
 * spine's atomic claim + terminal-state no-op, NOT from anything inside the
 * handlers. So these tests deliberately wire the real handlers into a registry
 * and let the spine drive re-runs (sequential, concurrent, and after a forced
 * failure), asserting the injected adapters are called exactly once.
 *
 * **Validates: Requirements 9.2, 9.3, 9.7**
 *
 * pg-mem harness mirrors `lib/cms/jobs/send-whatsapp-brief.test.ts`: migration
 * 0029 is applied under an in-memory Postgres so the real `parties` / `reps` /
 * `leads_mirror` / `report_jobs` / `jobs` / `events` tables exist with their
 * true column shapes and the unique `job_key` constraint. `gen_random_uuid()`
 * and `pg_notify` are stubbed (pg-mem ships neither).
 */

import * as schema from "../schema";
import { parties, leadsMirror, reps, jobs as jobsTable } from "../schema";
import type { Database } from "../db";
import {
  enqueueJob,
  runJob,
  type JobContext,
  type JobHandler,
  type JobHandlerRegistry,
} from "./index";
import {
  createCompileAndEmailReportHandler,
  type ReportMailSender,
  type PdfRenderer,
  type MetricsQuery,
} from "./compile-and-email-report";
import {
  createMorningBriefingHandler,
  type BriefingMailer,
  type MetricsReader,
  type WeekOverWeekMetrics,
} from "./morning-briefing";
import { createSendWhatsappBriefHandler } from "./send-whatsapp-brief";
import type {
  ChannelAdapter,
  ChannelMessage,
} from "./channel-adapter";
import type { PipelineMetrics } from "../metrics/pipeline";

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

// ── Fakes for the external side effects ───────────────────────────────────────

/** A fake WhatsApp/SMS channel that counts every send. */
class CountingChannelAdapter implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

/** Fixed pipeline metrics standing in for the shared `metrics_*` views. */
const REPORT: PipelineMetrics = {
  scope: "exec",
  period: "all-time",
  metrics: {
    costPerQualifiedLead: [
      {
        channel: "google",
        spend: "12000.00",
        qualifiedLeads: 40,
        costPerQualifiedLead: "300.00",
      },
    ],
    tierFunnel: { hot: 12, warm: 30, nurture: 58, qualifiedTotal: 100 },
    speedToLead: { medianSpeedToLeadSeconds: 420, contactedLeads: 88 },
    repLoad: [],
    weekOverWeek: { qualifiedTotalDelta: 5, hotDelta: 2 },
  },
};

const WOW: WeekOverWeekMetrics = {
  currentWeek: "2026-05-04",
  priorWeek: "2026-04-27",
  qualifiedTotal: 18,
  priorQualifiedTotal: 12,
  qualifiedTotalDelta: 6,
  hot: 7,
  priorHot: 4,
  hotDelta: 3,
  spend: 42000,
  priorSpend: 38000,
  spendDelta: 4000,
  medianSpeedToLeadSeconds: 1800,
  priorMedianSpeedToLeadSeconds: 2400,
  medianSpeedToLeadDelta: -600,
  costPerQualifiedLead: 2333.33,
  priorCostPerQualifiedLead: 3166.67,
};

/**
 * Build a registry of the REAL heavy handlers, each wired to a fake side-effect
 * collaborator whose call count we track. `post_call_processing` is unused here
 * (these tests target the email/WhatsApp side effects) so it is a no-op.
 */
function makeRegistry(): {
  registry: JobHandlerRegistry;
  reportMailSends: () => number;
  briefingMailSends: () => number;
  whatsappAdapter: CountingChannelAdapter;
} {
  let reportMailCount = 0;
  let briefingMailCount = 0;

  const renderPdf: PdfRenderer = async (html) =>
    new TextEncoder().encode(`%PDF-1.4 ${html.length}`);
  const reportSendMail: ReportMailSender = async () => {
    reportMailCount += 1;
    return { success: true, messageId: `MSG-${reportMailCount}` };
  };
  const queryMetrics: MetricsQuery = async () => REPORT;

  const readMetrics: MetricsReader = async () => WOW;
  const briefingSendMail: BriefingMailer = async () => {
    briefingMailCount += 1;
    return { success: true };
  };

  const whatsappAdapter = new CountingChannelAdapter();

  const noop: JobHandler = async () => {};

  const registry: JobHandlerRegistry = {
    post_call_processing: noop,
    compile_and_email_report: createCompileAndEmailReportHandler({
      renderPdf,
      sendMail: reportSendMail,
      queryMetrics,
    }),
    morning_briefing: createMorningBriefingHandler({
      readMetrics,
      narrate: async () => "Strong start.",
      sendMail: briefingSendMail,
    }),
    send_whatsapp_brief: createSendWhatsappBriefHandler(whatsappAdapter),
  };

  return {
    registry,
    reportMailSends: () => reportMailCount,
    briefingMailSends: () => briefingMailCount,
    whatsappAdapter,
  };
}

async function seedRepAndLead(
  db: Database
): Promise<{ repId: string; partyId: string }> {
  const [rep] = await db
    .insert(reps)
    .values({
      name: "Aisha",
      languages: ["en", "ar"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
      phone: "+971500000001",
    })
    .returning({ id: reps.id });

  const [party] = await db
    .insert(parties)
    .values({ type: "person", name: "Lina", language: "en" })
    .returning({ id: parties.id });

  await db.insert(leadsMirror).values({
    partyId: party.id,
    tier: "HOT",
    projectInterest: "Bayn",
    budgetBand: "2M-3M",
    lastInteractionSummary: "Keen on a 2-bed.",
  });

  return { repId: rep.id, partyId: party.id };
}

async function statusOf(db: Database, jobId: string): Promise<string> {
  const [row] = await db
    .select({ status: jobsTable.status })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  return row.status;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Heavy job side-effect idempotency (task 16.9, Req 9.2, 9.3, 9.7)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("compile_and_email_report sends exactly one email across repeated re-runs of the same jobKey", async () => {
    const h = makeRegistry();
    const jobKey = "report:exec:all-time";
    const jobId = await enqueueJob(
      db,
      "compile_and_email_report",
      { requesterEmail: "exec@ora.ae", scope: "exec", period: "all-time" },
      jobKey
    );

    // Run the same job three times through the spine.
    await runJob(db, jobId, h.registry);
    await runJob(db, jobId, h.registry);
    await runJob(db, jobId, h.registry);

    expect(h.reportMailSends()).toBe(1); // at most once (exactly once on success)
    expect(await statusOf(db, jobId)).toBe("done");
  });

  it("morning_briefing delivers exactly one mail across repeated re-runs of the same jobKey", async () => {
    const h = makeRegistry();
    const jobKey = "briefing:2026-05-04";
    const jobId = await enqueueJob(
      db,
      "morning_briefing",
      { recipientEmail: "exec@ora.ae", recipientName: "Layla" },
      jobKey
    );

    await runJob(db, jobId, h.registry);
    await runJob(db, jobId, h.registry);
    await runJob(db, jobId, h.registry);

    expect(h.briefingMailSends()).toBe(1);
    expect(await statusOf(db, jobId)).toBe("done");
  });

  it("send_whatsapp_brief sends exactly one WhatsApp message across repeated re-runs of the same jobKey", async () => {
    const h = makeRegistry();
    const { repId, partyId } = await seedRepAndLead(db);
    const jobKey = `whatsapp:${repId}:${partyId}`;
    const jobId = await enqueueJob(
      db,
      "send_whatsapp_brief",
      { repId, partyId },
      jobKey
    );

    await runJob(db, jobId, h.registry);
    await runJob(db, jobId, h.registry);
    await runJob(db, jobId, h.registry);

    expect(h.whatsappAdapter.sent).toHaveLength(1);
    expect(h.whatsappAdapter.sent[0].to).toBe("+971500000001"); // rep phone
    expect(await statusOf(db, jobId)).toBe("done");
  });

  it("re-enqueuing the same jobKey never produces a duplicate side effect (one row, one send)", async () => {
    const h = makeRegistry();
    const { repId, partyId } = await seedRepAndLead(db);
    const jobKey = `whatsapp:${repId}:${partyId}`;

    // Enqueue the SAME logical job three times (e.g. a retried tool call).
    const id1 = await enqueueJob(db, "send_whatsapp_brief", { repId, partyId }, jobKey);
    const id2 = await enqueueJob(db, "send_whatsapp_brief", { repId, partyId }, jobKey);
    const id3 = await enqueueJob(db, "send_whatsapp_brief", { repId, partyId }, jobKey);

    // ON CONFLICT DO NOTHING collapses to one row → same id every time.
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
    const rows = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.jobKey, jobKey));
    expect(rows).toHaveLength(1);

    await runJob(db, id1, h.registry);
    await runJob(db, id1, h.registry);

    expect(h.whatsappAdapter.sent).toHaveLength(1);
  });

  it("concurrent re-runs of one jobKey still yield at most one side effect", async () => {
    const h = makeRegistry();
    const { repId, partyId } = await seedRepAndLead(db);
    const jobKey = `whatsapp:concurrent:${repId}`;
    const jobId = await enqueueJob(
      db,
      "send_whatsapp_brief",
      { repId, partyId },
      jobKey
    );

    // Fire several runs concurrently — the atomic claim must let only one win.
    await Promise.all([
      runJob(db, jobId, h.registry),
      runJob(db, jobId, h.registry),
      runJob(db, jobId, h.registry),
      runJob(db, jobId, h.registry),
    ]);

    expect(h.whatsappAdapter.sent).toHaveLength(1);
    expect(await statusOf(db, jobId)).toBe("done");
  });

  it("a failed heavy job stays re-runnable and then sends exactly once (no double-send across the failure)", async () => {
    const { repId, partyId } = await seedRepAndLead(db);
    const jobKey = `whatsapp:retry:${repId}`;
    const jobId = await enqueueJob(
      db,
      "send_whatsapp_brief",
      { repId, partyId },
      jobKey
    );

    // First run: the adapter throws (transient provider outage) → job failed,
    // and crucially NO message was delivered.
    let attempts = 0;
    const flakySends: ChannelMessage[] = [];
    const trackingAdapter: ChannelAdapter = {
      provider: "flaky",
      async send(message: ChannelMessage) {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
        flakySends.push(message);
        return { messageId: "ok", provider: "flaky" };
      },
    };

    const noop: JobHandler = async () => {};
    const registry: JobHandlerRegistry = {
      post_call_processing: noop,
      compile_and_email_report: noop,
      morning_briefing: noop,
      send_whatsapp_brief: createSendWhatsappBriefHandler(trackingAdapter),
    };

    await runJob(db, jobId, registry);
    expect(await statusOf(db, jobId)).toBe("failed");
    expect(flakySends).toHaveLength(0); // throw happened before record kept

    // Manual idempotent re-run completes it, sending exactly once. A further
    // re-run of the now-done job is a no-op.
    await runJob(db, jobId, registry);
    await runJob(db, jobId, registry);

    expect(await statusOf(db, jobId)).toBe("done");
    expect(flakySends).toHaveLength(1);
  });
});
