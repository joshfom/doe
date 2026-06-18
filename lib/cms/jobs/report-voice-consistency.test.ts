import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Example test for report/voice number consistency (task 16.5).
 *
 * **Property 8: Report/voice number consistency** — `get_pipeline_summary` (the
 * voice tool) and `compile_and_email_report` (the emailed report) read the SAME
 * `metrics_*` SQL views, so the figure DOE speaks aloud for a given
 * `{ scope, period }` EQUALS the figure printed into the PDF report for the same
 * `{ scope, period }`.
 *
 * **Validates: Requirements 10.1, 10.2**
 *
 * Per design §18, Property 8 is an EXAMPLE test (one query pair per
 * scope/period), not a generated property: both surfaces are pinned to one
 * shared dataset and the two figures are compared directly.
 *
 * Harness: pg-mem cannot materialise SQL views or run PERCENTILE_CONT, so the
 * `metrics_*` views are stood up as plain stand-in TABLES with the same
 * names/columns (mirroring `lib/cms/ai/tools/pipeline-summary.test.ts`). With
 * one row of figures seeded into those tables, BOTH surfaces read it:
 *
 *   • voice  → `toolRegistry.get_pipeline_summary.handler` →
 *              `planPipelineSummary` + `executePipelinePlan` (SELECT * verbatim);
 *   • report → `queryPipelineMetrics` (the shared metrics query) →
 *              `buildReportHtml`, and the real `compile_and_email_report`
 *              handler driven with `queryMetrics = queryPipelineMetrics` and a
 *              fake PDF renderer that captures the HTML it is handed.
 *
 * Migration 0029 supplies the `report_jobs` + `events` tables the report
 * handler writes to; the metrics stand-in tables are layered on top.
 */

import * as schema from "../schema";
import type { Database } from "../db";
import { toolRegistry } from "../ai/tools/registry";
import { queryPipelineMetrics } from "../metrics/pipeline";
import {
  buildReportHtml,
  createCompileAndEmailReportHandler,
  type PdfRenderer,
  type ReportMailSender,
} from "./compile-and-email-report";
import type { JobContext } from "./index";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Migration 0029 ALTERs pre-existing ai_* tables; create minimal stubs first
// (mirrors lib/cms/jobs/compile-and-email-report.test.ts).
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

// Stand-in TABLES named like the metrics_* views (pg-mem can't run the views).
// Same names/columns the views expose (drizzle/0030_metrics_views.sql), so BOTH
// surfaces read identical figures. Columns cover everything both
// `executePipelinePlan` (SELECT *) and `queryPipelineMetrics` (aliased) read.
const STANDIN_METRICS_SQL = `
  CREATE TABLE "metrics_tier_funnel_overall" (
    "hot" integer, "warm" integer, "nurture" integer, "qualified_total" integer
  );
  CREATE TABLE "metrics_speed_to_lead_overall" (
    "median_speed_to_lead_seconds" integer, "contacted_leads" integer
  );
  CREATE TABLE "metrics_cost_per_qualified_lead_overall" (
    "channel" text, "spend" integer, "qualified_leads" integer, "cost_per_qualified_lead" integer
  );
  CREATE TABLE "metrics_rep_load" (
    "rep_id" text, "name" text, "capacity" integer, "open_hot_count" integer,
    "assigned_leads" integer, "assigned_hot" integer, "utilization" integer
  );
  CREATE TABLE "metrics_week_over_week" (
    "current_week" date, "prior_week" date, "qualified_total" integer,
    "qualified_total_delta" integer, "hot" integer, "hot_delta" integer
  );
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

  // Layer the metrics stand-in tables on top of the migrated schema.
  mem.public.none(STANDIN_METRICS_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling metrics/report tests.
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

// One shared, deterministic dataset for the exec/overall scope+period. Distinct
// values (avoiding thousands separators) keep verbatim string matches precise.
function seedMetrics(db: Database): Promise<unknown> {
  return Promise.all([
    db.execute(
      `INSERT INTO metrics_tier_funnel_overall VALUES (11, 23, 53, 87)` as never
    ),
    db.execute(
      `INSERT INTO metrics_speed_to_lead_overall VALUES (437, 91)` as never
    ),
    db.execute(
      `INSERT INTO metrics_cost_per_qualified_lead_overall VALUES ('web_call', 900, 18, 64)` as never
    ),
    db.execute(
      `INSERT INTO metrics_rep_load VALUES ('rep-a', 'Aisha', 5, 2, 8, 2, 40)` as never
    ),
  ]);
}

const SCOPE = "exec";
const PERIOD = "overall";

function ctx(jobKey: string): JobContext {
  return {
    jobId: randomUUID(),
    jobKey,
    kind: "compile_and_email_report",
    partyId: null,
  };
}

describe("Property 8 — report/voice number consistency (Req 10.1, 10.2)", () => {
  let db: Database;

  beforeEach(async () => {
    ({ db } = buildDb());
    await seedMetrics(db);
  });

  it("voice spoken figures equal the report figures for the same {scope, period}", async () => {
    // Voice surface: get_pipeline_summary reads the metrics_* views verbatim.
    const spoken = await toolRegistry.get_pipeline_summary.handler(
      db,
      { actor: "agent:voice-lead" },
      { scope: SCOPE, period: PERIOD }
    );

    // Report surface: queryPipelineMetrics reads the SAME views for the report.
    const report = await queryPipelineMetrics(db, {
      scope: SCOPE,
      period: PERIOD,
    });

    // Both surfaces resolved the same scope.
    expect(spoken.scope).toBe(report.scope);

    // The two surfaces shape rows differently (SELECT * snake_case vs aliased
    // camelCase) but the FIGURES are identical because they read one source.
    const spokenTier = spoken.metrics.tierFunnel as Record<string, unknown>;
    const reportTier = report.metrics.tierFunnel as Record<string, unknown>;
    expect(spokenTier.qualified_total).toBe(reportTier.qualifiedTotal);
    expect(spokenTier.qualified_total).toBe(87);
    expect(spokenTier.hot).toBe(reportTier.hot);

    const spokenSpeed = spoken.metrics.speedToLead as Record<string, unknown>;
    const reportSpeed = report.metrics.speedToLead as Record<string, unknown>;
    expect(spokenSpeed.median_speed_to_lead_seconds).toBe(
      reportSpeed.medianSpeedToLeadSeconds
    );
    expect(spokenSpeed.median_speed_to_lead_seconds).toBe(437);

    const spokenCost = (
      spoken.metrics.costPerQualifiedLead as Array<Record<string, unknown>>
    )[0];
    const reportCost = report.metrics.costPerQualifiedLead[0];
    expect(spokenCost.cost_per_qualified_lead).toBe(
      reportCost.costPerQualifiedLead
    );
    expect(spokenCost.cost_per_qualified_lead).toBe(64);
  });

  it("the spoken qualified-total appears verbatim in the rendered report HTML", async () => {
    const spoken = await toolRegistry.get_pipeline_summary.handler(
      db,
      { actor: "agent:voice-lead" },
      { scope: SCOPE, period: PERIOD }
    );
    const spokenQualifiedTotal = (
      spoken.metrics.tierFunnel as Record<string, unknown>
    ).qualified_total as number;

    const report = await queryPipelineMetrics(db, {
      scope: SCOPE,
      period: PERIOD,
    });
    const html = buildReportHtml(report);

    // The exact number DOE speaks is printed into the report (Req 10.2).
    expect(html).toContain(String(spokenQualifiedTotal)); // "87"
    expect(html).toContain("437"); // median speed-to-lead
    expect(html).toContain("web_call"); // cost channel
    expect(html).toContain("Aisha"); // rep load
  });

  it("the real compile_and_email_report handler renders the spoken figure into the report it sends", async () => {
    // What the voice agent would say.
    const spoken = await toolRegistry.get_pipeline_summary.handler(
      db,
      { actor: "agent:voice-lead" },
      { scope: SCOPE, period: PERIOD }
    );
    const spokenQualifiedTotal = (
      spoken.metrics.tierFunnel as Record<string, unknown>
    ).qualified_total as number;

    // Drive the REAL report job, pinned to the shared metrics query, capturing
    // the HTML the PDF renderer is handed (no chromium, no Graph credentials).
    let capturedHtml = "";
    const renderPdf: PdfRenderer = async (html) => {
      capturedHtml = html;
      return new TextEncoder().encode("%PDF-1.4");
    };
    const sendMail: ReportMailSender = async () => ({
      success: true,
      messageId: "MSG-CONSISTENCY",
    });

    const handler = createCompileAndEmailReportHandler({
      renderPdf,
      sendMail,
      queryMetrics: queryPipelineMetrics, // the SAME shared views the tool reads
    });

    await handler(
      db,
      { requesterEmail: "exec@ora.ae", scope: SCOPE, period: PERIOD },
      ctx(`report:${SCOPE}:${PERIOD}`)
    );

    // The figure spoken by get_pipeline_summary is the figure emailed in the PDF.
    expect(capturedHtml).toContain(String(spokenQualifiedTotal)); // "87"
    expect(capturedHtml).toContain("437");
    expect(capturedHtml).toContain("web_call");
  });
});
