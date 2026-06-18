// lib/cms/tickets/crm/salesforce-analytics.test.ts
import { describe, it, expect } from "vitest";

import {
  buildCountByPeriodSoql,
  buildOpportunityAggregateSoql,
  buildWonOpportunitySoql,
  buildPipelineByStageSoql,
  getCrmBrainstormSnapshot,
  COMPARISON_PAIRS,
  type AggregateRunner,
  type AggregateRow,
} from "./salesforce-analytics";

describe("SOQL builders — injection-safe, use date literals", () => {
  it("count-by-period uses the mapped date literal, not interpolated text", () => {
    expect(buildCountByPeriodSoql("Lead", "this-week")).toBe(
      "SELECT COUNT(Id) cnt FROM Lead WHERE CreatedDate = THIS_WEEK",
    );
    expect(buildCountByPeriodSoql("Contact", "last-quarter")).toBe(
      "SELECT COUNT(Id) cnt FROM Contact WHERE CreatedDate = LAST_QUARTER",
    );
  });

  it("opportunity aggregate selects count + amount", () => {
    expect(buildOpportunityAggregateSoql("this-quarter")).toBe(
      "SELECT COUNT(Id) cnt, SUM(Amount) amt FROM Opportunity WHERE CreatedDate = THIS_QUARTER",
    );
  });

  it("won-opportunity query filters IsWon by close date", () => {
    expect(buildWonOpportunitySoql("last-quarter")).toBe(
      "SELECT COUNT(Id) cnt, SUM(Amount) amt FROM Opportunity WHERE IsWon = true AND CloseDate = LAST_QUARTER",
    );
  });

  it("pipeline-by-stage groups open opportunities by stage", () => {
    expect(buildPipelineByStageSoql()).toBe(
      "SELECT StageName stage, COUNT(Id) cnt, SUM(Amount) amt FROM Opportunity WHERE IsClosed = false GROUP BY StageName",
    );
  });

  it("never interpolates free text — only fixed object names + date literals", () => {
    for (const period of ["this-week", "last-week", "this-quarter"] as const) {
      const soql = buildCountByPeriodSoql("Lead", period);
      expect(soql).not.toMatch(/['"]/); // no quoted string literals at all
    }
  });
});

// A fake runner that maps SOQL → canned aggregate rows by matching substrings.
function fakeRunner(map: Array<{ match: string; rows: AggregateRow[] }>): AggregateRunner {
  return {
    async runAggregate(soql: string) {
      const hit = map.find((m) => soql.includes(m.match));
      return hit ? hit.rows : [];
    },
  };
}

describe("getCrmBrainstormSnapshot", () => {
  it("assembles quarter-over-quarter comparisons with correct deltas", async () => {
    const runner = fakeRunner([
      { match: "FROM Lead WHERE CreatedDate = THIS_QUARTER", rows: [{ cnt: 120 }] },
      { match: "FROM Lead WHERE CreatedDate = LAST_QUARTER", rows: [{ cnt: 100 }] },
      { match: "SUM(Amount) amt FROM Opportunity WHERE CreatedDate = THIS_QUARTER", rows: [{ cnt: 30, amt: 9_000_000 }] },
      { match: "SUM(Amount) amt FROM Opportunity WHERE CreatedDate = LAST_QUARTER", rows: [{ cnt: 24, amt: 6_000_000 }] },
      { match: "IsWon = true AND CloseDate = THIS_QUARTER", rows: [{ cnt: 8, amt: 4_000_000 }] },
      { match: "IsWon = true AND CloseDate = LAST_QUARTER", rows: [{ cnt: 5, amt: 2_500_000 }] },
      { match: "GROUP BY StageName", rows: [
        { stage: "Qualification", cnt: 12, amt: 3_000_000 },
        { stage: "Negotiation", cnt: 5, amt: 5_000_000 },
      ] },
    ]);

    const snap = await getCrmBrainstormSnapshot(runner, { granularity: "quarter" });

    expect(snap.granularity).toBe("quarter");
    const leads = snap.comparisons.find((c) => c.metric === "leads_created")!;
    expect(leads.current.count).toBe(120);
    expect(leads.previous.count).toBe(100);
    expect(leads.deltaPct).toBe(20); // (120-100)/100 = +20%

    const opps = snap.comparisons.find((c) => c.metric === "opportunities_created")!;
    expect(opps.current.amount).toBe(9_000_000);
    expect(opps.deltaPct).toBe(25); // (30-24)/24 = +25%

    expect(snap.pipelineByStage).toHaveLength(2);
    expect(snap.openPipelineAmount).toBe(8_000_000);
  });

  it("returns null delta when previous period is zero", async () => {
    const runner = fakeRunner([
      { match: "FROM Lead WHERE CreatedDate = THIS_WEEK", rows: [{ cnt: 10 }] },
      { match: "FROM Lead WHERE CreatedDate = LAST_WEEK", rows: [{ cnt: 0 }] },
    ]);
    const snap = await getCrmBrainstormSnapshot(runner, {
      granularity: "week",
      includePipeline: false,
    });
    const leads = snap.comparisons.find((c) => c.metric === "leads_created")!;
    expect(leads.deltaPct).toBeNull();
  });

  it("coerces null/missing aggregate values to 0", async () => {
    const runner = fakeRunner([
      { match: "FROM Lead WHERE CreatedDate = THIS_QUARTER", rows: [{ cnt: null }] },
      { match: "FROM Lead WHERE CreatedDate = LAST_QUARTER", rows: [] },
      { match: "FROM Opportunity WHERE CreatedDate = THIS_QUARTER", rows: [{ cnt: 0, amt: null }] },
    ]);
    const snap = await getCrmBrainstormSnapshot(runner, {
      granularity: "quarter",
      includePipeline: false,
    });
    const opps = snap.comparisons.find((c) => c.metric === "opportunities_created")!;
    expect(opps.current.amount).toBe(0);
    expect(opps.current.count).toBe(0);
  });

  it("skips the pipeline query when includePipeline is false", async () => {
    let pipelineQueried = false;
    const runner: AggregateRunner = {
      async runAggregate(soql) {
        if (soql.includes("GROUP BY StageName")) pipelineQueried = true;
        return [{ cnt: 1, amt: 1 }];
      },
    };
    await getCrmBrainstormSnapshot(runner, { granularity: "month", includePipeline: false });
    expect(pipelineQueried).toBe(false);
  });

  it("default comparison pairs are current/previous aligned", () => {
    expect(COMPARISON_PAIRS.quarter).toEqual({
      current: "this-quarter",
      previous: "last-quarter",
    });
  });
});
