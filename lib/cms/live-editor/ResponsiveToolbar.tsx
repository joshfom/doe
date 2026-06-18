"use client";

/**
 * ResponsiveToolbar — floating breakpoint segmented control for the Live_Editor.
 *
 * Spec: live-page-editor — Task 6.1.
 * _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7_
 *
 * A floating (`position: fixed`) ORA-branded segmented control that stays
 * visible while the user scrolls the Live_Editor (Req 5.1). It is modeled on
 * the structured builder's `BreakpointSwitcher`
 * (`lib/page-builder/builder-shell/BreakpointSwitcher.tsx`) — same three
 * mutually-exclusive desktop/tablet/mobile options, same `aria-pressed` active
 * indication, same ORA token styling — but rendered as a free-floating overlay
 * rather than a top-bar child.
 *
 * Behavior:
 *   - Exactly three mutually exclusive options (desktop / tablet / mobile),
 *     each a `<button aria-pressed>` so the active selection is announced and
 *     the other two read as inactive (Req 5.2, 5.6).
 *   - Defaults to desktop: the active breakpoint comes from the surrounding
 *     `<BreakpointProvider initial="desktop">`, so on first load desktop reads
 *     as pressed (Req 5.5).
 *   - Selecting an option calls `setActiveBreakpoint(bp)` from `useBreakpoint()`,
 *     which drives both `withBreakpointResolution` (per-tier value resolution)
 *     and the `PreviewStage` virtual width (Req 5.3, 5.4).
 *   - Availability is determined from `PREVIEW_VIRTUAL_WIDTHS` (exported by
 *     `PreviewStage`). If the chosen breakpoint has no numeric virtual width,
 *     the current size is retained (no `setActiveBreakpoint` call) and
 *     `onUnavailableBreakpoint(bp)` fires alongside an inline error indication
 *     naming the unavailable breakpoint (Req 5.7).
 *
 * The root carries `data-inline-editor-ui` so the Navigation_Neutralizer
 * exempts it from neutralization and block selection (Req 4.7).
 */

import React from "react";
import { useBreakpoint, type Breakpoint } from "@/lib/page-builder/breakpoint-context";
import { ORA_THEME } from "@/lib/page-builder/builder-shell/inspector/tokens";
import { PREVIEW_VIRTUAL_WIDTHS } from "@/lib/cms/live-editor/PreviewStage";

interface Option {
  id: Breakpoint;
  label: string;
  // Inline visual cue — kept as text (no icon import) to mirror BreakpointSwitcher.
  glyph: string;
}

const OPTIONS: ReadonlyArray<Option> = [
  { id: "desktop", label: "Desktop", glyph: "▭" },
  { id: "tablet", label: "Tablet", glyph: "▢" },
  { id: "mobile", label: "Mobile", glyph: "▯" },
];

/**
 * Whether a breakpoint has a defined virtual width in the preview pipeline.
 * Drives the Req 5.7 unavailable-breakpoint guard: a breakpoint with no
 * numeric width cannot be previewed, so the toolbar retains the current size.
 */
function hasVirtualWidth(bp: Breakpoint): boolean {
  return typeof PREVIEW_VIRTUAL_WIDTHS[bp] === "number";
}

export interface ResponsiveToolbarProps {
  /** Reports a breakpoint with no defined virtual width (Req 5.7). */
  onUnavailableBreakpoint?: (bp: Breakpoint) => void;
}

export function ResponsiveToolbar({
  onUnavailableBreakpoint,
}: ResponsiveToolbarProps = {}): React.ReactElement {
  const { activeBreakpoint, setActiveBreakpoint } = useBreakpoint();

  // Tracks the most recent breakpoint that could not be previewed so the
  // toolbar can surface an error indication naming it (Req 5.7).
  const [unavailable, setUnavailable] = React.useState<Breakpoint | null>(null);

  const select = React.useCallback(
    (next: Breakpoint) => {
      if (!hasVirtualWidth(next)) {
        // No virtual width → retain the current preview size and surface an
        // error indication identifying the unavailable breakpoint (Req 5.7).
        setUnavailable(next);
        onUnavailableBreakpoint?.(next);
        return;
      }
      setUnavailable(null);
      if (next === activeBreakpoint) return;
      setActiveBreakpoint(next);
    },
    [activeBreakpoint, setActiveBreakpoint, onUnavailableBreakpoint],
  );

  return (
    <div
      data-inline-editor-ui
      data-testid="live-responsive-toolbar"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <div
        role="group"
        aria-label="Preview size"
        data-testid="live-breakpoint-switcher"
        style={{
          display: "inline-flex",
          border: `1px solid ${ORA_THEME.border}`,
          borderRadius: 0,
          overflow: "hidden",
          background: ORA_THEME.charcoal,
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
        }}
      >
        {OPTIONS.map((opt) => {
          const isActive = opt.id === activeBreakpoint;
          return (
            <button
              key={opt.id}
              type="button"
              aria-label={opt.label}
              aria-pressed={isActive}
              data-active={isActive ? "true" : "false"}
              onClick={() => select(opt.id)}
              style={{
                height: 28,
                padding: "0 12px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                border: "none",
                cursor: "pointer",
                background: isActive ? ORA_THEME.gold : "transparent",
                color: ORA_THEME.white,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span aria-hidden="true">{opt.glyph}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {unavailable !== null ? (
        <div
          role="alert"
          data-testid="live-breakpoint-error"
          style={{
            background: ORA_THEME.danger,
            color: ORA_THEME.white,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "4px 10px",
            maxWidth: 320,
            textAlign: "center",
          }}
        >
          {`Preview size unavailable: ${unavailable}`}
        </div>
      ) : null}
    </div>
  );
}

export default ResponsiveToolbar;
