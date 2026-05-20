"use client";

/**
 * SelectedElementHeader — Puck wiring for the presentational ElementHeader.
 *
 * Spec: custom-branded-page-builder
 * _Requirements: 4.3, 4.4, 4.5_
 *
 * Task 6.2 pairs a container with the headless `ElementHeader` from task
 * 6.1. `ElementHeader` is intentionally purely presentational — it accepts
 * an anchor element, a label, zone-boundary flags, and four action
 * callbacks. This file is the Puck-aware half: it reads the current
 * selection and zone state via `usePuck()`, resolves the DOM anchor, and
 * translates each toolbar action into a Puck dispatch call.
 *
 * Dispatch mapping (per tasks.md 6.2):
 *   - Duplicate   → `dispatch({ type: "insert", ... })` with cloned props
 *                   and a fresh id, inserted at `sourceIndex + 1` in the
 *                   same zone so the copy sits immediately after the
 *                   selected block (Req 4.3).
 *   - Delete      → `dispatch({ type: "remove", ... })` (Req 4.4).
 *   - Move up /   → `dispatch({ type: "reorder", ... })` within the same
 *     Move down     zone, shifting the source index by ±1 (Req 4.5).
 *
 * Why `insert` and not Puck's built-in `duplicate`: the tasks file is
 * explicit — duplicate goes through the `insert` action with cloned props.
 * This keeps the header's dispatch surface narrow (insert/remove/reorder
 * only) and guarantees the duplicated block carries the exact prop
 * snapshot the editor sees, independent of any resolver re-runs. The
 * trade-off is that we reimplement Puck's nested-slot id regeneration for
 * blocks whose props contain slot arrays; the existing
 * `templates/component-templates.ts#regenerateIds` helper already handles
 * that pattern, and blocks used today via the element header never embed
 * slots in props (they use Puck zones instead), so a shallow clone with a
 * fresh root id is sufficient for Slice 1. If/when a block type gains
 * slotted props, revisit `clonePropsForInsert` below.
 *
 * Anchor resolution: Puck stamps `data-puck-component="{id}"` on every
 * rendered block's root element inside the canvas (see
 * `@puckeditor/core/chunk-*.mjs`). We query the document for that
 * attribute once per selection change and pass the live element to
 * `ElementHeader`, which subscribes to its geometry via
 * `ResizeObserver` + scroll listeners. The lookup is done inside an
 * effect with a short retry loop because Puck re-attaches attributes
 * after its own mount phase; the retry stops as soon as the element
 * exists or a small budget is exhausted, which keeps us out of a tight
 * render loop if the element was unmounted intentionally.
 */

import React from "react";
import { usePuckStore } from "../use-puck-store";
import { ElementHeader } from "./ElementHeader";
import { useBreakpoint } from "../breakpoint-context";
import { resolveVisibility } from "../visibility";
import { useLibrary } from "./LibraryContext";

// Puck's root zone compound — used as the fallback zone when a block sits
// at the top level of the page. Mirrors `rootAreaId` + `rootZone` in
// `@puckeditor/core` (`root:default-zone`).
const ROOT_ZONE_COMPOUND = "root:default-zone";

// ─── ID generation ───────────────────────────────────────────────────────────

/**
 * Generate a fresh component instance id. Kept local (and tiny) instead of
 * importing from `templates/component-templates.ts` to avoid pulling the
 * heavy template module into the shell's tree-shaking graph. The format is
 * intentionally opaque to Puck — Puck only requires ids to be unique.
 */
function generateComponentId(componentType: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${componentType}-${suffix}`;
}

/**
 * Shallow-clone a block's props for insertion after the selected block.
 * Strips the `id` so the caller can assign a fresh one. The action
 * reducer (Puck's `insertAction`) builds the inserted item from
 * `componentType` + optional `id`, then uses the block's `defaultProps` —
 * so we dispatch a `replace` immediately after `insert` to write the
 * cloned props on top of the freshly inserted item.
 */
function clonePropsForInsert(
  props: Record<string, unknown>,
): Record<string, unknown> {
  // We deliberately do a shallow clone of the props object and let object
  // identities be shared for array/object children. Puck is immutable-by-
  // convention at the top level of each prop; downstream mutations happen
  // through `replace` which re-creates the prop slots. A deep clone would
  // be defensive overreach for the current Slice 1 scope.
  const { id: _id, ...rest } = props;
  void _id;
  return rest;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SelectedElementHeader() {
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const appState = usePuckStore((s) => s.appState);
  const dispatch = usePuckStore((s) => s.dispatch);
  const getSelectorForId = usePuckStore((s) => s.getSelectorForId);
  const config = usePuckStore((s) => s.config);
  const { activeBreakpoint } = useBreakpoint();

  // Resolve the item's selector (zone + index). `getSelectorForId` returns
  // `undefined` in the brief window between Puck dispatching a `setUi` for
  // a newly-inserted item and the next render fully indexing it; in that
  // case we render nothing rather than rendering a broken toolbar.
  const selectedId = selectedItem?.props.id as string | undefined;
  const selector = selectedId ? getSelectorForId(selectedId) : undefined;

  // Compute zone-boundary flags (Req 4.6) from the zone's live contentIds.
  // We intentionally read from the app state indexes rather than walking
  // the raw data so nested/slot zones work identically to the root zone.
  const { canMoveUp, canMoveDown } = React.useMemo(() => {
    if (!selector) return { canMoveUp: false, canMoveDown: false };
    // `appState` is the *public* app state and does not include `indexes`;
    // fall back to the raw content arrays via `data`.
    const data = appState.data;
    const zoneCompound = selector.zone || ROOT_ZONE_COMPOUND;
    const [ownerId, zoneName] = zoneCompound.split(":");
    let contentIds: string[] | null = null;
    if (ownerId === "root" && zoneName === "default-zone") {
      contentIds = (data.content ?? []).map(
        (item) => item.props.id as string,
      );
    } else if (data.zones && data.zones[zoneCompound]) {
      contentIds = data.zones[zoneCompound].map(
        (item) => item.props.id as string,
      );
    }
    if (!contentIds) return { canMoveUp: false, canMoveDown: false };
    const length = contentIds.length;
    return {
      canMoveUp: selector.index > 0,
      canMoveDown: selector.index < length - 1,
    };
  }, [appState.data, selector]);

  // Live DOM anchor lookup — scan for `[data-puck-component="{id}"]` which
  // Puck attaches to each rendered block's root element. The retry loop
  // handles the race where Puck has emitted the block into the tree but
  // not yet attached the attribute; a handful of rAF ticks is plenty.
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!selectedId || typeof document === "undefined") {
      setAnchorEl(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 16;
    // `CSS.escape` is not a global in some test environments (jsdom does
    // not hoist it off `window`); when missing we fall back to a minimal
    // escape that covers the characters our generated ids can actually
    // contain (letters, digits, hyphens, and `:` from slot zone keys).
    const escapeSelector = (raw: string): string => {
      if (
        typeof (globalThis as unknown as { CSS?: { escape?: (v: string) => string } })
          .CSS?.escape === "function"
      ) {
        return (
          globalThis as unknown as { CSS: { escape: (v: string) => string } }
        ).CSS.escape(raw);
      }
      return raw.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
    };
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-puck-component="${escapeSelector(selectedId)}"]`,
      );
      if (el) {
        setAnchorEl(el);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        console.warn(
          `[ORA Builder] Could not find anchor for block ${selectedId} after ${maxAttempts} attempts`,
        );
        setAnchorEl(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Human-readable label for the toolbar. Prefer the block's registered
  // `label` from the Puck config, fall back to the component type. Block
  // authors may also override per-instance via `props._label`, which the
  // LeftRail already honors — we mirror that here.
  const label = React.useMemo(() => {
    if (!selectedItem) return "Element";
    const instanceLabel = (selectedItem.props as { _label?: unknown })._label;
    if (typeof instanceLabel === "string" && instanceLabel.length > 0) {
      return instanceLabel;
    }
    const componentConfig = config.components?.[selectedItem.type];
    const registeredLabel = (componentConfig as { label?: unknown } | undefined)
      ?.label;
    if (typeof registeredLabel === "string" && registeredLabel.length > 0) {
      return registeredLabel;
    }
    return selectedItem.type;
  }, [config, selectedItem]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const onDuplicate = React.useCallback(() => {
    if (!selectedItem || !selector) return;
    const zoneCompound = selector.zone || ROOT_ZONE_COMPOUND;
    const destinationIndex = selector.index + 1;
    const componentType = selectedItem.type;
    const newId = generateComponentId(componentType);

    // Step 1 — insert a fresh component of the same type at the position
    // immediately after the selection. Puck's reducer builds the new item
    // from `componentType` + `id` and the block's `defaultProps`.
    dispatch({
      type: "insert",
      componentType,
      destinationIndex,
      destinationZone: zoneCompound,
      id: newId,
    });

    // Step 2 — overwrite the freshly-inserted item's props with a clone of
    // the source props, preserving the new id. `replace` with the same
    // zone/index targets the item we just inserted. We use the current
    // `selectedItem.props` rather than re-reading app state because the
    // insert dispatch is synchronous from our point of view but Puck's
    // async `resolveData` pipeline may fire before the replace lands; the
    // explicit replace here wins and re-runs resolveData on the cloned
    // props.
    dispatch({
      type: "replace",
      destinationZone: zoneCompound,
      destinationIndex,
      data: {
        type: componentType,
        props: {
          ...clonePropsForInsert(
            selectedItem.props as Record<string, unknown>,
          ),
          id: newId,
        },
      },
    });

    // Step 3 — move selection to the new copy so the user can immediately
    // tweak it (matches Puck's own `duplicate` action behavior).
    dispatch({
      type: "setUi",
      ui: {
        itemSelector: { zone: zoneCompound, index: destinationIndex },
      },
    });
  }, [dispatch, selectedItem, selector]);

  const onDelete = React.useCallback(() => {
    if (!selector) return;
    dispatch({
      type: "remove",
      index: selector.index,
      zone: selector.zone || ROOT_ZONE_COMPOUND,
    });
    // After remove, Puck clears the itemSelector on its own; the
    // ElementHeader unmounts because `selectedItem` becomes `null` and
    // this container returns `null` below.
  }, [dispatch, selector]);

  const onMoveUp = React.useCallback(() => {
    if (!selector || !canMoveUp) return;
    const zoneCompound = selector.zone || ROOT_ZONE_COMPOUND;
    dispatch({
      type: "reorder",
      sourceIndex: selector.index,
      destinationIndex: selector.index - 1,
      destinationZone: zoneCompound,
    });
    // Keep selection on the moved item by updating the item selector to
    // the new index. Puck's reorder reducer does not update the selector
    // for us — without this the toolbar would appear to jump to whatever
    // item now occupies the old index.
    dispatch({
      type: "setUi",
      ui: {
        itemSelector: { zone: zoneCompound, index: selector.index - 1 },
      },
    });
  }, [canMoveUp, dispatch, selector]);

  const onMoveDown = React.useCallback(() => {
    if (!selector || !canMoveDown) return;
    const zoneCompound = selector.zone || ROOT_ZONE_COMPOUND;
    dispatch({
      type: "reorder",
      sourceIndex: selector.index,
      destinationIndex: selector.index + 1,
      destinationZone: zoneCompound,
    });
    dispatch({
      type: "setUi",
      ui: {
        itemSelector: { zone: zoneCompound, index: selector.index + 1 },
      },
    });
  }, [canMoveDown, dispatch, selector]);

  // ─── Save to Library ────────────────────────────────────────────────────────

  const { openSaveDialog } = useLibrary();

  const onSaveToLibrary = React.useCallback(() => {
    if (!selectedItem || !selectedId) return;
    const data = appState.data;

    // The selected component instance itself
    const content = [selectedItem as unknown as import("../types").ComponentInstance];

    // Extract zones belonging to this component. Zone keys in Puck follow
    // the pattern "{componentInstanceId}:{zoneName}" or sometimes
    // "{ComponentType}-{uuid}:{zoneName}". We match any zone key that
    // contains the selected component's ID.
    const zones: Record<string, import("../types").ComponentInstance[]> = {};
    if (data.zones) {
      for (const [key, value] of Object.entries(data.zones)) {
        if (key.includes(selectedId)) {
          zones[key] = value as import("../types").ComponentInstance[];
        }
      }
    }

    openSaveDialog(content, zones);
  }, [selectedItem, selectedId, appState.data, openSaveDialog]);

  if (!selectedItem || !selectedId) return null;

  const visibility = resolveVisibility(
    (selectedItem.props as { _visibility?: unknown })._visibility,
  );
  const hiddenAtBreakpoint = !visibility[activeBreakpoint]
    ? activeBreakpoint.charAt(0).toUpperCase() + activeBreakpoint.slice(1)
    : undefined;

  return (
    <ElementHeader
      itemId={selectedId}
      label={label}
      anchorEl={anchorEl}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onSaveToLibrary={onSaveToLibrary}
      hiddenAtBreakpoint={hiddenAtBreakpoint}
    />
  );
}
