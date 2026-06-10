// @vitest-environment jsdom

/**
 * InlineToolbar — alignment commands and link popover.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Requirements 2.1–2.8
 *
 * Tests:
 *   - Four alignment buttons render and fire the correct
 *     `editor.chain().focus().setTextAlign(...)` commands.
 *   - Link button opens the popover.
 *   - Link popover "Apply" with non-empty URL sets the link mark.
 *   - Link popover "Apply" with empty URL removes the link mark.
 *   - Link popover "Remove" removes the link mark.
 *   - Focus trap: Tab at last element wraps to first, Shift+Tab at
 *     first wraps to last.
 *   - Escape closes the popover.
 *
 * Uses the same fake-editor pattern as `InlineToolbar.test.tsx`.
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
  setTextAlign: (alignment: string) => FakeEditor;
  setLink: (attrs: { href: string }) => FakeEditor;
  unsetLink: () => FakeEditor;
  setMark: () => FakeEditor;
  deleteRange: () => FakeEditor;
  insertContent: () => FakeEditor;
  run: () => boolean;
  // Test-only helpers:
  __emitFocus: () => void;
  __emitBlur: () => void;
  __calls: string[];
}

function createFakeEditor(dom: HTMLElement): FakeEditor {
  const handlers: Record<EditorEvent, Set<() => void>> = {
    focus: new Set(),
    blur: new Set(),
    transaction: new Set(),
  };

  const calls: string[] = [];

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
    setTextAlign(alignment: string) {
      calls.push(`setTextAlign:${alignment}`);
      return editor;
    },
    setLink(attrs: { href: string }) {
      calls.push(`setLink:${attrs.href}`);
      return editor;
    },
    unsetLink() {
      calls.push("unsetLink");
      return editor;
    },
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
    __calls: calls,
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

describe("InlineToolbar — alignment commands (Req 2.1, 2.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    cleanupPortals();
  });

  it("renders four alignment buttons with correct aria-labels", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    expect(toolbar).not.toBeNull();

    const alignLeft = toolbar.querySelector('[aria-label="Align left"]');
    const alignCenter = toolbar.querySelector('[aria-label="Align center"]');
    const alignRight = toolbar.querySelector('[aria-label="Align right"]');
    const alignJustify = toolbar.querySelector('[aria-label="Align justify"]');

    expect(alignLeft).not.toBeNull();
    expect(alignCenter).not.toBeNull();
    expect(alignRight).not.toBeNull();
    expect(alignJustify).not.toBeNull();
  });

  it("Align left button fires editor.chain().focus().setTextAlign('left')", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const btn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Align left"]',
    )!;
    fireEvent.click(btn);

    expect(editor.__calls).toContain("setTextAlign:left");
  });

  it("Align center button fires editor.chain().focus().setTextAlign('center')", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const btn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Align center"]',
    )!;
    fireEvent.click(btn);

    expect(editor.__calls).toContain("setTextAlign:center");
  });

  it("Align right button fires editor.chain().focus().setTextAlign('right')", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const btn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Align right"]',
    )!;
    fireEvent.click(btn);

    expect(editor.__calls).toContain("setTextAlign:right");
  });

  it("Align justify button fires editor.chain().focus().setTextAlign('justify')", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const btn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Align justify"]',
    )!;
    fireEvent.click(btn);

    expect(editor.__calls).toContain("setTextAlign:justify");
  });
});

describe("InlineToolbar — link popover (Req 2.3–2.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    cleanupPortals();
  });

  it("Link button opens the link popover", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector('[data-link-popover]');
    expect(popover).not.toBeNull();
  });

  it("Link popover 'Apply' with non-empty URL sets the link mark", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector('[data-link-popover]')!;
    const input = popover.querySelector<HTMLInputElement>('input[type="url"]')!;
    fireEvent.change(input, { target: { value: "https://example.com" } });

    const applyBtn = popover.querySelector<HTMLButtonElement>(
      "button:last-of-type",
    )!;
    expect(applyBtn.textContent).toBe("Apply");
    fireEvent.click(applyBtn);

    expect(editor.__calls).toContain("setLink:https://example.com");
  });

  it("Link popover 'Apply' with empty URL removes the link mark", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector('[data-link-popover]')!;
    const input = popover.querySelector<HTMLInputElement>('input[type="url"]')!;
    // Ensure the input is empty
    fireEvent.change(input, { target: { value: "" } });

    const applyBtn = popover.querySelector<HTMLButtonElement>(
      "button:last-of-type",
    )!;
    fireEvent.click(applyBtn);

    expect(editor.__calls).toContain("unsetLink");
  });

  it("Link popover 'Remove' removes the link mark", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    const popover = toolbar.querySelector('[data-link-popover]')!;
    // Find the Remove button (first button in the button row)
    const buttons = popover.querySelectorAll<HTMLButtonElement>("button");
    const removeBtn = Array.from(buttons).find(
      (b) => b.textContent === "Remove",
    )!;
    fireEvent.click(removeBtn);

    expect(editor.__calls).toContain("unsetLink");
  });

  it("Escape closes the link popover", () => {
    const editor = setupEditor();
    renderToolbarVisible(editor);

    const toolbar = queryToolbar()!;
    const linkBtn = toolbar.querySelector<HTMLButtonElement>(
      '[aria-label="Link"]',
    )!;
    fireEvent.click(linkBtn);

    let popover = toolbar.querySelector('[data-link-popover]');
    expect(popover).not.toBeNull();

    // Press Escape on the popover
    fireEvent.keyDown(popover!, { key: "Escape" });

    // After rAF for focus restoration
    act(() => {
      vi.advanceTimersByTime(16);
    });

    popover = toolbar.querySelector('[data-link-popover]');
    expect(popover).toBeNull();
  });
});

describe("InlineToolbar — link popover focus trap (Req 10.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    cleanupPortals();
  });

  it("Tab at last element wraps to first", () => {
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

    // Focus the last element
    act(() => {
      last.focus();
    });

    // Press Tab — should wrap to first
    const prevented = !fireEvent.keyDown(popover, {
      key: "Tab",
      shiftKey: false,
    });

    // The event handler calls preventDefault and focuses the first element
    // We verify the focus trap logic by checking that the first element gets focus
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab at first element wraps to last", () => {
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

    // Press Shift+Tab — should wrap to last
    fireEvent.keyDown(popover, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(last);
  });
});
