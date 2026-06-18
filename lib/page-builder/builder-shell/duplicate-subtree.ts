/**
 * duplicate-subtree — pure helpers for duplicating a selected block as a
 * fully independent clone.
 *
 * Spec: custom-branded-page-builder — Requirement 4.3 (Duplicate)
 *
 * Why this exists:
 *   The original Duplicate wiring (SelectedElementHeader) inserted a single
 *   new top-level item with a shallow prop clone and a fresh root id. That is
 *   correct only for leaf blocks. Container blocks (Flex / Columns / Section /
 *   Accordion) hold their children in Puck *zones* keyed `<parentId>:<zone>`.
 *   A shallow duplicate therefore (a) shared nested prop object references with
 *   the source and (b) never copied the child zones nor regenerated descendant
 *   ids — so editing the copy mutated the original (a "mirror"), and copied
 *   columns came up empty or linked.
 *
 *   `buildDuplicatedSubtree` produces a completely separate copy: it collects
 *   the selected block plus every descendant zone, deep-clones the whole tree,
 *   regenerates every `props.id`, and remaps the zone keys (via the shared
 *   `regenerateIds` helper). The result is merged back into the page data and
 *   dispatched with a single `setData`.
 */

import { regenerateIds } from "../templates/component-templates";
import type { ComponentInstance } from "../types";

/** Puck's root zone compound; root-level blocks live in `data.content`. */
export const ROOT_ZONE_COMPOUND = "root:default-zone";

/** Minimal shape of the Puck data this module reads and rewrites. */
export interface SubtreeData {
  content: ComponentInstance[];
  zones?: Record<string, ComponentInstance[]> | null;
  root?: { props?: Record<string, unknown> };
  [key: string]: unknown;
}

export interface DuplicationResult {
  /** The page data with the deep-cloned subtree inserted. */
  data: SubtreeData;
  /** The fresh id of the cloned root block. */
  newId: string;
  /** The zone the copy was inserted into (root or a parent's zone). */
  zoneCompound: string;
  /** The index the copy occupies within its zone (source index + 1). */
  destinationIndex: number;
}

/**
 * Recursively collect every `<id>:<zoneName>` zone owned by `rootId` or any of
 * its descendants, so the duplicated subtree is self-contained. Mirrors the
 * collector used by the "Save to Library"/template flows.
 */
export function collectDescendantZones(
  rootId: string,
  zones: Record<string, ComponentInstance[]>,
): Record<string, ComponentInstance[]> {
  const result: Record<string, ComponentInstance[]> = {};
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const [zoneKey, items] of Object.entries(zones)) {
      const colonIdx = zoneKey.indexOf(":");
      const ownerId = colonIdx === -1 ? zoneKey : zoneKey.slice(0, colonIdx);
      if (ownerId !== id) continue;
      result[zoneKey] = items;
      for (const child of items) {
        const childId = child.props?.id;
        if (childId) queue.push(childId as string);
      }
    }
  }

  return result;
}

/** Insert `item` into `arr` at `index`, appending when index is out of range. */
function insertAt<T>(arr: T[], index: number, item: T): T[] {
  if (index < 0 || index >= arr.length) {
    return [...arr, item];
  }
  return [...arr.slice(0, index), item, ...arr.slice(index)];
}

/**
 * Build the page data resulting from duplicating `selectedItem` as a fully
 * independent clone, inserted immediately after the source in its zone.
 *
 * Guarantees:
 *   - the clone and all its descendants get fresh ids (no id shared with the
 *     source), and zone keys are remapped to the new ids;
 *   - props are deep-cloned (no shared object/array references), so editing the
 *     copy never mutates the original;
 *   - child zones are copied, so duplicating a column/Flex brings all its
 *     objects along into the new node.
 */
export function buildDuplicatedSubtree(
  data: SubtreeData,
  selectedItem: ComponentInstance,
  selector: { zone: string; index: number },
): DuplicationResult {
  const zoneCompound = selector.zone || ROOT_ZONE_COMPOUND;
  const destinationIndex = selector.index + 1;
  const sourceId = selectedItem.props.id as string;

  // Deep-clone the selected block + all descendant zones with fresh ids.
  const descendantZones = collectDescendantZones(sourceId, data.zones ?? {});
  const { content: clonedContent, zones: clonedZones } = regenerateIds({
    content: [selectedItem],
    zones: descendantZones,
  });
  const clonedRoot = clonedContent[0];
  const newId = clonedRoot.props.id as string;

  // Merge the cloned descendant zones into the page's zones.
  const mergedZones: Record<string, ComponentInstance[]> = {
    ...(data.zones ?? {}),
    ...clonedZones,
  };

  let newContent = data.content ?? [];
  if (zoneCompound === ROOT_ZONE_COMPOUND) {
    // Root-level: insert into the content array.
    newContent = insertAt(data.content ?? [], destinationIndex, clonedRoot);
  } else {
    // Nested: insert into the parent's zone array (which lives in data.zones).
    const targetZone = mergedZones[zoneCompound] ?? [];
    mergedZones[zoneCompound] = insertAt(targetZone, destinationIndex, clonedRoot);
  }

  return {
    data: { ...data, content: newContent, zones: mergedZones },
    newId,
    zoneCompound,
    destinationIndex,
  };
}
