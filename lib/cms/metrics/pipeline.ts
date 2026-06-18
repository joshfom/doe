import { sql } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";

// ── Shared pipeline metrics query (Design §8.5, §11, §15) ─────────────────────
//
// SINGLE SOURCE of pipeline analytics for BOTH the voice `get_pipeline_summary`
// tool (task 16.4) and the emailed report `compile_and_email_report` (task
// 16.6). Both consumers call `queryPipelineMetrics` so that the figure spoken
// aloud EQUALS the figure printed in the PDF for a given `{ scope, period }`
// (Property 8 / Requirements 10.1, 10.2). All arithmetic lives in the
// `metrics_*` SQL views (drizzle/0030_metrics_views.sql) — the LLM only
// narrates, it never computes.

/** Scope of a pipeline-summary request. */
export interface PipelineMetricsScope {
  /** "exec" (org-wide) or "rep" (single rep). Defaults to "exec". */
  scope?: string;
  /** Human/period label echoed back to callers (e.g. "all-time", "this-week"). */
  period?: string;
  /** Rep id, required when `scope === "rep"`. */
  repId?: string;
}

/**
 * Pre-computed pipeline figures, keyed by metric name. Every value is taken
 * verbatim from a `metrics_*` view row, so the same call always yields the same
 * numbers regardless of which surface (voice or email) requested them.
 */
export interface PipelineMetrics {
  scope: string;
  period: string;
  metrics: {
    costPerQualifiedLead: Array<Record<string, unknown>>;
    tierFunnel: Record<string, unknown> | null;
    speedToLead: Record<string, unknown> | null;
    repLoad: Array<Record<string, unknown>>;
    weekOverWeek: Record<string, unknown> | null;
  };
}

type Row = Record<string, unknown>;

function rowsOf(result: { rows: unknown[] }): Row[] {
  return (result.rows as Row[]) ?? [];
}

/**
 * Read the pipeline metrics for a given scope/period from the `metrics_*` views.
 *
 * The figures are identical across callers for the same `{ scope, period }`
 * because they are read — never recomputed — from the shared SQL views. For a
 * rep scope the rep-load slice is filtered to `repId`; the funnel, cost, speed,
 * and week-over-week figures remain org-wide (the rep narrative compares the rep
 * against the org).
 */
export async function queryPipelineMetrics(
  db: Database,
  input: PipelineMetricsScope = {}
): Promise<PipelineMetrics> {
  const scope = input.scope ?? "exec";
  const period = input.period ?? "all-time";

  const [cost, tier, speed, repLoad, wow] = await Promise.all([
    db.execute(
      sql`SELECT channel, spend, qualified_leads AS "qualifiedLeads", cost_per_qualified_lead AS "costPerQualifiedLead" FROM metrics_cost_per_qualified_lead_overall ORDER BY channel`
    ),
    db.execute(
      sql`SELECT hot, warm, nurture, qualified_total AS "qualifiedTotal" FROM metrics_tier_funnel_overall`
    ),
    db.execute(
      sql`SELECT median_speed_to_lead_seconds AS "medianSpeedToLeadSeconds", contacted_leads AS "contactedLeads" FROM metrics_speed_to_lead_overall`
    ),
    input.scope === "rep" && input.repId
      ? db.execute(
          sql`SELECT rep_id AS "repId", name, capacity, open_hot_count AS "openHotCount", assigned_leads AS "assignedLeads", assigned_hot AS "assignedHot", utilization FROM metrics_rep_load WHERE rep_id = ${input.repId} ORDER BY name`
        )
      : db.execute(
          sql`SELECT rep_id AS "repId", name, capacity, open_hot_count AS "openHotCount", assigned_leads AS "assignedLeads", assigned_hot AS "assignedHot", utilization FROM metrics_rep_load ORDER BY name`
        ),
    db.execute(
      sql`SELECT * FROM metrics_week_over_week`
    ),
  ]);

  return {
    scope,
    period,
    metrics: {
      costPerQualifiedLead: rowsOf(cost),
      tierFunnel: rowsOf(tier)[0] ?? null,
      speedToLead: rowsOf(speed)[0] ?? null,
      repLoad: rowsOf(repLoad),
      weekOverWeek: rowsOf(wow)[0] ?? null,
    },
  };
}
