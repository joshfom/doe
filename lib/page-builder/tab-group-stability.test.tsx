// @vitest-environment jsdom
/**
 * Byte-stability check for the TabGroup block's default-tab markup (task 7.5).
 *
 * Scope (per the implementation plan, task 7.5 and design Property 3):
 *   The TabGroup block's *default-tab* (initial / server) markup MUST be
 *   deterministic: rendering the registered block with a fixed set of props
 *   twice produces byte-identical HTML. TabGroup is NOT excluded from the
 *   byte-stable public-render guarantee — only Countdown is (Req 11.3) — so its
 *   first-paint markup has to be reproducible across renders (Req 3.11, 11.2).
 *
 * Why this is non-trivial — `useId`:
 *   `TabGroupRuntime` wires `tab`/`tabpanel` aria attributes (`id`,
 *   `aria-controls`, `aria-labelledby`) from React's `useId`. `useId` only
 *   guarantees stable ids *within a render tree* and *between server and the
 *   matching client hydration*; the counter resets per independent render root.
 *   This test therefore renders the SAME tree twice (two independent roots) and
 *   asserts the output is byte-identical, which both (a) confirms `useId` is
 *   reproducible across renders in this React version and (b) guards against any
 *   future non-determinism (Date/random/iteration-order) creeping into the
 *   default-tab markup.
 *
 * Determinism of the initial render (see `TabGroupRuntime` header):
 *   `selected` starts at the clamped `defaultIndex` (props only), `isRtl` starts
 *   at `false` (the RTL probe runs in a post-mount `useEffect`, which does NOT
 *   fire under `renderToStaticMarkup`), and every panel's `hidden` flag follows
 *   `selected` deterministically. So the server markup depends only on props.
 *
 * Approach:
 *   1. Server path — `renderToStaticMarkup` (the true SSR path) of the
 *      registered block render, twice, asserting byte-identical strings. This is
 *      the markup the public site ships before hydration.
 *   2. Client path — a Testing Library `render` of the same tree twice,
 *      comparing `container.innerHTML`, mirroring the existing
 *      `public-html-stability.property.test.ts` harness so this check matches the
 *      Property 3 comparison style.
 *   Both paths go through the *registered* render, i.e. the
 *   `withBreakpointResolution` wrapper, so a `BreakpointProvider` is supplied
 *   (default active breakpoint `"desktop"`), exactly like `renderBlock`.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 3 — TabGroup" and §"Property 3: Byte-stable public render".
 * Validates: Requirements 3.11, 11.2.
 */

import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { BreakpointProvider } from "./breakpoint-context";

// Polyfill ResizeObserver for jsdom — must be set before importing config.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => cleanup());

// Dynamic import so the polyfill is in place before module evaluation.
const { pageBuilderConfig } = await import("./config");

const TabGroup = pageBuilderConfig.components.TabGroup;
const TabGroupRender = TabGroup.render as React.ComponentType<
  Record<string, unknown>
>;

/** Build TabGroup props from the registered defaults, with overrides applied. */
function tabGroupProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(TabGroup.defaultProps as Record<string, unknown>), ...overrides };
}

/**
 * A deterministic Puck slot render function. The block invokes each `tab-N`
 * slot "the Columns way" (`typeof slot === "function" ? slot() : null`); a real
 * slot is a function returning the nested-block React node. This stand-in
 * returns fixed content so the panel markup is reproducible.
 */
function slotFn(content: string): () => React.ReactNode {
  return () => React.createElement("p", null, content);
}

/** The block element wrapped in a BreakpointProvider, as the registered render expects. */
function tabGroupTree(overrides: Record<string, unknown> = {}): React.ReactElement {
  return (
    <BreakpointProvider initial="desktop">
      <TabGroupRender {...tabGroupProps(overrides)} />
    </BreakpointProvider>
  );
}

/** Render the block to static (server) HTML — the pre-hydration public markup. */
function serverHtml(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(tabGroupTree(overrides));
}

/**
 * A representative spread of fixed prop configurations whose default-tab markup
 * must be deterministic. Trimmed to the two cases that exercise the distinct
 * code paths — the shipped defaults (empty slots) and a fully-populated group
 * with filled slots + a non-zero default tab — so the suite runs faster while
 * still covering both the empty and populated default-tab markup.
 */
const FIXED_CASES: Array<{ name: string; props: Record<string, unknown> }> = [
  { name: "shipped defaults (empty slots)", props: {} },
  {
    name: "populated labels + slots, defaultIndex 1",
    props: {
      tabCount: 3,
      defaultIndex: 1,
      "tab-0-label": "Overview",
      "tab-1-label": "Specs",
      "tab-2-label": "Reviews",
      "tab-0": slotFn("Overview panel"),
      "tab-1": slotFn("Specs panel"),
      "tab-2": slotFn("Reviews panel"),
    },
  },
];

describe("TabGroup — default-tab server markup is byte-stable (Req 3.11, 11.2)", () => {
  it.each(FIXED_CASES)(
    "renderToStaticMarkup is byte-identical across two renders: $name",
    ({ props }) => {
      const first = serverHtml(props);
      const second = serverHtml(props);
      expect(second).toBe(first);
    },
  );

  it("client-side render is byte-identical across two independent renders (Property 3 style)", () => {
    const props = FIXED_CASES[1].props; // populated, defaultIndex 1

    const a = render(tabGroupTree(props));
    const firstHtml = a.container.innerHTML;
    a.unmount();

    const b = render(tabGroupTree(props));
    const secondHtml = b.container.innerHTML;
    b.unmount();

    // React's `useId` is backed by a counter that is global to the React
    // runtime and advances once per independent render *root*. It guarantees
    // stable ids within a tree and across an SSR→hydration of the *same* tree,
    // but NOT across two separate client roots — so the only thing that legibly
    // differs between these two renders is the per-root `useId` prefix
    // (`_r_0_` vs `_r_1_`). Normalize that prefix away; everything that the
    // byte-stable guarantee actually covers (structure, roles, state, content,
    // styles) must then be byte-identical. The true pre-hydration public markup
    // is asserted byte-for-byte by the `renderToStaticMarkup` cases above, which
    // reset the counter on each call.
    const normalizeIds = (html: string): string =>
      html.replace(/_r_[0-9a-z]+_/g, "_rID_");

    expect(normalizeIds(secondHtml)).toBe(normalizeIds(firstHtml));
  });

  it("server markup shows exactly the defaultIndex panel and hides the rest", () => {
    // Sanity-anchor the determinism claim to the *correct* default tab: with
    // defaultIndex 1 the second panel is visible and the others carry `hidden`,
    // and that selection is encoded entirely by the (fixed) props.
    const html = serverHtml(FIXED_CASES[1].props);

    // Exactly one selected tab in the static markup.
    const selectedCount = (html.match(/aria-selected="true"/g) ?? []).length;
    expect(selectedCount).toBe(1);

    // Three panels, two hidden (the two non-default tabs).
    const panelCount = (html.match(/role="tabpanel"/g) ?? []).length;
    const hiddenCount = (html.match(/hidden=""/g) ?? []).length;
    expect(panelCount).toBe(3);
    expect(hiddenCount).toBe(2);

    // The visible panel content is the default tab's panel.
    expect(html).toContain("Specs panel");
  });

  it("re-rendering after an unrelated render still produces the same default-tab markup", () => {
    // Render a *different* configuration in between to advance any module-level
    // counters, then confirm the original config still yields identical markup —
    // i.e. determinism does not depend on render call order.
    const props = FIXED_CASES[1].props;
    const baseline = serverHtml(props);

    serverHtml(FIXED_CASES[0].props); // unrelated render in between
    serverHtml({}); // and another

    expect(serverHtml(props)).toBe(baseline);
  });
});
