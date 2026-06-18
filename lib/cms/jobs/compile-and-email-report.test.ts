import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit tests for the `compile_and_email_report` job handler (task 16.6).
 *
 * Exercises the full offline flow against real SQL (pg-mem + migration 0029)
 * with NO chromium and NO live Microsoft Graph credentials — the PDF renderer,
 * mail sender, and metrics query are all injected:
 *   • metrics read from a fake source standing in for the shared `metrics_*`
 *     views (the consistency test 16.5 pins the real source);
 *   • HTML rendered → PDF via a fake renderer that records the HTML it sees;
 *   • the report sent via a fake Graph sender that returns a message id;
 *   • the message id recorded on a `report_jobs` receipt row (Req 9.5);
 *   • a privacy-safe `report.sent` event published (Req 9.5 / P9);
 *   • the rendered report carries the SQL-computed figures verbatim (Req 10.2).
 *
 * pg-mem harness mirrors `lib/cms/jobs/post-call-processing.test.ts`.
 */

import * as schema from "../schema";
import { reportJobs, events } from "../schema";
import type { Database } from "../db";
import type { PipelineMetrics } from "../metrics/pipeline";
import {
  createCompileAndEmailReportHandler,
  buildReportHtml,
  type ReportMailSender,
  type PdfRenderer,
  type MetricsQuery,
} from "./compile-and-email-report";
import type { JobContext } from "./index";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Migration 0029 ALTERs pre-existing ai_* tables; create minimal stubs first
// (mirrors lib/cms/jobs/post-call-processing.test.ts).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "channel" text,
    "language" text NOT NULL DEFAULT 'en',
    "status" text NOT NULL DEFAULT 'active',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" uuid NOT NULL,
    "role" text NOT NULL,
    "content" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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
    repLoad: [
      {
        repId: randomUUID(),
        name: "Sara",
        capacity: 10,
        openHotCount: 4,
        assignedLeads: 7,
        assignedHot: 3,
        utilization: "0.40",
      },
    ],
    weekOverWeek: { qualifiedTotalDelta: 5, hotDelta: 2 },
  },
};

function fakes() {
  const seenHtml: string[] = [];
  const renderPdf: PdfRenderer = async (html) => {
    seenHtml.push(html);
    return new TextEncoder().encode(`%PDF-1.4 ${html.length}`);
  };

  const sentMail: Array<{ recipientEmail: string; pdf: Uint8Array }> = [];
  const sendMail: ReportMailSender = async (input) => {
    sentMail.push({ recipientEmail: input.recipientEmail, pdf: input.pdf });
    return { success: true, messageId: "MSG-TEST-123" };
  };

  const queryMetrics: MetricsQuery = async () => REPORT;

  return { seenHtml, sentMail, renderPdf, sendMail, queryMetrics };
}

function ctx(jobKey: string): JobContext {
  return {
    jobId: randomUUID(),
    jobKey,
    kind: "compile_and_email_report",
    partyId: null,
  };
}

describe("compile_and_email_report handler (Req 9.5, 10.2)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("renders the report, sends mail, records the message id, and publishes report.sent", async () => {
    const f = fakes();
    const handler = createCompileAndEmailReportHandler({
      renderPdf: f.renderPdf,
      sendMail: f.sendMail,
      queryMetrics: f.queryMetrics,
    });

    await handler(
      db,
      { requesterEmail: "exec@ora.ae", scope: "exec", period: "all-time" },
      ctx("report:exec:all-time")
    );

    // Receipt row carries the returned message id and is marked sent (Req 9.5).
    const [receipt] = await db.select().from(reportJobs);
    expect(receipt.requesterEmail).toBe("exec@ora.ae");
    expect(receipt.scope).toBe("exec");
    expect(receipt.period).toBe("all-time");
    expect(receipt.status).toBe("sent");
    expect(receipt.messageId).toBe("MSG-TEST-123");

    // Mail was sent once, with the PDF attached.
    expect(f.sentMail).toHaveLength(1);
    expect(f.sentMail[0].recipientEmail).toBe("exec@ora.ae");
    expect(f.sentMail[0].pdf.byteLength).toBeGreaterThan(0);

    // report.sent published with a privacy-safe payload (no raw phone — P9).
    const evs = await db
      .select()
      .from(events)
      .where(eq(events.type, "report.sent"));
    expect(evs).toHaveLength(1);
    const payload = evs[0].payload as Record<string, unknown>;
    expect(payload.messageId).toBe("MSG-TEST-123");
    expect(payload.reportJobId).toBe(receipt.id);
    // Privacy (P9): no raw E.164 phone number anywhere in the payload.
    expect(JSON.stringify(payload)).not.toMatch(/\+\d{7,}/);
    expect(Object.keys(payload)).not.toContain("phone");
  });

  it("renders the SQL-computed figures verbatim into the report HTML (Req 10.2)", () => {
    const html = buildReportHtml(REPORT);
    // Tier funnel figures appear, computed in SQL, never by the handler.
    expect(html).toContain("12"); // hot
    expect(html).toContain("100"); // qualifiedTotal
    expect(html).toContain("google"); // channel
    expect(html).toContain("Sara"); // rep
    expect(html).toContain("exec"); // scope
    expect(html).toContain("all-time"); // period
  });

  it("marks the receipt failed and rethrows when mail delivery fails", async () => {
    const f = fakes();
    const failingSend: ReportMailSender = async () => ({
      success: false,
      error: "graph 401",
    });
    const handler = createCompileAndEmailReportHandler({
      renderPdf: f.renderPdf,
      sendMail: failingSend,
      queryMetrics: f.queryMetrics,
    });

    await expect(
      handler(
        db,
        { requesterEmail: "exec@ora.ae", scope: "exec", period: "all-time" },
        ctx("report:exec:all-time")
      )
    ).rejects.toThrow(/mail send failed/);

    const [receipt] = await db.select().from(reportJobs);
    expect(receipt.status).toBe("failed");
    expect(receipt.messageId).toBeNull();

    // No report.sent on failure.
    const evs = await db
      .select()
      .from(events)
      .where(eq(events.type, "report.sent"));
    expect(evs).toHaveLength(0);
  });

  it("throws when payload.requesterEmail is absent", async () => {
    const f = fakes();
    const handler = createCompileAndEmailReportHandler({
      renderPdf: f.renderPdf,
      sendMail: f.sendMail,
      queryMetrics: f.queryMetrics,
    });
    await expect(
      handler(db, { scope: "exec", period: "all-time" }, ctx("report:x"))
    ).rejects.toThrow(/requesterEmail is required/);
  });
});
