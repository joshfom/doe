// @vitest-environment jsdom

/**
 * InlineToolbar — 150 ms auto-hide timing.
 *
 * Spec: custom-branded-page-builder — Requirements 5.5
 *
 * Req 5.5: IF the text field loses focus to an element outside the
 *   Inline_Toolbar, THEN THE Inline_Toolbar SHALL hide within 150 ms.
 *
 * The toolbar's visibility machine lives in a private hook inside
 * `InlineToolbar.tsx` (`useToolbarVisibility`). Rather than reach into
 * the hook directly, we drive the public surface: we mount the toolbar
 * with a fake Tiptap `Editor` and toggle the editor's focus/blur
 * events. The fake covers exactly the subset of the Editor surface the
 * toolbar consumes (event bus, focus state, command chain no-ops, a
 * `state.selection` pair, and a DOM element to anchor positioning to).
 *
 * Timing is asserted at three points:
 *   - immediately after blur — toolbar still present;
 *   - at `INLINE_TOOLBAR_HIDE_DELAY_MS - 1` ms — toolbar still present;
 *   - at `INLINE_TOOLBAR_HIDE_DELAY_MS` ms — toolbar unmounted.
 *
 * The constant `INLINE_TOOLBAR_HIDE_DELAY_MS` is imported rather than
 * hard-coded so a future shift in the spec value propagates here
 * without silent drift.
 *
 * A companion "cancellation" case confirms the hide timer is a debounce
 * (not a hard deadline) by re-focusing the editor inside the window and
 * asserting the toolbar does not unmount after the window passes.
 *
 * jsdom does not implement `ResizeObserver`; the anchor-position hook
 * inside the toolbar references it, so we stub it before importing the
 * module under test — same approach as `ElementHeader.test.tsx`.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
// `cleanup` is exported separately from @testing-library/react; we call it
// explicitly instead of relying on the auto-cleanup global hook so that
// React's portal teardown completes before we reach for any lingering DOM
// nodes. Calling cleanup while fake timers are still installed is safe —
// it only synchronously tears down the React tree.
import { cleanup } from "@testing-library/react";

// ── ResizeObserver stub (must precede module import) ───────────────────────
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver })
  .ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { InlineToolbar, INLINE_TOOLBAR_HIDE_DELAY_MS } = await import(
  "./InlineToolbar"
);

// ── Fake Tiptap editor ─────────────────────────────────────────────────────
//
// Implements the subset of the `Editor` interface the toolbar reads:
//   - `view.dom` — HTMLElement whose rect drives positioning;
//   - `isFocused` — initial visibility gate;
//   - `on(event, h)` / `off(event, h)` — focus/blur/transaction bus;
//   - `state.selection.{from,to}` — AI-assist enablement check;
//   - `isActive(mark)` — button `data-active` state;
//   - `getAttributes(mark)` — color swatches read current mark attrs;
//   - `chain()` — a self-returning no-op so button handlers don't throw.
//
// Two test helpers expose the focus/blur lifecycle that Tiptap would
// normally emit itself, so the test drives the state machine
// deterministically without spinning up a real ProseMirror view.

type EditorEvent = "focus" | "blur" | "transaction";

interface FakeEditor {
  view: { dom: HTMLElement };
  isFocused: boolean;
  state: { doc: { textBetween: () => string }; selection: { from: number; to: number } };
  on: (event: EditorEvent, handler: () => void) => FakeEditor;
  off: (event: EditorEvent, handler: () => void) => FakeEditor;
  isActive: () => boolean;
  getAttributes: () => Record<string, unknown>;
  chain: () => FakeEditor;
  focus: () => FakeEditor;
  toggleBold: () => FakeEditor;
  toggleItalic: () => FakeEditor;
  toggleUnderline: () => FakeEditor;
  setMark: () => FakeEditor;
  deleteRange: () => FakeEditor;
  insertContent: () => FakeEditor;
  run: () => boolean;
  // Test-only helpers:
  __emitFocus: () => void;
  __emitBlur: () => void;
}

function createFakeEditor(dom: HTMLElement): FakeEditor {
  const handlers: Record<EditorEvent, Set<() => void>> = {
    focus: new Set(),
    blur: new Set(),
    transaction: new Set(),
  };

  const editor: FakeEditor = {
    view: { dom },
    isFocused: false,
    state: {
      doc: { textBetween: () => "" },
      selection: { from: 0, to: 0 },
    },
    on(event, handler) {
      handlers[event].add(handler);
      return editor;
    },
    off(event, handler) {
      handlers[event].delete(handler);
      return editor;
    },
    isActive: () => false,
    getAttributes: () => ({}),
    chain: () => editor,
    focus: () => editor,
    toggleBold: () => editor,
    toggleItalic: () => editor,
    toggleUnderline: () => editor,
    setMark: () => editor,
    deleteRange: () => editor,
    insertContent: () => editor,
    run: () => true,
    __emitFocus() {
      editor.isFocused = true;
      for (const h of handlers.focus) h();
    },
    __emitBlur() {
      editor.isFocused = false;
      for (const h of handlers.blur) h();
    },
  };
  return editor;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Query the portal node the toolbar creates in `document.body`. */
function queryToolbar(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-inline-toolbar]");
}

/** Clean up any portal DOM the prior test left behind. */
function cleanupPortals() {
  for (const el of Array.from(document.querySelectorAll("[data-inline-toolbar]"))) {
    el.remove();
  }
  for (const el of Array.from(document.querySelectorAll("[data-test-anchor]"))) {
    el.remove();
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("InlineToolbar — 150 ms auto-hide (Req 5.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Unmount React trees BEFORE wiping our manually-appended DOM
    // nodes. `@testing-library/react`'s auto-cleanup runs after
    // afterEach hooks, so if we wipe first React's portal teardown
    // hits already-removed nodes and throws `NotFoundError`.
    cleanup();
    vi.useRealTimers();
    cleanupPortals();
  });

  it("exports the 150 ms hide delay as a constant", () => {
    // The constant is the spec value (Req 5.5). Asserting it here
    // double-locks the contract so a change to the component requires
    // an intentional update to the spec-linked test.
    expect(INLINE_TOOLBAR_HIDE_DELAY_MS).toBe(150);
  });

  it("hides the toolbar within 150 ms after the editor blurs to an element outside the toolbar", () => {
    // Outside element the focus conceptually moves to. The toolbar
    // only cares that `editor.on("blur", ...)` fires — it does not
    // inspect `event.relatedTarget` on the editor side — so mounting
    // the button is enough to represent "an element outside".
    const outside = document.createElement("button");
    outside.setAttribute("data-test-anchor", "true");
    outside.textContent = "outside";
    document.body.appendChild(outside);

    const editorDom = document.createElement("div");
    editorDom.setAttribute("data-test-anchor", "true");
    editorDom.contentEditable = "true";
    document.body.appendChild(editorDom);

    const editor = createFakeEditor(editorDom);

    render(<InlineToolbar editor={editor as unknown as import("@tiptap/react").Editor} />);

    // Focus the editor: visibility gate flips to true and the toolbar
    // portal appears in the body.
    act(() => {
      editor.__emitFocus();
    });
    expect(queryToolbar()).not.toBeNull();

    // Blur the editor. The debounce starts ticking but the toolbar
    // stays on-screen for the whole window so the user can still
    // click through to a color picker or AI button.
    act(() => {
      editor.__emitBlur();
    });
    expect(queryToolbar()).not.toBeNull();

    // Just before the deadline — toolbar still there.
    act(() => {
      vi.advanceTimersByTime(INLINE_TOOLBAR_HIDE_DELAY_MS - 1);
    });
    expect(queryToolbar()).not.toBeNull();

    // At the deadline — toolbar unmounts. This is the "within 150 ms"
    // contract from Req 5.5: at `t = 150` the portal MUST be gone.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryToolbar()).toBeNull();
  });

  it("cancels the hide timer if the editor re-focuses before the 150 ms window elapses", () => {
    // Companion case: the 150 ms rule is a debounce (cancellable),
    // not a hard timeout. If the spec ever drifted to a hard-timeout
    // implementation the toolbar would blink off mid-interaction,
    // which is the UX regression this case guards against.
    const editorDom = document.createElement("div");
    editorDom.setAttribute("data-test-anchor", "true");
    editorDom.contentEditable = "true";
    document.body.appendChild(editorDom);

    const editor = createFakeEditor(editorDom);

    render(<InlineToolbar editor={editor as unknown as import("@tiptap/react").Editor} />);

    act(() => {
      editor.__emitFocus();
    });
    expect(queryToolbar()).not.toBeNull();

    act(() => {
      editor.__emitBlur();
    });

    // Advance partially into the hide window, then re-focus. The
    // pending timer should be cancelled and the toolbar should stay
    // mounted indefinitely after that point.
    act(() => {
      vi.advanceTimersByTime(Math.floor(INLINE_TOOLBAR_HIDE_DELAY_MS / 2));
    });
    expect(queryToolbar()).not.toBeNull();

    act(() => {
      editor.__emitFocus();
    });

    // Fast-forward well past the original deadline. Because the
    // editor regained focus inside the window, the toolbar is still
    // visible.
    act(() => {
      vi.advanceTimersByTime(INLINE_TOOLBAR_HIDE_DELAY_MS * 4);
    });
    expect(queryToolbar()).not.toBeNull();
  });
});
