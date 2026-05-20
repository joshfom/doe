import type { EditorTheme } from "./types";

// Re-export canonical breakpoint thresholds so theme consumers (public
// renderer, builder-shell canvas preview) can import tokens and
// breakpoints from the same module.
// Source of truth lives in `./breakpoints.ts`.
export { BREAKPOINTS } from "./breakpoints";
export type {
  Breakpoint,
  BreakpointValue,
  BreakpointsThresholds,
  VisibilityFlags,
} from "./breakpoints";

/**
 * Convert an EditorTheme into CSS custom properties for styling the editor UI.
 */
export function themeToCustomProperties(
  theme: EditorTheme
): Record<string, string> {
  return {
    "--pb-color-primary": theme.colors.primary,
    "--pb-color-primary-foreground": theme.colors.primaryForeground,
    "--pb-color-sidebar": theme.colors.sidebar,
    "--pb-color-sidebar-foreground": theme.colors.sidebarForeground,
    "--pb-color-canvas": theme.colors.canvas,
    ...(theme.fontFamily ? { "--pb-font-family": theme.fontFamily } : {}),
  };
}

// ─── ORA Design System Palette ───────────────────────────────────────────────

export const ora = {
  // Neutrals
  white: "#FFFFFF",
  creamLight: "#F9F7F5",
  cream: "#F5F3F0",
  creamDark: "#EBE7E2",
  sandLight: "#EDEAE6",
  sand: "#E8E4DF",
  sandDark: "#D4CFC8",
  stoneLight: "#DDD9D3",
  stone: "#D4CFC8",
  stoneDark: "#B8B3AB",

  // Text
  charcoalDark: "#1A1A1A",
  charcoal: "#2C2C2C",
  charcoalLight: "#4A4A4A",
  slate: "#6B6B6B",
  muted: "#9A9A9A",

  // Gold accent
  goldLight: "#D4B896",
  gold: "#B8956B",
  goldDark: "#8B7355",

  // Status
  success: "#5C8A6B",
  warning: "#C4A35A",
  error: "#B85C5C",
  info: "#5C7A8A",
};

/**
 * Default editor theme — ORA Design System.
 */
export const defaultTheme: EditorTheme = {
  colors: {
    primary: ora.charcoal,
    primaryForeground: ora.white,
    sidebar: ora.creamLight,
    sidebarForeground: ora.charcoal,
    canvas: ora.white,
  },
  fontFamily: "var(--font-geist-sans, system-ui, sans-serif)",
};

// Keep backward compat
export const oraBrand = ora;
