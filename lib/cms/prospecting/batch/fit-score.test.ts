import { describe, it, expect } from "vitest";
import { scoreCandidateFit, type BatchSubject } from "./fit-score";
import type { ProspectFilter, ProviderResult } from "../providers";

/** Build a ProviderResult candidate with sensible defaults, overridable per test. */
function candidate(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    targetType: "person",
    displayName: "Arjun Mehta",
    companyName: "Meridian Capital Partners",
    title: "Founder & CEO",
    email: "a.mehta@meridiancap.example",
    country: "India",
    attributes: {
      title: { value: "Founder & CEO", source: "demo", asOf: "2024-01-01T00:00:00.000Z" },
      seniority: { value: "c_suite", source: "demo", asOf: "2024-01-01T00:00:00.000Z" },
      wealthSignal: { value: "post-liquidity founder", source: "demo", asOf: "2024-01-01T00:00:00.000Z" },
      industry: { value: "Investment Management", source: "demo", asOf: "2024-01-01T00:00:00.000Z" },
    },
    sourceProvider: "demo",
    sourceRef: "demo:a.mehta@meridiancap.example",
    lawfulBasis: "legitimate_interest",
    ...overrides,
  };
}

function icpSubject(filter: Partial<ProspectFilter>): BatchSubject {
  return { kind: "icp", icpFilter: { targetType: "person", ...filter } };
}

describe("scoreCandidateFit", () => {
  it("is deterministic: same input → same output", () => {
    const subject = icpSubject({
      titles: ["Founder"],
      geography: ["India"],
      wealthSignals: ["post-liquidity founder"],
    });
    const c = candidate();
    const a = scoreCandidateFit(subject, c);
    const b = scoreCandidateFit(subject, c);
    expect(a).toEqual(b);
  });

  it("returns a score within [0, 1]", () => {
    const subject = icpSubject({
      titles: ["Founder"],
      seniority: ["c_suite"],
      geography: ["India"],
      industries: ["Investment Management"],
    });
    const { score } = scoreCandidateFit(subject, candidate());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores a perfect signal match as 1", () => {
    const subject = icpSubject({
      titles: ["Founder"],
      seniority: ["c_suite"],
      geography: ["India"],
      wealthSignals: ["post-liquidity founder"],
      industries: ["Investment Management"],
    });
    const { score, rationale } = scoreCandidateFit(subject, candidate());
    expect(score).toBe(1);
    expect(rationale.signals.every((s) => s.similarity === 1)).toBe(true);
  });

  it("scores a total mismatch as 0 but still records the dimensions", () => {
    const subject = icpSubject({
      titles: ["Janitor"],
      geography: ["Antarctica"],
    });
    const { score, rationale } = scoreCandidateFit(subject, candidate());
    expect(score).toBe(0);
    expect(rationale.signals.length).toBeGreaterThan(0);
    expect(rationale.signals.map((s) => s.dimension)).toContain("titles");
  });

  it("always returns a non-empty rationale, even with no comparison signals", () => {
    const subject: BatchSubject = { kind: "cluster", clusterId: "c1" };
    const { score, rationale } = scoreCandidateFit(subject, candidate());
    expect(score).toBe(0);
    expect(rationale.signals.length).toBeGreaterThan(0);
    expect(rationale.summary).toMatch(/no comparison signals/i);
  });

  it("rationale enumerates matched signals together with their weights", () => {
    const subject = icpSubject({ titles: ["Founder"], geography: ["India"] });
    const { rationale } = scoreCandidateFit(subject, candidate());
    const titles = rationale.signals.find((s) => s.dimension === "titles");
    expect(titles).toBeDefined();
    expect(titles!.weight).toBeGreaterThan(0);
    expect(titles!.matched.length).toBeGreaterThan(0);
  });

  it("does not penalise unspecified dimensions (sparse subject)", () => {
    // Only geography specified and matched → score should be 1, not diluted.
    const subject = icpSubject({ geography: ["India"] });
    const { score, rationale } = scoreCandidateFit(subject, candidate());
    expect(score).toBe(1);
    expect(rationale.signals.map((s) => s.dimension)).toEqual(["geography"]);
  });

  it("folds in a market-alignment dimension via rankComparables reuse", () => {
    const now = new Date();
    const subject: BatchSubject = {
      kind: "cluster",
      clusterId: "c1",
      icpFilter: { targetType: "person", geography: ["India"] },
      marketContext: {
        brief: { spec: { area: "Palm Jumeirah", segment: "ultra_luxury" } },
        comparables: [
          {
            id: "p1",
            name: "Palm Jumeirah Residences",
            communityName: "Palm Jumeirah",
            segment: "ultra_luxury",
          } as never,
        ],
      },
    };
    const { rationale } = scoreCandidateFit(subject, candidate());
    expect(rationale.signals.map((s) => s.dimension)).toContain("market");
  });
});
