// @vitest-environment jsdom
/**
 * InlineEditorInner — Configuration_Sheet open / edit / close / validation.
 *
 * Spec: live-page-editor — task 8.3
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
 *
 * These are EXAMPLE tests (not property-based). They exercise the
 * selection → Configuration_Sheet coupling and the property-commit path that
 * `InlineEditorInner` wires — the single source of truth for selection→sheet
 * wiring consumed by the live editor shell (task 8.1).
 *
 * Coverage:
 *   - open-on-select (Req 7.1): selecting a block opens the Configuration_Sheet
 *     after the effect flush (the "within 200ms" budget is satisfied because the
 *     open is committed synchronously in the selection effect, no timer).
 *   - selection indicator + panel (Req 7.2, 7.3): selecting a block surfaces the
 *     selected element/label to `SelectionOverlay` and mounts the
 *     `ConfigurationSheet` (which wraps the Puck `ConfigurationPanel`).
 *   - edit commit (Req 7.4): the inner re-targets Puck's `itemSelector` to the
 *     Selected_Block so edits apply to it, and a committed edit (a new
 *     `appState.data`) flows to the save bar as the to-be-persisted data and
 *     flips the dirty indicator.
 *   - close-retains-selection (Req 7.7): closing the Configuration_Sheet leaves
 *     the current selection + indicator intact, does not re-open the sheet, and
 *     does not navigate (never calls `onExit`).
 *   - validation rejection (Req 7.5): the boundary the inner owns is that it
 *     persists ONLY committed `appState.data`; a rejected edit (Puck does not
 *     mutate `appState.data`) leaves the block's prior data unchanged and the
 *     editor un-dirtied. The failing-field flagging itself is delegated to the
 *     Puck `ConfigurationPanel`/field layer per design (Error Handling, Req 7.5).
 *
 * Mocks reuse the established setup from `InlineEditorInner.test.tsx`
 * (usePuckStore, useInlineSelection, SelectionOverlay, ConfigurationSheet,
 * InlineSaveBar) and make `ConfigurationSheet`'s `open`/`onClose` observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// --- Module-scope dependency stubs (keep the import light) -------------------
vi.mock("@/lib/page-builder/builder-shell/with-inline-richtext-menu", () => ({
  withInlineRichtextMenu: (config: unknown) => config,
}));
vi.mock("@/lib/page-builder/config", () => ({
  pageBuilderConfig: { components: {}, categories: {} },
}));

// --- Puck store: a mutable app state + spy dispatch the tests can drive -------
// `vi.hoisted` lets the mock factory (hoisted above the imports) share a mutable
// store the test body can re-seed per case to simulate committed / rejected edits.
const hoisted = vi.hoisted(() => {
  const makeData = () => ({
    content: [{ type: "Hero", props: { id: "blk-1", title: "Old title" } }],
    root: { props: {} },
  });
  return {
    makeData,
    state: { appState: { data: makeData() }, dispatch: vi.fn() },
  };
});

vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: unknown) => unknown) => selector(hoisted.state),
}));

// --- Selection: inert hook (the live shell injects selection via the prop) ----
vi.mock("./useInlineSelection", () => ({
  useInlineSelection: () => ({
    selectedId: null,
    selectedEl: null,
    setSelectedId: () => {},
    setSelectedEl: () => {},
  }),
}));

// --- Floating UI children: observable stubs ----------------------------------
vi.mock("./SelectionOverlay", () => ({
  SelectionOverlay: ({
    selectedEl,
    selectedLabel,
  }: {
    selectedEl: HTMLElement | null;
    selectedLabel: string | null;
  }) => (
    <div
      data-testid="selection-overlay"
      data-has-el={selectedEl ? "true" : "false"}
      data-label={selectedLabel ?? ""}
    />
  ),
}));

// ConfigurationSheet stub exposes `open` and an observable `onClose` trigger.
vi.mock("./ConfigurationSheet", () => ({
  ConfigurationSheet: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (
    <div data-testid="config-sheet" data-open={open ? "true" : "false"}>
      <button type="button" data-testid="config-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

// InlineSaveBar stub exposes the dirty flag and the data it would persist.
vi.mock("./InlineSaveBar", () => ({
  InlineSaveBar: ({
    dirty,
    data,
  }: {
    dirty: boolean;
    data: unknown;
  }) => (
    <div
      data-testid="save-bar"
      data-dirty={dirty ? "true" : "false"}
      data-content={JSON.stringify(data)}
    />
  ),
}));

import { InlineEditorInner } from "./InlineEditorInner";
import type { InlineSelection } from "./useInlineSelection";

function makeSelection(
  selectedId: string | null,
  selectedEl: HTMLElement | null,
): InlineSelection {
  return {
    selectedId,
    selectedEl,
    setSelectedId: vi.fn(),
    setSelectedEl: vi.fn(),
  };
}

/**
 * Render the inner with `initialData` pinned to the current mocked
 * `appState.data` (same reference) so the data-mirror effect starts clean
 * (not dirty) — a committed edit is then simulated by re-seeding the store.
 */
function renderInner(
  selection: InlineSelection,
  onExit: () => void = () => {},
) {
  return render(
    <InlineEditorInner
      pageId="page-1"
      initialData={hoisted.state.appState.data}
      onExit={onExit}
      selection={selection}
    />,
  );
}

beforeEach(() => {
  hoisted.state.appState = { data: hoisted.makeData() };
  hoisted.state.dispatch = vi.fn();
});

afterEach(() => cleanup());

describe("Feature: live-page-editor — config open-on-select (Req 7.1, 7.2, 7.3)", () => {
  it("keeps the sheet closed and the overlay empty while nothing is selected", () => {
    renderInner(makeSelection(null, null));

    expect(screen.getByTestId("config-sheet").getAttribute("data-open")).toBe(
      "false",
    );
    expect(
      screen.getByTestId("selection-overlay").getAttribute("data-has-el"),
    ).toBe("false");
  });

  it("opens the Configuration_Sheet and shows the indicator when a block is selected", () => {
    const el = document.createElement("div");
    el.setAttribute("data-puck-id", "blk-1");
    const { rerender } = renderInner(makeSelection(null, null));

    // Start with no selection: sheet closed.
    expect(screen.getByTestId("config-sheet").getAttribute("data-open")).toBe(
      "false",
    );

    // Select a block — the selection effect opens the sheet synchronously.
    rerender(
      <InlineEditorInner
        pageId="page-1"
        initialData={hoisted.state.appState.data}
        onExit={() => {}}
        selection={makeSelection("blk-1", el)}
      />,
    );

    // Req 7.1: sheet opens on select (no timer; committed in the effect).
    expect(screen.getByTestId("config-sheet").getAttribute("data-open")).toBe(
      "true",
    );
    // Req 7.2: the selection indicator targets the selected element + label.
    const overlay = screen.getByTestId("selection-overlay");
    expect(overlay.getAttribute("data-has-el")).toBe("true");
    expect(overlay.getAttribute("data-label")).toBe("Hero");
  });
});

describe("Feature: live-page-editor — edit commit (Req 7.4)", () => {
  it("re-targets the Puck itemSelector to the Selected_Block", () => {
    const el = document.createElement("div");
    renderInner(makeSelection("blk-1", el));

    // Edits in the ConfigurationPanel apply to whatever itemSelector targets;
    // the inner points it at the Selected_Block's content index (0 here).
    expect(hoisted.state.dispatch).toHaveBeenCalledWith({
      type: "setUi",
      ui: { itemSelector: { index: 0 } },
    });
  });

  it("flows a committed edit to the save bar and flips the dirty indicator", () => {
    const el = document.createElement("div");
    const { rerender } = renderInner(makeSelection("blk-1", el));

    // Clean to start: the persisted data matches the loaded block data.
    const saveBar = screen.getByTestId("save-bar");
    expect(saveBar.getAttribute("data-dirty")).toBe("false");
    expect(saveBar.getAttribute("data-content")).toContain("Old title");

    // Simulate a committed property edit: Puck produces a NEW appState.data
    // with the edited value on the Selected_Block.
    hoisted.state.appState = {
      data: {
        content: [
          { type: "Hero", props: { id: "blk-1", title: "New title" } },
        ],
        root: { props: {} },
      },
    };
    rerender(
      <InlineEditorInner
        pageId="page-1"
        initialData={hoisted.state.appState.data}
        onExit={() => {}}
        selection={makeSelection("blk-1", el)}
      />,
    );

    // Req 7.4: the edited value is committed to the data the editor will save,
    // and the unsaved-changes indication turns on.
    const after = screen.getByTestId("save-bar");
    expect(after.getAttribute("data-content")).toContain("New title");
    expect(after.getAttribute("data-content")).not.toContain("Old title");
    expect(after.getAttribute("data-dirty")).toBe("true");
  });
});

describe("Feature: live-page-editor — close retains selection (Req 7.7)", () => {
  it("closes the sheet but keeps the selection + indicator and does not navigate", () => {
    const el = document.createElement("div");
    const onExit = vi.fn();
    renderInner(makeSelection("blk-1", el), onExit);

    // Open on select.
    expect(screen.getByTestId("config-sheet").getAttribute("data-open")).toBe(
      "true",
    );

    // Close the Configuration_Sheet.
    fireEvent.click(screen.getByTestId("config-close"));

    // Sheet is closed...
    expect(screen.getByTestId("config-sheet").getAttribute("data-open")).toBe(
      "false",
    );
    // ...selection + indicator are retained (still pointing at the block)...
    const overlay = screen.getByTestId("selection-overlay");
    expect(overlay.getAttribute("data-has-el")).toBe("true");
    expect(overlay.getAttribute("data-label")).toBe("Hero");
    // ...and closing never navigates away.
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe("Feature: live-page-editor — validation rejection (Req 7.5)", () => {
  it("retains prior block data when an edit is rejected (not committed to appState.data)", () => {
    const el = document.createElement("div");
    const { rerender } = renderInner(makeSelection("blk-1", el));

    const before = screen.getByTestId("save-bar");
    expect(before.getAttribute("data-dirty")).toBe("false");
    expect(before.getAttribute("data-content")).toContain("Old title");

    // A property edit that fails validation is rejected by the Puck field layer,
    // so `appState.data` is NOT mutated (same reference, prior value retained).
    // The failing-field message is surfaced by the ConfigurationPanel itself;
    // the boundary the inner owns is that nothing invalid reaches the saved data.
    rerender(
      <InlineEditorInner
        pageId="page-1"
        initialData={hoisted.state.appState.data}
        onExit={() => {}}
        selection={makeSelection("blk-1", el)}
      />,
    );

    const after = screen.getByTestId("save-bar");
    // Prior data retained, editor stays clean — the rejected value never commits.
    expect(after.getAttribute("data-content")).toContain("Old title");
    expect(after.getAttribute("data-content")).not.toContain("New title");
    expect(after.getAttribute("data-dirty")).toBe("false");
  });
});
