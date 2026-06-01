/**
 * Page Tree — pure derivation of the page hierarchy from Puck state.
 *
 * Spec: builder-canvas-polish-and-inline-richtext
 * _Requirements: 8.2, 13.1, 13.2_
 *
 * Builds a `PageTree` from `appState.data.content` (root zone) and
 * `appState.data.zones` (nested zones keyed as `"{ownerId}:{zoneName}"`).
 * The tree is the single source of truth for the OutlineTree, the
 * AncestorBreadcrumb, and the parent-reach selection logic.
 *
 * Pure, memoizable on `data` reference equality — re-derivation is O(n).
 */

import type { Config, Data } from "@puckeditor/core";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A Puck zone/index locator used to address a block in its zone.
 */
export interface PuckSelector {
  zone: string;
  index: number;
}

/**
 * A single node in the derived page tree.
 */
export interface PageTreeNode {
  /** Internal Puck component instance id — never rendered in the UI. */
  id: string;
  /** Component type key, e.g. "Section", "Text". */
  type: string;
  /** Human-readable label (Block_Label convention). */
  label: string;
  /** Puck zone key containing this node (e.g. "root:default-zone"). */
  zone: string;
  /** Position within its zone. */
  index: number;
  /** Null for root-zone nodes. */
  parentId: string | null;
  /** Children grouped by zone name. */
  childrenByZone: Record<string, PageTreeNode[]>;
}

/**
 * The full derived page tree.
 */
export interface PageTree {
  /** Top-level nodes (children of the root "default-zone"). */
  roots: PageTreeNode[];
  /** Lookup by component instance id. */
  byId: Map<string, PageTreeNode>;
  /** Maps each node id to its parent id (null for root-zone nodes). */
  parentOf: Map<string, string | null>;
}

/**
 * A single segment in the ancestor breadcrumb path.
 */
export interface AncestorSegment {
  /** Null for the synthetic "Page" root segment. */
  id: string | null;
  /** "Page" for the root, otherwise the block's Block_Label. */
  label: string;
  /** Null for the "Page" root; `{ zone, index }` otherwise. */
  selector: PuckSelector | null;
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Build a `PageTree` from Puck data and config.
 *
 * Walks `data.content` as the root zone and every key of `data.zones`
 * (keys follow the convention `"{ownerId}:{zoneName}"`), constructing
 * parent-child links. Node labels derive from `config.components[type].label`
 * with per-instance `props._label` override.
 *
 * Orphan zone keys (owner not present in content or any zone) are skipped
 * with a one-time `console.warn`.
 */
export function buildPageTree(data: Data, config: Config): PageTree {
  const ROOT_ZONE = "root:default-zone";

  const byId = new Map<string, PageTreeNode>();
  const parentOf = new Map<string, string | null>();

  // Helper: resolve the human-readable label for a block, matching the
  // convention used by SelectedElementHeader and SelectionLiveRegion.
  function resolveLabel(
    type: string,
    props: Record<string, unknown>,
  ): string {
    const instanceLabel = props._label;
    if (typeof instanceLabel === "string" && instanceLabel.length > 0) {
      return instanceLabel;
    }
    const componentConfig = config.components?.[type] as
      | { label?: unknown }
      | undefined;
    const registeredLabel = componentConfig?.label;
    if (typeof registeredLabel === "string" && registeredLabel.length > 0) {
      return registeredLabel;
    }
    return type;
  }

  // Helper: process a zone's items and create nodes.
  function processZone(
    zoneKey: string,
    items: Array<{ type: string; props: Record<string, unknown> }>,
    parentId: string | null,
  ): PageTreeNode[] {
    const nodes: PageTreeNode[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = item.props.id as string;
      const node: PageTreeNode = {
        id,
        type: item.type,
        label: resolveLabel(item.type, item.props),
        zone: zoneKey,
        index: i,
        parentId,
        childrenByZone: {},
      };
      byId.set(id, node);
      parentOf.set(id, parentId);
      nodes.push(node);
    }
    return nodes;
  }

  // Step 1: Process the root zone (data.content).
  const roots = processZone(
    ROOT_ZONE,
    (data.content ?? []) as Array<{ type: string; props: Record<string, unknown> }>,
    null,
  );

  // Step 2a: Process inline slot fields (Puck 0.21+ data model).
  // Components with slot fields store children directly in their props as
  // arrays of component instances. We detect these by checking the config's
  // field definitions for `{ type: "slot" }` entries, then traversing them
  // recursively. This must run before legacy zone processing so that slot
  // children are already in `byId` when orphan detection occurs.
  function processSlotChildren(nodes: PageTreeNode[]) {
    for (const node of nodes) {
      const componentConfig = config.components?.[node.type] as
        | { fields?: Record<string, { type?: string }> }
        | undefined;
      if (!componentConfig?.fields) continue;

      // Find which props correspond to slot fields
      const item = (data.content ?? []).find(
        (c: { props?: { id?: unknown } }) =>
          (c.props?.id as string) === node.id
      ) ?? findItemById(node.id);
      if (!item) continue;

      const props = (item as { props: Record<string, unknown> }).props;

      for (const [fieldName, fieldDef] of Object.entries(componentConfig.fields)) {
        if (fieldDef.type !== "slot") continue;

        const slotItems = props[fieldName];
        if (!Array.isArray(slotItems) || slotItems.length === 0) continue;

        const zoneKey = `${node.id}:${fieldName}`;
        const childNodes = processZone(
          zoneKey,
          slotItems as Array<{ type: string; props: Record<string, unknown> }>,
          node.id,
        );

        node.childrenByZone[fieldName] = childNodes;

        // Recurse into slot children
        processSlotChildren(childNodes);
      }
    }
  }

  // Helper to locate a component instance anywhere in the data by its id.
  // Needed because slot children aren't in data.content.
  function findItemById(id: string): { type: string; props: Record<string, unknown> } | null {
    // Search root content
    for (const item of (data.content ?? []) as Array<{ type: string; props: Record<string, unknown> }>) {
      const found = findInItem(item, id);
      if (found) return found;
    }
    return null;
  }

  function findInItem(
    item: { type: string; props: Record<string, unknown> },
    id: string,
  ): { type: string; props: Record<string, unknown> } | null {
    if ((item.props.id as string) === id) return item;

    const componentConfig = config.components?.[item.type] as
      | { fields?: Record<string, { type?: string }> }
      | undefined;
    if (!componentConfig?.fields) return null;

    for (const [fieldName, fieldDef] of Object.entries(componentConfig.fields)) {
      if (fieldDef.type !== "slot") continue;
      const slotItems = item.props[fieldName];
      if (!Array.isArray(slotItems)) continue;
      for (const child of slotItems as Array<{ type: string; props: Record<string, unknown> }>) {
        const found = findInItem(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  processSlotChildren(roots);

  // Step 2b: Process legacy nested zones (data.zones).
  // Each key follows the convention "{ownerId}:{zoneName}".
  // Zone keys may reference owners defined in other zones, so iteration
  // order is not guaranteed to be topological. We use repeated passes
  // until all resolvable zones are processed. Total work is O(n) because
  // each zone is processed exactly once and removed from the pending set.
  if (data.zones) {
    let pending = Object.entries(data.zones).filter(([key]) => key.indexOf(":") !== -1);
    let prevLength = -1;

    while (pending.length > 0 && pending.length !== prevLength) {
      prevLength = pending.length;
      const stillPending: typeof pending = [];

      for (const [zoneKey, items] of pending) {
        const colonIndex = zoneKey.indexOf(":");
        const ownerId = zoneKey.slice(0, colonIndex);

        if (!byId.has(ownerId)) {
          stillPending.push([zoneKey, items]);
          continue;
        }

        // Skip if already populated by slot processing
        const parentNode = byId.get(ownerId)!;
        const zoneName = zoneKey.slice(colonIndex + 1);
        if (parentNode.childrenByZone[zoneName]?.length) {
          continue;
        }

        const childNodes = processZone(
          zoneKey,
          items as Array<{ type: string; props: Record<string, unknown> }>,
          ownerId,
        );

        parentNode.childrenByZone[zoneName] = childNodes;
      }

      pending = stillPending;
    }

    // Any remaining entries are true orphans — owner not in the tree.
    for (const [zoneKey] of pending) {
      const colonIndex = zoneKey.indexOf(":");
      const ownerId = zoneKey.slice(0, colonIndex);
      console.warn(
        `[page-tree] Orphan zone key "${zoneKey}" — owner "${ownerId}" not found in page data. Skipping.`,
      );
    }
  }

  return { roots, byId, parentOf };
}

/**
 * Build the ancestor path from the page root to the parent of `selectedId`.
 *
 * Returns an array starting with a synthetic "Page" segment (`id: null`,
 * `selector: null`) followed by each ancestor from root → parent order.
 * Returns an empty array when `selectedId` is null or not found in the tree.
 */
export function buildAncestorPath(
  tree: PageTree,
  selectedId: string | null,
): AncestorSegment[] {
  if (selectedId === null || !tree.byId.has(selectedId)) {
    return [];
  }

  // Walk parentOf from selectedId upward, collecting ancestor segments.
  // We do NOT include the selected node itself — only its ancestors.
  const ancestors: AncestorSegment[] = [];
  let currentId = tree.parentOf.get(selectedId) ?? null;

  while (currentId !== null) {
    const node = tree.byId.get(currentId);
    if (!node) break;

    ancestors.push({
      id: node.id,
      label: node.label,
      selector: { zone: node.zone, index: node.index },
    });

    currentId = tree.parentOf.get(currentId) ?? null;
  }

  // ancestors is currently in child → root order, reverse to root → child.
  ancestors.reverse();

  // Prepend the synthetic "Page" segment.
  ancestors.unshift({ id: null, label: "Page", selector: null });

  return ancestors;
}
