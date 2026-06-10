// @vitest-environment jsdom
/**
 * Public HTML stability — Property 5.
 *
 * Spec: custom-branded-page-builder — task 12.4
 * _Validates: Requirements 16.1, 21.5_
 *
 * For any PageData containing **no** breakpoint-aware fields and **no**
 * `_visibility` flags, the public `<PageRenderer>` MUST render output
 * byte-identical to the pre-feature baseline (i.e. just the `<Render>`
 * tree, with no extra `<style>` element).
 *
 * Tag: Feature: custom-branded-page-builder, Property 5: Public HTML stability
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

const { pageBuilderConfig } = await import("./config");
const { PageRenderer } = await import("./components/PageRenderer");

// Some block runtimes (FeaturedProjects, FeaturedCommunities, ProjectSection)
// require a QueryClientProvider; others render standalone. Property 5 is about
// byte-identical output, not block coverage, so restrict to a stable set of
// safe components and additionally wrap in a provider as a safety net.
const EXCLUDED = new Set([
  "Columns",
  "ColumnsLayout",
  "FeaturedProjects",
  "FeaturedCommunities",
  "ProjectSection",
  "ContactLocationsMap",
  // Req 11.3: Countdown is the single documented exclusion with a justified
  // non-deterministic runtime. Its server-rendered (pre-tick) markup IS
  // byte-stable, but after hydration the CountdownRuntime starts a 1s interval
  // that swaps the aria-live region to live remaining time, so repeated public
  // renders are not byte-identical once the timer ticks.
  "Countdown",
]);
const knownKeys = Object.keys(pageBuilderConfig.components).filter(
  (k) => !EXCLUDED.has(k),
);

const itemArb = fc.constantFrom(...knownKeys).chain((type) => {
  const defaults =
    (pageBuilderConfig.components[type]?.defaultProps as Record<string, unknown>) ?? {};
  return fc.uuid().map((id) => ({ type, props: { id, ...defaults } }));
});

const baselinePageDataArb = fc.record({
  root: fc.constant({ props: { title: "Stability" } }),
  content: fc.array(itemArb, { minLength: 0, maxLength: 4 }),
});

function withProvider(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe("Feature: custom-branded-page-builder — Property 5: Public HTML stability", () => {
  it("emits byte-identical HTML for legacy data regardless of the breakpointCss flag", () => {
    fc.assert(
      fc.property(baselinePageDataArb, (data) => {
        const off = render(withProvider(React.createElement(PageRenderer, { data })));
        const baseline = off.container.innerHTML;
        off.unmount();

        const on = render(
          withProvider(
            React.createElement(PageRenderer, { data, breakpointCss: true }),
          ),
        );
        const withFlag = on.container.innerHTML;
        on.unmount();

        // Property 5: no breakpoint-aware fields, no visibility flags →
        // CSS is empty, no breakpoint-css <style> tag is emitted,
        // byte-identical output. (Some block components legitimately emit
        // their own <style> tags — those appear in both baseline and
        // withFlag and are part of the byte-identical comparison.)
        expect(withFlag).toBe(baseline);
        expect(withFlag).not.toContain("data-pb-breakpoint-css");
      }),
      { numRuns: 25 },
    );
  });
});
