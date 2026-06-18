import { sql } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { generateCompletion, type ChatMessage } from "@/lib/cms/ai/gateway";
import { sendGraphMail } from "@/lib/cms/ai/email";
import type { JobContext, JobHandler } from "./index";

// ── morning_briefing (T3) — Design §7.8; Requirements 9.6 ─────────────────────
//
// A scheduled job that emails leadership a short morning briefing. It:
//   1. reads the week-over-week deltas from the `metrics_week_over_week` SQL
//      view (the SINGLE source of analytics arithmetic — Design §11, §15),
//   2. produces a SHORT narrative via the AI gateway (abstracted behind
//      {@link BriefingNarrator}); the LLM only NARRATES — every figure comes
//      from the view, the model never computes arithmetic (FR-T1), and
//   3. delivers the briefing via Microsoft Graph mail (abstracted behind
//      {@link BriefingMailer}).
//
// All three collaborators are injectable so the handler runs fully offline in
// tests — no live Salesforce, no live AI gateway, no live Graph credentials.
//
// CONTAINER-ONLY: runs on the job-runner worker tier (Req 12.6).
//
// Idempotency (Req 9.3 / P7): the job spine (`runJob`) guarantees at-most-once
// execution per `jobKey` (e.g. `briefing:{yyyy-mm-dd}`), so a manual re-run of a
// `failed` briefing never double-sends.

/** Payload carried on a `morning_briefing` job. */
export interface MorningBriefingPayload {
  /**
   * Recipient mailbox(es). Falls back to `ORA_BRIEFING_RECIPIENT_EMAIL` when
   * absent, so a scheduler can enqueue an empty payload.
   */
  recipientEmail?: string | string[];
  /** Display name used in the greeting. Defaults to "team". */
  recipientName?: string;
  /** Narrative + template language. Defaults to "en". */
  language?: "en" | "ar";
}

/**
 * Week-over-week deltas, mirroring the `metrics_week_over_week` view. Every
 * field is computed in SQL; this handler (and the narrator) only READ them.
 */
export interface WeekOverWeekMetrics {
  currentWeek: string | null;
  priorWeek: string | null;
  qualifiedTotal: number;
  priorQualifiedTotal: number;
  qualifiedTotalDelta: number;
  hot: number;
  priorHot: number;
  hotDelta: number;
  spend: number;
  priorSpend: number;
  spendDelta: number;
  medianSpeedToLeadSeconds: number | null;
  priorMedianSpeedToLeadSeconds: number | null;
  medianSpeedToLeadDelta: number | null;
  costPerQualifiedLead: number | null;
  priorCostPerQualifiedLead: number | null;
}

/**
 * Reads the week-over-week deltas. Abstracted so tests can supply fixed figures
 * without standing up the metrics views. Returns `null` when no week has any
 * qualified-lead activity yet.
 */
export type MetricsReader = (db: Database) => Promise<WeekOverWeekMetrics | null>;

/** Turns the computed figures into a short, human narrative. */
export type BriefingNarrator = (
  metrics: WeekOverWeekMetrics | null,
  opts: { language: string }
) => Promise<string>;

/** A rendered briefing email ready to send. */
export interface BriefingEmail {
  to: string[];
  subject: string;
  htmlContent: string;
}

/** Delivers the briefing. Abstracted so tests never touch live Graph creds. */
export type BriefingMailer = (
  email: BriefingEmail
) => Promise<{ success: boolean; error?: string }>;

/** Collaborators for {@link createMorningBriefingHandler}. */
export interface MorningBriefingDeps {
  readMetrics?: MetricsReader;
  narrate?: BriefingNarrator;
  sendMail?: BriefingMailer;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Coerce a pg numeric/text/null column into a JS number (or null). */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce a possibly-null numeric column, preserving null. */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Default reader: pulls the single latest-week row from `metrics_week_over_week`
 * and maps the snake_case columns into {@link WeekOverWeekMetrics}. All
 * arithmetic already happened in SQL.
 */
export const defaultMetricsReader: MetricsReader = async (db) => {
  const result = await db.execute(
    sql`SELECT * FROM metrics_week_over_week LIMIT 1`
  );
  const row = (result.rows as Record<string, unknown>[])[0];
  if (!row) return null;

  return {
    currentWeek: str(row.current_week),
    priorWeek: str(row.prior_week),
    qualifiedTotal: num(row.qualified_total),
    priorQualifiedTotal: num(row.prior_qualified_total),
    qualifiedTotalDelta: num(row.qualified_total_delta),
    hot: num(row.hot),
    priorHot: num(row.prior_hot),
    hotDelta: num(row.hot_delta),
    spend: num(row.spend),
    priorSpend: num(row.prior_spend),
    spendDelta: num(row.spend_delta),
    medianSpeedToLeadSeconds: numOrNull(row.median_speed_to_lead_seconds),
    priorMedianSpeedToLeadSeconds: numOrNull(
      row.prior_median_speed_to_lead_seconds
    ),
    medianSpeedToLeadDelta: numOrNull(row.median_speed_to_lead_delta),
    costPerQualifiedLead: numOrNull(row.cost_per_qualified_lead),
    priorCostPerQualifiedLead: numOrNull(row.prior_cost_per_qualified_lead),
  };
};

const NARRATIVE_SYSTEM_PROMPT = [
  "You are a sales-operations analyst writing a SHORT morning briefing for",
  "real-estate leadership. You will be given a JSON object of pre-computed",
  "week-over-week figures. Write 2-4 plain sentences that narrate the story",
  "behind the numbers: what moved up or down versus the prior week and what it",
  "implies for the day.",
  "",
  "STRICT RULES:",
  "- NEVER compute, re-derive, or invent any number. Every figure is already in",
  "  the JSON; use ONLY those values. Do not add, subtract, average, or round.",
  "- Do not output a list, headings, or markdown — just short prose.",
  "- If a figure is null, simply omit it rather than guessing.",
].join("\n");

/**
 * Default narrator: routes the figures through the AI gateway. The figures are
 * passed verbatim as JSON; the prompt forbids the model from doing arithmetic.
 * On any gateway failure it falls back to a deterministic, figure-only sentence
 * so a flaky model never dead-letters the briefing.
 */
export const defaultBriefingNarrator: BriefingNarrator = async (
  metrics,
  opts
) => {
  if (!metrics) {
    return opts.language === "ar"
      ? "لا يوجد نشاط مؤهل مسجل حتى الآن لهذا الأسبوع."
      : "No qualified-lead activity has been recorded yet this week.";
  }

  const messages: ChatMessage[] = [
    { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Language: ${opts.language}\n\nFigures (JSON):\n${JSON.stringify(
        metrics,
        null,
        2
      )}`,
    },
  ];

  try {
    const completion = await generateCompletion(messages, {
      temperature: 0.3,
      maxTokens: 220,
    });
    const text = completion.trim();
    if (text.length > 0) return text;
  } catch {
    // fall through to deterministic fallback
  }

  return fallbackNarrative(metrics, opts.language);
};

/** A figure-only narrative used when the gateway is unavailable. */
function fallbackNarrative(
  m: WeekOverWeekMetrics,
  language: string
): string {
  const dir = (d: number) =>
    language === "ar"
      ? d > 0
        ? "ارتفاع"
        : d < 0
          ? "انخفاض"
          : "ثبات"
      : d > 0
        ? "up"
        : d < 0
          ? "down"
          : "flat";
  if (language === "ar") {
    return `العملاء المؤهلون: ${m.qualifiedTotal} (${dir(m.qualifiedTotalDelta)} ${m.qualifiedTotalDelta}). العملاء الساخنون: ${m.hot} (${dir(m.hotDelta)} ${m.hotDelta}).`;
  }
  return `Qualified leads stand at ${m.qualifiedTotal} (${dir(m.qualifiedTotalDelta)} ${m.qualifiedTotalDelta} vs prior week); HOT leads at ${m.hot} (${dir(m.hotDelta)} ${m.hotDelta}).`;
}

/** Format a signed delta for display (e.g. "+3", "-2", "0"). */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Render the briefing email body. Figures come straight from the view. */
export function buildMorningBriefingHtml(input: {
  recipientName: string;
  narrative: string;
  metrics: WeekOverWeekMetrics | null;
  language: "en" | "ar";
}): string {
  const { recipientName, narrative, metrics, language } = input;
  const ar = language === "ar";
  const dir = ar ? "rtl" : "ltr";
  const lang = ar ? "ar" : "en";

  const t = ar
    ? {
        title: "إيجاز الصباح",
        greeting: `صباح الخير ${recipientName}،`,
        metric: "المؤشر",
        current: "الحالي",
        prior: "السابق",
        delta: "التغير",
        qualified: "العملاء المؤهلون",
        hot: "العملاء الساخنون",
        spend: "الإنفاق",
        cpl: "تكلفة العميل المؤهل",
        noData: "لا توجد بيانات أسبوعية بعد.",
        footer: "— لوحة ORA",
      }
    : {
        title: "Morning Briefing",
        greeting: `Good morning ${recipientName},`,
        metric: "Metric",
        current: "Current",
        prior: "Prior",
        delta: "Δ",
        qualified: "Qualified leads",
        hot: "HOT leads",
        spend: "Spend",
        cpl: "Cost / qualified lead",
        noData: "No weekly data yet.",
        footer: "— ORA Console",
      };

  const rows = metrics
    ? [
        [t.qualified, metrics.qualifiedTotal, metrics.priorQualifiedTotal, signed(metrics.qualifiedTotalDelta)],
        [t.hot, metrics.hot, metrics.priorHot, signed(metrics.hotDelta)],
        [t.spend, metrics.spend, metrics.priorSpend, signed(metrics.spendDelta)],
        [
          t.cpl,
          metrics.costPerQualifiedLead ?? "—",
          metrics.priorCostPerQualifiedLead ?? "—",
          metrics.costPerQualifiedLead !== null &&
          metrics.priorCostPerQualifiedLead !== null
            ? signed(
                Math.round(
                  (metrics.costPerQualifiedLead -
                    metrics.priorCostPerQualifiedLead) *
                    100
                ) / 100
              )
            : "—",
        ],
      ]
    : [];

  const tableRows = rows
    .map(
      ([label, cur, prev, d]) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:${ar ? "left" : "right"};font-variant-numeric:tabular-nums;">${cur}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:${ar ? "left" : "right"};color:#888;font-variant-numeric:tabular-nums;">${prev}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:${ar ? "left" : "right"};font-weight:600;font-variant-numeric:tabular-nums;">${d}</td>
        </tr>`
    )
    .join("");

  const table = metrics
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;font-size:14px;">
        <thead>
          <tr style="background:#fafafa;">
            <th style="padding:8px 12px;text-align:${ar ? "right" : "left"};border-bottom:2px solid #eee;">${t.metric}</th>
            <th style="padding:8px 12px;text-align:${ar ? "left" : "right"};border-bottom:2px solid #eee;">${t.current}</th>
            <th style="padding:8px 12px;text-align:${ar ? "left" : "right"};border-bottom:2px solid #eee;">${t.prior}</th>
            <th style="padding:8px 12px;text-align:${ar ? "left" : "right"};border-bottom:2px solid #eee;">${t.delta}</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`
    : `<p style="margin:0 0 24px;color:#888;">${t.noData}</p>`;

  return `<!DOCTYPE html><html dir="${dir}" lang="${lang}"><body style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
    <div style="background:#0a0a0a;color:#fff;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:600;">${t.title}</h1></div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">${t.greeting}</p>
      <p style="margin:0 0 24px;line-height:1.6;">${narrative}</p>
      ${table}
      <p style="margin:24px 0 0;color:#666;font-size:13px;">${t.footer}</p>
    </div>
  </div></body></html>`;
}

function parsePayload(payload: unknown): {
  recipients: string[];
  recipientName: string;
  language: "en" | "ar";
} {
  const p = (payload ?? {}) as Record<string, unknown>;

  const fromPayload = p.recipientEmail;
  const fromEnv = process.env.ORA_BRIEFING_RECIPIENT_EMAIL;
  const raw: string[] = Array.isArray(fromPayload)
    ? (fromPayload.filter((x) => typeof x === "string") as string[])
    : typeof fromPayload === "string"
      ? [fromPayload]
      : typeof fromEnv === "string" && fromEnv.length > 0
        ? fromEnv.split(",").map((s) => s.trim())
        : [];

  const recipients = raw.filter((s) => s.length > 0);
  if (recipients.length === 0) {
    throw new Error(
      "morning_briefing: no recipient — set payload.recipientEmail or ORA_BRIEFING_RECIPIENT_EMAIL"
    );
  }

  const recipientName =
    typeof p.recipientName === "string" && p.recipientName.trim().length > 0
      ? p.recipientName.trim()
      : "team";
  const language = p.language === "ar" ? "ar" : "en";

  return { recipients, recipientName, language };
}

/**
 * Build a {@link JobHandler} for `morning_briefing`, injecting the metrics
 * reader, narrator, and mailer (each defaults to its live implementation).
 * Tests pass fakes to run the full flow offline.
 */
export function createMorningBriefingHandler(
  deps: MorningBriefingDeps = {}
): JobHandler {
  const readMetrics = deps.readMetrics ?? defaultMetricsReader;
  const narrate = deps.narrate ?? defaultBriefingNarrator;
  const sendMail =
    deps.sendMail ??
    ((email: BriefingEmail) =>
      sendGraphMail({
        to: email.to,
        subject: email.subject,
        htmlContent: email.htmlContent,
      }));

  return async (db: Database, payload: unknown, _ctx: JobContext) => {
    const { recipients, recipientName, language } = parsePayload(payload);

    // 1) Deltas vs the prior period — figures computed entirely in SQL.
    const metrics = await readMetrics(db);

    // 2) Short narrative — the LLM only narrates the provided figures.
    const narrative = await narrate(metrics, { language });

    // 3) Render + deliver via Microsoft Graph mail.
    const htmlContent = buildMorningBriefingHtml({
      recipientName,
      narrative,
      metrics,
      language,
    });

    const subject =
      language === "ar" ? "ORA — إيجاز الصباح" : "ORA — Morning Briefing";

    const result = await sendMail({ to: recipients, subject, htmlContent });
    if (!result.success) {
      throw new Error(
        `morning_briefing: mail delivery failed: ${result.error ?? "unknown error"}`
      );
    }
  };
}

/** Default handler instance wired to the live reader, gateway, and Graph mail. */
export const morningBriefingHandler: JobHandler =
  createMorningBriefingHandler();
