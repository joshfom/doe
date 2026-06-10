// @vitest-environment jsdom

/**
 * InsertionContext — picker state + Puck dispatch wiring.
 *
 * Spec: builder-outline-tree-and-toolbar — Requirements 5.3, 5.4, 5.5
 *
 * The context coordinates two pieces of UI mounted in different
 * sub-trees (the in-canvas `InsertionButton` and the body-portalled
 * `ComponentPickerPopover`). These tests exercise the three
 * observable behaviours of the API surface from a consumer's
 * perspective:
 *
 *   1. `openPicker` flips state from `null` → `{ anchorEl, zone, index }`
 *   2. `closePicker` flips state back to `null` without dispatching
 *   3. `insertComponent` dispatches the `insert` + `setUi` pair the
 *      design specifies and then closes the picker
 *
 * We mock `../use-puck-store` at the module boundary so the provider
 * receives a `dispatch` spy without standing up a real Puck harness.
 * The provider itself only reads `dispatch` from the store; nothing
 * else is touched, so the mock surface stays minimal.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// ── Mock the Puck store ─────────────────────────────────────────────────────
//
// `InsertionProvider` calls `usePuckStore((s) => s.dispatch)` to read the
// dispatch function and `usePuckStore((s) => s.config)` to resolve the
// label of the inserted component for the live-region announcement
// (Req 6.5). We mirror that selector contract here so the provider
// receives a vitest spy and a deterministic config snapshot. Keeping
// the mock state in a module-scoped object lets each test reset it in
// `beforeEach`.

interface MockPuckState {
  dispatch: ReturnType<typeof vi.fn>;
  config: {
    components: Record<string, { label?: string }>;
  };
}

const mockPuckState: MockPuckState = {
  dispatch: vi.fn(),
  config: {
    components: {
      Heading: { label: "Heading" },
      Image: { label: "Image" },
    },
  },
};

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

// Import *after* the mock so the provider picks up the mocked store.
const { InsertionProvider, useInsertion } = await import("./InsertionContext");
// `SelectionAnnounceProvider` is imported lazily inside the announce
// test only — most tests render `useInsertion` without the announce
// provider to verify the no-op fallback (the hook returns the default
// `() => {}` context value when no provider is mounted).
const { SelectionAnnounceProvider } = await import("./SelectionLiveRegion");

// ── Helpers ─────────────────────────────────────────────────────────────────

const ROOT_ZONE = "root:default-zone";

/**
 * Render the `useInsertion` hook inside the provider. Returning the
 * hook's `result` directly (rather than wrapping in a custom harness
 * component) keeps the assertions focused on the public API surface.
 */
function renderInsertion() {
  return renderHook(() => useInsertion(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <InsertionProvider>{children}</InsertionProvider>
    ),
  });
}

/**
 * A reusable anchor element for `openPicker`. The provider stores it
 * verbatim — no DOM interaction required — so a detached `<button>` is
 * sufficient and avoids polluting `document.body` between tests.
 */
function makeAnchor(): HTMLButtonElement {
  return document.createElement("button");
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("InsertionContext", () => {
  beforeEach(() => {
    mockPuckState.dispatch = vi.fn();
    mockPuckState.config = {
      components: {
        Heading: { label: "Heading" },
        Image: { label: "Image" },
      },
    };
  });

  describe("openPicker (Req 5.3)", () => {
    it("populates state with the supplied anchor, zone, and index", () => {
      const { result } = renderInsertion();
      const anchor = makeAnchor();

      // State starts closed so consumers (e.g. the popover) can guard on
      // `state === null` to skip rendering.
      expect(result.current.state).toBeNull();

      act(() => {
        result.current.openPicker(anchor, ROOT_ZONE, 2);
      });

      expect(result.current.state).toEqual({
        anchorEl: anchor,
        zone: ROOT_ZONE,
        index: 2,
      });
      // Opening the picker is purely a UI state change — it must not
      // touch Puck data until the user actually picks a component.
      expect(mockPuckState.dispatch).not.toHaveBeenCalled();
    });

    it("replaces previous state when called twice (rapid clicks on different buttons)", () => {
      const { result } = renderInsertion();
      const firstAnchor = makeAnchor();
      const secondAnchor = makeAnchor();

      act(() => {
        result.current.openPicker(firstAnchor, ROOT_ZONE, 0);
      });
      act(() => {
        result.current.openPicker(secondAnchor, "section-1:content", 3);
      });

      // Singular state — the second call replaces the first per the
      // design's "Rapid clicks on multiple insertion buttons" handling.
      expect(result.current.state).toEqual({
        anchorEl: secondAnchor,
        zone: "section-1:content",
        index: 3,
      });
    });
  });

  describe("closePicker (Req 5.5)", () => {
    it("resets state to null", () => {
      const { result } = renderInsertion();

      act(() => {
        result.current.openPicker(makeAnchor(), ROOT_ZONE, 1);
      });
      expect(result.current.state).not.toBeNull();

      act(() => {
        result.current.closePicker();
      });

      expect(result.current.state).toBeNull();
      // Closing without a selection must not mutate Puck data — that
      // would surprise users who hit Escape or click outside.
      expect(mockPuckState.dispatch).not.toHaveBeenCalled();
    });

    it("is a no-op when the picker is already closed", () => {
      const { result } = renderInsertion();

      act(() => {
        result.current.closePicker();
      });

      expect(result.current.state).toBeNull();
      expect(mockPuckState.dispatch).not.toHaveBeenCalled();
    });

    it("returns focus to the triggering anchor element (Req 6.4)", () => {
      // Focus restoration is the contract that lets keyboard users hit
      // Escape (or click outside) and resume from the InsertionButton
      // they were operating, instead of dropping focus to <body>. The
      // provider stores the anchor passed to `openPicker` and must
      // re-focus it when the picker closes WITHOUT an insertion.
      //
      // The anchor needs to be in the document for focus tracking to
      // work — `document.activeElement` only updates when focus moves
      // to a connected, focusable element. We append a real <button> to
      // <body>, exercise the close path, and assert the activeElement
      // came back to that button.
      const { result } = renderInsertion();
      const anchor = document.createElement("button");
      anchor.textContent = "Add component";
      document.body.appendChild(anchor);

      try {
        act(() => {
          result.current.openPicker(anchor, ROOT_ZONE, 0);
        });
        // Sanity: focus starts elsewhere (the popover's search input
        // would normally take focus on open, but in this isolated test
        // we don't render the popover, so focus is on <body>). Forcing
        // focus to a different element makes the post-close assertion
        // unambiguous.
        const distractor = document.createElement("input");
        document.body.appendChild(distractor);
        distractor.focus();
        expect(document.activeElement).toBe(distractor);

        act(() => {
          result.current.closePicker();
        });

        expect(document.activeElement).toBe(anchor);
        document.body.removeChild(distractor);
      } finally {
        document.body.removeChild(anchor);
      }
    });

    it("does not throw when the anchor element has been detached", () => {
      // Defensive: if the InsertionButton unmounts while the picker is
      // open (e.g. an outline edit removes the parent block), the
      // stored anchor may no longer be focusable. The close path
      // should still complete and reset state — losing focus is
      // acceptable in this rare race; throwing is not.
      const { result } = renderInsertion();
      const anchor = document.createElement("button");
      // Note: NOT appended to <body> — simulates a detached node.

      act(() => {
        result.current.openPicker(anchor, ROOT_ZONE, 0);
      });

      expect(() => {
        act(() => {
          result.current.closePicker();
        });
      }).not.toThrow();
      expect(result.current.state).toBeNull();
    });
  });

  describe("insertComponent (Req 5.3, 5.4, 5.5)", () => {
    it("dispatches `insert` then `setUi`, then closes the picker", () => {
      const { result } = renderInsertion();
      const anchor = makeAnchor();

      act(() => {
        result.current.openPicker(anchor, ROOT_ZONE, 2);
      });
      act(() => {
        result.current.insertComponent("Heading");
      });

      const calls = mockPuckState.dispatch.mock.calls;
      // Exactly two dispatches per the design: insert + setUi. Any extra
      // would indicate accidental re-renders or a regression that
      // duplicates the action.
      expect(calls).toHaveLength(2);

      // ── Step 1: insert at the requested zone/index with a fresh id.
      const [insertCall] = calls;
      expect(insertCall[0]).toMatchObject({
        type: "insert",
        componentType: "Heading",
        destinationZone: ROOT_ZONE,
        destinationIndex: 2,
      });
      // The id is generated at dispatch time; the exact value is opaque
      // but it must be a non-empty string with the `${type}-` prefix so
      // Puck's reducer accepts it without auto-generating a replacement.
      expect(typeof insertCall[0].id).toBe("string");
      expect((insertCall[0].id as string).startsWith("Heading-")).toBe(true);

      // ── Step 2: select the new item so its props appear in the
      // configuration panel (Req 5.4). The selector targets the same
      // index we inserted at — Puck's `insert` shifts the existing
      // item at that index down by one, so the new item lands exactly
      // there.
      const [, setUiCall] = calls;
      expect(setUiCall[0]).toMatchObject({
        type: "setUi",
        ui: { itemSelector: { zone: ROOT_ZONE, index: 2 } },
      });

      // ── Step 3: picker closes (Req 5.5).
      expect(result.current.state).toBeNull();
    });

    it("uses the zone and index captured at openPicker time, not at call time", () => {
      // Guards against a regression where `insertComponent` reads from a
      // stale closure or from a freshly-mutated state. The dispatch
      // payloads MUST reflect the picker's current target.
      const { result } = renderInsertion();
      const anchor = makeAnchor();

      act(() => {
        result.current.openPicker(anchor, "hero-1:content", 0);
      });
      act(() => {
        result.current.insertComponent("Image");
      });

      const [insertCall, setUiCall] = mockPuckState.dispatch.mock.calls;
      expect(insertCall[0]).toMatchObject({
        type: "insert",
        componentType: "Image",
        destinationZone: "hero-1:content",
        destinationIndex: 0,
      });
      expect(setUiCall[0]).toMatchObject({
        type: "setUi",
        ui: { itemSelector: { zone: "hero-1:content", index: 0 } },
      });
    });

    it("is a no-op when the picker is closed", () => {
      // Calling `insertComponent` without an open picker has no zone or
      // index target — silently dropping the call (rather than throwing
      // or dispatching with garbage values) keeps stray callers from
      // corrupting Puck state.
      const { result } = renderInsertion();

      act(() => {
        result.current.insertComponent("Heading");
      });

      expect(mockPuckState.dispatch).not.toHaveBeenCalled();
      expect(result.current.state).toBeNull();
    });

    it("generates a fresh id for each insertion", () => {
      const { result } = renderInsertion();

      act(() => {
        result.current.openPicker(makeAnchor(), ROOT_ZONE, 0);
      });
      act(() => {
        result.current.insertComponent("Heading");
      });

      act(() => {
        result.current.openPicker(makeAnchor(), ROOT_ZONE, 1);
      });
      act(() => {
        result.current.insertComponent("Heading");
      });

      const insertCalls = mockPuckState.dispatch.mock.calls.filter(
        (call) => call[0].type === "insert",
      );
      expect(insertCalls).toHaveLength(2);
      // Two inserts of the same component type must yield distinct ids
      // — sharing an id between blocks would collapse them in Puck's
      // index and break selection.
      expect(insertCalls[0][0].id).not.toBe(insertCalls[1][0].id);
    });

    it("does NOT restore focus to the triggering anchor (Req 6.4)", () => {
      // Symmetric to the closePicker focus-restoration test: when an
      // insertion happens, selection moves to the newly inserted
      // component, NOT back to the trigger button. The provider must
      // distinguish these two paths so keyboard users land on the new
      // block's configuration after picking a component, instead of
      // bouncing back to a now-stale insertion point.
      //
      // The visible signal: after `insertComponent`, the previously
      // focused element (an unrelated input here, standing in for
      // whatever Puck focuses on the new block in the live builder)
      // remains the activeElement — the anchor is NOT pulled back into
      // focus.
      const { result } = renderInsertion();
      const anchor = document.createElement("button");
      anchor.textContent = "Add component";
      document.body.appendChild(anchor);
      const distractor = document.createElement("input");
      document.body.appendChild(distractor);

      try {
        act(() => {
          result.current.openPicker(anchor, ROOT_ZONE, 0);
        });
        distractor.focus();
        expect(document.activeElement).toBe(distractor);

        act(() => {
          result.current.insertComponent("Heading");
        });

        // The provider must not have stolen focus back to the trigger.
        // In production, Puck's `setUi` selection moves focus to the
        // new block's selected outline; the test asserts the negative
        // (anchor is NOT focused) without coupling to that downstream
        // behaviour.
        expect(document.activeElement).not.toBe(anchor);
      } finally {
        document.body.removeChild(anchor);
        document.body.removeChild(distractor);
      }
    });
  });

  describe("live region announcement (Req 6.5)", () => {
    /**
     * After a component is inserted, the provider must announce
     * "{ComponentLabel} selected" through the shared
     * `SelectionAnnounceProvider` so screen readers stay in sync with
     * the visual selection (Req 6.5). The announce function pushes a
     * message into a polite live region rendered by
     * `SelectionAnnounceProvider`. We assert against the rendered
     * region's text content rather than spying on the context value
     * directly so the test exercises the same code path the live
     * builder uses.
     */
    function renderInsertionWithAnnounce() {
      return renderHook(() => useInsertion(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <SelectionAnnounceProvider>
            <InsertionProvider>{children}</InsertionProvider>
          </SelectionAnnounceProvider>
        ),
      });
    }

    it("announces the registered component label after insertion", () => {
      const { result } = renderInsertionWithAnnounce();

      act(() => {
        result.current.openPicker(makeAnchor(), ROOT_ZONE, 0);
      });
      act(() => {
        result.current.insertComponent("Heading");
      });

      // The provider portals the announcement to the same subtree, so
      // the test-id-tagged region appears in the document body. Its
      // text follows the established convention used by
      // `SelectionLiveRegion`: "{Label} selected".
      const region = document.querySelector(
        "[data-testid='ora-selection-announce']",
      );
      expect(region).not.toBeNull();
      expect(region?.textContent).toBe("Heading selected");
    });

    it("falls back to the component type when no registered label exists", () => {
      // Some components are registered without a `label` (especially
      // internal helpers). The announcement must still produce a
      // meaningful string by using the type name as the fallback —
      // this matches the same fallback chain that
      // `SelectionLiveRegion` follows for canvas-driven selection.
      mockPuckState.config = {
        components: {
          // Note: no `label` field — the provider must fall back to
          // the type identifier.
          CustomBlock: {},
        },
      };

      const { result } = renderInsertionWithAnnounce();

      act(() => {
        result.current.openPicker(makeAnchor(), ROOT_ZONE, 0);
      });
      act(() => {
        result.current.insertComponent("CustomBlock");
      });

      const region = document.querySelector(
        "[data-testid='ora-selection-announce']",
      );
      expect(region?.textContent).toBe("CustomBlock selected");
    });

    it("does not throw when no SelectionAnnounceProvider is mounted", () => {
      // The default context value is a no-op `() => {}`, so calling
      // `insertComponent` without the announce provider should still
      // perform the insert + setUi dispatches and close the picker
      // without raising. Guards against regressions if a future
      // refactor switches the default to `null`.
      const { result } = renderInsertion();

      act(() => {
        result.current.openPicker(makeAnchor(), ROOT_ZONE, 0);
      });
      expect(() => {
        act(() => {
          result.current.insertComponent("Heading");
        });
      }).not.toThrow();

      // Two dispatches still happened — the announcement is purely
      // additive and must not block the core insertion flow.
      expect(mockPuckState.dispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe("useInsertion outside provider", () => {
    it("throws a descriptive error", () => {
      // Render the hook with no wrapper. `renderHook` bubbles the error
      // out of the rendered component, so we capture it via vitest's
      // `toThrow` matcher on the renderHook call itself. Suppressing
      // React's console.error for this case keeps the test output clean.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(() => renderHook(() => useInsertion())).toThrow(
          /useInsertion must be called inside an <InsertionProvider>/,
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
