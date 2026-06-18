import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  verifyGrounding,
  type Citation,
  type PredictionDraft,
  type SourcedFacts,
} from "./prediction";

// Feature: agentic-reporting-twin, Property 5: For any Prediction draft, `verifyGrounding` accepts it only if every numeric figure carries a citation to a source `metrics_*` metric or a named record obtained through the Tool_Dispatcher, and the prediction's basis references every cited record and figure; a draft containing any uncited or unsourced figure is rejected.

// ── Token conventions ───────────────────────────────────────────────────────
//
// All figures and source ids are emitted as bracket-wrapped tokens so that
// `String.prototype.includes` checks (used by `verifyGrounding` for the basis)
// are exact: `[M1]` is never an accidental substring of `[M12]`, and a figure
// token `[F3]` can never collide with a metric `[M3]` or record `[R3]`. Numeric
// ranges are kept disjoint between the grounded base (0..40) and any injected
// defect (>=100) so an injected token is guaranteed absent from the base pool.

const metricTok = (n: number): string => `[M${n}]`;
const recordTok = (n: number): string => `[R${n}]`;
const figureTok = (n: number): string => `[F${n}]`;

interface GroundedDraft {
  metricIds: string[];
  recordIds: string[];
  figures: string[];
  citations: Citation[];
  basis: string;
}

/** Build the basis prose so it references every cited figure and source id. */
function buildBasis(figures: string[], citations: Citation[]): string {
  const tokens = [...figures, ...citations.map((c) => c.source.id)];
  return ["basis:", ...tokens].join(" ");
}

function toDraft(g: GroundedDraft): PredictionDraft {
  return { figures: g.figures, citations: g.citations, basis: g.basis };
}

function toSourced(g: GroundedDraft): SourcedFacts {
  return { metricIds: g.metricIds, recordIds: g.recordIds };
}

// ── Arbitraries ─────────────────────────────────────────────────────────────

const smallNum = fc.integer({ min: 0, max: 40 });

/** A non-empty pool of dispatched sources (at least one metric or record). */
const sourcePoolArb = fc
  .record({
    metricNums: fc.uniqueArray(smallNum, { maxLength: 5 }),
    recordNums: fc.uniqueArray(smallNum, { maxLength: 5 }),
  })
  .filter((p) => p.metricNums.length + p.recordNums.length > 0);

/**
 * A fully grounded draft: every stated figure cites a source actually present in
 * `SourcedFacts`, and the basis references every cited figure and source id.
 */
const groundedArb: fc.Arbitrary<GroundedDraft> = sourcePoolArb.chain((pool) => {
  const metricIds = pool.metricNums.map(metricTok);
  const recordIds = pool.recordNums.map(recordTok);
  const sources: Citation["source"][] = [
    ...metricIds.map((id) => ({ kind: "metric" as const, id })),
    ...recordIds.map((id) => ({ kind: "record" as const, id })),
  ];

  return fc
    .uniqueArray(smallNum, { maxLength: 6 })
    .chain((figNums) => {
      const figures = figNums.map(figureTok);
      return fc
        .array(fc.nat({ max: sources.length - 1 }), {
          minLength: figures.length,
          maxLength: figures.length,
        })
        .map((choices) => {
          const citations: Citation[] = figures.map((figure, i) => ({
            figure,
            source: sources[choices[i]],
          }));
          return {
            metricIds,
            recordIds,
            figures,
            citations,
            basis: buildBasis(figures, citations),
          };
        });
    });
});

const NUM_RUNS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Property 5: Prediction grounding and explanation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * Property 5: Prediction grounding and explanation.
 *
 * For any Prediction draft, `verifyGrounding` accepts it only if every numeric
 * figure carries a citation to a source `metrics_*` metric or a named record
 * obtained through the Tool_Dispatcher, and the prediction's basis references
 * every cited record and figure; a draft containing any uncited or unsourced
 * figure is rejected.
 */
// Feature: agentic-reporting-twin, Property 5: Prediction grounding and explanation
describe("Feature: agentic-reporting-twin, Property 5: Prediction grounding and explanation", () => {
  it("accepts a draft when every figure is cited to a sourced metric/record and the basis references every citation", () => {
    fc.assert(
      fc.property(groundedArb, (g) => {
        const result = verifyGrounding(toDraft(g), toSourced(g));
        expect(result.ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a draft containing an uncited figure and surfaces it", () => {
    fc.assert(
      fc.property(
        groundedArb,
        fc.integer({ min: 100, max: 200 }),
        (g, extraNum) => {
          const uncited = figureTok(extraNum); // disjoint range → not in base
          const draft: PredictionDraft = {
            // The uncited figure is stated but carries no citation (Req 9.1).
            figures: [...g.figures, uncited],
            citations: g.citations,
            basis: g.basis,
          };

          const result = verifyGrounding(draft, toSourced(g));
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.uncitedFigures).toContain(uncited);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a draft whose figure cites an unsourced metric/record and surfaces the missing source", () => {
    fc.assert(
      fc.property(
        groundedArb,
        fc.integer({ min: 100, max: 200 }),
        fc.integer({ min: 300, max: 400 }),
        fc.constantFrom<"metric" | "record">("metric", "record"),
        (g, srcNum, figNum, kind) => {
          // A source id NOT obtained through the dispatcher (absent from SourcedFacts).
          const unsourcedId = kind === "metric" ? metricTok(srcNum) : recordTok(srcNum);
          const figure = figureTok(figNum); // disjoint range → not in base
          const citation: Citation = { figure, source: { kind, id: unsourcedId } };

          const draft: PredictionDraft = {
            figures: [...g.figures, figure],
            citations: [...g.citations, citation],
            // Reference the new figure + source in the basis so the ONLY defect
            // is the unsourced citation (isolates Req 9.3 from Req 9.2).
            basis: `${g.basis} ${figure} ${unsourcedId}`,
          };

          const result = verifyGrounding(draft, toSourced(g));
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.unsourcedFigures).toContain(figure);
          if (kind === "record") {
            // Missing records are surfaced so the agent can decline + name them (Req 9.4).
            expect(result.missingRecords).toContain(unsourcedId);
          } else {
            expect(result.missingMetrics).toContain(unsourcedId);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a draft whose basis omits a cited figure or source (explanation must reference every citation)", () => {
    fc.assert(
      fc.property(
        groundedArb.filter((g) => g.citations.length > 0),
        fc.nat(),
        (g, pick) => {
          const target = g.citations[pick % g.citations.length];
          // Drop the cited figure token from the basis → an explanation omission (Req 9.2).
          const omittedBasis = g.basis.split(target.figure).join("");

          const result = verifyGrounding(
            { figures: g.figures, citations: g.citations, basis: omittedBasis },
            toSourced(g),
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.basisOmissions).toContain(target.figure);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
