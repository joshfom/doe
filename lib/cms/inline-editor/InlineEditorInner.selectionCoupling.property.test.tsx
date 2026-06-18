// @vitest-environment jsdom
/**
 * InlineEditorInner — Property 4: Selection cardinality and sheet coupling.
 *
 * Spec: live-page-editor — task 8.2
 * Tag: Feature: live-page-editor, Property 4: Selection cardinality and sheet coupling
 * Validates: Requirements 4.5, 7.6, 7.8
 *
 * Property 4 (design.md):
 *   For any sequence of selection actions, at most one block is the
 *   Selected_Block at a time; the Configuration_Sheet is open if and only if a
 *   block is selected; and selecting a different block while the sheet is open
 *   moves the selection (and indicator) to exactly the newly selected block
 *   without closing the sheet.
 *
 * Unit under test
 * ---------------
 * The coupling logic lives in `InlineEditorInner`'s selection→sheet effect
 * (`useEffect(..., [selectedId])`): when `selectedId` is null it closes the
 * sheet; when a block is selected it re-targets Puck's `itemSelector` to that
 * block's content index and opens the sheet (`setSheetOpen(true)` is
 * idempotent, so re-selecting a different block re-targets without closing).
 *
 * We drive the inner with an **injected** `selection` (an `InlineSelection`
 * the test fully controls), exactly as the live editor shell does — so the
 * inner's own `useInlineSelection` is mounted inert and the test is the sole
 * selection driver. The heavy children (`usePuckStore`, `SelectionOverlay`,
 * `ConfigurationSheet`, `InlineSaveBar`, `useInlineSelection`) are mocked
 * following the pattern in `InlineEditorInner.test.tsx`:
 *   - `ConfigurationSheet` exposes its `open` prop via `data-open`.
 *   - `SelectionOverlay` exposes the selected block id via `data-sel`
 *     (read off the injected `selectedEl`'s `data-puck-id`).
 *   - `usePuckStore.dispatch` is recorded so the re-targeted `itemSelector`
 *     index is observable.
 *
 * Generators
 * ----------
 *   - `ids`: a unique, non-empty registry of block ids; the mocked Puck
 *     `appState.data.content` is built from these so `indexOf` resolves.
 *   - `steps`: a sequence of selection actions, each either one of the known
 *     ids or `null` (clear) — covering select-A, select-B, clear, re-select.
 *
 * After each step we assert: sheet `open === (selectedId != null)`; the
 * indicator points at exactly the current id (cardinality ≤ 1); and on a
 * transition to a different non-null id the sheet stayed open and the
 * `itemSelector` re-targeted to that block's index.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import fc from "fast-check";

// --- Mutable holder shared with the hoisted mock factory ---------------------
const h = vi.hoisted(() => ({
  content: [] as Array<{ type: string; props: { id: string } }>,
  dispatchCalls: [] as Array<{ type: string; ui?: unknown }>,
}));

// --- Module-scope dependency stubs (keep the import light) -------------------
vi.mock("@/lib/page-builder/builder-shell/with-inline-richtext-menu", () => ({
  withInlineRichtextMenu: (config: unknown) => config,
}));
vi.mock("@/lib/page-builder/config", () => ({
  pageBuilderConfig: { components: {}, categories: {} },
}));

// --- Puck store: content driven by the holder + observable dispatch ----------
vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: unknown) => unknown) =>
    selector({
      appState: { data: { content: h.content, root: { props: {} } } },
      dispatch: (action: { type: string; ui?: unknown }) => {
        h.dispatchCalls.push(action);
      },
    }),
}));

// --- useInlineSelection: inert (we inject our own selection) -----------------
vi.mock("./useInlineSelection", () => ({
  useInlineSelection: () => ({
    selectedId: null,
    selectedEl: null,
    setSelectedId: () => {},
    setSelectedEl: () => {},
  }),
}));

// --- Floating UI children: expose the props the property observes ------------
vi.mock("./SelectionOverlay", () => ({
  SelectionOverlay: ({ selectedEl }: { selectedEl: HTMLElement | null }) => (
    <div
      data-testid="selection-overlay"
      data-sel={selectedEl?.getAttribute("data-puck-id") ?? ""}
    />
  ),
}));
vi.mock("./ConfigurationSheet", () => ({
  ConfigurationSheet: ({ open }: { open: boolean }) => (
    <div data-testid="config-sheet" data-open={open ? "true" : "false"} />
  ),
}));
vi.mock("./InlineSaveBar", () => ({
  InlineSaveBar: () => <div data-testid="save-bar" />,
}));

import { InlineEditorInner } from "./InlineEditorInner";
import type { InlineSelection } from "./useInlineSelection";

const baseData = { content: [], root: { props: {} } };

/** Build a controllable injected selection for a given selected id. */
function makeSelection(selectedId: string | null): InlineSelection {
  let selectedEl: HTMLElement | null = null;
  if (selectedId !== null) {
    selectedEl = document.createElement("div");
    selectedEl.setAttribute("data-puck-id", selectedId);
  }
  return {
    selectedId,
    selectedEl,
    setSelectedId: () => {},
    setSelectedEl: () => {},
  };
}

function Harness({ selectedId }: { selectedId: string | null }) {
  return (
    <InlineEditorInner
      pageId="page-1"
      initialData={baseData}
      onExit={() => {}}
      selection={makeSelection(selectedId)}
    />
  );
}

afterEach(() => cleanup());

// --- Generators --------------------------------------------------------------
const idArb = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /\S/.test(s));

const scenarioArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
  .chain((ids) =>
    fc.record({
      ids: fc.constant(ids),
      // Each step selects a known id or clears (null).
      steps: fc.array(fc.option(fc.constantFrom(...ids), { nil: null }), {
        minLength: 1,
        maxLength: 12,
      }),
    }),
  );

describe("Feature: live-page-editor — Property 4: Selection cardinality and sheet coupling", () => {
  it("sheet open iff a block is selected; re-targets to exactly one block without closing", () => {
    fc.assert(
      fc.property(scenarioArb, ({ ids, steps }) => {
        // Mocked Puck content for this scenario, so indexOf() resolves ids.
        h.content = ids.map((id) => ({ type: "Block", props: { id } }));
        h.dispatchCalls = [];

        // Baseline: nothing selected → sheet closed, no indicator.
        const { container, rerender } = render(<Harness selectedId={null} />);
        const sheet = () => container.querySelector('[data-testid="config-sheet"]')!;
        const overlay = () =>
          container.querySelector('[data-testid="selection-overlay"]')!;

        expect(sheet().getAttribute("data-open")).toBe("false");
        expect(overlay().getAttribute("data-sel")).toBe("");

        let prevId: string | null = null;
        for (const currentId of steps) {
          const before = h.dispatchCalls.length;
          rerender(<Harness selectedId={currentId} />);

          // (1) Sheet open iff a block is selected (Req 7.8 / 7.1).
          expect(sheet().getAttribute("data-open")).toBe(
            currentId !== null ? "true" : "false",
          );

          // (2) Cardinality ≤ 1: the indicator points at exactly the current
          //     block (or nothing). A single-valued selection can never mark
          //     two blocks at once.
          expect(overlay().getAttribute("data-sel")).toBe(currentId ?? "");

          // (3) Re-target on change to a different non-null block, without
          //     closing (Req 7.6 / 4.5). The effect only fires on id change.
          if (currentId !== null && currentId !== prevId) {
            const newCalls = h.dispatchCalls.slice(before);
            const setUi = newCalls.filter((c) => c.type === "setUi");
            expect(setUi.length).toBeGreaterThan(0);
            const last = setUi[setUi.length - 1] as {
              ui: { itemSelector: { index: number } };
            };
            // itemSelector re-targeted to exactly this block's content index.
            expect(last.ui.itemSelector.index).toBe(ids.indexOf(currentId));

            // If the sheet was already open (prev block selected), selecting a
            // different block keeps it open — never toggles closed.
            expect(sheet().getAttribute("data-open")).toBe("true");
          }

          prevId = currentId;
        }

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
