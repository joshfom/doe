// @vitest-environment jsdom

/**
 * Property-based tests for ID-leak-free rendering.
 *
 * Feature: builder-canvas-polish-and-inline-richtext
 *
 * Covers:
 * - Property 5: ID-leak-free rendering
 *
 * **Validates: Requirements 5.1, 6.1, 8.3, 13.5**
 *
 * For any PageData `d`, the textContent of the OutlineTree and
 * AncestorBreadcrumb (rendered for any selection state drawn from `d`)
 * SHALL NOT contain any substring equal to a UUID present in `d`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import React from "react";

// ── Polyfills required before importing Puck-dependent modules ───────────────

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
})) as unknown as typeof window.matchMedia;

// Dynamic imports so polyfills are in place before module evaluation
const { render } = await import("@testing-library/react");
const { buildPageTree, buildAncestorPath } = await import("./page-tree");
const { OutlineTree } = await import("./OutlineTree");
const { AncestorBreadcrumb } = await import("./AncestorBreadcrumb");

import type { Config, Data } from "@puckeditor/core";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

// ── UUID regex ───────────────────────────────────────────────────────────────

const UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(
  components: Record<string, { label?: string }> = {},
): Config {
  return { components } as unknown as Config;
}

function makeData(
  content: Array<{ type: string; props: Record<string, unknown> }>,
  zones: Record<
    string,
    Array<{ type: string; props: Record<string, unknown> }>
  >,
): Data {
  return { content, zones } as unknown as Data;
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const blockTypeArb = fc.constantFrom(
  "Section",
  "Text",
  "Image",
  "Columns",
  "Card",
  "Accordion",
  "Button",
  "Hero",
  "Footer",
  "Header",
);

const zoneNameArb = fc.constantFrom(
  "content",
  "left",
  "right",
  "body",
  "header",
  "footer",
  "items",
);

interface BlockItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

/**
 * Generates a valid PageData structure with UUID ids.
 * Uses the same generator pattern as the page-tree property tests.
 */
const pageDataArb: fc.Arbitrary<{
  content: BlockItem[];
  zones: Record<string, BlockItem[]>;
  allIds: string[];
}> = fc
  .record({
    rootCount: fc.integer({ min: 1, max: 8 }),
  })
  .chain(({ rootCount }) => {
    return fc
      .uniqueArray(fc.uuid(), { minLength: rootCount + 2, maxLength: 40 })
      .chain((ids) => {
        return fc
          .tuple(
            fc.array(blockTypeArb, {
              minLength: rootCount,
              maxLength: rootCount,
            }),
            fc.integer({ min: 1, max: Math.min(rootCount, 5) }),
            fc.array(blockTypeArb, { minLength: 2, maxLength: 30 }),
            fc.array(zoneNameArb, { minLength: 2, maxLength: 30 }),
            fc.array(fc.integer({ min: 1, max: 3 }), {
              minLength: 2,
              maxLength: 30,
            }),
            fc.array(fc.boolean(), { minLength: 2, maxLength: 30 }),
          )
          .map(
            ([
              rootTypes,
              numParents,
              nestedTypes,
              zoneNames,
              childCounts,
              depthDecisions,
            ]) => {
              const content: BlockItem[] = [];
              const zones: Record<string, BlockItem[]> = {};
              const allIds: string[] = [];
              let idIndex = 0;

              function nextId(): string {
                if (idIndex >= ids.length) return ids[ids.length - 1] + idIndex;
                return ids[idIndex++];
              }

              let nestedTypeIdx = 0;
              let zoneNameIdx = 0;
              let childCountIdx = 0;
              let depthIdx = 0;

              function nextType(): string {
                return nestedTypes[nestedTypeIdx++ % Math.max(1, nestedTypes.length)];
              }
              function nextZoneName(): string {
                return zoneNames[zoneNameIdx++ % Math.max(1, zoneNames.length)];
              }
              function nextChildCount(): number {
                return childCounts[childCountIdx++ % Math.max(1, childCounts.length)];
              }
              function shouldNest(): boolean {
                return depthDecisions[depthIdx++ % Math.max(1, depthDecisions.length)];
              }

              for (let i = 0; i < rootCount; i++) {
                const id = nextId();
                allIds.push(id);
                content.push({
                  type: rootTypes[i],
                  props: { id },
                });
              }

              const parentsToNest = content.slice(0, numParents);

              function addZoneChildren(
                parentId: string,
                depth: number,
              ): void {
                if (depth > 3 || idIndex >= ids.length - 1) return;

                const zoneName = nextZoneName();
                const zoneKey = `${parentId}:${zoneName}`;
                const count = Math.min(
                  nextChildCount(),
                  ids.length - idIndex,
                );

                if (count <= 0) return;

                const children: BlockItem[] = [];
                for (let i = 0; i < count; i++) {
                  const childId = nextId();
                  allIds.push(childId);
                  children.push({
                    type: nextType(),
                    props: { id: childId },
                  });
                }
                zones[zoneKey] = children;

                for (const child of children) {
                  if (
                    shouldNest() &&
                    depth < 3 &&
                    idIndex < ids.length - 1
                  ) {
                    addZoneChildren(child.props.id, depth + 1);
                  }
                }
              }

              for (const parent of parentsToNest) {
                addZoneChildren(parent.props.id, 1);
              }

              return { content, zones, allIds };
            },
          );
      });
  });

const configArb: fc.Arbitrary<Config> = fc
  .record({
    sectionLabel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
    textLabel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
    imageLabel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
    columnsLabel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
  })
  .map(({ sectionLabel, textLabel, imageLabel, columnsLabel }) => {
    const components: Record<string, { label?: string }> = {};
    if (sectionLabel) components["Section"] = { label: sectionLabel };
    if (textLabel) components["Text"] = { label: textLabel };
    if (imageLabel) components["Image"] = { label: imageLabel };
    if (columnsLabel) components["Columns"] = { label: columnsLabel };
    return makeConfig(components);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Property 5: ID-leak-free rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: builder-canvas-polish-and-inline-richtext, Property 5: ID-leak-free rendering", () => {
  it("OutlineTree textContent contains no UUID substring", () => {
    fc.assert(
      fc.property(pageDataArb, configArb, ({ content, zones, allIds }, config) => {
        const data = makeData(content, zones);
        const tree = buildPageTree(data, config);

        // Render OutlineTree with no selection
        const { container, unmount } = render(
          React.createElement(OutlineTree, {
            tree,
            selectedId: null,
            onSelect: () => {},
          }),
        );

        const textContent = container.textContent ?? "";
        expect(textContent).not.toMatch(UUID_REGEX);

        unmount();
      }),
      { numRuns: 25 },
    );
  });

  it("OutlineTree textContent contains no UUID when a block is selected", () => {
    fc.assert(
      fc.property(
        pageDataArb,
        configArb,
        fc.integer({ min: 0, max: 10000 }),
        ({ content, zones, allIds }, config, pickSeed) => {
          const data = makeData(content, zones);
          const tree = buildPageTree(data, config);

          // Pick a random block to select
          if (allIds.length === 0) return;
          const selectedId = allIds[pickSeed % allIds.length];

          const { container, unmount } = render(
            React.createElement(OutlineTree, {
              tree,
              selectedId,
              onSelect: () => {},
            }),
          );

          const textContent = container.textContent ?? "";
          expect(textContent).not.toMatch(UUID_REGEX);

          unmount();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("AncestorBreadcrumb textContent contains no UUID for any selection", () => {
    fc.assert(
      fc.property(
        pageDataArb,
        configArb,
        fc.integer({ min: 0, max: 10000 }),
        ({ content, zones, allIds }, config, pickSeed) => {
          const data = makeData(content, zones);
          const tree = buildPageTree(data, config);

          // Pick a random block to select
          if (allIds.length === 0) return;
          const selectedId = allIds[pickSeed % allIds.length];

          // Build ancestor path (excludes self — used in ConfigurationPanel header)
          const segments = buildAncestorPath(tree, selectedId);

          if (segments.length === 0) return;

          const { container, unmount } = render(
            React.createElement(AncestorBreadcrumb, {
              segments,
              includeSelf: false,
              onSelect: () => {},
            }),
          );

          const textContent = container.textContent ?? "";
          expect(textContent).not.toMatch(UUID_REGEX);

          unmount();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("AncestorBreadcrumb with includeSelf textContent contains no UUID (StatusBar mode)", () => {
    fc.assert(
      fc.property(
        pageDataArb,
        configArb,
        fc.integer({ min: 0, max: 10000 }),
        ({ content, zones, allIds }, config, pickSeed) => {
          const data = makeData(content, zones);
          const tree = buildPageTree(data, config);

          // Pick a random block to select
          if (allIds.length === 0) return;
          const selectedId = allIds[pickSeed % allIds.length];

          // Build ancestor path and append the selected block itself (StatusBar mode)
          const segments = buildAncestorPath(tree, selectedId);
          const selectedNode = tree.byId.get(selectedId);

          if (!selectedNode) return;

          // Add the selected block as the final segment (includeSelf behavior)
          const segmentsWithSelf = [
            ...segments,
            {
              id: selectedNode.id,
              label: selectedNode.label,
              selector: { zone: selectedNode.zone, index: selectedNode.index },
            },
          ];

          const { container, unmount } = render(
            React.createElement(AncestorBreadcrumb, {
              segments: segmentsWithSelf,
              includeSelf: true,
              onSelect: () => {},
            }),
          );

          const textContent = container.textContent ?? "";
          expect(textContent).not.toMatch(UUID_REGEX);

          unmount();
        },
      ),
      { numRuns: 25 },
    );
  });
});
