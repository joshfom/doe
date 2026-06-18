import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isSourced,
  attribute,
  collectSourcedFacts,
  findUnsourced,
  findUnattributed,
  type SourcedFacts,
  type FigureAttribution,
} from "./figures";
import type { BriefingFigure } from "./types";

// Feature: agentic-home, Property 7: No reported figure is absent from the dispatched `metrics_*` results; the Home_Agent and Briefing_Workflow never compute, derive, round, or estimate a figure.
//
// **Validates: Requirements 14.1, 14.2**
//
// The PURE `isSourced` / `collectSourcedFacts` / `findUnsourced` guards (plus the
// `attribute` / `findUnattributed` attribution guards backing Req 14.4) in
// `./figures` are the implementation under test. The test builds an arbitrary
// universe of dispatched figures (the values actually returned through the
// Tool_Dispatcher for a turn) and an arbitrary set of PRESENTED `BriefingFigure`s
// — some carrying values copied verbatim from the dispatched universe, some
// freshly minted (i.e. fabricated/computed). An independent oracle classifies
// each presented figure by verbatim string membership, and the test asserts a
// figure is accepted as sourced **iff** its value is a member of the dispatched
// figures and the figure is marked `available`.

const NUM_RUNS = 100;

type FigureValue = number | string | null | undefined;

// ── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * A figure value as a `metrics_*` view might return it. The domains overlap
 * deliberately (e.g. `42` and `"42"`) so the verbatim string-key normalization
 * (`String(value)`, NOT arithmetic) is exercised, and `42` vs `42.0` stay
 * distinct keys that never coincide.
 */
const valueArb: fc.Arbitrary<number | string> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 50 }) },
  { weight: 2, arbitrary: fc.constantFrom(1.5, 2.25, 42, 100, 0) },
  { weight: 3, arbitrary: fc.constantFrom("42", "42.0", "120s", "none", "0") },
);

/** A dispatched cell: a value, or an absence the dispatcher returned. */
const cellArb: fc.Arbitrary<FigureValue> = fc.oneof(
  { weight: 8, arbitrary: valueArb },
  { weight: 1, arbitrary: fc.constant<FigureValue>(null) },
  { weight: 1, arbitrary: fc.constant<FigureValue>(undefined) },
);

const metricIdArb = fc.constantFrom(
  "tierFunnel.hot",
  "tierFunnel.warm",
  "speedToLead.p50",
  "repLoad.open",
  "weekOverWeek.delta",
);

const scopeIdArb = fc.constantFrom("user:u1", "user:u2", "rep:r1", "exec:all");
const periodArb = fc.constantFrom("today", "this-week", "this-month");

/** A dispatched figure map: metricId -> value, read verbatim for the turn. */
const dispatchedMapArb = fc.dictionary(metricIdArb, cellArb, {
  minKeys: 0,
  maxKeys: 5,
});

const dispatchedMapsArb = fc.array(dispatchedMapArb, {
  minLength: 1,
  maxLength: 3,
});

// ── Oracle ───────────────────────────────────────────────────────────────────

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

/**
 * Build a list of presented `BriefingFigure`s: a mix of values copied verbatim
 * from the dispatched universe (guaranteed members) and freshly generated ones
 * (which may, by chance, collide). Each figure independently carries an
 * `available` flag and a possibly-incomplete attribution triple, so the
 * `available === false` (withheld) branch and the unattributed branch are
 * exercised too.
 */
function presentedFiguresArb(
  maps: Array<Record<string, FigureValue>>,
): fc.Arbitrary<BriefingFigure[]> {
  const present: Array<number | string> = [];
  for (const map of maps) {
    for (const id of Object.keys(map)) {
      const v = map[id];
      if (isPresent(v)) present.push(v);
    }
  }
  const valueChoice =
    present.length > 0
      ? fc.oneof(
          { weight: 5, arbitrary: fc.constantFrom(...present) },
          { weight: 4, arbitrary: valueArb },
        )
      : valueArb;

  const figureArb: fc.Arbitrary<BriefingFigure> = fc.record({
    metricId: fc.oneof(metricIdArb, fc.constant("")),
    scopeId: fc.oneof(scopeIdArb, fc.constant("")),
    period: fc.oneof(periodArb, fc.constant("")),
    value: valueChoice,
    available: fc.boolean(),
  });

  return fc.array(figureArb, { minLength: 0, maxLength: 8 });
}

const scenarioArb = dispatchedMapsArb.chain((maps) =>
  fc.record({
    maps: fc.constant(maps),
    figures: presentedFiguresArb(maps),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Property 7: No fabricated figures
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 7: No fabricated figures", () => {
  it("collectSourcedFacts equals the independent membership universe", () => {
    fc.assert(
      fc.property(dispatchedMapsArb, (maps) => {
        const facts = collectSourcedFacts(...maps);
        expect(new Set(facts.keys)).toEqual(oracleKeys(maps));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts a presented figure as sourced iff it is available AND its value is a dispatched member", () => {
    fc.assert(
      fc.property(scenarioArb, ({ maps, figures }) => {
        const facts: SourcedFacts = collectSourcedFacts(...maps);
        const keys = oracleKeys(maps);

        for (const figure of figures) {
          const expected =
            figure.available === true && keys.has(String(figure.value));
          expect(isSourced(figure, facts)).toBe(expected);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("findUnsourced flags exactly the available figures whose values are not dispatched", () => {
    fc.assert(
      fc.property(scenarioArb, ({ maps, figures }) => {
        const facts = collectSourcedFacts(...maps);
        const keys = oracleKeys(maps);

        const expectedUnsourced = figures.filter(
          (f) => f.available === true && !keys.has(String(f.value)),
        );
        expect(findUnsourced(figures, facts)).toEqual(expectedUnsourced);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a withheld figure (available === false) is never sourced and never flagged as unsourced", () => {
    fc.assert(
      fc.property(
        dispatchedMapsArb,
        metricIdArb,
        scopeIdArb,
        periodArb,
        valueArb,
        (maps, metricId, scopeId, period, value) => {
          const facts = collectSourcedFacts(...maps);
          const withheld: BriefingFigure = {
            metricId,
            scopeId,
            period,
            value,
            available: false,
          };
          expect(isSourced(withheld, facts)).toBe(false);
          expect(findUnsourced([withheld], facts)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a Briefing whose figures are drawn entirely from dispatched values is never flagged as fabricated", () => {
    fc.assert(
      fc.property(dispatchedMapsArb, (maps) => {
        const facts = collectSourcedFacts(...maps);
        const figures: BriefingFigure[] = [];
        for (const map of maps) {
          for (const id of Object.keys(map)) {
            const v = map[id];
            if (isPresent(v)) {
              figures.push({
                metricId: id,
                scopeId: "user:u1",
                period: "today",
                value: v,
                available: true,
              });
            }
          }
        }
        for (const figure of figures) {
          expect(isSourced(figure, facts)).toBe(true);
        }
        expect(findUnsourced(figures, facts)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("membership is verbatim — a rounded/derived value is NOT accepted unless its exact string is dispatched", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(42, 1.5, 2.25, 100),
        (sourcedNumber) => {
          // Only the exact dispatched value is sourced; a "rounded" or scaled
          // sibling that was never dispatched is rejected (no arithmetic).
          const facts = collectSourcedFacts({ "tierFunnel.hot": sourcedNumber });
          const sourced: BriefingFigure = {
            metricId: "tierFunnel.hot",
            scopeId: "user:u1",
            period: "today",
            value: sourcedNumber,
            available: true,
          };
          const derived: BriefingFigure = {
            ...sourced,
            value: sourcedNumber + 1, // a computed/estimated sibling
          };
          expect(isSourced(sourced, facts)).toBe(true);
          expect(isSourced(derived, facts)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Property 7: figure attribution (Req 14.4) — every presented figure traces back
// to its metric, scope, and period.
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 7: figure attribution", () => {
  it("attribute returns a complete triple iff the figure is available, present, and fully attributed", () => {
    fc.assert(
      fc.property(scenarioArb, ({ figures }) => {
        for (const figure of figures) {
          const result = attribute(figure);
          const shouldAttribute =
            figure.available === true &&
            figure.value !== null &&
            figure.value !== undefined &&
            figure.metricId.length > 0 &&
            figure.scopeId.length > 0 &&
            figure.period.length > 0;

          if (!shouldAttribute) {
            expect(result).toBeNull();
          } else {
            expect(result).not.toBeNull();
            const triple = result as FigureAttribution;
            expect(triple.metricId).toBe(figure.metricId);
            expect(triple.scopeId).toBe(figure.scopeId);
            expect(triple.period).toBe(figure.period);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("findUnattributed flags exactly the available figures with an incomplete attribution triple", () => {
    fc.assert(
      fc.property(scenarioArb, ({ figures }) => {
        const expected = figures.filter(
          (f) => f.available === true && attribute(f) === null,
        );
        expect(findUnattributed(figures)).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a fully-attributed available figure is never flagged as unattributed", () => {
    fc.assert(
      fc.property(
        metricIdArb,
        scopeIdArb,
        periodArb,
        valueArb,
        (metricId, scopeId, period, value) => {
          const figure: BriefingFigure = {
            metricId,
            scopeId,
            period,
            value,
            available: true,
          };
          expect(findUnattributed([figure])).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
