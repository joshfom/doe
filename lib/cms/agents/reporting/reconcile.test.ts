/**
 * Unit tests for the figure reconciliation ledger (S4 task 4.1).
 *
 * Verifies the three classifications — consistent / unavailable /
 * irreconcilable — plus the publish/withhold/suppress behaviour and the
 * no-arithmetic identity comparison. Requirements: 2.2, 2.3, 2.5, 2.6.
 */

import { describe, it, expect } from "vitest";
import { buildFigureLedger } from "./reconcile";

const SCOPE = "exec:all-time";

describe("buildFigureLedger — classification", () => {
  it("marks a metric consistent when every surface agrees", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: {
        chat: { "tierFunnel.hot": 42 },
        chart: { "tierFunnel.hot": 42 },
        export: { "tierFunnel.hot": 42 },
      },
    });

    const entry = ledger.entry("tierFunnel.hot");
    expect(entry).toEqual({
      metricId: "tierFunnel.hot",
      scopeId: SCOPE,
      value: 42,
      status: "consistent",
    });
    expect(ledger.publishedMetricIds()).toEqual(["tierFunnel.hot"]);
  });

  it("marks a requested metric unavailable when no surface has a value", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: {
        chat: { "speedToLead.median": null },
        chart: {},
        export: { "speedToLead.median": undefined },
      },
      requestedMetrics: ["speedToLead.median"],
    });

    const entry = ledger.entry("speedToLead.median");
    expect(entry?.status).toBe("unavailable");
    expect(entry?.value).toBeNull();
    // Withheld from publication everywhere (Req 2.5).
    expect(ledger.publishedMetricIds()).not.toContain("speedToLead.median");
  });

  it("marks a metric irreconcilable when values differ across surfaces", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: {
        chat: { "cost.cpl": 100 },
        chart: { "cost.cpl": 100 },
        export: { "cost.cpl": 101 },
      },
    });

    const entry = ledger.entry("cost.cpl");
    expect(entry?.status).toBe("irreconcilable");
    expect(entry?.value).toBeNull();
    // Suppressed on all surfaces (Req 2.6).
    expect(ledger.publishedMetricIds()).not.toContain("cost.cpl");
  });

  it("does not coerce types: number 1 and string '1' are irreconcilable", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: {
        chat: { m: 1 },
        export: { m: "1" },
      },
    });
    expect(ledger.entry("m")?.status).toBe("irreconcilable");
  });

  it("treats a metric present on a single surface as consistent (nothing to reconcile)", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: {
        chat: { "only.chat": 7 },
        chart: {},
        export: {},
      },
    });
    expect(ledger.entry("only.chat")?.status).toBe("consistent");
    expect(ledger.entry("only.chat")?.value).toBe(7);
  });
});

describe("FigureLedger — publish / suppress / withhold", () => {
  it("publishes only consistent figures, leaving them unchanged while removing the rest", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: {
        chat: { good: 5, bad: 9, missing: null },
        chart: { good: 5, bad: 8, missing: null },
        export: { good: 5, bad: 8, missing: null },
      },
      requestedMetrics: ["good", "bad", "missing"],
    });

    expect(ledger.entry("good")?.status).toBe("consistent");
    expect(ledger.entry("bad")?.status).toBe("irreconcilable");
    expect(ledger.entry("missing")?.status).toBe("unavailable");

    const published = ledger.publish({ good: 5, bad: 9, missing: null });
    expect(published).toEqual({ good: 5 });
    expect(ledger.reconciledFigures()).toEqual({ good: 5 });
  });

  it("publishes byte-identical consistent values across every surface", () => {
    const surfaces = {
      chat: { a: 3.14, b: "120s" },
      chart: { a: 3.14, b: "120s" },
      export: { a: 3.14, b: "120s" },
    };
    const ledger = buildFigureLedger({ scopeId: SCOPE, surfaces });

    const pubChat = ledger.publish(surfaces.chat);
    const pubChart = ledger.publish(surfaces.chart);
    const pubExport = ledger.publish(surfaces.export);
    expect(pubChat).toEqual(pubChart);
    expect(pubChart).toEqual(pubExport);
    expect(pubChat).toEqual({ a: 3.14, b: "120s" });
  });

  it("produces a deterministic, metric-id-sorted entry list", () => {
    const ledger = buildFigureLedger({
      scopeId: SCOPE,
      surfaces: { chat: { zeta: 1, alpha: 2, mid: 3 } },
    });
    expect(ledger.entries.map((e) => e.metricId)).toEqual(["alpha", "mid", "zeta"]);
  });
});
