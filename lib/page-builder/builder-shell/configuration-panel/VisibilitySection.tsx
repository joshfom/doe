"use client";

/**
 * VisibilitySection — per-breakpoint visibility toggles for the selected
 * block.
 *
 * Spec: custom-branded-page-builder — task 11.3
 * _Requirements: 13.1, 13.5_
 *
 * Renders inside the ConfigurationPanel as a dedicated PropertySection
 * with three toggles writing into the block's `_visibility: VisibilityFlags`
 * prop. The default for any unset flag is `true` (Req 13.2 — fully
 * resolved by `resolveVisibility` and the renderer pipeline). When all
 * three toggles are `false`, a warning is shown (Req 13.5).
 */

import React from "react";
import { PropertySection } from "./PropertySection";
import { ORA_THEME } from "../inspector/tokens";
import {
  resolveVisibility,
  type VisibilityFlags,
} from "../../visibility";

export interface VisibilitySectionProps {
  blockType: string;
  /** Current `_visibility` value from the block's props (may be undefined). */
  value: unknown;
  onChange: (next: VisibilityFlags) => void;
}

const ROWS: ReadonlyArray<{ key: keyof VisibilityFlags; label: string }> = [
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "mobile", label: "Mobile" },
];

export function VisibilitySection({
  blockType,
  value,
  onChange,
}: VisibilitySectionProps) {
  const flags = resolveVisibility(value);
  const allHidden = !flags.desktop && !flags.tablet && !flags.mobile;

  const toggle = (key: keyof VisibilityFlags) => {
    onChange({ ...flags, [key]: !flags[key] });
  };

  return (
    <PropertySection
      blockType={blockType}
      sectionId="visibility"
      label="Visibility"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ROWS.map((row) => (
          <label
            key={row.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 12,
              color: ORA_THEME.charcoal,
            }}
          >
            <span>{row.label}</span>
            <input
              type="checkbox"
              checked={flags[row.key]}
              onChange={() => toggle(row.key)}
              aria-label={`Visible on ${row.label}`}
            />
          </label>
        ))}
        {allHidden ? (
          <div
            role="alert"
            style={{
              marginTop: 4,
              padding: "6px 8px",
              fontSize: 11,
              color: "#8a3d00",
              background: "#FFF4E5",
              border: "1px solid #F5C580",
            }}
          >
            This block is hidden on every breakpoint and will not render.
          </div>
        ) : null}
      </div>
    </PropertySection>
  );
}
