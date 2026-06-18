import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  collectSourcedFigures,
  isSourced,
  findUnsourced,
  verifyNoFabrication,
  attributeFigure,
  type AttributedFigure,
} from "./attribution";
import type { FigureValue } from "./reconcile";

// Feature: agentic-reporting-twin, Property 3: Numbers come from SQL — no fabricated figure
//
// *For any* narration or Prediction the Reporting_Agent produces, every numeric
// figure stated is a member of the figures returned by the Metrics_Pipeline or a
// named record returned through the Tool_Dispatcher for the request; no figure is
// computed, recomputed, estimated, or invented by the model, and the agent code
// path performs no arithmetic on figures.
//
// **Validates: Requirements 1.3, 9.1, 9.3, 16.2**
//
// The PURE `collectSourcedFigures` / `isSourced` / `findUnsourced` /
// `verifyNoFabrication` functions in `./attribution` are the implementation
// under test. The test builds an arbitrary universe of dispatched figure maps
// (the figures actually returned through the Tool_Dispatcher for a turn) and an
// arbitrary set of "stated" figures — some copied verbatim from the dispatched
// universe, some freshly minted (i.e. fabricated). An independent oracle
// classifies each stated figure by verbatim string membership, and the test
// asserts a stated figure is accepted **iff** it is a member of the dispatched
// figures, while every figure absent from the dispatched results is flagged as
// unsourced/fabricated.

const NUM_RUNS = 100;

// ── Arbitraries ────────────────────────────────────────────────────────────────

/**
 * A figure value as a `metrics_*` view (or a named record) might return it: a
 * number, or a pre-formatted string read verbatim. The domains deliberately
 * overlap (e.g. the integer `42` and the string `"42"`) so the verbatim
 * string-key normalization — `String(value)`, NOT arithmetic — is exercised
 * across collisions, and `42` vs `42.0` (distinct keys) never coincide.
 */
const valueArb: fc.Arbitrary<number | string> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 9 }) },
  { weight: 2, arbitrary: fc.constantFrom(1.5, 2.25, 42, 42.0, 100) },
  { weight: 3, arbitrary: fc.constantFrom("42", "42.0", "120s", "a", "b", "0") },
);

/** A cell as a surface map carries it: a value or an absence (null/undefined). */
const cellArb: fc.Arbitrary<FigureValue> = fc.oneof(
  { weight: 8, arbitrary: valueArb },
  { weight: 1, arbitrary: fc.constant<FigureValue>(null) },
  { weight: 1, arbitrary: fc.constant<FigureValue>(undefined) },
);

const metricIdArb = fc.constantFrom(
  "tierFunnel.hot",
  "tierFunnel.warm",
  "speedToLead.p50",
  "costPerQualified",
  "repLoad.open",
  "weekOverWeek.delta",
);

/** A dispatched figure map: metricId -> figure value, read verbatim for a turn. */
const figureMapArb = fc.dictionary(metricIdArb, cellArb, {
  minKeys: 0,
  maxKeys: 6,
});

/** One or more dispatched maps (pipeline figures + record-sourced figures). */
const dispatchedMapsArb = fc.array(figureMapArb, { minLength: 1, maxLength: 3 });

// ── Oracle ──────────────────────────────────────────────────────────────────────

function isPresent(v: FigureValue): v is number | string {
  return v !== null && v !== undefined;
}

/** Independent membership universe: verbatim string keys of every present value. */
function oracleKeys(maps: Array<Record<string, FigureValue>>): Set<string> {
  const keys = new Set<string>();
  for (const map of maps) {
    for (const id of Object.keys(map)) {
      const v = map[id];
      if (isPresent(v)) keys.add(String(v));
    }
  }
  return keys;
}

function oracleSourced(v: FigureValue, keys: Set<string>): boolean {
  return isPresent(v) && keys.has(String(v));
}

/**
 * Build a list of "stated" figures: a mix of figures copied verbatim from the
 * dispatched universe (guaranteed members) and freshly generated figures (which
 * may or may not, by chance, collide with a member). This guarantees both the
 * accept and the flag branches are visited.
 */
function statedFiguresArb(
  maps: Array<Record<string, FigureValue>>,
): fc.Arbitrary<FigureValue[]> {
  const present: Array<number | string> = [];
  for (const map of maps) {
    for (const id of Object.keys(map)) {
      const v = map[id];
      if (isPresent(v)) present.push(v);
    }
  }
  const fromDispatched =
    present.length > 0 ? fc.constantFrom(...present) : valueArb;
  const statedCellArb = fc.oneof(
    { weight: 5, arbitrary: fromDispatched },
    { weight: 4, arbitrary: cellArb },
  );
  return fc.array(statedCellArb, { minLength: 0, maxLength: 8 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 3
// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-reporting-twin, Property 3: Numbers come from SQL — no fabricated figure", () => {
  it("accepts a stated figure as sourced iff it is a member of the dispatched figures", () => {
    fc.assert(
      fc.property(
        dispatchedMapsArb.chain((maps) =>
          fc.record({
            maps: fc.constant(maps),
            stated: statedFiguresArb(maps),
          }),
        ),
        ({ maps, stated }) => {
          const sourced = collectSourcedFigures(...maps);
          const keys = oracleKeys(maps);

          // The collected membership universe equals the independent oracle.
          expect(new Set(sourced.keys)).toEqual(keys);

          // iff: each stated figure is accepted exactly when it is a member.
          for (const figure of stated) {
            expect(isSourced(figure, sourced)).toBe(oracleSourced(figure, keys));
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("flags exactly the figures absent from the dispatched results as unsourced", () => {
    fc.assert(
      fc.property(
        dispatchedMapsArb.chain((maps) =>
          fc.record({
            maps: fc.constant(maps),
            stated: statedFiguresArb(maps),
          }),
        ),
        ({ maps, stated }) => {
          const sourced = collectSourcedFigures(...maps);
          const keys = oracleKeys(maps);

          // findUnsourced returns EXACTLY the stated figures that are not members
          // (including absent null/undefined cells, which are never sourced).
          const expectedUnsourced = stated.filter(
            (f) => !oracleSourced(f, keys),
          );
          expect(findUnsourced(stated, sourced)).toEqual(expectedUnsourced);

          // Every member is accepted; every absentee is flagged.
          for (const figure of stated) {
            const member = oracleSourced(figure, keys);
            const flagged = findUnsourced([figure], sourced).length === 1;
            expect(flagged).toBe(!member);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("verifyNoFabrication accepts iff no present stated figure is fabricated, listing the unsourced values otherwise", () => {
    fc.assert(
      fc.property(
        dispatchedMapsArb.chain((maps) =>
          fc.record({
            maps: fc.constant(maps),
            stated: statedFiguresArb(maps),
          }),
        ),
        ({ maps, stated }) => {
          const sourced = collectSourcedFigures(...maps);
          const keys = oracleKeys(maps);

          // verifyNoFabrication considers only PRESENT figures (absent cells are
          // withheld upstream, not fabricated).
          const presentUnsourced = stated.filter(
            (f) => isPresent(f) && !keys.has(String(f)),
          ) as Array<number | string>;

          const result = verifyNoFabrication(stated, sourced);

          if (presentUnsourced.length === 0) {
            expect(result.ok).toBe(true);
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.unsourced).toEqual(presentUnsourced);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a narration drawn entirely from dispatched figures is never flagged as fabricated", () => {
    fc.assert(
      fc.property(dispatchedMapsArb, (maps) => {
        const sourced = collectSourcedFigures(...maps);
        // Every present value across the dispatched maps — a faithful narration.
        const stated: FigureValue[] = [];
        for (const map of maps) {
          for (const id of Object.keys(map)) {
            if (isPresent(map[id])) stated.push(map[id]);
          }
        }

        for (const figure of stated) {
          expect(isSourced(figure, sourced)).toBe(true);
        }
        expect(findUnsourced(stated, sourced)).toEqual([]);
        expect(verifyNoFabrication(stated, sourced).ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("applies the same membership verdict to attributed figures as to raw values", () => {
    fc.assert(
      fc.property(
        dispatchedMapsArb.chain((maps) =>
          fc.record({
            maps: fc.constant(maps),
            stated: statedFiguresArb(maps),
          }),
        ),
        ({ maps, stated }) => {
          const sourced = collectSourcedFigures(...maps);

          // Wrap each present stated figure as an AttributedFigure; the
          // membership check must ignore attribution and test only the value.
          const attributed: AttributedFigure[] = [];
          for (const f of stated) {
            const af = attributeFigure("tierFunnel.hot", f, "exec:all-time");
            if (af) attributed.push(af);
          }

          const rawVerdict = verifyNoFabrication(
            attributed.map((a) => a.value),
            sourced,
          );
          const attrVerdict = verifyNoFabrication(attributed, sourced);
          expect(attrVerdict.ok).toBe(rawVerdict.ok);

          // findUnsourced over attributed figures flags exactly the same values.
          const rawFlagged = findUnsourced(
            attributed.map((a) => a.value),
            sourced,
          );
          const attrFlagged = findUnsourced(attributed, sourced);
          expect(attrFlagged.map((a) => a.value)).toEqual(rawFlagged);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
