"use client";

/**
 * useInlineSelection — map a DOM click to a Puck item id.
 *
 * Spec: custom-branded-page-builder — task 15.2
 * _Requirements: 8.3_
 *
 * Walks up the parent chain from the clicked element looking for the
 * nearest `[data-puck-id]` annotation. Returns `null` when no annotated
 * ancestor exists, which is the click-outside signal the
 * `SelectionOverlay` uses to clear the current selection.
 *
 * The hook is intentionally event-driven (no DOM observation) — it
 * subscribes to `pointerdown` on the document so it works regardless of
 * which block runtime catches the click first. We use `pointerdown`
 * (not `click`) so selection happens before any block's own click
 * handler runs, giving the overlay first dibs on the user's intent.
 */

import { useEffect, useState, useCallback } from "react";

/**
 * Slice 2 (15.5 future) annotates each rendered block's root with this
 * attribute. Keep it in sync with whatever `withEditModeAnnotations`
 * emits in `PageRenderer`.
 */
export const PUCK_ID_ATTR = "data-puck-id";

export function findPuckIdFromTarget(
  target: EventTarget | null,
): string | null {
  if (!(target instanceof Element)) return null;
  const annotated = target.closest(`[${PUCK_ID_ATTR}]`);
  if (!annotated) return null;
  const id = annotated.getAttribute(PUCK_ID_ATTR);
  return id && id.length > 0 ? id : null;
}

export interface InlineSelection {
  selectedId: string | null;
  /** The DOM element bearing `data-puck-id`, kept for overlay positioning. */
  selectedEl: HTMLElement | null;
  setSelectedId: (id: string | null) => void;
  /**
   * Imperatively set the selected element. Paired with `setSelectedId` so an
   * external capture-phase driver (the live editor's NavigationNeutralizer,
   * which resolves both the id and the element) can push a complete selection
   * into this state container when the hook is mounted with `active=false`.
   * The internal `pointerdown` listener also uses this when `active=true`.
   */
  setSelectedEl: (el: HTMLElement | null) => void;
}

export function useInlineSelection(active: boolean): InlineSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEl, setSelectedEl] = useState<HTMLElement | null>(null);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    const id = findPuckIdFromTarget(e.target);
    if (id === null) {
      // Allow clicks inside the inline editor's own UI (sheet, toolbar)
      // to leave the selection untouched. Those panels mark themselves
      // with `data-inline-editor-ui`.
      if (
        e.target instanceof Element &&
        e.target.closest("[data-inline-editor-ui]")
      ) {
        return;
      }
      setSelectedId(null);
      setSelectedEl(null);
      return;
    }
    const el =
      e.target instanceof Element
        ? (e.target.closest(`[${PUCK_ID_ATTR}]`) as HTMLElement | null)
        : null;
    setSelectedId(id);
    setSelectedEl(el);
  }, []);

  useEffect(() => {
    if (!active) return;
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [active, handlePointerDown]);

  // Clear selection when the underlying element disappears (e.g. block
  // removed). Cheap re-check on mount/selection change.
  useEffect(() => {
    if (!selectedEl) return;
    if (!document.contains(selectedEl)) {
      setSelectedId(null);
      setSelectedEl(null);
    }
  }, [selectedEl]);

  return { selectedId, selectedEl, setSelectedId, setSelectedEl };
}
