// @vitest-environment jsdom
/**
 * Component insertion position — Property 6.
 *
 * Spec: live-page-editor — task 7.6
 * _Validates: Requirements 6.8, 6.9_
 *
 * When the user selects a component from the Component_Sheet, the Live_Editor
 * inserts it immediately AFTER the Selected_Block (Req 6.8), or at the END of
 * the page content when nothing is selected (Req 6.9). The pure, exported
 * `insertionIndex(selectedIndex, contentLength)` helper is the single source of
 * truth for that destination index: it returns `selectedIndex + 1` when a block
 * is selected (`selectedIndex != null && >= 0`), else `contentLength`.
 *
 * This property exercises the FULL contract by modelling the insertion as a pure
 * array splice at the resolved index and asserting the resulting array
 * properties: (1) length grows by exactly one; (2) the new block lands at
 * `selectedIndex + 1` when a block is selected, else at the end; (3) the
 * relative order of every pre-existing block is preserved.
 *
 * Tag: Feature: live-page-editor, Property 6: Insertion places the component at
 * the correct position — immediately after the Selected_Block, or at the end
 * when none selected; length grows by exactly one; relative order of
 * pre-existing blocks preserved.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Polyfill ResizeObserver / matchMedia for jsdom BEFORE importing ComponentSheet.
// ComponentSheet.tsx transitively imports `usePuckStore` → `@puckeditor/core` →
// `@dnd-kit/dom`, which touches `ResizeObserver` at module scope. The pure
// `insertionIndex` helper itself needs no DOM, but importing the module does.
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

// Deferred import so the polyfills above are in place before the module (and its
// transitive @dnd-kit module-scope access) loads.
const { insertionIndex } = await import("./ComponentSheet");

/** A content block as the insertion sees it — only its identity matters here. */
interface Block {
  id: string;
}

/**
 * Independent oracle for the destination index. Implemented from the contract
 * with an explicit ternary (rather than mirroring the implementation's early
 * return), so it does not merely echo the code under test:
 *   - a selected block (non-null, non-negative index) → directly after it,
 *   - otherwise (null, or a negative "not found" sentinel) → the end.
 */
function insertionIndexOracle(
  selectedIndex: number | null,
  contentLength: number,
): number {
  return selectedIndex != null && selectedIndex >= 0
    ? selectedIndex + 1
    : contentLength;
}

// Content arrays of blocks with distinct ids so order/identity is checkable.
const contentArb = fc
  .array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 12 })
  .map((suffixes): Block[] =>
    // Index-prefixed ids guarantee uniqueness even if `string` repeats.
    suffixes.map((s, i) => ({ id: `b${i}-${s}` })),
  );

/**
 * A scenario: a content array, a selection index, and the block to insert. The
 * selection index blends the meaningful cases:
 *   - `null` (no selection → append, Req 6.9),
 *   - a valid in-range index (selection → insert after it, Req 6.8),
 *   - a negative "not found" sentinel (treated as no selection → append),
 *   - an out-of-range positive index (defensive: still resolves to index+1).
 */
const scenarioArb = contentArb.chain((content) => {
  const selectedIndexArb = fc.oneof(
    { weight: 3, arbitrary: fc.constant<number | null>(null) },
    {
      weight: 4,
      arbitrary:
        content.length === 0
          ? fc.constant<number | null>(null)
          : fc.integer({ min: 0, max: content.length - 1 }),
    },
    { weight: 1, arbitrary: fc.constantFrom<number | null>(-1, -5) },
    { weight: 1, arbitrary: fc.integer({ min: content.length, max: content.length + 5 }) },
  );

  return fc.record({
    content: fc.constant(content),
    selectedIndex: selectedIndexArb,
    newBlock: fc.record({ id: fc.constant("__inserted__") }),
  });
});

describe("Feature: live-page-editor — Property 6: Insertion places the component at the correct position", () => {
  it("inserts after the Selected_Block (or at the end), growing length by one and preserving pre-existing order", () => {
    fc.assert(
      fc.property(scenarioArb, ({ content, selectedIndex, newBlock }) => {
        const idx = insertionIndex(selectedIndex, content.length);

        // The resolved index matches the independent oracle (Req 6.8/6.9).
        expect(idx).toBe(insertionIndexOracle(selectedIndex, content.length));

        // Model the Puck `insert` as a pure splice at the resolved index.
        const result: Block[] = [
          ...content.slice(0, idx),
          newBlock,
          ...content.slice(idx),
        ];

        // (1) Length grows by exactly one.
        expect(result).toHaveLength(content.length + 1);

        // (2) The new block lands immediately after the Selected_Block when one
        //     is selected, otherwise at the very end of the content.
        const hasSelection = selectedIndex != null && selectedIndex >= 0;
        const expectedPos = hasSelection
          ? Math.min(selectedIndex + 1, content.length)
          : content.length;
        expect(result[expectedPos]).toBe(newBlock);
        if (!hasSelection) {
          // No selection → appended at the end (Req 6.9).
          expect(result[result.length - 1]).toBe(newBlock);
        }

        // (3) The relative order of all pre-existing blocks is preserved:
        //     dropping the inserted block recovers the original array exactly.
        const withoutInserted = result.filter((b) => b !== newBlock);
        expect(withoutInserted).toEqual(content);
      }),
      { numRuns: 100 },
    );
  });
});
