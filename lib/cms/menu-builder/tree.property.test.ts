import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildMenuTree, flattenMenuTree } from "@/lib/cms/utils/menu-tree";
import type { FlatMenuItem } from "@/lib/cms/utils/menu-tree";
import type { ItemType, DropdownType } from "@/lib/cms/types";

// ── Shared arbitraries ───────────────────────────────────────────────────────

const itemTypeArb: fc.Arbitrary<ItemType> = fc.constantFrom(
  "link",
  "dropdown",
  "mega"
);

function dropdownTypeForItemType(
  itemType: ItemType
): DropdownType | null {
  switch (itemType) {
    case "link":
      return null;
    case "dropdown":
      return "simple";
    case "mega":
      return "mega";
  }
}

/**
 * Generate a valid flat array of menu items with consistent parentId references.
 *
 * Strategy: generate items one at a time. Each new item can either be a root
 * item (parentId = null) or reference any previously generated non-"link" item
 * as its parent — ensuring all parentId references are valid and link items
 * never have children. Positions are assigned sequentially per parent group.
 */
const flatMenuItemsArb: fc.Arbitrary<FlatMenuItem[]> = fc
  .integer({ min: 1, max: 15 })
  .chain((count) => {
    return fc.tuple(
      fc.uuid(),
      fc.array(
        fc.tuple(
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
          itemTypeArb,
          fc.integer({ min: 1, max: 6 })
        ),
        { minLength: count, maxLength: count }
      )
    );
  })
  .map(([menuId, rawItems]) => {
    const items: FlatMenuItem[] = [];
    // Track which ids are eligible parents (non-link items)
    const eligibleParentIds: string[] = [];
    // Track position counters per parentId group
    const positionCounters = new Map<string | null, number>();

    for (const [id, label, url, icon, itemType, megaCols] of rawItems) {
      // Decide parentId: null (root) or pick from eligible parents
      let parentId: string | null = null;
      if (eligibleParentIds.length > 0) {
        // Use a deterministic pick — roughly half root, half nested
        const pickIndex = items.length % (eligibleParentIds.length + 1);
        if (pickIndex < eligibleParentIds.length) {
          parentId = eligibleParentIds[pickIndex];
        }
      }

      // Assign sequential position within this parent group
      const currentPos = positionCounters.get(parentId) ?? 0;
      positionCounters.set(parentId, currentPos + 1);

      const item: FlatMenuItem = {
        id,
        menuId,
        parentId,
        label,
        url,
        icon,
        itemType,
        dropdownType: dropdownTypeForItemType(itemType),
        megaColumns: itemType === "mega" ? Math.min(Math.max(megaCols, 2), 4) : 3,
        position: currentPos,
      };

      items.push(item);

      // Only non-link items can be parents
      if (itemType !== "link") {
        eligibleParentIds.push(id);
      }
    }

    return items;
  });

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Menu tree build/flatten round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.5, 13.7**
 *
 * Property 2: Round-trip consistency
 *
 * For any valid flat array of menu items (with consistent parentId references
 * and position values), `flattenMenuTree(buildMenuTree(items))` SHALL produce
 * an array containing the same items with equivalent id, parentId, and position
 * values as the original input.
 */
describe("Feature: menu-builder, Property 2: Round-trip consistency", () => {
  it("flattenMenuTree(buildMenuTree(items)) preserves all item ids, parentIds, and positions", () => {
    fc.assert(
      fc.property(flatMenuItemsArb, (items) => {
        const tree = buildMenuTree(items);
        const flattened = flattenMenuTree(tree);

        // Same number of items
        expect(flattened).toHaveLength(items.length);

        // Build lookup maps for comparison
        const originalById = new Map(items.map((item) => [item.id, item]));
        const flattenedById = new Map(flattened.map((item) => [item.id, item]));

        // Every original item must exist in the flattened result
        for (const original of items) {
          const roundTripped = flattenedById.get(original.id);
          expect(roundTripped).toBeDefined();
          expect(roundTripped!.id).toBe(original.id);
          expect(roundTripped!.parentId).toBe(original.parentId);
          expect(roundTripped!.position).toBe(original.position);
        }

        // Every flattened item must exist in the original
        for (const flat of flattened) {
          expect(originalById.has(flat.id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 6: Nesting depth validation
// ─────────────────────────────────────────────────────────────────────────────

import { validateNestingDepth } from "@/lib/cms/utils/menu-tree";

/**
 * Generate a valid set of items where no item exceeds depth 2.
 * root=0, child=1, grandchild=2.
 *
 * Strategy: generate items layer by layer up to depth 2.
 * Each item at depth < 2 can serve as a parent for the next layer.
 */
const validNestingItemsArb: fc.Arbitrary<{ id: string; parentId: string | null }[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((count) =>
    fc.array(fc.uuid(), { minLength: count, maxLength: count })
  )
  .chain((ids) => {
    // Assign each item a depth of 0, 1, or 2
    return fc
      .array(fc.integer({ min: 0, max: 2 }), {
        minLength: ids.length,
        maxLength: ids.length,
      })
      .map((depths) => {
        const items: { id: string; parentId: string | null; depth: number }[] = [];

        for (let i = 0; i < ids.length; i++) {
          const depth = depths[i];
          if (depth === 0) {
            items.push({ id: ids[i], parentId: null, depth: 0 });
          } else {
            // Find a valid parent at depth - 1
            const possibleParents = items.filter((it) => it.depth === depth - 1);
            if (possibleParents.length > 0) {
              const parent = possibleParents[i % possibleParents.length];
              items.push({ id: ids[i], parentId: parent.id, depth });
            } else {
              // No valid parent at the required depth, make it a root
              items.push({ id: ids[i], parentId: null, depth: 0 });
            }
          }
        }

        return items.map(({ id, parentId }) => ({ id, parentId }));
      });
  });

/**
 * Generate an invalid set of items where at least one item exceeds depth 2.
 *
 * Strategy: build a chain of 4+ items (depth 0 → 1 → 2 → 3+), guaranteeing
 * at least one item at depth 3 or more.
 */
const invalidNestingItemsArb: fc.Arbitrary<{ id: string; parentId: string | null }[]> = fc
  .integer({ min: 4, max: 15 })
  .chain((count) =>
    fc.array(fc.uuid(), { minLength: count, maxLength: count })
  )
  .map((ids) => {
    const items: { id: string; parentId: string | null }[] = [];

    // Build a chain: root → child → grandchild → great-grandchild (depth 3)
    items.push({ id: ids[0], parentId: null }); // depth 0
    items.push({ id: ids[1], parentId: ids[0] }); // depth 1
    items.push({ id: ids[2], parentId: ids[1] }); // depth 2
    items.push({ id: ids[3], parentId: ids[2] }); // depth 3 — INVALID

    // Remaining items can be roots
    for (let i = 4; i < ids.length; i++) {
      items.push({ id: ids[i], parentId: null });
    }

    return items;
  });

/**
 * **Validates: Requirements 3.4, 3.5**
 *
 * Property 6: Nesting depth validation
 *
 * For any set of menu items with parentId references,
 * `validateNestingDepth(items)` SHALL return true if and only if no item
 * has a nesting depth exceeding 2 levels (root=0, child=1, grandchild=2).
 */
describe("Feature: menu-builder, Property 6: Nesting depth validation", () => {
  it("returns true for items with maximum nesting depth of 2", () => {
    fc.assert(
      fc.property(validNestingItemsArb, (items) => {
        expect(validateNestingDepth(items)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("returns false for items with nesting depth exceeding 2", () => {
    fc.assert(
      fc.property(invalidNestingItemsArb, (items) => {
        expect(validateNestingDepth(items)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 8: Link items have no children
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 4.5**
 *
 * Property 8: Link items have no children
 *
 * For any valid menu tree generated by the flatMenuItemsArb arbitrary,
 * no item with itemType === "link" has any children (i.e., no other item
 * has parentId pointing to a link item's id).
 */
describe("Feature: menu-builder, Property 8: Link items have no children", () => {
  it("no item of type 'link' is referenced as a parentId by any other item", () => {
    fc.assert(
      fc.property(flatMenuItemsArb, (items) => {
        // Collect all ids of link-type items
        const linkIds = new Set(
          items.filter((item) => item.itemType === "link").map((item) => item.id)
        );

        // No item should reference a link item as its parent
        for (const item of items) {
          if (item.parentId !== null) {
            expect(linkIds.has(item.parentId)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
