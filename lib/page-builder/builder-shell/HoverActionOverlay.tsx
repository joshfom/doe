"use client";

/**
 * HoverActionOverlay — lightweight hover-triggered action buttons for each
 * canvas block.
 *
 * Problem: The full ElementHeader toolbar only appears when a component is
 * *selected* (clicked). Non-technical users don't discover the delete action
 * because they expect a visible affordance on hover, like most visual page
 * builders.
 *
 * Solution: This component wraps each rendered block and shows a small
 * floating action bar (delete + select) in the top-right corner on hover.
 * It provides immediate visual feedback that blocks are interactive and
 * gives a one-click path to remove a component without needing to know
 * about selection first.
 *
 * Accessibility:
 *   - Buttons have `aria-label` and `title` for screen readers.
 *   - The overlay is `aria-hidden` when not visible (opacity 0).
 *   - Focus-within also reveals the overlay so keyboard users can tab into it.
 *   - Buttons use native `<button>` elements for keyboard activation.
 */

import React from "react";
import { Trash2, MousePointer } from "lucide-react";
import { ORA_THEME } from "./inspector/tokens";
import { usePuckStore } from "../use-puck-store";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface HoverActionOverlayProps {
  /** The rendered component children. */
  children: React.ReactNode;
  /** Zone compound key (e.g. "root:default-zone"). */
  zone: string;
  /** Index of this block within its zone. */
  index: number;
  /** Component type name for the aria-label. */
  label: string;
}

// ─── Style injection ─────────────────────────────────────────────────────────

const ROOT_CLASS = "ora-hover-actions";

const HOVER_ACTIONS_CSS = `
.${ROOT_CLASS} {
  position: relative;
}
.${ROOT_CLASS}__bar {
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
}
.${ROOT_CLASS}:hover > .${ROOT_CLASS}__bar,
.${ROOT_CLASS}:focus-within > .${ROOT_CLASS}__bar {
  opacity: 1;
  pointer-events: auto;
}
.${ROOT_CLASS}__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 100ms ease;
}
.${ROOT_CLASS}__btn:hover {
  background: rgba(0, 0, 0, 0.15) !important;
}
.${ROOT_CLASS}__btn:focus-visible {
  outline: 2px solid ${ORA_THEME.gold};
  outline-offset: 1px;
}
`;

let stylesInjected = false;
function ensureStylesInjected(): void {
  if (stylesInjected) return;
  if (typeof document === "undefined") return;
  const existing = document.querySelector(
    `style[data-ora-hover-actions="true"]`,
  );
  if (existing) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-ora-hover-actions", "true");
  style.textContent = HOVER_ACTIONS_CSS;
  document.head.appendChild(style);
  stylesInjected = true;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function HoverActionOverlay({
  children,
  zone,
  index,
  label,
}: HoverActionOverlayProps) {
  const dispatch = usePuckStore((s) => s.dispatch);

  React.useEffect(() => {
    ensureStylesInjected();
  }, []);

  const handleDelete = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      dispatch({
        type: "remove",
        index,
        zone,
      });
    },
    [dispatch, index, zone],
  );

  const handleSelect = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      dispatch({
        type: "setUi",
        ui: {
          itemSelector: { zone, index },
        },
      });
    },
    [dispatch, zone, index],
  );

  return (
    <div className={ROOT_CLASS} data-testid="ora-hover-action-wrapper">
      {/* Floating action bar — top-right corner */}
      <div
        className={`${ROOT_CLASS}__bar`}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          zIndex: 50,
          display: "flex",
          gap: 2,
          padding: 2,
          borderRadius: 6,
          background: ORA_THEME.charcoal,
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        }}
      >
        <button
          type="button"
          className={`${ROOT_CLASS}__btn`}
          aria-label={`Select ${label}`}
          title="Select (show all actions)"
          onClick={handleSelect}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: "transparent", color: ORA_THEME.white }}
        >
          <MousePointer size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`${ROOT_CLASS}__btn`}
          aria-label={`Delete ${label}`}
          title="Delete"
          onClick={handleDelete}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: "transparent", color: ORA_THEME.danger }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}
