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

  it("returns null for chrome slot keys", () => {
    const chromeKeys = [
      "header",
      "headerActions",
      "actionBar",
      "fields",
      "fieldLabel",
      "components",
      "componentItem",
      "drawer",
      "drawerItem",
      "outline",
    ] as const;

    for (const key of chromeKeys) {
      const fn = headlessOverrides[key];
      expect(typeof fn).toBe("function");
      // @ts-expect-error — exercising the render function with a permissive arg
      expect(fn?.({ children: <span /> })).toBeNull();
    }
  });
});
