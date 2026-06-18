// @vitest-environment jsdom
/**
 * Component-sheet drag threshold — Property 7.
 *
 * Spec: live-page-editor — task 7.2
 * _Validates: Requirements 6.3, 6.4_
 *
 * The bottom-anchored Component_Sheet derives its state from the drag delta
 * against a threshold of 20% of the Editor_Shell height: the sheet is
 * `"expanded"` if and only if the UPWARD drag distance strictly EXCEEDS 20% of
 * the shell height, and `"collapsed"` otherwise. A drag of exactly 20% stays
 * collapsed (strict exceed), and a non-positive / non-finite shell height has no
 * meaningful threshold so the sheet stays collapsed.
 *
 * Tag: Feature: live-page-editor, Property 7: Component-sheet drag threshold
 * determines state — expanded iff upward drag distance exceeds 20% of the
 * Editor_Shell height, collapsed otherwise.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Polyfill ResizeObserver / matchMedia for jsdom BEFORE importing ComponentSheet.
// ComponentSheet.tsx transitively imports `usePuckStore` → `@puckeditor/core` →
// `@dnd-kit/dom`, which touches `ResizeObserver` at module scope. The pure
// `sheetStateFromDrag` helper itself needs no DOM, but importing the module does.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

// Type-only import is fully erased and triggers no runtime module load.
import type { SheetState } from "./ComponentSheet";

// Deferred import so the polyfills above are in place before the module (and its
// transitive @dnd-kit module-scope access) loads.
const { sheetStateFromDrag, SHEET_EXPAND_THRESHOLD_RATIO } = await import(
  "./ComponentSheet"
);

/**
 * Independent oracle. Recomputes the expected sheet state directly from the
 * contract rather than mirroring the implementation's control flow:
 *   - a non-finite drag delta or shell height has no defined threshold,
 *   - a non-positive shell height has no meaningful threshold,
 *   - otherwise expand iff the upward distance strictly exceeds 20% of height.
 */
function expectedState(dragDeltaPx: number, shellHeightPx: number): SheetState {
  if (!Number.isFinite(dragDeltaPx) || !Number.isFinite(shellHeightPx)) {
    return "collapsed";
  }
  if (shellHeightPx <= 0) {
    return "collapsed";
  }
  return dragDeltaPx > SHEET_EXPAND_THRESHOLD_RATIO * shellHeightPx
    ? "expanded"
    : "collapsed";
}

// Positive container heights (the common case) plus zero/negative edges.
const heightArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 1, max: 4000, noNaN: true }) },
  { weight: 2, arbitrary: fc.constantFrom(0, -1, -100, -2000) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY) },
);

// Drag deltas spanning downward (negative), at-rest (zero), and upward
// (positive) gestures, including values clustered around the threshold.
const deltaArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: -4000, max: 4000, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY) },
);

// A (height, delta) pair generator. Deliberately blends free deltas with the
// strict-boundary case — delta == exactly 20% of a positive height, which must
// stay collapsed — and the just-above-threshold case, so the single property
// exercises both sides of and the exact point of the boundary.
const dragArb = fc.oneof(
  { weight: 6, arbitrary: fc.tuple(deltaArb, heightArb) },
  {
    weight: 2,
    arbitrary: fc
      .double({ min: 1, max: 4000, noNaN: true })
      .map((h): [number, number] => [SHEET_EXPAND_THRESHOLD_RATIO * h, h]),
  },
  {
    weight: 1,
    arbitrary: fc
      .double({ min: 1, max: 4000, noNaN: true })
      .map((h): [number, number] => [
        SHEET_EXPAND_THRESHOLD_RATIO * h + 0.001,
        h,
      ]),
  },
);

describe("Feature: live-page-editor — Property 7: Component-sheet drag threshold determines state", () => {
  it("is expanded iff the upward drag distance exceeds 20% of the shell height", () => {
    fc.assert(
      fc.property(dragArb, ([delta, height]) => {
        expect(sheetStateFromDrag(delta, height)).toBe(
          expectedState(delta, height),
        );
      }),
      { numRuns: 100 },
    );
  });
});
