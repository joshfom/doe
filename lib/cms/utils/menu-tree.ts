import type { MenuItemTree, ItemType, DropdownType } from "@/lib/cms/types";

// Flat representation used by flattenMenuTree
export interface FlatMenuItem {
  id: string;
  menuId: string;
  parentId: string | null;
  label: string;
  url: string;
  icon: string | null;
  itemType: ItemType;
  dropdownType: DropdownType | null;
  megaColumns: number;
  position: number;
}

/**
 * Convert a flat array of menu items into a nested tree structure.
 * Groups by parentId, sorts each group by position, recursively attaches children.
 */
export function buildMenuTree(flatItems: FlatMenuItem[]): MenuItemTree[] {
  const childrenMap = new Map<string | null, FlatMenuItem[]>();

  for (const item of flatItems) {
    const key = item.parentId ?? null;
    const group = childrenMap.get(key);
    if (group) {
      group.push(item);
    } else {
      childrenMap.set(key, [item]);
    }
  }

  function buildChildren(parentId: string | null): MenuItemTree[] {
    const items = childrenMap.get(parentId) ?? [];
    const sorted = [...items].sort((a, b) => a.position - b.position);
    return sorted.map((item) => ({
      id: item.id,
      menuId: item.menuId,
      parentId: item.parentId,
      label: item.label,
      url: item.url,
      icon: item.icon,
      itemType: item.itemType,
      dropdownType: item.dropdownType,
      megaColumns: item.megaColumns,
      position: item.position,
      children: buildChildren(item.id),
    }));
  }

  return buildChildren(null);
}

/**
 * Convert a nested menu tree back to a flat array with parentId and position.
 * Inverse of buildMenuTree.
 */
export function flattenMenuTree(tree: MenuItemTree[]): FlatMenuItem[] {
  const result: FlatMenuItem[] = [];

  function flatten(nodes: MenuItemTree[]) {
    for (const node of nodes) {
      result.push({
        id: node.id,
        menuId: node.menuId,
        parentId: node.parentId,
        label: node.label,
        url: node.url,
        icon: node.icon,
        itemType: node.itemType,
        dropdownType: node.dropdownType,
        megaColumns: node.megaColumns,
        position: node.position,
      });
      if (node.children.length > 0) {
        flatten(node.children);
      }
    }
  }

  flatten(tree);
  return result;
}

/**
 * Validate that no item exceeds 2 levels of nesting depth.
 * root = 0, child = 1, grandchild = 2. Returns true if valid.
 */
export function validateNestingDepth(
  items: { id: string; parentId: string | null }[]
): boolean {
  const parentMap = new Map<string, string | null>();
  for (const item of items) {
    parentMap.set(item.id, item.parentId);
  }

  function getDepth(id: string): number {
    let depth = 0;
    let currentParentId = parentMap.get(id) ?? null;
    const visited = new Set<string>();
    while (currentParentId !== null) {
      if (visited.has(currentParentId)) return Infinity; // cycle detection
      visited.add(currentParentId);
      depth++;
      currentParentId = parentMap.get(currentParentId) ?? null;
    }
    return depth;
  }

  for (const item of items) {
    if (getDepth(item.id) > 2) return false;
  }
  return true;
}

/**
 * Returns true if the current URL matches the menu item URL.
 * Exact match always works. For non-root URLs, path-prefix match also works.
 */
export function isActiveUrl(itemUrl: string, currentUrl: string): boolean {
  if (itemUrl === currentUrl) return true;
  // Root URL "/" only matches exactly
  if (itemUrl === "/") return false;
  // Path-prefix match: currentUrl starts with itemUrl followed by "/" or end
  return (
    currentUrl.startsWith(itemUrl + "/") || currentUrl.startsWith(itemUrl + "?")
  );
}

/**
 * Generate a URL-safe slug from a name string.
 * Lowercase, alphanumeric + hyphens only, no leading/trailing hyphens.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // strip non-alphanumeric except spaces and hyphens
    .replace(/[\s-]+/g, "-") // collapse whitespace and hyphens into single hyphen
    .replace(/^-+/, "") // remove leading hyphens
    .replace(/-+$/, ""); // remove trailing hyphens
}

/**
 * Returns the next position for a new item at the given parent level.
 * Position is zero-indexed, so for N existing items it returns N.
 */
export function assignNextPosition(
  existingItems: { parentId: string | null; position: number }[],
  parentId: string | null
): number {
  const siblings = existingItems.filter((item) => item.parentId === parentId);
  return siblings.length;
}

/**
 * Returns the correct dropdown_type for a given item_type.
 * "link" → null, "dropdown" → "simple", "mega" → "mega"
 */
export function normalizeDropdownType(
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
 * Promotes children of a deleted item to its parent.
 * Returns a new array with the deleted item removed and its children re-parented.
 */
export function promoteChildren(
  items: { id: string; parentId: string | null }[],
  deletedItemId: string
): { id: string; parentId: string | null }[] {
  const deletedItem = items.find((item) => item.id === deletedItemId);
  if (!deletedItem) return items;

  const newParentId = deletedItem.parentId;

  return items
    .filter((item) => item.id !== deletedItemId)
    .map((item) => {
      if (item.parentId === deletedItemId) {
        return { ...item, parentId: newParentId };
      }
      return item;
    });
}
