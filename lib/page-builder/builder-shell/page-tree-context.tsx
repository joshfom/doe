"use client";

/**
 * PageTreeContext — provides a shared, memoized PageTree instance to all
 * consumers within the BuilderShell.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 12.4
 * _Requirements: 8.2, 13.1_
 *
 * Instead of each consumer (OutlineTree, ConfigurationPanel header, StatusBar)
 * independently deriving the tree from `appState.data`, this context derives
 * it once and shares the reference. The tree is memoized on `appState.data`
 * reference equality — Puck replaces the `data` object on every mutation, so
 * reference equality is the correct cache key.
 *
 * The provider also exposes `selectedId` and a `setSelection` helper so
 * consumers don't need to independently wire up the dispatch + scroll +
 * announce logic.
 */

import React, { createContext, useContext, useMemo, useCallback } from "react";
import { buildPageTree } from "./page-tree";
import type { PageTree, PuckSelector } from "./page-tree";
import { usePuckStore } from "../use-puck-store";
import { useSelectionAnnounce } from "./SelectionLiveRegion";

// ─── Context value ───────────────────────────────────────────────────────────

export interface PageTreeContextValue {
  tree: PageTree;
  selectedId: string | null;
  setSelection(selector: PuckSelector | null, id?: string | null): void;
}

const PageTreeContext = createContext<PageTreeContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * PageTreeProvider — must be rendered inside the `<Puck>` subtree so that
 * `usePuckStore` is available.
 */
export function PageTreeProvider({ children }: { children: React.ReactNode }) {
  const appState = usePuckStore((s) => s.appState);
  const config = usePuckStore((s) => s.config);
  const dispatch = usePuckStore((s) => s.dispatch);
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const announce = useSelectionAnnounce();

  const selectedId = selectedItem ? (selectedItem.props.id as string) : null;

  const tree = useMemo(
    () => buildPageTree(appState.data, config),
    [appState.data, config],
  );

  const setSelection = useCallback(
    (selector: PuckSelector | null, id?: string | null) => {
      dispatch({
        type: "setUi",
        ui: { itemSelector: selector },
      });

      const resolvedId = id ?? null;
      if (resolvedId) {
        const el = document.querySelector(`[data-puck-id="${resolvedId}"]`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        const node = tree.byId.get(resolvedId);
        if (node) {
          announce(node.label);
        }
      } else {
        announce("Page");
      }
    },
    [dispatch, tree, announce],
  );

  const value = useMemo<PageTreeContextValue>(
    () => ({ tree, selectedId, setSelection }),
    [tree, selectedId, setSelection],
  );

  return (
    <PageTreeContext.Provider value={value}>
      {children}
    </PageTreeContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the shared PageTree context. Must be used inside `<PageTreeProvider>`.
 */
export function usePageTree(): PageTreeContextValue {
  const ctx = useContext(PageTreeContext);
  if (!ctx) {
    throw new Error("usePageTree must be used inside <PageTreeProvider>");
  }
  return ctx;
}
