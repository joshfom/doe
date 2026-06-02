"use client";

/**
 * InlineRichtextActionBar — the Builder Shell's `overrides.actionBar`.
 *
 * Context (verified against @puckeditor/core@0.21.2):
 * Puck renders the selected block's overlay action bar via
 * `overrides.actionBar`, passing as `children`:
 *   - the native inline rich-text menu (`<LoadedRichTextMenu inline />`) IFF
 *     that block's inline editor currently holds focus (`currentRichText`),
 *   - plus the default Duplicate/Delete actions (gated by `permissions`).
 *
 * The Builder Shell owns move/duplicate/delete through its own
 * `SelectedElementHeader`, and disables Puck's duplicate/delete via the
 * `permissions` prop on `<Puck>`. So the ONLY thing we want from this slot is
 * the rich-text formatting bubble. This override therefore renders `children`
 * (which, with those permissions off, is exactly the rich-text menu or
 * nothing) inside an ORA-styled floating container — and renders nothing when
 * there are no children, so non-text blocks show no stray bar.
 *
 * Positioning is owned by Puck: this override is rendered inside the block's
 * `data-puck-overlay` portal, anchored above the selection, so we only style
 * the chrome (background, border, radius) and let Puck place it.
 */

import React from "react";
import { ORA_THEME } from "./inspector/tokens";

export interface InlineRichtextActionBarProps {
  label?: string;
  children: React.ReactNode;
  parentAction: React.ReactNode;
}

/**
 * True when `children` carries nothing renderable. Puck passes `false`/`null`
 * (no menu, no actions) when the block isn't being inline-edited; React arrays
 * of all-falsy entries also count as empty.
 */
function isEmptyChildren(children: React.ReactNode): boolean {
  const list = React.Children.toArray(children);
  return list.length === 0;
}

export function InlineRichtextActionBar({ children }: InlineRichtextActionBarProps) {
  if (isEmptyChildren(children)) {
    // No inline editor focused → render nothing so non-text selections don't
    // get an empty floating bar (the Builder Shell's SelectedElementHeader
    // provides the block-level toolbar instead).
    return <></> as unknown as React.ReactElement;
  }

  return (
    <div
      data-ora-inline-rte-bar
      role="toolbar"
      aria-label="Text formatting"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        gap: 2,
        padding: 2,
        background: ORA_THEME.charcoal,
        color: ORA_THEME.white,
        border: `1px solid ${ORA_THEME.gold}`,
        borderRadius: 4,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
      }}
    >
      {children}
    </div>
  );
}
