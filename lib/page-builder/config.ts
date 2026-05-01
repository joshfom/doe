"use client";

import type { Config } from "@puckeditor/core";
import { DropZone } from "@puckeditor/core";
import { motion } from "framer-motion";
import React from "react";
import { stylePropsToCSS } from "./style-fields";
import {
  typographyFields,
  typographyDefaultsHeading,
  typographyDefaultsText,
  typographyPropsToCSS,
  colorField,
} from "./typography-fields";
import { imageFields, imageDefaults, imagePropsToCSS } from "./image-fields";
import { animationFields, animationDefaults } from "./animation-fields";
import { createCustomSelectField, createToggleField, createFreeInputField } from "./shared-field-controls";
import { LocationMap as LocationMapRuntime } from "./components/LocationMap/LocationMap";
import { PinMapPicker } from "./components/LocationMap/PinMapPicker";
import type { LocationMapPin, LocationMapCard } from "./components/LocationMap/types";
import { FeaturedProjectsRuntime } from "./components/project/FeaturedProjectsRuntime";
import { FeaturedCommunitiesRuntime } from "./components/project/FeaturedCommunitiesRuntime";
import { ProjectSectionRuntime, type ProjectSectionKind } from "./components/project/ProjectSectionRuntime";
import {
  Home, Phone, Mail, MapPin, Star, Heart, Check, ArrowRight,
  Building, Palmtree, Waves, Sun, Shield, Car, Bed, Bath,
  Eye, Download, ExternalLink, Quote as QuoteIcon,
  ArrowLeft, ChevronRight, ChevronLeft, ChevronDown, Plus, Minus,
  Send, Search, ShoppingCart, Calendar,
} from "lucide-react";

// ─── Lucide Icon Map ─────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  home: Home, phone: Phone, mail: Mail, "map-pin": MapPin,
  star: Star, heart: Heart, check: Check, "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft, "chevron-right": ChevronRight, "chevron-left": ChevronLeft,
  plus: Plus, minus: Minus, send: Send, search: Search,
  "shopping-cart": ShoppingCart, calendar: Calendar,
  building: Building, palmtree: Palmtree, waves: Waves, sun: Sun,
  shield: Shield, car: Car, bed: Bed, bath: Bath,
  eye: Eye, download: Download, "external-link": ExternalLink, quote: QuoteIcon,
};

// ─── Shared Style Helpers ────────────────────────────────────────────────────

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function renderSimpleStepper(
  label: string,
  value: number,
  onChange: (next: number) => void,
  step = 4,
) {
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
    React.createElement("span", { style: { minWidth: 64, fontSize: 12, color: "#2C2C2C" } }, label),
    React.createElement("button", {
      type: "button",
      onClick: () => onChange(Math.max(0, value - step)),
      style: { width: 24, height: 24, border: "1px solid #E8E4DF", background: "#F9F7F5", cursor: "pointer" },
    }, "−"),
    React.createElement("span", { style: { minWidth: 44, textAlign: "center", fontSize: 12 } }, `${value}px`),
    React.createElement("button", {
      type: "button",
      onClick: () => onChange(value + step),
      style: { width: 24, height: 24, border: "1px solid #E8E4DF", background: "#F9F7F5", cursor: "pointer" },
    }, "+"),
  );
}

function paddingField() {
  return {
    type: "custom" as const,
    label: "Padding",
    render: ({ value, onChange }: { value: unknown; onChange: (v: Record<string, string>) => void }) => {
      const current = (value as Record<string, string>) ?? {};
      const all = asNumber(current.paddingTop);
      const setAll = (next: number) => onChange({
        paddingTop: String(next),
        paddingBottom: String(next),
        paddingLeft: String(next),
        paddingRight: String(next),
      });
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        React.createElement("div", { style: { fontSize: 12, color: "#6B6B6B" } }, "Area padding"),
        renderSimpleStepper("All sides", all, setAll),
      );
    },
  };
}

function marginField() {
  return {
    type: "custom" as const,
    label: "Margin",
    render: ({ value, onChange }: { value: unknown; onChange: (v: Record<string, string>) => void }) => {
      const current = (value as Record<string, string>) ?? {};
      const mt = asNumber(current.marginTop);
      const mb = asNumber(current.marginBottom);
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderSimpleStepper("Top", mt, (next) => onChange({ ...current, marginTop: String(next), marginBottom: String(mb) })),
        renderSimpleStepper("Bottom", mb, (next) => onChange({ ...current, marginTop: String(mt), marginBottom: String(next) })),
      );
    },
  };
}

function borderField() {
  return {
    type: "custom" as const,
    label: "Border",
    render: ({ value, onChange }: { value: unknown; onChange: (v: Record<string, string>) => void }) => {
      const current = (value as Record<string, string>) ?? {};
      const bw = asNumber(current.borderWidth);
      const br = asNumber(current.borderRadius);
      const color = (current.borderColor as string) || "#E8E4DF";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderSimpleStepper("Width", bw, (next) => onChange({ ...current, borderWidth: String(next), borderRadius: String(br), borderColor: color }), 1),
        renderSimpleStepper("Radius", br, (next) => onChange({ ...current, borderWidth: String(bw), borderRadius: String(next), borderColor: color }), 2),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement("span", { style: { minWidth: 64, fontSize: 12, color: "#2C2C2C" } }, "Color"),
          React.createElement("input", {
            type: "color",
            value: color,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...current, borderWidth: String(bw), borderRadius: String(br), borderColor: e.target.value }),
            style: { width: 28, height: 28, border: "1px solid #E8E4DF", padding: 0, background: "none", cursor: "pointer" },
          }),
          React.createElement("input", {
            type: "text",
            value: color,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...current, borderWidth: String(bw), borderRadius: String(br), borderColor: e.target.value }),
            style: { flex: 1, minHeight: 32, border: "1px solid #E8E4DF", padding: "0 8px", fontSize: 12 },
          }),
        ),
      );
    },
  };
}

const spacingBorderFields = {
  _padding: paddingField(),
  _margin: marginField(),
  _border: borderField(),
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

function styledRender(props: Record<string, unknown>, content: React.ReactNode): React.ReactElement {
  const css = stylePropsToCSS(flattenStyleProps(props));
  return Object.keys(css).length > 0
    ? React.createElement("div", { style: css }, content)
    : React.createElement(React.Fragment, null, content);
}

const SECTION_HEIGHT_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Small (240px)", value: "240px" },
  { label: "Medium (400px)", value: "400px" },
  { label: "Large (600px)", value: "600px" },
  { label: "X-Large (800px)", value: "800px" },
  { label: "Half screen (50vh)", value: "50vh" },
  { label: "Two-thirds screen (66vh)", value: "66vh" },
  { label: "Three-quarters (75vh)", value: "75vh" },
  { label: "Full screen (100vh)", value: "100vh" },
];

const ORA_SOLID_BG_OPTIONS = [
  { label: "None", value: "transparent" },
  { label: "White", value: "#FFFFFF" },
  { label: "ORA Ivory", value: "#F8F6F2" },
  { label: "ORA Sand", value: "#F2EDE3" },
  { label: "Cream Light", value: "#F9F7F5" },
  { label: "Cream", value: "#F5F3F0" },
  { label: "Cream Dark", value: "#EBE7E2" },
  { label: "Sand", value: "#E8E4DF" },
  { label: "Charcoal", value: "#2C2C2C" },
  { label: "Charcoal Dark", value: "#1A1A1A" },
  { label: "ORA Navy", value: "#111432" },
  { label: "Black", value: "#000000" },
  { label: "ORA Cyan", value: "#01A7C7" },
  { label: "Sky Accent", value: "#8CC9E8" },
  { label: "Gold", value: "#B8956B" },
];

const ORA_GRADIENT_OPTIONS = [
  { label: "White", value: "#FFFFFF" },
  { label: "ORA Ivory", value: "#F8F6F2" },
  { label: "ORA Sand", value: "#F2EDE3" },
  { label: "Cream Light", value: "#F9F7F5" },
  { label: "Cream", value: "#F5F3F0" },
  { label: "Cream Dark", value: "#EBE7E2" },
  { label: "Sand", value: "#E8E4DF" },
  { label: "Gold", value: "#B8956B" },
  { label: "Sky Accent", value: "#8CC9E8" },
  { label: "ORA Cyan", value: "#01A7C7" },
  { label: "Charcoal", value: "#2C2C2C" },
  { label: "Charcoal Dark", value: "#1A1A1A" },
  { label: "ORA Navy", value: "#111432" },
  { label: "Black", value: "#000000" },
];

const ORA_TEXT_COLOR_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Black", value: "#000000" },
  { label: "ORA Navy", value: "#111432" },
  { label: "Charcoal Dark", value: "#1A1A1A" },
  { label: "Charcoal", value: "#2C2C2C" },
  { label: "Charcoal Light", value: "#4A4A4A" },
  { label: "White", value: "#FFFFFF" },
  { label: "ORA Cyan", value: "#01A7C7" },
  { label: "Sky Accent", value: "#8CC9E8" },
];

const RICH_TEXT_EMBEDDED_STYLES = `
.ora-richtext p { margin: 0 0 0.75rem 0; }
.ora-richtext p:last-child { margin-bottom: 0; }
.ora-richtext ul, .ora-richtext ol {
  margin: 0.5rem 0 0.75rem 1.25rem;
  padding-left: 0.5rem;
}
.ora-richtext ul { list-style: disc; }
.ora-richtext ol { list-style: decimal; }
.ora-richtext li {
  display: list-item;
  margin: 0.15rem 0;
}
`;

function sanitizeRichTextHtml(html: string): string {
  // Rich text originates from the editor, but sanitize before innerHTML render.
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());

  doc.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        continue;
      }

      const isUrlAttr = name === "href" || name === "src" || name === "xlink:href";
      if (isUrlAttr && /^\s*javascript:/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

function parseUrlSafe(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function getYoutubeId(raw: string): string | null {
  const parsed = parseUrlSafe(raw);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  if (host.includes("youtu.be")) {
    return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (host.includes("youtube.com")) {
    const fromQuery = parsed.searchParams.get("v");
    if (fromQuery) return fromQuery;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const embedIndex = parts.indexOf("embed");
    if (embedIndex >= 0) return parts[embedIndex + 1] ?? null;
  }
  return null;
}

function getVimeoId(raw: string): string | null {
  const parsed = parseUrlSafe(raw);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (host.includes("player.vimeo.com")) {
    const videoIndex = parts.indexOf("video");
    return videoIndex >= 0 ? (parts[videoIndex + 1] ?? null) : null;
  }
  if (host.includes("vimeo.com")) {
    const candidate = parts[parts.length - 1] ?? "";
    return /^\d+$/.test(candidate) ? candidate : null;
  }
  return null;
}

function resolveVideoSource(
  rawUrl: string,
  options: {
    autoplay: boolean;
    muted: boolean;
    loop: boolean;
    controls: boolean;
    playsInline: boolean;
    background?: boolean;
  },
): { kind: "embed" | "file"; src: string } | null {
  const src = rawUrl.trim();
  if (!src) return null;

  const youtubeId = getYoutubeId(src);
  if (youtubeId) {
    const params = new URLSearchParams({
      autoplay: options.autoplay ? "1" : "0",
      mute: options.muted ? "1" : "0",
      controls: options.controls ? "1" : "0",
      loop: options.loop ? "1" : "0",
      playlist: options.loop ? youtubeId : "",
      playsinline: options.playsInline ? "1" : "0",
      rel: "0",
      modestbranding: "1",
    });
    if (!options.loop) params.delete("playlist");
    return { kind: "embed", src: `https://www.youtube.com/embed/${youtubeId}?${params.toString()}` };
  }

  const vimeoId = getVimeoId(src);
  if (vimeoId) {
    const params = new URLSearchParams({
      autoplay: options.autoplay ? "1" : "0",
      muted: options.muted ? "1" : "0",
      loop: options.loop ? "1" : "0",
      controls: options.controls ? "1" : "0",
      background: options.background ? "1" : "0",
    });
    return { kind: "embed", src: `https://player.vimeo.com/video/${vimeoId}?${params.toString()}` };
  }

  return { kind: "file", src };
}

// ─── Image upload field helper ───────────────────────────────────────────────

const imageUploadField = {
  type: "custom" as const,
  label: "Image",
  render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: string) => void; readOnly?: boolean }) => {
    const currentSrc = (value as string) || "";
    const [mode, setMode] = React.useState<"upload" | "url">("upload");
    const [urlInput, setUrlInput] = React.useState("");

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

    const triggerUpload = () => {
      if (readOnly) return;
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*";
      inp.onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) uploadFile(f); };
      inp.click();
    };

    const handleUrlApply = () => {
      const trimmed = urlInput.trim();
      if (trimmed) {
        onChange(trimmed);
        setUrlInput("");
      }
    };

    if (currentSrc) {
      return React.createElement("div", {
        style: { position: "relative", cursor: readOnly ? "default" : "pointer" },
        onClick: () => { if (mode === "upload") triggerUpload(); },
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

    return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      // Mode toggle: Upload vs URL
      React.createElement("div", { style: { display: "flex", gap: 0 } },
        React.createElement("button", {
          type: "button",
          onClick: () => setMode("upload"),
          style: {
            flex: 1, height: 30, border: "1px solid #E8E4DF", fontSize: 11, cursor: "pointer",
            background: mode === "upload" ? "#2C2C2C" : "#F9F7F5",
            color: mode === "upload" ? "#FFF" : "#6B6B6B",
            fontWeight: mode === "upload" ? 600 : 400,
          },
        }, "Upload"),
        React.createElement("button", {
          type: "button",
          onClick: () => setMode("url"),
          style: {
            flex: 1, height: 30, border: "1px solid #E8E4DF", borderLeft: "none", fontSize: 11, cursor: "pointer",
            background: mode === "url" ? "#2C2C2C" : "#F9F7F5",
            color: mode === "url" ? "#FFF" : "#6B6B6B",
            fontWeight: mode === "url" ? 600 : 400,
          },
        }, "URL"),
      ),
      mode === "url"
        ? React.createElement("div", { style: { display: "flex", gap: 4 } },
            React.createElement("input", {
              type: "text",
              value: urlInput,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setUrlInput(e.target.value),
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") handleUrlApply(); },
              placeholder: "https://example.com/image.jpg",
              style: { flex: 1, height: 34, border: "1px solid #E8E4DF", padding: "0 8px", fontSize: 12, color: "#2C2C2C" },
            }),
            React.createElement("button", {
              type: "button",
              onClick: handleUrlApply,
              style: { height: 34, padding: "0 12px", background: "#2C2C2C", color: "#FFF", border: "none", fontSize: 11, cursor: "pointer" },
            }, "Apply"),
          )
        : React.createElement("div", {
            onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (readOnly) return; const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) uploadFile(f); },
            onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
            onClick: triggerUpload,
            style: { border: "2px dashed #D4CFC8", padding: "20px 12px", textAlign: "center" as const, cursor: "pointer", background: "#F9F7F5", fontSize: 13, color: "#6B6B6B" },
          },
            React.createElement("div", { style: { fontSize: 20, marginBottom: 4 } }, "📁"),
            React.createElement("div", null, "Drop image or click to upload"),
          ),
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
    sectionId: createFreeInputField("Section ID", "", [], "Anchor target for links (example: hero or features).", "hero"),
    bgMode: createToggleField("Background Mode", [
      { label: "Solid", value: "solid" },
      { label: "Gradient", value: "gradient" },
    ], "Use a solid color or a two-color gradient."),
    bgColor: createCustomSelectField("Background Color", ORA_SOLID_BG_OPTIONS),
    gradientFrom: createCustomSelectField("Gradient Color 1", ORA_GRADIENT_OPTIONS),
    gradientTo: createCustomSelectField("Gradient Color 2", ORA_GRADIENT_OPTIONS),
    gradientDirection: createCustomSelectField("Gradient Direction", [
      { label: "Top -> Bottom", value: "to bottom" },
      { label: "Bottom -> Top", value: "to top" },
      { label: "Left -> Right", value: "to right" },
      { label: "Right -> Left", value: "to left" },
      { label: "Top Left -> Bottom Right", value: "to bottom right" },
      { label: "Top Right -> Bottom Left", value: "to bottom left" },
    ]),
    bgMediaType: createToggleField("Background Media", [
      { label: "None", value: "none" },
      { label: "Image", value: "image" },
      { label: "Video", value: "video" },
    ], "Section can use either image or video, never both."),
    bgImage: imageUploadField,
    bgPosition: createCustomSelectField("Image Position", [
      { label: "Center", value: "center center" },
      { label: "Top", value: "center top" },
      { label: "Bottom", value: "center bottom" },
      { label: "Top Left", value: "left top" },
      { label: "Top Right", value: "right top" },
      { label: "Center Left", value: "left center" },
      { label: "Center Right", value: "right center" },
      { label: "Bottom Left", value: "left bottom" },
      { label: "Bottom Right", value: "right bottom" },
    ], "Which part of the image stays visible when cropped by cover."),
    bgVideoUrl: { type: "text", label: "Background Video URL" },
    bgVideoPosition: createCustomSelectField("Video Position", [
      { label: "Center", value: "center center" },
      { label: "Top", value: "center top" },
      { label: "Bottom", value: "center bottom" },
      { label: "Top Left", value: "left top" },
      { label: "Top Right", value: "right top" },
      { label: "Center Left", value: "left center" },
      { label: "Center Right", value: "right center" },
      { label: "Bottom Left", value: "left bottom" },
      { label: "Bottom Right", value: "right bottom" },
    ], "Which part of the video stays visible when cropped by cover."),
    bgVideoAutoplay: createToggleField("Video Autoplay", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    bgVideoLoop: createToggleField("Video Loop", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    bgVideoSound: createToggleField("Video Sound", [{ label: "Off", value: "off" }, { label: "On", value: "on" }], "Background videos default to muted."),
    bgVideoControls: createToggleField("Video Controls", [{ label: "Hidden", value: "no" }, { label: "Visible", value: "yes" }]),
    bgVideoFit: createCustomSelectField("Video Fit", [{ label: "Cover", value: "cover" }, { label: "Contain", value: "contain" }]),
    bgVideoPoster: imageUploadField,
    bgOpacity: createCustomSelectField("Background Opacity", [
      { label: "100%", value: "1" }, { label: "90%", value: "0.9" }, { label: "75%", value: "0.75" },
      { label: "50%", value: "0.5" }, { label: "25%", value: "0.25" }, { label: "10%", value: "0.1" },
    ]),
    textColor: createCustomSelectField("Text Color", ORA_TEXT_COLOR_OPTIONS),
    minHeight: createCustomSelectField("Min Height", SECTION_HEIGHT_OPTIONS),
    maxHeight: createCustomSelectField("Max Height", SECTION_HEIGHT_OPTIONS),
    contentAlign: createCustomSelectField("Vertical Align", [
      { label: "Top", value: "flex-start" },
      { label: "Center", value: "center" },
      { label: "Bottom", value: "flex-end" },
    ]),
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    sectionId: "",
    bgMode: "solid",
    bgMediaType: "image",
    bgColor: "transparent",
    gradientFrom: "#1A1A1A",
    gradientTo: "#2C2C2C",
    gradientDirection: "to bottom",
    bgImage: "",
    bgPosition: "center center",
    bgVideoUrl: "",
    bgVideoPosition: "center center",
    bgVideoAutoplay: "yes",
    bgVideoLoop: "yes",
    bgVideoSound: "off",
    bgVideoControls: "no",
    bgVideoFit: "cover",
    bgVideoPoster: "",
    bgOpacity: "1",
    textColor: "auto",
    minHeight: "auto",
    maxHeight: "auto",
    contentAlign: "flex-start",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  resolveFields: (data, params) => {
    const nextFields = { ...(params.fields ?? {}) };

    const setVisible = (key: string, visible: boolean) => {
      const field = nextFields[key];
      if (!field) return;
      nextFields[key] = { ...field, visible };
    };

    const resolvedData = (data as Record<string, unknown>) ?? {};
    const props = ((resolvedData.props as Record<string, unknown> | undefined) ?? resolvedData);
    const mode = (props.bgMode as string) || "solid";
    const media = (props.bgMediaType as string) || "image";

    // Gradient-specific controls
    setVisible("gradientFrom", mode === "gradient");
    setVisible("gradientTo", mode === "gradient");
    setVisible("gradientDirection", mode === "gradient");
    setVisible("bgColor", mode !== "gradient");

    // Media-specific controls (image vs video vs none)
    setVisible("bgImage", media === "image");
    setVisible("bgPosition", media === "image");
    setVisible("bgVideoUrl", media === "video");
    setVisible("bgVideoPosition", media === "video");
    setVisible("bgVideoAutoplay", media === "video");
    setVisible("bgVideoLoop", media === "video");
    setVisible("bgVideoSound", media === "video");
    setVisible("bgVideoControls", media === "video");
    setVisible("bgVideoFit", media === "video");
    setVisible("bgVideoPoster", media === "video");
    setVisible("bgOpacity", media !== "none");

    return nextFields;
  },
  render: (props) => {
    const {
      bgMode,
      bgMediaType,
      sectionId,
      bgColor,
      gradientFrom,
      gradientTo,
      gradientDirection,
      bgImage,
      bgVideoUrl,
      bgVideoAutoplay,
      bgVideoLoop,
      bgVideoSound,
      bgVideoControls,
      bgVideoFit,
      bgVideoPoster,
      bgPosition,
      bgVideoPosition,
      bgOpacity,
      textColor,
      minHeight,
      maxHeight,
      contentAlign,
    } = props;
    const mode = (bgMode as string) || "solid";
    const mediaType = (bgMediaType as string) || "image";
    const sectionIdValue = String(sectionId ?? "").trim().replace(/^#/, "");
    const bg = ((bgColor as string) || "transparent").trim().toLowerCase();
    const from = (gradientFrom as string) || "#1A1A1A";
    const to = (gradientTo as string) || "#2C2C2C";
    const direction = (gradientDirection as string) || "to bottom";
    const gradientValue = `linear-gradient(${direction}, ${from}, ${to})`;
    const img = mediaType === "image" ? ((bgImage as string) || "") : "";
    const videoPoster = mediaType === "video" ? ((bgVideoPoster as string) || "") : "";
    const videoResolved = mediaType === "video"
      ? resolveVideoSource((bgVideoUrl as string) || "", {
        autoplay: (bgVideoAutoplay as string) !== "no",
        muted: (bgVideoSound as string) !== "on",
        loop: (bgVideoLoop as string) !== "no",
        controls: (bgVideoControls as string) === "yes",
        playsInline: true,
        background: true,
      })
      : null;
    const videoFit = ((bgVideoFit as string) || "cover") as React.CSSProperties["objectFit"];
    const hasMedia = Boolean(img) || Boolean(videoResolved);
    const parsedOpacity = Number.parseFloat(String(bgOpacity ?? ""));
    const opacity = Number.isFinite(parsedOpacity)
      ? Math.max(0, Math.min(1, parsedOpacity))
      : 1;
    const hasSolidTint = bg !== "transparent" && bg !== "none" && bg !== "";
    const hasGradientTint = mode === "gradient";
    const shouldRenderTintOverlay = hasMedia && (hasSolidTint || hasGradientTint) && (1 - opacity) > 0;
    const isDark = bg === "#1A1A1A" || bg === "#2C2C2C" || bg === "#B8956B" || (mode === "gradient" && from === "#1A1A1A" && to === "#2C2C2C");
    const color = textColor === "auto" ? (isDark ? "#FFFFFF" : undefined) : (textColor as string);

    const outerStyle: React.CSSProperties = {
      position: "relative",
      overflow: "hidden",
      width: "100vw",
      marginLeft: "calc(-50vw + 50%)",
      boxSizing: "border-box" as const,
    };
    if (!hasMedia) {
      if (mode === "gradient") {
        outerStyle.backgroundImage = gradientValue;
      } else {
        outerStyle.backgroundColor = bg;
      }
    }
    if (color) outerStyle.color = color;
    const mh = minHeight as string;
    const xh = maxHeight as string;
    if (mh && mh !== "auto") outerStyle.minHeight = mh;
    if (xh && xh !== "auto") outerStyle.maxHeight = xh;
    // In editor, fixed-height heroes (e.g. 100vh/100vh) need explicit height so
    // absolutely positioned children anchor to the true section bounds.
    if (mh && mh !== "auto" && xh && xh !== "auto" && mh === xh) {
      outerStyle.height = mh;
    }
    outerStyle.display = "flex";
    outerStyle.flexDirection = "column";
    const alignRaw = (contentAlign as string) || "flex-start";
    const alignContentValue: React.CSSProperties["alignContent"] =
      alignRaw === "center" ? "center" : alignRaw === "flex-end" ? "end" : "start";

    // Video poster state management: show poster until video fires "playing" event
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const [videoReady, setVideoReady] = React.useState(false);

    return styledRender(props, React.createElement("section", { id: sectionIdValue || undefined, style: outerStyle },
      // Background image overlay
      img ? React.createElement("div", { style: {
        position: "absolute", inset: 0, zIndex: 0,
        backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: (bgPosition as string) || "center center",
        opacity,
      }}) : null,
      // Video poster image (shows until video is playing)
      videoPoster && videoResolved && !videoReady ? React.createElement("div", { style: {
        position: "absolute", inset: 0, zIndex: 1,
        backgroundImage: `url(${videoPoster})`, backgroundSize: "cover", backgroundPosition: "center center",
        opacity,
        transition: "opacity 0.5s ease",
      }}) : null,
      // Background video overlay
      videoResolved ? React.createElement("div", { style: { position: "absolute", inset: 0, zIndex: videoReady || !videoPoster ? 1 : 0, opacity } },
        videoResolved.kind === "embed"
          ? React.createElement("iframe", {
            src: videoResolved.src,
            title: "Section background video",
            allow: "autoplay; fullscreen; picture-in-picture",
            style: { width: "100%", height: "100%", border: "none", pointerEvents: "none" },
            onLoad: () => setVideoReady(true),
          })
          : React.createElement("video", {
            ref: videoRef,
            src: videoResolved.src,
            autoPlay: (bgVideoAutoplay as string) !== "no",
            loop: (bgVideoLoop as string) !== "no",
            muted: (bgVideoSound as string) !== "on",
            controls: (bgVideoControls as string) === "yes",
            playsInline: true,
            onPlaying: () => setVideoReady(true),
            style: { width: "100%", height: "100%", objectFit: videoFit, objectPosition: (bgVideoPosition as string) || "center center" },
          }),
      ) : null,
      // Color/gradient overlay on top of media. Only render if there is an actual tint.
      shouldRenderTintOverlay ? React.createElement("div", { style: {
        position: "absolute",
        inset: 0,
        zIndex: 2,
        backgroundImage: hasGradientTint ? gradientValue : undefined,
        backgroundColor: hasSolidTint ? bg : undefined,
        opacity: 1 - opacity,
      }}) : null,
      // Content zone fills section height and uses alignContent for top/center/bottom placement
      React.createElement("div", {
        style: {
          position: "relative",
          zIndex: 3,
          width: "100%",
          flex: 1,
          minHeight: "100%",
          display: "grid",
          alignContent: alignContentValue,
        },
      },
        React.createElement(DropZone, { zone: "section-content", disallow: ["Section"] })
      )
    ));
  },
};

// ─── Columns ─────────────────────────────────────────────────────────────────
// Variable number of columns. Each column has its own width / padding / margin
// / vertical-align / horizontal-align controls and its own DropZone
// (`column-0`, `column-1`, …).

const SPACING_OPTS = [
  { label: "0", value: "0" },
  { label: "4px", value: "4px" },
  { label: "8px", value: "8px" },
  { label: "12px", value: "12px" },
  { label: "16px", value: "16px" },
  { label: "24px", value: "24px" },
  { label: "32px", value: "32px" },
  { label: "48px", value: "48px" },
  { label: "64px", value: "64px" },
];

const Columns: Config["components"][string] = {
  label: "Columns",
  fields: {
    gap: createCustomSelectField("Gap", [
      { label: "None", value: "0" }, { label: "Small", value: "sm" }, { label: "Medium", value: "md" }, { label: "Large", value: "lg" },
    ]),
    columnList: {
      type: "array",
      label: "Columns",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `Column ${(i ?? 0) + 1} — ${(item?.width as string) || "auto"}`,
      defaultItemProps: {
        width: "1fr",
        paddingY: "0",
        paddingX: "0",
        marginY: "0",
        align: "flex-start",
        justify: "stretch",
      },
      arrayFields: {
        width: createCustomSelectField("Width", [
          { label: "Auto / equal (1fr)", value: "1fr" },
          { label: "2x share (2fr)", value: "2fr" },
          { label: "3x share (3fr)", value: "3fr" },
          { label: "25%", value: "25%" },
          { label: "33%", value: "33.333%" },
          { label: "50%", value: "50%" },
          { label: "66%", value: "66.666%" },
          { label: "75%", value: "75%" },
          { label: "100% (full)", value: "100%" },
        ]),
        paddingY: createCustomSelectField("Padding Y", SPACING_OPTS),
        paddingX: createCustomSelectField("Padding X", SPACING_OPTS),
        marginY: createCustomSelectField("Margin Y", SPACING_OPTS),
        align: createCustomSelectField("Vertical Align", [
          { label: "Top", value: "flex-start" },
          { label: "Center", value: "center" },
          { label: "Bottom", value: "flex-end" },
          { label: "Space between", value: "space-between" },
        ]),
        justify: createCustomSelectField("Horizontal Align", [
          { label: "Stretch (full width)", value: "stretch" },
          { label: "Left", value: "flex-start" },
          { label: "Center", value: "center" },
          { label: "Right", value: "flex-end" },
        ]),
      },
    },
    ...spacingBorderFields,
  },
  defaultProps: {
    gap: "md",
    columnList: [
      { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
      { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
    ],
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const list = (props.columnList as Array<Record<string, string>>) ?? [];
    const cols = list.length > 0 ? list : [
      { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
      { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
    ];
    const gapPx: Record<string, string> = { "0": "0", sm: "16px", md: "24px", lg: "40px" };
    const gap = gapPx[props.gap as string] ?? gapPx.md;

    // Build grid-template-columns from per-column widths.
    const gridTemplate = cols
      .map((c) => (c.width && c.width !== "" ? c.width : "1fr"))
      .join(" ");

    return styledRender(
      props,
      React.createElement(
        "div",
        {
          className: "grid",
          style: {
            gridTemplateColumns: gridTemplate,
            gap,
          },
        },
        ...cols.map((c, i) =>
          React.createElement(
            "div",
            {
              key: i,
              style: {
                display: "flex",
                flexDirection: "column",
                justifyContent: c.align || "flex-start",
                alignItems: c.justify || "stretch",
                paddingTop: c.paddingY || "0",
                paddingBottom: c.paddingY || "0",
                paddingLeft: c.paddingX || "0",
                paddingRight: c.paddingX || "0",
                marginTop: c.marginY || "0",
                marginBottom: c.marginY || "0",
                minHeight: "60px",
                minWidth: 0,
              },
            },
            React.createElement(DropZone, { zone: `column-${i}`, disallow: ["Section"] })
          )
        )
      )
    );
  },
};


// ─── Container — Content width constraint with DropZone ──────────────────────

const CONTAINER_BG_COLORS = ORA_SOLID_BG_OPTIONS;

const CONTAINER_GRADIENT_COLORS = ORA_GRADIENT_OPTIONS;

const Container: Config["components"][string] = {
  label: "Container",
  fields: {
    maxWidth: createCustomSelectField("Max Width", [
      { label: "Small (720px)", value: "720" }, { label: "Medium (960px)", value: "960" },
      { label: "Large (1200px)", value: "1200" }, { label: "XL (1400px)", value: "1400" },
      { label: "Full", value: "full" },
    ]),
    bgMode: createToggleField("Background Mode", [
      { label: "Solid", value: "solid" },
      { label: "Gradient", value: "gradient" },
    ], "Use a solid color or a two-color gradient."),
    bgColor: createCustomSelectField("Background Color", CONTAINER_BG_COLORS),
    gradientFrom: createCustomSelectField("Gradient Color 1", CONTAINER_GRADIENT_COLORS),
    gradientTo: createCustomSelectField("Gradient Color 2", CONTAINER_GRADIENT_COLORS),
    gradientDirection: createCustomSelectField("Gradient Direction", [
      { label: "Top → Bottom", value: "to bottom" },
      { label: "Bottom → Top", value: "to top" },
      { label: "Left → Right", value: "to right" },
      { label: "Right → Left", value: "to left" },
      { label: "Top Left → Bottom Right", value: "to bottom right" },
      { label: "Top Right → Bottom Left", value: "to bottom left" },
    ]),
    textColor: createCustomSelectField("Text Color", ORA_TEXT_COLOR_OPTIONS),
    contentAlign: createCustomSelectField("Vertical Align", [
      { label: "Top", value: "flex-start" },
      { label: "Center", value: "center" },
      { label: "Bottom", value: "flex-end" },
    ]),
    ...spacingBorderFields,
  },
  defaultProps: {
    maxWidth: "1200",
    bgMode: "solid",
    bgColor: "transparent",
    gradientFrom: "#F9F7F5",
    gradientTo: "#EBE7E2",
    gradientDirection: "to bottom",
    textColor: "auto",
    contentAlign: "flex-start",
    ...spacingBorderDefaults,
  },
  resolveFields: (data, params) => {
    const nextFields = { ...(params.fields ?? {}) };
    const setVisible = (key: string, visible: boolean) => {
      const field = nextFields[key];
      if (!field) return;
      nextFields[key] = { ...field, visible };
    };
    const resolvedData = (data as Record<string, unknown>) ?? {};
    const props = ((resolvedData.props as Record<string, unknown> | undefined) ?? resolvedData);
    const mode = (props.bgMode as string) || "solid";
    setVisible("bgColor", mode !== "gradient");
    setVisible("gradientFrom", mode === "gradient");
    setVisible("gradientTo", mode === "gradient");
    setVisible("gradientDirection", mode === "gradient");
    return nextFields;
  },
  render: (props) => {
    const mw = (props.maxWidth as string) === "full" ? "100%" : `${props.maxWidth}px`;
    const mode = (props.bgMode as string) || "solid";
    const bgColor = (props.bgColor as string) || "transparent";
    const from = (props.gradientFrom as string) || "#F9F7F5";
    const to = (props.gradientTo as string) || "#EBE7E2";
    const direction = (props.gradientDirection as string) || "to bottom";
    const textColor = (props.textColor as string) || "auto";
    const contentAlign = (props.contentAlign as string) || "flex-start";

    const bgStyle: React.CSSProperties = {};
    if (mode === "gradient") {
      bgStyle.backgroundImage = `linear-gradient(${direction}, ${from}, ${to})`;
    } else if (bgColor !== "transparent") {
      bgStyle.backgroundColor = bgColor;
    }
    if (textColor !== "auto") bgStyle.color = textColor;

    return styledRender(props, React.createElement("div", {
      style: {
        ...bgStyle,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: contentAlign,
        maxWidth: mw,
        marginLeft: "auto",
        marginRight: "auto",
        padding: mw === "100%" ? 0 : "0 16px",
      },
    },
      React.createElement(DropZone, { zone: "container-content", disallow: ["Section"] })
    ));
  },
};

// ─── Quote/Blockquote — Styled quote with accent border ──────────────────────

const Quote: Config["components"][string] = {
  label: "Quote",
  fields: {
    text: { type: "textarea", label: "Quote Text", contentEditable: true },
    accentColor: makeColorField("Line Color", "#8CC9E8"),
    accentWidth: makeSliderField("Line Width", 0, 10, "px", "Thickness of the vertical quote line."),
    ...typographyFields,
    fontStyle: { type: "radio", label: "Style", options: [
      { label: "Italic", value: "italic" }, { label: "Normal", value: "normal" },
    ]},
    ...spacingBorderFields,
  },
  defaultProps: {
    text: "Why choose between vibrancy and tranquility? At Bayn, you don't have to.",
    accentColor: "#8CC9E8",
    accentWidth: "2",
    ...typographyDefaultsText,
    fontStyle: "normal",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const typoCSS = typographyPropsToCSS(props);
    const accent = props.accentColor as string;
    const accentWidth = Number(props.accentWidth) || 0;
    const style: React.CSSProperties = {
      ...typoCSS,
      fontStyle: props.fontStyle as string,
      borderLeft: accentWidth > 0 && accent !== "transparent" ? `${accentWidth}px solid ${accent}` : undefined,
      paddingLeft: accentWidth > 0 && accent !== "transparent" ? "16px" : undefined,
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
    ...typographyFields,
    color: { type: "select", label: "Color", options: [
      { label: "Gold", value: "#B8956B" }, { label: "Charcoal", value: "#2C2C2C" },
      { label: "White", value: "#FFFFFF" }, { label: "Inherit", value: "inherit" },
    ]},
    underline: { type: "radio", label: "Underline", options: [
      { label: "Yes", value: "underline" }, { label: "No", value: "none" },
    ]},
    ...spacingBorderFields,
  },
  defaultProps: {
    text: "Learn more",
    url: "#",
    ...typographyDefaultsText,
    color: "#B8956B",
    underline: "none",
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
    level: createCustomSelectField("Level", [
      { label: "H1", value: "h1" },
      { label: "H2", value: "h2" },
      { label: "H3", value: "h3" },
      { label: "H4", value: "h4" },
      { label: "H5", value: "h5" },
      { label: "H6", value: "h6" },
    ], "Semantic heading tag."),
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
    content: {
      type: "richtext",
      label: "Content",
      contentEditable: true,
      // Keep v1 simple: basic formatting only; skip link support for now.
      options: {
        link: false,
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        textAlign: false,
      },
    },
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: { content: "<p>Enter your text here.</p>", ...typographyDefaultsText, ...spacingBorderDefaults },
  render: (props) => {
    const typoCSS = typographyPropsToCSS(props);
    const rawContent = props.content;

    if (typeof rawContent === "string") {
      const safeHtml = sanitizeRichTextHtml(rawContent);
      return styledRender(props, React.createElement("div", {
        className: "ora-richtext",
        style: { ...typoCSS },
      },
      React.createElement("style", null, RICH_TEXT_EMBEDDED_STYLES),
      React.createElement("div", { dangerouslySetInnerHTML: { __html: safeHtml } })));
    }

    return styledRender(props, React.createElement("div", {
      className: "ora-richtext",
      style: { ...typoCSS },
    }, rawContent as React.ReactNode));
  },
};

// ─── Button ──────────────────────────────────────────────────────────────────
// Full customization: typography, icon (left/right), bg, border, padding, margin.

const BUTTON_FIELD_COLORS = {
  border: "#E8E4DF",
  text: "#2C2C2C",
  muted: "#6B6B6B",
  bg: "#FFFFFF",
  bgMuted: "#F9F7F5",
  active: "#1A73E8",
  activeBg: "#EEF4FF",
};

type ButtonSelectOption = {
  label: string;
  value: string;
};

function renderButtonFieldTitle(title: string, description?: string) {
  return React.createElement("div", {
    style: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 },
  },
    React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: BUTTON_FIELD_COLORS.text } }, title),
    description
      ? React.createElement("div", { style: { fontSize: 11, color: BUTTON_FIELD_COLORS.muted } }, description)
      : null,
  );
}

function ButtonCustomSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: ButtonSelectOption[];
  placeholder?: string;
}) {
  const { value, onChange, options, placeholder } = props;
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  React.useEffect(() => {
    if (!open) return;

    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return React.createElement("div", { ref: rootRef, style: { position: "relative" } },
    React.createElement("button", {
      type: "button",
      onClick: () => setOpen((current) => !current),
      style: {
        width: "100%",
        minHeight: 36,
        border: `1px solid ${BUTTON_FIELD_COLORS.border}`,
        background: BUTTON_FIELD_COLORS.bg,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: selected ? BUTTON_FIELD_COLORS.text : BUTTON_FIELD_COLORS.muted,
        cursor: "pointer",
      },
    },
      React.createElement("span", null, selected?.label ?? placeholder ?? "Select"),
      React.createElement("span", { style: { fontSize: 10, color: BUTTON_FIELD_COLORS.muted } }, open ? "▴" : "▾"),
    ),
    open
      ? React.createElement("div", {
          style: {
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            border: `1px solid ${BUTTON_FIELD_COLORS.border}`,
            background: BUTTON_FIELD_COLORS.bg,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            maxHeight: 220,
            overflowY: "auto",
          },
        },
          ...options.map((option) => {
            const isActive = option.value === value;
            return React.createElement("button", {
              key: option.value,
              type: "button",
              onClick: () => {
                onChange(option.value);
                setOpen(false);
              },
              style: {
                width: "100%",
                border: "none",
                borderBottom: `1px solid ${BUTTON_FIELD_COLORS.border}`,
                background: isActive ? BUTTON_FIELD_COLORS.activeBg : BUTTON_FIELD_COLORS.bg,
                color: isActive ? BUTTON_FIELD_COLORS.active : BUTTON_FIELD_COLORS.text,
                textAlign: "left",
                padding: "10px 12px",
                fontSize: 12,
                cursor: "pointer",
              },
            }, option.label);
          }),
        )
      : null,
  );
}

function makeCustomSelectField(
  title: string,
  options: ButtonSelectOption[],
  description?: string,
  placeholder?: string,
) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
      React.createElement("div", null,
        renderButtonFieldTitle(title, description),
        React.createElement(ButtonCustomSelect, {
          value: (value as string) || "",
          onChange,
          options,
          placeholder,
        }),
      ),
  };
}

function makeFreeInputField(
  title: string,
  suffix: string,
  presets: string[] = [],
  description?: string,
) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) => {
      const current = (value as string) || "";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderButtonFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", gap: 0, width: "100%" } },
          React.createElement("input", {
            type: "text",
            value: current,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            placeholder: suffix ? `e.g. 16${suffix}` : undefined,
            style: {
              flex: 1,
              minHeight: 36,
              border: `1px solid ${BUTTON_FIELD_COLORS.border}`,
              padding: "0 10px",
              fontSize: 12,
              color: BUTTON_FIELD_COLORS.text,
              background: BUTTON_FIELD_COLORS.bg,
            },
          }),
          suffix
            ? React.createElement("span", {
                style: {
                  minWidth: 38,
                  minHeight: 36,
                  borderTop: `1px solid ${BUTTON_FIELD_COLORS.border}`,
                  borderRight: `1px solid ${BUTTON_FIELD_COLORS.border}`,
                  borderBottom: `1px solid ${BUTTON_FIELD_COLORS.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  color: BUTTON_FIELD_COLORS.muted,
                  background: BUTTON_FIELD_COLORS.bgMuted,
                },
              }, suffix)
            : null,
        ),
        presets.length > 0
          ? React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
              ...presets.map((preset) =>
                React.createElement("button", {
                  key: preset,
                  type: "button",
                  onClick: () => onChange(preset),
                  style: {
                    border: `1px solid ${current === preset ? BUTTON_FIELD_COLORS.active : BUTTON_FIELD_COLORS.border}`,
                    background: current === preset ? BUTTON_FIELD_COLORS.activeBg : BUTTON_FIELD_COLORS.bg,
                    color: current === preset ? BUTTON_FIELD_COLORS.active : BUTTON_FIELD_COLORS.text,
                    padding: "4px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                  },
                }, preset),
              ),
            )
          : null,
      );
    },
  };
}

// Shared color-picker custom field factory used only in Button
function makeColorField(title: string, placeholder = "#000000", description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) => {
      const val = (value as string) || "";
      const swatchColor = val || placeholder || "#000000";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderButtonFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
          // Visible swatch div — clicking it opens the hidden native color input
          React.createElement("div", {
            style: {
              position: "relative",
              width: 32,
              height: 32,
              borderRadius: 2,
              border: `1px solid ${BUTTON_FIELD_COLORS.border}`,
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
            style: { flex: 1, height: 36, border: `1px solid ${BUTTON_FIELD_COLORS.border}`, padding: "0 8px", fontSize: 12 },
          }),
        ),
      );
    },
  };
}

// Slider custom field factory
function makeSliderField(title: string, min: number, max: number, unit = "px", description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) => {
      const num = Number(value) || 0;
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
        renderButtonFieldTitle(title, description),
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

// Number stepper with +/- buttons (4-side padding)
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
        renderButtonFieldTitle("Padding", "Adjust each side with +/- controls."),
        React.createElement("div", {
          style: { background: "#F9F7F5", border: `1px solid ${BUTTON_FIELD_COLORS.border}`, padding: "8px", display: "flex", flexDirection: "column", gap: 6 },
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

function makeVerticalStepperField(title: string, description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: {
      value: unknown;
      onChange: (v: { marginTop: string; marginBottom: string }) => void;
    }) => {
      const current = (value as { marginTop?: string; marginBottom?: string }) ?? {};
      const nextValue = {
        marginTop: current.marginTop ?? "0",
        marginBottom: current.marginBottom ?? "0",
      };
      const cell = (key: "marginTop" | "marginBottom", label: string) => {
        const numeric = Number(nextValue[key]) || 0;
        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
          React.createElement("span", { style: { fontSize: 11, color: BUTTON_FIELD_COLORS.muted } }, label),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
            React.createElement("button", {
              type: "button",
              onClick: () => onChange({ ...nextValue, [key]: String(Math.max(0, numeric - 4)) }),
              style: { width: 26, height: 26, border: `1px solid ${BUTTON_FIELD_COLORS.border}`, background: BUTTON_FIELD_COLORS.bgMuted, cursor: "pointer" },
            }, "−"),
            React.createElement("span", { style: { minWidth: 28, textAlign: "center", fontSize: 12 } }, `${numeric}px`),
            React.createElement("button", {
              type: "button",
              onClick: () => onChange({ ...nextValue, [key]: String(numeric + 4) }),
              style: { width: 26, height: 26, border: `1px solid ${BUTTON_FIELD_COLORS.border}`, background: BUTTON_FIELD_COLORS.bgMuted, cursor: "pointer" },
            }, "+"),
          ),
        );
      };
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderButtonFieldTitle(title, description),
        React.createElement("div", { style: { border: `1px solid ${BUTTON_FIELD_COLORS.border}`, background: BUTTON_FIELD_COLORS.bgMuted, padding: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
          cell("marginTop", "Top"),
          cell("marginBottom", "Bottom"),
        ),
      );
    },
  };
}

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

const BUTTON_HOVER_CSS = `
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

const Button: Config["components"][string] = {
  label: "Button",
  fields: {
    // ── Content ────────────────────────────────────────────────────────────
    text: { type: "text", label: "Label Text", contentEditable: true },
    url: { type: "text", label: "URL" },

    // ── Icon ───────────────────────────────────────────────────────────────
    _icon: { type: "object", label: "Icon", objectFields: {
      name: makeCustomSelectField("Icon", BUTTON_ICON_OPTIONS, "Choose a Lucide icon or keep it empty for a text-only button.", "No icon"),
      position: { type: "radio", label: "Position", options: [{ label: "Left", value: "left" }, { label: "Right", value: "right" }] },
      size: makeFreeInputField("Icon Size", "px", ["12", "14", "16", "20", "24"], "Free input supported. Type any pixel size."),
      gap: makeFreeInputField("Gap To Label", "px", ["4px", "6px", "8px", "12px", "16px"], "Space between icon and label."),
    }},

    // ── Typography ─────────────────────────────────────────────────────────
    _typography: { type: "object", label: "Typography", objectFields: {
      fontFamily: makeCustomSelectField("Font Family", [
        { label: "Inherit", value: "inherit" },
        { label: "Sans-serif", value: "sans-serif" },
        { label: "Serif", value: "serif" },
        { label: "Cormorant Garamond", value: "'Cormorant Garamond', serif" },
        { label: "Playfair Display", value: "'Playfair Display', serif" },
        { label: "Inter", value: "'Inter', sans-serif" },
        { label: "Montserrat", value: "'Montserrat', sans-serif" },
      ], "Reusable custom dropdown, not the browser native select."),
      fontWeight: makeCustomSelectField("Font Weight", [
        { label: "Light (300)", value: "300" },
        { label: "Regular (400)", value: "400" },
        { label: "Medium (500)", value: "500" },
        { label: "SemiBold (600)", value: "600" },
        { label: "Bold (700)", value: "700" },
      ]),
      fontSize: makeFreeInputField("Font Size", "px", ["12px", "13px", "14px", "16px", "18px", "20px"], "Type any value, not just presets."),
      letterSpacing: makeFreeInputField("Letter Spacing", "", ["normal", "0.05em", "0.1em", "0.15em", "0.2em"]),
      textTransform: makeCustomSelectField("Text Transform", [
        { label: "None", value: "none" },
        { label: "UPPERCASE", value: "uppercase" },
        { label: "lowercase", value: "lowercase" },
        { label: "Capitalize", value: "capitalize" },
      ]),
    }},
    textColor: makeColorField("Text Color", "#FFFFFF", "Color used by both label and icon."),
    textColorHover: makeColorField("Hover Text/Icon", "#FFFFFF", "Hover color for both label and icon."),

    // ── Background ─────────────────────────────────────────────────────────
    bgColor: makeColorField("Background Color", "#2C2C2C", "Default button fill."),
    bgColorHover: makeColorField("Hover Background", "#4A4A4A", "Shown when the pointer is over the button."),

    // ── Border ─────────────────────────────────────────────────────────────
    borderColor: makeColorField("Border Color", "#2C2C2C", "Outline color when border size is above 0."),
    borderColorHover: makeColorField("Hover Border", "#2C2C2C", "Border color while hovering."),
    borderSize: makeSliderField("Border Size", 0, 10, "px", "Border thickness."),
    borderRadius: makeSliderField("Border Radius", 0, 100, "px", "Corner roundness."),

    // ── Padding (per-side stepper) ─────────────────────────────────────────
    btnPadding: makePaddingField(),

    // ── Margin (outer) ─────────────────────────────────────────────────────
    _margin: makeVerticalStepperField("Margin", "Outer spacing above and below the button."),

    // ── Layout ─────────────────────────────────────────────────────────────
    fullWidth: { type: "radio", label: "Full Width", options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] },
    alignment: { type: "radio", label: "Alignment", options: [
      { label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" },
    ]},
  },
  defaultProps: {
    text: "Click Me",
    url: "#",
    _icon: { name: "", position: "right", size: "16", gap: "8px" },
    _typography: {
      fontFamily: "inherit",
      fontWeight: "600",
      fontSize: "14px",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
    },
    textColor: "#FFFFFF",
    textColorHover: "#FFFFFF",
    bgColor: "#2C2C2C",
    bgColorHover: "#4A4A4A",
    borderColor: "#2C2C2C",
    borderColorHover: "#2C2C2C",
    borderSize: "0",
    borderRadius: "0",
    btnPadding: { top: 12, right: 24, bottom: 12, left: 24 },
    _margin: { marginTop: "0", marginBottom: "0" },
    fullWidth: "no",
    alignment: "left",
  },
  render: (props) => {
    const icon = (props._icon as Record<string, string>) ?? {};
    const typo = (props._typography as Record<string, string>) ?? {};
    const pad = (props.btnPadding as Record<string, number>) ?? { top: 12, right: 24, bottom: 12, left: 24 };
    const mar = (props._margin as Record<string, string>) ?? {};

    const fw = (props.fullWidth as string) === "yes";
    const alignment = (props.alignment as string) || "left";
    const alignMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };

    const iconName = icon.name || "";
    const iconSize = Number(icon.size) || 16;
    const iconPos = icon.position || "right";
    const iconGap = icon.gap || "8px";
    const LucideIcon = iconName ? ICON_MAP[iconName] : null;

    const textColor = (props.textColor as string) || "#FFFFFF";
    const textColorHover = (props.textColorHover as string) || textColor;
    const bgColor = (props.bgColor as string) || "#2C2C2C";
    const bgColorHover = (props.bgColorHover as string) || bgColor;
    const borderColor = (props.borderColor as string) || "#2C2C2C";
    const borderColorHover = (props.borderColorHover as string) || borderColor;

    const iconEl = LucideIcon
      ? React.createElement(LucideIcon, {
          size: iconSize,
          strokeWidth: 1.5,
        })
      : null;

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
      marginTop: mar.marginTop ? `${mar.marginTop}px` : undefined,
      marginBottom: mar.marginBottom ? `${mar.marginBottom}px` : undefined,
      fontFamily: typo.fontFamily || "inherit",
      fontWeight: typo.fontWeight || "600",
      fontSize: typo.fontSize || "14px",
      letterSpacing: typo.letterSpacing || "normal",
      textTransform: (typo.textTransform || "none") as React.CSSProperties["textTransform"],
      color: textColor,
      backgroundColor: bgColor,
      border: Number(props.borderSize) > 0
        ? `${props.borderSize}px solid ${borderColor}`
        : "none",
      borderRadius: `${props.borderRadius ?? 0}px`,
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

    const wrapStyle: React.CSSProperties = {
      display: "flex",
      justifyContent: alignMap[alignment] || "flex-start",
    };

    return React.createElement("div", { style: wrapStyle },
      React.createElement("style", null, BUTTON_HOVER_CSS),
      React.createElement("a", { href: (props.url as string) || "#", style: btnStyle, className: "ora-builder-button" },
        iconPos === "left" ? iconEl : null,
        React.createElement("span", null, props.text as string),
        iconPos === "right" ? iconEl : null,
      )
    );
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

// ─── Video ───────────────────────────────────────────────────────────────────

const VIDEO_RATIO_OPTIONS = [
  { label: "16:9", value: "16:9" },
  { label: "4:3", value: "4:3" },
  { label: "1:1", value: "1:1" },
  { label: "21:9", value: "21:9" },
];

const Video: Config["components"][string] = {
  label: "Video",
  fields: {
    src: { type: "text", label: "Video URL (file, YouTube, Vimeo)" },
    poster: imageUploadField,
    ratio: createCustomSelectField("Aspect Ratio", VIDEO_RATIO_OPTIONS),
    fit: createCustomSelectField("Fit", [{ label: "Cover", value: "cover" }, { label: "Contain", value: "contain" }]),
    autoplay: createToggleField("Autoplay", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    muted: createToggleField("Muted", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    loop: createToggleField("Loop", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    controls: createToggleField("Controls", [{ label: "Show", value: "yes" }, { label: "Hide", value: "no" }]),
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    src: "",
    poster: "",
    ratio: "16:9",
    fit: "cover",
    autoplay: "no",
    muted: "yes",
    loop: "no",
    controls: "yes",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const source = (props.src as string) || "";
    const ratio = (props.ratio as string) || "16:9";
    const [w, h] = ratio.split(":").map((v) => Number(v) || 1);
    const paddingTop = `${(h / w) * 100}%`;

    const video = resolveVideoSource(source, {
      autoplay: (props.autoplay as string) === "yes",
      muted: (props.muted as string) !== "no",
      loop: (props.loop as string) === "yes",
      controls: (props.controls as string) !== "no",
      playsInline: true,
    });

    if (!video) {
      return styledRender(props, React.createElement("div", {
        style: {
          border: "1px dashed #D4CFC8",
          background: "#F9F7F5",
          color: "#6B6B6B",
          padding: "18px 12px",
          textAlign: "center",
          fontSize: 12,
        },
      }, "Add a video URL to render this block."));
    }

    return styledRender(props, React.createElement("div", {
      style: { position: "relative", width: "100%", paddingTop, overflow: "hidden" },
    },
      video.kind === "embed"
        ? React.createElement("iframe", {
          src: video.src,
          title: "Embedded video",
          allow: "autoplay; fullscreen; picture-in-picture",
          style: { position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" },
        })
        : React.createElement("video", {
          src: video.src,
          poster: (props.poster as string) || undefined,
          autoPlay: (props.autoplay as string) === "yes",
          muted: (props.muted as string) !== "no",
          loop: (props.loop as string) === "yes",
          controls: (props.controls as string) !== "no",
          playsInline: true,
          style: {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: ((props.fit as string) || "cover") as React.CSSProperties["objectFit"],
          },
        }),
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
// INTERACTIVE COMPONENTS — Need runtime JS state, kept as monolithic blocks
// ═══════════════════════════════════════════════════════════════════════════════

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

const ICON_FEATURE_OPTIONS = Object.keys(ICON_MAP)
  .sort()
  .map((value) => ({
    value,
    label: value
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  }));

function extractIconFeatureLabel(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
  if (depth > 5) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => extractIconFeatureLabel(v, seen, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const rec = value as Record<string, unknown>;
  if ("$$typeof" in rec || "_owner" in rec || "_store" in rec || "memoizedProps" in rec) return "";
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.content === "string") return rec.content;
  if (typeof rec.value === "string") return rec.value;
  if (Array.isArray(rec.children)) return extractIconFeatureLabel(rec.children, seen, depth + 1);
  if (rec.root && typeof rec.root === "object") return extractIconFeatureLabel(rec.root, seen, depth + 1);
  if (Array.isArray(rec.blocks)) return extractIconFeatureLabel(rec.blocks, seen, depth + 1);
  return "";
}

const IconFeatureList: Config["components"][string] = {
  label: "Icon Feature List",
  fields: {
    items: {
      type: "array",
      label: "Features",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${extractIconFeatureLabel(item.label).trim() || "Feature"}`,
      defaultItemProps: {
        sourceType: "lucide",
        icon: "palmtree",
        image: "",
        svgMarkup: "",
        label: "Feature item",
      },
      arrayFields: {
        sourceType: createCustomSelectField("Source", [
          { label: "Lucide", value: "lucide" },
          { label: "Image", value: "image" },
          { label: "SVG Markup", value: "svg" },
        ]),
        icon: createCustomSelectField("Icon", ICON_FEATURE_OPTIONS),
        image: imageUploadField,
        svgMarkup: { type: "textarea", label: "SVG Markup" },
        label: { type: "text", label: "Label", contentEditable: true },
      },
    },
    iconColor: makeColorField("Icon Color", "#2C2C2C"),
    textColor: makeColorField("Text Color", "#2C2C2C"),
    dividerColor: makeColorField("Divider Color", "#D9D6D1"),
    dividerWidth: makeSliderField("Divider Width", 0, 4, "px"),
    itemGap: createFreeInputField(
      "Icon/Text Gap",
      "px",
      ["8px", "12px", "16px", "20px", "24px", "32px", "40px"],
      "Any CSS length works (px, rem, etc).",
      "16px",
    ),
    rowPaddingY: createCustomSelectField("Row Padding", [
      { label: "8px", value: "8px" },
      { label: "12px", value: "12px" },
      { label: "16px", value: "16px" },
      { label: "20px", value: "20px" },
      { label: "24px", value: "24px" },
    ]),
    iconSize: createCustomSelectField("Icon Size", [
      { label: "20px", value: "20" },
      { label: "24px", value: "24" },
      { label: "28px", value: "28" },
      { label: "32px", value: "32" },
      { label: "36px", value: "36" },
      { label: "40px", value: "40" },
    ]),
    strokeWidth: createCustomSelectField("Icon Stroke", [
      { label: "1", value: "1" },
      { label: "1.5", value: "1.5" },
      { label: "2", value: "2" },
    ]),
    textSize: makeFreeInputField("Text Size", "px", ["18px", "20px", "24px", "28px", "32px"]),
    textWeight: createCustomSelectField("Text Weight", [
      { label: "Regular (400)", value: "400" },
      { label: "Medium (500)", value: "500" },
      { label: "SemiBold (600)", value: "600" },
    ]),
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: {
    items: [
      { sourceType: "lucide", icon: "palmtree", image: "", svgMarkup: "", label: "1.2 km of Pristine Beaches" },
      { sourceType: "lucide", icon: "sun", image: "", svgMarkup: "", label: "Beachfront Promenade" },
      { sourceType: "lucide", icon: "building", image: "", svgMarkup: "", label: "55% Green Spaces" },
      { sourceType: "lucide", icon: "waves", image: "", svgMarkup: "", label: "Natural Lagoons & Canals" },
    ],
    iconColor: "#2C2C2C",
    textColor: "#2C2C2C",
    dividerColor: "#D9D6D1",
    dividerWidth: "1",
    itemGap: "16px",
    rowPaddingY: "14px",
    iconSize: "28",
    strokeWidth: "1.5",
    textSize: "20px",
    textWeight: "400",
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const rows = (props.items as Array<Record<string, unknown>>) ?? [];
    const iconSize = Number(props.iconSize) || 28;
    const strokeWidth = parseFloat(props.strokeWidth as string) || 1.5;
    const iconColor = (props.iconColor as string) || "#2C2C2C";
    const textColor = (props.textColor as string) || "#2C2C2C";
    const dividerColor = (props.dividerColor as string) || "#D9D6D1";
    const dividerWidth = Math.max(0, Number(props.dividerWidth) || 0);
    const itemGap = (props.itemGap as string) || "16px";
    const rowPaddingY = (props.rowPaddingY as string) || "14px";
    const textSize = (props.textSize as string) || "20px";
    const textWeight = (props.textWeight as string) || "400";
    const typoCSS = typographyPropsToCSS(props);
    return styledRender(props, React.createElement("div", {
      style: { display: "flex", flexDirection: "column", gap: 0 },
    },
      ...rows.map((row, index) => {
        const sourceType = String(row.sourceType ?? "lucide");
        const key = String(row.icon ?? "star");
        const LabelIcon = ICON_MAP[key] ?? Star;
        const label = extractIconFeatureLabel(row.label)
          .replace(/\s*\n+\s*/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim() || "Feature item";

        const iconNode = sourceType === "image" && typeof row.image === "string" && row.image.trim()
          ? React.createElement("img", {
              src: row.image,
              alt: `${label} icon`,
              style: { width: iconSize, height: iconSize, objectFit: "contain", display: "block" },
            })
          : sourceType === "svg" && typeof row.svgMarkup === "string" && row.svgMarkup.trim()
            ? React.createElement("div", {
                style: { width: iconSize, height: iconSize, display: "inline-flex", alignItems: "center", justifyContent: "center" },
                dangerouslySetInnerHTML: { __html: row.svgMarkup },
              })
            : React.createElement(LabelIcon, { size: iconSize, color: iconColor, strokeWidth });

        return React.createElement("div", {
          key: `${key}-${index}`,
          style: {
            display: "flex",
            alignItems: "center",
            gap: itemGap,
            padding: `${rowPaddingY} 0`,
            borderBottom: dividerWidth > 0 ? `${dividerWidth}px solid ${dividerColor}` : undefined,
          },
        },
        iconNode,
        React.createElement("span", {
          style: {
            ...typoCSS,
            color: textColor,
            fontSize: textSize,
            fontWeight: textWeight,
          },
        }, label));
      }),
    ));
  },
};

const AccordionGroup: Config["components"][string] = {
  label: "Accordion Group",
  fields: {
    heading: { type: "text", label: "Heading", contentEditable: true },
    items: {
      type: "array",
      label: "Items",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${extractIconFeatureLabel(item.title).trim() || "Accordion item"}`,
      defaultItemProps: { title: "Accordion Item", body: "<p>Accordion description</p>" },
      arrayFields: {
        title: { type: "text", label: "Title", contentEditable: true },
        body: {
          type: "richtext",
          label: "Content",
          contentEditable: true,
          options: {
            link: false,
            heading: false,
            blockquote: false,
            code: false,
            codeBlock: false,
            horizontalRule: false,
            textAlign: false,
          },
        },
      },
    },
    defaultOpenIndex: { type: "number", label: "Default Open Index (0-based)", min: 0 },
    headingColor: makeColorField("Heading Color", "#2C2C2C"),
    headingSize: makeFreeInputField("Heading Size", "px", ["36px", "44px", "52px", "60px"]),
    titleColor: makeColorField("Title Color", "#2C2C2C"),
    titleSize: makeFreeInputField("Title Size", "px", ["28px", "36px", "44px", "50px"]),
    bodyColor: makeColorField("Body Color", "#2C2C2C"),
    bodySize: makeFreeInputField("Body Size", "px", ["18px", "20px", "24px", "28px"]),
    bodyIndent: makeFreeInputField("Body Left Indent", "px", ["0px", "8px", "12px", "16px"]),
    dividerColor: makeColorField("Divider Color", "#D9D6D1"),
    dividerWidth: makeSliderField("Divider Width", 0, 4, "px"),
    activeLineColor: makeColorField("Active Line Color", "#8CC9E8"),
    activeLineWidth: makeSliderField("Active Line Width", 0, 6, "px"),
    iconColor: makeColorField("Chevron Color", "#2C2C2C"),
    iconSize: createCustomSelectField("Chevron Size", [
      { label: "20px", value: "20" },
      { label: "24px", value: "24" },
      { label: "26px", value: "26" },
      { label: "30px", value: "30" },
    ]),
    iconStroke: createCustomSelectField("Chevron Stroke", [
      { label: "1", value: "1" },
      { label: "1.5", value: "1.5" },
      { label: "1.75", value: "1.75" },
      { label: "2", value: "2" },
    ]),
    itemPaddingY: createCustomSelectField("Item Padding", [
      { label: "6px", value: "6px" },
      { label: "10px", value: "10px" },
      { label: "14px", value: "14px" },
      { label: "18px", value: "18px" },
    ]),
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: {
    heading: "Why Bayn",
    items: [
      { title: "Strategic Location", body: "<p>Positioned in between Dubai and Abu Dhabi.</p>" },
      { title: "Close Proximity", body: "<p>Minutes away from airports, business hubs, and leisure venues.</p>" },
      { title: "A Masterfully Planned Community", body: "<p>A complete destination with homes, hospitality, and retail.</p>" },
      { title: "55% Open Spaces", body: "<p>Lush green spaces and walkable public realms across the masterplan.</p>" },
      { title: "Waterfront Living for All", body: "<p>An everyday lifestyle shaped by beaches, lagoons, and promenades.</p>" },
    ],
    defaultOpenIndex: 0,
    headingColor: "#2C2C2C",
    headingSize: "60px",
    titleColor: "#2C2C2C",
    titleSize: "50px",
    bodyColor: "#2C2C2C",
    bodySize: "20px",
    bodyIndent: "12px",
    dividerColor: "#D9D6D1",
    dividerWidth: "1",
    activeLineColor: "#8CC9E8",
    activeLineWidth: "3",
    iconColor: "#2C2C2C",
    iconSize: "26",
    iconStroke: "1.75",
    itemPaddingY: "8px",
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const heading = extractIconFeatureLabel(props.heading).trim();
    const rows = (props.items as Array<Record<string, unknown>>) ?? [];
    const defaultOpenIndex = Number(props.defaultOpenIndex) || 0;
    const headingColor = (props.headingColor as string) || "#2C2C2C";
    const headingSize = (props.headingSize as string) || "60px";
    const titleColor = (props.titleColor as string) || "#2C2C2C";
    const titleSize = (props.titleSize as string) || "50px";
    const bodyColor = (props.bodyColor as string) || "#2C2C2C";
    const bodySize = (props.bodySize as string) || "20px";
    const bodyIndent = (props.bodyIndent as string) || "12px";
    const dividerColor = (props.dividerColor as string) || "#D9D6D1";
    const dividerWidth = Math.max(0, Number(props.dividerWidth) || 0);
    const activeLineColor = (props.activeLineColor as string) || "#8CC9E8";
    const activeLineWidth = Math.max(0, Number(props.activeLineWidth) || 0);
    const iconColor = (props.iconColor as string) || titleColor;
    const iconSize = Number(props.iconSize) || 26;
    const iconStroke = parseFloat(props.iconStroke as string) || 1.75;
    const itemPaddingY = (props.itemPaddingY as string) || "8px";
    const typoCSS = typographyPropsToCSS(props);
    const renderBody = (value: unknown) => {
      if (typeof value === "string") {
        const safeHtml = sanitizeRichTextHtml(value);
        return React.createElement("div", {
          className: "ora-richtext",
          style: {
            ...typoCSS,
            color: bodyColor,
            fontSize: bodySize,
            lineHeight: 1.6,
            padding: `8px 0 12px ${bodyIndent}`,
          },
        },
        React.createElement("style", null, RICH_TEXT_EMBEDDED_STYLES),
        React.createElement("div", { dangerouslySetInnerHTML: { __html: safeHtml } }));
      }

      const plain = extractIconFeatureLabel(value).trim();
      return React.createElement("div", {
        style: {
          ...typoCSS,
          color: bodyColor,
          fontSize: bodySize,
          lineHeight: 1.6,
          padding: `8px 0 12px ${bodyIndent}`,
        },
      }, plain);
    };

    return styledRender(props, React.createElement("div", {
      style: { display: "flex", flexDirection: "column", gap: 12 },
    },
      heading
        ? React.createElement("h3", {
            style: {
              margin: 0,
              color: headingColor,
              fontSize: headingSize,
              lineHeight: 1.1,
              fontWeight: 400,
            },
          }, heading)
        : null,
      ...rows.map((row, i) => {
        const open = i === defaultOpenIndex;
        return React.createElement("details", {
          key: `${String(row.title ?? "item")}-${i}`,
          open: open || undefined,
          style: {
            borderBottom: dividerWidth > 0 ? `${dividerWidth}px solid ${dividerColor}` : undefined,
            padding: `${itemPaddingY} 0`,
          },
        },
        React.createElement("summary", {
          style: {
            listStyle: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            color: titleColor,
            fontSize: titleSize,
            lineHeight: 1.25,
            fontWeight: 400,
            padding: "8px 0",
          },
        },
        React.createElement("span", null, extractIconFeatureLabel(row.title).trim()),
        React.createElement(ChevronDown, { size: iconSize, color: iconColor, strokeWidth: iconStroke })),
        React.createElement("div", {
          style: {
            borderBottom: open && activeLineWidth > 0 ? `${activeLineWidth}px solid ${activeLineColor}` : undefined,
          },
        }, renderBody(row.body)));
      }),
    ));
  },
};

// ─── Accordion — Expandable section with DropZone content ────────────────────

const Accordion: Config["components"][string] = {
  label: "Accordion",
  fields: {
    title: { type: "text", label: "Title", contentEditable: true },
    defaultOpen: createCustomSelectField("Default Open", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
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
        React.createElement(DropZone, { zone: "accordion-content", disallow: ["Section"] }),
      ),
    ));
  },
};


// ─── Scroll Indicator ────────────────────────────────────────────────────────
// Absolutely positioned within a Section. Shows an animated arrow + label.
// Set vertical = bottom/top/center and horizontal = left/center/right.

const ScrollIndicator: Config["components"][string] = {
  label: "Scroll Indicator",
  inline: true,
  fields: {
    label: createFreeInputField("Label Text", "", [], "Short text shown above/below the indicator.", "SCROLL TO EXPLORE"),
    labelPosition: createToggleField("Label Position", [
      { label: "Above", value: "above" },
      { label: "Below", value: "below" },
    ], "Where the label sits relative to the arrow indicator."),
    vPosition: makeCustomSelectField("Vertical Position", [
      { label: "Top", value: "top" },
      { label: "Center", value: "center" },
      { label: "Bottom", value: "bottom" },
    ], "Pin to top, center, or bottom of the Section."),
    hPosition: makeCustomSelectField("Horizontal Position", [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ]),
    vOffset: makeCustomSelectField("Vertical Offset", [
      { label: "16px", value: "16px" },
      { label: "24px", value: "24px" },
      { label: "32px", value: "32px" },
      { label: "40px", value: "40px" },
      { label: "48px", value: "48px" },
      { label: "64px", value: "64px" },
    ], "Distance from the pinned edge."),
    hOffset: makeCustomSelectField("Horizontal Offset", [
      { label: "0px", value: "0px" },
      { label: "16px", value: "16px" },
      { label: "24px", value: "24px" },
      { label: "32px", value: "32px" },
      { label: "48px", value: "48px" },
    ], "Side offset — only applies when position is Left or Right."),
    indicatorStyle: createToggleField("Indicator Style", [
      { label: "Outline", value: "outline" },
      { label: "Filled", value: "filled" },
      { label: "None", value: "none" },
    ], "Shape wrapping the arrow."),
    size: makeCustomSelectField("Size", [
      { label: "Small", value: "sm" },
      { label: "Medium", value: "md" },
      { label: "Large", value: "lg" },
    ]),
    indicatorColor: makeColorField("Indicator Color", "#FFFFFF", "Border or fill of the capsule."),
    arrowColor: makeColorField("Arrow Color", "#FFFFFF"),
    textColor: makeColorField("Label Color", "#FFFFFF"),
    _typography: { type: "object", label: "Label Typography", objectFields: {
      fontFamily: makeCustomSelectField("Font Family", [
        { label: "Inherit", value: "inherit" },
        { label: "Sans-serif", value: "sans-serif" },
        { label: "Serif", value: "serif" },
        { label: "Cormorant Garamond", value: "'Cormorant Garamond', serif" },
        { label: "Playfair Display", value: "'Playfair Display', serif" },
        { label: "Inter", value: "'Inter', sans-serif" },
        { label: "Montserrat", value: "'Montserrat', sans-serif" },
      ]),
      fontWeight: makeCustomSelectField("Font Weight", [
        { label: "Light (300)", value: "300" },
        { label: "Regular (400)", value: "400" },
        { label: "Medium (500)", value: "500" },
        { label: "SemiBold (600)", value: "600" },
        { label: "Bold (700)", value: "700" },
      ]),
      fontSize: makeFreeInputField("Font Size", "px", ["10px", "11px", "12px", "13px", "14px"]),
      letterSpacing: makeFreeInputField("Letter Spacing", "", ["normal", "0.05em", "0.1em", "0.15em", "0.2em"]),
      textTransform: makeCustomSelectField("Text Transform", [
        { label: "None", value: "none" },
        { label: "UPPERCASE", value: "uppercase" },
        { label: "lowercase", value: "lowercase" },
        { label: "Capitalize", value: "capitalize" },
      ]),
    }},
    animation: makeCustomSelectField("Animation", [
      { label: "Bounce", value: "bounce" },
      { label: "Fade", value: "fade" },
      { label: "None", value: "none" },
    ], "Arrow animation style."),
    href: createFreeInputField("Link / Anchor", "", [], "Example: #next-section", "#next-section"),
  },
  defaultProps: {
    label: "Scroll to explore",
    labelPosition: "above",
    vPosition: "bottom",
    hPosition: "center",
    vOffset: "32px",
    hOffset: "0px",
    indicatorStyle: "outline",
    size: "md",
    indicatorColor: "#FFFFFF",
    arrowColor: "#FFFFFF",
    textColor: "#FFFFFF",
    _typography: {
      fontFamily: "inherit",
      fontWeight: "400",
      fontSize: "11px",
      letterSpacing: "0.15em",
      textTransform: "uppercase",
    },
    animation: "bounce",
    href: "#",
  },
  render: (props) => {
    const vPos   = (props.vPosition as string) || "bottom";
    const hPos   = (props.hPosition as string) || "center";
    const vOff   = (props.vOffset   as string) || "32px";
    const hOff   = (props.hOffset   as string) || "0px";
    const indStyle  = (props.indicatorStyle as string) || "outline";
    const labelPos  = (props.labelPosition  as string) || "above";
    const anim      = (props.animation      as string) || "bounce";
    const size      = (props.size           as string) || "md";
    const labelText = (props.label          as string) || "";
    const href      = (props.href           as string) || "#";
    const typo          = (props._typography  as Record<string, string>) ?? {};
    const textColor     = (props.textColor    as string) || "#FFFFFF";
    const indicatorColor = (props.indicatorColor as string) || "#FFFFFF";
    const arrowColor    = (props.arrowColor   as string) || "#FFFFFF";

    const sizePx: Record<string, { w: number; h: number; arrow: number }> = {
      sm: { w: 28, h: 48, arrow: 10 },
      md: { w: 38, h: 62, arrow: 14 },
      lg: { w: 50, h: 80, arrow: 18 },
    };
    const dim = sizePx[size] ?? sizePx.md;

    // ── Absolute positioning ─────────────────────────────────────────────────
    const containerStyle: React.CSSProperties = {
      position: "absolute",
      zIndex: 10,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      textDecoration: "none",
      cursor: "pointer",
    };

    if (vPos === "top")    { containerStyle.top = vOff; }
    else if (vPos === "bottom") { containerStyle.bottom = vOff; }
    else                  { containerStyle.top = "50%"; }

    if (hPos === "left")   { containerStyle.left = hOff; }
    else if (hPos === "right") { containerStyle.right = hOff; }
    else                   { containerStyle.left = "50%"; }

    const tx = hPos === "center" ? "-50%" : "0%";
    const ty = vPos === "center" ? "-50%" : "0%";
    if (tx !== "0%" || ty !== "0%") {
      containerStyle.transform = `translate(${tx}, ${ty})`;
    }

    // ── Capsule ──────────────────────────────────────────────────────────────
    const capsuleStyle: React.CSSProperties = {
      width:  dim.w,
      height: dim.h,
      borderRadius: dim.w / 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: indStyle === "outline" ? `1.5px solid ${indicatorColor}` : "none",
      backgroundColor: indStyle === "filled" ? indicatorColor : "transparent",
    };

    // ── Chevron arrow SVG ────────────────────────────────────────────────────
    const arrowSvg = React.createElement("svg", {
      width: dim.arrow,
      height: dim.arrow,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: arrowColor,
      strokeWidth: 2,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      "aria-hidden": "true",
    }, React.createElement("polyline", { points: "6 9 12 15 18 9" }));

    // ── Animated capsule ─────────────────────────────────────────────────────
    let indicatorEl: React.ReactNode;
    if (anim === "bounce") {
      indicatorEl = React.createElement(
        motion.div,
        {
          animate: { y: [0, 8, 0] },
          transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
          style: capsuleStyle,
        },
        arrowSvg,
      );
    } else if (anim === "fade") {
      indicatorEl = React.createElement(
        motion.div,
        {
          animate: { opacity: [1, 0.3, 1] },
          transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
          style: capsuleStyle,
        },
        arrowSvg,
      );
    } else {
      indicatorEl = React.createElement("div", { style: capsuleStyle }, arrowSvg);
    }

    // ── Label ────────────────────────────────────────────────────────────────
    const labelStyle: React.CSSProperties = {
      color: textColor,
      fontFamily:    typo.fontFamily    || "inherit",
      fontWeight:    typo.fontWeight    || "400",
      fontSize:      typo.fontSize      || "11px",
      letterSpacing: typo.letterSpacing || "0.15em",
      textTransform: (typo.textTransform || "uppercase") as React.CSSProperties["textTransform"],
      whiteSpace: "nowrap",
    };
    const labelEl = labelText
      ? React.createElement("span", { style: labelStyle }, labelText)
      : null;

    const children = (labelPos === "above"
      ? [labelEl, indicatorEl]
      : [indicatorEl, labelEl]
    ).filter(Boolean);

    return React.createElement("a", {
      href,
      style: containerStyle,
      "aria-label": labelText || "Scroll",
    }, ...children);
  },
};


// ─── Stats Grid ───────────────────────────────────────────────────────────────
// A configurable stat grid. Each stat item has its own value/label typography,
// individual border control (left / right / top / bottom), border color/width/
// radius, and padding. The container controls columns, gap, and font family.

const STATS_FONT_OPTIONS = [
  { label: "Inherit", value: "inherit" },
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Cormorant Garamond", value: "'Cormorant Garamond', serif" },
  { label: "Playfair Display", value: "'Playfair Display', serif" },
  { label: "Inter", value: "'Inter', sans-serif" },
  { label: "Montserrat", value: "'Montserrat', sans-serif" },
];

const STATS_WEIGHT_OPTIONS = [
  { label: "Thin (100)", value: "100" },
  { label: "Light (300)", value: "300" },
  { label: "Regular (400)", value: "400" },
  { label: "Medium (500)", value: "500" },
  { label: "SemiBold (600)", value: "600" },
  { label: "Bold (700)", value: "700" },
];

const STATS_BORDER_SIDES_FIELD = {
  borderLeft:   createToggleField("Left Border",   [{ label: "On", value: "yes" }, { label: "Off", value: "no" }]),
  borderRight:  createToggleField("Right Border",  [{ label: "On", value: "yes" }, { label: "Off", value: "no" }]),
  borderTop:    createToggleField("Top Border",    [{ label: "On", value: "yes" }, { label: "Off", value: "no" }]),
  borderBottom: createToggleField("Bottom Border", [{ label: "On", value: "yes" }, { label: "Off", value: "no" }]),
};

const StatsGrid: Config["components"][string] = {
  label: "Stats Grid",
  fields: {
    // ── Container layout ───────────────────────────────────────────────────
    columns: makeCustomSelectField("Columns", [
      { label: "1", value: "1" },
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "5", value: "5" },
      { label: "6", value: "6" },
    ], "Number of stat columns per row."),
    gap: makeFreeInputField("Column Gap", "px", ["0px", "8px", "16px", "24px", "32px", "48px"], "Gap between stat items."),
    rowGap: makeFreeInputField("Row Gap", "px", ["0px", "8px", "16px", "24px", "32px", "48px"], "Gap between rows when stats wrap."),
    fontFamily: makeCustomSelectField("Font Family", STATS_FONT_OPTIONS, "Applied to all stats unless overridden per-item."),

    // ── Per-item array ─────────────────────────────────────────────────────
    items: {
      type: "array",
      label: "Stats",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${(item.value as string) || "Stat"}`,
      defaultItemProps: {
        value: "4.8M²",
        label: "Total Land Area",
        // value typography
        valueColor: "#FFFFFF",
        valueFontSize: "52px",
        valueFontWeight: "300",
        valueLetterSpacing: "normal",
        // label typography
        labelColor: "rgba(255,255,255,0.75)",
        labelFontSize: "14px",
        labelFontWeight: "300",
        labelLetterSpacing: "normal",
        // borders
        borderLeft: "yes",
        borderRight: "no",
        borderTop: "no",
        borderBottom: "no",
        borderColor: "#FFFFFF",
        borderWidth: "1",
        borderRadius: "0",
        // spacing
        paddingX: "24px",
        paddingY: "16px",
        // vertical gap between value and label
        innerGap: "8px",
      },
      arrayFields: {
        value: { type: "text", label: "Value", contentEditable: true },
        label: { type: "text", label: "Label", contentEditable: true },
        // Value typography
        valueColor: makeColorField("Value Color", "#FFFFFF"),
        valueFontSize: makeFreeInputField("Value Size", "px", ["32px", "44px", "52px", "60px", "72px", "96px"]),
        valueFontWeight: makeCustomSelectField("Value Weight", STATS_WEIGHT_OPTIONS),
        valueLetterSpacing: makeFreeInputField("Value Letter Spacing", "", ["normal", "0.02em", "0.05em", "0.1em"]),
        // Label typography
        labelColor: makeColorField("Label Color", "rgba(255,255,255,0.75)"),
        labelFontSize: makeFreeInputField("Label Size", "px", ["11px", "12px", "14px", "16px", "18px"]),
        labelFontWeight: makeCustomSelectField("Label Weight", STATS_WEIGHT_OPTIONS),
        labelLetterSpacing: makeFreeInputField("Label Letter Spacing", "", ["normal", "0.02em", "0.05em", "0.1em", "0.15em"]),
        // Border per-side
        ...STATS_BORDER_SIDES_FIELD,
        borderColor: makeColorField("Border Color", "#FFFFFF"),
        borderWidth: makeSliderField("Border Width", 0, 8, "px"),
        borderRadius: makeSliderField("Border Radius", 0, 32, "px"),
        // Spacing
        paddingX: makeFreeInputField("Padding X", "px", ["8px", "16px", "24px", "32px", "40px"], "Left/right inner padding."),
        paddingY: makeFreeInputField("Padding Y", "px", ["8px", "12px", "16px", "20px", "24px"], "Top/bottom inner padding."),
        innerGap: makeFreeInputField("Value ↔ Label Gap", "px", ["4px", "6px", "8px", "12px", "16px"], "Vertical gap between value and label."),
      },
    },
    ...spacingBorderFields,
  },
  defaultProps: {
    columns: "4",
    gap: "0px",
    rowGap: "0px",
    fontFamily: "inherit",
    items: [
      { value: "4.8M²",  label: "Total Land Area",    valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "55%",    label: "Open Spaces",        valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "32K",    label: "Residents",          valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "9K",     label: "Units",              valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "1.2KM",  label: "Beach Front",        valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "1M²",    label: "Public Parks",       valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "5 STAR", label: "Resort",             valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      { value: "7.1KM",  label: "Walkable Spaces",    valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
    ],
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const cols = Number(props.columns) || 4;
    const gap = (props.gap as string) || "0px";
    const rowGap = (props.rowGap as string) || "0px";
    const fontFamily = (props.fontFamily as string) || "inherit";
    const items = (props.items as Array<Record<string, unknown>>) ?? [];

    return styledRender(props, React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        columnGap: gap,
        rowGap,
        fontFamily,
      },
    },
      ...items.map((item, index) => {
        const bw = Number(item.borderWidth) || 0;
        const bColor = (item.borderColor as string) || "#FFFFFF";
        const br = Number(item.borderRadius) || 0;
        const px = (item.paddingX as string) || "24px";
        const py = (item.paddingY as string) || "16px";
        const innerGap = (item.innerGap as string) || "8px";

        const borderStyle = bw > 0 ? `${bw}px solid ${bColor}` : undefined;
        const itemStyle: React.CSSProperties = {
          padding: `${py} ${px}`,
          borderRadius: br > 0 ? `${br}px` : undefined,
          borderLeft:   (item.borderLeft   as string) === "yes" ? borderStyle : undefined,
          borderRight:  (item.borderRight  as string) === "yes" ? borderStyle : undefined,
          borderTop:    (item.borderTop    as string) === "yes" ? borderStyle : undefined,
          borderBottom: (item.borderBottom as string) === "yes" ? borderStyle : undefined,
          display: "flex",
          flexDirection: "column",
          gap: innerGap,
        };

        return React.createElement("div", { key: index, style: itemStyle },
          React.createElement("span", {
            style: {
              display: "block",
              color: (item.valueColor as string) || "#FFFFFF",
              fontSize: (item.valueFontSize as string) || "52px",
              fontWeight: (item.valueFontWeight as string) || "300",
              letterSpacing: (item.valueLetterSpacing as string) || "normal",
              lineHeight: 1.1,
            },
          }, (item.value as string) || ""),
          React.createElement("span", {
            style: {
              display: "block",
              color: (item.labelColor as string) || "rgba(255,255,255,0.75)",
              fontSize: (item.labelFontSize as string) || "14px",
              fontWeight: (item.labelFontWeight as string) || "300",
              letterSpacing: (item.labelLetterSpacing as string) || "normal",
              lineHeight: 1.4,
            },
          }, (item.label as string) || ""),
        );
      }),
    ));
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LOCATION MAP — Google Maps with custom pins + location cards + CTA
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_DUBAI_LAT = 25.0772;
const DEFAULT_DUBAI_LNG = 55.1413;

const pinPickerField = {
  type: "custom" as const,
  label: "Map Pins",
  render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: LocationMapPin[]) => void; readOnly?: boolean }) => {
    const apiKey = (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY : "") || "";
    return React.createElement(PinMapPicker, {
      value: (value as LocationMapPin[]) ?? [],
      onChange,
      readOnly,
      apiKey,
      centerLat: DEFAULT_DUBAI_LAT,
      centerLng: DEFAULT_DUBAI_LNG,
      zoom: 9,
    });
  },
};

const LocationMap: Config["components"][string] = {
  label: "Location Map",
  fields: {
    mapTitle: { type: "text", label: "Title", contentEditable: true },
    titleColor: createCustomSelectField("Title Color", ORA_TEXT_COLOR_OPTIONS),

    // ── Container layout (controls section padding & width) ──────────────
    containerMaxWidth: makeFreeInputField("Container Max Width", "px", ["960px", "1200px", "1400px", "1600px", "100%"], "Constrains the title, map, and (when boxed) the cards."),
    containerPaddingX: makeFreeInputField("Container Padding X", "px", ["0px", "16px", "24px", "32px", "48px", "64px"], "Horizontal padding around the section content."),
    containerPaddingY: makeFreeInputField("Container Padding Y", "px", ["0px", "24px", "48px", "64px", "96px"], "Vertical padding around the whole section."),
    cardLayout: createToggleField("Cards Layout", [
      { label: "Boxed", value: "boxed" },
      { label: "Full width", value: "fullWidth" },
    ], "Whether the location cards row respects the container width or spans the full section width."),

    // ── Map ──────────────────────────────────────────────────────────────
    apiKeyOverride: { type: "text", label: "API Key Override (optional)" },
    centerLat: { type: "number", label: "Center Latitude" },
    centerLng: { type: "number", label: "Center Longitude" },
    zoom: makeSliderField("Zoom", 1, 20, ""),
    mapHeight: makeFreeInputField("Map Height", "px", ["320px", "400px", "440px", "520px", "640px", "60vh"]),
    mapBorderRadius: makeSliderField("Map Border Radius", 0, 32, "px"),
    mapStyleJson: { type: "textarea", label: "Map Style JSON (Snazzy Maps export)" },
    mapId: { type: "text", label: "Cloud Map ID (optional)" },

    // ── Pins (custom drag-on-map field) ──────────────────────────────────
    pins: pinPickerField,

    // ── Location cards ───────────────────────────────────────────────────
    cards: {
      type: "array",
      label: "Location Cards",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${(item.name as string) || "Location"}`,
      defaultItemProps: {
        pinId: "",
        name: "Downtown Dubai",
        travelTime: "35 Minutes",
        image: "",
        isDark: "no",
        bgColor: "",
        textColor: "",
        borderColor: "",
      },
      arrayFields: {
        pinId: { type: "text", label: "Linked Pin ID (paste from picker)" },
        name: { type: "text", label: "Name", contentEditable: true },
        travelTime: { type: "text", label: "Travel Time", contentEditable: true },
        image: imageUploadField,
        isDark: createToggleField("Dark Style", [
          { label: "Light", value: "no" },
          { label: "Dark", value: "yes" },
        ]),
        bgColor: createCustomSelectField("Background Color", [{ label: "Default", value: "" }, ...ORA_SOLID_BG_OPTIONS]),
        textColor: createCustomSelectField("Text Color", [{ label: "Default", value: "" }, ...ORA_TEXT_COLOR_OPTIONS]),
        borderColor: createCustomSelectField("Border Color", [{ label: "Default", value: "" }, ...ORA_SOLID_BG_OPTIONS]),
      },
    },
    cardColumns: makeCustomSelectField("Card Columns", [
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "5", value: "5" },
      { label: "6", value: "6" },
    ]),
    cardGap: makeFreeInputField("Card Gap (X)", "px", ["0px", "8px", "12px", "16px", "20px", "24px", "32px"]),
    rowGap: makeFreeInputField("Card Gap (Y)", "px", ["0px", "8px", "12px", "16px", "20px", "24px", "32px"]),
    cardImageHeight: makeFreeInputField("Card Image Height", "px", ["80px", "100px", "110px", "140px", "180px", "220px"]),
    cardBorderWidth: makeSliderField("Card Border Width", 0, 6, "px"),
    cardBorderColor: createCustomSelectField("Card Border Color", ORA_SOLID_BG_OPTIONS),
    cardBorderRadius: makeSliderField("Card Border Radius", 0, 32, "px"),
    cardPaddingX: makeFreeInputField("Card Padding X", "px", ["8px", "12px", "16px", "20px", "24px"]),
    cardPaddingY: makeFreeInputField("Card Padding Y", "px", ["8px", "12px", "16px", "20px", "24px"]),
    spaceMapToCards: makeFreeInputField("Spacing: Map → Cards", "px", ["0px", "12px", "24px", "32px", "48px", "64px"]),
    spaceCardsToCta: makeFreeInputField("Spacing: Cards → CTA", "px", ["0px", "16px", "24px", "32px", "48px", "64px"]),

    // ── CTA Button ───────────────────────────────────────────────────────
    ctaLabel: { type: "text", label: "CTA Label", contentEditable: true },
    ctaUrl: { type: "text", label: "CTA URL (Google Maps link)" },
    ctaIconImage: imageUploadField,
    ctaBgColor: createCustomSelectField("CTA Background", ORA_SOLID_BG_OPTIONS),
    ctaTextColor: createCustomSelectField("CTA Text", ORA_TEXT_COLOR_OPTIONS),
    ctaBorderColor: createCustomSelectField("CTA Border", ORA_SOLID_BG_OPTIONS),

    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    mapTitle: "Location",
    titleColor: "#2C2C2C",
    containerMaxWidth: "1200px",
    containerPaddingX: "24px",
    containerPaddingY: "48px",
    cardLayout: "boxed",
    apiKeyOverride: "",
    centerLat: DEFAULT_DUBAI_LAT,
    centerLng: DEFAULT_DUBAI_LNG,
    zoom: 9,
    mapHeight: "440px",
    mapBorderRadius: 0,
    mapStyleJson: "",
    mapId: "",
    pins: [] as LocationMapPin[],
    cards: [
      { pinId: "", name: "Downtown Dubai",   travelTime: "35 Minutes", image: "", isDark: "yes", bgColor: "#2C2C2C", textColor: "#FFFFFF", borderColor: "transparent" },
      { pinId: "", name: "Abu Dhabi",        travelTime: "45 Minutes", image: "", isDark: "no",  bgColor: "", textColor: "", borderColor: "" },
      { pinId: "", name: "Dubai Marina",     travelTime: "20 Minutes", image: "", isDark: "no",  bgColor: "", textColor: "", borderColor: "" },
      { pinId: "", name: "DWC Airport",      travelTime: "25 Minutes", image: "", isDark: "no",  bgColor: "", textColor: "", borderColor: "" },
      { pinId: "", name: "Palm Jebel Ali",   travelTime: "7 Minutes",  image: "", isDark: "no",  bgColor: "", textColor: "", borderColor: "" },
    ] as LocationMapCard[],
    cardColumns: "5",
    cardGap: "12px",
    rowGap: "12px",
    cardImageHeight: "110px",
    cardBorderWidth: 1,
    cardBorderColor: "#E8E4DF",
    cardBorderRadius: 0,
    cardPaddingX: "16px",
    cardPaddingY: "16px",
    spaceMapToCards: "24px",
    spaceCardsToCta: "32px",
    ctaLabel: "See on Google Maps",
    ctaUrl: "",
    ctaIconImage: "",
    ctaBgColor: "#FFFFFF",
    ctaTextColor: "#2C2C2C",
    ctaBorderColor: "#2C2C2C",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    return styledRender(
      props,
      React.createElement(LocationMapRuntime, {
        mapTitle: props.mapTitle as string,
        titleColor: (props.titleColor as string) || "#2C2C2C",
        apiKeyOverride: props.apiKeyOverride as string,
        centerLat: Number(props.centerLat) || DEFAULT_DUBAI_LAT,
        centerLng: Number(props.centerLng) || DEFAULT_DUBAI_LNG,
        zoom: Number(props.zoom) || 9,
        mapHeight: (props.mapHeight as string) || "440px",
        mapStyleJson: (props.mapStyleJson as string) || "",
        mapId: (props.mapId as string) || "",
        mapBorderRadius: Number(props.mapBorderRadius) || 0,
        pins: ((props.pins as LocationMapPin[]) ?? []).map((p) => ({
          ...p,
          lat: Number(p.lat) || 0,
          lng: Number(p.lng) || 0,
        })),
        cards: (props.cards as LocationMapCard[]) ?? [],
        containerMaxWidth: (props.containerMaxWidth as string) || "1200px",
        containerPaddingX: (props.containerPaddingX as string) || "24px",
        containerPaddingY: (props.containerPaddingY as string) || "48px",
        cardLayout: ((props.cardLayout as string) === "fullWidth" ? "fullWidth" : "boxed"),
        cardColumns: Number(props.cardColumns) || 5,
        cardGap: (props.cardGap as string) || "12px",
        rowGap: (props.rowGap as string) || "12px",
        cardImageHeight: (props.cardImageHeight as string) || "110px",
        cardBorderWidth: Number(props.cardBorderWidth) || 0,
        cardBorderColor: (props.cardBorderColor as string) || "#E8E4DF",
        cardBorderRadius: Number(props.cardBorderRadius) || 0,
        cardPaddingX: (props.cardPaddingX as string) || "16px",
        cardPaddingY: (props.cardPaddingY as string) || "16px",
        spaceMapToCards: (props.spaceMapToCards as string) || "24px",
        spaceCardsToCta: (props.spaceCardsToCta as string) || "32px",
        ctaLabel: (props.ctaLabel as string) || "See on Google Maps",
        ctaUrl: (props.ctaUrl as string) || "",
        ctaBgColor: (props.ctaBgColor as string) || "#FFFFFF",
        ctaTextColor: (props.ctaTextColor as string) || "#2C2C2C",
        ctaBorderColor: (props.ctaBorderColor as string) || "#2C2C2C",
        ctaIconImage: (props.ctaIconImage as string) || "",
      }),
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURED PROJECTS — pulls cards from /api/projects/public
// ═══════════════════════════════════════════════════════════════════════════════

const FeaturedProjects: Config["components"][string] = {
  fields: {
    heading: { type: "text", label: "Heading" },
    subheading: { type: "text", label: "Subheading" },
    ctaLabel: { type: "text", label: "Card CTA Label" },
    prefix: { type: "text", label: "Project URL prefix" },
    columns: {
      type: "select",
      label: "Columns",
      options: [
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
      ],
    },
    limit: { type: "number", label: "Max cards", min: 1, max: 12 },
    projectIds: {
      type: "array",
      label: "Featured project IDs (optional — leave empty to auto-pick)",
      arrayFields: {
        id: { type: "text", label: "Project ID" },
      },
      defaultItemProps: { id: "" },
      getItemSummary: (item: { id?: string }) => item.id || "Project",
    },
  },
  defaultProps: {
    heading: "Featured Projects",
    subheading: "",
    ctaLabel: "Explore",
    prefix: "projects",
    columns: 3,
    limit: 3,
    projectIds: [],
  },
  render: (props) => {
    const items = (props.projectIds as Array<{ id?: string }> | undefined) ?? [];
    const ids = items.map((i) => i?.id ?? "").filter(Boolean);
    return React.createElement(FeaturedProjectsRuntime, {
      heading: props.heading as string,
      subheading: props.subheading as string,
      ctaLabel: props.ctaLabel as string,
      prefix: (props.prefix as string) || "projects",
      columns: Number(props.columns) || 3,
      limit: Number(props.limit) || 3,
      projectIds: ids,
    });
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURED COMMUNITIES — cards from /api/communities/public
// ═══════════════════════════════════════════════════════════════════════════════

const FeaturedCommunities: Config["components"][string] = {
  fields: {
    heading: { type: "text", label: "Heading" },
    subheading: { type: "text", label: "Subheading" },
    ctaLabel: { type: "text", label: "Card CTA Label" },
    prefix: { type: "text", label: "Community URL prefix" },
    columns: {
      type: "select",
      label: "Columns",
      options: [
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
      ],
    },
    limit: { type: "number", label: "Max cards", min: 1, max: 12 },
    communityIds: {
      type: "array",
      label: "Featured community IDs (optional — leave empty to auto-pick)",
      arrayFields: {
        id: { type: "text", label: "Community ID" },
      },
      defaultItemProps: { id: "" },
      getItemSummary: (item: { id?: string }) => item.id || "Community",
    },
  },
  defaultProps: {
    heading: "Featured Communities",
    subheading: "",
    ctaLabel: "Explore",
    prefix: "communities",
    columns: 3,
    limit: 3,
    communityIds: [],
  },
  render: (props) => {
    const items = (props.communityIds as Array<{ id?: string }> | undefined) ?? [];
    const ids = items.map((i) => i?.id ?? "").filter(Boolean);
    return React.createElement(FeaturedCommunitiesRuntime, {
      heading: props.heading as string,
      subheading: props.subheading as string,
      ctaLabel: props.ctaLabel as string,
      prefix: (props.prefix as string) || "communities",
      columns: Number(props.columns) || 3,
      limit: Number(props.limit) || 3,
      communityIds: ids,
    });
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT SECTION — embed any single section of a project landing page
// ═══════════════════════════════════════════════════════════════════════════════

const PROJECT_SECTION_OPTIONS: Array<{ label: string; value: ProjectSectionKind }> = [
  { label: "Hero", value: "hero" },
  { label: "Overview", value: "overview" },
  { label: "Brochure Gallery", value: "gallery" },
  { label: "Floorplans", value: "floorplans" },
  { label: "Amenities", value: "amenities" },
  { label: "Location Highlights", value: "location" },
  { label: "Payment Plan", value: "payment" },
];

const ProjectSection: Config["components"][string] = {
  fields: {
    projectSlug: { type: "text", label: "Project slug" },
    section: {
      type: "select",
      label: "Section",
      options: PROJECT_SECTION_OPTIONS,
    },
    locale: {
      type: "select",
      label: "Locale",
      options: [
        { label: "English", value: "en" },
        { label: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", value: "ar" },
      ],
    },
  },
  defaultProps: {
    projectSlug: "",
    section: "hero",
    locale: "en",
  },
  render: (props) =>
    React.createElement(ProjectSectionRuntime, {
      projectSlug: (props.projectSlug as string) || "",
      section: (props.section as ProjectSectionKind) || "hero",
      locale: (props.locale as "en" | "ar") || "en",
    }),
};


// ═══════════════════════════════════════════════════════════════════════════════
// PUCK CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
//
// All higher-level "blocks" (Hero, Property Card, Footer, etc.) are now
// expressed as nested **templates** of these atomic components. See
// ./templates/component-templates.ts and the Templates sidebar plugin.

export const pageBuilderConfig: Config = {
  categories: {
    layout: { components: ["Section", "Container", "Columns", "Accordion", "Spacer", "Divider"], title: "Layout", defaultExpanded: true },
    basic: { components: ["Heading", "Text", "Button", "InlineLink", "Image", "Video", "Quote", "Icon"], title: "Basic" },
    interactive: { components: ["FilterTabs", "ScrollIndicator", "IconFeatureList", "AccordionGroup", "StatsGrid", "LocationMap"], title: "Interactive" },
    projects: { components: ["FeaturedProjects", "FeaturedCommunities", "ProjectSection"], title: "Projects" },
  },
  components: {
    Section, Container, Columns, Accordion, Spacer, Divider,
    Heading, Text, Button, InlineLink, Image, Video, Quote, Icon,
    FilterTabs, ScrollIndicator, IconFeatureList, AccordionGroup, StatsGrid, LocationMap,
    FeaturedProjects, FeaturedCommunities, ProjectSection,
  },
};
