// lib/cms/tickets/crm/salesforce-analytics.ts
//
// Read-only Salesforce ANALYTICS — the live aggregate-SOQL layer behind the
// C-level twin's "brainstorm on the CRM" flow (compare leads this week vs last
// week, opportunities this quarter vs last, pipeline by stage, win rate).
//
// SAFETY — no model-authored SOQL. The agent NEVER supplies a SOQL string. It
// chooses a whitelisted period token ("this-week" / "this-quarter" / …) and an
// object from a fixed enum; this module builds the SOQL from those tokens using
// Salesforce DATE LITERALS (THIS_WEEK, LAST_QUARTER, …), so there is no string
// interpolation of user/model input into the query and therefore no SOQL
// injection surface. Aggregates are computed BY SALESFORCE (COUNT/SUM/GROUP BY)
// — the agent only narrates the returned figures, mirroring the platform rule
// "figures come from the datastore, the agent narrates".
//
// The transport (OAuth, token caching, 401 re-auth, retry classification) is the
// existing {@link SalesforceAdapter}; this module only issues GET …/query?q=…
// reads through it. The aggregate runner is injectable so the query builders and
// the snapshot assembly are unit-testable without a live org.

import { SalesforceAdapter, withRetry } from "./salesforce";
import { SF_OBJECT_CONFIG, type SfObjectName } from "./sf-config";

const API_VERSION = process.env.SF_API_VERSION ?? "v59.0";

// ── Period tokens → Salesforce date literals (the ONLY query parameter) ───────

/** The whitelisted period tokens the agent may request. */
export const CRM_PERIODS = [
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "this-quarter",
  "last-quarter",
] as const;

export type CrmPeriod = (typeof CRM_PERIODS)[number];

/**
 * Map a period token to its Salesforce date literal. Because the value is drawn
 * from this fixed table (never from free text), the resulting SOQL contains no
 * interpolated model input.
 */
const PERIOD_LITERAL: Record<CrmPeriod, string> = {
  "this-week": "THIS_WEEK",
  "last-week": "LAST_WEEK",
  "this-month": "THIS_MONTH",
  "last-month": "LAST_MONTH",
  "this-quarter": "THIS_QUARTER",
  "last-quarter": "LAST_QUARTER",
};

/** A human label for a period token, for narration. */
export const PERIOD_LABEL: Record<CrmPeriod, string> = {
  "this-week": "this week",
  "last-week": "last week",
  "this-month": "this month",
  "last-month": "last month",
  "this-quarter": "this quarter",
  "last-quarter": "last quarter",
};

/** The default current/previous pairing for each comparison granularity. */
export const COMPARISON_PAIRS = {
  week: { current: "this-week", previous: "last-week" },
  month: { current: "this-month", previous: "last-month" },
  quarter: { current: "this-quarter", previous: "last-quarter" },
} as const satisfies Record<string, { current: CrmPeriod; previous: CrmPeriod }>;

export type CrmComparisonGranularity = keyof typeof COMPARISON_PAIRS;

// ── Aggregate runner (injectable transport seam) ──────────────────────────────

/** One row of a Salesforce aggregate query result (aliased columns). */
export type AggregateRow = Record<string, unknown>;

/** Runs an aggregate SOQL query and returns its rows. Injected for testing. */
export interface AggregateRunner {
  runAggregate(soql: string): Promise<AggregateRow[]>;
}

/** The Salesforce aggregate-query REST response shape. */
interface SoqlQueryResponse {
  totalSize: number;
  done: boolean;
  records: AggregateRow[];
}

/**
 * The production {@link AggregateRunner}: issues `GET …/query?q=<encoded SOQL>`
 * through the shared {@link SalesforceAdapter} transport, wrapped in the bounded
 * retry the rest of the CRM layer uses.
 */
export class SalesforceAnalyticsClient implements AggregateRunner {
  constructor(private readonly adapter: SalesforceAdapter) {}

  async runAggregate(soql: string): Promise<AggregateRow[]> {
    const path = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
    const res = await withRetry(() =>
      this.adapter.requestJson<SoqlQueryResponse>("GET", path),
    );
    return res.records ?? [];
  }
}

// ── Safe number coercion ──────────────────────────────────────────────────────

/** Coerce a Salesforce aggregate value to a finite number (null/undefined → 0). */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The configured sObject API name for a DOE object (absorbs sandbox/prod). */
function sobject(name: SfObjectName): string {
  return SF_OBJECT_CONFIG[name].sobject;
}

// ── Curated aggregate queries (built from whitelisted tokens only) ────────────

/**
 * Count records of an object created within a period. Standard `CreatedDate` is
 * used with a date literal, so the only "input" is the whitelisted period token.
 */
export function buildCountByPeriodSoql(
  object: SfObjectName,
  period: CrmPeriod,
): string {
  return `SELECT COUNT(Id) cnt FROM ${sobject(object)} WHERE CreatedDate = ${PERIOD_LITERAL[period]}`;
}

/**
 * Opportunity aggregate within a period: count and total amount of
 * opportunities created in the period.
 */
export function buildOpportunityAggregateSoql(period: CrmPeriod): string {
  const opp = sobject("Opportunity");
  return (
    `SELECT COUNT(Id) cnt, SUM(Amount) amt ` +
    `FROM ${opp} WHERE CreatedDate = ${PERIOD_LITERAL[period]}`
  );
}

/** Won-opportunity aggregate by close date within a period (count + amount). */
export function buildWonOpportunitySoql(period: CrmPeriod): string {
  const opp = sobject("Opportunity");
  return (
    `SELECT COUNT(Id) cnt, SUM(Amount) amt ` +
    `FROM ${opp} WHERE IsWon = true AND CloseDate = ${PERIOD_LITERAL[period]}`
  );
}

/** Open-pipeline aggregate grouped by stage (count + amount per stage). */
export function buildPipelineByStageSoql(): string {
  const opp = sobject("Opportunity");
  return (
    `SELECT StageName stage, COUNT(Id) cnt, SUM(Amount) amt ` +
    `FROM ${opp} WHERE IsClosed = false GROUP BY StageName`
  );
}

// ── High-level snapshot the agent narrates ────────────────────────────────────

/** A current-vs-previous comparison of a single metric. */
export interface PeriodComparison {
  metric: string;
  object: SfObjectName;
  current: { period: CrmPeriod; label: string; count: number; amount?: number };
  previous: { period: CrmPeriod; label: string; count: number; amount?: number };
  /** Percentage change in count, current vs previous; null when previous is 0. */
  deltaPct: number | null;
}

/** One stage of the open pipeline. */
export interface PipelineStage {
  stage: string;
  count: number;
  amount: number;
}

/** The assembled brainstorm snapshot returned to the agent. */
export interface CrmBrainstormSnapshot {
  granularity: CrmComparisonGranularity;
  comparisons: PeriodComparison[];
  pipelineByStage: PipelineStage[];
  /** Total open pipeline amount across all stages. */
  openPipelineAmount: number;
}

/** Compute a percentage delta (current vs previous), null when previous is 0. */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Read a single-row aggregate's count alias (`cnt`). */
async function countFor(
  runner: AggregateRunner,
  soql: string,
): Promise<{ count: number; amount: number }> {
  const rows = await runner.runAggregate(soql);
  const row = rows[0] ?? {};
  return { count: num(row.cnt), amount: num(row.amt) };
}

/**
 * Assemble a CRM brainstorm snapshot for the requested granularity (week / month
 * / quarter): leads created, opportunities created (count + amount), and won
 * opportunities (count + amount) for the current vs previous period, plus the
 * open pipeline broken down by stage. Every figure is computed by Salesforce.
 *
 * The runner is injected; pass a {@link SalesforceAnalyticsClient} in production
 * or a fake in tests.
 */
export async function getCrmBrainstormSnapshot(
  runner: AggregateRunner,
  opts: { granularity?: CrmComparisonGranularity; includePipeline?: boolean } = {},
): Promise<CrmBrainstormSnapshot> {
  const granularity = opts.granularity ?? "quarter";
  const pair = COMPARISON_PAIRS[granularity];

  // Leads created (count only).
  const leadsCur = await countFor(
    runner,
    buildCountByPeriodSoql("Lead", pair.current),
  );
  const leadsPrev = await countFor(
    runner,
    buildCountByPeriodSoql("Lead", pair.previous),
  );

  // Opportunities created (count + amount).
  const oppCur = await countFor(
    runner,
    buildOpportunityAggregateSoql(pair.current),
  );
  const oppPrev = await countFor(
    runner,
    buildOpportunityAggregateSoql(pair.previous),
  );

  // Won opportunities (count + amount by close date).
  const wonCur = await countFor(runner, buildWonOpportunitySoql(pair.current));
  const wonPrev = await countFor(runner, buildWonOpportunitySoql(pair.previous));

  const comparisons: PeriodComparison[] = [
    {
      metric: "leads_created",
      object: "Lead",
      current: { period: pair.current, label: PERIOD_LABEL[pair.current], count: leadsCur.count },
      previous: { period: pair.previous, label: PERIOD_LABEL[pair.previous], count: leadsPrev.count },
      deltaPct: deltaPct(leadsCur.count, leadsPrev.count),
    },
    {
      metric: "opportunities_created",
      object: "Opportunity",
      current: { period: pair.current, label: PERIOD_LABEL[pair.current], count: oppCur.count, amount: oppCur.amount },
      previous: { period: pair.previous, label: PERIOD_LABEL[pair.previous], count: oppPrev.count, amount: oppPrev.amount },
      deltaPct: deltaPct(oppCur.count, oppPrev.count),
    },
    {
      metric: "opportunities_won",
      object: "Opportunity",
      current: { period: pair.current, label: PERIOD_LABEL[pair.current], count: wonCur.count, amount: wonCur.amount },
      previous: { period: pair.previous, label: PERIOD_LABEL[pair.previous], count: wonPrev.count, amount: wonPrev.amount },
      deltaPct: deltaPct(wonCur.count, wonPrev.count),
    },
  ];

  let pipelineByStage: PipelineStage[] = [];
  let openPipelineAmount = 0;
  if (opts.includePipeline ?? true) {
    const rows = await runner.runAggregate(buildPipelineByStageSoql());
    pipelineByStage = rows.map((r) => ({
      stage: String(r.stage ?? "Unknown"),
      count: num(r.cnt),
      amount: num(r.amt),
    }));
    openPipelineAmount = pipelineByStage.reduce((sum, s) => sum + s.amount, 0);
  }

  return { granularity, comparisons, pipelineByStage, openPipelineAmount };
}
