import { eq } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { reportJobs } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import { sendReportEmail } from "@/lib/cms/ai/email";
import {
  queryPipelineMetrics,
  type PipelineMetrics,
} from "@/lib/cms/metrics/pipeline";
import type { JobContext, JobHandler } from "./index";

// ── compile_and_email_report (W5) — Design §8.5; Requirements 9.5, 10.2 ───────
//
// "Email me that report." The voice `queue_report_email` tool enqueues this job
// keyed `report:{scope}:{period}` (Design §8.5). This handler:
//   1. queries the shared `metrics_*` views for the requested `{ scope, period }`
//      via `queryPipelineMetrics` — the SAME function `get_pipeline_summary`
//      reads, so the spoken figure EQUALS the PDF figure (Property 8 / Req 10.2),
//   2. renders an HTML report and converts it to PDF (headless chromium),
//   3. sends it via Microsoft Graph mail with the PDF attached,
//   4. records the returned `message_id` on a `report_jobs` receipt row, and
//   5. publishes a `report.sent` event for the Demo Console.
//
// The PDF renderer and mail sender are injected behind small interfaces so unit
// tests run with no chromium and no live Graph credentials. The metrics query is
// injectable too, so the consistency test (task 16.5) can pin both surfaces to
// one source.
//
// CONTAINER-ONLY: runs on the job-runner worker tier (Req 12.6). The numbers are
// computed in SQL, never by the LLM (Req 10.3).

/** Payload carried on a `compile_and_email_report` job. */
export interface CompileAndEmailReportPayload {
  /** Destination mailbox for the report. */
  requesterEmail: string;
  /** "exec" | "rep" scope (free-form string per the tool contract). */
  scope: string;
  /** Period label (e.g. "all-time", "this-week"). */
  period: string;
  /** Rep id when `scope === "rep"`. */
  repId?: string;
}

/** Renders report HTML to PDF bytes. Default uses headless chromium. */
export type PdfRenderer = (html: string) => Promise<Uint8Array>;

/** Sends the report email with the PDF attached; returns the message id. */
export type ReportMailSender = (input: {
  recipientEmail: string;
  subject: string;
  html: string;
  pdf: Uint8Array;
  fileName: string;
}) => Promise<{ success: boolean; messageId?: string; error?: string }>;

/** Reads the pipeline metrics for a scope/period. */
export type MetricsQuery = (
  db: Database,
  input: { scope: string; period: string; repId?: string }
) => Promise<PipelineMetrics>;

/**
 * Discriminated failure mode published on a `report.failed` event so the Demo
 * Console (and any subscriber) can tell *why* an emailed report failed without
 * parsing free-text. Each value maps 1:1 to an acceptance criterion:
 *   • `metrics_unavailable` — the Metrics_Pipeline read failed or returned no
 *     data (Requirement 7.7),
 *   • `render_failed`       — the PdfRenderer failed to produce a PDF (7.8),
 *   • `send_failed`         — the Graph_Mailer reported a send failure (7.4),
 *   • `unknown`             — any other failure after the receipt was opened.
 */
export type ReportFailureReason =
  | "metrics_unavailable"
  | "render_failed"
  | "send_failed"
  | "unknown";

/**
 * Internal error carrying the discriminated {@link ReportFailureReason}. Thrown
 * at each failure point in the handler so the single `catch` can publish a
 * `report.failed` event that names the failure mode, then re-throw to let the
 * job spine record job-level failure and permit an idempotent manual re-run
 * under the same `jobKey` (Requirements 7.4, 7.7, 7.8).
 */
class ReportJobError extends Error {
  readonly reason: ReportFailureReason;
  constructor(reason: ReportFailureReason, message: string) {
    super(message);
    this.name = "ReportJobError";
    this.reason = reason;
  }
}

/**
 * A metrics read "returns no data" (Requirement 7.7) when every metric slice is
 * empty or null — no cost rows, no rep-load rows, and no funnel/speed/week-over-
 * week figures. Such a report carries nothing to print, so the job fails rather
 * than emailing an empty report.
 */
function isMetricsEmpty(report: PipelineMetrics): boolean {
  const m = report.metrics;
  return (
    m.costPerQualifiedLead.length === 0 &&
    m.repLoad.length === 0 &&
    m.tierFunnel == null &&
    m.speedToLead == null &&
    m.weekOverWeek == null
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Minimal structural type for the playwright browser used by the default renderer. */
interface PlaywrightBrowser {
  newPage: () => Promise<{
    setContent: (html: string, opts: { waitUntil: string }) => Promise<void>;
    pdf: (opts: {
      format: string;
      printBackground: boolean;
    }) => Promise<Buffer>;
  }>;
  close: () => Promise<void>;
}

/** Injectable dependencies for the handler (all defaulted to live impls). */
export interface CompileAndEmailReportDeps {
  renderPdf?: PdfRenderer;
  sendMail?: ReportMailSender;
  queryMetrics?: MetricsQuery;
}

function parsePayload(payload: unknown): CompileAndEmailReportPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const requesterEmail =
    typeof p.requesterEmail === "string" ? p.requesterEmail : undefined;
  if (!requesterEmail) {
    throw new Error(
      "compile_and_email_report: payload.requesterEmail is required"
    );
  }
  const scope = typeof p.scope === "string" && p.scope ? p.scope : "exec";
  const period =
    typeof p.period === "string" && p.period ? p.period : "all-time";
  const repId = typeof p.repId === "string" ? p.repId : undefined;
  return { requesterEmail, scope, period, repId };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function num(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : esc(value);
}

/**
 * Render the report HTML from pre-computed metric figures. The numbers are
 * printed verbatim from the views — no arithmetic happens here (Req 10.3).
 * Exported so the consistency test (16.5) can assert the spoken figure appears
 * in the rendered report.
 */
export function buildReportHtml(report: PipelineMetrics): string {
  const { scope, period, metrics } = report;
  const f = metrics.tierFunnel ?? {};
  const s = metrics.speedToLead ?? {};

  const costRows = metrics.costPerQualifiedLead
    .map(
      (r) =>
        `<tr><td>${esc(r.channel)}</td><td>${num(r.spend)}</td><td>${num(
          r.qualifiedLeads
        )}</td><td>${num(r.costPerQualifiedLead)}</td></tr>`
    )
    .join("");

  const repRows = metrics.repLoad
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${num(r.assignedLeads)}</td><td>${num(
          r.assignedHot
        )}</td><td>${num(r.capacity)}</td><td>${num(r.utilization)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;margin:0;padding:32px;}
  h1{font-size:22px;margin:0 0 4px;} .meta{color:#666;font-size:13px;margin:0 0 24px;}
  h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px;}
  table{border-collapse:collapse;width:100%;font-size:13px;} th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #f0f0f0;}
  th{color:#555;font-weight:600;background:#fafafa;}
  .kpi{display:inline-block;margin-right:32px;} .kpi .v{font-size:24px;font-weight:700;} .kpi .l{color:#666;font-size:12px;}
</style></head>
<body>
  <h1>ORA Pipeline Report</h1>
  <p class="meta">Scope: ${esc(scope)} &middot; Period: ${esc(period)}</p>

  <h2>Tier funnel</h2>
  <div>
    <span class="kpi"><span class="v">${num(f.hot)}</span><br/><span class="l">HOT</span></span>
    <span class="kpi"><span class="v">${num(f.warm)}</span><br/><span class="l">WARM</span></span>
    <span class="kpi"><span class="v">${num(f.nurture)}</span><br/><span class="l">NURTURE</span></span>
    <span class="kpi"><span class="v">${num(f.qualifiedTotal)}</span><br/><span class="l">Qualified total</span></span>
  </div>

  <h2>Speed to lead</h2>
  <div>
    <span class="kpi"><span class="v">${num(
      s.medianSpeedToLeadSeconds
    )}</span><br/><span class="l">Median speed-to-lead (s)</span></span>
    <span class="kpi"><span class="v">${num(
      s.contactedLeads
    )}</span><br/><span class="l">Contacted leads</span></span>
  </div>

  <h2>Cost per qualified lead by channel</h2>
  <table><thead><tr><th>Channel</th><th>Spend</th><th>Qualified leads</th><th>Cost / qualified lead</th></tr></thead>
  <tbody>${costRows || '<tr><td colspan="4">No data</td></tr>'}</tbody></table>

  <h2>Rep load</h2>
  <table><thead><tr><th>Rep</th><th>Assigned</th><th>Assigned HOT</th><th>Capacity</th><th>Utilization</th></tr></thead>
  <tbody>${repRows || '<tr><td colspan="5">No data</td></tr>'}</tbody></table>
</body></html>`;
}

/**
 * Default PDF renderer: headless chromium via Playwright. Imported lazily so the
 * dependency is only resolved on the container worker tier (never in tests, and
 * never on serverless). The renderer is fully injectable, so the absence of a
 * browser engine never blocks the offline test path.
 */
export const defaultPdfRenderer: PdfRenderer = async (html) => {
  // Lazy, indirected import keeps chromium off the hot path and unresolved by
  // the bundler/test runner (playwright is a container-tier-only dependency).
  const moduleName = "playwright";
  const playwright = (await import(/* @vite-ignore */ moduleName).catch(() => {
    throw new Error(
      "compile_and_email_report: PDF rendering requires 'playwright' (chromium) on the container tier"
    );
  })) as { chromium: { launch: () => Promise<PlaywrightBrowser> } };
  const { chromium } = playwright;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
};

const defaultMailSender: ReportMailSender = (input) =>
  sendReportEmail(input);

/**
 * Build a `compile_and_email_report` {@link JobHandler}, injecting the PDF
 * renderer, mail sender, and metrics query (all default to the live
 * implementations). Tests pass fakes to exercise the full receipt + event flow
 * with no chromium and no Graph credentials.
 */
export function createCompileAndEmailReportHandler(
  deps: CompileAndEmailReportDeps = {}
): JobHandler {
  const renderPdf = deps.renderPdf ?? defaultPdfRenderer;
  const sendMail = deps.sendMail ?? defaultMailSender;
  const queryMetrics = deps.queryMetrics ?? queryPipelineMetrics;

  return async (db: Database, payload: unknown, _ctx: JobContext) => {
    const { requesterEmail, scope, period, repId } = parsePayload(payload);

    // 1) A receipt row tracks the report's lifecycle and carries the message id.
    const [receipt] = await db
      .insert(reportJobs)
      .values({ requesterEmail, scope, period, status: "rendering" })
      .returning({ id: reportJobs.id });

    try {
      // 2) Read the SAME views get_pipeline_summary reads (Property 8 / Req 10.2).
      //    A failed read, or a read that returns no data, is an
      //    `metrics_unavailable` failure (Requirement 7.7).
      let report: PipelineMetrics;
      try {
        report = await queryMetrics(db, { scope, period, repId });
      } catch (err) {
        throw new ReportJobError(
          "metrics_unavailable",
          `compile_and_email_report: metrics read failed: ${errMessage(err)}`
        );
      }
      if (isMetricsEmpty(report)) {
        throw new ReportJobError(
          "metrics_unavailable",
          "compile_and_email_report: metrics read returned no data"
        );
      }

      // 3) Render HTML → PDF (headless chromium by default; numbers from SQL).
      //    A renderer failure is a `render_failed` failure (Requirement 7.8).
      const html = buildReportHtml(report);
      let pdf: Uint8Array;
      try {
        pdf = await renderPdf(html);
      } catch (err) {
        throw new ReportJobError(
          "render_failed",
          `compile_and_email_report: PDF render failed: ${errMessage(err)}`
        );
      }

      // 4) Send via Microsoft Graph with the PDF attached. A thrown error or a
      //    `success: false` result is a `send_failed` failure (Requirement 7.4).
      const subject = `ORA Pipeline Report — ${scope} (${period})`;
      let sent: Awaited<ReturnType<ReportMailSender>>;
      try {
        sent = await sendMail({
          recipientEmail: requesterEmail,
          subject,
          html: `<p>Your requested ORA pipeline report (${esc(scope)}, ${esc(
            period
          )}) is attached as a PDF.</p>`,
          pdf,
          fileName: `ora-report-${scope}-${period}.pdf`,
        });
      } catch (err) {
        throw new ReportJobError(
          "send_failed",
          `compile_and_email_report: mail send failed: ${errMessage(err)}`
        );
      }

      if (!sent.success) {
        throw new ReportJobError(
          "send_failed",
          `compile_and_email_report: mail send failed: ${sent.error ?? "unknown"}`
        );
      }

      // 5) Record the message id on the receipt and mark it sent.
      await db
        .update(reportJobs)
        .set({ status: "sent", messageId: sent.messageId ?? null })
        .where(eq(reportJobs.id, receipt.id));

      // 6) Publish report.sent for the Demo Console (privacy-safe payload — P9).
      await publishEvent(db, {
        type: "report.sent",
        payload: {
          reportJobId: receipt.id,
          scope,
          period,
          messageId: sent.messageId ?? null,
        },
      });
    } catch (err) {
      // Mark the receipt failed so the Console reflects it, publish a
      // `report.failed` event that NAMES the failure mode (metrics unavailable
      // 7.7 / render failure 7.8 / send failure 7.4), and re-throw so the job
      // spine records job-level failure and allows an idempotent manual re-run
      // under the same jobKey. No email is sent on any failure path.
      const reason: ReportFailureReason =
        err instanceof ReportJobError ? err.reason : "unknown";

      await db
        .update(reportJobs)
        .set({ status: "failed" })
        .where(eq(reportJobs.id, receipt.id));

      await publishEvent(db, {
        type: "report.failed",
        payload: {
          reportJobId: receipt.id,
          scope,
          period,
          reason,
        },
      });

      throw err;
    }
  };
}

/** Default handler instance wired to live PDF rendering + Graph mail. */
export const compileAndEmailReportHandler: JobHandler =
  createCompileAndEmailReportHandler();
