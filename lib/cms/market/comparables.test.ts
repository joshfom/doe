import { describe, it, expect } from "vitest";
import {
  rankComparables,
  type MarketProjectRow,
  type BriefSpecInput,
} from "./comparables";

/** Build a `market_projects` row with sensible defaults, overridable per test. */
function project(overrides: Partial<MarketProjectRow>): MarketProjectRow {
  const now = new Date();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    developerId: null,
    name: "Project",
    nameNormalized: "project",
    communityName: null,
    city: null,
    region: null,
    country: null,
    locationLat: null,
    locationLng: null,
    segment: null,
    status: null,
    launchDate: null,
    handoverDate: null,
    totalUnits: null,
    unitTypes: null,
    priceMin: null,
    priceMax: null,
    avgPricePerSqft: null,
    branded: false,
    brandName: null,
    source: "test",
    sourceRef: null,
    asOf: null,
    demo: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MarketProjectRow;
}

const fullBrief: BriefSpecInput = {
  area: "Palm Jumeirah",
  segment: "ultra_luxury",
  unitType: "villa",
  priceMinAed: 35_000_000,
  priceMaxAed: 45_000_000,
};

describe("rankComparables", () => {
  it("scores a perfect match at 1 with all reasons", () => {
    const p = project({
      id: "p-perfect",
      communityName: "Palm Jumeirah",
      segment: "ultra_luxury",
      unitTypes: ["villa", "penthouse"],
      priceMin: 35_000_000,
      priceMax: 45_000_000,
    });
    const [result] = rankComparables({ spec: fullBrief }, [p]);
    expect(result.marketProjectId).toBe("p-perfect");
    expect(result.score).toBe(1);
    expect(result.reasons).toEqual([
      "Same area (community: Palm Jumeirah)",
      "Same segment (ultra_luxury)",
      "Overlapping price band",
      "Offers unit type (villa)",
    ]);
  });

  it("ranks a closer project above a weaker one", () => {
    const strong = project({
      id: "strong",
      communityName: "Palm Jumeirah",
      segment: "ultra_luxury",
      unitTypes: ["villa"],
      priceMin: 35_000_000,
      priceMax: 45_000_000,
    });
    const weak = project({
      id: "weak",
      communityName: "Dubai Marina",
      segment: "mid",
      unitTypes: ["apartment"],
      priceMin: 1_000_000,
      priceMax: 2_000_000,
    });
    const ranked = rankComparables({ spec: fullBrief }, [weak, strong]);
    expect(ranked.map((r) => r.marketProjectId)).toEqual(["strong", "weak"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("is deterministic and breaks ties by ascending id", () => {
    // Two identical projects (same similarity) with different ids.
    const base = {
      communityName: "Palm Jumeirah",
      segment: "ultra_luxury" as const,
      unitTypes: ["villa"],
      priceMin: 35_000_000,
      priceMax: 45_000_000,
    };
    const b = project({ id: "id-b", ...base });
    const a = project({ id: "id-a", ...base });
    const ranked = rankComparables({ spec: fullBrief }, [b, a]);
    expect(ranked.map((r) => r.marketProjectId)).toEqual(["id-a", "id-b"]);

    // Running again with reversed input yields the identical order.
    const again = rankComparables({ spec: fullBrief }, [a, b]);
    expect(again).toEqual(ranked);
  });

  it("only weights the dimensions the brief specifies", () => {
    // Brief specifies segment only; an exact-segment project scores 1.
    const p = project({ id: "seg-only", segment: "luxury" });
    const [result] = rankComparables({ spec: { segment: "luxury" } }, [p]);
    expect(result.score).toBe(1);
    expect(result.reasons).toEqual(["Same segment (luxury)"]);
  });

  it("gives partial credit for adjacent segments", () => {
    const adjacent = project({ id: "adj", segment: "luxury" });
    const distant = project({ id: "far", segment: "mid" });
    const ranked = rankComparables({ spec: { segment: "ultra_luxury" } }, [
      distant,
      adjacent,
    ]);
    expect(ranked[0].marketProjectId).toBe("adj");
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("scores 0 (empty reasons) when the brief specifies nothing", () => {
    const p = project({ id: "x", segment: "luxury" });
    const [result] = rankComparables({ spec: {} }, [p]);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it("prefers resolvedSpec over spec when both present", () => {
    const p = project({ id: "p", segment: "mid" });
    const ranked = rankComparables(
      { spec: { segment: "ultra_luxury" }, resolvedSpec: { segment: "mid" } },
      [p]
    );
    expect(ranked[0].score).toBe(1);
  });

  it("rewards price-band overlap proportionally", () => {
    const overlap = project({
      id: "overlap",
      priceMin: 40_000_000,
      priceMax: 50_000_000,
    });
    const disjoint = project({
      id: "disjoint",
      priceMin: 1_000_000,
      priceMax: 2_000_000,
    });
    const ranked = rankComparables(
      { spec: { priceMinAed: 35_000_000, priceMaxAed: 45_000_000 } },
      [disjoint, overlap]
    );
    expect(ranked[0].marketProjectId).toBe("overlap");
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked.find((r) => r.marketProjectId === "disjoint")!.score).toBe(0);
  });

  it("returns an empty array for no projects", () => {
    expect(rankComparables({ spec: fullBrief }, [])).toEqual([]);
  });
});
