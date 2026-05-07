// ── Position Management Utilities ────────────────────────────────────────────
// Pure functions for managing ordered approver positions in the approval chain.
// All functions return new arrays with contiguous 1-based positions.

export interface PositionedApprover {
  userId: string;
  position: number;
}

/**
 * Move an item from `fromIndex` to `toIndex` and return new contiguous 1-based positions.
 * Indices are 0-based array indices (not position values).
 */
export function reorderPositions(
  items: PositionedApprover[],
  fromIndex: number,
  toIndex: number
): PositionedApprover[] {
  if (items.length === 0) return [];
  const clampedFrom = Math.max(0, Math.min(fromIndex, items.length - 1));
  const clampedTo = Math.max(0, Math.min(toIndex, items.length - 1));

  const result = [...items];
  const [moved] = result.splice(clampedFrom, 1);
  result.splice(clampedTo, 0, moved);

  return result.map((item, index) => ({
    userId: item.userId,
    position: index + 1,
  }));
}

/**
 * Remove the item at `removeIndex` and re-number remaining items from 1.
 * Index is 0-based.
 */
export function removeAndRenumber(
  items: PositionedApprover[],
  removeIndex: number
): PositionedApprover[] {
  if (items.length === 0) return [];
  const clamped = Math.max(0, Math.min(removeIndex, items.length - 1));

  const result = items.filter((_, index) => index !== clamped);

  return result.map((item, index) => ({
    userId: item.userId,
    position: index + 1,
  }));
}

/**
 * Append a new approver at position N+1 (where N is the current list length).
 */
export function appendApprover(
  items: PositionedApprover[],
  userId: string
): PositionedApprover[] {
  return [
    ...items.map((item, index) => ({
      userId: item.userId,
      position: index + 1,
    })),
    { userId, position: items.length + 1 },
  ];
}
