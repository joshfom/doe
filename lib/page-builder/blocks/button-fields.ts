/**
 * Shared button field group for the page-builder block library.
 *
 * The CTA, Pricing, and Card blocks all need a button/anchor that looks and
 * behaves exactly like the existing standalone `Button` block. Rather than
 * duplicate the heavy `Button` field set inside each of those block configs,
 * this module extracts the reusable Button-style field group as
 * `buttonFields(prefix?)`.
 *
 * Reuse, not reinvention:
 *   - The select / free-input controls are the shared leaf helpers from
 *     `shared-field-controls.ts` (`createCustomSelectField`,
 *     `createFreeInputField`) — the same helpers the existing `Button` block's
 *     equivalents render to, so the visual language is byte-for-byte identical.
 *   - `makeColorField`, `makeSliderField`, and `makePaddingField` faithfully
 *     reproduce the field shapes the `Button` block uses (these have no exact
 *     shared-helper equivalent). They reuse the shared `renderFieldTitle` and
 *     `CONTROL_COLORS` so they stay visually consistent.
 *
 * This file intentionally does NOT import from `config.ts`: `config.ts` will
 * import `buttonFields` (and, later, `renderButtonAnchor`) from here, so a
 * back-import would create a circular dependency. Everything the field group
 * needs lives here or in `shared-field-controls.ts`.
 *
 * The optional `prefix` namespaces every field key so a block can host more
 * than one button (for example a CTA's primary + secondary buttons) without
 * key collisions. `buttonFieldKey` is the single source of truth for that
 * naming convention and is exported so the matching render helper
 * (`renderButtonAnchor`, task 2.2) can read the same prefixed props back out.
 *
 * The existing `Button` block in `config.ts` is left untouched — this is a
 * reusable extraction, not a refactor of that block.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/button-fields.ts`
 * Validates: Requirements 1.7, 1.8, 1.10, 5.5, 6.9, 7.7, 13.6
 */

import React from "react";
import type { Field } from "@puckeditor/core";
import {
  CONTROL_COLORS,
  renderFieldTitle,
  createCustomSelectField,
  createFreeInputField,
} from "../shared-field-controls";

// ─── Icon options ────────────────────────────────────────────────────────────
// Mirrors the `BUTTON_ICON_OPTIONS` list used by the existing Button block.
// Every value is a key registered in `ICON_MAP` (resolved at render time by the
// consuming block / `renderButtonAnchor`, not by this field group).

const BUTTON_ICON_OPTIONS = [
  { label: "None", value: "" },
  { label: "Arrow Right →", value: "arrow-right" },
  { label: "Arrow Left ←", value: "arrow-left" },
  { label: "Chevron Right", value: "chevron-right" },
  { label: "Chevron Left", value: "chevron-left" },
  { label: "Plus +", value: "plus" },
  { label: "Check ✓", value: "check" },
  { label: "Send", value: "send" },
  { label: "Search", value: "search" },
  { label: "Download", value: "download" },
  { label: "External Link", value: "external-link" },
  { label: "Phone", value: "phone" },
  { label: "Mail", value: "mail" },
  { label: "Calendar", value: "calendar" },
  { label: "Shopping Cart", value: "shopping-cart" },
  { label: "Eye", value: "eye" },
  { label: "Star", value: "star" },
  { label: "Heart", value: "heart" },
];

// ─── Button-style field factories ─────────────────────────────────────────────
// Faithful reproductions of the field shapes used by the existing Button block.
// They reuse the shared `renderFieldTitle` + `CONTROL_COLORS` so the rendered
// controls match the rest of the configuration panel exactly.

/** Color picker: a clickable swatch (hidden native color input) + hex text input. */
function makeColorField(title: string, placeholder = "#000000", description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) => {
      const val = (value as string) || "";
      const swatchColor = val || placeholder || "#000000";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
          // Visible swatch — clicking it opens the hidden native color input.
          React.createElement("div", {
            style: {
              position: "relative",
              width: 32,
              height: 32,
              borderRadius: 2,
              border: `1px solid ${CONTROL_COLORS.border}`,
              backgroundColor: swatchColor,
              cursor: "pointer",
              flexShrink: 0,
              overflow: "hidden",
            },
          },
            React.createElement("input", {
              type: "color",
              value: val || "#000000",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                opacity: 0,
                cursor: "pointer",
                border: "none",
                padding: 0,
              },
            }),
          ),
          React.createElement("input", {
            type: "text",
            value: val,
            placeholder,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            style: { flex: 1, height: 36, border: `1px solid ${CONTROL_COLORS.border}`, padding: "0 8px", fontSize: 12 },
          }),
        ),
      );
    },
  };
}

/** Range slider with min/max captions and a live numeric readout. */
function makeSliderField(title: string, min: number, max: number, unit = "px", description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) => {
      const num = Number(value) || 0;
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9A9A9A" } },
          React.createElement("span", null, `${min}${unit}`),
          React.createElement("span", null, `${max}${unit}`),
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement("input", {
            type: "range",
            min, max,
            value: num,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            style: { flex: 1 },
          }),
          React.createElement("span", { style: { fontSize: 12, minWidth: 36, textAlign: "right" } }, `${num}${unit}`),
        ),
      );
    },
  };
}

/** Per-side padding editor (Top / Right / Bottom / Left) with +/- steppers. */
function makePaddingField() {
  return {
    type: "custom" as const,
    label: "Padding",
    render: ({ value, onChange }: {
      value: unknown;
      onChange: (v: { top: number; right: number; bottom: number; left: number }) => void;
    }) => {
      const v = (value as { top?: number; right?: number; bottom?: number; left?: number }) ?? {};
      const pad = { top: v.top ?? 0, right: v.right ?? 0, bottom: v.bottom ?? 0, left: v.left ?? 0 };
      const stepBtn = (dir: 1 | -1, side: keyof typeof pad) =>
        React.createElement("button", {
          type: "button",
          onClick: () => onChange({ ...pad, [side]: Math.max(0, pad[side] + dir * 4) }),
          style: { width: 22, height: 22, border: "1px solid #E8E4DF", background: "#F9F7F5", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" },
        }, dir > 0 ? "+" : "−");
      const cell = (side: keyof typeof pad, label: string) =>
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } },
          React.createElement("span", { style: { fontSize: 10, color: "#9A9A9A" } }, label),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 1 } },
            stepBtn(-1, side),
            React.createElement("span", { style: { minWidth: 28, textAlign: "center", fontSize: 12 } }, pad[side]),
            stepBtn(1, side),
          ),
        );
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle("Padding", "Adjust each side with +/- controls."),
        React.createElement("div", {
          style: { background: "#F9F7F5", border: `1px solid ${CONTROL_COLORS.border}`, padding: "8px", display: "flex", flexDirection: "column", gap: 6 },
        },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
            cell("top", "Top"),
            cell("left", "Left"),
            cell("right", "Right"),
            cell("bottom", "Bottom"),
          ),
        ),
      );
    },
  };
}

// ─── Key namespacing ──────────────────────────────────────────────────────────

/**
 * Base field names that make up a single button group, in declaration order.
 * Used by both `buttonFields` and `buttonFieldDefaults` so the field keys and
 * their defaults can never drift apart.
 */
const BUTTON_FIELD_BASE_KEYS = [
  "text",
  "url",
  "_icon",
  "textColor",
  "textColorHover",
  "bgColor",
  "bgColorHover",
  "borderColor",
  "borderColorHover",
  "borderSize",
  "borderRadius",
  "btnPadding",
  "fullWidth",
  "alignment",
] as const;

/** A base field name that belongs to a button group. */
export type ButtonFieldBaseKey = (typeof BUTTON_FIELD_BASE_KEYS)[number];

/**
 * Namespace a base button field name with an optional prefix.
 *
 * Without a prefix the base name is returned unchanged, so a single-button
 * block keeps the same keys the standalone `Button` block uses. With a prefix
 * the name is camel-cased (`text` → `primaryText`); a leading underscore on
 * "private"/structured keys is preserved (`_icon` → `_primaryIcon`) so those
 * keys keep their conventional shape and never collide with a host block's own
 * `_margin` / `_padding` / `_border` fields.
 *
 * This is the single source of truth for the naming convention so the matching
 * render helper (`renderButtonAnchor`) can reconstruct the same keys.
 */
export function buttonFieldKey(base: ButtonFieldBaseKey, prefix?: string): string {
  if (!prefix) return base;
  const lead = base.startsWith("_") ? "_" : "";
  const core = base.replace(/^_+/, "");
  return `${lead}${prefix}${core.charAt(0).toUpperCase()}${core.slice(1)}`;
}

// ─── Public field group ───────────────────────────────────────────────────────

/**
 * Build the Button-style field group used by composed blocks (CTA, Pricing,
 * Card). Returns a map of Puck fields keyed by `buttonFieldKey(base, prefix)`.
 *
 * Fields (matching the existing Button block's shapes):
 *   - `text`            — label text (content-editable, like Button)
 *   - `url`             — link destination
 *   - `_icon`           — object: icon `name` (ICON_MAP key), `position`,
 *                         `size`, `gap`
 *   - `textColor` / `textColorHover`     — label + icon color
 *   - `bgColor` / `bgColorHover`         — button fill
 *   - `borderColor` / `borderColorHover` — outline color
 *   - `borderSize`      — outline thickness (slider)
 *   - `borderRadius`    — corner roundness (slider)
 *   - `btnPadding`      — per-side padding
 *   - `fullWidth`       — stretch to container width
 *   - `alignment`       — left / center / right
 *
 * @param prefix Optional namespace so multiple button groups can coexist in a
 *   single block (e.g. `buttonFields("primary")`, `buttonFields("secondary")`).
 */
export function buttonFields(prefix?: string): Record<string, Field> {
  const k = (base: ButtonFieldBaseKey) => buttonFieldKey(base, prefix);

  return {
    // ── Content ──────────────────────────────────────────────────────────
    [k("text")]: { type: "text", label: "Label Text", contentEditable: true },
    [k("url")]: { type: "text", label: "URL" },

    // ── Icon ─────────────────────────────────────────────────────────────
    [k("_icon")]: {
      type: "object",
      label: "Icon",
      objectFields: {
        name: createCustomSelectField(
          "Icon",
          BUTTON_ICON_OPTIONS,
          "Choose a Lucide icon or keep it empty for a text-only button.",
          "No icon",
        ),
        position: {
          type: "radio",
          label: "Position",
          options: [
            { label: "Left", value: "left" },
            { label: "Right", value: "right" },
          ],
        },
        size: createFreeInputField("Icon Size", "px", ["12", "14", "16", "20", "24"], "Free input supported. Type any pixel size."),
        gap: createFreeInputField("Gap To Label", "px", ["4px", "6px", "8px", "12px", "16px"], "Space between icon and label."),
      },
    },

    // ── Colors ───────────────────────────────────────────────────────────
    [k("textColor")]: makeColorField("Text Color", "#FFFFFF", "Color used by both label and icon."),
    [k("textColorHover")]: makeColorField("Hover Text/Icon", "#FFFFFF", "Hover color for both label and icon."),
    [k("bgColor")]: makeColorField("Background Color", "#2C2C2C", "Default button fill."),
    [k("bgColorHover")]: makeColorField("Hover Background", "#4A4A4A", "Shown when the pointer is over the button."),
    [k("borderColor")]: makeColorField("Border Color", "#2C2C2C", "Outline color when border size is above 0."),
    [k("borderColorHover")]: makeColorField("Hover Border", "#2C2C2C", "Border color while hovering."),

    // ── Border ───────────────────────────────────────────────────────────
    [k("borderSize")]: makeSliderField("Border Size", 0, 10, "px", "Border thickness."),
    [k("borderRadius")]: makeSliderField("Border Radius", 0, 100, "px", "Corner roundness."),

    // ── Padding ──────────────────────────────────────────────────────────
    [k("btnPadding")]: makePaddingField(),

    // ── Layout ───────────────────────────────────────────────────────────
    [k("fullWidth")]: {
      type: "radio",
      label: "Full Width",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
    [k("alignment")]: {
      type: "radio",
      label: "Alignment",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
  };
}

/**
 * Default values for a button group built with {@link buttonFields}, keyed with
 * the same `buttonFieldKey(base, prefix)` convention so a consuming block can
 * spread them into its `defaultProps` without restating each key. Mirrors the
 * existing Button block's `defaultProps`.
 *
 * @param prefix The same prefix passed to `buttonFields`.
 */
export function buttonFieldDefaults(prefix?: string): Record<string, unknown> {
  const k = (base: ButtonFieldBaseKey) => buttonFieldKey(base, prefix);

  return {
    [k("text")]: "Click Me",
    [k("url")]: "",
    [k("_icon")]: { name: "", position: "right", size: "16", gap: "8px" },
    [k("textColor")]: "#FFFFFF",
    [k("textColorHover")]: "#FFFFFF",
    [k("bgColor")]: "#2C2C2C",
    [k("bgColorHover")]: "#4A4A4A",
    [k("borderColor")]: "#2C2C2C",
    [k("borderColorHover")]: "#2C2C2C",
    [k("borderSize")]: "0",
    [k("borderRadius")]: "0",
    [k("btnPadding")]: { top: 12, right: 24, bottom: 12, left: 24 },
    [k("fullWidth")]: "no",
    [k("alignment")]: "left",
  };
}

// ─── Anchor render helper ─────────────────────────────────────────────────────

/**
 * Hover CSS for the rendered button anchor. Byte-for-byte the same rule set the
 * existing `Button` block ships (`.ora-builder-button` + CSS custom properties),
 * so a button produced by {@link renderButtonAnchor} hovers identically to a
 * standalone Button. The colors themselves are supplied per-instance through the
 * `--btn-*` custom properties set inline on the anchor, so this static rule can
 * be emitted repeatedly without breaking the byte-stable public render.
 */
export const BUTTON_ANCHOR_HOVER_CSS = `
.ora-builder-button {
  background-color: var(--btn-bg);
  color: var(--btn-text);
  border-color: var(--btn-border);
}

.ora-builder-button:hover {
  background-color: var(--btn-bg-hover, var(--btn-bg));
  color: var(--btn-text-hover, var(--btn-text));
  border-color: var(--btn-border-hover, var(--btn-border));
}

.ora-builder-button svg {
  stroke: currentColor;
}
`;

/** Minimal contract for an icon component, matching the `ICON_MAP` value type. */
type ButtonIconComponent = React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

/**
 * Decide whether a destination is "external" for `rel` purposes.
 *
 * A link is treated as external when it is an absolute `http(s)://` URL. Mirrors
 * the convention already used elsewhere in this codebase (e.g. the chat-widget
 * link renderer): relative paths (`/about`), in-page anchors (`#section`), and
 * `mailto:` / `tel:` schemes are internal and never receive the external `rel`.
 *
 * The test is deterministic and origin-independent so it never varies between
 * server and client, preserving the byte-stable public render.
 */
export function isExternalButtonUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Options for {@link renderButtonAnchor}. */
export interface RenderButtonAnchorOptions {
  /**
   * The same prefix passed to {@link buttonFields}/{@link buttonFieldDefaults}
   * so the helper reads back the namespaced props (e.g. `primaryText`,
   * `_secondaryIcon`). Omit for a single, unprefixed button group.
   */
  prefix?: string;
  /**
   * Icon registry (the `ICON_MAP` from `config.ts`) used to resolve the
   * configured `_icon.name`. Passed in by the consuming block rather than
   * imported here: `button-fields.ts` deliberately never imports from
   * `config.ts` (which imports from this file), so taking the map through
   * `opts` keeps the dependency one-directional and avoids a circular import.
   * When omitted, the button simply renders without an icon.
   */
  iconMap?: Record<string, ButtonIconComponent>;
  /**
   * Override for the visible label / accessible name. Falls back to the
   * `text` prop. Accepts a node so callers can pass through Puck's
   * content-editable wrappers.
   */
  label?: React.ReactNode;
  /** Override for the destination URL. Falls back to the `url` prop. */
  url?: string;
  /** Extra class name appended after the base `ora-builder-button` class. */
  className?: string;
  /** React key, useful when the anchor is rendered inside a mapped list. */
  key?: React.Key;
}

/**
 * Render a navigational button as a semantic anchor, styled identically to the
 * existing `Button` block.
 *
 * Used by the composed blocks (CTA, Pricing, Card) so every button-shaped link
 * shares one anchor implementation: resolved colors / border / radius / padding
 * / icon, a `--btn-*`-driven hover, an external-URL `rel`, and an accessible
 * name equal to the label.
 *
 * Style resolution mirrors the `Button` block's render for the case where no
 * `_typography` object is present (the field group extracted by
 * {@link buttonFields} intentionally omits typography — font is inherited from
 * the canvas/renderer root): weight `600`, size `14px`, no extra letter-spacing
 * or transform. All other resolved styles (display, alignment of icon+label,
 * full-width, colors, border, radius, padding, transition) match the Button
 * block exactly.
 *
 * Omission: when the resolved URL is empty (or just `#`, matching the Button
 * block's own guard) the helper returns `null`. This lets the consuming block
 * decide what to do — render nothing (CTA's optional secondary button, a Pricing
 * plan without a CTA) or substitute its own fallback.
 *
 * Output shape: a fragment pairing the shared hover `<style>` with the
 * `React.createElement("a", …)` so the anchor's hover works standalone, exactly
 * as the Button block bundles its `<style>` with its anchor. Wrapper-level
 * concerns (the `alignment` field) are left to the caller's layout, mirroring
 * the Button block where alignment lives on the wrapper the block owns.
 *
 * @param props The block props holding the (optionally prefixed) button fields.
 * @param opts  Prefix, icon map, and label/url/class overrides.
 * @returns A React element (style + anchor), or `null` when there is no link.
 */
export function renderButtonAnchor(
  props: Record<string, unknown>,
  opts: RenderButtonAnchorOptions = {},
): React.ReactElement | null {
  const k = (base: ButtonFieldBaseKey) => buttonFieldKey(base, opts.prefix);

  // ── Resolve destination (opts override → prop) and apply omission rule ──
  const rawUrl = opts.url ?? (props[k("url")] as string) ?? "";
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!url || url === "#") return null;

  // ── Resolve label / accessible name (opts override → prop) ──────────────
  const label = opts.label ?? (props[k("text")] as React.ReactNode);

  // ── Icon ────────────────────────────────────────────────────────────────
  const icon = (props[k("_icon")] as Record<string, string>) ?? {};
  const iconName = icon.name || "";
  const iconSize = Number(icon.size) || 16;
  const iconPos = icon.position || "right";
  const iconGap = icon.gap || "8px";
  const IconComp = iconName && opts.iconMap ? opts.iconMap[iconName] : null;
  const iconEl = IconComp
    ? React.createElement(IconComp, { size: iconSize, strokeWidth: 1.5 })
    : null;

  // ── Colors (with the Button block's shipped fallbacks) ──────────────────
  const textColor = (props[k("textColor")] as string) || "#FFFFFF";
  const textColorHover = (props[k("textColorHover")] as string) || textColor;
  const bgColor = (props[k("bgColor")] as string) || "#2C2C2C";
  const bgColorHover = (props[k("bgColorHover")] as string) || bgColor;
  const borderColor = (props[k("borderColor")] as string) || "#2C2C2C";
  const borderColorHover = (props[k("borderColorHover")] as string) || borderColor;

  // ── Geometry ────────────────────────────────────────────────────────────
  const pad = (props[k("btnPadding")] as Record<string, number>) ?? { top: 12, right: 24, bottom: 12, left: 24 };
  const borderSize = props[k("borderSize")];
  const borderRadius = props[k("borderRadius")] ?? 0;
  const fw = (props[k("fullWidth")] as string) === "yes";

  const btnStyle: React.CSSProperties & Record<string, string | undefined> = {
    display: "inline-flex",
    alignItems: "center",
    gap: iconEl ? iconGap : undefined,
    width: fw ? "100%" : undefined,
    justifyContent: fw ? "center" : undefined,
    paddingTop: `${pad.top ?? 12}px`,
    paddingBottom: `${pad.bottom ?? 12}px`,
    paddingLeft: `${pad.left ?? 24}px`,
    paddingRight: `${pad.right ?? 24}px`,
    // buttonFields omits `_typography`; match the Button render's empty-typo path.
    fontFamily: "inherit",
    fontWeight: "600",
    fontSize: "14px",
    letterSpacing: "normal",
    textTransform: "none",
    color: textColor,
    backgroundColor: bgColor,
    border: Number(borderSize) > 0 ? `${borderSize}px solid ${borderColor}` : "none",
    borderRadius: `${borderRadius}px`,
    cursor: "pointer",
    textDecoration: "none",
    transition: "background-color 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s",
    boxSizing: "border-box",
    "--btn-bg": bgColor,
    "--btn-bg-hover": bgColorHover,
    "--btn-text": textColor,
    "--btn-text-hover": textColorHover,
    "--btn-border": borderColor,
    "--btn-border-hover": borderColorHover,
  };

  const anchor = React.createElement("a", {
    href: url,
    style: btnStyle,
    className: opts.className ? `ora-builder-button ${opts.className}` : "ora-builder-button",
    // External absolute URLs get the security rel; internal/relative omit it.
    ...(isExternalButtonUrl(url) ? { rel: "noopener noreferrer" } : {}),
  },
    iconPos === "left" ? iconEl : null,
    // The label text is the anchor's accessible name (no extra aria-label, like Button).
    React.createElement("span", null, label),
    iconPos === "right" ? iconEl : null,
  );

  return React.createElement(
    React.Fragment,
    opts.key != null ? { key: opts.key } : null,
    React.createElement("style", null, BUTTON_ANCHOR_HOVER_CSS),
    anchor,
  );
}
