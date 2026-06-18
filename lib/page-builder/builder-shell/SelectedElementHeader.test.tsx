// @vitest-environment jsdom

/**
 * SelectedElementHeader — Puck dispatch wiring.
 *
 * Spec: custom-branded-page-builder — Requirements 4.3, 4.4, 4.5
 *
 * These tests verify task 6.2's contract: each ElementHeader action fires
 * the correct Puck dispatch call with the correct payload. We mock
 * `@puckeditor/core` at module boundary so the test does not need a full
 * Puck harness (DndKit, ResizeObserver, DropZone indexing) — the
 * container reads a handful of fields from `usePuck()` and calls
 * `dispatch(...)`, which is all we need to exercise.
 *
 * Anchor lookup: the container queries
 * `document.querySelector("[data-puck-component=...]")` to find the live
 * DOM anchor. We inject a matching element into `document.body` before
 * each assertion so the hook's retry loop resolves on the first rAF
 * tick. `ResizeObserver` is not present in jsdom, so we stub it — the
 * stub is shared with the wider shell tests and lives here locally so
 * this file is self-contained.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

// ── Stub ResizeObserver before anything renders ────────────────────────────
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver })
  .ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// ── usePuck mock ────────────────────────────────────────────────────────────

interface MockItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

interface MockPuckState {
  selectedItem: MockItem | null;
  appState: {
    data: {
      content: MockItem[];
      zones?: Record<string, MockItem[]>;
      root: { props: Record<string, unknown> };
    };
    ui: Record<string, unknown>;
  };
  config: {
    components: Record<string, { label?: string }>;
  };
  dispatch: ReturnType<typeof vi.fn>;
  getSelectorForId: (id: string) => { zone: string; index: number } | undefined;
}

const mockPuckState: MockPuckState = {
  selectedItem: null,
  appState: {
    data: {
      content: [],
      root: { props: {} },
    },
    ui: {},
  },
  config: { components: {} },
  dispatch: vi.fn(),
  getSelectorForId: () => undefined,
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => () => mockPuckState,
}));

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) => selector(mockPuckState),
}));

// Import after the mock — so the container picks up the mocked module.
const { SelectedElementHeader } = await import("./SelectedElementHeader");

// ── Helpers ─────────────────────────────────────────────────────────────────

const ROOT_ZONE = "root:default-zone";

/**
 * Seed the mock Puck state with a tiny two-block page so selection at
 * index 0/1 exercises the `canMoveUp`/`canMoveDown` flags.
 *
 * `selectedIndex` picks which of the two blocks is "selected" — the
 * container reads selection via `selectedItem` and resolves the selector
 * via `getSelectorForId`, so we keep both aligned.
 */
function seed(selectedIndex: 0 | 1) {
  const items: MockItem[] = [
    { type: "Heading", props: { id: "heading-1", text: "First" } },
    { type: "Text", props: { id: "text-2", content: "Second" } },
  ];
  mockPuckState.selectedItem = items[selectedIndex];
  mockPuckState.appState.data.content = items;
  mockPuckState.appState.data.zones = {};
  mockPuckState.config.components = {
    Heading: { label: "Heading" },
    Text: { label: "Text" },
  };
  mockPuckState.dispatch = vi.fn();
  mockPuckState.getSelectorForId = (id: string) => {
    const index = items.findIndex((item) => item.props.id === id);
    if (index < 0) return undefined;
    return { zone: ROOT_ZONE, index };
  };
}

/**
 * Mount a DOM anchor matching the selected item's `data-puck-component`
 * attribute so the container's effect finds it. Returns the element so
 * tests can read its bounding rect if needed.
 */
function mountAnchor(itemId: string): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-puck-component", itemId);
  el.style.width = "200px";
  el.style.height = "40px";
  document.body.appendChild(el);
  return el;
}

/**
 * Flush the anchor-lookup effect + its internal rAF tick so the button
 * handlers are attached in the rendered toolbar.
 */
async function flushAnchorLookup() {
  await act(async () => {
    // One rAF for the retry loop, one microtask for React to commit.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SelectedElementHeader — Puck dispatch wiring", () => {
  beforeEach(() => {
    // Clear any lingering anchor nodes from a previous test. We target only
    // the `[data-puck-component]` elements rather than wiping
    // `document.body.innerHTML`, because wiping innerHTML removes the
    // portal root that React 19's commit phase still holds a reference to
    // — the next render's cleanup then throws `NotFoundError: The node to
    // be removed is not a child of this node`. Scoping the cleanup to the
    // anchors keeps the portal tree intact so RTL's auto-cleanup can
    // unmount safely.
    for (const el of Array.from(
      document.querySelectorAll("[data-puck-component]"),
    )) {
      el.remove();
    }
    // Also remove any lingering header portals left by a previous test
    // that rendered but whose cleanup was skipped (for instance a
    // `render()` that ran before `renderHook` threw).
    for (const el of Array.from(
      document.querySelectorAll("[data-element-header]"),
    )) {
      el.remove();
    }
  });

  it("dispatches `setData` with a deep-cloned, freshly-id'd copy after the selected block when Duplicate is activated (Req 4.3)", async () => {
    seed(0);
    mountAnchor("heading-1");
    const { getByRole } = render(<SelectedElementHeader />);
    await flushAnchorLookup();

    fireEvent.click(getByRole("button", { name: /duplicate heading/i }));

    const calls = mockPuckState.dispatch.mock.calls;
    // Expect two dispatches: setData (insert the clone) → setUi (select it).
    expect(calls.length).toBe(2);

    const [setDataCall] = calls;
    expect(setDataCall[0].type).toBe("setData");

    // The copy is inserted immediately after the source at root index 1, and
    // the original content is preserved (3 blocks total).
    const content = setDataCall[0].data.content as Array<{
      type: string;
      props: { id: string; text?: string };
    }>;
    expect(content).toHaveLength(3);
    expect(content[0].props.id).toBe("heading-1");
    expect(content[2].props.id).toBe("text-2");

    const copy = content[1];
    expect(copy.type).toBe("Heading");
    // Fresh id — NOT a mirror of the source.
    expect(copy.props.id).not.toBe("heading-1");
    expect(typeof copy.props.id).toBe("string");
    // Props are carried over (deep-cloned).
    expect(copy.props.text).toBe("First");

    // Selection moves to the new copy so follow-up edits target it.
    const [, setUiCall] = calls;
    expect(setUiCall[0]).toMatchObject({
      type: "setUi",
      ui: { itemSelector: { zone: ROOT_ZONE, index: 1 } },
    });
  });

  it("dispatches `remove` with the selected block's zone and index when Delete is activated (Req 4.4)", async () => {
    seed(1);
    mountAnchor("text-2");
    const { getByRole } = render(<SelectedElementHeader />);
    await flushAnchorLookup();

    fireEvent.click(getByRole("button", { name: /delete text/i }));

    expect(mockPuckState.dispatch).toHaveBeenCalledTimes(1);
    expect(mockPuckState.dispatch).toHaveBeenCalledWith({
      type: "remove",
      index: 1,
      zone: ROOT_ZONE,
    });
  });

  it("dispatches `reorder` with sourceIndex − 1 when Move up is activated (Req 4.5)", async () => {
    seed(1);
    mountAnchor("text-2");
    const { getByRole } = render(<SelectedElementHeader />);
    await flushAnchorLookup();

    fireEvent.click(getByRole("button", { name: /^move text up$/i }));

    const calls = mockPuckState.dispatch.mock.calls;
    // Expect reorder followed by setUi so selection follows the moved
    // block (otherwise the toolbar would jump to whatever sits at the
    // old index after the swap).
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toMatchObject({
      type: "reorder",
      sourceIndex: 1,
      destinationIndex: 0,
      destinationZone: ROOT_ZONE,
    });
    expect(calls[1][0]).toMatchObject({
      type: "setUi",
      ui: { itemSelector: { zone: ROOT_ZONE, index: 0 } },
    });
  });

  it("dispatches `reorder` with sourceIndex + 1 when Move down is activated (Req 4.5)", async () => {
    seed(0);
    mountAnchor("heading-1");
    const { getByRole } = render(<SelectedElementHeader />);
    await flushAnchorLookup();

    fireEvent.click(getByRole("button", { name: /^move heading down$/i }));

    const calls = mockPuckState.dispatch.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toMatchObject({
      type: "reorder",
      sourceIndex: 0,
      destinationIndex: 1,
      destinationZone: ROOT_ZONE,
    });
    expect(calls[1][0]).toMatchObject({
      type: "setUi",
      ui: { itemSelector: { zone: ROOT_ZONE, index: 1 } },
    });
  });

  it("does not dispatch Move up when the selection is at index 0 (Req 4.5 / Req 4.6 boundary)", async () => {
    seed(0);
    mountAnchor("heading-1");
    const { getByRole } = render(<SelectedElementHeader />);
    await flushAnchorLookup();

    // The button is disabled at the zone's upper boundary, so clicking is
    // a no-op. The `disabled` native attribute blocks the React synthetic
    // click, but we also assert no dispatch fires as a belt-and-braces
    // check in case a future refactor swaps to `aria-disabled` only.
    const moveUp = getByRole("button", { name: /^move heading up$/i });
    expect(moveUp.hasAttribute("disabled")).toBe(true);
    fireEvent.click(moveUp);
    expect(mockPuckState.dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch Move down when the selection is at the last index (Req 4.5 / Req 4.6 boundary)", async () => {
    seed(1);
    mountAnchor("text-2");
    const { getByRole } = render(<SelectedElementHeader />);
    await flushAnchorLookup();

    const moveDown = getByRole("button", { name: /^move text down$/i });
    expect(moveDown.hasAttribute("disabled")).toBe(true);
    fireEvent.click(moveDown);
    expect(mockPuckState.dispatch).not.toHaveBeenCalled();
  });

  it("renders nothing when no block is selected", () => {
    mockPuckState.selectedItem = null;
    const { container } = render(<SelectedElementHeader />);
    expect(container.firstChild).toBeNull();
    expect(mockPuckState.dispatch).not.toHaveBeenCalled();
  });
});
