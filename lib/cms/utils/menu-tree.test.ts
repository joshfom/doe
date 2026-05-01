import { describe, it, expect } from "vitest";
import {
  buildMenuTree,
  flattenMenuTree,
  validateNestingDepth,
  isActiveUrl,
  generateSlug,
  assignNextPosition,
  normalizeDropdownType,
  promoteChildren,
  type FlatMenuItem,
} from "./menu-tree";

function makeFlatItem(overrides: Partial<FlatMenuItem> & { id: string }): FlatMenuItem {
  return {
    menuId: "menu-1",
    parentId: null,
    label: "Item",
    url: "/",
    icon: null,
    itemType: "link",
    dropdownType: null,
    megaColumns: 3,
    position: 0,
    ...overrides,
  };
}

describe("buildMenuTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildMenuTree([])).toEqual([]);
  });

  it("builds a flat list of root items sorted by position", () => {
    const items = [
      makeFlatItem({ id: "b", position: 1, label: "B" }),
      makeFlatItem({ id: "a", position: 0, label: "A" }),
    ];
    const tree = buildMenuTree(items);
    expect(tree).toHaveLength(2);
    expect(tree[0].label).toBe("A");
    expect(tree[1].label).toBe("B");
  });

  it("nests children under their parent", () => {
    const items = [
      makeFlatItem({ id: "root", position: 0, label: "Root", itemType: "dropdown", dropdownType: "simple" }),
      makeFlatItem({ id: "child", parentId: "root", position: 0, label: "Child" }),
    ];
    const tree = buildMenuTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].label).toBe("Child");
  });

  it("handles 3-level nesting (root → child → grandchild)", () => {
    const items = [
      makeFlatItem({ id: "root", position: 0, itemType: "mega", dropdownType: "mega" }),
      makeFlatItem({ id: "child", parentId: "root", position: 0, itemType: "dropdown", dropdownType: "simple" }),
      makeFlatItem({ id: "grandchild", parentId: "child", position: 0 }),
    ];
    const tree = buildMenuTree(items);
    expect(tree[0].children[0].children[0].id).toBe("grandchild");
  });
});

describe("flattenMenuTree", () => {
  it("returns empty array for empty tree", () => {
    expect(flattenMenuTree([])).toEqual([]);
  });

  it("round-trips with buildMenuTree", () => {
    const items = [
      makeFlatItem({ id: "a", position: 0, label: "A", itemType: "dropdown", dropdownType: "simple" }),
      makeFlatItem({ id: "b", parentId: "a", position: 0, label: "B" }),
      makeFlatItem({ id: "c", position: 1, label: "C" }),
    ];
    const tree = buildMenuTree(items);
    const flat = flattenMenuTree(tree);
    expect(flat).toHaveLength(3);
    const ids = new Set(flat.map((f) => f.id));
    expect(ids).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("validateNestingDepth", () => {
  it("returns true for empty array", () => {
    expect(validateNestingDepth([])).toBe(true);
  });

  it("returns true for root-only items", () => {
    expect(validateNestingDepth([{ id: "a", parentId: null }])).toBe(true);
  });

  it("returns true for 2-level nesting", () => {
    expect(
      validateNestingDepth([
        { id: "root", parentId: null },
        { id: "child", parentId: "root" },
        { id: "grandchild", parentId: "child" },
      ])
    ).toBe(true);
  });

  it("returns false for 3-level nesting", () => {
    expect(
      validateNestingDepth([
        { id: "root", parentId: null },
        { id: "child", parentId: "root" },
        { id: "grandchild", parentId: "child" },
        { id: "great", parentId: "grandchild" },
      ])
    ).toBe(false);
  });

  it("handles cycles gracefully", () => {
    expect(
      validateNestingDepth([
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" },
      ])
    ).toBe(false);
  });
});

describe("isActiveUrl", () => {
  it("matches exact URLs", () => {
    expect(isActiveUrl("/about", "/about")).toBe(true);
  });

  it("matches path-prefix for non-root URLs", () => {
    expect(isActiveUrl("/blog", "/blog/my-post")).toBe(true);
  });

  it("does not match root URL as prefix", () => {
    expect(isActiveUrl("/", "/about")).toBe(false);
  });

  it("matches root URL exactly", () => {
    expect(isActiveUrl("/", "/")).toBe(true);
  });

  it("does not match partial path segments", () => {
    expect(isActiveUrl("/blog", "/blogger")).toBe(false);
  });
});

describe("generateSlug", () => {
  it("converts name to lowercase hyphenated slug", () => {
    expect(generateSlug("Main Navigation")).toBe("main-navigation");
  });

  it("strips special characters", () => {
    expect(generateSlug("Hello, World!")).toBe("hello-world");
  });

  it("collapses multiple spaces/hyphens", () => {
    expect(generateSlug("a   b---c")).toBe("a-b-c");
  });

  it("removes leading and trailing hyphens", () => {
    expect(generateSlug("--test--")).toBe("test");
  });
});

describe("assignNextPosition", () => {
  it("returns 0 for empty list", () => {
    expect(assignNextPosition([], null)).toBe(0);
  });

  it("returns count of siblings at same parent level", () => {
    const items = [
      { parentId: null, position: 0 },
      { parentId: null, position: 1 },
      { parentId: "x", position: 0 },
    ];
    expect(assignNextPosition(items, null)).toBe(2);
    expect(assignNextPosition(items, "x")).toBe(1);
  });
});

describe("normalizeDropdownType", () => {
  it("returns null for link", () => {
    expect(normalizeDropdownType("link")).toBeNull();
  });

  it("returns 'simple' for dropdown", () => {
    expect(normalizeDropdownType("dropdown")).toBe("simple");
  });

  it("returns 'mega' for mega", () => {
    expect(normalizeDropdownType("mega")).toBe("mega");
  });
});

describe("promoteChildren", () => {
  it("promotes children to deleted item's parent", () => {
    const items = [
      { id: "root", parentId: null },
      { id: "parent", parentId: "root" },
      { id: "child1", parentId: "parent" },
      { id: "child2", parentId: "parent" },
    ];
    const result = promoteChildren(items, "parent");
    expect(result).toHaveLength(3);
    expect(result.find((i) => i.id === "child1")?.parentId).toBe("root");
    expect(result.find((i) => i.id === "child2")?.parentId).toBe("root");
  });

  it("promotes children to root when deleted item has no parent", () => {
    const items = [
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
    ];
    const result = promoteChildren(items, "root");
    expect(result).toHaveLength(1);
    expect(result[0].parentId).toBeNull();
  });

  it("returns same array if deleted item not found", () => {
    const items = [{ id: "a", parentId: null }];
    expect(promoteChildren(items, "nonexistent")).toEqual(items);
  });
});
