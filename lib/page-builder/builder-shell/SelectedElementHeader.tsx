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
 *   - Duplicate   → `dispatch({ type: "setData", ... })` with a deep-cloned
 *                   subtree (the selected block plus all of its descendant
 *                   zones), every id regenerated and zone keys remapped, then
 *                   `setUi` to select the copy (Req 4.3).
 *   - Delete      → `dispatch({ type: "remove", ... })` (Req 4.4).
 *   - Move up /   → `dispatch({ type: "reorder", ... })` within the same
 *     Move down     zone, shifting the source index by ±1 (Req 4.5).
 *
 * Why a full deep clone via `setData` (not Puck's `insert` + `replace`): a
 * shallow `insert`/`replace` only copies a single item's top-level props and
 * leaves nested objects/arrays sharing references with the source, and it does
 * not copy the child *zones* that container blocks (Flex/Columns/Section/
 * Accordion) use to hold their children. That produced "mirror" copies —
 * editing the copy mutated the original, and duplicated columns came up empty
 * or linked. `buildDuplicatedSubtree` (see `./duplicate-subtree`) collects the
 * block + every descendant zone, deep-clones the whole tree, regenerates all
 * ids, and remaps the zone keys via the shared `regenerateIds` helper, so the
 * copy is completely independent. This mirrors the Component Library insert
 * flow, which already merges a regenerated subtree via `setData`.
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
import { buildDuplicatedSubtree, type SubtreeData } from "./duplicate-subtree";
import type { ComponentInstance } from "../types";

// Puck's root zone compound — used as the fallback zone when a block sits
// at the top level of the page. Mirrors `rootAreaId` + `rootZone` in
// `@puckeditor/core` (`root:default-zone`).
const ROOT_ZONE_COMPOUND = "root:default-zone";

// ─── ID generation ───────────────────────────────────────────────────────────
//
// Duplicate now deep-clones the whole subtree and regenerates every id via the
// shared `regenerateIds` helper (see `./duplicate-subtree`), so the previous
// local `generateComponentId` / `clonePropsForInsert` shallow-clone helpers are
// no longer needed and have been removed.

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
  // Puck attaches to each rendered block's root element. Puck v0.21 renders
  // the canvas inside an iframe (`#preview-frame`), so we look in the
  // iframe's document first and fall back to the parent document when the
  // canvas is rendered inline. The retry loop handles the race where Puck
  // has emitted the block into the tree but not yet attached the
  // attribute; a handful of rAF ticks is plenty.
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!selectedId || typeof document === "undefined") {
      setAnchorEl(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 32;
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
    const findAnchor = (id: string): HTMLElement | null => {
      const selector = `[data-puck-component="${escapeSelector(id)}"]`;
      // 1) parent document (when iframe rendering is disabled)
      const direct = document.querySelector<HTMLElement>(selector);
      if (direct) return direct;
      // 2) Puck v0.21+ renders inside #preview-frame iframe — query its
      //    contentDocument for the same selector. We tolerate a missing
      //    contentDocument (cross-origin / not-yet-loaded) by returning
      //    null; the retry loop below will tick again.
      const iframe = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const innerDoc = iframe?.contentDocument ?? null;
      if (innerDoc) {
        const inFrame = innerDoc.querySelector<HTMLElement>(selector);
        if (inFrame) return inFrame;
      }
      return null;
    };
    const tick = () => {
      if (cancelled) return;
      const el = findAnchor(selectedId);
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

    // Deep-clone the selected block plus all of its descendant zones into a
    // fully independent subtree: every id is regenerated and zone keys are
    // remapped, and props are deep-cloned (no shared references). This is what
    // makes the copy a separate node rather than a mirror of the source, and
    // it brings along every child object when duplicating a column/Flex.
    const { data: mergedData, zoneCompound, destinationIndex } =
      buildDuplicatedSubtree(
        appState.data as unknown as SubtreeData,
        selectedItem as unknown as ComponentInstance,
        selector,
      );

    // A single setData applies the inserted clone + its copied zones. The
    // source data is already in the editor's current model, so no migration is
    // needed (this matches the templates plugin, which also writes zones via
    // setData directly).
    dispatch({
      type: "setData",
      data: mergedData as unknown as Partial<import("@puckeditor/core").Data>,
    });

    // Move selection to the new copy so the user can immediately tweak it
    // (matches Puck's own `duplicate` action behavior).
    dispatch({
      type: "setUi",
      ui: {
        itemSelector: { zone: zoneCompound, index: destinationIndex },
      },
    });
  }, [appState.data, dispatch, selectedItem, selector]);

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
