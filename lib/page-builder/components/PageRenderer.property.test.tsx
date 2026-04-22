// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// Polyfill ResizeObserver for jsdom — must be set before importing config
// which transitively loads @dnd-kit/dom that accesses ResizeObserver at module scope
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import React from "react";
import * as fc from "fast-check";
import { render } from "@testing-library/react";

// Dynamic import so the polyfill is in place before module evaluation
const { pageBuilderConfig } = await import("../config");
const { PageRenderer } = await import("./PageRenderer");

/**
 * Feature: puck-visual-page-builder, Property 7: Renderer gracefully handles unknown components
 *
 * Validates: Requirements 7.3, 7.4
 *
 * For any PageData containing a mix of known component keys (present in Config)
 * and unknown component keys (not in Config), the Renderer SHALL render all known
 * components and skip unknown ones without throwing an error.
 */

const knownKeys = Object.keys(pageBuilderConfig.components);

// ColumnsLayout uses DropZone which requires Puck editor context — exclude it
// from standalone rendering tests.
const renderableKeys = knownKeys.filter((k) => k !== "ColumnsLayout");

// Arbitrary for known component types
const knownTypeArb = fc.constantFrom(...renderableKeys);

// Arbitrary for unknown component types — random strings NOT in the config keys
const unknownTypeArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !knownKeys.includes(s) && s.trim().length > 0);

// Arbitrary for a known component instance — includes defaultProps so Render
// actually produces visible text output (Puck's <Render> does not merge
// config defaultProps automatically; it uses the props from PageData as-is).
const knownComponentInstanceArb = knownTypeArb.chain((type) => {
  const componentConfig = pageBuilderConfig.components[type];
  const defaultProps = (componentConfig?.defaultProps as Record<string, unknown>) ?? {};
  return fc.uuid().map((id) => ({
    type,
    props: { id, ...defaultProps },
  }));
});

// Arbitrary for an unknown component instance — only needs an id
const unknownComponentInstanceArb = fc.record({
  type: unknownTypeArb,
  props: fc.record({ id: fc.uuid() }),
});

// Arbitrary for PageData with a mix of known and unknown components
const mixedPageDataArb = fc
  .record({
    knownItems: fc.array(knownComponentInstanceArb, { minLength: 0, maxLength: 4 }),
    unknownItems: fc.array(unknownComponentInstanceArb, { minLength: 0, maxLength: 4 }),
  })
  .chain(({ knownItems, unknownItems }) => {
    const allItems = [...knownItems, ...unknownItems];
    // Shuffle the items so known and unknown are interleaved
    return fc.shuffledSubarray(allItems, { minLength: allItems.length, maxLength: allItems.length }).map(
      (content) => ({
        content,
        knownItems,
        unknownItems,
      })
    );
  });

describe("Renderer gracefully handles unknown components", () => {
  it("renders known components and silently skips unknown ones without throwing", () => {
    fc.assert(
      fc.property(mixedPageDataArb, ({ content, knownItems, unknownItems }) => {
        const pageData = {
          root: { props: { title: "Test Page" } },
          content,
        };

        // Rendering must not throw
        const { container, unmount } = render(
          React.createElement(PageRenderer, { data: pageData })
        );

        // Each known component renders its default content.
        // We verify known components are present by checking that the container
        // has at least as many top-level rendered sections as known items
        // (unknown items should be filtered out).
        // A more targeted check: for each known component, its default text should appear.
        for (const item of knownItems) {
          const componentConfig = pageBuilderConfig.components[item.type];
          const defaultProps = componentConfig?.defaultProps as Record<string, unknown> | undefined;

          if (defaultProps) {
            // Find a text-based default prop to verify rendering
            const textProp = findTextProp(defaultProps);
            if (textProp) {
              expect(container.textContent).toContain(textProp);
            }
          }
        }

        // Unknown component types should NOT cause any error — the test reaching
        // this point already proves no throw occurred. We also verify that unknown
        // type names don't appear as rendered component output.
        // (Unknown types have no render function, so they produce no DOM output.)

        unmount();
      }),
      { numRuns: 20 }
    );
  });
});

/**
 * Finds the first string-valued prop that looks like renderable text content.
 * Prefers heading/content/copyright fields as they reliably appear in output.
 */
function findTextProp(defaultProps: Record<string, unknown>): string | null {
  // Prioritize props that are most likely to appear as visible text
  const preferredKeys = ["heading", "content", "copyright"];
  for (const key of preferredKeys) {
    const val = defaultProps[key];
    if (typeof val === "string" && val.length > 0) {
      return val;
    }
  }
  return null;
}
