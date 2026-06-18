import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  renderChart,
  buildChartSpec,
  seriesFromRows,
  defaultChartRenderer,
  type ChartSpec,
  type ChartSeries,
  type ChartType,
} from "./chart-generator";
import type { ReportScope } from "./scope";

// Feature: agentic-reporting-twin, Property 8: Chart values are preserved verbatim through rendering. For any `PipelineMetrics`, the Chart_Spec's plotted values equal the corresponding Metrics_Pipeline figures, and for any valid Chart_Spec the rendered Chart_Artifact's data points equal the Chart_Spec figures exactly, with no value altered, rounded, or recomputed during rendering or download.

/**
 * **Property 8: Chart values are preserved verbatim through rendering.**
 *
 * **Validates: Requirements 4.1, 4.2, 6.5**
 *
 * Two derivations are pinned down:
 *
 *   (a) Chart_Spec construction (`seriesFromRows` + `buildChartSpec`) copies the
 *       `y` figure VERBATIM from the Metrics_Pipeline rows — every plotted value
 *       is byte-for-byte identical to the source figure, with no arithmetic,
 *       rounding, or recomputation (Requirement 4.1).
 *   (b) Rendering (`renderChart` via the value-preserving `defaultChartRenderer`)
 *       carries every Chart_Spec figure into the Chart_Artifact unchanged. The
 *       default renderer encodes the spec's points into the artifact bytes, so
 *       we decode the artifact and assert each plotted value equals the
 *       Chart_Spec figure exactly (Requirement 4.2, and the same byte-preserving
 *       guarantee a download relies on — Requirement 6.5).
 *
 * Equality uses `Object.is` so a difference in numeric value or precision would
 * be caught. Tests run off the serverless guard via `deps: { serverless: false }`
 * so the container-tier refusal never fires (Requirement 5.5/14.5 is out of
 * scope for this property).
 */

const NUM_RUNS = 100;

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * A plotted figure as read verbatim from a `metrics_*` view: a finite number.
 * `-0` is excluded because JSON serialization (used by the value-preserving
 * default encoder, mirroring any text-based artifact) normalizes `-0` to `0`;
 * a real metric figure is never the negative zero bit-pattern, so excluding it
 * keeps the verbatim assertion exact without weakening the property.
 */
const figureArb: fc.Arbitrary<number> = fc
  .oneof(
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  )
  .filter((y) => !Object.is(y, -0));

/** An x-axis label (the categorical/temporal axis key copied verbatim). */
const xLabelArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 12 });

const chartTypeArb: fc.Arbitrary<ChartType> = fc.constantFrom("bar", "line", "pie");

const periodArb = fc.constantFrom("all-time", "this-week", "this-month");

const scopeArb: fc.Arbitrary<ReportScope> = fc.oneof(
  periodArb.map((period) => ({ scope: "exec" as const, period })),
  fc
    .record({ period: periodArb, repId: fc.string({ minLength: 1, maxLength: 8 }) })
    .map(({ period, repId }) => ({ scope: "rep" as const, period, repId })),
);

/** One series of plotted points (at least one point so it is plottable). */
const seriesArb: fc.Arbitrary<ChartSeries> = fc.record({
  label: fc.string({ minLength: 1, maxLength: 12 }),
  points: fc.array(
    fc.record({ x: xLabelArb, y: figureArb }),
    { minLength: 1, maxLength: 20 },
  ),
});

/**
 * A valid Chart_Spec: a supported type, at least one series, and total data
 * points within the default 500 cap (1..20 points × 1..3 series → ≤ 60).
 */
const chartSpecArb: fc.Arbitrary<ChartSpec> = fc.record({
  type: chartTypeArb,
  title: fc.string({ maxLength: 24 }),
  metricId: fc.string({ minLength: 1, maxLength: 24 }),
  scope: scopeArb,
  series: fc.array(seriesArb, { minLength: 1, maxLength: 3 }),
});

// ── Artifact decoding (mirror of defaultChartRenderer's encoding) ─────────────

const PNG_SIGNATURE_LEN = 8;

interface DecodedArtifact {
  type: string;
  metricId: string;
  series: { label: string; points: [string, number][] }[];
}

/** Decode the value-preserving default renderer's artifact bytes back to figures. */
function decodeArtifact(bytes: Uint8Array): DecodedArtifact {
  const body = bytes.subarray(PNG_SIGNATURE_LEN);
  const json = new TextDecoder().decode(body);
  return JSON.parse(json) as DecodedArtifact;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 8
// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-reporting-twin, Property 8: chart values preserved verbatim", () => {
  it("(a) Chart_Spec construction copies metric figures verbatim from the source rows", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ x: xLabelArb, y: figureArb }),
          { minLength: 1, maxLength: 30 },
        ),
        chartTypeArb,
        scopeArb,
        fc.string({ minLength: 1, maxLength: 16 }),
        (rows, type, scope, metricId) => {
          // Model the Metrics_Pipeline rows as `{ label, value }` records, where
          // `value` is the SQL-sourced figure read verbatim into the chart.
          const sourceRows = rows.map((r) => ({ label: r.x, value: r.y }));

          const series = seriesFromRows(sourceRows, "series-0", "label", "value");
          const spec = buildChartSpec(
            { type, title: "t", metricId, scope },
            [series],
          );

          // Every plotted `y` equals the corresponding source figure exactly,
          // and the `x` label is carried through unchanged (Requirement 4.1).
          expect(spec.series[0].points.length).toBe(sourceRows.length);
          for (let i = 0; i < sourceRows.length; i++) {
            expect(Object.is(spec.series[0].points[i].y, sourceRows[i].value)).toBe(true);
            expect(spec.series[0].points[i].x).toBe(String(sourceRows[i].label));
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("(b) rendered Chart_Artifact data points equal the Chart_Spec figures exactly", async () => {
    await fc.assert(
      fc.asyncProperty(chartSpecArb, async (spec) => {
        const result = await renderChart(spec, undefined, {
          renderer: defaultChartRenderer,
          serverless: false,
        });

        // A valid spec always renders an artifact.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { artifact } = result;

        // The artifact retains the exact spec by reference — figures unchanged.
        expect(artifact.spec).toBe(spec);

        // Decode the artifact bytes and assert each plotted value equals the
        // Chart_Spec figure exactly — no value altered, rounded, or recomputed
        // during rendering (Requirement 4.2) or download (Requirement 6.5).
        const decoded = decodeArtifact(artifact.bytes);
        expect(decoded.series.length).toBe(spec.series.length);
        for (let s = 0; s < spec.series.length; s++) {
          const specPoints = spec.series[s].points;
          const decodedPoints = decoded.series[s].points;
          expect(decodedPoints.length).toBe(specPoints.length);
          for (let p = 0; p < specPoints.length; p++) {
            const [dx, dy] = decodedPoints[p];
            expect(dx).toBe(specPoints[p].x);
            expect(Object.is(dy, specPoints[p].y)).toBe(true);
          }
        }

        // The data-point count is the verbatim total, not a recomputed figure.
        const total = spec.series.reduce((n, s) => n + s.points.length, 0);
        expect(artifact.dataPointCount).toBe(total);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
