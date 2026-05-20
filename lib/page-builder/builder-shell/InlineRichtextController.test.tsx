// @vitest-environment jsdom

/**
 * InlineRichtextController — unit tests with fake timers.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 6.10
 *
 * Covers:
 * 1. Two-step gesture: first click selects block, second click within 500ms
 *    on same block's richtext field promotes to edit mode.
 * 2. 500 ms expiry: if second click comes after 500ms, it does NOT promote.
 * 3. Debounced dispatch cadence: editor updates are debounced at 100ms before
 *    dispatching `replace`.
 * 4. Sanitization: `sanitizeRichTextHtml` is called on editor output before
 *    dispatch.
 * 5. Escape behavior: pressing Escape destroys the editor, flushes pending
 *    dispatch, keeps block selected.
 *
 * Uses fake timers (vi.useFakeTimers). Mocks:
 * - `usePuckStore` from `../use-puck-store`
 * - `sanitizeRichTextHtml` from `../config`
 * - `@tiptap/react` and extensions (lazy-loaded)
 * - `isRichtextField` from `./richtext-fields`
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

// ── Fake Tiptap Editor ─────────────────────────────────────────────────────

type EditorEventHandler = (...args: unknown[]) => void;

let lastCreatedEditor: FakeTiptapEditor | null = null;

class FakeTiptapEditor {
  private handlers: Record<string, Set<EditorEventHandler>> = {};
  element: HTMLElement | null = null;
  options: Record<string, unknown> = {};

  constructor(opts: Record<string, unknown>) {
    this.options = opts;
    this.element = (opts.element as HTMLElement) ?? null;
    lastCreatedEditor = this;
  }

  on(event: string, handler: EditorEventHandler) {
    if (!this.handlers[event]) this.handlers[event] = new Set();
    this.handlers[event].add(handler);
    return this;
  }

  off(event: string, handler: EditorEventHandler) {
    this.handlers[event]?.delete(handler);
    return this;
  }

  getHTML() {
    return "<p>edited content</p>";
  }

  destroy() {
    // no-op for test — spied on in individual tests
  }

  /** Test helper: emit an update event */
  __emitUpdate() {
    for (const h of this.handlers["update"] ?? []) h();
  }
}

// ── Mocks (hoisted by vitest) ──────────────────────────────────────────────

const mockSanitize = vi.fn((html: string) => `sanitized:${html}`);
vi.mock("../config", () => ({
  sanitizeRichTextHtml: (html: string) => mockSanitize(html),
}));

const mockDispatch = vi.fn();
const mockGetSelectorForId = vi.fn((_id: string) => ({ zone: "default-zone", index: 0 }));
const mockSelectedItem = {
  type: "Text",
  props: { id: "block-1", content: "<p>Hello world</p>" },
};

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (s: unknown) => unknown) => {
    const store = {
      selectedItem: mockSelectedItem,
      dispatch: mockDispatch,
      getSelectorForId: mockGetSelectorForId,
    };
    return selector(store);
  },
}));

vi.mock("./richtext-fields", () => ({
  isRichtextField: (name: string) => ["content", "body", "html"].includes(name),
}));

vi.mock("./InlineToolbar", () => ({
  INLINE_TOOLBAR_HIDE_DELAY_MS: 150,
}));

// Mock all tiptap packages — these are dynamically imported in the source
vi.mock("@tiptap/react", () => ({
  Editor: FakeTiptapEditor,
}));
vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-underline", () => ({ default: {} }));
vi.mock("@tiptap/extension-text-style", () => ({ default: {} }));
vi.mock("@tiptap/extension-color", () => ({ default: {} }));
vi.mock("@tiptap/extension-highlight", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("@tiptap/extension-text-align", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("@tiptap/extension-link", () => ({
  default: { configure: () => ({}) },
}));

// ── Import module under test (after mocks are declared) ────────────────────

const { InlineRichtextController } = await import("./InlineRichtextController");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a DOM element that simulates a Puck block with a richtext field.
 */
function createPuckFieldElement(blockId: string, field: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-puck-id", blockId);
  el.setAttribute("data-puck-field", field);
  el.textContent = "Some richtext content";
  document.body.appendChild(el);
  return el;
}

/**
 * Dispatch a pointerdown event on the given element.
 */
function pointerDown(el: HTMLElement) {
  const event = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  el.dispatchEvent(event);
}

/**
 * Dispatch a keydown Escape event on document.
 */
function pressEscape() {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  document.dispatchEvent(event);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("InlineRichtextController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDispatch.mockClear();
    mockSanitize.mockClear();
    mockGetSelectorForId.mockReturnValue({ zone: "default-zone", index: 0 });
    lastCreatedEditor = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("Two-step gesture (Req 1.2)", () => {
    it("first click on a richtext field does NOT promote to edit mode", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      await act(async () => {
        pointerDown(el);
      });

      // No editor should be created after first click
      expect(lastCreatedEditor).toBeNull();
    });

    it("second click within 500ms on same block's richtext field promotes to edit mode", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // First click
      await act(async () => {
        pointerDown(el);
      });

      // Second click within 500ms
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        // Allow the async promoteToEditMode to resolve
        await vi.runAllTimersAsync();
      });

      // Editor should be created
      expect(lastCreatedEditor).not.toBeNull();
    });

    it("clicking a different block resets the gesture state", async () => {
      render(<InlineRichtextController />);

      const el1 = createPuckFieldElement("block-1", "content");
      const el2 = createPuckFieldElement("block-2", "content");

      // First click on block-1
      await act(async () => {
        pointerDown(el1);
      });

      // Click on block-2 (resets gesture to block-2)
      await act(async () => {
        vi.advanceTimersByTime(100);
        pointerDown(el2);
      });

      // Click on block-1 again — this is a "first click" for block-1 now
      await act(async () => {
        vi.advanceTimersByTime(100);
        pointerDown(el1);
        await vi.runAllTimersAsync();
      });

      // Should NOT have promoted because the gesture was reset
      expect(lastCreatedEditor).toBeNull();
    });
  });

  describe("500 ms expiry", () => {
    it("second click after 500ms does NOT promote to edit mode", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // First click
      await act(async () => {
        pointerDown(el);
      });

      // Advance past the 500ms window
      await act(async () => {
        vi.advanceTimersByTime(501);
      });

      // Second click — too late
      await act(async () => {
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      // No editor created (the second click becomes a new "first click")
      expect(lastCreatedEditor).toBeNull();
    });

    it("second click at exactly 499ms still promotes to edit mode", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // First click
      await act(async () => {
        pointerDown(el);
      });

      // Second click at 499ms (within window)
      await act(async () => {
        vi.advanceTimersByTime(499);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      expect(lastCreatedEditor).not.toBeNull();
    });
  });

  describe("Debounced dispatch cadence (100ms)", () => {
    it("editor update triggers dispatch after 100ms debounce", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // Promote to edit mode
      await act(async () => {
        pointerDown(el);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      expect(lastCreatedEditor).not.toBeNull();
      mockDispatch.mockClear();

      // Simulate editor update
      await act(async () => {
        lastCreatedEditor!.__emitUpdate();
      });

      // Dispatch should NOT have fired yet (debounce pending)
      expect(mockDispatch).not.toHaveBeenCalled();

      // Advance 99ms — still not dispatched
      await act(async () => {
        vi.advanceTimersByTime(99);
      });
      expect(mockDispatch).not.toHaveBeenCalled();

      // Advance 1 more ms (total 100ms) — dispatch fires
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "replace" }),
      );
    });

    it("rapid updates reset the debounce timer — only one dispatch after last update + 100ms", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // Promote to edit mode
      await act(async () => {
        pointerDown(el);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      mockDispatch.mockClear();

      // Simulate multiple rapid updates
      await act(async () => {
        lastCreatedEditor!.__emitUpdate();
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
        lastCreatedEditor!.__emitUpdate();
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
        lastCreatedEditor!.__emitUpdate();
      });

      // 99ms after last update — no dispatch yet
      await act(async () => {
        vi.advanceTimersByTime(99);
      });
      expect(mockDispatch).not.toHaveBeenCalled();

      // 1 more ms — dispatch fires (once, not three times)
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Sanitization", () => {
    it("sanitizeRichTextHtml is called on editor output before dispatch", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // Promote to edit mode
      await act(async () => {
        pointerDown(el);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      mockSanitize.mockClear();
      mockDispatch.mockClear();

      // Simulate editor update
      await act(async () => {
        lastCreatedEditor!.__emitUpdate();
      });

      // sanitize is called immediately on update (before debounce fires)
      expect(mockSanitize).toHaveBeenCalledWith("<p>edited content</p>");

      // Let debounce fire
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // The dispatched value should be the sanitized version
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "replace",
          data: expect.objectContaining({
            props: expect.objectContaining({
              content: "sanitized:<p>edited content</p>",
            }),
          }),
        }),
      );
    });
  });

  describe("Escape behavior", () => {
    it("pressing Escape destroys the editor and flushes pending dispatch", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // Promote to edit mode
      await act(async () => {
        pointerDown(el);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      expect(lastCreatedEditor).not.toBeNull();
      const editorInstance = lastCreatedEditor!;
      const destroySpy = vi.spyOn(editorInstance, "destroy");

      mockDispatch.mockClear();

      // Simulate an update (creates pending dispatch)
      await act(async () => {
        editorInstance.__emitUpdate();
      });

      // Press Escape before debounce fires
      await act(async () => {
        vi.advanceTimersByTime(50);
        pressEscape();
      });

      // Editor should be destroyed
      expect(destroySpy).toHaveBeenCalled();

      // Pending dispatch should be flushed (dispatched immediately)
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "replace" }),
      );
    });

    it("pressing Escape without pending edits destroys editor without dispatching", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // Promote to edit mode
      await act(async () => {
        pointerDown(el);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      const editorInstance = lastCreatedEditor!;
      const destroySpy = vi.spyOn(editorInstance, "destroy");
      mockDispatch.mockClear();

      // Press Escape with no pending edits
      await act(async () => {
        pressEscape();
      });

      // Editor destroyed
      expect(destroySpy).toHaveBeenCalled();

      // No dispatch (nothing pending)
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("Escape does not deselect the block (keeps block selected)", async () => {
      render(<InlineRichtextController />);

      const el = createPuckFieldElement("block-1", "content");

      // Promote to edit mode
      await act(async () => {
        pointerDown(el);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
        pointerDown(el);
        await vi.runAllTimersAsync();
      });

      mockDispatch.mockClear();

      // Press Escape
      await act(async () => {
        pressEscape();
      });

      // Should NOT dispatch a setUi to clear selection
      const setUiCalls = mockDispatch.mock.calls.filter(
        (call) => call[0]?.type === "setUi",
      );
      expect(setUiCalls).toHaveLength(0);
    });
  });
});
