/**
 * PaletteSection — collapsible section wrapper for the left rail.
 *
 * Spec: builder-canvas-polish-and-inline-richtext
 * _Requirements: 8.1 (Outline Tree placement), Resolved Design Input 2_
 *
 * Renders a header row with a title and a chevron toggle. Clicking the header
 * collapses/expands the body. Each section owns its own `overflow: auto` so
 * the two stacked sections in the left rail scroll independently.
 */

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ORA_THEME } from "./inspector/tokens";

export interface PaletteSectionProps {
  title: string;
  collapsible?: boolean;
  children: React.ReactNode;
}

export function PaletteSection({
  title,
  collapsible = false,
  children,
}: PaletteSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const handleToggle = () => {
    if (collapsible) {
      setCollapsed((prev) => !prev);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: collapsed ? "0 0 auto" : "1 1 0",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={collapsible ? !collapsed : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: ORA_THEME.creamLight,
          border: "none",
          borderBottom: `1px solid ${ORA_THEME.border}`,
          cursor: collapsible ? "pointer" : "default",
          width: "100%",
          textAlign: "left",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: ORA_THEME.charcoal,
        }}
      >
        <span>{title}</span>
        {collapsible && (
          <ChevronDown
            size={14}
            style={{
              transition: "transform 150ms ease",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              color: ORA_THEME.muted,
            }}
          />
        )}
      </button>

      {/* Collapsible body */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
