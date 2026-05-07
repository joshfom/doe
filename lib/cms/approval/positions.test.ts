import { describe, it, expect } from "vitest";
import {
  reorderPositions,
  removeAndRenumber,
  appendApprover,
} from "./positions";

describe("reorderPositions", () => {
  it("moves item from beginning to end", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ];
    const result = reorderPositions(items, 0, 2);
    expect(result).toEqual([
      { userId: "b", position: 1 },
      { userId: "c", position: 2 },
      { userId: "a", position: 3 },
    ]);
  });

  it("moves item from end to beginning", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ];
    const result = reorderPositions(items, 2, 0);
    expect(result).toEqual([
      { userId: "c", position: 1 },
      { userId: "a", position: 2 },
      { userId: "b", position: 3 },
    ]);
  });

  it("returns same order when fromIndex equals toIndex", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
    ];
    const result = reorderPositions(items, 1, 1);
    expect(result).toEqual([
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
    ]);
  });

  it("handles single-item list", () => {
    const items = [{ userId: "a", position: 1 }];
    const result = reorderPositions(items, 0, 0);
    expect(result).toEqual([{ userId: "a", position: 1 }]);
  });

  it("handles empty list", () => {
    const result = reorderPositions([], 0, 0);
    expect(result).toEqual([]);
  });

  it("produces contiguous 1-based positions", () => {
    const items = [
      { userId: "a", position: 5 },
      { userId: "b", position: 10 },
      { userId: "c", position: 15 },
    ];
    const result = reorderPositions(items, 0, 1);
    expect(result.map((r) => r.position)).toEqual([1, 2, 3]);
  });
});

describe("removeAndRenumber", () => {
  it("removes from the middle and re-numbers", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ];
    const result = removeAndRenumber(items, 1);
    expect(result).toEqual([
      { userId: "a", position: 1 },
      { userId: "c", position: 2 },
    ]);
  });

  it("removes from the beginning", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ];
    const result = removeAndRenumber(items, 0);
    expect(result).toEqual([
      { userId: "b", position: 1 },
      { userId: "c", position: 2 },
    ]);
  });

  it("removes from the end", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ];
    const result = removeAndRenumber(items, 2);
    expect(result).toEqual([
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
    ]);
  });

  it("handles single-item list", () => {
    const items = [{ userId: "a", position: 1 }];
    const result = removeAndRenumber(items, 0);
    expect(result).toEqual([]);
  });

  it("handles empty list", () => {
    const result = removeAndRenumber([], 0);
    expect(result).toEqual([]);
  });
});

describe("appendApprover", () => {
  it("appends to empty list at position 1", () => {
    const result = appendApprover([], "user-1");
    expect(result).toEqual([{ userId: "user-1", position: 1 }]);
  });

  it("appends to existing list at N+1", () => {
    const items = [
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
    ];
    const result = appendApprover(items, "c");
    expect(result).toEqual([
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ]);
  });

  it("normalizes existing positions when appending", () => {
    const items = [
      { userId: "a", position: 5 },
      { userId: "b", position: 10 },
    ];
    const result = appendApprover(items, "c");
    expect(result).toEqual([
      { userId: "a", position: 1 },
      { userId: "b", position: 2 },
      { userId: "c", position: 3 },
    ]);
  });
});
