/**
 * Reusable custom typography field definitions for Puck components.
 * Each field uses Puck's { type: "custom", render: ... } pattern
 * with compact inline UI rendered via React.createElement (no JSX).
 *
 * Styling uses inline styles (not Tailwind) since these render
 * inside Puck's sidebar iframe.
 */

import type { CSSProperties } from "react";
import {
  createColorField,
  createCustomSelectField,
  createFreeInputField,
  createToggleField,
  normalizeLength,
} from "./shared-field-controls";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY FIELD DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════


// ─── fontFamily ──────────────────────────────────────────────────────────────

export const fontFamilyField = {
  ...createCustomSelectField("Font Family", [
    { label: "Inherit", value: "inherit" },
    { label: "Poppins", value: "var(--font-poppins), Poppins, sans-serif" },
    { label: "Geist Sans", value: "Geist Sans, sans-serif" },
    { label: "Georgia", value: "Georgia, serif" },
    { label: "Times New Roman", value: "Times New Roman, serif" },
    { label: "Arial", value: "Arial, sans-serif" },
    { label: "system-ui", value: "system-ui, sans-serif" },
  ], "Reusable custom dropdown for all typography fields."),
};

// ─── fontWeight ──────────────────────────────────────────────────────────────

export const fontWeightField = {
  ...createCustomSelectField("Font Weight", [
    { label: "Light (300)", value: "300" },
    { label: "Regular (400)", value: "400" },
    { label: "Medium (500)", value: "500" },
    { label: "Semibold (600)", value: "600" },
    { label: "Bold (700)", value: "700" },
  ]),
};

// ─── fontSize ────────────────────────────────────────────────────────────────

export const fontSizeField = {
  ...createFreeInputField("Font Size", "px", ["14", "16", "18", "20", "24", "32", "40", "48", "64"], "Type any size or pick a preset."),
};

// ─── textAlign ───────────────────────────────────────────────────────────────

export const textAlignField = {
  ...createToggleField("Text Align", [
    { label: "≡", value: "left" },
    { label: "≡", value: "center" },
    { label: "≡", value: "right" },
    { label: "≡", value: "justify" },
  ]),
};

// ─── fontStyle ───────────────────────────────────────────────────────────────

export const fontStyleField = {
  ...createToggleField("Font Style", [
    { label: "T", value: "normal" },
    { label: "I", value: "italic" },
  ]),
};

// ─── textDecoration ──────────────────────────────────────────────────────────

export const textDecorationField = {
  ...createToggleField("Decoration", [
    { label: "U\u0332", value: "underline" },
    { label: "S\u0336", value: "line-through" },
    { label: "✕", value: "none" },
  ]),
};

// ─── textTransform ───────────────────────────────────────────────────────────

export const textTransformField = {
  ...createToggleField("Transform", [
    { label: "AA", value: "uppercase" },
    { label: "Aa", value: "capitalize" },
    { label: "ag", value: "lowercase" },
    { label: "✕", value: "none" },
  ]),
};

// ─── lineHeight ──────────────────────────────────────────────────────────────

export const lineHeightField = {
  ...createFreeInputField("Line Height", "", ["auto", "1.1", "1.2", "1.4", "1.6", "48px"], "Supports unitless values like 1.2 or explicit units like 48px.", "auto | 1.2 | 48px"),
};

// ─── letterSpacing ───────────────────────────────────────────────────────────

export const letterSpacingField = {
  ...createFreeInputField("Letter Spacing", "", ["normal", "0.05em", "0.1em", "0.15em", "0.2em", "2px"], "Supports em, px, or normal.", "normal | 0.1em | 2px"),
};

// ─── color ───────────────────────────────────────────────────────────────────

export const colorField = {
  ...createColorField("Color", "#000000"),
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATED EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/** All typography fields as a flat object to spread into component fields. */
export const typographyFields = {
  fontFamily: fontFamilyField,
  fontWeight: fontWeightField,
  fontSize: fontSizeField,
  textAlign: textAlignField,
  fontStyle: fontStyleField,
  textDecoration: textDecorationField,
  textTransform: textTransformField,
  lineHeight: lineHeightField,
  letterSpacing: letterSpacingField,
  color: colorField,
};

/** Default values for all typography fields. */
export const typographyDefaultsHeading = {
  fontFamily: "inherit",
  fontWeight: "700",
  fontSize: "32",
  textAlign: "left",
  fontStyle: "normal",
  textDecoration: "none",
  textTransform: "none",
  lineHeight: "auto",
  letterSpacing: "normal",
  color: "#1A1A1A",
};

export const typographyDefaultsText = {
  fontFamily: "inherit",
  fontWeight: "400",
  fontSize: "16",
  textAlign: "left",
  fontStyle: "normal",
  textDecoration: "none",
  textTransform: "none",
  lineHeight: "auto",
  letterSpacing: "normal",
  color: "#4A4A4A",
};

/**
 * Converts typography prop values into a CSSProperties object
 * that can be spread onto an element's style prop.
 */
export function typographyPropsToCSS(props: Record<string, unknown>): CSSProperties {
  const css: CSSProperties = {};

  const fontFamily = props.fontFamily as string;
  if (fontFamily && fontFamily !== "inherit") css.fontFamily = fontFamily;

  const fontWeight = Number(props.fontWeight);
  if (fontWeight) css.fontWeight = fontWeight;

  const fontSize = props.fontSize as string;
  if (fontSize && fontSize !== "auto") css.fontSize = normalizeLength(fontSize, "px");

  const textAlign = props.textAlign as string;
  if (textAlign) css.textAlign = textAlign as CSSProperties["textAlign"];

  const fontStyle = props.fontStyle as string;
  if (fontStyle && fontStyle !== "normal") css.fontStyle = fontStyle;

  const textDecoration = props.textDecoration as string;
  if (textDecoration && textDecoration !== "none") css.textDecoration = textDecoration;

  const textTransform = props.textTransform as string;
  if (textTransform && textTransform !== "none") css.textTransform = textTransform as CSSProperties["textTransform"];

  const lineHeight = props.lineHeight as string;
  if (lineHeight && lineHeight !== "auto") {
    css.lineHeight = /^-?\d+(\.\d+)?$/.test(lineHeight)
      ? lineHeight
      : normalizeLength(lineHeight, "px");
  }

  const letterSpacing = props.letterSpacing as string;
  if (letterSpacing && letterSpacing !== "normal") css.letterSpacing = normalizeLength(letterSpacing, "px");

  const color = props.color as string;
  if (color) css.color = color;

  return css;
}
