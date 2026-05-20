/**
 * Property-based tests for page-tree derivation.
 *
 * Feature: builder-canvas-polish-and-inline-richtext
 *
 * Covers:
 * - Property 1: Tree completeness
 * - Property 2: Breadcrumb ancestry
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildPageTree, buildAncestorPath } from "./page-tree";
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

/** Generate a unique UUID-like id. We use fc.uuid() for realistic IDs. */
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

/**
 * Generates a valid PageData structure with:
 * - 1-20 root content items, each with a unique UUID id and a random type
 * - For some items, nested zones (1-3 levels deep)
 * - Zone keys follow the "{ownerId}:{zoneName}" convention
 * - All IDs are unique across the entire data structure
 */
interface BlockItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

const pageDataArb: fc.Arbitrary<{
  content: BlockItem[];
  zones: Record<string, BlockItem[]>;
  allIds: string[];
}> = fc
  .record({
    rootCount: fc.integer({ min: 1, max: 10 }),
    seed: fc.integer({ min: 0, max: 1000000 }),
  })
  .chain(({ rootCount }) => {
    // Generate enough unique IDs for a tree up to ~60 nodes
    return fc
      .uniqueArray(fc.uuid(), { minLength: rootCount, maxLength: 60 })
      .chain((ids) => {
        return fc
          .tuple(
            // For each root item, pick a type
            fc.array(blockTypeArb, {
              minLength: rootCount,
              maxLength: rootCount,
            }),
            // Decide how many root items get children (0 to rootCount)
            fc.integer({ min: 0, max: Math.min(rootCount, 5) }),
            // For nested items, pick types
            fc.array(blockTypeArb, { minLength: 0, maxLength: 50 }),
            // Zone names for nesting
            fc.array(zoneNameArb, { minLength: 0, maxLength: 50 }),
            // How many children per zone (1-4)
            fc.array(fc.integer({ min: 1, max: 4 }), {
              minLength: 0,
              maxLength: 50,
            }),
            // Depth decisions (whether to nest further)
            fc.array(fc.boolean(), { minLength: 0, maxLength: 50 }),
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

              // Add nested zones for some root items (up to numParents)
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

/**
 * Minimal config arbitrary that maps types to optional labels.
 */
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
// Property 1: Tree completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 8.2, 13.1**
 *
 * Property 1: Tree completeness
 *
 * For any valid PageData value d, the PageTree derived from d via
 * buildPageTree(d, config) SHALL contain exactly one PageTreeNode per block
 * present in d.content or any value array of d.zones, with no duplicate IDs
 * and no omitted IDs.
 */
describe("Feature: builder-canvas-polish-and-inline-richtext, Property 1: Tree completeness", () => {
  it("every block in data appears exactly once in the tree", () => {
    fc.assert(
      fc.property(pageDataArb, configArb, ({ content, zones, allIds }, config) => {
        const data = makeData(content, zones);
        const tree = buildPageTree(data, config);

        // Collect all block IDs from the input data
        const expectedIds = new Set<string>();
        for (const item of content) {
          expectedIds.add(item.props.id);
        }
        for (const items of Object.values(zones)) {
          for (const item of items) {
            expectedIds.add((item as BlockItem).props.id);
          }
        }

        // The tree's byId map should contain exactly one entry per block
        expect(tree.byId.size).toBe(expectedIds.size);

        // No duplicate IDs — every expected ID appears in the tree
        for (const id of expectedIds) {
          expect(tree.byId.has(id)).toBe(true);
        }

        // No extra IDs — every tree node corresponds to an input block
        for (const [id] of tree.byId) {
          expect(expectedIds.has(id)).toBe(true);
        }

        // parentOf map has the same size
        expect(tree.parentOf.size).toBe(expectedIds.size);
      }),
      { numRuns: 25 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Breadcrumb ancestry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.3, 6.2, 13.2**
 *
 * Property 2: Breadcrumb ancestry
 *
 * For any PageTree t and any node n in t, the output of
 * buildAncestorPath(t, n.id) SHALL be an array [root, a_1, a_2, ..., a_k]
 * such that a_1 is a root-level node (or the path is just [Page] for root
 * nodes), a_k.id === n.parentId (or a_k is the Page segment for root nodes),
 * and for every 0 < i ≤ k, a_{i-1} is the parent of a_i in t.
 */
describe("Feature: builder-canvas-polish-and-inline-richtext, Property 2: Breadcrumb ancestry", () => {
  it("ancestor path is valid for every node in the tree", () => {
    fc.assert(
      fc.property(pageDataArb, configArb, ({ content, zones }, config) => {
        const data = makeData(content, zones);
        const tree = buildPageTree(data, config);

        for (const [id, node] of tree.byId) {
          const path = buildAncestorPath(tree, id);

          // Path should never be empty for a node that exists in the tree
          expect(path.length).toBeGreaterThanOrEqual(1);

          // First segment is always the synthetic "Page" root
          expect(path[0].id).toBeNull();
          expect(path[0].label).toBe("Page");
          expect(path[0].selector).toBeNull();

          if (node.parentId === null) {
            // Root-level node: path should be just [Page]
            expect(path).toHaveLength(1);
          } else {
            // Non-root node: last segment's id should equal node's parentId
            const lastSegment = path[path.length - 1];
            expect(lastSegment.id).toBe(node.parentId);

            // Every non-Page segment should correspond to an actual node in the tree
            for (let i = 1; i < path.length; i++) {
              const segment = path[i];
              expect(segment.id).not.toBeNull();
              expect(tree.byId.has(segment.id!)).toBe(true);

              // Segment's selector should match the node's zone and index
              const segmentNode = tree.byId.get(segment.id!)!;
              expect(segment.selector).toEqual({
                zone: segmentNode.zone,
                index: segmentNode.index,
              });
            }

            // Verify parent chain: for every 0 < i ≤ k, a_{i-1} is the parent of a_i
            for (let i = 2; i < path.length; i++) {
              const childNode = tree.byId.get(path[i].id!)!;
              const parentSegment = path[i - 1];
              expect(childNode.parentId).toBe(parentSegment.id);
            }

            // The first non-Page segment should be a root-level node
            if (path.length > 1) {
              const firstAncestor = tree.byId.get(path[1].id!)!;
              expect(firstAncestor.parentId).toBeNull();
            }
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});
