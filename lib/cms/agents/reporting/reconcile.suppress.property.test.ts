import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildFigureLedger,
  type FigureValue,
  type SurfaceFigures,
} from "./reconcile";

/**
 * Feature: agentic-reporting-twin, Property 2: Figure reconciliation suppresses only the irreconcilable
 *
 * *For any* set of per-surface figure maps for one Report_Scope, the
 * reconciliation ledger suppresses on all three surfaces exactly those metrics
 * whose values would differ across surfaces (presenting a could-not-reconcile
 * indication) and leaves every consistent metric published unchanged.
 *
 * **Validates: Requirements 2.6**
 *
 * The `buildFigureLedger` / `FigureLedger` pure functions in `./reconcile` are
 * the implementation under test. The test builds arbitrary `chat` / `chart` /
 * `export` figure maps over a shared metric set and an independent oracle, then
 * asserts that the metrics suppressed everywhere are EXACTLY those whose present
 * values disagree, while consistent metrics survive byte-for-byte on every
 * surface that presented them.
 */

const SCOPE = "exec:all-time";
const SURFACE_NAMES = ["chat", "chart", "export"] as const;

/** A figure value as a surface might present it, or an absence (null/undefined). */
const cellArb: fc.Arbitrary<FigureValue> = fc.oneof(
  // Small numeric/string domains so equality AND inequality both occur often.
  { weight: 8, arbitrary: fc.integer({ min: 0, max: 4 }) },
  { weight: 4, arbitrary: fc.constantFrom("a", "b", "120s") },
  { weight: 1, arbitrary: fc.constant<FigureValue>(null) },
  { weight: 1, arbitrary: fc.constant<FigureValue>(undefined) }
);

/** Per-metric cells, one per surface. */
const tripleArb = fc.record({
  chat: cellArb,
  chart: cellArb,
  export: cellArb,
});

/** A map of metricId -> per-surface cells. */
const specsArb = fc.dictionary(
  fc.constantFrom("alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"),
  tripleArb,
  { minKeys: 1, maxKeys: 7 }
);

/** Identity comparison only — must mirror the implementation (no coercion). */
function figuresEqual(a: number | string, b: number | string): boolean {
  return Object.is(a, b);
}

function isPresent(v: FigureValue): v is number | string {
  return v !== null && v !== undefined;
}

type Oracle = {
  consistent: Map<string, number | string>;
  unavailable: Set<string>;
  irreconcilable: Set<string>;
};

/** Independent classification of the per-surface maps for one scope. */
function classify(
  metricIds: string[],
  surfaces: Record<string, SurfaceFigures>
): Oracle {
  const consistent = new Map<string, number | string>();
  const unavailable = new Set<string>();
  const irreconcilable = new Set<string>();

  for (const m of metricIds) {
    const present: Array<number | string> = [];
    for (const name of SURFACE_NAMES) {
      const v = surfaces[name][m];
      if (isPresent(v)) present.push(v);
    }
    if (present.length === 0) {
      unavailable.add(m);
    } else if (present.every((v) => figuresEqual(v, present[0]))) {
      consistent.set(m, present[0]);
    } else {
      irreconcilable.add(m);
    }
  }
  return { consistent, unavailable, irreconcilable };
}

describe("Feature: agentic-reporting-twin, Property 2: Figure reconciliation suppresses only the irreconcilable", () => {
  it("suppresses on all three surfaces exactly the metrics whose values differ, leaving consistent figures published unchanged", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const metricIds = Object.keys(specs);

        const surfaces: Record<string, SurfaceFigures> = {
          chat: {},
          chart: {},
          export: {},
        };
        for (const [m, t] of Object.entries(specs)) {
          surfaces.chat[m] = t.chat;
          surfaces.chart[m] = t.chart;
          surfaces.export[m] = t.export;
        }

        const oracle = classify(metricIds, surfaces);

        const ledger = buildFigureLedger({
          scopeId: SCOPE,
          surfaces,
          requestedMetrics: metricIds,
        });

        // Per-metric classification matches the independent oracle.
        for (const m of metricIds) {
          const entry = ledger.entry(m);
          expect(entry).toBeDefined();
          expect(entry!.scopeId).toBe(SCOPE);

          if (oracle.irreconcilable.has(m)) {
            expect(entry!.status).toBe("irreconcilable");
            // Suppressed: no surviving value.
            expect(entry!.value).toBeNull();
          } else if (oracle.unavailable.has(m)) {
            expect(entry!.status).toBe("unavailable");
            expect(entry!.value).toBeNull();
          } else {
            expect(entry!.status).toBe("consistent");
            // Left unchanged: the agreed value, byte-for-byte.
            expect(entry!.value).toBe(oracle.consistent.get(m));
          }
        }

        // The metrics suppressed-as-irreconcilable are EXACTLY those that differ.
        const ledgerIrreconcilable = new Set(
          ledger.irreconcilable().map((e) => e.metricId)
        );
        expect(ledgerIrreconcilable).toEqual(oracle.irreconcilable);

        // The published metric ids are EXACTLY the consistent ones — nothing
        // consistent is suppressed, nothing irreconcilable/unavailable leaks.
        const published = new Set(ledger.publishedMetricIds());
        expect(published).toEqual(new Set(oracle.consistent.keys()));

        // On every surface: consistent figures survive unchanged; irreconcilable
        // and unavailable figures are removed.
        for (const name of SURFACE_NAMES) {
          const out = ledger.publish(surfaces[name]);

          // Irreconcilable metrics never appear on any surface.
          for (const m of oracle.irreconcilable) {
            expect(m in out).toBe(false);
          }
          // Unavailable metrics never appear on any surface.
          for (const m of oracle.unavailable) {
            expect(m in out).toBe(false);
          }
          // Consistent metrics that this surface presented survive unchanged.
          for (const [m, value] of oracle.consistent) {
            if (isPresent(surfaces[name][m])) {
              expect(out[m]).toBe(value);
            }
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it("publishes byte-for-byte identical consistent figures across chat, chart, and export", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const surfaces: Record<string, SurfaceFigures> = {
          chat: {},
          chart: {},
          export: {},
        };
        for (const [m, t] of Object.entries(specs)) {
          surfaces.chat[m] = t.chat;
          surfaces.chart[m] = t.chart;
          surfaces.export[m] = t.export;
        }

        const ledger = buildFigureLedger({
          scopeId: SCOPE,
          surfaces,
          requestedMetrics: Object.keys(specs),
        });

        // The canonical reconciled figures are the single source of truth; any
        // surface that presented a consistent metric publishes that exact value.
        const canonical = ledger.reconciledFigures();
        for (const name of SURFACE_NAMES) {
          const out = ledger.publish(surfaces[name]);
          for (const m of Object.keys(out)) {
            expect(out[m]).toBe(canonical[m]);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
