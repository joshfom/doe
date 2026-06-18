// @vitest-environment jsdom
/**
 * Property-based test for the pure component-sheet drag-threshold helper.
 *
 * Feature: live-page-editor, Property 7: Component-sheet drag threshold determines state
 *
 * The Component_Sheet is in the `expanded` state if and only if the upward drag
 * distance exceeds 20% of the Editor_Shell height, and `collapsed` otherwise.
 *
 * Sign convention (confirmed in ComponentSheet.tsx): `dragDeltaPx` is the
 * cumulative vertical pointer movement from the drag start, where DOWN is
 * POSITIVE and UP is NEGATIVE (matching `clientY`). The upward drag distance is
 * therefore `-dragDeltaPx`, and:
 *
 *     expanded  ⟺  (-dragDeltaPx) > 0.2 * shellHeightPx     (positive height)
 *
 * The threshold is strict (`>`), so a drag landing *exactly* on the threshold
 * yields `collapsed`.
 *
 * **Validates: Requirements 6.3, 6.4**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { SheetState } from "@/lib/cms/live-editor/ComponentSheet";

// Polyfill ResizeObserver for jsdom — must be set before importing the
// ComponentSheet module, which transitively loads @dnd-kit/dom (via the Puck
// store) that accesses ResizeObserver at module scope.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation. The pure
// `resolveSheetState` helper and `SHEET_DRAG_THRESHOLD_RATIO` are exported from
// the ComponentSheet module, which now pulls in the Puck store at import time.
const { resolveSheetState, SHEET_DRAG_THRESHOLD_RATIO } = await import(
  "@/lib/cms/live-editor/ComponentSheet"
);

// ── Generators ───────────────────────────────────────────────────────────────

const sheetStateArb: fc.Arbitrary<SheetState> = fc.constantFrom(
  "collapsed",
  "expanded",
);

/** Positive, finite container heights (px). */
const shellHeightArb: fc.Arbitrary<number> = fc.double({
  min: 1,
  max: 10_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Drag deltas spanning the whole space: deep upward (negative), deep downward
 * (positive), and small movements around zero — so generated gestures land
 * below, at, and above the threshold for typical heights.
 */
const dragDeltaArb: fc.Arbitrary<number> = fc.double({
  min: -10_000,
  max: 10_000,
  noNaN: true,
  noDefaultInfinity: true,
});

// ── Property ─────────────────────────────────────────────────────────────────

describe("Feature: live-page-editor, Property 7: Component-sheet drag threshold determines state", () => {
  it("expands iff upward drag distance exceeds 20% of shell height, else collapses", () => {
    fc.assert(
      fc.property(
        dragDeltaArb,
        shellHeightArb,
        sheetStateArb,
        (dragDeltaPx, shellHeightPx, current) => {
          const result = resolveSheetState(dragDeltaPx, shellHeightPx, current);

          const upwardDistancePx = -dragDeltaPx;
          const threshold = SHEET_DRAG_THRESHOLD_RATIO * shellHeightPx;
          const expected: SheetState =
            upwardDistancePx > threshold ? "expanded" : "collapsed";

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("collapses when the upward drag lands exactly on the threshold (strict >)", () => {
    fc.assert(
      fc.property(shellHeightArb, sheetStateArb, (shellHeightPx, current) => {
        // Upward distance == threshold  ⟹  dragDeltaPx = -(0.2 * height).
        const dragDeltaPx = -(SHEET_DRAG_THRESHOLD_RATIO * shellHeightPx);
        expect(resolveSheetState(dragDeltaPx, shellHeightPx, current)).toBe(
          "collapsed",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("retains the current state for a degenerate (non-positive / non-finite) shell height", () => {
    const degenerateHeightArb = fc.constantFrom(
      0,
      -1,
      -1000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );
    fc.assert(
      fc.property(
        dragDeltaArb,
        degenerateHeightArb,
        sheetStateArb,
        (dragDeltaPx, shellHeightPx, current) => {
          expect(resolveSheetState(dragDeltaPx, shellHeightPx, current)).toBe(
            current,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
