// @vitest-environment jsdom
/**
 * Block library byte-stability — Property 3.
 *
 * Spec: page-builder-block-library — task 16.1
 * _Validates: Requirements 11.2, 11.3_
 *
 * For any fixed props with no breakpoint-aware fields and no `_visibility`
 * flags, the public `<PageRenderer>` output is byte-identical across two
 * independent renders — for **every new block** added by this feature EXCEPT
 * Countdown (the single documented exclusion, Req 11.3, whose post-hydration
 * live region ticks on a 1s interval).
 *
 * Mirrors the setup of `public-html-stability.property.test.ts` (jsdom env,
 * ResizeObserver polyfill, fast-check generators over `defaultProps`, wrap in a
 * QueryClientProvider as a safety net) but is scoped to the ten new blocks so a
 * regression in any one of them is attributed precisely.
 *
 * Tag: Feature: page-builder-block-library, Property 3: Byte-stable public render
 */
import { describe, it, expect } from "vitest";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import React from "react";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { PageData } from "./types";

const { pageBuilderConfig } = await import("./config");
const { PageRenderer } = await import("./components/PageRenderer");

// Every block introduced by the page-builder-block-library feature.
const NEW_BLOCKS = [
  "CTA",
  "Testimonial",
  "TabGroup",
  "LogoCloud",
  "PricingTable",
  "Card",
  "CardGrid",
  "SocialLinks",
  "Breadcrumbs",
  // NOTE: "Countdown" is intentionally omitted. Req 11.3 documents it as the
  // single exclusion: its pre-tick server markup IS byte-stable, but after
  // hydration `CountdownRuntime` starts a 1s interval that swaps the aria-live
  // region to live remaining time, so repeated public renders are not
  // byte-identical once the timer ticks. It is covered by its own hydration
  // test (task 13.4) and is in the exclusion set of the shared
  // `public-html-stability.property.test.ts` (task 13.5).
] as const;

// Guard: every name above must actually be a registered component, so this test
// fails loudly if a block is renamed/removed rather than silently passing.
const registered = new Set(Object.keys(pageBuilderConfig.components));
for (const name of NEW_BLOCKS) {
  if (!registered.has(name)) {
    throw new Error(
      `block-library-stability: "${name}" is not a registered component`,
    );
  }
}

/** One content item for a given block type, seeded from its registered defaults. */
function itemArbFor(type: string) {
  const defaults =
    (pageBuilderConfig.components[type]?.defaultProps as Record<
      string,
      unknown
    >) ?? {};
  return fc.uuid().map((id) => ({ type, props: { id, ...defaults } }));
}

const allItemsArb = fc.constantFrom(...NEW_BLOCKS).chain((type) => itemArbFor(type));

const pageDataArb = fc.record({
  root: fc.constant({ props: { title: "Stability" } }),
  content: fc.array(allItemsArb, { minLength: 1, maxLength: 4 }),
});

function withProvider(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

function renderOnce(data: unknown): string {
  const r = render(
    withProvider(React.createElement(PageRenderer, { data: data as PageData })),
  );
  const html = r.container.innerHTML;
  r.unmount();
  return html;
}

describe("Feature: page-builder-block-library — Property 3: Byte-stable public render", () => {
  it("emits byte-identical HTML across two independent renders for every new block (except Countdown)", () => {
    fc.assert(
      fc.property(pageDataArb, (data) => {
        const first = renderOnce(data);
        const second = renderOnce(data);
        // Property 3: fixed props, no breakpoint-aware fields, no _visibility →
        // byte-identical output across renders, and no breakpoint-css <style>.
        expect(second).toBe(first);
        expect(second).not.toContain("data-pb-breakpoint-css");
      }),
      { numRuns: 5 },
    );
  });

  it("is byte-stable for each new block in isolation", () => {
    for (const type of NEW_BLOCKS) {
      fc.assert(
        fc.property(itemArbFor(type), (item) => {
          const data = {
            root: { props: { title: "Stability" } },
            content: [item],
          };
          const first = renderOnce(data);
          const second = renderOnce(data);
          expect(second).toBe(first);
        }),
        { numRuns: 3 },
      );
    }
  });
});
