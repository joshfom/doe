"use client";

import React, { useMemo, useCallback } from "react";
import { ORA_THEME } from "./inspector/tokens";
import { useBuilderShell } from "./shell-context";
import { usePuckStore } from "../use-puck-store";
import { AncestorBreadcrumb } from "./AncestorBreadcrumb";
import { buildPageTree, buildAncestorPath } from "./page-tree";
import type { PuckSelector } from "./page-tree";
import { useSelectionAnnounce } from "./SelectionLiveRegion";

export function StatusBar() {
  const { dirty, lastSavedAt, errorMessage, dismissError } = useBuilderShell();

  const selectedItem = usePuckStore((s) => s.selectedItem);
  const appState = usePuckStore((s) => s.appState);
  const config = usePuckStore((s) => s.config);
  const dispatch = usePuckStore((s) => s.dispatch);

  const selectedId = selectedItem
    ? (selectedItem.props.id as string)
    : null;

  // Derive the page tree from current data, memoized on data reference.
  const tree = useMemo(
    () => buildPageTree(appState.data, config),
    [appState.data, config],
  );

  // Build ancestor path for the breadcrumb (includes ancestors only;
  // AncestorBreadcrumb with includeSelf appends the selected block).
  const segments = useMemo(
    () => buildAncestorPath(tree, selectedId),
    [tree, selectedId],
  );

  const announce = useSelectionAnnounce();

  const handleSelect = useCallback(
    (selector: PuckSelector | null, id: string | null) => {
      dispatch({
        type: "setUi",
        ui: { itemSelector: selector },
      });
      if (id) {
        const el = document.querySelector(`[data-puck-id="${id}"]`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        // Announce the newly selected block's label for assistive tech.
        const node = tree.byId.get(id);
        if (node) {
          announce(node.label);
        }
      } else {
        announce("Page");
      }
    },
    [dispatch, tree, announce],
  );

  return (
    <footer
      data-testid="ora-statusbar"
      style={{
        gridColumn: "1 / -1",
        gridRow: "3",
        background: ORA_THEME.white,
        borderTop: `1px solid ${ORA_THEME.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 12,
        fontSize: 11,
        color: ORA_THEME.muted,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
        {selectedItem ? (
          <AncestorBreadcrumb
            segments={segments}
            includeSelf={true}
            truncateBelowWidthPx={480}
            onSelect={handleSelect}
          />
        ) : (
          <span>No selection</span>
        )}
      </div>
      {errorMessage ? (
        <button
          type="button"
          onClick={dismissError}
          style={{
            background: "transparent",
            border: `1px solid ${ORA_THEME.danger}`,
            color: ORA_THEME.danger,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 11,
            borderRadius: 0,
          }}
          aria-label="Dismiss error"
        >
          {errorMessage} ✕
        </button>
      ) : null}
      <span>
        {dirty
          ? "Unsaved changes"
          : lastSavedAt
            ? `Saved ${formatTime(lastSavedAt)}`
            : "Not saved yet"}
      </span>
    </footer>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
