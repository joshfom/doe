"use client";

import React from "react";
import type { Overrides } from "@puckeditor/core";
import type { EditorTheme } from "../types";
import { themeToCustomProperties, defaultTheme, ora } from "../theme";

/**
 * Build Puck UI overrides — ORA Design System.
 * Square corners, thin borders, warm neutrals, gold accent.
 */
export function createOverrides(theme: EditorTheme = defaultTheme): Partial<Overrides> {
  const cssVars = themeToCustomProperties(theme);

  return {
    header: ({ actions, children }) => (
      <div
        style={{
          ...cssVars,
          background: ora.charcoalDark,
          color: ora.white,
          fontFamily: "var(--pb-font-family, system-ui, sans-serif)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          minHeight: 48,
          borderBottom: `1px solid ${ora.charcoal}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {theme.logo && <span>{theme.logo}</span>}
          <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
            ORA
          </span>
          <span style={{ width: 1, height: 16, background: ora.slate }} />
          <span style={{ fontWeight: 400, fontSize: 12, color: ora.muted }}>
            Page Builder
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {actions}
        </div>
      </div>
    ),

    fields: ({ children, isLoading }) => (
      <div
        style={{
          ...cssVars,
          background: ora.creamLight,
          color: ora.charcoal,
          fontFamily: "var(--pb-font-family, system-ui, sans-serif)",
          padding: 12,
          overflowY: "auto",
          height: "100%",
          fontSize: 13,
        }}
      >
        {isLoading ? (
          <div style={{ padding: 16, textAlign: "center", color: ora.muted }}>
            Loading…
          </div>
        ) : (
          children
        )}
      </div>
    ),

    components: ({ children }) => (
      <div
        style={{
          ...cssVars,
          background: ora.creamLight,
          color: ora.charcoal,
          fontFamily: "var(--pb-font-family, system-ui, sans-serif)",
          padding: 8,
          fontSize: 13,
        }}
      >
        {children}
      </div>
    ),
  };
}
