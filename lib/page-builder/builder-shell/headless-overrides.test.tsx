// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// Polyfills required by Puck under jsdom — must run before importing Puck.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

import React from "react";
import { render } from "@testing-library/react";
const { Puck } = await import("@puckeditor/core");
const { headlessOverrides } = await import("./headless-overrides");

const minimalConfig = {
  components: {
    Box: {
      fields: {},
      defaultProps: {},
      render: () => <div data-testid="box-rendered">Box</div>,
    },
  },
} as const;

const emptyData = { content: [], root: { props: {} } };

describe("headlessOverrides", () => {
  it("renders no Puck default chrome when used with <Puck.Preview /> children", () => {
    const { container } = render(
      <Puck config={minimalConfig as never} data={emptyData as never} overrides={headlessOverrides}>
        <Puck.Preview />
      </Puck>,
    );

    // None of the Puck default layout regions should appear.
    const layoutSelectors = [
      "[class*='PuckLayout-header']",
      "[class*='PuckLayout-nav']",
      "[class*='PuckLayout-leftSideBar']",
      "[class*='PuckLayout-rightSideBar']",
      "[class*='PuckHeader']",
      "[class*='Drawer']",
    ];

    for (const selector of layoutSelectors) {
      expect(container.querySelector(selector)).toBeNull();
    }
  });

  it("returns an empty fragment for chrome slot keys", () => {
    // `componentItem` is intentionally NOT in this list — it now wraps each
    // rendered block with insertion-button affordances (Task 8.1, Reqs 4.1
    // through 4.3). Its behaviour is asserted separately below.
    const chromeKeys = [
      "header",
      "headerActions",
      "actionBar",
      "fields",
      "fieldLabel",
      "components",
      "drawer",
      "drawerItem",
      "outline",
    ] as const;

    for (const key of chromeKeys) {
      const fn = headlessOverrides[key];
      expect(typeof fn).toBe("function");
      // The placeholder renders an empty fragment, which produces no visible
      // DOM when mounted. We assert the returned element type is a fragment
      // rather than a concrete component, which is the property that keeps
      // Puck's default chrome from leaking through.
      // @ts-expect-error — exercising the render function with a permissive arg
      const result = fn?.({ children: <span /> });
      expect(React.isValidElement(result)).toBe(true);
      expect((result as React.ReactElement).type).toBe(React.Fragment);
    }
  });

  it("uses the insertion-button override for componentItem", () => {
    // The override should be a function (the InsertionButtonLayer entry
    // point) rather than the null-rendering placeholder.
    expect(typeof headlessOverrides.componentItem).toBe("function");
    // When invoked without positional metadata (no `index`/`zone`), the
    // override degrades to an identity wrapper that renders the children
    // unchanged so we never accidentally hide canvas content.
    // @ts-expect-error — exercising the render function with a permissive arg
    const result = headlessOverrides.componentItem?.({
      children: <span data-testid="passthrough" />,
      name: "Heading",
    });
    expect(result).not.toBeNull();
  });
});
