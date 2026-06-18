/**
 * Unit tests for figure attribution + source-membership checks (S4 task 7.1).
 *
 * Verifies that every presented figure is tagged with `{ metricId, scopeId }`
 * (Req 2.4) and that source membership accepts only figures actually returned
 * through the dispatcher, rejecting fabricated values (Req 1.3, 16.2).
 */

import { describe, it, expect } from "vitest";
import {
  scopeId,
  attributeFigure,
  attributeFigures,
  findUnattributed,
  collectSourcedFigures,
  isSourced,
  findUnsourced,
  verifyNoFabrication,
  type AttributedFigure,
} from "./attribution";
import type { ReportScope } from "./scope";

const EXEC: ReportScope = { scope: "exec", period: "all-time" };
const REP: ReportScope = { scope: "rep", period: "this-week", repId: "rep_7" };

describe("scopeId", () => {
  it("derives an exec scope id from scope + period", () => {
    expect(scopeId(EXEC)).toBe("exec:all-time");
  });

  it("derives a rep scope id including the repId", () => {
    expect(scopeId(REP)).toBe("rep:this-week:rep_7");
  });

  it("falls back to scope:period for a rep scope missing its repId", () => {
    expect(scopeId({ scope: "rep", period: "all-time" })).toBe("rep:all-time");
  });
});

describe("attributeFigure", () => {
  it("attaches metricId + scopeId to a present figure", () => {
    expect(attributeFigure("tierFunnel.hot", 42, EXEC)).toEqual({
      metricId: "tierFunnel.hot",
      scopeId: "exec:all-time",
      value: 42,
    });
  });

  it("accepts a pre-derived scope id string", () => {
    expect(attributeFigure("cost.cpl", "120s", "exec:all-time")).toEqual({
      metricId: "cost.cpl",
      scopeId: "exec:all-time",
      value: "120s",
    });
  });

  it("returns null for an absent figure (nothing to attribute)", () => {
    expect(attributeFigure("missing", null, EXEC)).toBeNull();
    expect(attributeFigure("missing", undefined, EXEC)).toBeNull();
  });
});

describe("attributeFigures", () => {
  it("attributes every present figure and omits absent ones, sorted by metricId", () => {
    const out = attributeFigures(
      { zeta: 1, alpha: 2, gone: null, also_gone: undefined },
      REP,
    );
    expect(out).toEqual([
      { metricId: "alpha", scopeId: "rep:this-week:rep_7", value: 2 },
      { metricId: "zeta", scopeId: "rep:this-week:rep_7", value: 1 },
    ]);
  });

  it("every presented figure carries a non-empty metricId and scopeId (Property 4)", () => {
    const out = attributeFigures({ a: 5, b: "3.14" }, EXEC);
    expect(findUnattributed(out)).toEqual([]);
    for (const f of out) {
      expect(f.metricId.length).toBeGreaterThan(0);
      expect(f.scopeId.length).toBeGreaterThan(0);
    }
  });
});

describe("findUnattributed", () => {
  it("flags figures missing a metricId or scopeId", () => {
    const figures: AttributedFigure[] = [
      { metricId: "ok", scopeId: "exec:all-time", value: 1 },
      { metricId: "", scopeId: "exec:all-time", value: 2 },
      { metricId: "x", scopeId: "", value: 3 },
    ];
    expect(findUnattributed(figures).map((f) => f.value)).toEqual([2, 3]);
  });
});

describe("collectSourcedFigures + isSourced", () => {
  it("accepts a figure returned by the pipeline, rejects one that was not", () => {
    const sourced = collectSourcedFigures({ "tierFunnel.hot": 42, "cost.cpl": "120s" });
    expect(isSourced(42, sourced)).toBe(true);
    expect(isSourced("120s", sourced)).toBe(true);
    expect(isSourced(99, sourced)).toBe(false); // fabricated
  });

  it("matches a stated text figure against the numeric SQL value verbatim", () => {
    const sourced = collectSourcedFigures({ m: 42 });
    expect(isSourced("42", sourced)).toBe(true); // verbatim string form
    expect(isSourced("42.0", sourced)).toBe(false); // not verbatim — no coercion
  });

  it("treats an absent figure as not sourced", () => {
    const sourced = collectSourcedFigures({ m: 1 });
    expect(isSourced(null, sourced)).toBe(false);
    expect(isSourced(undefined, sourced)).toBe(false);
  });

  it("collects across multiple dispatched maps (metrics + records), ignoring nullish", () => {
    const sourced = collectSourcedFigures(
      { "tierFunnel.hot": 42 },
      { "record.lastInteraction": "2024-01-01" },
      undefined,
      null,
    );
    expect(isSourced(42, sourced)).toBe(true);
    expect(isSourced("2024-01-01", sourced)).toBe(true);
  });
});

describe("findUnsourced / verifyNoFabrication", () => {
  it("returns no unsourced figures when every value is backed by the dispatcher", () => {
    const sourced = collectSourcedFigures({ a: 1, b: "2", c: 3.5 });
    expect(findUnsourced([1, "2", 3.5], sourced)).toEqual([]);
    expect(verifyNoFabrication([1, "2", 3.5], sourced)).toEqual({ ok: true });
  });

  it("flags fabricated figures absent from the dispatched results", () => {
    const sourced = collectSourcedFigures({ a: 1, b: 2 });
    expect(findUnsourced([1, 2, 999], sourced)).toEqual([999]);
    expect(verifyNoFabrication([1, 2, 999], sourced)).toEqual({
      ok: false,
      unsourced: [999],
    });
  });

  it("works over AttributedFigure inputs", () => {
    const sourced = collectSourcedFigures({ a: 10, b: 20 });
    const figures = attributeFigures({ a: 10, fabricated: 77 }, EXEC);
    const unsourced = findUnsourced(figures, sourced) as AttributedFigure[];
    expect(unsourced.map((f) => f.value)).toEqual([77]);
    expect(verifyNoFabrication(figures, sourced)).toEqual({
      ok: false,
      unsourced: [77],
    });
  });
});
