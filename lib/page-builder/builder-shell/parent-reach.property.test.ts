/**
 * Property-based tests for parent-reach selection.
 *
 * Feature: builder-canvas-polish-and-inline-richtext
 *
 * Covers:
 * - Property 3: Parent reach
 *
 * **Validates: Requirements 7.1, 13.3**
 *
 * For any PageData `d` and any pair of blocks `(a, b)` where `b` is a
 * descendant of `a`, activating the breadcrumb segment for `a` while `b`
 * is selected SHALL result in `a` being the selected block (i.e., the
 * segment's selector resolves to `a`).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildPageTree, buildAncestorPath } from "./page-tree";
import type { PageTreeNode } from "./page-tree";
import type { Config, Data } from "@puckeditor/core";

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
 * Generates a valid PageData structure with nested blocks (content + zones).
 * Ensures at least one ancestor-descendant pair exists for Property 3 testing.
 */
const pageDataWithDescendantsArb: fc.Arbitrary<{
  content: BlockItem[];
  zones: Record<string, BlockItem[]>;
  allIds: string[];
}> = fc
  .record({
    rootCount: fc.integer({ min: 1, max: 8 }),
  })
  .chain(({ rootCount }) => {
    return fc
      .uniqueArray(fc.uuid(), { minLength: rootCount + 2, maxLength: 50 })
      .chain((ids) => {
        return fc
          .tuple(
            fc.array(blockTypeArb, {
              minLength: rootCount,
              maxLength: rootCount,
            }),
            // Ensure at least 1 parent gets children for descendant pairs
            fc.integer({ min: 1, max: Math.min(rootCount, 5) }),
            fc.array(blockTypeArb, { minLength: 2, maxLength: 40 }),
            fc.array(zoneNameArb, { minLength: 2, maxLength: 40 }),
            fc.array(fc.integer({ min: 1, max: 4 }), {
              minLength: 2,
              maxLength: 40,
            }),
            fc.array(fc.boolean(), { minLength: 2, maxLength: 40 }),
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

              // Create root items
              for (let i = 0; i < rootCount; i++) {
                const id = nextId();
                allIds.push(id);
                content.push({
                  type: rootTypes[i],
                  props: { id },
                });
              }

              // Add nested zones — ensure at least one parent gets children
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

                // Optionally nest deeper for some children
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

// ── Helpers for Property 3 ───────────────────────────────────────────────────

/**
 * Collect all descendants of a given node in the tree.
 */
function collectDescendants(
  node: PageTreeNode,
  tree: ReturnType<typeof buildPageTree>,
): string[] {
  const descendants: string[] = [];
  const stack: PageTreeNode[] = [];

  // Push all children of the node
  for (const zoneChildren of Object.values(node.childrenByZone)) {
    for (const child of zoneChildren) {
      stack.push(child);
    }
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    descendants.push(current.id);
    for (const zoneChildren of Object.values(current.childrenByZone)) {
      for (const child of zoneChildren) {
        stack.push(child);
      }
    }
  }

  return descendants;
}

/**
 * Resolve a PuckSelector to the block id it points to, given the data.
 */
function resolveSelector(
  selector: { zone: string; index: number },
  data: Data,
): string | null {
  const { zone, index } = selector;
  if (zone === "root:default-zone") {
    const items = (data as unknown as { content: BlockItem[] }).content;
    if (items && index >= 0 && index < items.length) {
      return items[index].props.id;
    }
    return null;
  }
  const zones = (data as unknown as { zones: Record<string, BlockItem[]> }).zones;
  if (zones && zones[zone] && index >= 0 && index < zones[zone].length) {
    return zones[zone][index].props.id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Parent reach
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.1, 13.3**
 *
 * Property 3: Parent reach
 *
 * For any PageData `d` and any pair of blocks `(a, b)` where `b` is a
 * descendant of `a`, activating the breadcrumb segment for `a` while `b`
 * is selected SHALL result in `a` being the selected block (i.e., the
 * segment's selector resolves to `a`).
 */
describe("Feature: builder-canvas-polish-and-inline-richtext, Property 3: Parent reach", () => {
  it("activating an ancestor's breadcrumb segment resolves to that ancestor", () => {
    fc.assert(
      fc.property(
        pageDataWithDescendantsArb,
        configArb,
        fc.integer({ min: 0, max: 10000 }),
        ({ content, zones, allIds }, config, pickSeed) => {
          const data = makeData(content, zones);
          const tree = buildPageTree(data, config);

          // Find all ancestor-descendant pairs in the tree.
          // We pick one pair deterministically using pickSeed.
          const pairs: Array<{ ancestorId: string; descendantId: string }> = [];

          for (const [id, node] of tree.byId) {
            const descendants = collectDescendants(node, tree);
            for (const descId of descendants) {
              pairs.push({ ancestorId: id, descendantId: descId });
            }
          }

          // If no ancestor-descendant pairs exist, the property is vacuously true
          if (pairs.length === 0) return;

          // Pick a pair deterministically
          const pair = pairs[pickSeed % pairs.length];
          const { ancestorId, descendantId } = pair;

          // Build the ancestor path for the descendant (b)
          const ancestorPath = buildAncestorPath(tree, descendantId);

          // The ancestor path should contain a segment for the ancestor (a)
          const segmentForA = ancestorPath.find((seg) => seg.id === ancestorId);
          expect(segmentForA).toBeDefined();

          // The segment's selector should not be null (only "Page" has null selector)
          expect(segmentForA!.selector).not.toBeNull();

          // Resolve the selector against the data — it should point to ancestor `a`
          const resolvedId = resolveSelector(segmentForA!.selector!, data);
          expect(resolvedId).toBe(ancestorId);
        },
      ),
      { numRuns: 25 },
    );
  });
});
