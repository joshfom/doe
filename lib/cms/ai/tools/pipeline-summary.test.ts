import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Tests for the `get_pipeline_summary` tool (task 16.4).
 *
 * The tool reads the `metrics_*` SQL views (migration 0030) and returns their
 * figures verbatim — the LLM narrates, the tool NEVER computes arithmetic in JS
 * (Req 6.9, 10.1; design "P8" / Property 8). Two layers are exercised:
 *
 *   1. `planPipelineSummary` — pure scope/period → view-selection logic. Every
 *      generated request resolves to reads of allow-listed `metrics_*` views
 *      only, with the right scoping (exec-overall vs exec-week vs rep).
 *
 *   2. `executePipelinePlan` — runs a plan and assembles the `metrics` map.
 *      pg-mem cannot materialise SQL views or run PERCENTILE_CONT, so the views
 *      are stood up as plain stand-in TABLES with the same names/columns; this
 *      proves the generated SQL (allow-listed `SELECT *`, equality filters, the
 *      `::date` week cast, single-row vs multi-row shaping) is correct and that
 *      figures are returned VERBATIM with no JS rounding/transformation.
 *
 * **Validates: Requirements 6.9, 10.1**
 */

import type { Database } from "../../db";
import {
  planPipelineSummary,
  executePipelinePlan,
  toolRegistry,
  METRICS_VIEWS,
  type PipelineQueryPlan,
} from "./registry";

// Stand-in TABLES named like the metrics_* views (pg-mem can't run the views).
const STANDIN_SQL = `
  CREATE TABLE "metrics_tier_funnel_overall" (
    "hot" integer, "warm" integer, "nurture" integer, "qualified_total" integer
  );
  CREATE TABLE "metrics_tier_funnel" (
    "week" date, "hot" integer, "warm" integer, "nurture" integer, "qualified_total" integer
  );
  CREATE TABLE "metrics_speed_to_lead_overall" (
    "median_speed_to_lead_seconds" integer, "contacted_leads" integer
  );
  CREATE TABLE "metrics_speed_to_lead" (
    "week" date, "median_speed_to_lead_seconds" integer, "contacted_leads" integer
  );
  CREATE TABLE "metrics_cost_per_qualified_lead_overall" (
    "channel" text, "spend" integer, "qualified_leads" integer, "cost_per_qualified_lead" integer
  );
  CREATE TABLE "metrics_cost_per_qualified_lead" (
    "channel" text, "week" date, "spend" integer, "qualified_leads" integer, "cost_per_qualified_lead" integer
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

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(STANDIN_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring registry.test.ts.
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

  const db = drizzle(pool) as unknown as Database;
  return { mem, db };
}

// ── planPipelineSummary — pure scope/period → view selection ──────────────────

describe("planPipelineSummary — scope/period view selection (Req 6.9, 10.1)", () => {
  it("defaults to exec scope + overall period reading the *_overall views", () => {
    const plan = planPipelineSummary({});
    expect(plan.scope).toBe("exec");
    expect(plan.period).toBe("overall");
    const views = plan.sources.map((s) => s.view);
    expect(views).toContain("metrics_tier_funnel_overall");
    expect(views).toContain("metrics_speed_to_lead_overall");
    expect(views).toContain("metrics_cost_per_qualified_lead_overall");
    expect(views).toContain("metrics_week_over_week");
    expect(views).toContain("metrics_rep_load");
    // No weekly (period-scoped) views in the overall plan.
    expect(views).not.toContain("metrics_tier_funnel");
  });

  it("treats 'overall'/'all'/'' (any case) as the all-time exec scope", () => {
    for (const period of ["overall", "ALL", "All-Time", " "]) {
      const plan = planPipelineSummary({ period });
      expect(plan.period).toBe("overall");
      expect(plan.sources.map((s) => s.view)).toContain(
        "metrics_tier_funnel_overall"
      );
    }
  });

  it("reads the weekly views with a ::date week filter for a specific period", () => {
    const plan = planPipelineSummary({ scope: "exec", period: "2026-05-04" });
    expect(plan.period).toBe("2026-05-04");
    const tier = plan.sources.find((s) => s.key === "tierFunnel");
    expect(tier?.view).toBe("metrics_tier_funnel");
    expect(tier?.kind).toBe("row");
    expect(tier?.filters).toEqual([
      { column: "week", value: "2026-05-04", cast: "date" },
    ]);
    // Week-over-week is "latest vs prior" — never week-filtered.
    const wow = plan.sources.find((s) => s.key === "weekOverWeek");
    expect(wow?.filters).toEqual([]);
  });

  it("routes a non-ISO-date period to overall (never the throwing ::date filter)", () => {
    // A free-text period the model might emit ("this week") must NOT reach the
    // weekly `week = $1::date` filter — that cast throws on a healthy DB and
    // surfaces to the user as "unavailable". It falls back to the overall views.
    for (const period of ["this week", "last week", "June 2026", "2026-13-45"]) {
      const plan = planPipelineSummary({ scope: "exec", period });
      expect(plan.period).toBe("overall");
      const views = plan.sources.map((s) => s.view);
      expect(views).toContain("metrics_tier_funnel_overall");
      expect(views).not.toContain("metrics_tier_funnel");
      // No source carries a ::date cast filter.
      for (const src of plan.sources) {
        expect(src.filters.some((f) => f.cast === "date")).toBe(false);
      }
    }
  });

  it("infers rep scope from a repId and reads that rep's load row", () => {
    const plan = planPipelineSummary({ repId: "rep-123" });
    expect(plan.scope).toBe("rep");
    expect(plan.sources).toHaveLength(1);
    const [src] = plan.sources;
    expect(src.view).toBe("metrics_rep_load");
    expect(src.kind).toBe("row");
    expect(src.filters).toEqual([{ column: "rep_id", value: "rep-123" }]);
  });

  it("rep scope without a repId reads the whole rep-load board", () => {
    const plan = planPipelineSummary({ scope: "rep" });
    expect(plan.scope).toBe("rep");
    const [src] = plan.sources;
    expect(src.view).toBe("metrics_rep_load");
    expect(src.kind).toBe("rows");
    expect(src.filters).toEqual([]);
  });

  it("only ever reads allow-listed metrics_* views for arbitrary requests", () => {
    fc.assert(
      fc.property(
        fc.record({
          repId: fc.option(fc.string(), { nil: undefined }),
          scope: fc.option(fc.constantFrom("exec", "rep"), { nil: undefined }),
          period: fc.option(fc.string(), { nil: undefined }),
        }),
        (input) => {
          const plan = planPipelineSummary(
            input as Parameters<typeof planPipelineSummary>[0]
          );
          for (const src of plan.sources) {
            expect(METRICS_VIEWS).toContain(src.view);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── executePipelinePlan — verbatim figures from the views ─────────────────────

describe("executePipelinePlan — returns SQL figures verbatim (Req 10.1)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("assembles the exec/overall metrics map straight from the views", async () => {
    await db.execute(
      `INSERT INTO metrics_tier_funnel_overall VALUES (5, 12, 30, 47)` as never
    );
    await db.execute(
      `INSERT INTO metrics_speed_to_lead_overall VALUES (3600, 40)` as never
    );
    await db.execute(
      `INSERT INTO metrics_cost_per_qualified_lead_overall VALUES ('web_call', 1000, 20, 50)` as never
    );
    await db.execute(
      `INSERT INTO metrics_cost_per_qualified_lead_overall VALUES ('web_form', 500, 5, 100)` as never
    );

    const metrics = await executePipelinePlan(db, planPipelineSummary({}));

    // Single-row views resolve to a single object; figures are unchanged.
    expect(metrics.tierFunnel).toMatchObject({
      hot: 5,
      warm: 12,
      nurture: 30,
      qualified_total: 47,
    });
    expect(metrics.speedToLead).toMatchObject({
      median_speed_to_lead_seconds: 3600,
      contacted_leads: 40,
    });
    // Multi-row views resolve to an array of rows.
    expect(Array.isArray(metrics.costPerQualifiedLead)).toBe(true);
    expect(metrics.costPerQualifiedLead).toHaveLength(2);
    expect(metrics.weekOverWeek).toBeNull(); // empty stand-in → null row
  });

  it("applies the ::date week filter for a period-scoped exec request", async () => {
    await db.execute(
      `INSERT INTO metrics_tier_funnel VALUES ('2026-05-04', 2, 3, 4, 9)` as never
    );
    await db.execute(
      `INSERT INTO metrics_tier_funnel VALUES ('2026-05-11', 9, 9, 9, 27)` as never
    );

    const metrics = await executePipelinePlan(
      db,
      planPipelineSummary({ scope: "exec", period: "2026-05-04" })
    );

    expect(metrics.tierFunnel).toMatchObject({ qualified_total: 9, hot: 2 });
  });

  it("returns only the requested rep's load row for rep scope", async () => {
    await db.execute(
      `INSERT INTO metrics_rep_load VALUES ('rep-a', 'Aisha', 5, 2, 8, 2, 0)` as never
    );
    await db.execute(
      `INSERT INTO metrics_rep_load VALUES ('rep-b', 'Bob', 3, 3, 6, 3, 1)` as never
    );

    const metrics = await executePipelinePlan(
      db,
      planPipelineSummary({ repId: "rep-a" })
    );

    expect(metrics.repLoad).toMatchObject({ rep_id: "rep-a", name: "Aisha" });
  });

  it("end-to-end through the registry handler returns { scope, period, metrics }", async () => {
    await db.execute(
      `INSERT INTO metrics_tier_funnel_overall VALUES (1, 2, 3, 6)` as never
    );

    const result = await toolRegistry.get_pipeline_summary.handler(
      db,
      { actor: "agent:voice-lead" },
      {}
    );

    expect(result.scope).toBe("exec");
    expect(result.period).toBe("overall");
    expect(result.metrics.tierFunnel).toMatchObject({ qualified_total: 6 });
  });

  it("refuses to read a view outside the metrics_* allow-list", async () => {
    const evilPlan: PipelineQueryPlan = {
      scope: "exec",
      period: "overall",
      sources: [
        { key: "x", view: "parties" as never, kind: "rows", filters: [] },
      ],
    };
    await expect(executePipelinePlan(db, evilPlan)).rejects.toThrow(
      /non-metrics view/
    );
  });
});
