/**
 * Reusable custom typography field definitions for Puck components.
 * Each field uses Puck's { type: "custom", render: ... } pattern
 * with compact inline UI rendered via React.createElement (no JSX).
 *
 * Styling uses inline styles (not Tailwind) since these render
 * inside Puck's sidebar iframe.
 */

import React from "react";
import type { CSSProperties } from "react";

// ─── ORA Design System Tokens ────────────────────────────────────────────────

const COLORS = {
  bg: "#F9F7F5",
  border: "#E8E4DF",
  text: "#2C2C2C",
  active: "#2C2C2C",
  activeText: "#FFFFFF",
  muted: "#9A9A9A",
  inactive: "#F5F3F0",
  inactiveText: "#6B6B6B",
};

const COLOR_PRESETS = [
  "#1A1A1A",
  "#2C2C2C",
  "#4A4A4A",
  "#6B6B6B",
  "#9A9A9A",
  "#FFFFFF",
  "#B8956B",
];

// ─── Shared Styles ───────────────────────────────────────────────────────────

const baseInputStyle: CSSProperties = {
  height: 30,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 0,
  fontSize: 12,
  color: COLORS.text,
  background: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};

const selectWrapperStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  width: "100%",
};

const selectStyle: CSSProperties = {
  ...baseInputStyle,
  width: "100%",
  padding: "0 24px 0 8px",
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
};

const selectArrowStyle: CSSProperties = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  pointerEvents: "none",
  fontSize: 10,
  color: COLORS.muted,
};

const toggleGroupStyle: CSSProperties = {
  display: "flex",
  gap: 0,
  height: 28,
};

function toggleBtnStyle(isActive: boolean): CSSProperties {
  return {
    height: 28,
    minWidth: 28,
    padding: "0 8px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 0,
    fontSize: 12,
    fontWeight: isActive ? 600 : 400,
    cursor: "pointer",
    background: isActive ? COLORS.active : COLORS.inactive,
    color: isActive ? COLORS.activeText : COLORS.inactiveText,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -1,
    transition: "background 0.15s, color 0.15s",
    boxSizing: "border-box",
    lineHeight: 1,
  };
}

// ─── Render Prop Types ───────────────────────────────────────────────────────

interface FieldRenderProps {
  value: unknown;
  onChange: (value: string) => void;
  readOnly?: boolean;
  field?: unknown;
  name?: string;
  id?: string;
}

// ─── Helper: Compact Select ──────────────────────────────────────────────────

function renderCompactSelect(
  props: FieldRenderProps,
  options: { label: string; value: string }[]
) {
  const { value, onChange, readOnly } = props;
  const current = (value as string) || options[0]?.value || "";
  return React.createElement("div", { style: selectWrapperStyle },
    React.createElement("select", {
      value: current,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value),
      disabled: readOnly,
      style: selectStyle,
    },
      ...options.map((opt) =>
        React.createElement("option", { key: opt.value, value: opt.value }, opt.label)
      )
    ),
    React.createElement("span", { style: selectArrowStyle }, "▾")
  );
}

// ─── Helper: Toggle Button Group ─────────────────────────────────────────────

function renderToggleGroup(
  props: FieldRenderProps,
  options: { label: string; value: string }[]
) {
  const { value, onChange, readOnly } = props;
  const current = (value as string) || options[0]?.value || "";
  return React.createElement("div", { style: toggleGroupStyle },
    ...options.map((opt) =>
      React.createElement("button", {
        key: opt.value,
        type: "button",
        disabled: readOnly,
        onClick: () => onChange(opt.value),
        style: toggleBtnStyle(current === opt.value),
        title: opt.value,
      }, opt.label)
    )
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY FIELD DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════


// ─── fontFamily ──────────────────────────────────────────────────────────────

export const fontFamilyField = {
  type: "custom" as const,
  label: "Font Family",
  render: (props: FieldRenderProps) =>
    renderCompactSelect(props, [
      { label: "Inherit", value: "inherit" },
      { label: "Poppins", value: "var(--font-poppins), Poppins, sans-serif" },
      { label: "Geist Sans", value: "Geist Sans, sans-serif" },
      { label: "Georgia", value: "Georgia, serif" },
      { label: "Times New Roman", value: "Times New Roman, serif" },
      { label: "Arial", value: "Arial, sans-serif" },
      { label: "system-ui", value: "system-ui, sans-serif" },
    ]),
};

// ─── fontWeight ──────────────────────────────────────────────────────────────

export const fontWeightField = {
  type: "custom" as const,
  label: "Font Weight",
  render: (props: FieldRenderProps) =>
    renderCompactSelect(props, [
      { label: "Light (300)", value: "300" },
      { label: "Regular (400)", value: "400" },
      { label: "Medium (500)", value: "500" },
      { label: "Semibold (600)", value: "600" },
      { label: "Bold (700)", value: "700" },
    ]),
};

// ─── fontSize ────────────────────────────────────────────────────────────────

export const fontSizeField = {
  type: "custom" as const,
  label: "Font Size",
  render: (props: FieldRenderProps) => {
    const { value, onChange, readOnly } = props;
    const current = (value as string) || "16";
    const presets = ["14", "16", "18", "20", "24", "32", "40", "48", "64"];
    return React.createElement("div", { style: { display: "flex", gap: 0, width: "100%" } },
      React.createElement("input", {
        type: "number",
        value: current,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
        disabled: readOnly,
        min: 1,
        style: {
          ...baseInputStyle,
          width: "60px",
          padding: "0 4px 0 8px",
          borderRight: "none",
          flexShrink: 0,
        },
      }),
      React.createElement("span", {
        style: {
          ...baseInputStyle,
          width: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.bg,
          color: COLORS.muted,
          borderLeft: "none",
          borderRight: "none",
          flexShrink: 0,
          userSelect: "none",
        },
      }, "px"),
      React.createElement("div", { style: { ...selectWrapperStyle, flex: 1 } },
        React.createElement("select", {
          value: presets.includes(current) ? current : "",
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            if (e.target.value) onChange(e.target.value);
          },
          disabled: readOnly,
          style: { ...selectStyle, borderLeft: "none" },
        },
          React.createElement("option", { value: "", disabled: true }, "Presets"),
          ...presets.map((p) =>
            React.createElement("option", { key: p, value: p }, `${p}px`)
          )
        ),
        React.createElement("span", { style: selectArrowStyle }, "▾"),
      ),
    );
  },
};

// ─── textAlign ───────────────────────────────────────────────────────────────

export const textAlignField = {
  type: "custom" as const,
  label: "Text Align",
  render: (props: FieldRenderProps) =>
    renderToggleGroup(props, [
      { label: "≡", value: "left" },
      { label: "≡", value: "center" },
      { label: "≡", value: "right" },
      { label: "≡", value: "justify" },
    ]),
};

// ─── fontStyle ───────────────────────────────────────────────────────────────

export const fontStyleField = {
  type: "custom" as const,
  label: "Font Style",
  render: (props: FieldRenderProps) =>
    renderToggleGroup(props, [
      { label: "T", value: "normal" },
      { label: "I", value: "italic" },
    ]),
};

// ─── textDecoration ──────────────────────────────────────────────────────────

export const textDecorationField = {
  type: "custom" as const,
  label: "Decoration",
  render: (props: FieldRenderProps) =>
    renderToggleGroup(props, [
      { label: "U\u0332", value: "underline" },
      { label: "S\u0336", value: "line-through" },
      { label: "✕", value: "none" },
    ]),
};

// ─── textTransform ───────────────────────────────────────────────────────────

export const textTransformField = {
  type: "custom" as const,
  label: "Transform",
  render: (props: FieldRenderProps) =>
    renderToggleGroup(props, [
      { label: "AA", value: "uppercase" },
      { label: "Aa", value: "capitalize" },
      { label: "ag", value: "lowercase" },
      { label: "✕", value: "none" },
    ]),
};

// ─── lineHeight ──────────────────────────────────────────────────────────────

export const lineHeightField = {
  type: "custom" as const,
  label: "Line Height",
  render: (props: FieldRenderProps) => {
    const { value, onChange, readOnly } = props;
    const current = (value as string) || "auto";
    const isAuto = current === "auto";
    return React.createElement("div", { style: { display: "flex", gap: 0, width: "100%" } },
      React.createElement("input", {
        type: isAuto ? "text" : "number",
        value: current,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
        disabled: readOnly,
        min: 1,
        style: {
          ...baseInputStyle,
          flex: 1,
          padding: "0 8px",
          borderRight: "none",
        },
      }),
      React.createElement("span", {
        style: {
          ...baseInputStyle,
          width: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.bg,
          color: COLORS.muted,
          borderLeft: "none",
          borderRight: "none",
          flexShrink: 0,
          userSelect: "none",
        },
      }, isAuto ? "—" : "px"),
      React.createElement("button", {
        type: "button",
        disabled: readOnly,
        onClick: () => onChange(isAuto ? "24" : "auto"),
        style: {
          ...toggleBtnStyle(isAuto),
          borderLeft: "none",
          minWidth: 40,
          fontSize: 11,
        },
        title: "Toggle auto",
      }, "auto"),
    );
  },
};

// ─── letterSpacing ───────────────────────────────────────────────────────────

export const letterSpacingField = {
  type: "custom" as const,
  label: "Letter Spacing",
  render: (props: FieldRenderProps) => {
    const { value, onChange, readOnly } = props;
    const current = (value as string) || "normal";
    const isNormal = current === "normal";
    return React.createElement("div", { style: { display: "flex", gap: 0, width: "100%" } },
      React.createElement("input", {
        type: isNormal ? "text" : "number",
        value: current,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
        disabled: readOnly,
        step: 0.5,
        style: {
          ...baseInputStyle,
          flex: 1,
          padding: "0 8px",
          borderRight: "none",
        },
      }),
      React.createElement("span", {
        style: {
          ...baseInputStyle,
          width: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.bg,
          color: COLORS.muted,
          borderLeft: "none",
          borderRight: "none",
          flexShrink: 0,
          userSelect: "none",
        },
      }, isNormal ? "—" : "px"),
      React.createElement("button", {
        type: "button",
        disabled: readOnly,
        onClick: () => onChange(isNormal ? "1" : "normal"),
        style: {
          ...toggleBtnStyle(isNormal),
          borderLeft: "none",
          minWidth: 48,
          fontSize: 11,
        },
        title: "Toggle normal",
      }, "normal"),
    );
  },
};

// ─── color ───────────────────────────────────────────────────────────────────

export const colorField = {
  type: "custom" as const,
  label: "Color",
  render: (props: FieldRenderProps) => {
    const { value, onChange, readOnly } = props;
    const current = (value as string) || "#1A1A1A";
    return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
      // Swatch row + hex input
      React.createElement("div", { style: { display: "flex", gap: 0, width: "100%" } },
        React.createElement("div", {
          style: {
            width: 30,
            height: 30,
            background: current,
            border: `1px solid ${COLORS.border}`,
            borderRight: "none",
            borderRadius: 0,
            flexShrink: 0,
            cursor: readOnly ? "default" : "pointer",
            boxSizing: "border-box",
          },
          title: current,
        }),
        React.createElement("input", {
          type: "text",
          value: current,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          disabled: readOnly,
          placeholder: "#000000",
          maxLength: 7,
          style: {
            ...baseInputStyle,
            flex: 1,
            padding: "0 8px",
            fontFamily: "monospace",
          },
        }),
      ),
      // Preset swatches
      React.createElement("div", { style: { display: "flex", gap: 3 } },
        ...COLOR_PRESETS.map((hex) =>
          React.createElement("button", {
            key: hex,
            type: "button",
            disabled: readOnly,
            onClick: () => onChange(hex),
            title: hex,
            style: {
              width: 20,
              height: 20,
              background: hex,
              border: current === hex
                ? `2px solid ${COLORS.active}`
                : `1px solid ${COLORS.border}`,
              borderRadius: 0,
              cursor: readOnly ? "default" : "pointer",
              padding: 0,
              boxSizing: "border-box",
            },
          })
        )
      ),
    );
  },
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
  if (fontSize && fontSize !== "auto") css.fontSize = `${fontSize}px`;

  const textAlign = props.textAlign as string;
  if (textAlign) css.textAlign = textAlign as CSSProperties["textAlign"];

  const fontStyle = props.fontStyle as string;
  if (fontStyle && fontStyle !== "normal") css.fontStyle = fontStyle;

  const textDecoration = props.textDecoration as string;
  if (textDecoration && textDecoration !== "none") css.textDecoration = textDecoration;

  const textTransform = props.textTransform as string;
  if (textTransform && textTransform !== "none") css.textTransform = textTransform as CSSProperties["textTransform"];

  const lineHeight = props.lineHeight as string;
  if (lineHeight && lineHeight !== "auto") css.lineHeight = `${lineHeight}px`;

  const letterSpacing = props.letterSpacing as string;
  if (letterSpacing && letterSpacing !== "normal") css.letterSpacing = `${letterSpacing}px`;

  const color = props.color as string;
  if (color) css.color = color;

  return css;
}
