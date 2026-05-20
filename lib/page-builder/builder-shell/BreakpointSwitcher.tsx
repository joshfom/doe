"use client";

/**
 * BreakpointSwitcher — three-option segmented control in the top bar.
 *
 * Spec: custom-branded-page-builder — task 10.2, 10.3, 10.4
 * _Requirements: 12.1, 12.2, 12.4_
 *
 * Reads/writes the active breakpoint via `useBreakpoint()`. Mounted by
 * `TopBar` so the canvas wrapper in `BuilderShell` can subscribe to the
 * same context and adjust its preview width.
 */

import React from "react";
import { useBreakpoint, type Breakpoint } from "../breakpoint-context";
import { ORA_THEME } from "./inspector/tokens";

interface Option {
  id: Breakpoint;
  label: string;
  // Visual cue — kept inline (no icon import) so the switcher stays small.
  glyph: string;
}

const OPTIONS: ReadonlyArray<Option> = [
  { id: "desktop", label: "Desktop", glyph: "▭" },
  { id: "tablet", label: "Tablet", glyph: "▢" },
  { id: "mobile", label: "Mobile", glyph: "▯" },
];

export interface BreakpointSwitcherProps {
  /**
   * Optional callback fired after the active breakpoint changes. The
   * `BuilderShell` uses this hook for side-effects (resizing the canvas
   * preview) without needing to subscribe to the context itself.
   */
  onChange?: (next: Breakpoint) => void;
}

export function BreakpointSwitcher({ onChange }: BreakpointSwitcherProps = {}) {
  const { activeBreakpoint, setActiveBreakpoint } = useBreakpoint();

  const select = React.useCallback(
    (next: Breakpoint) => {
      if (next === activeBreakpoint) return;
      setActiveBreakpoint(next);
      onChange?.(next);
    },
    [activeBreakpoint, setActiveBreakpoint, onChange],
  );

  return (
    <div
      role="group"
      aria-label="Active breakpoint"
      data-testid="ora-breakpoint-switcher"
      style={{
        display: "inline-flex",
        border: "1px solid rgba(255,255,255,0.25)",
        borderRadius: 0,
        overflow: "hidden",
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
              padding: "0 10px",
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
  );
}
