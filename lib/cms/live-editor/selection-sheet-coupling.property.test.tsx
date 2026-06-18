// @vitest-environment jsdom
/**
 * Selection cardinality and sheet coupling — Property 4.
 *
 * Spec: live-page-editor — task 8.2
 * _Validates: Requirements 4.5, 7.6, 7.8_
 *
 * For any sequence of selection actions:
 *   1. At most one block is the Selected_Block at a time (selection state holds
 *      a single id or null) (Req 4.5).
 *   2. The Configuration_Sheet is open IFF a block is selected; when no block is
 *      selected the sheet is closed and the selection indicator is hidden
 *      (Req 7.8).
 *   3. Selecting a different block while the sheet is open moves the selection
 *      (and the visible indicator) to exactly the newly selected block WITHOUT
 *      closing the sheet (Req 7.6).
 *
 * This drives the *actual* selection → sheet wiring: a real `useInlineSelection`
 * state container (mounted inert, exactly as `LiveEditorShell` mounts it) feeds
 * the shared `InlineEditorInner`, whose open/close/re-target effect is the thing
 * under test. The Puck store and the leaf Editor_UI components are replaced with
 * thin observable doubles so the coupling logic — not Puck internals or
 * animation — is what's exercised.
 *
 * Tag: Feature: live-page-editor, Property 4: Selection cardinality and sheet
 * coupling — at most one Selected_Block at a time; Configuration_Sheet open iff
 * a block is selected; selecting a different block while open moves
 * selection/indicator without closing.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks — isolate the selection→sheet coupling logic in InlineEditorInner.
// ---------------------------------------------------------------------------

// A stable headless-Puck store double. `appState.data.content` mirrors the
// generated blocks so the inner's `indexOf`/`labelFor` resolve, and `dispatch`
// just records the `setUi` itemSelector re-targets the coupling effect issues.
const puckMock = vi.hoisted(() => ({
  appState: { data: { content: [] as Array<{ type: string; props: { id: string } }>, root: { props: {} } } },
  dispatch: vi.fn(),
}));

vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: { appState: unknown; dispatch: unknown }) => unknown) =>
    selector({ appState: puckMock.appState, dispatch: puckMock.dispatch }),
}));

// ConfigurationSheet double: renders a marker IFF `open` is true, so the test
// can observe the open/closed state directly from the wiring's `sheetOpen`.
vi.mock("@/lib/cms/inline-editor/ConfigurationSheet", () => ({
  ConfigurationSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="config-sheet" /> : null,
}));

// SelectionOverlay double: renders the indicator (carrying the selected block's
// id) IFF a `selectedEl` is present, so the test can observe indicator
// presence/identity and its hidden state when nothing is selected.
vi.mock("@/lib/cms/inline-editor/SelectionOverlay", () => ({
  SelectionOverlay: ({
    selectedEl,
  }: {
    selectedEl: HTMLElement | null;
    selectedLabel: string | null;
    onEdit: () => void;
  }) =>
    selectedEl ? (
      <div
        data-testid="selection-indicator"
        data-sel={selectedEl.getAttribute("data-puck-id") ?? ""}
      />
    ) : null,
}));

// SaveBar is irrelevant to Property 4 — stub it out entirely.
vi.mock("@/lib/cms/inline-editor/InlineSaveBar", () => ({
  InlineSaveBar: () => <div data-testid="save-bar" />,
}));

import { InlineEditorInner } from "@/lib/cms/inline-editor/InlineEditorInner";
import {
  useInlineSelection,
  type InlineSelection,
} from "@/lib/cms/inline-editor/useInlineSelection";

// ---------------------------------------------------------------------------
// Harness — mirrors LiveEditorShell's inert-selection wiring.
// ---------------------------------------------------------------------------

let selectionApi: InlineSelection | null = null;

function Harness(): React.ReactElement {
  // Mounted inert (`active=false`) exactly like LiveEditorShell: the test drives
  // selections through `setSelected`, standing in for the Navigation_Neutralizer.
  const selection = useInlineSelection(false);
  selectionApi = selection;
  return (
    <InlineEditorInner
      pageId="page-1"
      initialData={puckMock.appState.data as never}
      selection={selection}
      onPermissionRevoked={() => {}}
      onExit={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  selectionApi = null;
  puckMock.dispatch.mockClear();
});

// ---------------------------------------------------------------------------
// Generators — a sequence of selection actions over a fixed set of blocks.
// ---------------------------------------------------------------------------

type Action = { kind: "select"; index: number } | { kind: "none" };

const scenarioArb = fc
  .integer({ min: 2, max: 5 })
  .chain((blockCount) =>
    fc.record({
      blockCount: fc.constant(blockCount),
      actions: fc.array(
        fc.oneof(
          fc.record({
            kind: fc.constant<"select">("select"),
            index: fc.integer({ min: 0, max: blockCount - 1 }),
          }),
          fc.record({ kind: fc.constant<"none">("none") }),
        ),
        { minLength: 1, maxLength: 12 },
      ),
    }),
  );

describe("Feature: live-page-editor — Property 4: Selection cardinality and sheet coupling", () => {
  it("keeps at most one selection, opens the sheet iff a block is selected, and re-targets without closing", () => {
    fc.assert(
      fc.property(scenarioArb, ({ blockCount, actions }) => {
        // --- build the block DOM + matching Puck content -------------------
        const blockIds = Array.from({ length: blockCount }, (_, i) => `block-${i}`);
        const container = document.createElement("div");
        document.body.appendChild(container);

        const blockEls = blockIds.map((id) => {
          const el = document.createElement("div");
          el.setAttribute("data-puck-id", id);
          container.appendChild(el);
          return el;
        });

        // Seed the Puck store content so indexOf/labelFor resolve real indices.
        puckMock.appState.data.content = blockIds.map((id) => ({
          type: "Heading",
          props: { id },
        }));

        const view = render(<Harness />);

        // Helper queries against the live DOM (config sheet + overlay portals
        // render under document.body via the doubles).
        const sheetOpen = () =>
          document.querySelectorAll('[data-testid="config-sheet"]').length;
        const indicators = () =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="selection-indicator"]',
            ),
          );

        try {
          // Initial state: nothing selected → sheet closed, indicator hidden.
          expect(sheetOpen()).toBe(0);
          expect(indicators().length).toBe(0);

          let expectedId: string | null = null;

          for (const action of actions) {
            const wasOpen = expectedId !== null;
            const prevId = expectedId;

            act(() => {
              if (action.kind === "none") {
                selectionApi!.setSelected(null, null);
                expectedId = null;
              } else {
                selectionApi!.setSelected(
                  blockIds[action.index],
                  blockEls[action.index],
                );
                expectedId = blockIds[action.index];
              }
            });

            // (1) Cardinality: the state container holds exactly one id (or
            //     null) and the overlay renders at most one indicator.
            expect(selectionApi!.selectedId).toBe(expectedId);
            expect(indicators().length).toBeLessThanOrEqual(1);

            if (expectedId === null) {
              // (2) No block selected → sheet closed AND indicator hidden
              //     (Req 7.8).
              expect(sheetOpen()).toBe(0);
              expect(indicators().length).toBe(0);
            } else {
              // (2) A block is selected → sheet open and the single indicator
              //     points at exactly the selected block.
              expect(sheetOpen()).toBe(1);
              const ind = indicators();
              expect(ind.length).toBe(1);
              expect(ind[0].getAttribute("data-sel")).toBe(expectedId);

              // (3) Selecting a *different* block while the sheet was already
              //     open keeps it open and moves the indicator to the new block
              //     without closing (Req 7.6).
              if (wasOpen && prevId !== expectedId) {
                expect(sheetOpen()).toBe(1);
                expect(ind[0].getAttribute("data-sel")).toBe(expectedId);
                expect(ind[0].getAttribute("data-sel")).not.toBe(prevId);
              }
            }
          }
        } finally {
          view.unmount();
          container.remove();
        }
      }),
      { numRuns: 100 },
    );
  });
});
