import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  scopeId,
  attributeFigure,
  attributeFigures,
  findUnattributed,
  type AttributedFigure,
} from "./attribution";
import type { ReportScope } from "./scope";
import type { FigureValue } from "./reconcile";

// Feature: agentic-reporting-twin, Property 4: For any figure the Reporting_Agent presents, it is accompanied by an attribution identifying its source metric identifier and Report_Scope identifier.

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** A metric identifier — genuinely non-empty (the source `metrics_*` metric key). */
const metricIdArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.length > 0);

/**
 * A single figure value as read verbatim from the Metrics_Pipeline: a number, a
 * pre-formatted string, or absent (null/undefined). Absent figures are not
 * "presented" and so carry no attribution.
 */
const figureValueArb: fc.Arbitrary<FigureValue> = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.string({ maxLength: 16 }),
  fc.constant(null),
  fc.constant(undefined),
);

/** A metric map: metric identifier → figure value, as one surface presents it. */
const figureMapArb: fc.Arbitrary<Record<string, FigureValue>> = fc.dictionary(
  metricIdArb,
  figureValueArb,
  { maxKeys: 12 },
);

/** A non-empty rep identifier (scope.ts treats "" as absent). */
const repIdArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.length > 0);

const periodArb = fc.constantFrom(
  "all-time",
  "this-week",
  "this-month",
  "last-quarter",
);

/** A fully-resolved Report_Scope: an exec scope, or a rep scope carrying its repId. */
const scopeArb: fc.Arbitrary<ReportScope> = fc.oneof(
  periodArb.map((period) => ({ scope: "exec" as const, period })),
  fc
    .record({ period: periodArb, repId: repIdArb })
    .map(({ period, repId }) => ({ scope: "rep" as const, period, repId })),
);

function isPresent(v: FigureValue): v is number | string {
  return v !== null && v !== undefined;
}

const NUM_RUNS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Figure attribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.4**
 *
 * Property 4: Figure attribution.
 *
 * For any figure the Reporting_Agent presents, it is accompanied by an
 * attribution identifying its source metric identifier and Report_Scope
 * identifier.
 */
// Feature: agentic-reporting-twin, Property 4: Figure attribution
describe("Feature: agentic-reporting-twin, Property 4: Figure attribution", () => {
  it("every presented figure carries a non-empty metricId and scopeId", () => {
    fc.assert(
      fc.property(figureMapArb, scopeArb, (figures, scope) => {
        const attributed = attributeFigures(figures, scope);

        // No presented figure is missing either attribution dimension.
        expect(findUnattributed(attributed)).toEqual([]);
        for (const f of attributed) {
          expect(f.metricId.length).toBeGreaterThan(0);
          expect(f.scopeId.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("every figure's attribution is traceable to its source metric and Report_Scope", () => {
    fc.assert(
      fc.property(figureMapArb, scopeArb, (figures, scope) => {
        const attributed = attributeFigures(figures, scope);
        const expectedScopeId = scopeId(scope);

        for (const f of attributed) {
          // scopeId traces back to the exact Report_Scope it was fetched for.
          expect(f.scopeId).toBe(expectedScopeId);
          // metricId traces back to a real source metric key in the map.
          expect(Object.prototype.hasOwnProperty.call(figures, f.metricId)).toBe(
            true,
          );
          // The value is the verbatim Metrics_Pipeline value (never recomputed).
          expect(f.value).toBe(figures[f.metricId]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("attributes exactly the present figures — absent figures are omitted, presented ones never dropped", () => {
    fc.assert(
      fc.property(figureMapArb, scopeArb, (figures, scope) => {
        const attributed = attributeFigures(figures, scope);

        const presentKeys = Object.keys(figures)
          .filter((k) => isPresent(figures[k]))
          .sort();
        const attributedKeys = attributed.map((f) => f.metricId).sort();

        expect(attributedKeys).toEqual(presentKeys);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("attributeFigure on a single figure mirrors the per-figure attribution guarantee", () => {
    fc.assert(
      fc.property(
        metricIdArb,
        figureValueArb,
        scopeArb,
        (metricId, value, scope) => {
          const result = attributeFigure(metricId, value, scope);

          if (!isPresent(value)) {
            // An absent figure is not presented — nothing to attribute.
            expect(result).toBeNull();
            return;
          }

          expect(result).not.toBeNull();
          const f = result as AttributedFigure;
          expect(f.metricId).toBe(metricId);
          expect(f.metricId.length).toBeGreaterThan(0);
          expect(f.scopeId).toBe(scopeId(scope));
          expect(f.scopeId.length).toBeGreaterThan(0);
          expect(f.value).toBe(value);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
