// @vitest-environment jsdom
/**
 * Render tests for the CardGrid block (task 11.3).
 *
 * CardGrid is a slot host (category `layout`): it owns no `cards` array and
 * instead nests `Card` children through a Puck Slot named `card-content`,
 * laying them out in a responsive grid. The block invokes the slot "the Columns
 * way" — `typeof props["card-content"] === "function" ? props["card-content"]()
 * : null` — so these tests supply the `card-content` prop as a function
 * returning fixed React nodes, exactly as a real Puck slot would.
 *
 * Scope (per the implementation plan, task 11.3):
 *   - Slot children laid out in grid: when the `card-content` slot returns
 *     children, they appear inside a single grid container whose inline style is
 *     `display: grid` with `gridTemplateColumns: repeat(n, 1fr)` for the
 *     resolved desktop column count (Req 6.6, 6.7).
 *   - Empty slot renders empty grid: when the slot is absent or returns nothing,
 *     the grid container still renders (with no children) and the block does not
 *     throw (Req 6.5, error-handling "CardGrid empty slot").
 *   - RTL: the grid uses logical layout (auto-flow in the inline direction, no
 *     hard-coded physical left/right), so cards keep author order in the DOM and
 *     reverse visually under `dir="rtl"` (Req 6.12, 14.3).
 *
 * Conventions mirror `pricing-table.test.tsx` / `card.test.tsx`: jsdom
 * environment, a ResizeObserver polyfill installed before the config module is
 * imported, the block pulled from the registered `pageBuilderConfig.components`,
 * and the element rendered through the shared `renderBlock` util (which supplies
 * `BreakpointProvider` so the `withBreakpointResolution` wrapper's
 * `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 7 — CardGrid"
 * Validates: Requirements 6.5, 6.6, 6.7, 6.8, 6.10, 6.12, 6.13
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { renderBlock } from "./test-utils";
import { BreakpointProvider } from "./breakpoint-context";

// Polyfill ResizeObserver for jsdom — must be set before importing config.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation.
const { pageBuilderConfig } = await import("./config");

const CardGrid = pageBuilderConfig.components.CardGrid;

/**
 * Build a Puck slot render function "the Columns way": a real slot is a
 * function returning the nested-block React node. This stand-in returns fixed
 * card-like markup so the grid contents are reproducible in assertions.
 */
function slotFn(...labels: string[]): () => React.ReactNode {
  return () =>
    labels.map((label, i) =>
      React.createElement("article", { key: i, "data-card": label }, label),
    );
}

/** Build CardGrid props from the registered defaults, with overrides applied. */
function cardGridProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(CardGrid.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the CardGrid block with the given props via the BreakpointProvider helper. */
function renderCardGrid(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    CardGrid.render as React.ComponentType<Record<string, unknown>>,
    cardGridProps(overrides),
  );
  return renderBlock(element);
}

/** The single grid container — the element carrying `display: grid`. */
function getGrid(container: HTMLElement): HTMLElement {
  const grid = container.querySelector(
    '[style*="display: grid"]',
  ) as HTMLElement | null;
  expect(grid).toBeTruthy();
  return grid!;
}

describe("CardGrid — slot children laid out in grid (Req 6.6, 6.7)", () => {
  it("renders the slot's children inside a single grid container", () => {
    const { container } = renderCardGrid({
      "card-content": slotFn("Card A", "Card B", "Card C"),
    });

    const grid = getGrid(container);
    expect(grid.style.display).toBe("grid");

    // The three slot children are laid out directly inside the grid.
    const cards = Array.from(grid.querySelectorAll("[data-card]"));
    expect(cards.map((c) => c.textContent)).toEqual(["Card A", "Card B", "Card C"]);
  });

  it("uses gridTemplateColumns: repeat(n, 1fr) for the resolved desktop column count", () => {
    const { container } = renderCardGrid({
      columns: "3",
      "card-content": slotFn("A", "B", "C"),
    });
    const grid = getGrid(container);
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
  });

  it("honours a different resolved column count", () => {
    const { container } = renderCardGrid({
      columns: "4",
      "card-content": slotFn("A", "B", "C", "D"),
    });
    expect(getGrid(container).style.gridTemplateColumns).toBe("repeat(4, 1fr)");
  });

  it("applies the selected gap between grid tracks", () => {
    const { container } = renderCardGrid({
      gap: "lg",
      "card-content": slotFn("A", "B"),
    });
    // The "lg" gap maps to a concrete CSS length on the grid container.
    expect(getGrid(container).style.gap).toBe("40px");
  });

  it("keeps every card the same height via alignItems: stretch", () => {
    const { container } = renderCardGrid({
      "card-content": slotFn("A", "B"),
    });
    expect(getGrid(container).style.alignItems).toBe("stretch");
  });

  it("preserves the slot's child order in the DOM", () => {
    const { container } = renderCardGrid({
      "card-content": slotFn("First", "Second", "Third", "Fourth"),
    });
    const cards = Array.from(
      getGrid(container).querySelectorAll("[data-card]"),
    );
    expect(cards.map((c) => c.textContent)).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
    ]);
  });
});

describe("CardGrid — empty slot renders an empty grid (Req 6.5)", () => {
  it("renders the grid container with no children when the slot is the default empty array", () => {
    // The shipped default for `card-content` is `[]` (not a function), so the
    // block renders an empty grid rather than throwing.
    const { container } = renderCardGrid();
    const grid = getGrid(container);
    expect(grid.style.display).toBe("grid");
    expect(grid.children).toHaveLength(0);
  });

  it("renders the grid container with no children when the slot function returns nothing", () => {
    const { container } = renderCardGrid({
      "card-content": () => null,
    });
    const grid = getGrid(container);
    expect(grid.style.display).toBe("grid");
    expect(grid.children).toHaveLength(0);
  });

  it("renders an empty grid for an empty children list without throwing", () => {
    const { container } = renderCardGrid({
      "card-content": () => [],
    });
    const grid = getGrid(container);
    expect(grid).toBeTruthy();
    expect(grid.querySelectorAll("[data-card]")).toHaveLength(0);
  });

  it("still resolves grid columns when the slot is empty", () => {
    const { container } = renderCardGrid({ columns: "2" });
    expect(getGrid(container).style.gridTemplateColumns).toBe("repeat(2, 1fr)");
  });
});

describe("CardGrid — RTL / logical layout (Req 6.12, 14.3)", () => {
  it("renders children in author order in the DOM (visual reversal is CSS-driven)", () => {
    const { container } = renderCardGrid({
      columns: "3",
      "card-content": slotFn("One", "Two", "Three"),
    });
    const cards = Array.from(
      getGrid(container).querySelectorAll("[data-card]"),
    );
    expect(cards.map((c) => c.textContent)).toEqual(["One", "Two", "Three"]);
  });

  it("preserves author order and carries no physical left/right under dir=rtl", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). The grid auto-flows in the inline direction, so cards reverse to
    // RTL order under `dir="rtl"` without any physical left/right in the markup.
    const element = React.createElement(
      CardGrid.render as React.ComponentType<Record<string, unknown>>,
      cardGridProps({
        columns: "3",
        "card-content": slotFn("الأولى", "الثانية", "الثالثة"),
      }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    // Author order is preserved in the DOM; the browser flips it visually.
    const cards = Array.from(
      getGrid(container).querySelectorAll("[data-card]"),
    );
    expect(cards.map((c) => c.textContent)).toEqual([
      "الأولى",
      "الثانية",
      "الثالثة",
    ]);

    // Guard against any hard-coded physical direction leaking into the markup.
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
    expect(html).not.toContain("padding-left");
    expect(html).not.toContain("padding-right");
  });
});
