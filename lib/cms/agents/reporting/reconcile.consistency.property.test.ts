import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildFigureLedger, type SurfaceFigures } from "./reconcile";

// Feature: agentic-reporting-twin, Property 1: For any `PipelineMetrics` result for one Report_Scope, the figure presented for each metric in the chat narration, in the Chart_Spec/Chart_Artifact, and in the Report_Export is identical — same numeric value, rounding, decimal precision, and displayed unit — because all three are derived from that single result; and for any metric absent from the result, that figure is withheld and marked unavailable on all three surfaces rather than substituted.

/**
 * **Property 1: Figure consistency across chat, chart, and export.**
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 6.2**
 *
 * The design's backbone for figure consistency is "one `PipelineMetrics`
 * result per Report_Scope, shared by reference across the three surfaces"
 * (chat narration, Chart_Spec/Chart_Artifact, Report_Export). This test models
 * that single-source derivation directly: from one generated `PipelineMetrics`
 * result we build the three per-surface figure maps the way the agent does —
 * every surface reads the SAME value for every metric the source provides — and
 * we leave any metric absent from the source absent from every surface.
 *
 * `buildFigureLedger` is the defence-in-depth reconciliation guard over those
 * surface maps. Because the three surfaces derive from one source, the property
 * we pin down is:
 *
 *   (a) Every metric the `PipelineMetrics` result provides is classified
 *       `consistent`, and the figure published is byte-for-byte identical to
 *       the source value across chat, chart, and export — same numeric value,
 *       rounding, precision, and displayed unit (Req 2.1, 2.2, 6.2).
 *   (b) Every metric requested but absent from the result is classified
 *       `unavailable`, withheld from all three surfaces, and never substituted
 *       with any other value (Req 2.5).
 *   (c) Reconciling the same inputs again yields an identical ledger — the same
 *       classifications, the same reconciled figures, the same published
 *       projections — so a repeated request with no underlying change returns
 *       identical figures (Req 2.3).
 *
 * The comparisons use `toStrictEqual`/`Object.is` semantics so a difference in
 * type (number `1` vs string `"1"`), precision (`3.1` vs `3.10`'s numeric form),
 * or unit-bearing string (`"120s"` vs `"120"`) would be caught as a mismatch.
 */

const SCOPE = "exec:all-time";

// A metric figure is a SQL-sourced number or a pre-formatted, unit-bearing
// string read verbatim from a `metrics_*` view — never NaN/Infinity (those are
// not real figures). Mixing integers, decimals, and unit strings exercises the
// "same value, rounding, precision, and displayed unit" guarantee.
const figureArb: fc.Arbitrary<number | string> = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  // Pre-formatted, unit-bearing figures (e.g. "120s", "3.14%", "$1,200").
  fc.string({ minLength: 1, maxLength: 8 }),
);

// Metric identifiers look like `tierFunnel.hot`. A small key space guarantees
// collisions between the "present" and "requested-but-absent" sets get filtered.
const metricIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("tierFunnel", "cost", "speedToLead", "repLoad", "wow"),
    fc.constantFrom("hot", "warm", "median", "cpl", "count", "delta", "p95"),
  )
  .map(([a, b]) => `${a}.${b}`);

// One `PipelineMetrics` result: a map of metric id → figure value.
const sourceArb: fc.Arbitrary<Record<string, number | string>> = fc.dictionary(
  metricIdArb,
  figureArb,
  { maxKeys: 7, noNullPrototype: true },
);

// Metrics that were requested for the scope but are entirely absent from the
// result (the Metrics_Pipeline returned nothing for them).
const absentArb: fc.Arbitrary<string[]> = fc.array(metricIdArb, { maxLength: 5 });

describe("buildFigureLedger — figure consistency across surfaces (Property 1)", () => {
  it("publishes byte-identical source figures on every surface and withholds absent ones", () => {
    fc.assert(
      fc.property(sourceArb, absentArb, (sourceRaw, absentRaw) => {
        // Normalize to a plain-prototype object so byte-identity comparisons
        // are about values, not the generator's object prototype.
        const source: Record<string, number | string> = { ...sourceRaw };
        const sourceKeys = Object.keys(source);
        // Requested-but-absent metrics must genuinely not be in the source.
        const absent = [...new Set(absentRaw)].filter((m) => !(m in source));

        // Derive the three surfaces from the ONE source, exactly as the agent
        // does: every surface reads the identical value for each source metric;
        // absent metrics appear on no surface.
        const chat: SurfaceFigures = { ...source };
        const chart: SurfaceFigures = { ...source };
        const exportSurface: SurfaceFigures = { ...source };

        const ledger = buildFigureLedger({
          scopeId: SCOPE,
          surfaces: { chat, chart, export: exportSurface },
          requestedMetrics: [...sourceKeys, ...absent],
        });

        // (a) Every source metric is consistent and reconciled to its exact
        //     source value (Req 2.1, 2.2).
        for (const metricId of sourceKeys) {
          const entry = ledger.entry(metricId);
          expect(entry).toBeDefined();
          expect(entry?.status).toBe("consistent");
          expect(entry?.scopeId).toBe(SCOPE);
          // Byte-for-byte identity with the single source value.
          expect(Object.is(entry?.value, source[metricId])).toBe(true);
        }

        // (b) Every requested-but-absent metric is unavailable, withheld, and
        //     never substituted (Req 2.5).
        for (const metricId of absent) {
          const entry = ledger.entry(metricId);
          expect(entry?.status).toBe("unavailable");
          expect(entry?.value).toBeNull();
          expect(ledger.publishedMetricIds()).not.toContain(metricId);
        }

        // The set of published metrics is exactly the source metrics.
        expect([...ledger.publishedMetricIds()].sort()).toStrictEqual(
          [...sourceKeys].sort(),
        );

        // The figure published on each surface is byte-for-byte identical
        // across chat, chart, and export, and equals the source figures
        // (Req 2.2, 6.2). Withheld metrics appear on none.
        const pubChat = ledger.publish(chat);
        const pubChart = ledger.publish(chart);
        const pubExport = ledger.publish(exportSurface);
        expect(pubChat).toStrictEqual(pubChart);
        expect(pubChart).toStrictEqual(pubExport);
        expect(pubChat).toStrictEqual(source);
        for (const metricId of absent) {
          expect(metricId in pubChat).toBe(false);
        }

        // The canonical reconciled figures equal the source exactly — no
        // figure invented, dropped, rounded, or reunit-ed.
        expect(ledger.reconciledFigures()).toStrictEqual(source);
      }),
      { numRuns: 200 },
    );
  });

  it("returns an identical ledger when the same inputs are reconciled again (Req 2.3)", () => {
    fc.assert(
      fc.property(sourceArb, absentArb, (sourceRaw, absentRaw) => {
        const source: Record<string, number | string> = { ...sourceRaw };
        const absent = [...new Set(absentRaw)].filter((m) => !(m in source));
        const requestedMetrics = [...Object.keys(source), ...absent];

        const build = () =>
          buildFigureLedger({
            scopeId: SCOPE,
            surfaces: {
              chat: { ...source },
              chart: { ...source },
              export: { ...source },
            },
            requestedMetrics,
          });

        const first = build();
        const second = build();

        // Repeated reconciliation of the same inputs is identical: same
        // ordered entries, same reconciled figures, same published projection.
        expect(second.entries).toStrictEqual(first.entries);
        expect(second.reconciledFigures()).toStrictEqual(first.reconciledFigures());
        expect(second.publish({ ...source })).toStrictEqual(
          first.publish({ ...source }),
        );
      }),
      { numRuns: 100 },
    );
  });
});
