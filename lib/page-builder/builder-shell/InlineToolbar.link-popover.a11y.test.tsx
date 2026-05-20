// @vitest-environment jsdom

/**
 * InlineToolbar — link popover accessibility tests.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Requirement 10.4
 *
 * Req 10.4: THE Inline_Toolbar link popover SHALL implement a focus trap
 *   and SHALL restore focus to the link button on close.
 *
 * Tests:
 *   - Link popover has `role="dialog"` and `aria-label="Link"`.
 *   - Focus trap behavior (Tab/Shift+Tab cycle).
 *   - Focus restoration to the Link button on close.
 *   - Link button has `aria-haspopup="dialog"` and `aria-expanded` toggles.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";
import { cleanup } from "@testing-library/react";

// ── ResizeObserver stub (must precede module import) ───────────────────────
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver })
  .ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { InlineToolbar } = await import("./InlineToolbar");

// ── Fake Tiptap editor ─────────────────────────────────────────────────────

type EditorEvent = "focus" | "blur" | "transaction";

interface FakeEditor {
  view: { dom: HTMLElement };
  isFocused: boolean;
  state: {
    doc: { textBetween: () => string };
    selection: { from: number; to: number };
  };
  on: (event: EditorEvent, handler: () => void) => FakeEditor;
  off: (event: EditorEvent, handler: () => void) => FakeEditor;
  isActive: (mark: string | Record<string, string>) => boolean;
  getAttributes: (mark: string) => Record<string, unknown>;
  chain: () => FakeEditor;
  focus: () => FakeEditor;
  toggleBold: () => FakeEditor;
  toggleItalic: () => FakeEditor;
  toggleUnderline: () => FakeEditor;
  setTextAlign: () => FakeEditor;
  setLink: () => FakeEditor;
  unsetLink: () => FakeEditor;
  setMark: () => FakeEditor;
  deleteRange: () => FakeEditor;
  insertContent: () => FakeEditor;
  run: () => boolean;
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
      selection: { from: 0, to: 5 },
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
    setTextAlign: () => editor,
    setLink: () => editor,
    unsetLink: () => editor,
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

function queryToolbar(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-inline-toolbar]");
}

function cleanupPortals() {
  for (const el of Array.from(
    document.querySelectorAll("[data-inline-toolbar]"),
  )) {
    el.remove();
  }
  for (const el of Array.from(
    document.querySelectorAll("[data-test-anchor]"),
  )) {
    el.remove();
  }
}

function setupEditor(): FakeEditor {
  const editorDom = document.createElement("div");
  editorDom.setAttribute("data-test-anchor", "true");
  editorDom.contentEditable = "true";
  document.body.appendChild(editorDom);
  return createFakeEditor(editorDom);
}

function renderToolbarVisible(editor: FakeEditor) {
  const result = render(
    <InlineToolbar
      editor={editor as unknown as import("@tiptap/react").Editor}
    />,
  );
  act(() => {
    editor.__emitFocus();
  });
  return result;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("InlineToolbar link popover — accessibility (Req 10.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    cleanupPortals();
  });

  it("link popover has role='dialog' and aria-label='Link'", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector('[data-link-popover]')!;
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.getAttribute("aria-label")).toBe("Link");
  });

  it("focus trap: Tab at last element wraps to first element", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector<HTMLElement>('[data-link-popover]')!;
    const focusableElements = popover.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusableElements.length).toBeGreaterThanOrEqual(3); // input, Remove, Apply

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    // Focus the last element
    act(() => {
      last.focus();
    });
    expect(document.activeElement).toBe(last);

    // Tab should wrap to first
    fireEvent.keyDown(popover, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(first);
  });

  it("focus trap: Shift+Tab at first element wraps to last element", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector<HTMLElement>('[data-link-popover]')!;
    const focusableElements = popover.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    // Focus the first element
    act(() => {
      first.focus();
    });
    expect(document.activeElement).toBe(first);

    // Shift+Tab should wrap to last
    fireEvent.keyDown(popover, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("focus is restored to the Link button on popover close", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector<HTMLElement>('[data-link-popover]')!;
    expect(popover).not.toBeNull();

    // Press Escape to close the popover
    fireEvent.keyDown(popover, { key: "Escape" });

    // After rAF for focus restoration
    act(() => {
      vi.advanceTimersByTime(16);
    });

    // Popover should be gone
    expect(toolbar.querySelector('[data-link-popover]')).toBeNull();
    // Focus should be on the Link button
    expect(document.activeElement).toBe(linkBtn);
  });

  it("Link button has aria-haspopup='dialog'", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;

    expect(linkBtn.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("Link button aria-expanded toggles when popover opens/closes", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;

    // Initially not expanded
    expect(linkBtn.getAttribute("aria-expanded")).toBe("false");

    // Open the popover
    fireEvent.click(linkBtn);
    expect(linkBtn.getAttribute("aria-expanded")).toBe("true");

    // Close the popover by clicking the link button again
    fireEvent.click(linkBtn);
    expect(linkBtn.getAttribute("aria-expanded")).toBe("false");
  });
});
