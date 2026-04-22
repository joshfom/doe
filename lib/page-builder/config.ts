"use client";

import type { Config } from "@puckeditor/core";
import { DropZone } from "@puckeditor/core";
import React from "react";
import { styleFields, styleDefaults, stylePropsToCSS } from "./style-fields";
import {
  typographyFields,
  typographyDefaultsHeading,
  typographyDefaultsText,
  typographyPropsToCSS,
  colorField,
} from "./typography-fields";
import { imageFields, imageDefaults, imagePropsToCSS } from "./image-fields";
import { animationFields, animationDefaults } from "./animation-fields";
import {
  Home, Phone, Mail, MapPin, Star, Heart, Check, ArrowRight,
  Building, Palmtree, Waves, Sun, Shield, Car, Bed, Bath,
  Eye, Download, ExternalLink, Quote as QuoteIcon,
} from "lucide-react";
import { componentTemplates } from "./templates/component-templates";

// ─── Lucide Icon Map ─────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  home: Home, phone: Phone, mail: Mail, "map-pin": MapPin,
  star: Star, heart: Heart, check: Check, "arrow-right": ArrowRight,
  building: Building, palmtree: Palmtree, waves: Waves, sun: Sun,
  shield: Shield, car: Car, bed: Bed, bath: Bath,
  eye: Eye, download: Download, "external-link": ExternalLink, quote: QuoteIcon,
};

// ─── Shared Style Helpers ────────────────────────────────────────────────────

const spacingBorderFields = {
  _padding: { type: "object" as const, label: "Padding", objectFields: { paddingTop: styleFields.paddingTop, paddingBottom: styleFields.paddingBottom, paddingLeft: styleFields.paddingLeft, paddingRight: styleFields.paddingRight } },
  _margin: { type: "object" as const, label: "Margin", objectFields: { marginTop: styleFields.marginTop, marginBottom: styleFields.marginBottom } },
  _border: { type: "object" as const, label: "Border", objectFields: { borderWidth: styleFields.borderWidth, borderColor: styleFields.borderColor, borderRadius: styleFields.borderRadius } },
};
const spacingBorderDefaults = {
  _padding: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
  _margin: { marginTop: "0", marginBottom: "0" },
  _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
};

function flattenStyleProps(props: Record<string, unknown>): Record<string, unknown> {
  const pad = (props._padding as Record<string, unknown>) ?? {};
  const mar = (props._margin as Record<string, unknown>) ?? {};
  const bor = (props._border as Record<string, unknown>) ?? {};
  return { ...pad, ...mar, ...bor };
}

function styledRender(props: Record<string, unknown>, content: React.ReactNode) {
  const css = stylePropsToCSS(flattenStyleProps(props));
  return Object.keys(css).length > 0
    ? React.createElement("div", { style: css }, content)
    : content;
}

// ─── Image upload field helper ───────────────────────────────────────────────

const imageUploadField = {
  type: "custom" as const,
  label: "Image",
  render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: string) => void; readOnly?: boolean }) => {
    const currentSrc = (value as string) || "";

    const uploadFile = async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch("/api/media", { method: "POST", body: form, credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        onChange(data.data?.storageUrl ?? data.data?.storage_url ?? "");
      } catch { /* */ }
    };

    const browseLibrary = async () => {
      if (readOnly) return;
      try {
        const res = await fetch("/api/media", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        const items = json.data as Array<{ storageUrl?: string; storage_url?: string; filename: string }>;
        if (!items?.length) { triggerUpload(); return; }
        // Simple: show a prompt-style picker using the first available image
        // For a proper modal, the MediaPickerModal component should be used
        // For now, open file picker as fallback
        triggerUpload();
      } catch { triggerUpload(); }
    };

    const triggerUpload = () => {
      if (readOnly) return;
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*";
      inp.onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) uploadFile(f); };
      inp.click();
    };

    if (currentSrc) {
      return React.createElement("div", {
        style: { position: "relative", cursor: readOnly ? "default" : "pointer" },
        onClick: triggerUpload,
        onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (readOnly) return; const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) uploadFile(f); },
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
      },
        React.createElement("img", { src: currentSrc, alt: "Preview", style: { width: "100%", height: 140, objectFit: "cover", border: "1px solid #E8E4DF", display: "block" } }),
        !readOnly && React.createElement("div", {
          style: {
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: 0, transition: "opacity 0.2s",
          },
          onMouseEnter: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.opacity = "1"; },
          onMouseLeave: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.opacity = "0"; },
        },
          React.createElement("span", { style: { color: "#fff", fontSize: 13, fontWeight: 500, background: "rgba(0,0,0,0.6)", padding: "6px 14px" } }, "Replace image...")
        ),
        !readOnly && React.createElement("button", {
          type: "button",
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); onChange(""); },
          style: { position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", width: 20, height: 20, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" },
          "aria-label": "Remove image",
        }, "✕"),
      );
    }

    return React.createElement("div", {
      onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (readOnly) return; const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) uploadFile(f); },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
      onClick: triggerUpload,
      style: { border: "2px dashed #D4CFC8", padding: "20px 12px", textAlign: "center" as const, cursor: "pointer", background: "#F9F7F5", fontSize: 13, color: "#6B6B6B" },
    },
      React.createElement("div", { style: { fontSize: 20, marginBottom: 4 } }, "📁"),
      React.createElement("div", null, "Drop image or click to upload"),
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT COMPONENTS — Containers with DropZones for nesting
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Section ─────────────────────────────────────────────────────────────────
// The primary container. Has background color/image/opacity, contains a DropZone.

const Section: Config["components"][string] = {
  label: "Section",
  fields: {
    bgColor: { type: "select", label: "Background Color", options: [
      { label: "None", value: "transparent" }, { label: "White", value: "#FFFFFF" },
      { label: "Cream Light", value: "#F9F7F5" }, { label: "Cream", value: "#F5F3F0" },
      { label: "Cream Dark", value: "#EBE7E2" }, { label: "Sand", value: "#E8E4DF" },
      { label: "Charcoal Dark", value: "#1A1A1A" }, { label: "Charcoal", value: "#2C2C2C" },
      { label: "Gold", value: "#B8956B" },
    ]},
    bgImage: imageUploadField,
    bgOpacity: { type: "select", label: "Background Opacity", options: [
      { label: "100%", value: "1" }, { label: "90%", value: "0.9" }, { label: "75%", value: "0.75" },
      { label: "50%", value: "0.5" }, { label: "25%", value: "0.25" }, { label: "10%", value: "0.1" },
    ]},
    textColor: { type: "select", label: "Text Color", options: [
      { label: "Auto", value: "auto" }, { label: "Charcoal Dark", value: "#1A1A1A" }, { label: "Charcoal", value: "#2C2C2C" },
      { label: "Charcoal Light", value: "#4A4A4A" }, { label: "White", value: "#FFFFFF" },
    ]},
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    bgColor: "transparent",
    bgImage: "",
    bgOpacity: "1",
    textColor: "auto",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const { bgColor, bgImage, bgOpacity, textColor } = props;
    const bg = bgColor as string || "transparent";
    const img = bgImage as string;
    const opacity = parseFloat(bgOpacity as string) || 1;
    const isDark = bg === "#1A1A1A" || bg === "#2C2C2C" || bg === "#B8956B";
    const color = textColor === "auto" ? (isDark ? "#FFFFFF" : undefined) : (textColor as string);

    const outerStyle: React.CSSProperties = { position: "relative", overflow: "hidden" };
    if (!img) outerStyle.backgroundColor = bg;
    if (color) outerStyle.color = color;

    return styledRender(props, React.createElement("section", { style: outerStyle },
      // Background image overlay
      img ? React.createElement("div", { style: {
        position: "absolute", inset: 0, zIndex: 0,
        backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: "center",
        opacity,
      }}) : null,
      // Color overlay on top of image
      img && bg !== "transparent" ? React.createElement("div", { style: {
        position: "absolute", inset: 0, zIndex: 1, backgroundColor: bg, opacity: 1 - opacity,
      }}) : null,
      // Content
      React.createElement("div", { style: { position: "relative", zIndex: 2 } },
        React.createElement(DropZone, { zone: "section-content" })
      )
    ));
  },
};

// ─── Columns ─────────────────────────────────────────────────────────────────
// Divides into 2, 3, or 4 columns, each with its own DropZone.

const Columns: Config["components"][string] = {
  label: "Columns",
  fields: {
    columns: { type: "select", label: "Columns", options: [
      { label: "2 Columns", value: "2" }, { label: "3 Columns", value: "3" }, { label: "4 Columns", value: "4" },
    ]},
    gap: { type: "select", label: "Gap", options: [
      { label: "None", value: "0" }, { label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" },
    ]},
    ...spacingBorderFields,
  },
  defaultProps: { columns: "2", gap: "md", ...spacingBorderDefaults },
  render: (props) => {
    const colCount = Number(props.columns) || 2;
    const gapMap: Record<string, string> = { "0": "gap-0", sm: "gap-4", md: "gap-6 sm:gap-8", lg: "gap-8 sm:gap-12" };
    const gapClass = gapMap[props.gap as string] ?? gapMap.md;
    const colsMap: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" };
    return styledRender(props, React.createElement("div", { className: `grid grid-cols-1 ${colsMap[colCount] ?? "md:grid-cols-2"} ${gapClass}` },
      ...Array.from({ length: colCount }, (_, i) =>
        React.createElement("div", { key: i, className: "min-h-[60px]" }, React.createElement(DropZone, { zone: `column-${i}` }))
      )
    ));
  },
};


// ─── Container — Content width constraint with DropZone ──────────────────────

const Container: Config["components"][string] = {
  label: "Container",
  fields: {
    maxWidth: { type: "select", label: "Max Width", options: [
      { label: "Small (720px)", value: "720" }, { label: "Medium (960px)", value: "960" },
      { label: "Large (1200px)", value: "1200" }, { label: "XL (1400px)", value: "1400" },
      { label: "Full", value: "full" },
    ]},
    ...spacingBorderFields,
  },
  defaultProps: { maxWidth: "1200", ...spacingBorderDefaults },
  render: (props) => {
    const mw = (props.maxWidth as string) === "full" ? "100%" : `${props.maxWidth}px`;
    return styledRender(props, React.createElement("div", {
      style: { maxWidth: mw, marginLeft: "auto", marginRight: "auto", padding: mw === "100%" ? 0 : "0 16px" },
    },
      React.createElement(DropZone, { zone: "container-content" })
    ));
  },
};

// ─── Quote/Blockquote — Styled quote with accent border ──────────────────────

const Quote: Config["components"][string] = {
  label: "Quote",
  fields: {
    text: { type: "textarea", label: "Quote Text", contentEditable: true },
    accentColor: { type: "select", label: "Accent Color", options: [
      { label: "Gold", value: "#B8956B" }, { label: "Charcoal", value: "#2C2C2C" },
      { label: "Sand", value: "#E8E4DF" }, { label: "None", value: "transparent" },
    ]},
    fontStyle: { type: "radio", label: "Style", options: [
      { label: "Italic", value: "italic" }, { label: "Normal", value: "normal" },
    ]},
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: {
    text: "Why choose between vibrancy and tranquility? At Bayn, you don't have to.",
    accentColor: "#B8956B",
    fontStyle: "normal",
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const typoCSS = typographyPropsToCSS(props);
    const accent = props.accentColor as string;
    const style: React.CSSProperties = {
      ...typoCSS,
      fontStyle: props.fontStyle as string,
      borderLeft: accent !== "transparent" ? `2px solid ${accent}` : undefined,
      paddingLeft: accent !== "transparent" ? "16px" : undefined,
    };
    return styledRender(props, React.createElement("blockquote", { style }, props.text as string));
  },
};

// ─── Link — Inline text link ─────────────────────────────────────────────────

const InlineLink: Config["components"][string] = {
  label: "Link",
  fields: {
    text: { type: "text", label: "Link Text", contentEditable: true },
    url: { type: "text", label: "URL" },
    color: { type: "select", label: "Color", options: [
      { label: "Gold", value: "#B8956B" }, { label: "Charcoal", value: "#2C2C2C" },
      { label: "White", value: "#FFFFFF" }, { label: "Inherit", value: "inherit" },
    ]},
    underline: { type: "radio", label: "Underline", options: [
      { label: "Yes", value: "underline" }, { label: "No", value: "none" },
    ]},
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: {
    text: "Learn more",
    url: "#",
    color: "#B8956B",
    underline: "none",
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const typoCSS = typographyPropsToCSS(props);
    return styledRender(props, React.createElement("a", {
      href: props.url as string,
      style: { ...typoCSS, color: props.color as string, textDecoration: props.underline as string },
      className: "hover:opacity-80 transition",
    }, props.text as string));
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ATOMIC COMPONENTS — Standalone, independently editable
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Heading ─────────────────────────────────────────────────────────────────

const Heading: Config["components"][string] = {
  label: "Heading",
  fields: {
    text: { type: "text", label: "Text", contentEditable: true },
    level: { type: "select", label: "Level", options: [
      { label: "H1", value: "h1" }, { label: "H2", value: "h2" }, { label: "H3", value: "h3" }, { label: "H4", value: "h4" },
    ]},
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: { text: "Your Heading", level: "h2", ...typographyDefaultsHeading, ...spacingBorderDefaults },
  render: (props) => {
    const tag = (props.level as string) || "h2";
    const typoCSS = typographyPropsToCSS(props);
    return styledRender(props, React.createElement(tag, { style: typoCSS }, props.text as string));
  },
};

// ─── Text ────────────────────────────────────────────────────────────────────

const Text: Config["components"][string] = {
  label: "Text",
  fields: {
    content: { type: "textarea", label: "Content", contentEditable: true },
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: { content: "Enter your text here.", ...typographyDefaultsText, ...spacingBorderDefaults },
  render: (props) => {
    const typoCSS = typographyPropsToCSS(props);
    return styledRender(props, React.createElement("p", {
      style: { ...typoCSS, whiteSpace: "pre-line" },
    }, props.content as string));
  },
};

// ─── Button ──────────────────────────────────────────────────────────────────

const Button: Config["components"][string] = {
  label: "Button",
  fields: {
    text: { type: "text", label: "Text", contentEditable: true },
    link: { type: "text", label: "Link" },
    variant: { type: "select", label: "Variant", options: [
      { label: "Default", value: "default" }, { label: "Gold", value: "gold" }, { label: "Secondary", value: "secondary" }, { label: "Outline", value: "outline" }, { label: "Ghost", value: "ghost" },
    ]},
    size: { type: "select", label: "Size", options: [{ label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" }] },
    fullWidth: { type: "radio", label: "Full Width", options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] },
    alignment: { type: "radio", label: "Alignment", options: [{ label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" }] },
    borderRadius: { type: "text", label: "Border Radius" },
    ...spacingBorderFields,
  },
  defaultProps: { text: "Click Me", link: "#", variant: "default", size: "md", fullWidth: "no", alignment: "left", borderRadius: "0", ...spacingBorderDefaults },
  render: (props) => {
    const variantMap: Record<string, string> = {
      default: "bg-[#2C2C2C] text-white hover:bg-[#4A4A4A]",
      gold: "bg-[#B8956B] text-white hover:bg-[#8B7355]",
      secondary: "bg-[#F5F3F0] text-[#2C2C2C] border border-[#E8E4DF]",
      outline: "border border-[#2C2C2C] text-[#2C2C2C]",
      ghost: "text-[#2C2C2C] hover:bg-[#F5F3F0]",
      // Legacy alias
      primary: "bg-[#2C2C2C] text-white hover:bg-[#4A4A4A]",
    };
    const sizeMap: Record<string, string> = { sm: "px-3 py-1.5 text-sm", md: "px-5 py-2.5 text-sm", lg: "px-8 py-4 text-base" };
    const alignMap: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };
    const fw = (props.fullWidth as string) === "yes" ? "w-full" : "inline-block";
    const br = `${props.borderRadius || 0}px`;
    return styledRender(props, React.createElement("div", { className: alignMap[props.alignment as string] ?? "" },
      React.createElement("a", {
        href: props.link as string,
        className: `${fw} font-semibold transition ${variantMap[props.variant as string] ?? variantMap.default} ${sizeMap[props.size as string] ?? sizeMap.md}`,
        style: { borderRadius: br },
      }, props.text as string)
    ));
  },
};

// ─── Image ───────────────────────────────────────────────────────────────────

const Image: Config["components"][string] = {
  label: "Image",
  fields: {
    src: imageUploadField,
    alt: { type: "text", label: "Alt Text" },
    ...imageFields,
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: { src: "https://placehold.co/800x400", alt: "Image", ...imageDefaults, ...spacingBorderDefaults, ...animationDefaults },
  render: (props) => {
    const src = (props.src as string) || "https://placehold.co/800x400";
    const alt = (props.alt as string) || "Image";
    const { wrapperStyle, imgStyle, hoverClass } = imagePropsToCSS(props);
    return styledRender(props, React.createElement("div", { style: wrapperStyle },
      React.createElement("div", { className: `overflow-hidden ${hoverClass ? "group" : ""}` },
        React.createElement("img", {
          src, alt,
          style: imgStyle,
          className: hoverClass ? `transition-all duration-500 ${hoverClass.replace("hover:", "group-hover:")}` : undefined,
        })
      )
    ));
  },
};

// ─── Spacer ──────────────────────────────────────────────────────────────────

const Spacer: Config["components"][string] = {
  label: "Spacer",
  fields: {
    height: { type: "select", label: "Height", options: [
      { label: "8px", value: "8" }, { label: "16px", value: "16" }, { label: "24px", value: "24" },
      { label: "32px", value: "32" }, { label: "48px", value: "48" }, { label: "64px", value: "64" },
      { label: "96px", value: "96" }, { label: "128px", value: "128" },
    ]},
  },
  defaultProps: { height: "32" },
  render: (props) => React.createElement("div", { style: { height: `${props.height}px` }, "aria-hidden": "true" }),
};

// ─── Divider ─────────────────────────────────────────────────────────────────

const Divider: Config["components"][string] = {
  label: "Divider",
  fields: {
    color: { type: "select", label: "Color", options: [
      { label: "Sand", value: "#E8E4DF" }, { label: "Sand Dark", value: "#D4CFC8" }, { label: "Stone Dark", value: "#B8B3AB" },
      { label: "Charcoal", value: "#2C2C2C" }, { label: "Gold", value: "#B8956B" },
    ]},
    thickness: { type: "select", label: "Thickness", options: [{ label: "1px", value: "1" }, { label: "2px", value: "2" }, { label: "4px", value: "4" }] },
    ...spacingBorderFields,
  },
  defaultProps: { color: "#E8E4DF", thickness: "1", ...spacingBorderDefaults },
  render: (props) => styledRender(props, React.createElement("hr", { style: { border: "none", borderTop: `${props.thickness}px solid ${props.color}` } })),
};

// ─── Icon ────────────────────────────────────────────────────────────────────

const Icon: Config["components"][string] = {
  label: "Icon",
  fields: {
    icon: { type: "select", label: "Icon", options: [
      { label: "Home", value: "home" }, { label: "Phone", value: "phone" }, { label: "Mail", value: "mail" },
      { label: "Map Pin", value: "map-pin" }, { label: "Star", value: "star" }, { label: "Heart", value: "heart" },
      { label: "Check", value: "check" }, { label: "Arrow Right", value: "arrow-right" },
      { label: "Building", value: "building" }, { label: "Palm Tree", value: "palmtree" },
      { label: "Waves", value: "waves" }, { label: "Sun", value: "sun" }, { label: "Shield", value: "shield" },
      { label: "Car", value: "car" }, { label: "Bed", value: "bed" }, { label: "Bath", value: "bath" },
      { label: "Eye", value: "eye" }, { label: "Download", value: "download" },
      { label: "External Link", value: "external-link" }, { label: "Quote", value: "quote" },
    ]},
    size: { type: "select", label: "Size", options: [
      { label: "16", value: "16" }, { label: "20", value: "20" }, { label: "24", value: "24" },
      { label: "32", value: "32" }, { label: "40", value: "40" }, { label: "48", value: "48" },
      { label: "64", value: "64" },
    ]},
    color: colorField,
    alignment: { type: "radio", label: "Alignment", options: [
      { label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" },
    ]},
    strokeWidth: { type: "select", label: "Stroke Width", options: [
      { label: "1", value: "1" }, { label: "1.5", value: "1.5" }, { label: "2", value: "2" },
    ]},
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    icon: "star",
    size: "24",
    color: "#2C2C2C",
    alignment: "center",
    strokeWidth: "1",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const iconName = props.icon as string;
    const LucideComponent = ICON_MAP[iconName];
    const size = Number(props.size) || 24;
    const color = (props.color as string) || "#2C2C2C";
    const strokeWidth = parseFloat(props.strokeWidth as string) || 1;
    const alignment = (props.alignment as string) || "center";

    const iconEl = LucideComponent
      ? React.createElement(LucideComponent, { size, color, strokeWidth })
      : React.createElement("div", {
          style: { width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #9A9A9A", color: "#9A9A9A", fontSize: size * 0.5 },
        }, "?");

    return styledRender(props, React.createElement("div", { style: { textAlign: alignment as React.CSSProperties["textAlign"] } }, iconEl));
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE COMPONENTS — Thin wrappers that trigger template expansion on drop
// ═══════════════════════════════════════════════════════════════════════════════

function createTemplateComponent(templateId: string, label: string): Config["components"][string] {
  const template = componentTemplates.find(t => t.id === templateId);
  return {
    label,
    fields: {},
    defaultProps: {},
    render: () => {
      return React.createElement("div", {
        style: { padding: "24px", border: "2px dashed #B8956B", textAlign: "center" as const, color: "#6B6B6B", fontSize: 14 },
      },
        React.createElement("p", { style: { fontWeight: 600, color: "#2C2C2C", marginBottom: 4 } }, label),
        React.createElement("p", { style: { fontSize: 12 } }, template?.description ?? "Template component"),
      );
    },
  };
}

const TplContentBlock = createTemplateComponent("tpl-content-block", "Content Block");
const TplHeroSection = createTemplateComponent("tpl-hero-section", "Hero Section");
const TplFeatureSection = createTemplateComponent("tpl-feature-section", "Feature Section");
const TplCTASection = createTemplateComponent("tpl-cta-section", "CTA Section");
const TplTestimonialSection = createTemplateComponent("tpl-testimonial-section", "Testimonial Section");


// ═══════════════════════════════════════════════════════════════════════════════
// ORA COMPONENTS — Real estate specific, matching ora-uae.com design
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Footer ──────────────────────────────────────────────────────────────────

const Footer: Config["components"][string] = {
  label: "Footer",
  fields: {
    copyright: { type: "text", label: "Copyright", contentEditable: true },
    links: { type: "array", label: "Links", arrayFields: { label: { type: "text", label: "Label" }, url: { type: "text", label: "URL" } }, defaultItemProps: { label: "Link", url: "#" }, getItemSummary: (item: Record<string, unknown>) => (item.label as string) || "Link" },
    ...spacingBorderFields,
  },
  defaultProps: { copyright: "© 2025 Company. All rights reserved.", links: [{ label: "Privacy", url: "#" }, { label: "Terms", url: "#" }, { label: "Contact", url: "#" }], ...spacingBorderDefaults },
  render: (props) => {
    const items = (props.links as Array<Record<string, unknown>>) ?? [];
    return styledRender(props, React.createElement("footer", { className: "bg-[#1A1A1A] text-[#B8B3AB] px-4 py-8" },
      React.createElement("div", { className: "mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4" },
        React.createElement("p", { className: "text-xs text-[#6B6B6B]" }, props.copyright as string),
        React.createElement("div", { className: "flex gap-4" },
          ...items.map((link, i) => React.createElement("a", { key: i, href: link.url as string, className: "text-sm hover:text-white transition" }, link.label as string))
        ),
      ),
    ));
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// ORA COMPONENTS — Real estate specific, matching ora-uae.com design
// ═══════════════════════════════════════════════════════════════════════════════

// ─── ContentBlock — Image + accent-bordered quote + body text + CTA ──────────

const ContentBlock: Config["components"][string] = {
  label: "Content Block",
  fields: {
    image: imageUploadField,
    quote: { type: "text", label: "Quote", contentEditable: true },
    body: { type: "textarea", label: "Body Text", contentEditable: true },
    ctaText: { type: "text", label: "CTA Text", contentEditable: true },
    ctaLink: { type: "text", label: "CTA Link" },
    imagePosition: { type: "radio", label: "Image Position", options: [{ label: "Left", value: "left" }, { label: "Right", value: "right" }] },
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    image: "https://placehold.co/600x400/EBE7E2/2C2C2C?text=Image",
    quote: "Why choose between vibrancy and tranquility, between energy and ease? At Bayn, you don't have to.",
    body: "Designed for those who want it all, this beachfront community is where seamless accessibility meets uninterrupted sea views, where movement blends with mindfulness, and where connection coexists with privacy.\n\nWith a walkable, self-contained layout, every necessity and indulgence is within reach.",
    ctaText: "DOWNLOAD BROCHURE",
    ctaLink: "#",
    imagePosition: "left",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const imgPos = props.imagePosition as string;
    const imgEl = React.createElement("div", { className: "flex-1 min-h-[300px]" },
      React.createElement("img", { src: (props.image as string) || "https://placehold.co/600x400", alt: "", className: "w-full h-full object-cover" })
    );
    const textEl = React.createElement("div", { className: "flex-1 flex flex-col justify-center gap-6 py-8 px-4 md:px-8" },
      React.createElement("blockquote", { className: "border-l-2 border-[#B8956B] pl-4 text-lg font-light text-[#2C2C2C] leading-relaxed" }, props.quote as string),
      React.createElement("p", { className: "text-sm text-[#4A4A4A] leading-relaxed whitespace-pre-line" }, props.body as string),
      (props.ctaText as string) && React.createElement("div", null,
        React.createElement("a", { href: props.ctaLink as string, className: "inline-flex items-center gap-2 rounded-full border border-[#2C2C2C] px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-[#2C2C2C] hover:bg-[#2C2C2C] hover:text-white transition" },
          props.ctaText as string, React.createElement("span", null, "↓")
        )
      )
    );
    return styledRender(props, React.createElement("div", { className: "flex flex-col md:flex-row gap-0" },
      imgPos === "right" ? [textEl, imgEl] : [imgEl, textEl]
    ));
  },
};

// ─── PropertyCard — Image + title + arrow link + description ─────────────────

const PropertyCard: Config["components"][string] = {
  label: "Property Card",
  fields: {
    image: imageUploadField,
    title: { type: "text", label: "Title", contentEditable: true },
    description: { type: "textarea", label: "Description", contentEditable: true },
    link: { type: "text", label: "Link" },
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    image: "https://placehold.co/400x300/EBE7E2/2C2C2C?text=Property",
    title: "Gemini Villa 4 BR",
    description: "Signature step-down villas immersed in nature",
    link: "#",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => styledRender(props, React.createElement("a", { href: (props.link as string) || "#", className: "block group" },
    React.createElement("div", { className: "overflow-hidden" },
      React.createElement("img", { src: (props.image as string) || "https://placehold.co/400x300", alt: props.title as string, className: "w-full aspect-[4/3] object-cover transition-transform duration-500 group-hover:scale-105" })
    ),
    React.createElement("div", { className: "mt-4 flex items-start justify-between gap-4" },
      React.createElement("div", null,
        React.createElement("h3", { className: "text-lg font-semibold text-[#1A1A1A]" }, props.title as string),
        React.createElement("p", { className: "mt-1 text-sm text-[#6B6B6B]" }, props.description as string),
      ),
      React.createElement("span", { className: "mt-1 flex h-8 w-8 shrink-0 items-center justify-center border border-[#E8E4DF] text-[#2C2C2C] group-hover:border-[#B8956B] group-hover:text-[#B8956B] transition" }, "→"),
    ),
  )),
};

// ─── HeroBanner — Full-width bg image + centered title + subtitle + scroll ───

const HeroBanner: Config["components"][string] = {
  label: "Hero Banner",
  fields: {
    bgImage: imageUploadField,
    title: { type: "text", label: "Title", contentEditable: true },
    subtitle: { type: "textarea", label: "Subtitle", contentEditable: true },
    scrollText: { type: "text", label: "Scroll Text", contentEditable: true },
    scrollLink: { type: "text", label: "Scroll Link" },
    overlayOpacity: { type: "select", label: "Overlay Darkness", options: [
      { label: "None", value: "0" }, { label: "Light", value: "0.2" }, { label: "Medium", value: "0.4" }, { label: "Heavy", value: "0.6" },
    ]},
    height: { type: "select", label: "Height", options: [
      { label: "Medium (60vh)", value: "60" }, { label: "Large (80vh)", value: "80" }, { label: "Full Screen", value: "100" },
    ]},
    ...spacingBorderFields,
  },
  defaultProps: {
    bgImage: "https://placehold.co/1920x1080/2C2C2C/FFFFFF?text=Hero+Image",
    title: "Gemini Villa 5 BR",
    subtitle: "Exquisite villas by the lagoon and canals",
    scrollText: "Explore More",
    scrollLink: "#",
    overlayOpacity: "0.2",
    height: "80",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const h = `${props.height}vh`;
    const overlay = parseFloat(props.overlayOpacity as string) || 0;
    return styledRender(props, React.createElement("div", { style: { position: "relative", height: h, overflow: "hidden" } },
      React.createElement("div", { style: { position: "absolute", inset: 0, backgroundImage: `url(${props.bgImage as string})`, backgroundSize: "cover", backgroundPosition: "center" } }),
      overlay > 0 ? React.createElement("div", { style: { position: "absolute", inset: 0, backgroundColor: "#000", opacity: overlay } }) : null,
      React.createElement("div", { style: { position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#fff", padding: "0 24px" } },
        React.createElement("h1", { className: "text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-light tracking-tight" }, props.title as string),
        React.createElement("p", { className: "mt-4 text-base sm:text-lg font-light opacity-80 max-w-xl" }, props.subtitle as string),
        (props.scrollText as string) && React.createElement("a", { href: props.scrollLink as string, className: "mt-12 flex flex-col items-center gap-2 text-xs uppercase tracking-widest opacity-70 hover:opacity-100 transition" },
          React.createElement("span", null, props.scrollText as string),
          React.createElement("span", { className: "border border-white/40 px-2 py-3 text-lg" }, "↓"),
        ),
      ),
    ));
  },
};

// ─── FilterTabs — Horizontal tabs with superscript counts ────────────────────

const FilterTabs: Config["components"][string] = {
  label: "Filter Tabs",
  fields: {
    tabs: { type: "array", label: "Tabs", arrayFields: {
      label: { type: "text", label: "Label" },
      count: { type: "text", label: "Count" },
      link: { type: "text", label: "Link" },
    }, defaultItemProps: { label: "Tab", count: "0", link: "#" }, getItemSummary: (item: Record<string, unknown>) => (item.label as string) || "Tab" },
    activeIndex: { type: "number", label: "Active Tab (0-based)", min: 0 },
    ...spacingBorderFields,
  },
  defaultProps: {
    tabs: [
      { label: "All", count: "10", link: "#" },
      { label: "Villas", count: "6", link: "#" },
      { label: "Townhouses", count: "4", link: "#" },
    ],
    activeIndex: 0,
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const tabs = (props.tabs as Array<Record<string, unknown>>) ?? [];
    const active = Number(props.activeIndex) || 0;
    return styledRender(props, React.createElement("div", { className: "border-y border-[#E8E4DF] py-6" },
      React.createElement("div", { className: "flex items-baseline gap-8 flex-wrap" },
        ...tabs.map((tab, i) => {
          const isActive = i === active;
          return React.createElement("a", { key: i, href: tab.link as string, className: `text-2xl sm:text-3xl md:text-4xl font-semibold transition ${isActive ? "text-[#0EA5E9]" : "text-[#1A1A1A] hover:text-[#B8956B]"}` },
            tab.label as string,
            React.createElement("sup", { className: "ml-0.5 text-sm font-normal align-super" }, tab.count as string),
          );
        })
      ),
    ));
  },
};

// ─── Accordion — Expandable section with DropZone content ────────────────────

const Accordion: Config["components"][string] = {
  label: "Accordion",
  fields: {
    title: { type: "text", label: "Title", contentEditable: true },
    defaultOpen: { type: "radio", label: "Default Open", options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] },
    ...spacingBorderFields,
  },
  defaultProps: { title: "Light Palette", defaultOpen: "yes", ...spacingBorderDefaults },
  render: (props) => {
    const isOpen = (props.defaultOpen as string) === "yes";
    return styledRender(props, React.createElement("details", { open: isOpen || undefined, className: "group border-b border-[#E8E4DF]" },
      React.createElement("summary", { className: "flex cursor-pointer items-center justify-between py-5 list-none" },
        React.createElement("h3", { className: "text-xl sm:text-2xl font-light text-[#1A1A1A]" }, props.title as string),
        React.createElement("span", { className: "text-[#2C2C2C] text-xl transition-transform group-open:rotate-180" }, "∧"),
      ),
      React.createElement("div", { className: "pb-6" },
        React.createElement(DropZone, { zone: "accordion-content" }),
      ),
    ));
  },
};

// ─── StatRow — Horizontal row of key statistics ──────────────────────────────

const StatRow: Config["components"][string] = {
  label: "Stat Row",
  fields: {
    stats: { type: "array", label: "Stats", arrayFields: {
      value: { type: "text", label: "Value" },
      label: { type: "text", label: "Label" },
    }, defaultItemProps: { value: "100", label: "Stat Label" }, getItemSummary: (item: Record<string, unknown>) => `${item.value} ${item.label}` },
    alignment: { type: "radio", label: "Alignment", options: [{ label: "Left", value: "left" }, { label: "Center", value: "center" }] },
    ...spacingBorderFields,
  },
  defaultProps: {
    stats: [
      { value: "4.8M²", label: "Total Land Area" },
      { value: "55%", label: "Open Spaces" },
      { value: "32K", label: "Residents" },
      { value: "9K", label: "Units" },
      { value: "1.2KM", label: "Beach Front" },
    ],
    alignment: "center",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const stats = (props.stats as Array<Record<string, unknown>>) ?? [];
    const align = (props.alignment as string) === "center" ? "justify-center" : "justify-start";
    return styledRender(props, React.createElement("div", { className: `flex flex-wrap gap-8 md:gap-12 ${align} py-6` },
      ...stats.map((stat, i) => React.createElement("div", { key: i, className: "text-center" },
        React.createElement("p", { className: "text-2xl sm:text-3xl font-semibold text-[#1A1A1A]" }, stat.value as string),
        React.createElement("p", { className: "mt-1 text-xs uppercase tracking-wider text-[#6B6B6B]" }, stat.label as string),
      ))
    ));
  },
};

// ─── MegaFooter — Full ORA footer with columns, newsletter, social, legal ────

const MegaFooter: Config["components"][string] = {
  label: "Mega Footer",
  fields: {
    columns: { type: "array", label: "Link Columns", arrayFields: {
      title: { type: "text", label: "Column Title" },
      links: { type: "textarea", label: "Links (one per line: Label | URL)" },
    }, defaultItemProps: { title: "SITEMAP", links: "About ORA | #\nProperty Types | #\nContact Us | #" }, getItemSummary: (item: Record<string, unknown>) => (item.title as string) || "Column" },
    email: { type: "text", label: "Recruitment Email" },
    newsletterText: { type: "text", label: "Newsletter Label", contentEditable: true },
    brochureText: { type: "text", label: "Brochure CTA", contentEditable: true },
    brochureLink: { type: "text", label: "Brochure URL" },
    copyright: { type: "text", label: "Copyright", contentEditable: true },
    legalLinks: { type: "array", label: "Legal Links", arrayFields: { label: { type: "text", label: "Label" }, url: { type: "text", label: "URL" } }, defaultItemProps: { label: "Privacy Policy", url: "#" }, getItemSummary: (item: Record<string, unknown>) => (item.label as string) || "Link" },
    socialLinks: { type: "array", label: "Social Links", arrayFields: { platform: { type: "text", label: "Platform" }, url: { type: "text", label: "URL" } }, defaultItemProps: { platform: "Instagram", url: "#" }, getItemSummary: (item: Record<string, unknown>) => (item.platform as string) || "Social" },
    ...spacingBorderFields,
  },
  defaultProps: {
    columns: [
      { title: "SITEMAP", links: "About ORA | #\nProperty Types | #\nLife at Bayn | #\nWhy Bayn | #\nContact Us | #" },
      { title: "PROPERTIES", links: "ZED East | #\nZED ElSheikh Zayed | #\nSilversands North Coast | #\nSolana by ORA | #" },
      { title: "HOSPITALITY", links: "Silversands Grand Anse | #\nSilversands Beach House | #\nMerveilles Hub | #" },
    ],
    email: "careers@ora-uae.com",
    newsletterText: "SUBSCRIBE TO OUR NEWSLETTER",
    brochureText: "DOWNLOAD BROCHURE",
    brochureLink: "#",
    copyright: "© ORA 2025. All rights reserved.",
    legalLinks: [{ label: "Cookie Policy", url: "#" }, { label: "Terms & Conditions", url: "#" }, { label: "Privacy Policy", url: "#" }],
    socialLinks: [{ platform: "f", url: "#" }, { platform: "📷", url: "#" }, { platform: "𝕏", url: "#" }, { platform: "▶", url: "#" }],
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const cols = (props.columns as Array<Record<string, unknown>>) ?? [];
    const legalLinks = (props.legalLinks as Array<Record<string, unknown>>) ?? [];
    const socialLinks = (props.socialLinks as Array<Record<string, unknown>>) ?? [];
    const parseLinks = (text: string) => (text || "").split("\n").map(l => { const [label, url] = l.split("|").map(s => s.trim()); return { label: label || "", url: url || "#" }; }).filter(l => l.label);

    return styledRender(props, React.createElement("footer", { className: "bg-[#F9F7F5]" },
      // Main footer
      React.createElement("div", { className: "mx-auto max-w-6xl px-6 py-12 grid gap-8 md:grid-cols-4" },
        // Link columns
        ...cols.map((col, i) => React.createElement("div", { key: i },
          React.createElement("p", { className: "text-xs font-medium uppercase tracking-wider text-[#6B6B6B] mb-3" }, col.title as string),
          ...parseLinks(col.links as string).map((link, j) => React.createElement("a", { key: j, href: link.url, className: "block text-sm text-[#2C2C2C] hover:text-[#B8956B] transition py-0.5" }, link.label))
        )),
        // Right column: recruitment + newsletter + brochure
        React.createElement("div", { className: "space-y-6" },
          React.createElement("div", null,
            React.createElement("p", { className: "text-xs font-medium uppercase tracking-wider text-[#B8956B] mb-2" }, "FOR RECRUITMENT"),
            React.createElement("a", { href: `mailto:${props.email}`, className: "text-sm text-[#2C2C2C] hover:text-[#B8956B]" }, `✉ ${props.email}`),
          ),
          React.createElement("div", null,
            React.createElement("p", { className: "text-xs font-medium uppercase tracking-wider text-[#B8956B] mb-2" }, props.newsletterText as string),
            React.createElement("div", { className: "flex border-b border-[#2C2C2C]" },
              React.createElement("input", { type: "email", placeholder: "Email", className: "flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-[#9A9A9A]" }),
              React.createElement("button", { className: "px-3 py-2 text-xs font-medium uppercase tracking-wider text-[#2C2C2C]" }, "SUBMIT"),
            ),
          ),
          React.createElement("a", { href: props.brochureLink as string, className: "inline-flex items-center gap-2 rounded-full border border-[#2C2C2C] px-5 py-2 text-xs font-medium uppercase tracking-wider text-[#2C2C2C] hover:bg-[#2C2C2C] hover:text-white transition" },
            props.brochureText as string, "↓"
          ),
        ),
      ),
      // Bottom bar
      React.createElement("div", { className: "border-t border-[#E8E4DF]" },
        React.createElement("div", { className: "mx-auto max-w-6xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4" },
          React.createElement("p", { className: "text-xs text-[#6B6B6B]" }, props.copyright as string),
          React.createElement("div", { className: "flex gap-6" },
            ...legalLinks.map((l, i) => React.createElement("a", { key: i, href: l.url as string, className: "text-xs text-[#6B6B6B] hover:text-[#2C2C2C] transition" }, l.label as string)),
          ),
          React.createElement("div", { className: "flex gap-4" },
            ...socialLinks.map((s, i) => React.createElement("a", { key: i, href: s.url as string, className: "flex h-8 w-8 items-center justify-center text-sm text-[#2C2C2C] hover:text-[#B8956B] transition" }, s.platform as string)),
          ),
        ),
      ),
    ));
  },
};

// ─── FeatureGrid — Icon + label grid for unit features ───────────────────────

const FeatureGrid: Config["components"][string] = {
  label: "Feature Grid",
  fields: {
    title: { type: "text", label: "Title", contentEditable: true },
    features: { type: "array", label: "Features", arrayFields: {
      icon: { type: "text", label: "Icon (emoji)" },
      label: { type: "text", label: "Label" },
    }, defaultItemProps: { icon: "🏠", label: "Feature" }, getItemSummary: (item: Record<string, unknown>) => (item.label as string) || "Feature" },
    columns: { type: "select", label: "Columns", options: [{ label: "3", value: "3" }, { label: "4", value: "4" }, { label: "5", value: "5" }] },
    ...spacingBorderFields,
  },
  defaultProps: {
    title: "Unit Features",
    features: [
      { icon: "🛏️", label: "5 bedrooms" },
      { icon: "🛁", label: "6 bathrooms" },
      { icon: "🏡", label: "Step-down villa" },
      { icon: "🏊", label: "Canal and lagoon views" },
      { icon: "🚗", label: "Parking for 3 cars" },
      { icon: "🛗", label: "Provision for lift" },
    ],
    columns: "4",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const features = (props.features as Array<Record<string, unknown>>) ?? [];
    const colsMap: Record<string, string> = { "3": "sm:grid-cols-3", "4": "sm:grid-cols-4", "5": "sm:grid-cols-5" };
    return styledRender(props, React.createElement("div", { className: "py-8" },
      (props.title as string) && React.createElement("h2", { className: "text-3xl sm:text-4xl font-light text-center text-[#1A1A1A] mb-10" }, props.title as string),
      React.createElement("div", { className: `grid grid-cols-2 ${colsMap[props.columns as string] ?? "sm:grid-cols-4"} gap-6` },
        ...features.map((f, i) => React.createElement("div", { key: i, className: "flex items-center gap-3" },
          React.createElement("span", { className: "text-2xl shrink-0 w-10 h-10 flex items-center justify-center border border-[#E8E4DF] text-[#4A4A4A]" }, f.icon as string),
          React.createElement("span", { className: "text-sm text-[#2C2C2C]" }, f.label as string),
        ))
      ),
    ));
  },
};

// ─── Gallery — Horizontal scrolling image carousel with title + arrows ───────

const Gallery: Config["components"][string] = {
  label: "Gallery",
  fields: {
    title: { type: "text", label: "Title", contentEditable: true },
    images: { type: "array", label: "Images", arrayFields: {
      src: { type: "text", label: "Image URL" },
      alt: { type: "text", label: "Alt Text" },
    }, defaultItemProps: { src: "https://placehold.co/400x500/EBE7E2/2C2C2C?text=Gallery", alt: "Gallery image" }, getItemSummary: (item: Record<string, unknown>) => (item.alt as string) || "Image" },
    height: { type: "select", label: "Image Height", options: [{ label: "Small (250px)", value: "250" }, { label: "Medium (350px)", value: "350" }, { label: "Large (450px)", value: "450" }] },
    ...spacingBorderFields,
  },
  defaultProps: {
    title: "GALLERY",
    images: [
      { src: "https://placehold.co/400x500/EBE7E2/2C2C2C?text=1", alt: "Gallery 1" },
      { src: "https://placehold.co/400x500/D4CFC8/2C2C2C?text=2", alt: "Gallery 2" },
      { src: "https://placehold.co/400x500/EBE7E2/2C2C2C?text=3", alt: "Gallery 3" },
      { src: "https://placehold.co/400x500/D4CFC8/2C2C2C?text=4", alt: "Gallery 4" },
      { src: "https://placehold.co/400x500/EBE7E2/2C2C2C?text=5", alt: "Gallery 5" },
    ],
    height: "350",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const images = (props.images as Array<Record<string, unknown>>) ?? [];
    const h = `${props.height || 350}px`;
    return styledRender(props, React.createElement("div", { className: "py-8" },
      React.createElement("div", { className: "flex items-center justify-between mb-6" },
        React.createElement("h2", { className: "text-xs font-medium uppercase tracking-widest text-[#1A1A1A]" }, props.title as string),
        React.createElement("div", { className: "flex gap-2" },
          React.createElement("button", { className: "flex h-9 w-9 items-center justify-center rounded-full border border-[#E8E4DF] text-[#2C2C2C] hover:border-[#B8956B] transition", "aria-label": "Previous" }, "←"),
          React.createElement("button", { className: "flex h-9 w-9 items-center justify-center rounded-full border border-[#E8E4DF] text-[#2C2C2C] hover:border-[#B8956B] transition", "aria-label": "Next" }, "→"),
        ),
      ),
      React.createElement("div", { className: "flex gap-4 overflow-x-auto pb-4", style: { scrollSnapType: "x mandatory" } },
        ...images.map((img, i) => React.createElement("div", { key: i, className: "shrink-0", style: { scrollSnapAlign: "start" } },
          React.createElement("img", { src: img.src as string, alt: img.alt as string, style: { height: h, width: "auto", objectFit: "cover" }, className: "cursor-pointer hover:opacity-90 transition" })
        ))
      ),
    ));
  },
};

// ─── HighlightBlock — Image + icon/text highlight list, position toggleable ──

const HighlightBlock: Config["components"][string] = {
  label: "Highlight Block",
  fields: {
    image: imageUploadField,
    highlights: { type: "array", label: "Highlights", arrayFields: {
      icon: { type: "text", label: "Icon (emoji)" },
      text: { type: "text", label: "Text" },
    }, defaultItemProps: { icon: "🏖️", text: "Highlight item" }, getItemSummary: (item: Record<string, unknown>) => (item.text as string) || "Highlight" },
    imagePosition: { type: "radio", label: "Image Position", options: [{ label: "Left", value: "left" }, { label: "Right", value: "right" }] },
    ...spacingBorderFields,
  },
  defaultProps: {
    image: "https://placehold.co/600x500/EBE7E2/2C2C2C?text=Highlight",
    highlights: [
      { icon: "🏖️", text: "1.2 km of Pristine Beaches" },
      { icon: "🌴", text: "Beachfront Promenade" },
      { icon: "🌿", text: "55% Green Spaces" },
      { icon: "🌊", text: "Natural Lagoons & Canals" },
    ],
    imagePosition: "left",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const highlights = (props.highlights as Array<Record<string, unknown>>) ?? [];
    const imgPos = props.imagePosition as string;
    const imgEl = React.createElement("div", { className: "flex-1" },
      React.createElement("img", { src: (props.image as string) || "https://placehold.co/600x500", alt: "", className: "w-full h-full object-cover" })
    );
    const listEl = React.createElement("div", { className: "flex-1 flex flex-col justify-center gap-5 py-8 px-6 md:px-10" },
      ...highlights.map((h, i) => React.createElement("div", { key: i, className: "flex items-center gap-4 pb-4 border-b border-[#E8E4DF] last:border-0" },
        React.createElement("span", { className: "text-2xl shrink-0 w-10 h-10 flex items-center justify-center border border-[#E8E4DF] text-[#4A4A4A]" }, h.icon as string),
        React.createElement("span", { className: "text-base text-[#2C2C2C]" }, h.text as string),
      ))
    );
    return styledRender(props, React.createElement("div", { className: "flex flex-col md:flex-row" },
      imgPos === "right" ? [listEl, imgEl] : [imgEl, listEl]
    ));
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUCK CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export const pageBuilderConfig: Config = {
  categories: {
    layout: { components: ["Section", "Container", "Columns", "Accordion", "Spacer", "Divider"], title: "Layout", defaultExpanded: true },
    basic: { components: ["Heading", "Text", "Button", "InlineLink", "Image", "Quote", "Icon"], title: "Basic" },
    ora: { components: ["HeroBanner", "PropertyCard", "FeatureGrid", "FilterTabs", "StatRow", "Footer", "MegaFooter"], title: "ORA" },
    templates: { components: ["TplContentBlock", "TplHeroSection", "TplFeatureSection", "TplCTASection", "TplTestimonialSection"], title: "Templates" },
  },
  components: {
    Section, Container, Columns, Accordion, Spacer, Divider,
    Heading, Text, Button, InlineLink, Image, Quote, Icon,
    HeroBanner, PropertyCard, FeatureGrid, FilterTabs, StatRow, Footer, MegaFooter,
    TplContentBlock, TplHeroSection, TplFeatureSection, TplCTASection, TplTestimonialSection,
  },
};