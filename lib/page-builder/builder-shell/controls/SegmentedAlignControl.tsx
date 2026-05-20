"use client";

/**
 * SegmentedAlignControl — ORA-themed four-option alignment control.
 *
 * Spec: custom-branded-page-builder — Requirement 6.1
 *
 * Renders four icon-only buttons in the order: left / center / right /
 * justify. Each button exposes an `aria-label` describing the alignment
 * and `aria-pressed={value === option}` so assistive tech announces the
 * active state. Tab moves focus between buttons and Enter/Space activate
 * via native `<button>` semantics.
 *
 * The control is purely presentational — wiring into `FieldControlRegistry`
 * (to back Puck `radio` fields for `align`) happens in a later task.
 */

import React from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
} from "lucide-react";
import { ORA_THEME } from "../inspector/tokens";

export type AlignValue = "left" | "center" | "right" | "justify";

export interface SegmentedAlignControlProps {
  value: AlignValue;
  onChange: (next: AlignValue) => void;
  label?: string;
}

interface AlignOption {
  value: AlignValue;
  ariaLabel: string;
  Icon: React.ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
}

const ALIGN_OPTIONS: ReadonlyArray<AlignOption> = [
  { value: "left", ariaLabel: "Align left", Icon: AlignLeft },
  { value: "center", ariaLabel: "Align center", Icon: AlignCenter },
  { value: "right", ariaLabel: "Align right", Icon: AlignRight },
  { value: "justify", ariaLabel: "Justify", Icon: AlignJustify },
];

export function SegmentedAlignControl({
  value,
  onChange,
  label,
}: SegmentedAlignControlProps) {
  return (
    <div style={rowStyle}>
      {label ? <div style={labelStyle}>{label}</div> : null}
      <div role="group" aria-label={label ?? "Alignment"} style={groupStyle}>
        {ALIGN_OPTIONS.map((option, index) => {
          const active = value === option.value;
          const isFirst = index === 0;
          const isLast = index === ALIGN_OPTIONS.length - 1;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={option.ariaLabel}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              style={segmentButtonStyle(active, isFirst, isLast)}
            >
              <option.Icon size={16} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const rowStyle: React.CSSProperties = {
  marginBottom: 12,
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

const groupStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "stretch",
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  background: ORA_THEME.white,
};

const segmentButtonStyle = (
  active: boolean,
  isFirst: boolean,
  isLast: boolean,
): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 30,
  padding: 0,
  background: active ? ORA_THEME.gold : ORA_THEME.white,
  color: active ? ORA_THEME.charcoal : ORA_THEME.muted,
  border: "none",
  borderLeft: isFirst ? "none" : `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  // Hint to the browser that these buttons form a contiguous segmented row.
  outlineOffset: -2,
  // Remove stray margin contributions for edge buttons; keeps the outer
  // group's single border clean.
  marginLeft: isFirst ? 0 : 0,
  marginRight: isLast ? 0 : 0,
});
