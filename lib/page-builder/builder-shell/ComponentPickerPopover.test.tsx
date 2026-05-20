// @vitest-environment jsdom

/**
 * ComponentPickerPopover — unit tests.
 *
 * Spec: builder-outline-tree-and-toolbar — Task 7.4
 * _Requirements: 5.1, 5.6, 5.7, 5.8, 5.9, 5.10_
 *
 * The popover is portal-rendered to `document.body`, reads the Puck
 * config + data slices via `usePuckStore`, and wires several behaviours
 * that we exercise here at the public-API surface:
 *
 *   1. Renders categorized component groups in the palette's fixed order
 *      (Req 5.1)
 *   2. Filters components by label/description with case-insensitive
 *      substring matching, applied per-keystroke (Req 5.6)
 *   3. Shows the zero-results message and suppresses category headings
 *      when the filter is empty (Req 5.7)
 *   4. Honours zone constraints — a `disallow` array on the owner's slot
 *      field strips that type from the picker even if it appears in the
 *      palette categories (Req 5.9)
 *   5. Closes on Escape (Req 5.8)
 *   6. Closes on click-outside (Req 5.8)
 *   7. Calls `onInsert` with the correct component type when an item is
 *      activated (Req 5.1, 5.3 path)
 *   8. Traps focus so Tab from the last focusable wraps to the first and
 *      Shift+Tab from the first wraps to the last (Req 5.10)
 *
 * ── Mocking strategy ──────────────────────────────────────────────────
 *
 * The popover does NOT depend on `useInsertion` (the parent owns the
 * dispatch flow). It only needs:
 *   - `usePuckStore((s) => s.config)` for components + categories +
 *     (optional) slot fields used by `resolveZoneConstraints`.
 *   - `usePuckStore((s) => s.appState.data)` for the page tree —
 *     required for non-root zones so `resolveZoneConstraints` can
 *     locate the owner component.
 *
 * We mock the store at the module boundary so the popover sees a
 * deterministic snapshot per test, without standing up a real Puck
 * harness.
 *
 * ── jsdom focus-trap caveat ───────────────────────────────────────────
 *
 * The popover's `getFocusableElements` filters out nodes whose
 * `offsetParent` is null (a "hidden subtree" probe that works in real
 * browsers). jsdom returns `null` for every element's `offsetParent`,
 * which would collapse the focusable list to just the currently-active
 * element and hide the trap behaviour we want to test. We restore the
 * usable contract by patching `HTMLElement.prototype.offsetParent` to
 * return the element's `parentNode` while these tests run, then
 * unpatch in `afterEach` so other suites are unaffected.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// ─── Mock the Puck store ─────────────────────────────────────────────────────
//
// `mockPuckState` is mutable so each test can install the fixture it
// needs. We mirror the selector contract `(state) => state[slice]` so
// existing call sites in the popover continue to work.

interface MockPuckState {
  config: {
    components: Record<
      string,
      {
        label?: string;
        fields?: Record<string, unknown>;
      }
    >;
    categories?: Record<string, { title?: string; components?: string[] }>;
  };
  appState: {
    data: {
      content: Array<{ type: string; props: Record<string, unknown> }>;
      zones: Record<
        string,
        Array<{ type: string; props: Record<string, unknown> }>
      >;
    };
  };
}

let mockPuckState: MockPuckState;

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

// Import the component after the mock is registered so it picks up the
// mocked `usePuckStore`. Using a top-level dynamic import keeps the
// import order explicit.
const { ComponentPickerPopover } = await import("./ComponentPickerPopover");

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const ROOT_ZONE = "root:default-zone";

/**
 * Default fixture: a Puck config that mirrors the three fixed palette
 * categories with a few components per group. Every test starts from
 * this shape and overrides only what it needs.
 */
function makeDefaultPuckState(): MockPuckState {
  return {
    config: {
      components: {
        Heading: { label: "Heading" },
        Text: { label: "Text" },
        Section: { label: "Section" },
        Image: { label: "Image" },
      },
      categories: {
        layout: { title: "Layout", components: ["Section"] },
        blocks: { title: "Blocks", components: ["Heading", "Text"] },
        components: { title: "Components", components: ["Image"] },
      },
    },
    appState: {
      data: { content: [], zones: {} },
    },
  };
}

/**
 * Create a real anchor element attached to the document body so layout
 * effects run (the popover only reads `getBoundingClientRect`, which
 * jsdom returns as a zero rect — that's fine, the popover still mounts
 * and computes a position from it).
 */
function makeAnchor(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Anchor";
  document.body.appendChild(button);
  return button;
}

/**
 * Render the popover with sensible defaults. Returns the spies so tests
 * can assert on `onInsert` / `onClose` calls and the anchor for any
 * post-render DOM manipulation.
 */
function renderPopover(
  overrides: Partial<{
    zone: string;
    index: number;
    anchorEl: HTMLElement;
  }> = {},
) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const anchorEl = overrides.anchorEl ?? makeAnchor();
  const zone = overrides.zone ?? ROOT_ZONE;
  const index = overrides.index ?? 0;

  const utils = render(
    <ComponentPickerPopover
      anchorEl={anchorEl}
      zone={zone}
      index={index}
      onInsert={onInsert}
      onClose={onClose}
    />,
  );

  return { ...utils, onInsert, onClose, anchorEl };
}

// ─── jsdom offsetParent shim ─────────────────────────────────────────────────
//
// jsdom returns null for every element's `offsetParent`, which would
// hide every focusable from the popover's `getFocusableElements` helper.
// We restore the real-browser contract by returning the parent node, so
// the focus-trap tests can observe the real cycle.

let originalOffsetParentDescriptor: PropertyDescriptor | undefined;

function patchOffsetParent() {
  originalOffsetParentDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetParent",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentNode as Element | null;
    },
  });
}

function restoreOffsetParent() {
  if (originalOffsetParentDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetParent",
      originalOffsetParentDescriptor,
    );
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .offsetParent;
  }
  originalOffsetParentDescriptor = undefined;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ComponentPickerPopover", () => {
  beforeEach(() => {
    mockPuckState = makeDefaultPuckState();
    patchOffsetParent();
  });

  afterEach(() => {
    restoreOffsetParent();
    // Note: we deliberately do NOT clear `document.body` here —
    // testing-library auto-cleanup unmounts the portal-rendered popover,
    // and a manual `innerHTML = ""` would race with that unmount and
    // throw "node to be removed is not a child of this node".
  });

  // ── Req 5.1: grouped rendering matches palette categories ─────────────
  describe("grouped rendering (Req 5.1)", () => {
    it("renders categories in the fixed Layout → Blocks → Components order with their components", () => {
      renderPopover();

      // The popover roots in a portal under document.body — testing-library
      // queries `screen` walks the entire document so we can find it.
      const popover = screen.getByTestId("ora-component-picker-popover");
      expect(popover).toBeDefined();

      // Category headings appear in the configured order. We pull the
      // visible <h3> text and assert the sequence directly: drift in
      // ordering would surface here even if every component still
      // renders.
      const headings = Array.from(
        popover.querySelectorAll("h3"),
      ).map((h) => h.textContent);
      expect(headings).toEqual(["Layout", "Blocks", "Components"]);

      // Each registered component lands in its category — we verify the
      // exact set rather than just `>= 1` count so a regression that
      // misroutes a component (e.g., dumps everything into "Other")
      // would fail here.
      const items = screen.getAllByTestId("ora-component-picker-item");
      const types = items
        .map((el) => el.getAttribute("data-component-type"))
        .filter((v): v is string => v !== null);
      expect(new Set(types)).toEqual(
        new Set(["Section", "Heading", "Text", "Image"]),
      );
    });

    it("falls back to an 'Other' category for components not in any configured category", () => {
      // Components registered in `config.components` but absent from any
      // category bucket land in the trailing "Other" group. This is the
      // documented backstop in the popover's grouping pipeline.
      mockPuckState.config.components.LooseBlock = { label: "LooseBlock" };

      renderPopover();
      const popover = screen.getByTestId("ora-component-picker-popover");

      const headings = Array.from(
        popover.querySelectorAll("h3"),
      ).map((h) => h.textContent);
      expect(headings).toEqual(["Layout", "Blocks", "Components", "Other"]);

      const looseItem = popover.querySelector(
        '[data-component-type="LooseBlock"]',
      );
      expect(looseItem).not.toBeNull();
    });
  });

  // ── Req 5.6: case-insensitive substring search ────────────────────────
  describe("search filtering (Req 5.6)", () => {
    it("filters by label using case-insensitive substring matching", () => {
      renderPopover();

      const search = screen.getByTestId(
        "ora-component-picker-search",
      ) as HTMLInputElement;
      // Mixed case input + lowercase + uppercase fragments all reach the
      // same target — the matcher lowercases both sides.
      fireEvent.change(search, { target: { value: "head" } });

      const remaining = screen.getAllByTestId("ora-component-picker-item");
      const types = remaining.map((el) =>
        el.getAttribute("data-component-type"),
      );
      expect(types).toEqual(["Heading"]);
    });

    it("filters by description using case-insensitive substring matching", () => {
      // The Heading entry in palette-meta has the description
      // "Titles from H1 to H6 with ORA typography presets." — a search
      // for "typography" matches via description even though no label
      // contains that token.
      renderPopover();

      const search = screen.getByTestId(
        "ora-component-picker-search",
      ) as HTMLInputElement;
      fireEvent.change(search, { target: { value: "TYPOGRAPHY" } });

      const remaining = screen.getAllByTestId("ora-component-picker-item");
      const types = remaining.map((el) =>
        el.getAttribute("data-component-type"),
      );
      expect(types).toEqual(["Heading"]);
    });

    it("clears the filter when the query is reset to empty", () => {
      renderPopover();

      const search = screen.getByTestId(
        "ora-component-picker-search",
      ) as HTMLInputElement;
      fireEvent.change(search, { target: { value: "head" } });
      // Establish the filtered baseline …
      expect(screen.getAllByTestId("ora-component-picker-item")).toHaveLength(
        1,
      );
      fireEvent.change(search, { target: { value: "" } });
      // … and then verify resetting to "" restores the unfiltered set.
      expect(screen.getAllByTestId("ora-component-picker-item")).toHaveLength(
        4,
      );
    });
  });

  // ── Req 5.7: zero-results state ───────────────────────────────────────
  describe("zero-results state (Req 5.7)", () => {
    it("shows the empty message and hides every category heading when nothing matches", () => {
      renderPopover();

      const search = screen.getByTestId(
        "ora-component-picker-search",
      ) as HTMLInputElement;
      fireEvent.change(search, {
        target: { value: "xyznosuchcomponent" },
      });

      // The empty state renders by data-testid; its visible text doubles
      // as the accessible message (no aria-label needed).
      const empty = screen.getByTestId("ora-component-picker-empty");
      expect(empty).toBeDefined();
      expect(empty.textContent).toBe("No components match");

      // Per the design: empty groups are skipped entirely so no <h3>
      // headings reach the DOM and no `<ul>` items survive the filter.
      const popover = screen.getByTestId("ora-component-picker-popover");
      expect(popover.querySelectorAll("h3").length).toBe(0);
      expect(
        popover.querySelectorAll('[data-testid="ora-component-picker-item"]')
          .length,
      ).toBe(0);
    });
  });

  // ── Req 5.9: zone-constraint filtering ────────────────────────────────
  describe("zone constraints (Req 5.9)", () => {
    it("strips `disallow` types from the picker for a slot zone", () => {
      // Set up a slot field on Section that disallows Heading. Place a
      // Section instance in `data.content` so `resolveZoneConstraints`
      // can resolve `section-1` → "Section" via the page tree.
      mockPuckState.config.components.Section = {
        label: "Section",
        fields: {
          content: {
            type: "slot",
            disallow: ["Heading"],
          },
        },
      };
      mockPuckState.appState.data.content = [
        { type: "Section", props: { id: "section-1" } },
      ];

      renderPopover({ zone: "section-1:content" });

      const items = screen.getAllByTestId("ora-component-picker-item");
      const types = items
        .map((el) => el.getAttribute("data-component-type"))
        .filter((v): v is string => v !== null);
      // Heading is disallowed on this slot, so it must not appear …
      expect(types).not.toContain("Heading");
      // … while the other registered components remain insertable.
      expect(types).toContain("Text");
      expect(types).toContain("Image");
    });

    it("keeps only `allow` types when the slot's allow array is non-empty", () => {
      // The reciprocal contract: when `allow` is non-empty, ONLY those
      // types are insertable (everything else is filtered out).
      mockPuckState.config.components.Section = {
        label: "Section",
        fields: {
          content: {
            type: "slot",
            allow: ["Image"],
          },
        },
      };
      mockPuckState.appState.data.content = [
        { type: "Section", props: { id: "section-1" } },
      ];

      renderPopover({ zone: "section-1:content" });

      const items = screen.getAllByTestId("ora-component-picker-item");
      const types = items
        .map((el) => el.getAttribute("data-component-type"))
        .filter((v): v is string => v !== null);
      expect(types).toEqual(["Image"]);
    });
  });

  // ── Req 5.10: focus trap ──────────────────────────────────────────────
  describe("focus trap (Req 5.10)", () => {
    it("wraps Tab from the last focusable to the first", () => {
      renderPopover();

      const popover = screen.getByTestId("ora-component-picker-popover");
      const search = screen.getByTestId(
        "ora-component-picker-search",
      ) as HTMLInputElement;
      const items = screen.getAllByTestId(
        "ora-component-picker-item",
      ) as HTMLButtonElement[];
      // Focusable list, in tab order: search → all component buttons.
      // Programmatically focus the last one so the trap's "wrap to
      // first" branch fires on Tab.
      const last = items[items.length - 1];
      last.focus();
      expect(document.activeElement).toBe(last);

      fireEvent.keyDown(popover, { key: "Tab" });

      // Wrap target is the first focusable, which is the search input.
      expect(document.activeElement).toBe(search);
    });

    it("wraps Shift+Tab from the first focusable to the last", () => {
      renderPopover();

      const popover = screen.getByTestId("ora-component-picker-popover");
      const search = screen.getByTestId(
        "ora-component-picker-search",
      ) as HTMLInputElement;
      const items = screen.getAllByTestId(
        "ora-component-picker-item",
      ) as HTMLButtonElement[];

      // Focus the first focusable (the search input) so the
      // shift+tab → last branch fires.
      search.focus();
      expect(document.activeElement).toBe(search);

      fireEvent.keyDown(popover, { key: "Tab", shiftKey: true });

      const last = items[items.length - 1];
      expect(document.activeElement).toBe(last);
    });
  });

  // ── Req 5.8: Escape closes the popover ────────────────────────────────
  describe("Escape dismissal (Req 5.8)", () => {
    it("calls onClose when Escape is pressed inside the popover", () => {
      const { onClose } = renderPopover();

      const popover = screen.getByTestId("ora-component-picker-popover");
      fireEvent.keyDown(popover, { key: "Escape" });

      // Escape is a pure UI dismissal — no insertion side-effect, just
      // the close callback firing once.
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ── Req 5.8: click-outside closes the popover ─────────────────────────
  describe("click-outside dismissal (Req 5.8)", () => {
    it("calls onClose on a mousedown outside the popover and the anchor", () => {
      const { onClose } = renderPopover();

      // Mount an unrelated outside element to receive the mousedown.
      // The popover's listener fires on `mousedown` (not `click`) to
      // beat any downstream click handlers.
      const outside = document.createElement("div");
      outside.setAttribute("data-testid", "outside-el");
      document.body.appendChild(outside);

      act(() => {
        fireEvent.mouseDown(outside);
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onClose on a mousedown on the popover itself", () => {
      const { onClose } = renderPopover();

      const popover = screen.getByTestId("ora-component-picker-popover");
      act(() => {
        fireEvent.mouseDown(popover);
      });

      // Inside-popover clicks must not trigger dismissal — otherwise
      // typing in the search input or clicking an item would also close.
      expect(onClose).not.toHaveBeenCalled();
    });

    it("does NOT call onClose on a mousedown on the anchor element", () => {
      const { onClose, anchorEl } = renderPopover();

      act(() => {
        fireEvent.mouseDown(anchorEl);
      });

      // Anchor clicks are explicitly excluded from the dismissal path
      // so the InsertionButton's own onClick handler can run.
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ── Req 5.1 / 5.3 path: selecting a component fires onInsert ──────────
  describe("selection (Req 5.1, 5.3 surface)", () => {
    it("calls onInsert with the component type, zone, and index", () => {
      const { onInsert } = renderPopover({
        zone: "root:default-zone",
        index: 2,
      });

      // Pick a deterministic item by its `data-component-type` attribute
      // so we know which type the popover should report up to its
      // parent.
      const button = document.querySelector<HTMLButtonElement>(
        '[data-component-type="Heading"]',
      );
      expect(button).not.toBeNull();
      fireEvent.click(button!);

      expect(onInsert).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledWith(
        "Heading",
        "root:default-zone",
        2,
      );
    });

    it("propagates the zone and index unchanged for nested zones", () => {
      // Same dispatch contract for non-root zones — exercises the
      // `(componentType, zone, index)` ordering with values that aren't
      // the defaults.
      mockPuckState.appState.data.content = [
        { type: "Section", props: { id: "section-1" } },
      ];
      const { onInsert } = renderPopover({
        zone: "section-1:content",
        index: 0,
      });

      const button = document.querySelector<HTMLButtonElement>(
        '[data-component-type="Image"]',
      );
      expect(button).not.toBeNull();
      fireEvent.click(button!);

      expect(onInsert).toHaveBeenCalledWith("Image", "section-1:content", 0);
    });
  });
});
