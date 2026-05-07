import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  reorderPositions,
  removeAndRenumber,
  appendApprover,
  PositionedApprover,
} from "./positions";

/**
 * Feature: sequential-approval-chain, Property 1: Position integrity after reorder, add, and remove
 *
 * Validates: Requirements 1.2, 1.3, 1.6
 *
 * For any valid ordered list of approvers and any valid mutation (reorder, add, remove),
 * the resulting list SHALL have contiguous positions starting from 1 with no gaps or
 * duplicates, and SHALL contain exactly the expected set of approvers.
 */

/** Generate a list of 1–10 approvers with unique userIds */
const approverListArb = fc
  .integer({ min: 1, max: 10 })
  .chain((size) =>
    fc
      .uniqueArray(fc.uuid(), { minLength: size, maxLength: size })
      .map((ids) =>
        ids.map((id, i) => ({ userId: id, position: i + 1 }))
      )
  );

/** Verify positions are contiguous 1-based with no gaps or duplicates */
function assertContiguousPositions(result: PositionedApprover[]): void {
  const positions = result.map((r) => r.position);
  const expected = result.map((_, i) => i + 1);
  expect(positions).toEqual(expected);
}

/** Verify no duplicate positions */
function assertNoDuplicatePositions(result: PositionedApprover[]): void {
  const positions = result.map((r) => r.position);
  const unique = new Set(positions);
  expect(unique.size).toBe(positions.length);
}

describe("Feature: sequential-approval-chain, Property 1: Position integrity after reorder, add, and remove", () => {
  it("reorder preserves contiguous 1-based positions and set membership", () => {
    fc.assert(
      fc.property(
        approverListArb.chain((items) =>
          fc.tuple(
            fc.constant(items),
            fc.integer({ min: 0, max: Math.max(0, items.length - 1) }),
            fc.integer({ min: 0, max: Math.max(0, items.length - 1) })
          )
        ),
        ([items, fromIndex, toIndex]) => {
          const result = reorderPositions(items, fromIndex, toIndex);

          // Positions are contiguous starting from 1
          assertContiguousPositions(result);

          // No duplicate positions
          assertNoDuplicatePositions(result);

          // Same set of userIds (no additions or removals)
          const originalIds = new Set(items.map((i) => i.userId));
          const resultIds = new Set(result.map((r) => r.userId));
          expect(resultIds).toEqual(originalIds);

          // Length preserved
          expect(result.length).toBe(items.length);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("remove produces contiguous 1-based positions and correct set membership", () => {
    fc.assert(
      fc.property(
        approverListArb.chain((items) =>
          fc.tuple(
            fc.constant(items),
            fc.integer({ min: 0, max: Math.max(0, items.length - 1) })
          )
        ),
        ([items, removeIndex]) => {
          const result = removeAndRenumber(items, removeIndex);

          // Positions are contiguous starting from 1
          assertContiguousPositions(result);

          // No duplicate positions
          assertNoDuplicatePositions(result);

          // Length is one less
          expect(result.length).toBe(items.length - 1);

          // The removed userId is gone, all others remain
          const removedUserId = items[removeIndex].userId;
          const resultIds = new Set(result.map((r) => r.userId));
          expect(resultIds.has(removedUserId)).toBe(false);

          const expectedIds = new Set(
            items.filter((_, i) => i !== removeIndex).map((i) => i.userId)
          );
          expect(resultIds).toEqual(expectedIds);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("append produces contiguous 1-based positions and correct set membership", () => {
    fc.assert(
      fc.property(
        approverListArb,
        fc.uuid(),
        (items, newUserId) => {
          // Ensure newUserId is not already in the list
          fc.pre(!items.some((i) => i.userId === newUserId));

          const result = appendApprover(items, newUserId);

          // Positions are contiguous starting from 1
          assertContiguousPositions(result);

          // No duplicate positions
          assertNoDuplicatePositions(result);

          // Length is one more
          expect(result.length).toBe(items.length + 1);

          // All original userIds plus the new one are present
          const originalIds = new Set(items.map((i) => i.userId));
          const resultIds = new Set(result.map((r) => r.userId));
          expect(resultIds.has(newUserId)).toBe(true);
          for (const id of originalIds) {
            expect(resultIds.has(id)).toBe(true);
          }

          // New approver is at the last position
          const lastItem = result[result.length - 1];
          expect(lastItem.userId).toBe(newUserId);
          expect(lastItem.position).toBe(items.length + 1);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("sequential random mutations maintain position integrity", () => {
    // Apply a sequence of random mutations and verify invariants hold after each
    const mutationArb = fc.oneof(
      fc.constant("reorder" as const),
      fc.constant("add" as const),
      fc.constant("remove" as const)
    );

    fc.assert(
      fc.property(
        approverListArb,
        fc.array(mutationArb, { minLength: 1, maxLength: 5 }),
        fc.array(fc.uuid(), { minLength: 5, maxLength: 5 }),
        (initialItems, mutations, extraIds) => {
          let current = [...initialItems];
          let extraIdIndex = 0;

          for (const mutation of mutations) {
            if (current.length === 0 && mutation !== "add") {
              // Can only add to empty list
              const newId = extraIds[extraIdIndex++ % extraIds.length];
              current = appendApprover(current, newId);
            } else if (mutation === "reorder" && current.length > 0) {
              const fromIndex = Math.floor(Math.random() * current.length);
              const toIndex = Math.floor(Math.random() * current.length);
              current = reorderPositions(current, fromIndex, toIndex);
            } else if (mutation === "add") {
              const newId = extraIds[extraIdIndex++ % extraIds.length];
              if (!current.some((c) => c.userId === newId)) {
                current = appendApprover(current, newId);
              }
            } else if (mutation === "remove" && current.length > 0) {
              const removeIndex = Math.floor(Math.random() * current.length);
              current = removeAndRenumber(current, removeIndex);
            }

            // After each mutation, verify invariants
            assertContiguousPositions(current);
            assertNoDuplicatePositions(current);

            // Verify no duplicate userIds
            const userIds = current.map((c) => c.userId);
            expect(new Set(userIds).size).toBe(userIds.length);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
