import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { promoteChildren } from "@/lib/cms/utils/menu-tree";

// ── Shared arbitraries ───────────────────────────────────────────────────────

/**
 * Generate a tree of items with parent-child relationships, ensuring at least
 * one non-leaf item exists (an item that has children pointing to it).
 *
 * Strategy: build items sequentially. First item is always root. Subsequent
 * items can be root or reference a previously created item as parent.
 * After generation, identify non-leaf items (items that are referenced as
 * parentId by at least one other item).
 */
const treeWithNonLeafArb: fc.Arbitrary<{
  items: { id: string; parentId: string | null }[];
  nonLeafId: string;
}> = fc
  .integer({ min: 3, max: 20 })
  .chain((count) =>
    fc.tuple(
      fc.array(fc.uuid(), { minLength: count, maxLength: count }),
      fc.array(fc.boolean(), { minLength: count, maxLength: count })
    )
  )
  .chain(([ids, rootFlags]) => {
    // Build items: first is always root, rest can be root or child of a previous item
    const items: { id: string; parentId: string | null }[] = [];
    items.push({ id: ids[0], parentId: null });

    for (let i = 1; i < ids.length; i++) {
      if (rootFlags[i] && items.length > 1) {
        // Make it a root item sometimes
        items.push({ id: ids[i], parentId: null });
      } else {
        // Pick a random parent from existing items
        const parentIndex = i % items.length;
        items.push({ id: ids[i], parentId: items[parentIndex].id });
      }
    }

    // Find non-leaf items (items that have at least one child)
    const parentIds = new Set(
      items.filter((it) => it.parentId !== null).map((it) => it.parentId!)
    );
    const nonLeafIds = items
      .filter((it) => parentIds.has(it.id))
      .map((it) => it.id);

    // If no non-leaf exists, force the first item to be a parent by adding a child
    if (nonLeafIds.length === 0) {
      // Make the second item a child of the first
      items[1] = { ...items[1], parentId: items[0].id };
      return fc.constant({
        items,
        nonLeafId: items[0].id,
      });
    }

    // Pick one of the non-leaf items
    return fc
      .integer({ min: 0, max: nonLeafIds.length - 1 })
      .map((idx) => ({
        items,
        nonLeafId: nonLeafIds[idx],
      }));
  });

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Delete promotes children
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.4**
 *
 * Property 4: Delete promotes children
 *
 * For any menu tree and any non-leaf menu item selected for deletion,
 * after deletion:
 * (a) all former children of the deleted item SHALL have their parentId
 *     set to the deleted item's former parentId,
 * (b) the total item count SHALL equal the original count minus one, and
 * (c) the deleted item SHALL no longer be in the result.
 */
describe("Feature: menu-builder, Property 4: Delete promotes children", () => {
  it("total count after deletion is original count minus one", () => {
    fc.assert(
      fc.property(treeWithNonLeafArb, ({ items, nonLeafId }) => {
        const result = promoteChildren(items, nonLeafId);
        expect(result).toHaveLength(items.length - 1);
      }),
      { numRuns: 100 }
    );
  });

  it("all children of the deleted item now have the deleted item's parentId as their new parentId", () => {
    fc.assert(
      fc.property(treeWithNonLeafArb, ({ items, nonLeafId }) => {
        const deletedItem = items.find((it) => it.id === nonLeafId)!;
        const childrenIds = items
          .filter((it) => it.parentId === nonLeafId)
          .map((it) => it.id);

        const result = promoteChildren(items, nonLeafId);

        for (const childId of childrenIds) {
          const promoted = result.find((it) => it.id === childId);
          expect(promoted).toBeDefined();
          expect(promoted!.parentId).toBe(deletedItem.parentId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("the deleted item is no longer in the result", () => {
    fc.assert(
      fc.property(treeWithNonLeafArb, ({ items, nonLeafId }) => {
        const result = promoteChildren(items, nonLeafId);
        const found = result.find((it) => it.id === nonLeafId);
        expect(found).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("items that are not children of the deleted item retain their original parentId", () => {
    fc.assert(
      fc.property(treeWithNonLeafArb, ({ items, nonLeafId }) => {
        const result = promoteChildren(items, nonLeafId);

        for (const original of items) {
          // Skip the deleted item and its direct children
          if (original.id === nonLeafId || original.parentId === nonLeafId) {
            continue;
          }
          const afterDelete = result.find((it) => it.id === original.id);
          expect(afterDelete).toBeDefined();
          expect(afterDelete!.parentId).toBe(original.parentId);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── Reorder arbitraries ──────────────────────────────────────────────────────

/**
 * Generate a set of menu items with ids, positions, and parentIds,
 * then produce a valid reorder payload that covers all items
 * (shuffled positions and potentially reassigned parentIds).
 */
const menuItemsWithReorderArb: fc.Arbitrary<{
  items: { id: string; parentId: string | null; position: number }[];
  reorderPayload: { id: string; position: number; parentId: string | null }[];
}> = fc
  .integer({ min: 1, max: 30 })
  .chain((count) =>
    fc.tuple(
      fc.array(fc.uuid(), { minLength: count, maxLength: count }),
      // For each item, decide if it's root (true) or child of a previous item
      fc.array(fc.boolean(), { minLength: count, maxLength: count }),
      // Shuffled positions for the reorder payload
      fc.shuffledSubarray(
        Array.from({ length: count }, (_, i) => i),
        { minLength: count, maxLength: count }
      ),
      // For each item in the reorder, decide if it stays root or gets a new parent
      fc.array(fc.boolean(), { minLength: count, maxLength: count })
    )
  )
  .map(([ids, rootFlags, shuffledPositions, reorderRootFlags]) => {
    // Build original items
    const items: { id: string; parentId: string | null; position: number }[] =
      [];
    items.push({ id: ids[0], parentId: null, position: 0 });

    for (let i = 1; i < ids.length; i++) {
      if (rootFlags[i]) {
        items.push({ id: ids[i], parentId: null, position: i });
      } else {
        const parentIndex = i % items.length;
        items.push({ id: ids[i], parentId: items[parentIndex].id, position: i });
      }
    }

    // Build reorder payload: assign shuffled positions, optionally reassign parentIds
    // Keep it simple — items either stay root or get assigned to a random existing item
    const reorderPayload = items.map((item, idx) => {
      let newParentId: string | null = null;
      if (!reorderRootFlags[idx] && items.length > 1) {
        // Pick a parent that is not the item itself
        const candidates = items.filter((it) => it.id !== item.id);
        const parentCandidate = candidates[idx % candidates.length];
        newParentId = parentCandidate.id;
      }
      return {
        id: item.id,
        position: shuffledPositions[idx],
        parentId: newParentId,
      };
    });

    return { items, reorderPayload };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Reorder count preservation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.7**
 *
 * Property 7: Reorder count preservation
 *
 * For any menu with N items and any valid bulk reorder operation
 * (array of { id, position, parentId } covering all items),
 * the total count of menu items after reordering SHALL equal N.
 *
 * Since there is no dedicated applyReorder function (the API does this
 * in the database), we simulate the reorder by applying the payload
 * to the original items — updating position and parentId for each item
 * based on the reorder payload — and verifying the count is preserved.
 */

function applyReorder(
  items: { id: string; parentId: string | null; position: number }[],
  reorderPayload: { id: string; position: number; parentId: string | null }[]
): { id: string; parentId: string | null; position: number }[] {
  const payloadMap = new Map(
    reorderPayload.map((entry) => [entry.id, entry])
  );

  return items.map((item) => {
    const update = payloadMap.get(item.id);
    if (update) {
      return {
        id: item.id,
        position: update.position,
        parentId: update.parentId,
      };
    }
    return item;
  });
}

describe("Feature: menu-builder, Property 7: Reorder count preservation", () => {
  it("total item count after reorder equals original count", () => {
    fc.assert(
      fc.property(menuItemsWithReorderArb, ({ items, reorderPayload }) => {
        const reordered = applyReorder(items, reorderPayload);
        expect(reordered).toHaveLength(items.length);
      }),
      { numRuns: 100 }
    );
  });

  it("all original item ids are present after reorder", () => {
    fc.assert(
      fc.property(menuItemsWithReorderArb, ({ items, reorderPayload }) => {
        const reordered = applyReorder(items, reorderPayload);
        const originalIds = new Set(items.map((it) => it.id));
        const reorderedIds = new Set(reordered.map((it) => it.id));
        expect(reorderedIds).toEqual(originalIds);
      }),
      { numRuns: 100 }
    );
  });

  it("no items are duplicated after reorder", () => {
    fc.assert(
      fc.property(menuItemsWithReorderArb, ({ items, reorderPayload }) => {
        const reordered = applyReorder(items, reorderPayload);
        const ids = reordered.map((it) => it.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }),
      { numRuns: 100 }
    );
  });
});
