/**
 * ORA palette presets shared across inspector controls.
 * Mirrors the curated palette in `lib/page-builder/config.ts` but exported
 * as flat hex arrays for use by `<OraColorPicker>` and any direct consumer.
 */

export const ORA_PALETTE_PRESETS: readonly string[] = [
  "#FFFFFF",
  "#F9F7F5",
  "#F8F6F2",
  "#F5F3F0",
  "#F2EDE3",
  "#EBE7E2",
  "#E8E4DF",
  "#B8956B",
  "#8CC9E8",
  "#01A7C7",
  "#111432",
  "#2C2C2C",
  "#1A1A1A",
  "#000000",
];

export const ORA_THEME = {
  charcoal: "#2C2C2C",
  charcoalDark: "#1A1A1A",
  cream: "#F5F3F0",
  creamLight: "#F9F7F5",
  border: "#E5E1DA",
  muted: "#7A7A7A",
  gold: "#B8956B",
  white: "#FFFFFF",
  danger: "#B0413E",
} as const;

/** Symmetric horizontal padding (px) for the canvas frame. */
export const ORA_FRAME_PADDING = 60;
