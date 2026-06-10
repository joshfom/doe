// @vitest-environment jsdom

/**
 * ElementHeader — disabled states at zone boundaries.
 *
 * Spec: custom-branded-page-builder — Requirements 4.6
 *
 * Req 4.6: IF the selected Block is the first or last Block in its zone,
 * THEN the Element_Header SHALL disable the corresponding move button
 * and set `aria-disabled="true"`.
 *
 * These tests exercise the presentational `ElementHeader` directly (the
 * Puck-aware container `SelectedElementHeader` has its own test file).
 * Both move buttons are asserted on: we check the native `disabled`
 * attribute (which blocks click dispatch and removes the button from
 * tab order) AND `aria-disabled="true"` (which screen readers announce)
 * — the acceptance criterion requires both channels so keyboard-only
 * users and assistive-tech users get the same signal.
 *
 * The component portals into `document.body` and anchors to a live DOM
 * element via `getBoundingClientRect()`. We mount a plain anchor div so
 * the position-tracking `useSyncExternalStore` hook can read a rect and
 * render the toolbar. `ResizeObserver` is not present in jsdom, so we
 * stub it before importing anything that touches it.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// ── Stub ResizeObserver before anything renders ────────────────────────────
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver })
  .ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Import after the stub so the ElementHeader module's `ResizeObserver`
// check resolves against the polyfill rather than `undefined`.
const { ElementHeader } = await import("./ElementHeader");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Mount a plain anchor div that the header's position hook can read a
 * rect from. The element is cleaned up after each test.
 */
function mountAnchor(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-test-anchor", "true");
  el.style.width = "200px";
  el.style.height = "40px";
  document.body.appendChild(el);
  return el;
}

interface RenderOptions {
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * Render the header with the supplied boundary flags and return the two
 * move-button DOM nodes plus the action spies. Callers assert on the
 * buttons directly — the spies let us double-check that clicks on a
 * disabled button never invoke the handler (belt-and-braces: the native
 * `disabled` attribute already blocks React's synthetic click, but the
 * component also guards the handler internally).
 */
function renderHeader({ canMoveUp, canMoveDown }: RenderOptions) {
  const anchorEl = mountAnchor();
  const onMoveUp = vi.fn();
  const onMoveDown = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();

  const utils = render(
    <ElementHeader
      itemId="block-1"
      label="Heading"
      anchorEl={anchorEl}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
    />,
  );

  const moveUp = utils.getByRole("button", { name: /^move heading up$/i });
  const moveDown = utils.getByRole("button", { name: /^move heading down$/i });

  return { ...utils, anchorEl, moveUp, moveDown, onMoveUp, onMoveDown };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ElementHeader — disabled states at zone boundaries (Req 4.6)", () => {
  beforeEach(() => {
    // Clear any lingering anchors or portal toolbars from prior tests.
    // Scope cleanup to our own data attributes rather than wiping
    // `document.body.innerHTML`, which can remove nodes React 19 still
    // holds references to and provoke `NotFoundError` on unmount.
    for (const el of Array.from(
      document.querySelectorAll("[data-test-anchor]"),
    )) {
      el.remove();
    }
    for (const el of Array.from(
      document.querySelectorAll("[data-element-header]"),
    )) {
      el.remove();
    }
  });

  it("disables Move up and sets aria-disabled=\"true\" when the block is first in its zone", () => {
    const { moveUp, moveDown } = renderHeader({
      canMoveUp: false,
      canMoveDown: true,
    });

    // Native `disabled` attribute — blocks click dispatch and removes
    // the button from the tab sequence.
    expect(moveUp.hasAttribute("disabled")).toBe(true);
    // `aria-disabled` — the screen-reader channel required by Req 4.6.
    expect(moveUp.getAttribute("aria-disabled")).toBe("true");

    // The opposite button stays enabled when only the upper boundary
    // is hit, so we don't mask disabled-state bugs on one button with
    // the other button's state.
    expect(moveDown.hasAttribute("disabled")).toBe(false);
    expect(moveDown.getAttribute("aria-disabled")).toBeNull();
  });

  it("disables Move down and sets aria-disabled=\"true\" when the block is last in its zone", () => {
    const { moveUp, moveDown } = renderHeader({
      canMoveUp: true,
      canMoveDown: false,
    });

    expect(moveDown.hasAttribute("disabled")).toBe(true);
    expect(moveDown.getAttribute("aria-disabled")).toBe("true");

    expect(moveUp.hasAttribute("disabled")).toBe(false);
    expect(moveUp.getAttribute("aria-disabled")).toBeNull();
  });

  it("disables both Move buttons when the block is the only one in its zone", () => {
    const { moveUp, moveDown } = renderHeader({
      canMoveUp: false,
      canMoveDown: false,
    });

    expect(moveUp.hasAttribute("disabled")).toBe(true);
    expect(moveUp.getAttribute("aria-disabled")).toBe("true");

    expect(moveDown.hasAttribute("disabled")).toBe(true);
    expect(moveDown.getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves both Move buttons enabled and without aria-disabled when the block has neighbours above and below", () => {
    const { moveUp, moveDown } = renderHeader({
      canMoveUp: true,
      canMoveDown: true,
    });

    expect(moveUp.hasAttribute("disabled")).toBe(false);
    // We assert the absence of the attribute rather than `"false"` so a
    // future refactor that adds `aria-disabled="false"` (which is
    // technically valid but noisy) would trip this test.
    expect(moveUp.getAttribute("aria-disabled")).toBeNull();

    expect(moveDown.hasAttribute("disabled")).toBe(false);
    expect(moveDown.getAttribute("aria-disabled")).toBeNull();
  });

  it("does not invoke the move handler when clicking a disabled Move button", () => {
    const { moveUp, moveDown, onMoveUp, onMoveDown } = renderHeader({
      canMoveUp: false,
      canMoveDown: false,
    });

    fireEvent.click(moveUp);
    fireEvent.click(moveDown);

    expect(onMoveUp).not.toHaveBeenCalled();
    expect(onMoveDown).not.toHaveBeenCalled();
  });
});
