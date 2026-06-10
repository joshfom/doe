"use client";

/**
 * SectionStore — open/closed state for ConfigurationPanel PropertySection
 * instances, keyed per block type + section id.
 *
 * Spec: custom-branded-page-builder — Requirement 3.4 (Property_Section
 * open/closed state persisted per block type across selections within a
 * single editor session).
 *
 * Key format: `${blockType}:${sectionId}`. Using block type (not block id)
 * means that opening `Background Settings` on one `Section` block keeps it
 * open on the next `Section` the editor selects — exactly the UX described
 * by Requirement 3.4.
 *
 * Scope: per editor session (see `design.md` state-store table). No
 * persistence to `localStorage` or `sessionStorage`.
 *
 * Consumer patterns:
 *   - React components use the `useSectionOpen()` hook
 *   - Non-React consumers use `sectionStore.isSectionOpen(...)` and
 *     `sectionStore.setSectionOpen(...)` directly.
 */

import React from "react";
import { createStore } from "../store";

export interface SectionState {
  /** Keyed by `${blockType}:${sectionId}` — value is the open flag. */
  openByKey: Record<string, boolean>;
}

export interface SectionStoreApi {
  getState: () => SectionState;
  subscribe: (listener: () => void) => () => void;
  /**
   * Returns the current open/closed state for a section. If the user has
   * not yet interacted with this section, returns `defaultOpen`.
   */
  isSectionOpen: (
    blockType: string,
    sectionId: string,
    defaultOpen?: boolean,
  ) => boolean;
  /** Records the open/closed state for a section. */
  setSectionOpen: (
    blockType: string,
    sectionId: string,
    open: boolean,
  ) => void;
  /** Wipe all recorded section state. Useful for tests and session resets. */
  reset: () => void;
}

function keyOf(blockType: string, sectionId: string): string {
  return `${blockType}:${sectionId}`;
}

/**
 * Create a fresh section store instance. Exported for tests and for
 * components that want their own isolated store.
 */
export function createSectionStore(
  initial: SectionState = { openByKey: {} },
): SectionStoreApi {
  const store = createStore<SectionState>(initial);
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    isSectionOpen: (blockType, sectionId, defaultOpen = false) => {
      const recorded = store.getState().openByKey[keyOf(blockType, sectionId)];
      return recorded ?? defaultOpen;
    },
    setSectionOpen: (blockType, sectionId, open) => {
      const k = keyOf(blockType, sectionId);
      store.setState((prev) => {
        if (prev.openByKey[k] === open) return prev;
        return {
          ...prev,
          openByKey: { ...prev.openByKey, [k]: open },
        };
      });
    },
    reset: () =>
      store.setState((prev) =>
        Object.keys(prev.openByKey).length === 0
          ? prev
          : { openByKey: {} },
      ),
  };
}

/**
 * Module-scoped singleton. This is the store that the `PropertySection`
 * component binds to.
 */
export const sectionStore: SectionStoreApi = createSectionStore();

/**
 * React hook — subscribes to a single section's open state.
 * Returns `[isOpen, setOpen]` for ergonomic destructuring.
 */
export function useSectionOpen(
  blockType: string,
  sectionId: string,
  defaultOpen = false,
): [boolean, (open: boolean) => void] {
  const isOpen = React.useSyncExternalStore(
    sectionStore.subscribe,
    () => sectionStore.isSectionOpen(blockType, sectionId, defaultOpen),
    () => defaultOpen,
  );
  const setOpen = React.useCallback(
    (open: boolean) => sectionStore.setSectionOpen(blockType, sectionId, open),
    [blockType, sectionId],
  );
  return [isOpen, setOpen];
}
