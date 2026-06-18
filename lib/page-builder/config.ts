"use client";

import type { OraComponentConfig, OraConfig } from "./config-types";
import { motion } from "framer-motion";
import React from "react";
import { stylePropsToCSS } from "./style-fields";
import { sanitizeRichTextHtml } from "./richtext/sanitize";
// Re-export so existing importers of `../config` (e.g. InlineRichtextController
// tests and the richtext-roundtrip property test) keep resolving to the single
// isomorphic, fail-closed sanitizer source of truth in `./richtext/sanitize`.
export { sanitizeRichTextHtml };
import {
  typographyFields,
  typographyDefaultsHeading,
  typographyDefaultsText,
  typographyPropsToCSS,
  colorField,
} from "./typography-fields";
import { imageFields, imageDefaults, imagePropsToCSS } from "./image-fields";
import { animationFields, animationDefaults } from "./animation-fields";
import { trackingFields, trackingDefaults } from "@/lib/analytics/tracking-fields";
import { createCustomSelectField, createToggleField, createFreeInputField } from "./shared-field-controls";
import { buttonFields, buttonFieldDefaults, renderButtonAnchor, isExternalButtonUrl } from "./blocks/button-fields";
import { responsiveColumnsField, gridStyle, COLUMNS_FIELD_NAME } from "./blocks/grid";
import { renderStarRating } from "./blocks/star-rating";
import { SOCIAL_ICONS } from "./blocks/social-icons";
import type { TestimonialItem, LogoItem, PricingPlan, SocialItem, BreadcrumbItem } from "./blocks/block-item-types";
import { EVENT_VOCABULARY } from "@/lib/analytics/events";
import type { PageAnalyticsConfig } from "@/lib/analytics/types";
import { resolveBreakpointValue, type BreakpointValue } from "./breakpoints";
import { withBreakpointResolution } from "./with-breakpoint-resolution";
import { validateResponsiveDefaults } from "./responsive-defaults";
import { LocationMap as LocationMapRuntime } from "./components/LocationMap/LocationMap";
import { ContactLocationsMap as ContactLocationsMapRuntime } from "./components/LocationMap/ContactLocationsMap";
import { PinMapPicker } from "./components/LocationMap/PinMapPicker";
import { ContactLocationPicker } from "./components/LocationMap/ContactLocationPicker";
import type { LocationMapPin, LocationMapCard, ContactLocationItem } from "./components/LocationMap/types";
import { FeaturedProjectsRuntime } from "./components/project/FeaturedProjectsRuntime";
import { FeaturedCommunitiesRuntime } from "./components/project/FeaturedCommunitiesRuntime";
import { ProjectSectionRuntime, type ProjectSectionKind } from "./components/project/ProjectSectionRuntime";
import { ImageCarouselRuntime } from "./components/ImageCarouselRuntime";
import { TestimonialRuntime } from "./components/TestimonialRuntime";
import { TabGroupRuntime } from "./components/TabGroupRuntime";
import { CountdownRuntime } from "./components/CountdownRuntime";
import { GalleryRuntime } from "./components/GalleryRuntime";
import type { GalleryImage } from "./components/GalleryRuntime";
import { MediaLibraryPicker } from "./components/MediaLibraryPicker";
import { ExperienceLauncherRuntime, type LauncherStyle } from "./components/ExperienceLauncherRuntime";
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
  // Brand icons for the SocialLinks block (inline SVGs; lucide lacks these).
  ...SOCIAL_ICONS,
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

// Compact 4-side editor (Top / Right / Bottom / Left) with a link-all toggle.
// Used for both padding and margin so users get full per-side control.
function renderFourSideEditor(
  current: Record<string, string>,
  prefix: "padding" | "margin",
  onChange: (next: Record<string, string>) => void,
  step = 4,
) {
  const top = asNumber(current[`${prefix}Top`]);
  const right = asNumber(current[`${prefix}Right`]);
  const bottom = asNumber(current[`${prefix}Bottom`]);
  const left = asNumber(current[`${prefix}Left`]);
  const allEqual = top === right && right === bottom && bottom === left;

  // We persist link state inside the value object using a synthetic key
  // (`__link__`) so the UI remembers the user's choice across renders.
  // The runtime only consumes `${prefix}Top/Right/Bottom/Left`, so the
  // extra key is ignored downstream.
  const linkKey = `__${prefix}Link__`;
  const linked = current[linkKey] != null ? current[linkKey] === "1" : allEqual;

  const setAll = (v: number) =>
    onChange({
      ...current,
      [`${prefix}Top`]: String(v),
      [`${prefix}Right`]: String(v),
      [`${prefix}Bottom`]: String(v),
      [`${prefix}Left`]: String(v),
      [linkKey]: "1",
    });

  const setSide = (side: "Top" | "Right" | "Bottom" | "Left", v: number) =>
    onChange({
      ...current,
      [`${prefix}${side}`]: String(Math.max(0, v)),
      [linkKey]: "0",
    });

  const toggleLinked = () => {
    if (linked) {
      onChange({ ...current, [linkKey]: "0" });
    } else {
      // Going from unlinked → linked: snap all sides to current Top.
      onChange({
        ...current,
        [`${prefix}Right`]: String(top),
        [`${prefix}Bottom`]: String(top),
        [`${prefix}Left`]: String(top),
        [linkKey]: "1",
      });
    }
  };

  const linkButton = React.createElement(
    "button",
    {
      type: "button",
      onClick: toggleLinked,
      title: linked ? "Sides are linked — click to unlink" : "Sides are unlinked — click to link",
      style: {
        height: 22,
        padding: "0 8px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        border: "1px solid #E8E4DF",
        background: linked ? "#2C2C2C" : "#F9F7F5",
        color: linked ? "#FFF" : "#2C2C2C",
        cursor: "pointer",
      },
    },
    linked ? "Linked" : "Per-side",
  );

  if (linked) {
    return React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 6 } },
      React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "flex-end" } },
        linkButton,
      ),
      renderSimpleStepper("All sides", top, setAll, step),
    );
  }

  return React.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6 } },
    React.createElement(
      "div",
      { style: { display: "flex", justifyContent: "flex-end" } },
      linkButton,
    ),
    renderSimpleStepper("Top", top, (v) => setSide("Top", v), step),
    renderSimpleStepper("Right", right, (v) => setSide("Right", v), step),
    renderSimpleStepper("Bottom", bottom, (v) => setSide("Bottom", v), step),
    renderSimpleStepper("Left", left, (v) => setSide("Left", v), step),
  );
}

function paddingField() {
  return {
    type: "custom" as const,
    label: "Padding",
    render: ({ value, onChange }: { value: unknown; onChange: (v: Record<string, string>) => void }) => {
      const current = (value as Record<string, string>) ?? {};
      return React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        React.createElement("div", { style: { fontSize: 12, color: "#6B6B6B" } }, "Area padding"),
        renderFourSideEditor(current, "padding", onChange),
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
      return React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        React.createElement("div", { style: { fontSize: 12, color: "#6B6B6B" } }, "Area margin"),
        renderFourSideEditor(current, "margin", onChange),
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
  _margin: { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" },
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
    const [mode, setMode] = React.useState<"upload" | "url" | "library">("upload");
    const [urlInput, setUrlInput] = React.useState("");
    const [showLibrary, setShowLibrary] = React.useState(false);

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

    const modeButtonStyle = (isActive: boolean) => ({
      flex: 1, height: 30, border: "1px solid #E8E4DF", fontSize: 11, cursor: "pointer" as const,
      background: isActive ? "#2C2C2C" : "#F9F7F5",
      color: isActive ? "#FFF" : "#6B6B6B",
      fontWeight: isActive ? 600 : 400,
      marginLeft: isActive ? 0 : -1,
    });

    if (currentSrc) {
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("div", {
          style: { position: "relative" },
        },
          React.createElement("img", { src: currentSrc, alt: "Preview", style: { width: "100%", height: 140, objectFit: "cover", border: "1px solid #E8E4DF", display: "block" } }),
          !readOnly && React.createElement("button", {
            type: "button",
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); onChange(""); },
            style: { position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", width: 20, height: 20, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" },
            "aria-label": "Remove image",
          }, "✕"),
        ),
        // Replace controls: Upload / Library / URL
        !readOnly && React.createElement("div", { style: { display: "flex", gap: 0 } },
          React.createElement("button", {
            type: "button", onClick: triggerUpload,
            style: { flex: 1, height: 28, border: "1px solid #E8E4DF", fontSize: 11, cursor: "pointer", background: "#F9F7F5", color: "#6B6B6B", fontWeight: 400 },
          }, "Upload"),
          React.createElement("button", {
            type: "button", onClick: () => setShowLibrary(true),
            style: { flex: 1, height: 28, border: "1px solid #E8E4DF", borderLeft: "none", fontSize: 11, cursor: "pointer", background: "#F9F7F5", color: "#6B6B6B", fontWeight: 400 },
          }, "Library"),
          React.createElement("button", {
            type: "button", onClick: () => setMode("url"),
            style: { flex: 1, height: 28, border: "1px solid #E8E4DF", borderLeft: "none", fontSize: 11, cursor: "pointer", background: mode === "url" ? "#2C2C2C" : "#F9F7F5", color: mode === "url" ? "#FFF" : "#6B6B6B", fontWeight: mode === "url" ? 600 : 400 },
          }, "URL"),
        ),
        // URL input row (shown when mode is "url")
        !readOnly && mode === "url" && React.createElement("div", { style: { display: "flex", gap: 4 } },
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
        ),
        // Media Library Picker
        showLibrary && React.createElement(MediaLibraryPicker, {
          multiple: false,
          onSelect: (urls: string[]) => { if (urls[0]) onChange(urls[0]); setShowLibrary(false); },
          onClose: () => setShowLibrary(false),
        }),
      );
    }

    return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      // Mode toggle: Upload / Library / URL
      React.createElement("div", { style: { display: "flex", gap: 0 } },
        React.createElement("button", {
          type: "button", onClick: () => setMode("upload"),
          style: modeButtonStyle(mode === "upload"),
        }, "Upload"),
        React.createElement("button", {
          type: "button", onClick: () => { setMode("library"); setShowLibrary(true); },
          style: { ...modeButtonStyle(mode === "library"), borderLeft: "none" },
        }, "Library"),
        React.createElement("button", {
          type: "button", onClick: () => setMode("url"),
          style: { ...modeButtonStyle(mode === "url"), borderLeft: "none" },
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
        : mode === "upload"
        ? React.createElement("div", {
            onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (readOnly) return; const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) uploadFile(f); },
            onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
            onClick: triggerUpload,
            style: { border: "2px dashed #D4CFC8", padding: "20px 12px", textAlign: "center" as const, cursor: "pointer", background: "#F9F7F5", fontSize: 13, color: "#6B6B6B" },
          },
            React.createElement("div", { style: { fontSize: 20, marginBottom: 4 } }, "📁"),
            React.createElement("div", null, "Drop image or click to upload"),
          )
        : null,
      // Media Library Picker
      showLibrary && React.createElement(MediaLibraryPicker, {
        multiple: false,
        onSelect: (urls: string[]) => { if (urls[0]) onChange(urls[0]); setShowLibrary(false); setMode("upload"); },
        onClose: () => { setShowLibrary(false); setMode("upload"); },
      }),
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT COMPONENTS — Containers with slot fields for nesting
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Section ─────────────────────────────────────────────────────────────────
// The primary container. Has background color/image/opacity, contains a slot.

const Section: OraComponentConfig = {
  label: "Section",
  fields: {
    "section-content": { type: "slot", disallow: ["Section"] },
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
    bgVideoPoster: { ...imageUploadField, label: "Poster Image (shown until video loads)" },
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
    "section-content": [],
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
    // Poster: use dedicated bgVideoPoster, fall back to bgImage so switching
    // from image→video mode keeps the image as a placeholder until video loads.
    const videoPoster = mediaType === "video" ? ((bgVideoPoster as string) || (bgImage as string) || "") : "";
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

    // Video poster state management: show poster until video fires "playing" event.
    // For embeds (iframe), onLoad fires before the video is visible, so we add a
    // short delay to let the player buffer and start rendering.
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const [videoReady, setVideoReady] = React.useState(false);
    const handleEmbedLoad = React.useCallback(() => {
      setTimeout(() => setVideoReady(true), 1200);
    }, []);

    return styledRender(props, React.createElement("section", { id: sectionIdValue || undefined, style: outerStyle },
      // Background image overlay
      img ? React.createElement("div", { style: {
        position: "absolute", inset: 0, zIndex: 0,
        backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: (bgPosition as string) || "center center",
        opacity,
      }}) : null,
      // Video poster image (shows behind video — visible until video covers it)
      videoPoster && videoResolved ? React.createElement("div", { style: {
        position: "absolute", inset: 0, zIndex: 1,
        backgroundImage: `url(${videoPoster})`, backgroundSize: "cover", backgroundPosition: "center center",
        opacity,
      }}) : null,
      // Background video overlay (always z-index 2 so it layers above poster once playing)
      videoResolved ? React.createElement("div", { style: { position: "absolute", inset: 0, zIndex: 2, opacity: videoReady ? 1 : 0, overflow: "hidden", transition: "opacity 0.6s ease" } },
        videoResolved.kind === "embed"
          ? React.createElement("iframe", {
            src: videoResolved.src,
            title: "Section background video",
            allow: "autoplay; fullscreen; picture-in-picture",
            style: {
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "177.78vh", // 16:9 ratio — ensures cover behavior
              height: "56.25vw", // inverse 16:9
              minWidth: "100%",
              minHeight: "100%",
              transform: "translate(-50%, -50%)",
              border: "none",
              pointerEvents: "none",
            },
            onLoad: handleEmbedLoad,
          })
          : React.createElement("video", {
            ref: videoRef,
            src: videoResolved.src,
            poster: videoPoster || undefined,
            autoPlay: (bgVideoAutoplay as string) !== "no",
            loop: (bgVideoLoop as string) !== "no",
            muted: (bgVideoSound as string) !== "on",
            controls: (bgVideoControls as string) === "yes",
            playsInline: true,
            onPlaying: () => setVideoReady(true),
            style: { display: "block", position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: videoFit, objectPosition: (bgVideoPosition as string) || "center center" },
          }),
      ) : null,
      // Color/gradient overlay on top of media. Only render if there is an actual tint.
      shouldRenderTintOverlay ? React.createElement("div", { style: {
        position: "absolute",
        inset: 0,
        zIndex: 3,
        backgroundImage: hasGradientTint ? gradientValue : undefined,
        backgroundColor: hasSolidTint ? bg : undefined,
        opacity: 1 - opacity,
      }}) : null,
      // Content zone fills section height and uses alignContent for top/center/bottom placement
      React.createElement("div", {
        style: {
          position: "relative",
          zIndex: 4,
          width: "100%",
          flex: 1,
          minHeight: 0,
          display: "grid",
          alignContent: alignContentValue,
        },
      },
        typeof (props as Record<string, unknown>)["section-content"] === "function"
          ? (((props as Record<string, unknown>)["section-content"]) as () => React.ReactNode)()
          : null
      )
    ));
  },
};

// ─── Columns ─────────────────────────────────────────────────────────────────
// Variable number of columns. Each column has its own width / padding / margin
// / vertical-align / horizontal-align controls and its own slot
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

/**
 * Determine the effective column count from props.
 * - If `columnCount` is present and valid (1–6), use it.
 * - Otherwise, fall back to `columnList.length`.
 * - Clamp to [1, 6] range.
 */
export function resolveColumnCount(props: Record<string, unknown>): number {
  const explicit = props.columnCount as number | undefined;
  if (typeof explicit === "number" && explicit >= 1 && explicit <= 6) {
    return explicit;
  }
  const list = props.columnList as unknown[] | undefined;
  return Math.max(1, Math.min(6, list?.length ?? 2));
}

/**
 * Map a Column_Item's spacing fields to four-sided values.
 * Prefers new fields; falls back to legacy shorthand.
 */
export function mapLegacySpacing(item: Record<string, string>): {
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
} {
  return {
    paddingTop: item.paddingTop ?? item.paddingY ?? "0",
    paddingBottom: item.paddingBottom ?? item.paddingY ?? "0",
    paddingLeft: item.paddingLeft ?? item.paddingX ?? "0",
    paddingRight: item.paddingRight ?? item.paddingX ?? "0",
    marginTop: item.marginTop ?? item.marginY ?? "0",
    marginBottom: item.marginBottom ?? item.marginY ?? "0",
    marginLeft: item.marginLeft ?? "0",
    marginRight: item.marginRight ?? "0",
  };
}

const Columns: OraComponentConfig = {
  label: "Columns",
  responsiveDefaults: {
    layoutDirection: { mobile: "column" },
  },
  fields: {
    columnCount: {
      type: "number",
      label: "Number of Columns",
      min: 1,
      max: 6,
    },
    layoutDirection: createCustomSelectField("Layout Direction", [
      { label: "Horizontal (row)", value: "row" },
      { label: "Vertical (stack)", value: "column" },
    ]),
    "column-0": { type: "slot", disallow: ["Section"] },
    "column-1": { type: "slot", disallow: ["Section"] },
    "column-2": { type: "slot", disallow: ["Section"] },
    "column-3": { type: "slot", disallow: ["Section"] },
    "column-4": { type: "slot", disallow: ["Section"] },
    "column-5": { type: "slot", disallow: ["Section"] },
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
        paddingTop: "0",
        paddingBottom: "0",
        paddingLeft: "0",
        paddingRight: "0",
        marginTop: "0",
        marginBottom: "0",
        marginLeft: "0",
        marginRight: "0",
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
        paddingTop: createCustomSelectField("Padding Top", SPACING_OPTS),
        paddingBottom: createCustomSelectField("Padding Bottom", SPACING_OPTS),
        paddingLeft: createCustomSelectField("Padding Left", SPACING_OPTS),
        paddingRight: createCustomSelectField("Padding Right", SPACING_OPTS),
        marginTop: createCustomSelectField("Margin Top", SPACING_OPTS),
        marginBottom: createCustomSelectField("Margin Bottom", SPACING_OPTS),
        marginLeft: createCustomSelectField("Margin Left", SPACING_OPTS),
        marginRight: createCustomSelectField("Margin Right", SPACING_OPTS),
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
    columnCount: 2,
    layoutDirection: { desktop: "row", mobile: "column" },
    "column-0": [],
    "column-1": [],
    "column-2": [],
    "column-3": [],
    "column-4": [],
    "column-5": [],
    gap: "md",
    columnList: [
      { width: "1fr", paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0",
        marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0",
        align: "flex-start", justify: "stretch" },
      { width: "1fr", paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0",
        marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0",
        align: "flex-start", justify: "stretch" },
    ],
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const list = (props.columnList as Array<Record<string, string>>) ?? [];
    const count = resolveColumnCount(props);
    const cols = list.slice(0, count);

    // Fallback if list is shorter than count (shouldn't happen, but defensive)
    while (cols.length < count) {
      cols.push({ width: "1fr", paddingTop: "0", paddingBottom: "0",
        paddingLeft: "0", paddingRight: "0", marginTop: "0",
        marginBottom: "0", marginLeft: "0", marginRight: "0",
        align: "flex-start", justify: "stretch" });
    }

    const gapPx: Record<string, string> = { "0": "0", sm: "16px", md: "24px", lg: "40px" };
    const gap = gapPx[props.gap as string] ?? gapPx.md;

    // Resolve desktop direction as inline default (CSS custom prop overrides per breakpoint)
    const direction = resolveBreakpointValue(
      props.layoutDirection as BreakpointValue<string> | undefined,
      "desktop"
    ) ?? "row";

    // Build grid styles based on resolved direction
    const gridTemplate = cols
      .map((c) => (c.width && c.width !== "" ? c.width : "1fr"))
      .join(" ");

    const gridStyle: React.CSSProperties = direction === "row"
      ? { gridTemplateColumns: gridTemplate, gap }
      : { gridTemplateColumns: "1fr", gridAutoRows: "auto", gap };

    return styledRender(
      props,
      React.createElement(
        "div",
        {
          className: "grid",
          style: gridStyle,
        },
        ...cols.map((c, i) => {
          const spacing = mapLegacySpacing(c);
          return React.createElement(
            "div",
            {
              key: i,
              style: {
                display: "flex",
                flexDirection: "column",
                justifyContent: c.align || "flex-start",
                alignItems: c.justify || "stretch",
                paddingTop: spacing.paddingTop,
                paddingBottom: spacing.paddingBottom,
                paddingLeft: spacing.paddingLeft,
                paddingRight: spacing.paddingRight,
                marginTop: spacing.marginTop,
                marginBottom: spacing.marginBottom,
                marginLeft: spacing.marginLeft,
                marginRight: spacing.marginRight,
                minHeight: "60px",
                minWidth: 0,
              },
            },
            typeof (props as Record<string, unknown>)[`column-${i}`] === "function"
              ? (((props as Record<string, unknown>)[`column-${i}`]) as () => React.ReactNode)()
              : null
          );
        })
      )
    );
  },
};


// ─── Container — Content width constraint with slot ──────────────────────

const CONTAINER_BG_COLORS = ORA_SOLID_BG_OPTIONS;

const CONTAINER_GRADIENT_COLORS = ORA_GRADIENT_OPTIONS;

const Container: OraComponentConfig = {
  label: "Container",
  fields: {
    "container-content": { type: "slot", disallow: ["Section"] },
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
    "container-content": [],
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
      typeof (props as Record<string, unknown>)["container-content"] === "function"
        ? (((props as Record<string, unknown>)["container-content"]) as () => React.ReactNode)()
        : null
    ));
  },
};

// ─── Flex — Flexbox wrapper for arranging blocks along an axis ───────────────
// A single-slot container that lays its dropped children out with `display:
// flex`. Unlike the grid-based Columns block (whose cells always stack their
// contents vertically), Flex places children side by side — the right tool for
// icon-beside-text rows, button rows, badge strips, etc.
//
// The flex styles are applied directly to the slot's own wrapper element (via
// the `style` arg Puck's slot/DropZone render accepts) so the dropped blocks are
// its DIRECT children and therefore real flex items. Wrapping the slot in an
// extra div instead would make that div the single flex child and the items
// would just stack inside it.
//
// `flexDirection` is breakpoint-aware: it is edited through the builder's
// DESKTOP / TABLET / MOBILE switcher (like Columns' `layoutDirection`) rather
// than separate per-device fields, and `responsiveDefaults` stacks it to a
// column on mobile.

const FLEX_GAP_OPTS = [
  { label: "None", value: "0" },
  { label: "XS (8px)", value: "8px" },
  { label: "Small (16px)", value: "16px" },
  { label: "Medium (24px)", value: "24px" },
  { label: "Large (32px)", value: "32px" },
  { label: "XL (48px)", value: "48px" },
];

const FLEX_DIRECTION_OPTS = [
  { label: "Row (side by side)", value: "row" },
  { label: "Row reversed", value: "row-reverse" },
  { label: "Column (stacked)", value: "column" },
  { label: "Column reversed", value: "column-reverse" },
];

const FLEX_JUSTIFY_OPTS = [
  { label: "Start", value: "flex-start" },
  { label: "Center", value: "center" },
  { label: "End", value: "flex-end" },
  { label: "Space between", value: "space-between" },
  { label: "Space around", value: "space-around" },
  { label: "Space evenly", value: "space-evenly" },
];

const FLEX_ALIGN_OPTS = [
  { label: "Stretch", value: "stretch" },
  { label: "Start", value: "flex-start" },
  { label: "Center", value: "center" },
  { label: "End", value: "flex-end" },
  { label: "Baseline", value: "baseline" },
];

const FLEX_WRAP_OPTS = [
  { label: "Wrap", value: "wrap" },
  { label: "No wrap", value: "nowrap" },
];

const Flex: OraComponentConfig = {
  label: "Flex",
  // Edited through the DESKTOP/TABLET/MOBILE switcher; stacks on mobile.
  responsiveDefaults: {
    flexDirection: { mobile: "column" },
  },
  fields: {
    "flex-content": { type: "slot", disallow: ["Section"] },
    flexDirection: createCustomSelectField(
      "Direction",
      FLEX_DIRECTION_OPTS,
      "How children flow. Use Row for icon-beside-text layouts. Switch the DESKTOP / TABLET / MOBILE toggle to set a per-device direction.",
    ),
    justify: createCustomSelectField(
      "Justify (main axis)",
      FLEX_JUSTIFY_OPTS,
      "Distributes children along the flex direction (horizontal for a row).",
    ),
    crossAxis: createCustomSelectField(
      "Vertical align (items)",
      FLEX_ALIGN_OPTS,
      "Aligns children across the flex direction. For a row this is vertical alignment — Center lines an icon up with its text (items-start / center / end).",
    ),
    wrap: createToggleField(
      "Wrap",
      FLEX_WRAP_OPTS,
      "Allow children to wrap onto multiple lines when space runs out.",
    ),
    gap: createCustomSelectField("Gap", FLEX_GAP_OPTS, "Spacing between children."),
    ...spacingBorderFields,
  },
  defaultProps: {
    "flex-content": [],
    flexDirection: { desktop: "row", mobile: "column" },
    justify: "flex-start",
    crossAxis: "center",
    wrap: "wrap",
    gap: "16px",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    // `flexDirection` is resolved to the active breakpoint's scalar by
    // `withBreakpointResolution` before this runs.
    const direction = (props.flexDirection as string) || "row";
    const justify = (props.justify as string) || "flex-start";
    const align = (props.crossAxis as string) || "center";
    const wrap = (props.wrap as string) || "wrap";
    const gap = (props.gap as string) || "0";

    const flexStyle: React.CSSProperties = {
      display: "flex",
      flexDirection: direction as React.CSSProperties["flexDirection"],
      justifyContent: justify,
      alignItems: align,
      flexWrap: wrap as React.CSSProperties["flexWrap"],
      gap,
      // Keep an empty wrapper droppable in the builder.
      minHeight: "40px",
      minWidth: 0,
    };

    // Apply the flex styles to the slot's own element so the dropped blocks are
    // its direct children (real flex items). Passing `style` is honoured by both
    // the published `SlotRender` and the builder's `DropZone`.
    const slot = props["flex-content"];
    const content =
      typeof slot === "function"
        ? (slot as (p?: Record<string, unknown>) => React.ReactNode)({
            style: flexStyle,
          })
        : null;

    return styledRender(props, content);
  },
};

// ─── Quote/Blockquote — Styled quote with accent border ──────────────────────

const Quote: OraComponentConfig = {
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

const InlineLink: OraComponentConfig = {
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

const Heading: OraComponentConfig = {
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

const Text: OraComponentConfig = {
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

const Button: OraComponentConfig = {
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
    // NOTE: `fontFamily` is intentionally omitted. URW Geometric is enforced
    // via CSS inheritance from the canvas/renderer root.
    // See spec: branded-font-enforcement (Requirements 2.3, 2.5, 2.6).
    _typography: { type: "object", label: "Typography", objectFields: {
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
    url: "",
    _icon: { name: "", position: "right", size: "16", gap: "8px" },
    _typography: {
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
      (props.url as string) && (props.url as string) !== "#"
        ? React.createElement("a", { href: (props.url as string), style: btnStyle, className: "ora-builder-button" },
            iconPos === "left" ? iconEl : null,
            React.createElement("span", null, props.text as string),
            iconPos === "right" ? iconEl : null,
          )
        : React.createElement("button", { type: "button", style: btnStyle, className: "ora-builder-button" },
            iconPos === "left" ? iconEl : null,
            React.createElement("span", null, props.text as string),
            iconPos === "right" ? iconEl : null,
          )
    );
  },
};

// ─── Image ───────────────────────────────────────────────────────────────────

const Image: OraComponentConfig = {
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

const Video: OraComponentConfig = {
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

const Spacer: OraComponentConfig = {
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

const Divider: OraComponentConfig = {
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

const Icon: OraComponentConfig = {
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

const FilterTabs: OraComponentConfig = {
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

const IconFeatureList: OraComponentConfig = {
  label: "Icon Feature List",
  responsiveDefaults: {
    layoutDirection: { mobile: "column" },
  },
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
        // `row.label` may be a React element (Puck wraps `contentEditable`
        // text fields with InlineTextField). Pass it through to the span
        // and only fall back to a plain "Feature item" placeholder when
        // there's truly nothing to render.
        const labelValue = row.label;
        const labelIsElement = React.isValidElement(labelValue);
        const labelText = !labelIsElement
          ? extractIconFeatureLabel(labelValue)
              .replace(/\s*\n+\s*/g, " ")
              .replace(/\s{2,}/g, " ")
              .trim() || "Feature item"
          : null;
        const labelNode: React.ReactNode = labelIsElement
          ? (labelValue as React.ReactNode)
          : labelText;
        const accessibleLabel = labelText ?? "Feature";

        const iconNode = sourceType === "image" && typeof row.image === "string" && row.image.trim()
          ? React.createElement("img", {
              src: row.image,
              alt: `${accessibleLabel} icon`,
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
        }, labelNode));
      }),
    ));
  },
};

const AccordionGroup: OraComponentConfig = {
  label: "Accordion Group",
  responsiveDefaults: {
    layoutDirection: { mobile: "column" },
  },
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
    headingSize: makeFreeInputField("Heading Size", "px", ["28px", "36px", "44px", "52px", "60px"]),
    titleColor: makeColorField("Title Color", "#2C2C2C"),
    titleSize: makeFreeInputField("Title Size", "px", ["18px", "24px", "28px", "36px", "44px", "50px"]),
    bodyColor: makeColorField("Body Color", "#2C2C2C"),
    bodySize: makeFreeInputField("Body Size", "px", ["14px", "16px", "18px", "20px", "24px", "28px"]),
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
    headingSize: "36px",
    titleColor: "#2C2C2C",
    titleSize: "24px",
    bodyColor: "#2C2C2C",
    bodySize: "16px",
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
    // Puck transforms `text` fields with `contentEditable: true` into React
    // elements (InlineTextField). Pass them straight through to React rather
    // than coercing to strings, otherwise the inline editor's wrapper is
    // erased and the rendered title appears empty.
    const heading = props.heading;
    const hasHeading =
      typeof heading === "string"
        ? heading.trim() !== ""
        : React.isValidElement(heading);
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
      // Puck transforms richtext fields (with `contentEditable: true`) into
      // React elements (InlineEditorWrapper / RichTextRender) before
      // reaching this render function. We must render those elements
      // directly — calling sanitizeRichTextHtml/extractIconFeatureLabel
      // on a React element would erase the body content.
      if (React.isValidElement(value)) {
        return React.createElement(
          "div",
          {
            className: "ora-richtext ora-accordion-body",
            style: {
              ...typoCSS,
              color: bodyColor,
              fontSize: bodySize,
              lineHeight: 1.6,
              padding: `4px 0 8px ${bodyIndent}`,
            },
          },
          value,
        );
      }

      if (typeof value === "string") {
        const safeHtml = sanitizeRichTextHtml(value);
        return React.createElement("div", {
          className: "ora-richtext ora-accordion-body",
          style: {
            ...typoCSS,
            color: bodyColor,
            fontSize: bodySize,
            lineHeight: 1.6,
            padding: `4px 0 8px ${bodyIndent}`,
          },
        },
        React.createElement("style", null, RICH_TEXT_EMBEDDED_STYLES + `\n.ora-accordion-body .tiptap, .ora-accordion-body .ProseMirror { min-height: 0 !important; }`),
        React.createElement("div", { dangerouslySetInnerHTML: { __html: safeHtml } }));
      }

      const plain = extractIconFeatureLabel(value).trim();
      return React.createElement("div", {
        style: {
          ...typoCSS,
          color: bodyColor,
          fontSize: bodySize,
          lineHeight: 1.6,
          padding: `4px 0 8px ${bodyIndent}`,
        },
      }, plain);
    };

    // AccordionItem sub-component with toggle state
    const AccordionItem = ({ row, i, isDefaultOpen }: { row: Record<string, unknown>; i: number; isDefaultOpen: boolean }) => {
      const [isOpen, setIsOpen] = React.useState(isDefaultOpen);
      return React.createElement("div", {
        style: {
          borderBottom: dividerWidth > 0 ? `${dividerWidth}px solid ${dividerColor}` : undefined,
          padding: `${itemPaddingY} 0`,
        },
      },
      React.createElement("div", {
        onClick: () => setIsOpen((v) => !v),
        role: "button",
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsOpen((v) => !v); } },
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: titleColor,
          fontSize: titleSize,
          lineHeight: 1.25,
          fontWeight: 400,
          padding: "4px 0",
          userSelect: "none",
        },
      },
      React.createElement("span", { style: { color: titleColor, flex: 1, minWidth: 0 } }, row.title as React.ReactNode),
      React.createElement(ChevronDown, {
        size: iconSize,
        color: iconColor,
        strokeWidth: iconStroke,
        style: {
          transition: "transform 0.2s ease",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          flexShrink: 0,
        },
      })),
      isOpen && React.createElement("div", {
        style: {
          borderBottom: activeLineWidth > 0 ? `${activeLineWidth}px solid ${activeLineColor}` : undefined,
        },
      }, renderBody(row.body)));
    };

    return styledRender(props, React.createElement("div", {
      style: { display: "flex", flexDirection: "column", gap: 0 },
    },
      hasHeading
        ? React.createElement("h3", {
            style: {
              margin: "0 0 12px 0",
              color: headingColor,
              fontSize: headingSize,
              lineHeight: 1.1,
              fontWeight: 400,
            },
          }, heading as React.ReactNode)
        : null,
      ...rows.map((row, i) =>
        React.createElement(AccordionItem, {
          key: i,
          row,
          i,
          isDefaultOpen: i === defaultOpenIndex,
        })
      ),
    ));
  },
};

// ─── Accordion — Expandable section with slot content ────────────────────

const Accordion: OraComponentConfig = {
  label: "Accordion",
  fields: {
    "accordion-content": { type: "slot", disallow: ["Section"] },
    title: { type: "text", label: "Title", contentEditable: true },
    defaultOpen: createCustomSelectField("Default Open", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    ...spacingBorderFields,
  },
  defaultProps: { "accordion-content": [], title: "Light Palette", defaultOpen: "yes", ...spacingBorderDefaults },
  render: (props) => {
    const isOpen = (props.defaultOpen as string) === "yes";
    return styledRender(props, React.createElement("details", { open: isOpen || undefined, className: "group border-b border-[#E8E4DF]" },
      React.createElement("summary", { className: "flex cursor-pointer items-center justify-between py-5 list-none" },
        React.createElement("h3", { className: "text-xl sm:text-2xl font-light text-[#1A1A1A]" }, props.title as string),
        React.createElement("span", { className: "text-[#2C2C2C] text-xl transition-transform group-open:rotate-180" }, "∧"),
      ),
      React.createElement("div", { className: "pb-6" },
        typeof (props as Record<string, unknown>)["accordion-content"] === "function"
          ? (((props as Record<string, unknown>)["accordion-content"]) as () => React.ReactNode)()
          : null,
      ),
    ));
  },
};


// ─── Scroll Indicator ────────────────────────────────────────────────────────
// Absolutely positioned within a Section. Shows an animated arrow + label.
// Set vertical = bottom/top/center and horizontal = left/center/right.

const ScrollIndicator: OraComponentConfig = {
  label: "Scroll Indicator",
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
      sm: { w: 30, h: 56, arrow: 20 },
      md: { w: 36, h: 72, arrow: 26 },
      lg: { w: 44, h: 90, arrow: 32 },
    };
    const dim = sizePx[size] ?? sizePx.md;

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

    // ── Downward arrow SVG (line + arrowhead) ───────────────────────────────
    const arrowSvg = React.createElement("svg", {
      width: dim.arrow * 0.5,
      height: dim.arrow,
      viewBox: "0 0 12 24",
      fill: "none",
      stroke: arrowColor,
      strokeWidth: 1.5,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      "aria-hidden": "true",
    },
      React.createElement("line", { x1: "6", y1: "1", x2: "6", y2: "20" }),
      React.createElement("polyline", { points: "2 16 6 22 10 16" }),
    );

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

    // Use a flow-based wrapper so the indicator is visible and selectable in
    // the builder. We render two elements:
    //   1) A static placeholder with the indicator's footprint (height = dim.h
    //      + label gap). This gives Puck's wrapping <div> a non-zero size so
    //      the block is clickable on the canvas and the floating toolbar can
    //      anchor to it.
    //   2) An absolutely-positioned visual that pins to the Section bounds
    //      (the nearest positioned ancestor — Section sets position:relative).
    //
    // Both render the same content; the static one is invisible (opacity 0,
    // pointer-events none) so the visible indicator only appears via the
    // pinned absolute layer.
    const visualLink = React.createElement(
      "a",
      {
        href,
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
          cursor: "pointer",
        },
        "aria-label": labelText || "Scroll",
      },
      ...children,
    );

    const pinnedStyle: React.CSSProperties = {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: vPos === "bottom" ? vOff : undefined,
      top: vPos === "top" ? vOff : undefined,
      display: "flex",
      justifyContent: hPos === "left" ? "flex-start" : hPos === "right" ? "flex-end" : "center",
      paddingLeft: hPos === "left" ? hOff : undefined,
      paddingRight: hPos === "right" ? hOff : undefined,
      zIndex: 10,
      pointerEvents: "auto",
    };
    if (vPos === "center") {
      pinnedStyle.top = "50%";
      pinnedStyle.transform = "translateY(-50%)";
    }

    // The placeholder gets the indicator's intrinsic size so Puck's selectable
    // wrapper has a real footprint. Visually hidden so it doesn't duplicate
    // the indicator. `aria-hidden` to keep it out of the AT tree.
    const placeholderStyle: React.CSSProperties = {
      visibility: "hidden",
      pointerEvents: "none",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      width: "100%",
      minHeight: dim.h + (labelText ? 30 : 0),
    };

    return React.createElement(
      "div",
      {
        style: {
          // Width: 100% so the placeholder occupies a row in the parent
          // flex/flow, giving Puck's wrapper a visible footprint that can
          // be clicked and anchored by the floating toolbar.
          width: "100%",
        },
      },
      React.createElement(
        "div",
        { style: placeholderStyle, "aria-hidden": true },
        visualLink,
      ),
      React.createElement("div", { style: pinnedStyle }, visualLink),
    );
  },
};


// ─── Stats Grid ───────────────────────────────────────────────────────────────
// A configurable stat grid. Each stat item has its own value/label typography,
// individual border control (left / right / top / bottom), border color/width/
// radius, and padding. The container controls columns and gap. Font family is
// inherited from the canvas/renderer root (URW Geometric brand font) and is
// not configurable per-block.

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

const StatsGrid: OraComponentConfig = {
  label: "Stats Grid",
  responsiveDefaults: {
    columns: { mobile: "1" },
  },
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
    // NOTE: `fontFamily` is intentionally not configurable. URW Geometric is
    // enforced via CSS inheritance from the canvas/renderer root.
    // See spec: branded-font-enforcement (Requirements 2.4, 2.5).

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

const contactLocationPickerField = {
  type: "custom" as const,
  label: "Locations",
  render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: ContactLocationItem[]) => void; readOnly?: boolean }) => {
    const apiKey = (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY : "") || "";
    return React.createElement(ContactLocationPicker, {
      value: (value as ContactLocationItem[]) ?? [],
      onChange,
      readOnly,
      apiKey,
      centerLat: DEFAULT_DUBAI_LAT,
      centerLng: 55.2708,
      zoom: 10,
    });
  },
};

const LocationMap: OraComponentConfig = {
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
// CONTACT LOCATIONS MAP — Side-by-side address panel + Google Map
// ═══════════════════════════════════════════════════════════════════════════════

const ContactLocationsMap: OraComponentConfig = {
  label: "Contact Locations Map",
  responsiveDefaults: {
    layoutDirection: { mobile: "column" },
  },
  fields: {
    // ── Locations (custom picker — click map to add) ─────────────────────
    locations: contactLocationPickerField,

    // ── Section / container ─────────────────────────────────────────────
    containerMaxWidth: makeFreeInputField("Container Max Width", "px", ["100%", "1200px", "1400px", "1600px"], "Constrains the section. Use 100% for an edge-to-edge layout."),
    containerPaddingX: makeFreeInputField("Container Padding X", "px", ["0px", "16px", "24px", "32px", "48px"]),
    containerPaddingY: makeFreeInputField("Container Padding Y", "px", ["0px", "24px", "48px", "64px", "96px"]),
    sectionBgColor: createCustomSelectField("Section Background", [{ label: "Transparent", value: "transparent" }, ...ORA_SOLID_BG_OPTIONS]),

    // ── Panel (left/right card list) ─────────────────────────────────────
    panelSide: createToggleField("Panel Side", [
      { label: "Left", value: "left" },
      { label: "Right", value: "right" },
    ]),
    panelWidth: makeFreeInputField("Panel Width", "px", ["340px", "380px", "420px", "460px", "520px"]),
    panelBgColor: createCustomSelectField("Panel Background", ORA_SOLID_BG_OPTIONS),
    panelPaddingX: makeFreeInputField("Panel Padding X", "px", ["16px", "24px", "32px", "40px", "48px"]),
    panelPaddingY: makeFreeInputField("Panel Padding Y", "px", ["16px", "24px", "32px", "40px", "48px"]),
    panelGap: makeFreeInputField("Spacing Between Locations", "px", ["12px", "16px", "20px", "24px", "32px"]),
    panelOffsetTop: makeFreeInputField("Panel Offset Top", "px", ["0px", "16px", "24px", "40px", "64px", "96px"], "Distance from the map's top edge."),
    panelOffsetBottom: makeFreeInputField("Panel Offset Bottom", "px", ["0px", "16px", "24px", "40px", "64px", "96px"], "Distance from the map's bottom edge."),
    panelOffsetSide: makeFreeInputField("Panel Offset Side", "px", ["0px", "16px", "24px", "40px", "64px", "96px"], "Distance from the chosen side (left or right)."),
    panelBorderRadius: makeSliderField("Panel Border Radius", 0, 32, "px"),
    panelShadow: createToggleField("Panel Drop Shadow", [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ]),
    showDividers: createToggleField("Show Dividers", [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ]),
    dividerColor: createCustomSelectField("Divider Color", ORA_SOLID_BG_OPTIONS),
    stackBreakpoint: makeSliderField("Stack Below (width)", 480, 1280, "px", "Layout stacks (panel above map) below this viewport width."),

    // ── Map ──────────────────────────────────────────────────────────────
    apiKeyOverride: { type: "text", label: "API Key Override (optional)" },
    centerLat: { type: "number", label: "Center Latitude" },
    centerLng: { type: "number", label: "Center Longitude" },
    zoom: makeSliderField("Zoom", 1, 20, ""),
    mapHeight: makeFreeInputField("Map Height", "px", ["480px", "560px", "640px", "720px", "80vh", "100vh"]),
    mapStyleJson: { type: "textarea", label: "Map Style JSON (Snazzy Maps export)" },
    mapId: { type: "text", label: "Cloud Map ID (optional)" },

    // ── Per-location styling ─────────────────────────────────────────────
    titleColor: createCustomSelectField("Title Color", ORA_TEXT_COLOR_OPTIONS),
    highlightTitleColor: createCustomSelectField("Highlighted Title Color", ORA_TEXT_COLOR_OPTIONS),
    badgeColor: createCustomSelectField("Badge Color", ORA_TEXT_COLOR_OPTIONS),
    addressColor: createCustomSelectField("Address Color", ORA_TEXT_COLOR_OPTIONS),
    hoursColor: createCustomSelectField("Hours Color", ORA_TEXT_COLOR_OPTIONS),

    // ── Get Direction button ─────────────────────────────────────────────
    ctaBgColor: createCustomSelectField("Button Background", ORA_SOLID_BG_OPTIONS),
    ctaTextColor: createCustomSelectField("Button Text", ORA_TEXT_COLOR_OPTIONS),
    ctaBorderColor: createCustomSelectField("Button Border", ORA_SOLID_BG_OPTIONS),
    ctaIconImage: imageUploadField,

    // ── Default pin icons ────────────────────────────────────────────────
    defaultPinIcon: imageUploadField,
    defaultPinIconHighlight: imageUploadField,
    pinIconWidth: makeSliderField("Pin Width", 16, 96, "px"),
    pinIconHeight: makeSliderField("Pin Height", 16, 96, "px"),

    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    containerMaxWidth: "100%",
    containerPaddingX: "0px",
    containerPaddingY: "0px",
    sectionBgColor: "transparent",

    panelSide: "left",
    panelWidth: "420px",
    panelBgColor: "#FFFFFF",
    panelPaddingX: "40px",
    panelPaddingY: "40px",
    panelGap: "24px",
    panelOffsetTop: "40px",
    panelOffsetBottom: "40px",
    panelOffsetSide: "40px",
    panelBorderRadius: 0,
    panelShadow: "no",
    showDividers: "yes",
    dividerColor: "#E8E4DF",
    stackBreakpoint: 900,

    apiKeyOverride: "",
    centerLat: DEFAULT_DUBAI_LAT,
    centerLng: 55.2708,
    zoom: 10,
    mapHeight: "100vh",
    mapStyleJson: "",
    mapId: "",

    locations: [
      {
        title: "ORA Main Office",
        badge: "",
        address: "Offices 5, One Central, Sheikh Zayed Road, Dubai, United Arab Emirates.",
        hours: "",
        lat: 25.2218,
        lng: 55.2754,
        ctaLabel: "Get Direction",
        ctaUrl: "https://maps.google.com/?q=One+Central+Dubai",
        isHighlight: "yes",
        pinIcon: "",
        pinIconHighlight: "",
      },
      {
        title: "Dubai Sales Office",
        badge: "Coming Soon",
        address: "804 Jumeirah Beach Road, Dubai, United Arab Emirates.",
        hours: "Monday - Sunday: 10:00 AM - 7:00 PM",
        lat: 25.2106,
        lng: 55.2375,
        ctaLabel: "Get Direction",
        ctaUrl: "",
        isHighlight: "no",
        pinIcon: "",
        pinIconHighlight: "",
      },
      {
        title: "Abu Dhabi Sales Office",
        badge: "Coming Soon",
        address: "103 Al Qana, Walk at Bain Al Jessrain area, Block N, Abu Dhabi, United Arab Emirates.",
        hours: "",
        lat: 24.4288,
        lng: 54.4862,
        ctaLabel: "",
        ctaUrl: "",
        isHighlight: "no",
        pinIcon: "",
        pinIconHighlight: "",
      },
    ] as ContactLocationItem[],

    titleColor: "#2C2C2C",
    highlightTitleColor: "#11A6CC",
    badgeColor: "#11A6CC",
    addressColor: "#2C2C2C",
    hoursColor: "#2C2C2C",

    ctaBgColor: "#FFFFFF",
    ctaTextColor: "#2C2C2C",
    ctaBorderColor: "#2C2C2C",
    ctaIconImage: "",

    defaultPinIcon: "",
    defaultPinIconHighlight: "",
    pinIconWidth: 32,
    pinIconHeight: 40,

    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    return styledRender(
      props,
      React.createElement(ContactLocationsMapRuntime, {
        containerMaxWidth: (props.containerMaxWidth as string) || "100%",
        containerPaddingX: (props.containerPaddingX as string) || "0px",
        containerPaddingY: (props.containerPaddingY as string) || "0px",
        sectionBgColor: (props.sectionBgColor as string) || "transparent",
        panelSide: ((props.panelSide as string) === "right" ? "right" : "left"),
        panelWidth: (props.panelWidth as string) || "420px",
        panelBgColor: (props.panelBgColor as string) || "#FFFFFF",
        panelPaddingX: (props.panelPaddingX as string) || "40px",
        panelPaddingY: (props.panelPaddingY as string) || "40px",
        panelGap: (props.panelGap as string) || "24px",
        panelOffsetTop: (props.panelOffsetTop as string) || "40px",
        panelOffsetBottom: (props.panelOffsetBottom as string) || "40px",
        panelOffsetSide: (props.panelOffsetSide as string) || "40px",
        panelBorderRadius: Number(props.panelBorderRadius) || 0,
        panelShadow: ((props.panelShadow as string) === "yes" ? "yes" : "no"),
        showDividers: ((props.showDividers as string) === "no" ? "no" : "yes"),
        dividerColor: (props.dividerColor as string) || "#E8E4DF",
        stackBreakpoint: Number(props.stackBreakpoint) || 900,

        apiKeyOverride: props.apiKeyOverride as string,
        centerLat: Number(props.centerLat) || DEFAULT_DUBAI_LAT,
        centerLng: Number(props.centerLng) || 55.2708,
        zoom: Number(props.zoom) || 10,
        mapHeight: (props.mapHeight as string) || "100vh",
        mapStyleJson: (props.mapStyleJson as string) || "",
        mapId: (props.mapId as string) || "",

        titleColor: (props.titleColor as string) || "#2C2C2C",
        highlightTitleColor: (props.highlightTitleColor as string) || "#11A6CC",
        badgeColor: (props.badgeColor as string) || "#11A6CC",
        addressColor: (props.addressColor as string) || "#2C2C2C",
        hoursColor: (props.hoursColor as string) || "#2C2C2C",

        ctaBgColor: (props.ctaBgColor as string) || "#FFFFFF",
        ctaTextColor: (props.ctaTextColor as string) || "#2C2C2C",
        ctaBorderColor: (props.ctaBorderColor as string) || "#2C2C2C",
        ctaIconImage: (props.ctaIconImage as string) || "",

        defaultPinIcon: (props.defaultPinIcon as string) || "",
        defaultPinIconHighlight: (props.defaultPinIconHighlight as string) || "",
        pinIconWidth: Number(props.pinIconWidth) || 32,
        pinIconHeight: Number(props.pinIconHeight) || 40,

        locations: ((props.locations as ContactLocationItem[]) ?? []).map((l) => ({
          ...l,
          lat: Number(l.lat) || 0,
          lng: Number(l.lng) || 0,
        })),
      }),
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURED PROJECTS — pulls cards from /api/projects/public
// ═══════════════════════════════════════════════════════════════════════════════

const FeaturedProjects: OraComponentConfig = {
  responsiveDefaults: {
    columns: { mobile: 1 },
  },
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

const FeaturedCommunities: OraComponentConfig = {
  responsiveDefaults: {
    columns: { mobile: 1 },
  },
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

const ProjectSection: OraComponentConfig = {
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

// ─── ImageCarousel ───────────────────────────────────────────────────────────
// Full-width image carousel with autoplay, dots, and overlay support.
// Designed for hero sections in project landing pages.

const ImageCarousel: OraComponentConfig = {
  label: "Image Carousel",
  fields: {
    images: {
      type: "custom",
      label: "Images",
      render: ({ value, onChange }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => {
        const items = (Array.isArray(value) ? value : []) as string[];
        const [showLibrary, setShowLibrary] = React.useState(false);

        const addImage = () => {
          const inp = document.createElement("input");
          inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
          inp.onchange = async (ev) => {
            const files = (ev.target as HTMLInputElement).files;
            if (!files) return;
            const newUrls: string[] = [];
            for (const file of Array.from(files)) {
              const form = new FormData();
              form.append("file", file);
              try {
                const res = await fetch("/api/media", { method: "POST", body: form, credentials: "include" });
                if (!res.ok) continue;
                const data = await res.json();
                const url = data.data?.storageUrl ?? data.data?.storage_url ?? "";
                if (url) newUrls.push(url);
              } catch { /* skip */ }
            }
            if (newUrls.length > 0) onChange([...items, ...newUrls]);
          };
          inp.click();
        };

        const addUrl = () => {
          const url = prompt("Enter image URL:");
          if (url?.trim()) onChange([...items, url.trim()]);
        };

        const removeAt = (idx: number) => {
          onChange(items.filter((_, i) => i !== idx));
        };

        const moveUp = (idx: number) => {
          if (idx === 0) return;
          const next = [...items];
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          onChange(next);
        };

        const moveDown = (idx: number) => {
          if (idx >= items.length - 1) return;
          const next = [...items];
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          onChange(next);
        };

        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          items.map((url, i) =>
            React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 4, background: "#F9F7F5", border: "1px solid #E8E4DF", padding: 4 } },
              React.createElement("img", { src: url, alt: `Slide ${i + 1}`, style: { width: 48, height: 32, objectFit: "cover" } }),
              React.createElement("span", { style: { flex: 1, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, url.split("/").pop()),
              React.createElement("button", { type: "button", onClick: () => moveUp(i), style: { border: "none", background: "none", cursor: "pointer", fontSize: 11 }, title: "Move up" }, "↑"),
              React.createElement("button", { type: "button", onClick: () => moveDown(i), style: { border: "none", background: "none", cursor: "pointer", fontSize: 11 }, title: "Move down" }, "↓"),
              React.createElement("button", { type: "button", onClick: () => removeAt(i), style: { border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#c00" }, title: "Remove" }, "✕"),
            )
          ),
          React.createElement("div", { style: { display: "flex", gap: 4 } },
            React.createElement("button", {
              type: "button", onClick: addImage,
              style: { flex: 1, height: 30, border: "1px solid #E8E4DF", background: "#F9F7F5", fontSize: 11, cursor: "pointer" },
            }, "Upload"),
            React.createElement("button", {
              type: "button", onClick: () => setShowLibrary(true),
              style: { flex: 1, height: 30, border: "1px solid #E8E4DF", background: "#F9F7F5", fontSize: 11, cursor: "pointer" },
            }, "From Library"),
            React.createElement("button", {
              type: "button", onClick: addUrl,
              style: { flex: 1, height: 30, border: "1px solid #E8E4DF", background: "#F9F7F5", fontSize: 11, cursor: "pointer" },
            }, "URL"),
          ),
          showLibrary && React.createElement(MediaLibraryPicker, {
            multiple: true,
            onSelect: (urls: string[]) => { onChange([...items, ...urls]); setShowLibrary(false); },
            onClose: () => setShowLibrary(false),
          }),
        );
      },
    },
    autoplay: createToggleField("Autoplay", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    interval: createCustomSelectField("Interval", [
      { label: "3 seconds", value: "3000" },
      { label: "4 seconds", value: "4000" },
      { label: "5 seconds", value: "5000" },
      { label: "7 seconds", value: "7000" },
      { label: "10 seconds", value: "10000" },
    ]),
    showDots: createToggleField("Show Dots", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    showArrows: createToggleField("Show Arrows", [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]),
    height: createCustomSelectField("Height", [
      { label: "Medium (400px)", value: "400px" },
      { label: "Large (600px)", value: "600px" },
      { label: "X-Large (800px)", value: "800px" },
      { label: "Half screen (50vh)", value: "50vh" },
      { label: "Two-thirds (66vh)", value: "66vh" },
      { label: "Three-quarters (75vh)", value: "75vh" },
      { label: "Full screen (100vh)", value: "100vh" },
    ]),
    objectFit: createCustomSelectField("Image Fit", [
      { label: "Cover", value: "cover" },
      { label: "Contain", value: "contain" },
    ]),
    overlayColor: makeColorField("Overlay Color", "#000000", "Semi-transparent overlay on images."),
    overlayOpacity: createCustomSelectField("Overlay Opacity", [
      { label: "None", value: "0" },
      { label: "10%", value: "0.1" },
      { label: "20%", value: "0.2" },
      { label: "30%", value: "0.3" },
      { label: "40%", value: "0.4" },
      { label: "50%", value: "0.5" },
      { label: "60%", value: "0.6" },
    ]),
    transition: createCustomSelectField("Transition", [
      { label: "Fade", value: "fade" },
      { label: "Slide", value: "slide" },
    ]),
    ...spacingBorderFields,
  },
  defaultProps: {
    images: [],
    autoplay: "yes",
    interval: "5000",
    showDots: "yes",
    showArrows: "yes",
    height: "75vh",
    objectFit: "cover",
    overlayColor: "#000000",
    overlayOpacity: "0.3",
    transition: "fade",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const images = (Array.isArray(props.images) ? props.images : []) as string[];
    const autoplay = (props.autoplay as string) === "yes";
    const interval = Number(props.interval) || 5000;
    const showDots = (props.showDots as string) === "yes";
    const showArrows = (props.showArrows as string) === "yes";
    const height = (props.height as string) || "75vh";
    const objectFit = (props.objectFit as string) || "cover";
    const overlayColor = (props.overlayColor as string) || "#000000";
    const overlayOpacity = Number(props.overlayOpacity) || 0;
    const transition = (props.transition as string) || "fade";

    // Use a simple state-based carousel via a wrapper component
    return styledRender(props, React.createElement(ImageCarouselRuntime, {
      images, autoplay, interval, showDots, showArrows, height, objectFit,
      overlayColor, overlayOpacity, transition,
    }));
  },
};


// ─── Gallery ─────────────────────────────────────────────────────────────────
// Multi-image gallery with grid and carousel display modes, configurable
// columns/items-per-view, gap, image sizing, and a built-in lightbox overlay.

const Gallery: OraComponentConfig = {
  label: "Gallery",
  fields: {
    images: {
      type: "custom",
      label: "Images",
      render: ({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) => {
        const items = (Array.isArray(value) ? value : []) as GalleryImage[];
        const [showLibrary, setShowLibrary] = React.useState(false);

        const addImages = () => {
          const inp = document.createElement("input");
          inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
          inp.onchange = async (ev) => {
            const files = (ev.target as HTMLInputElement).files;
            if (!files) return;
            const newItems: GalleryImage[] = [];
            for (const file of Array.from(files)) {
              const form = new FormData();
              form.append("file", file);
              try {
                const res = await fetch("/api/media", { method: "POST", body: form, credentials: "include" });
                if (!res.ok) continue;
                const data = await res.json();
                const url = data.data?.storageUrl ?? data.data?.storage_url ?? "";
                if (url) newItems.push({ src: url, alt: file.name.replace(/\.[^.]+$/, "") });
              } catch { /* skip */ }
            }
            if (newItems.length > 0) onChange([...items, ...newItems]);
          };
          inp.click();
        };

        const addUrl = () => {
          const url = prompt("Enter image URL:");
          if (url?.trim()) onChange([...items, { src: url.trim(), alt: "" }]);
        };

        const removeAt = (idx: number) => {
          onChange(items.filter((_, i) => i !== idx));
        };

        const moveUp = (idx: number) => {
          if (idx === 0) return;
          const next = [...items];
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          onChange(next);
        };

        const moveDown = (idx: number) => {
          if (idx >= items.length - 1) return;
          const next = [...items];
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          onChange(next);
        };

        return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          items.map((img, i) =>
            React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 4, background: "#F9F7F5", border: "1px solid #E8E4DF", padding: 4 } },
              React.createElement("img", { src: img.src, alt: img.alt || `Image ${i + 1}`, style: { width: 48, height: 32, objectFit: "cover" } }),
              React.createElement("span", { style: { flex: 1, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, img.src.split("/").pop()),
              React.createElement("button", { type: "button", onClick: () => moveUp(i), style: { border: "none", background: "none", cursor: "pointer", fontSize: 11 }, title: "Move up" }, "↑"),
              React.createElement("button", { type: "button", onClick: () => moveDown(i), style: { border: "none", background: "none", cursor: "pointer", fontSize: 11 }, title: "Move down" }, "↓"),
              React.createElement("button", { type: "button", onClick: () => removeAt(i), style: { border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#c00" }, title: "Remove" }, "✕"),
            )
          ),
          React.createElement("div", { style: { display: "flex", gap: 4 } },
            React.createElement("button", {
              type: "button", onClick: addImages,
              style: { flex: 1, height: 30, border: "1px solid #E8E4DF", background: "#F9F7F5", fontSize: 11, cursor: "pointer" },
            }, "Upload"),
            React.createElement("button", {
              type: "button", onClick: () => setShowLibrary(true),
              style: { flex: 1, height: 30, border: "1px solid #E8E4DF", background: "#F9F7F5", fontSize: 11, cursor: "pointer" },
            }, "From Library"),
            React.createElement("button", {
              type: "button", onClick: addUrl,
              style: { flex: 1, height: 30, border: "1px solid #E8E4DF", background: "#F9F7F5", fontSize: 11, cursor: "pointer" },
            }, "URL"),
          ),
          showLibrary && React.createElement(MediaLibraryPicker, {
            multiple: true,
            onSelect: (urls: string[]) => {
              const newItems = urls.map((url) => ({ src: url, alt: "" }));
              onChange([...items, ...newItems]);
              setShowLibrary(false);
            },
            onClose: () => setShowLibrary(false),
          }),
        );
      },
    },
    mode: createToggleField("Display Mode", [
      { label: "Grid", value: "grid" },
      { label: "Carousel", value: "carousel" },
    ], "Grid shows all images; Carousel scrolls horizontally."),
    columns: createCustomSelectField("Columns (Grid)", [
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "5", value: "5" },
      { label: "6", value: "6" },
    ], "Number of columns in grid mode."),
    itemsPerView: createCustomSelectField("Items Per View (Carousel)", [
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "5", value: "5" },
    ], "Number of visible items in carousel mode."),
    gap: createCustomSelectField("Gap", [
      { label: "None", value: "0" },
      { label: "4px", value: "4" },
      { label: "8px", value: "8" },
      { label: "12px", value: "12" },
      { label: "16px", value: "16" },
      { label: "20px", value: "20" },
      { label: "24px", value: "24" },
      { label: "32px", value: "32" },
    ], "Space between images."),
    imageHeight: createCustomSelectField("Image Height", [
      { label: "Small (180px)", value: "180px" },
      { label: "Medium (240px)", value: "240px" },
      { label: "Large (320px)", value: "320px" },
      { label: "X-Large (400px)", value: "400px" },
      { label: "Auto", value: "auto" },
    ], "Height of each image thumbnail."),
    objectFit: createCustomSelectField("Image Fit", [
      { label: "Cover", value: "cover" },
      { label: "Contain", value: "contain" },
    ]),
    showArrows: createToggleField("Show Arrows", [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ], "Navigation arrows for carousel mode."),
    enableLightbox: createToggleField("Lightbox", [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ], "Click image to open full-screen lightbox with navigation."),
    ...spacingBorderFields,
  },
  defaultProps: {
    images: [],
    mode: "carousel",
    columns: "4",
    itemsPerView: "4",
    gap: "12",
    imageHeight: "280px",
    objectFit: "cover",
    borderRadius: "0",
    showArrows: "yes",
    enableLightbox: "yes",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const images = (Array.isArray(props.images) ? props.images : []) as GalleryImage[];
    const mode = (props.mode as string) === "grid" ? "grid" : "carousel";
    const columns = Number(props.columns) || 4;
    const itemsPerView = Number(props.itemsPerView) || 4;
    const gap = Number(props.gap) || 12;
    const imageHeight = (props.imageHeight as string) || "280px";
    const objectFit = (props.objectFit as string) === "contain" ? "contain" : "cover";
    const borderRadius = Number(props.borderRadius) || 0;
    const showArrows = (props.showArrows as string) !== "no";
    const enableLightbox = (props.enableLightbox as string) !== "no";

    return styledRender(props, React.createElement(GalleryRuntime, {
      images, mode, columns, gap, imageHeight, objectFit,
      borderRadius, showArrows, enableLightbox, itemsPerView,
    }));
  },
};


// ─── Experience Launcher (iframe dialog) ─────────────────────────────────────
// Renders a styled CTA that opens a full-viewport dialog containing an iframe
// pointing at an external interactive experience (3D walkthrough, masterplan,
// etc.). The embedded app owns its own navigation — we don't try to observe or
// drive it across origins.

const ExperienceLauncher: OraComponentConfig = {
  label: "3D Experience Launcher",
  fields: {
    // ── Content ────────────────────────────────────────────────────────────
    buttonLabel: { type: "text", label: "Button Label", contentEditable: true },
    subtitle: { type: "text", label: "Subtitle (optional)" },
    posterImage: imageUploadField,

    // ── Target ─────────────────────────────────────────────────────────────
    iframeUrl: { type: "text", label: "Iframe URL" },
    iframeTitle: { type: "text", label: "Dialog Title" },

    // ── Dialog size ────────────────────────────────────────────────────────
    dialogWidthPct: makeSliderField(
      "Dialog Width (%)",
      50,
      100,
      "%",
      "Viewport width of the dialog. 95 matches the reference design.",
    ),
    dialogHeightPct: makeSliderField(
      "Dialog Height (%)",
      50,
      100,
      "%",
      "Viewport height of the dialog.",
    ),

    // ── Button styling ─────────────────────────────────────────────────────
    launcherStyle: {
      type: "radio",
      label: "Button Style",
      options: [
        { label: "3D Tilt", value: "3d-tilt" },
        { label: "Glass", value: "glass" },
        { label: "Flat", value: "flat" },
      ],
    },
    accentColor: makeColorField("Accent Color", "#2C2C2C", "Button background tint."),
    textColor: makeColorField("Text Color", "#FFFFFF"),
    cornerRadius: makeSliderField("Corner Radius", 0, 32, "px"),

    // ── Layout ─────────────────────────────────────────────────────────────
    fullWidth: {
      type: "radio",
      label: "Full Width",
      options: [
        { label: "No", value: "no" },
        { label: "Yes", value: "yes" },
      ],
    },
    alignment: {
      type: "radio",
      label: "Alignment",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },

    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    buttonLabel: "Start Experience",
    subtitle: "Explore in 3D",
    posterImage: "",
    iframeUrl: "https://baynsalestool.ora-uae.com/home",
    iframeTitle: "Bayn · 3D Experience",
    dialogWidthPct: "95",
    dialogHeightPct: "95",
    launcherStyle: "3d-tilt",
    accentColor: "#2C2C2C",
    textColor: "#FFFFFF",
    cornerRadius: "4",
    fullWidth: "no",
    alignment: "left",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const widthPct = Number(props.dialogWidthPct);
    const heightPct = Number(props.dialogHeightPct);
    const corner = Number(props.cornerRadius);
    return styledRender(
      props,
      React.createElement(ExperienceLauncherRuntime, {
        buttonLabel: (props.buttonLabel as string) || "Start Experience",
        subtitle: (props.subtitle as string) || undefined,
        posterImage: (props.posterImage as string) || undefined,
        iframeUrl: (props.iframeUrl as string) || "",
        iframeTitle: (props.iframeTitle as string) || "3D Experience",
        dialogWidthPct: Number.isFinite(widthPct) ? widthPct : 95,
        dialogHeightPct: Number.isFinite(heightPct) ? heightPct : 95,
        style: ((props.launcherStyle as string) || "3d-tilt") as LauncherStyle,
        accentColor: (props.accentColor as string) || "#2C2C2C",
        textColor: (props.textColor as string) || "#FFFFFF",
        cornerRadius: Number.isFinite(corner) ? corner : 4,
        fullWidth: (props.fullWidth as string) === "yes",
        alignment: ((props.alignment as string) || "left") as "left" | "center" | "right",
      }),
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK LIBRARY — General-purpose marketing blocks (page-builder-block-library)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── CTA — Call-to-action band ─────────────────────────────────────────────────
// A composed conversion band: optional eyebrow, a heading, optional subtext, and
// a primary + optional secondary button over a solid / gradient / image
// background. Render is fully static (no client state) so it is byte-stable.
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 1 — CTA"
// Validates: Requirements 1.1–1.13

// Foreground colors that read as "dark" backgrounds, so an "auto" text color
// resolves to white and meets WCAG AA contrast (Req 1.11). Lower-cased for
// comparison against the resolved hex values.
const CTA_DARK_BG_VALUES = new Set([
  "#2c2c2c", "#1a1a1a", "#111432", "#000000", "#b8956b",
]);

// AA-safe dark fallback painted behind an image background so the default white
// foreground stays readable even before/if the image loads (Req 1.11).
const CTA_IMAGE_FALLBACK_BG = "#1A1A1A";

// The secondary button's namespaced field keys, used by `resolveFields` to show
// or hide the whole group behind the `secondaryEnabled` toggle.
const CTA_SECONDARY_FIELD_KEYS = Object.keys(buttonFields("secondary"));

const CTA: OraComponentConfig = {
  label: "CTA",
  fields: {
    // ── Content ──────────────────────────────────────────────────────────
    eyebrow: { type: "text", label: "Eyebrow (optional)", contentEditable: true },
    heading: { type: "text", label: "Heading", contentEditable: true },
    subtext: { type: "textarea", label: "Subtext (optional)", contentEditable: true },

    // ── Background ───────────────────────────────────────────────────────
    bgMode: createToggleField("Background Mode", [
      { label: "Solid", value: "solid" },
      { label: "Gradient", value: "gradient" },
      { label: "Image", value: "image" },
    ], "Solid color, two-color gradient, or a background image."),
    bgColor: createCustomSelectField("Background Color", ORA_SOLID_BG_OPTIONS),
    gradientFrom: createCustomSelectField("Gradient Color 1", ORA_GRADIENT_OPTIONS),
    gradientTo: createCustomSelectField("Gradient Color 2", ORA_GRADIENT_OPTIONS),
    gradientDirection: createCustomSelectField("Gradient Direction", [
      { label: "Top → Bottom", value: "to bottom" },
      { label: "Bottom → Top", value: "to top" },
      { label: "Left → Right", value: "to right" },
      { label: "Right → Left", value: "to left" },
      { label: "Top Left → Bottom Right", value: "to bottom right" },
      { label: "Top Right → Bottom Left", value: "to bottom left" },
    ]),
    bgImage: imageUploadField,
    bgPosition: createCustomSelectField("Image Position", [
      { label: "Center", value: "center center" },
      { label: "Top", value: "center top" },
      { label: "Bottom", value: "center bottom" },
      { label: "Left", value: "left center" },
      { label: "Right", value: "right center" },
    ], "Which part of the image stays visible when cropped by cover."),

    // ── Foreground ───────────────────────────────────────────────────────
    textColor: createCustomSelectField("Text Color", ORA_TEXT_COLOR_OPTIONS),
    contentAlign: createCustomSelectField("Content Alignment", [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ], "Alignment follows reading direction (flips under RTL)."),

    // ── Primary button (required) ──────────────────────────────────────────
    ...buttonFields("primary"),

    // ── Secondary button (optional) ────────────────────────────────────────
    secondaryEnabled: createToggleField("Secondary Button", [
      { label: "Off", value: "no" },
      { label: "On", value: "yes" },
    ], "Add an optional second button next to the primary."),
    ...buttonFields("secondary"),

    // ── Shared style helpers ───────────────────────────────────────────────
    ...typographyFields,
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    eyebrow: "Get started",
    heading: "Ready to take the next step?",
    subtext: "Join thousands who already made the move. It only takes a minute.",
    bgMode: "solid",
    bgColor: "#111432",
    gradientFrom: "#111432",
    gradientTo: "#01A7C7",
    gradientDirection: "to bottom right",
    bgImage: "",
    bgPosition: "center center",
    textColor: "auto",
    contentAlign: "center",
    // Primary button: a filled ORA-cyan anchor that reads well on the dark default band.
    ...buttonFieldDefaults("primary"),
    primaryText: "Get Started",
    primaryUrl: "/contact",
    primaryBgColor: "#01A7C7",
    primaryBgColorHover: "#018BA6",
    primaryTextColor: "#FFFFFF",
    primaryTextColorHover: "#FFFFFF",
    primaryBorderColor: "#01A7C7",
    primaryBorderColorHover: "#018BA6",
    // Secondary button: disabled by default; styled as a white outline button.
    secondaryEnabled: "no",
    ...buttonFieldDefaults("secondary"),
    secondaryText: "Learn more",
    secondaryUrl: "#",
    secondaryBgColor: "transparent",
    secondaryBgColorHover: "rgba(255,255,255,0.12)",
    secondaryTextColor: "#FFFFFF",
    secondaryTextColorHover: "#FFFFFF",
    secondaryBorderColor: "#FFFFFF",
    secondaryBorderColorHover: "#FFFFFF",
    secondaryBorderSize: "1",
    ...typographyDefaultsHeading,
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
    const secondaryOn = (props.secondaryEnabled as string) === "yes";

    // Background controls follow the selected mode.
    setVisible("bgColor", mode === "solid");
    setVisible("gradientFrom", mode === "gradient");
    setVisible("gradientTo", mode === "gradient");
    setVisible("gradientDirection", mode === "gradient");
    setVisible("bgImage", mode === "image");
    setVisible("bgPosition", mode === "image");

    // The whole secondary button group hides until the toggle is on.
    for (const key of CTA_SECONDARY_FIELD_KEYS) setVisible(key, secondaryOn);

    return nextFields;
  },
  render: (props) => {
    const mode = (props.bgMode as string) || "solid";
    const bgColorRaw = (props.bgColor as string) || "transparent";
    const bgLower = bgColorRaw.trim().toLowerCase();
    const from = (props.gradientFrom as string) || "#111432";
    const to = (props.gradientTo as string) || "#01A7C7";
    const direction = (props.gradientDirection as string) || "to bottom right";
    const bgImage = (props.bgImage as string) || "";
    const bgPosition = (props.bgPosition as string) || "center center";

    // ── Resolve foreground color (Req 1.3, 1.11) ─────────────────────────
    // An image background paints an AA-safe dark fallback, so it counts as dark.
    const gradientDark =
      mode === "gradient" &&
      (CTA_DARK_BG_VALUES.has(from.trim().toLowerCase()) || CTA_DARK_BG_VALUES.has(to.trim().toLowerCase()));
    const isDarkBg =
      mode === "image" ||
      (mode === "solid" && CTA_DARK_BG_VALUES.has(bgLower)) ||
      gradientDark;
    const autoColor = isDarkBg ? "#FFFFFF" : "#1A1A1A";
    const textColorChoice = (props.textColor as string) || "auto";
    const fg = textColorChoice !== "auto" ? textColorChoice : autoColor;

    // ── Background style ─────────────────────────────────────────────────
    const bandBg: React.CSSProperties = {};
    if (mode === "gradient") {
      bandBg.backgroundImage = `linear-gradient(${direction}, ${from}, ${to})`;
    } else if (mode === "image") {
      // AA-safe dark base behind the image keeps the default white text legible.
      bandBg.backgroundColor = CTA_IMAGE_FALLBACK_BG;
      if (bgImage) {
        bandBg.backgroundImage = `url(${bgImage})`;
        bandBg.backgroundSize = "cover";
        bandBg.backgroundPosition = bgPosition;
        bandBg.backgroundRepeat = "no-repeat";
      }
    } else if (bgLower !== "transparent" && bgLower !== "none" && bgLower !== "") {
      bandBg.backgroundColor = bgColorRaw;
    }

    // ── Alignment (logical, so it flips correctly under RTL — Req 1.12) ───
    const align = (props.contentAlign as string) || "center";
    const crossAlignMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };
    const textAlignMap: Record<string, React.CSSProperties["textAlign"]> = { left: "start", center: "center", right: "end" };
    const crossAlign = crossAlignMap[align] || "center";
    const textAlign = textAlignMap[align] || "center";

    // ── Typography for the heading (Req 1.3); foreground color always wins ─
    const typoCSS = typographyPropsToCSS(props);
    // Let the band's logical text-align govern and force the resolved fg color,
    // so drop typography's physical text-align / color from the heading style.
    const typoRest: React.CSSProperties = { ...typoCSS };
    delete typoRest.textAlign;
    delete typoRest.color;

    // ── Optional text elements — omitted entirely when empty (Req 1.4) ────
    const eyebrowText = String(props.eyebrow ?? "").trim();
    const headingText = String(props.heading ?? "").trim();
    const subtextText = String(props.subtext ?? "").trim();

    const eyebrowEl = eyebrowText
      ? React.createElement("div", {
          key: "eyebrow",
          style: {
            margin: 0,
            color: fg,
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase" as const,
          },
        }, eyebrowText)
      : null;

    const headingEl = headingText
      ? React.createElement("h2", {
          key: "heading",
          style: { ...typoRest, color: fg, margin: 0 },
        }, headingText)
      : null;

    const subtextEl = subtextText
      ? React.createElement("p", {
          key: "subtext",
          style: { margin: 0, color: fg, fontSize: "18px", lineHeight: 1.6, maxWidth: "60ch" },
        }, subtextText)
      : null;

    // ── Buttons — semantic anchors with accessible names (Req 1.7, 1.8, 1.10) ─
    const primaryBtn = renderButtonAnchor(props, { prefix: "primary", iconMap: ICON_MAP, key: "primary" });
    const secondaryBtn =
      (props.secondaryEnabled as string) === "yes"
        ? renderButtonAnchor(props, { prefix: "secondary", iconMap: ICON_MAP, key: "secondary" })
        : null;
    const buttonRow =
      primaryBtn || secondaryBtn
        ? React.createElement("div", {
            key: "buttons",
            style: {
              display: "flex",
              flexWrap: "wrap" as const,
              gap: "16px",
              justifyContent: crossAlign,
              alignItems: "center",
              marginTop: "8px",
            },
          }, primaryBtn, secondaryBtn)
        : null;

    const band = React.createElement("div", {
      style: {
        ...bandBg,
        color: fg,
        width: "100%",
        boxSizing: "border-box" as const,
        padding: "64px 24px",
        display: "flex",
        flexDirection: "column" as const,
        alignItems: crossAlign,
        textAlign,
        gap: "16px",
      },
    }, eyebrowEl, headingEl, subtextEl, buttonRow);

    return styledRender(props, band);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// TESTIMONIAL — social-proof block: quote + author + role + avatar + rating
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 2 — Testimonial". Validates Requirements 2.1–2.13.
//
// The block exposes a `layout` selector (single / grid / slider), a
// breakpoint-aware `columns` field (used by the grid/slider layouts), and an
// `items` array whose per-item shape mirrors `TestimonialItem`. It declares
// `responsiveDefaults: { columns: { mobile: 1 } }` so a multi-column grid
// collapses to a single column on mobile (Req 2.13, 12.x), validated at
// construction by `validateResponsiveDefaults` inside `wrapAllRenders`.
//
// Rating values are stored as the string options "0".."5" (the select control's
// value type); `renderStarRating` clamps/coerces them on render.

// Rating select options ("0" = no rating → omitted on render per Req 2.3).
const TESTIMONIAL_RATING_OPTIONS = [
  { label: "No rating", value: "0" },
  { label: "★ 1", value: "1" },
  { label: "★★ 2", value: "2" },
  { label: "★★★ 3", value: "3" },
  { label: "★★★★ 4", value: "4" },
  { label: "★★★★★ 5", value: "5" },
];

/**
 * Render a single testimonial entry as a semantic `<blockquote>` (Req 2.9).
 *
 * Each optional part is omitted entirely when its field is empty (Req 2.3):
 *   - rating  → `renderStarRating` only when the rating is > 0 (Req 2.7)
 *   - avatar  → `<img>` only when a source is set; alt defaults to the author
 *               name when no explicit alt is provided (Req 2.8)
 *   - role    → attribution sub-line only when present
 *
 * `quote` is kept plain text (textarea) per the design's byte-stability note, so
 * no `dangerouslySetInnerHTML` / sanitizer path is taken here. Layout uses
 * logical `textAlign: "start"` so it flips correctly under RTL (Req 2.12).
 *
 * NOTE: this is the shared item renderer consumed by every layout (single,
 * grid, and the slider runtime), so the blockquote markup stays identical
 * across all three.
 */
function renderTestimonialItem(
  item: Record<string, unknown>,
  key: React.Key,
): React.ReactElement {
  const quote = String((item as Partial<TestimonialItem>).quote ?? "").trim();
  const author = String((item as Partial<TestimonialItem>).author ?? "").trim();
  const role = String((item as Partial<TestimonialItem>).role ?? "").trim();
  const avatar = String((item as Partial<TestimonialItem>).avatar ?? "").trim();
  const avatarAlt = String((item as Partial<TestimonialItem>).avatarAlt ?? "").trim();
  const rating = Number((item as Partial<TestimonialItem>).rating) || 0;

  // Rating (Req 2.7) — omitted when 0 / absent (Req 2.3).
  const ratingEl = rating > 0 ? renderStarRating(rating) : null;

  // Quote text (plain text — see note above).
  const quoteEl = quote
    ? React.createElement("p", {
        key: "quote",
        style: { margin: 0, fontSize: "18px", lineHeight: 1.6 },
      }, quote)
    : null;

  // Avatar (Req 2.8) — alt defaults to the author name; omitted when absent.
  const avatarEl = avatar
    ? React.createElement("img", {
        key: "avatar",
        src: avatar,
        alt: avatarAlt || author,
        width: 48,
        height: 48,
        style: {
          width: 48,
          height: 48,
          borderRadius: "9999px",
          objectFit: "cover" as const,
          flexShrink: 0,
        },
      })
    : null;

  // Attribution: author (in a <cite>) + optional role, associated with the
  // quote inside a <footer> (Req 2.9). Omitted entirely when nothing to show.
  const authorEl = author
    ? React.createElement("cite", {
        key: "author",
        style: { fontStyle: "normal", fontWeight: 600 },
      }, author)
    : null;
  const roleEl = role
    ? React.createElement("span", {
        key: "role",
        style: { fontSize: "14px", opacity: 0.75 },
      }, role)
    : null;

  const namesEl = authorEl || roleEl
    ? React.createElement("div", {
        key: "names",
        style: { display: "flex", flexDirection: "column" as const },
      }, authorEl, roleEl)
    : null;

  const attributionEl = avatarEl || namesEl
    ? React.createElement("footer", {
        key: "attribution",
        style: { display: "flex", alignItems: "center", gap: 12, marginTop: 4 },
      }, avatarEl, namesEl)
    : null;

  return React.createElement("blockquote", {
    key,
    style: {
      margin: 0,
      display: "flex",
      flexDirection: "column" as const,
      gap: 12,
      textAlign: "start" as const,
    },
  }, ratingEl, quoteEl, attributionEl);
}

const Testimonial: OraComponentConfig = {
  label: "Testimonial",
  responsiveDefaults: {
    // A multi-column grid collapses to a single column on mobile (Req 2.13).
    columns: { mobile: 1 },
  },
  fields: {
    // ── Layout (Req 2.4) ───────────────────────────────────────────────────
    layout: createCustomSelectField("Layout", [
      { label: "Single", value: "single" },
      { label: "Grid", value: "grid" },
      { label: "Slider", value: "slider" },
    ], "A single quote, a responsive multi-column grid, or a swipeable slider."),

    // ── Responsive columns (Req 2.5) — breakpoint-aware `columns` field ──────
    [COLUMNS_FIELD_NAME]: responsiveColumnsField("Columns", 4),

    // ── Per-item array (Req 2.2) ────────────────────────────────────────────
    items: {
      type: "array",
      label: "Testimonials",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${(item.author as string) || "Testimonial"}`,
      defaultItemProps: {
        quote: "This product changed the way our team works. Highly recommended.",
        author: "Jane Doe",
        role: "CEO, Acme Inc.",
        avatar: "",
        avatarAlt: "",
        rating: "5",
      },
      arrayFields: {
        quote: { type: "textarea", label: "Quote", contentEditable: true },
        author: { type: "text", label: "Author", contentEditable: true },
        role: { type: "text", label: "Role / Company (optional)", contentEditable: true },
        avatar: imageUploadField,
        avatarAlt: { type: "text", label: "Avatar Alt Text (optional)" },
        rating: createCustomSelectField(
          "Rating",
          TESTIMONIAL_RATING_OPTIONS,
          "Star rating from 0 to 5. Choose \"No rating\" to hide stars for this item.",
        ),
      },
    },

    // ── Shared style helpers (Req 2.10) ─────────────────────────────────────
    ...typographyFields,
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    layout: "grid",
    [COLUMNS_FIELD_NAME]: "3",
    items: [
      {
        quote: "This product changed the way our team works. Highly recommended.",
        author: "Jane Doe",
        role: "CEO, Acme Inc.",
        avatar: "",
        avatarAlt: "",
        rating: "5",
      },
      {
        quote: "Onboarding was effortless and support has been outstanding.",
        author: "John Smith",
        role: "Head of Product, Globex",
        avatar: "",
        avatarAlt: "",
        rating: "5",
      },
      {
        quote: "A genuine difference-maker for our day-to-day workflow.",
        author: "Aisha Rahman",
        role: "Operations Lead, Initech",
        avatar: "",
        avatarAlt: "",
        rating: "4",
      },
    ],
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const layout = (props.layout as string) || "single";
    const items = (props.items as Array<Record<string, unknown>>) ?? [];

    // SINGLE — render the first item as a standalone blockquote (Req 2.4).
    if (layout === "single") {
      const first = items[0];
      const content = first
        ? renderTestimonialItem(first, 0)
        // Empty array: render an empty blockquote wrapper rather than throwing.
        : React.createElement("blockquote", { style: { margin: 0 } });
      return styledRender(props, content);
    }

    // SLIDER — swipeable carousel (Req 2.6). Delegates to the dedicated
    // `"use client"` TestimonialRuntime (reusing the ImageCarousel/Gallery
    // runtime pattern). The runtime is a pure carousel shell: it receives the
    // already-rendered blockquote nodes from the shared `renderTestimonialItem`
    // helper so the per-item markup is identical across all three layouts.
    if (layout === "slider") {
      return styledRender(
        props,
        React.createElement(TestimonialRuntime, {
          slides: items.map((item, i) => renderTestimonialItem(item, i)),
        }),
      );
    }

    // GRID — responsive multi-column grid of blockquote cards (Req 2.5). The
    // per-breakpoint column count comes from the breakpoint-aware `columns`
    // field via `gridStyle`; `responsiveDefaults` collapses it to one column on
    // mobile (Req 2.13).
    const grid = React.createElement(
      "div",
      { style: { ...gridStyle(props, { gap: "24px" }) } },
      ...items.map((item, i) => renderTestimonialItem(item, i)),
    );

    return styledRender(props, grid);
  },
};


// ─── TabGroup — Real content tabs (WAI-ARIA tabs pattern) ────────────────────
//
// Distinct from `FilterTabs` (which renders count-annotated links and does NOT
// switch content panels). `TabGroup` hosts arbitrary nested blocks per panel via
// Puck slots and delegates the interactive tab shell (roles, roving tabindex,
// keyboard nav, RTL) to the `"use client"` `TabGroupRuntime` — mirroring how the
// other interactive blocks delegate to a dedicated runtime.
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 3 — TabGroup".
// Validates: Requirements 3.1, 3.2, 3.3, 3.8, 3.10, 3.11, 13.2, 13.3.

const TAB_GROUP_MAX_TABS = 6;

/**
 * Resolve the effective tab count from props, clamped to
 * `[1, TAB_GROUP_MAX_TABS]` (mirrors `resolveColumnCount`). Falls back to the
 * default of 2 when the value is missing or non-finite.
 */
function resolveTabCount(props: Record<string, unknown>): number {
  const explicit = props.tabCount as number | undefined;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.min(Math.max(Math.floor(explicit), 1), TAB_GROUP_MAX_TABS);
  }
  return 2;
}

const TabGroup: OraComponentConfig = {
  label: "Tab Group",
  fields: {
    // Number of visible tabs (1..6), mirroring Columns' `columnCount`.
    tabCount: {
      type: "number",
      label: "Number of Tabs",
      min: 1,
      max: TAB_GROUP_MAX_TABS,
    },
    // The author-designated default tab shown on first render (Req 3.3). The
    // runtime clamps this into range.
    defaultIndex: {
      type: "number",
      label: "Default Tab (0-based)",
      min: 0,
      max: TAB_GROUP_MAX_TABS - 1,
    },
    // Per-tab labels (Req 3.2). Kept as a fixed set of text fields (the Columns
    // way) so each label stays paired with its panel slot (Req 3.8).
    "tab-0-label": { type: "text", label: "Tab 1 Label" },
    "tab-1-label": { type: "text", label: "Tab 2 Label" },
    "tab-2-label": { type: "text", label: "Tab 3 Label" },
    "tab-3-label": { type: "text", label: "Tab 4 Label" },
    "tab-4-label": { type: "text", label: "Tab 5 Label" },
    "tab-5-label": { type: "text", label: "Tab 6 Label" },
    // Per-tab panel slots (Req 3.2) — arbitrary nested blocks, like Columns.
    "tab-0": { type: "slot" },
    "tab-1": { type: "slot" },
    "tab-2": { type: "slot" },
    "tab-3": { type: "slot" },
    "tab-4": { type: "slot" },
    "tab-5": { type: "slot" },
    // Shared style helpers applied via styledRender (Req 3.10).
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    tabCount: 2,
    defaultIndex: 0,
    "tab-0-label": "Tab 1",
    "tab-1-label": "Tab 2",
    "tab-2-label": "Tab 3",
    "tab-3-label": "Tab 4",
    "tab-4-label": "Tab 5",
    "tab-5-label": "Tab 6",
    // Empty slots for every tab so Puck initializes each panel (the Columns
    // way). Unfilled labels fall back to "Tab N" at render time.
    "tab-0": [],
    "tab-1": [],
    "tab-2": [],
    "tab-3": [],
    "tab-4": [],
    "tab-5": [],
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const count = resolveTabCount(props);

    // Default selection from props only, so the server (default-tab) markup is
    // deterministic and byte-stable (Req 3.3, 3.11). The runtime clamps it into
    // range against the actual tab count.
    const rawDefaultIndex = props.defaultIndex;
    const defaultIndex =
      typeof rawDefaultIndex === "number" && Number.isFinite(rawDefaultIndex)
        ? rawDefaultIndex
        : 0;

    // Build one { label, panel } entry per visible tab. Each panel slot is
    // invoked "the Columns way": call the slot render function when present,
    // otherwise contribute an empty panel.
    const tabs = Array.from({ length: count }, (_, i) => {
      const label = (props[`tab-${i}-label`] as string) || `Tab ${i + 1}`;
      const slot = (props as Record<string, unknown>)[`tab-${i}`];
      const panel =
        typeof slot === "function" ? (slot as () => React.ReactNode)() : null;
      return { label, panel };
    });

    // Derive a stable, instance-unique id prefix from the Puck block instance
    // id so the runtime's tab/panel ids are byte-identical across independent
    // renders of the same props (Req 3.11 / Property 3), instead of React's
    // per-render-tree `useId` counter which drifts between separate renders.
    const idBase =
      typeof props.id === "string" && props.id ? `tabgroup-${props.id}` : undefined;

    return styledRender(
      props,
      React.createElement(TabGroupRuntime, { tabs, defaultIndex, idBase }),
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LOGO CLOUD — responsive strip/grid of partner/client logos with optional links
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 4 — LogoCloud". Validates Requirements 4.1–4.10.
//
// The block exposes an `items` array (each: `src` via `imageUploadField`, `alt`
// text, optional `href`), a breakpoint-aware `columns` field, and a `grayscale`
// toggle. It declares `responsiveDefaults: { columns: { mobile: 2 } }` — logos
// stay legible at 2-up on mobile (Req 4.8) — validated at construction by
// `validateResponsiveDefaults` inside `wrapAllRenders`.
//
// Layout is a static `gridStyle` grid; per-breakpoint column behaviour comes from
// the breakpoint-css pipeline keyed off the same `columns` field. The grid auto-
// flows in the inline direction, so logos reverse to RTL order under `dir="rtl"`
// without any hard-coded left/right (Req 4.9).
//
// Grayscale (Req 4.5) is handled by a scoped CSS class — never JS — so it works
// for visitors with scripting disabled: each logo cell is desaturated by default
// and returns to full color on pointer hover and (for linked logos) keyboard
// focus, via `:hover` / `:focus-within`. The rule set is a single static string
// (mirroring the Button block's hover `<style>`), so emitting it keeps the public
// render byte-stable (Req 4.10). It is emitted only when the toggle is on.

/**
 * Scoped, JS-free grayscale rule set for the LogoCloud (Req 4.5).
 *
 * Logos under a `.ora-logo-cloud--grayscale` container render desaturated by
 * default and animate back to full color on pointer hover or keyboard focus
 * within a logo cell. `:focus-within` covers linked logos (the anchor is
 * focusable); plain (unlinked) logos have nothing focusable inside, so only the
 * hover branch applies to them — which is the intended behaviour.
 *
 * The rule targets logo `<img>`s by class only (no instance-specific selectors),
 * so the string is constant and can be emitted repeatedly without breaking the
 * byte-stable public render. Uses logical, direction-agnostic properties only.
 */
const LOGO_CLOUD_GRAYSCALE_CSS = `
.ora-logo-cloud--grayscale .ora-logo-cloud__item img {
  filter: grayscale(1);
  transition: filter 0.2s ease;
}

.ora-logo-cloud--grayscale .ora-logo-cloud__item:hover img,
.ora-logo-cloud--grayscale .ora-logo-cloud__item:focus-within img {
  filter: grayscale(0);
}
`;

/**
 * Render a single logo entry (Req 4.4, 4.6).
 *
 * Each logo is an `<img>` carrying the item's author-provided alt text (Req 4.6).
 * When the item has a non-empty `href` it is wrapped in an anchor (Req 4.4);
 * otherwise the logo renders in a plain `<div>` with no anchor. Both wrappers
 * share the `ora-logo-cloud__item` class so the scoped grayscale rule applies
 * uniformly. External absolute URLs get `rel="noopener noreferrer"`.
 *
 * Items without a usable `src` are skipped by the caller, so this helper never
 * emits an `<img>` with an empty `src` (no broken-image).
 */
function renderLogoItem(
  item: Record<string, unknown>,
  key: React.Key,
): React.ReactElement {
  const src = String((item as Partial<LogoItem>).src ?? "").trim();
  const alt = String((item as Partial<LogoItem>).alt ?? "").trim();
  const href = String((item as Partial<LogoItem>).href ?? "").trim();

  const img = React.createElement("img", {
    src,
    // Author-provided alt; empty string keeps the image decorative (Req 4.6, 13.1).
    alt,
    loading: "lazy" as const,
    style: {
      display: "block",
      maxWidth: "100%",
      maxHeight: "48px",
      width: "auto",
      height: "auto",
      objectFit: "contain" as const,
    },
  });

  // Logos with a link are wrapped in an anchor (Req 4.4); the cell is centered so
  // logos of differing intrinsic sizes sit consistently within their grid track.
  const cellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (href) {
    return React.createElement("a", {
      key,
      href,
      className: "ora-logo-cloud__item",
      style: cellStyle,
      // External absolute URLs get the security rel; internal/relative omit it.
      ...(isExternalButtonUrl(href) ? { rel: "noopener noreferrer" } : {}),
    }, img);
  }

  // No link → plain cell, no anchor (Req 4.4).
  return React.createElement("div", {
    key,
    className: "ora-logo-cloud__item",
    style: cellStyle,
  }, img);
}

const LogoCloud: OraComponentConfig = {
  label: "Logo Cloud",
  responsiveDefaults: {
    // Logos read fine at 2-up on mobile, so the grid reduces to two columns
    // there rather than collapsing to one (Req 4.8).
    columns: { mobile: 2 },
  },
  fields: {
    // ── Per-item array (Req 4.2) ────────────────────────────────────────────
    items: {
      type: "array",
      label: "Logos",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${(item.alt as string) || "Logo"}`,
      defaultItemProps: { src: "", alt: "", href: "" },
      arrayFields: {
        src: imageUploadField,
        alt: { type: "text", label: "Alt Text" },
        href: { type: "text", label: "Link URL (optional)" },
      },
    },

    // ── Responsive columns (Req 4.3) — breakpoint-aware `columns` field ──────
    [COLUMNS_FIELD_NAME]: responsiveColumnsField("Columns", 6),

    // ── Grayscale toggle (Req 4.5) ──────────────────────────────────────────
    grayscale: createToggleField("Grayscale", [
      { label: "Off", value: "no" },
      { label: "On", value: "yes" },
    ], "Show logos desaturated, returning to full color on hover/focus."),

    // ── Shared style helpers (Req 4.7) ──────────────────────────────────────
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    items: [
      { src: "", alt: "Partner 1", href: "" },
      { src: "", alt: "Partner 2", href: "" },
      { src: "", alt: "Partner 3", href: "" },
      { src: "", alt: "Partner 4", href: "" },
    ],
    [COLUMNS_FIELD_NAME]: "4",
    grayscale: "no",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const items = (props.items as Array<Record<string, unknown>>) ?? [];
    const grayscaleOn = (props.grayscale as string) === "yes";

    // Skip items without a usable source so we never emit a broken `<img>`.
    const logoEls = items
      .filter((item) => String((item as Partial<LogoItem>).src ?? "").trim() !== "")
      .map((item, i) => renderLogoItem(item, i));

    // Responsive grid (Req 4.3). The per-breakpoint column count comes from the
    // breakpoint-aware `columns` field via `gridStyle`; `responsiveDefaults`
    // reduces it to two columns on mobile (Req 4.8). The grid auto-flows in the
    // inline direction, so it reverses to RTL order under `dir="rtl"` (Req 4.9).
    const grid = React.createElement(
      "div",
      {
        className: grayscaleOn ? "ora-logo-cloud ora-logo-cloud--grayscale" : "ora-logo-cloud",
        style: {
          ...gridStyle(props, { gap: "32px" }),
          alignItems: "center",
        },
      },
      ...logoEls,
    );

    // Emit the scoped grayscale rule only when enabled. The string is constant,
    // so this stays byte-stable (Req 4.10).
    const content = grayscaleOn
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement("style", null, LOGO_CLOUD_GRAYSCALE_CSS),
          grid,
        )
      : grid;

    return styledRender(props, content);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// PRICING TABLE — responsive grid of plan cards (name, price, features, CTA)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 5 — PricingTable". Validates Requirements 5.1–5.11.
//
// The block exposes a `plans` array (each: `name`, `price`, `period`, a
// newline-separated `features` textarea, a `highlight` toggle, and `ctaLabel` /
// `ctaUrl`), a breakpoint-aware `columns` field, a `highlightColor` accent picker
// (via `makeColorField`), and the shared typography / spacing-border / animation
// helpers (Req 5.7). It declares `responsiveDefaults: { columns: { mobile: 1 } }`
// so the grid collapses to one column on mobile (Req 5.9), validated at
// construction by `validateResponsiveDefaults` inside `wrapAllRenders`.
//
// Layout is a static `gridStyle` grid; per-breakpoint column behaviour comes from
// the breakpoint-css pipeline keyed off the same `columns` field. The grid auto-
// flows in the inline direction and each card aligns its content with logical
// `textAlign: "start"`, so plan cards reverse to RTL order and align to the
// reading direction under `dir="rtl"` without any hard-coded left/right
// (Req 5.10).
//
// A highlighted plan ("most popular") gets an accent border in `highlightColor`
// plus a "Most Popular" badge (Req 5.4). Each plan's features are split on `\n`
// into a semantic `<ul><li>` list (Req 5.6). The per-plan CTA is a navigational
// anchor rendered by the shared `renderButtonAnchor` helper — never a payment
// control (Req 5.5, 5.8).

// Default accent color for the highlighted plan card (ORA cyan). Used for the
// accent border and the "Most Popular" badge background.
const PRICING_DEFAULT_HIGHLIGHT_COLOR = "#01A7C7";

/**
 * Render a single pricing plan as a card (Req 5.2, 5.4, 5.6).
 *
 * The card shows the plan name, price + optional period, a semantic `<ul><li>`
 * feature list (features split on `\n`, blank lines dropped — Req 5.6), and an
 * optional navigational CTA anchor (Req 5.5, 5.8). When the plan's `highlight`
 * flag is set it gains an accent border in `highlightColor` and a "Most Popular"
 * badge (Req 5.4).
 *
 * Card content aligns with logical `textAlign: "start"` so it follows the
 * reading direction under RTL (Req 5.10). Optional parts (period, features, CTA)
 * are omitted entirely when empty so no empty wrappers are emitted.
 *
 * The CTA uses the namespaced `cta`-prefixed button props that `renderButtonAnchor`
 * reads; the per-plan `ctaLabel` / `ctaUrl` are passed through the helper's
 * `label` / `url` overrides so each card links to its own destination.
 */
function renderPricingPlan(
  plan: Record<string, unknown>,
  key: React.Key,
  highlightColor: string,
): React.ReactElement {
  const name = String((plan as Partial<PricingPlan>).name ?? "").trim();
  const price = String((plan as Partial<PricingPlan>).price ?? "").trim();
  const period = String((plan as Partial<PricingPlan>).period ?? "").trim();
  const featuresRaw = String((plan as Partial<PricingPlan>).features ?? "");
  const highlighted =
    (plan as Record<string, unknown>).highlight === true ||
    (plan as Record<string, unknown>).highlight === "yes";
  const ctaLabel = String((plan as Partial<PricingPlan>).ctaLabel ?? "").trim();
  const ctaUrl = String((plan as Partial<PricingPlan>).ctaUrl ?? "").trim();

  // ── "Most Popular" badge — only on the highlighted plan (Req 5.4) ────────
  const badgeEl = highlighted
    ? React.createElement("div", {
        key: "badge",
        style: {
          alignSelf: "flex-start",
          backgroundColor: highlightColor,
          color: "#FFFFFF",
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          padding: "4px 10px",
          borderRadius: "9999px",
        },
      }, "Most Popular")
    : null;

  // ── Name ─────────────────────────────────────────────────────────────────
  const nameEl = name
    ? React.createElement("h3", {
        key: "name",
        style: { margin: 0, fontSize: "20px", fontWeight: 600 },
      }, name)
    : null;

  // ── Price + optional period ────────────────────────────────────────────
  const priceEl = price || period
    ? React.createElement("div", {
        key: "price",
        style: { display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap" as const },
      },
        price
          ? React.createElement("span", {
              key: "amount",
              style: { fontSize: "32px", fontWeight: 700 },
            }, price)
          : null,
        period
          ? React.createElement("span", {
              key: "period",
              style: { fontSize: "14px", opacity: 0.7 },
            }, period)
          : null,
      )
    : null;

  // ── Features — split on \n into a semantic <ul><li> (Req 5.6) ────────────
  const features = featuresRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const featuresEl = features.length > 0
    ? React.createElement("ul", {
        key: "features",
        style: {
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column" as const,
          gap: 8,
        },
      }, ...features.map((feature, i) =>
        React.createElement("li", { key: i, style: { fontSize: "15px", lineHeight: 1.5 } }, feature),
      ))
    : null;

  // ── CTA — navigational anchor only (Req 5.5, 5.8) ────────────────────────
  // `renderButtonAnchor` returns null when there is no URL, so a plan without a
  // CTA simply omits it (no empty wrapper). The button is full-width inside the
  // card and pinned to the bottom via `marginTop: auto`.
  const ctaEl = ctaUrl
    ? React.createElement("div", {
        key: "cta",
        style: { marginTop: "auto", display: "flex" },
      }, renderButtonAnchor(plan, {
        prefix: "cta",
        iconMap: ICON_MAP,
        label: ctaLabel || "Get Started",
        url: ctaUrl,
        key: "cta-anchor",
      }))
    : null;

  return React.createElement("div", {
    key,
    style: {
      display: "flex",
      flexDirection: "column" as const,
      gap: 16,
      padding: "32px 24px",
      boxSizing: "border-box" as const,
      height: "100%",
      textAlign: "start" as const,
      // Accent border on the highlighted plan; a neutral border otherwise so
      // every card keeps the same box geometry (Req 5.4).
      border: highlighted ? `2px solid ${highlightColor}` : "1px solid #E8E4DF",
      borderRadius: "12px",
    },
  }, badgeEl, nameEl, priceEl, featuresEl, ctaEl);
}

const PricingTable: OraComponentConfig = {
  label: "Pricing Table",
  responsiveDefaults: {
    // Plan cards collapse to a single column on mobile so pricing stays legible
    // on small viewports (Req 5.9).
    columns: { mobile: 1 },
  },
  fields: {
    // ── Per-plan array (Req 5.2) ────────────────────────────────────────────
    plans: {
      type: "array",
      label: "Plans",
      getItemSummary: (item: Record<string, unknown>, i?: number) =>
        `${(i ?? 0) + 1}. ${(item.name as string) || "Plan"}`,
      defaultItemProps: {
        name: "Plan",
        price: "$0",
        period: "/mo",
        features: "Feature one\nFeature two\nFeature three",
        highlight: "no",
        ctaLabel: "Get Started",
        ctaUrl: "/contact",
      },
      arrayFields: {
        name: { type: "text", label: "Plan Name", contentEditable: true },
        price: { type: "text", label: "Price", contentEditable: true },
        period: { type: "text", label: "Period (optional)", contentEditable: true },
        features: {
          type: "textarea",
          label: "Features (one per line)",
          contentEditable: true,
        },
        highlight: createToggleField("Most Popular", [
          { label: "Off", value: "no" },
          { label: "On", value: "yes" },
        ], "Emphasize this plan with an accent border and a \"Most Popular\" badge."),
        ctaLabel: { type: "text", label: "CTA Label", contentEditable: true },
        ctaUrl: { type: "text", label: "CTA URL" },
      },
    },

    // ── Responsive columns (Req 5.3) — breakpoint-aware `columns` field ──────
    [COLUMNS_FIELD_NAME]: responsiveColumnsField("Columns", 4),

    // ── Highlight accent color (Req 5.4) ────────────────────────────────────
    highlightColor: makeColorField(
      "Highlight Color",
      PRICING_DEFAULT_HIGHLIGHT_COLOR,
      "Accent border + badge color for the highlighted plan.",
    ),

    // ── Shared style helpers (Req 5.7) ──────────────────────────────────────
    ...typographyFields,
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    plans: [
      {
        name: "Starter",
        price: "$0",
        period: "/mo",
        features: "1 project\nCommunity support\nBasic analytics",
        highlight: "no",
        ctaLabel: "Get Started",
        ctaUrl: "/contact",
      },
      {
        name: "Pro",
        price: "$29",
        period: "/mo",
        features: "Unlimited projects\nPriority support\nAdvanced analytics\nCustom domain",
        highlight: "yes",
        ctaLabel: "Start Free Trial",
        ctaUrl: "/contact",
      },
      {
        name: "Enterprise",
        price: "Contact us",
        period: "",
        features: "Everything in Pro\nDedicated manager\nSLA & security review\nSSO",
        highlight: "no",
        ctaLabel: "Contact Sales",
        ctaUrl: "/contact",
      },
    ],
    [COLUMNS_FIELD_NAME]: "3",
    highlightColor: PRICING_DEFAULT_HIGHLIGHT_COLOR,
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const plans = (props.plans as Array<Record<string, unknown>>) ?? [];
    const highlightColor = (props.highlightColor as string) || PRICING_DEFAULT_HIGHLIGHT_COLOR;

    // Responsive grid of plan cards (Req 5.3). The per-breakpoint column count
    // comes from the breakpoint-aware `columns` field via `gridStyle`;
    // `responsiveDefaults` collapses it to one column on mobile (Req 5.9). The
    // grid auto-flows in the inline direction, so cards reverse to RTL order
    // under `dir="rtl"` (Req 5.10). `alignItems: stretch` keeps every card the
    // same height regardless of feature count.
    const grid = React.createElement(
      "div",
      {
        style: {
          ...gridStyle(props, { gap: "24px" }),
          alignItems: "stretch",
        },
      },
      ...plans.map((plan, i) => renderPricingPlan(plan, i, highlightColor)),
    );

    return styledRender(props, grid);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CARD — generic content card: image + title + body + optional CTA anchor
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 6 — Card". Validates Requirements 6.1–6.4, 6.9–6.13.
//
// A standalone content card with an optional image, a title, optional body text,
// and an optional navigational link/button. The block lives in the `blocks`
// palette category (registration is handled separately) and is rendered
// statically — image + title + body + anchor, no client state.
//
// Optional parts are omitted entirely when empty so no empty wrappers are
// emitted (Req 6.3): the `<img>` is dropped when there is no image source, the
// body `<p>` when the text is blank, and the CTA anchor when there is no URL
// (`renderButtonAnchor` returns null) or when the link toggle is off.
//
// The image carries author-provided alt text (Req 6.4) and the title renders in
// a card-appropriate `h3` heading element (Req 6.4). The CTA is a semantic
// anchor produced by the shared `renderButtonAnchor` helper (Req 6.9).
//
// Body text is authored as plain text (a `textarea`) per the design's default,
// so it is rendered as plain text — there is no `dangerouslySetInnerHTML` path
// here and therefore no sanitizer call. IF the body were ever rendered as
// author HTML, it would first pass through `sanitizeRichTextHtml` (Req 6.11);
// keeping it plain text avoids that path and stays byte-stable (Req 6.13).
//
// Card content aligns with logical `textAlign: "start"` and uses logical flow so
// it follows the reading direction under `dir="rtl"` without any hard-coded
// left/right (Req 6.12). Shared typography / spacing-border / animation helpers
// are applied via `styledRender` (Req 6.10).

// The CTA button's namespaced field keys, used by `resolveFields` to show or
// hide the whole button group behind the `linkEnabled` toggle.
const CARD_CTA_FIELD_KEYS = Object.keys(buttonFields("cta"));

const Card: OraComponentConfig = {
  label: "Card",
  fields: {
    // ── Content ──────────────────────────────────────────────────────────
    image: { ...imageUploadField, label: "Image (optional)" },
    imageAlt: { type: "text", label: "Image Alt Text" },
    title: { type: "text", label: "Title", contentEditable: true },
    body: { type: "textarea", label: "Body (optional)", contentEditable: true },

    // ── Optional link / button (Req 6.2, 6.9) ──────────────────────────────
    linkEnabled: createToggleField("Link / Button", [
      { label: "Off", value: "no" },
      { label: "On", value: "yes" },
    ], "Add an optional link or button to the card."),
    ...buttonFields("cta"),

    // ── Shared style helpers (Req 6.10) ─────────────────────────────────────
    ...typographyFields,
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    image: "",
    imageAlt: "",
    title: "Card Title",
    body: "A short description that gives this card some context.",
    linkEnabled: "no",
    ...buttonFieldDefaults("cta"),
    ctaText: "Learn more",
    ctaUrl: "",
    ...typographyDefaultsText,
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
    const linkOn = (props.linkEnabled as string) === "yes";

    // The whole CTA button group hides until the toggle is on.
    for (const key of CARD_CTA_FIELD_KEYS) setVisible(key, linkOn);

    return nextFields;
  },
  render: (props) => {
    // ── Optional image — omitted entirely when no source (Req 6.3, 6.4) ───
    const imageSrc = String(props.image ?? "").trim();
    const imageAlt = String(props.imageAlt ?? "").trim();
    const imageEl = imageSrc
      ? React.createElement("img", {
          key: "image",
          src: imageSrc,
          alt: imageAlt,
          style: {
            display: "block",
            width: "100%",
            height: "auto",
            objectFit: "cover" as const,
          },
        })
      : null;

    // ── Title — always in a card-appropriate h3 (Req 6.4) ─────────────────
    const titleText = String(props.title ?? "").trim();
    const titleEl = titleText
      ? React.createElement("h3", {
          key: "title",
          style: { margin: 0, fontSize: "20px", fontWeight: 600 },
        }, titleText)
      : null;

    // ── Body — plain text, omitted entirely when empty (Req 6.3) ──────────
    // Authored as plain text (textarea), so no HTML / sanitizer path is taken.
    const bodyText = String(props.body ?? "").trim();
    const bodyEl = bodyText
      ? React.createElement("p", {
          key: "body",
          style: { margin: 0, fontSize: "16px", lineHeight: 1.6 },
        }, bodyText)
      : null;

    // ── Optional CTA — semantic anchor; omitted when off / no URL (Req 6.9) ─
    // `renderButtonAnchor` returns null when there is no URL, so a card without
    // a link simply omits it (no empty wrapper).
    const linkOn = (props.linkEnabled as string) === "yes";
    const ctaAnchor = linkOn
      ? renderButtonAnchor(props, { prefix: "cta", iconMap: ICON_MAP, key: "cta-anchor" })
      : null;
    const ctaEl = ctaAnchor
      ? React.createElement("div", {
          key: "cta",
          style: { marginTop: "auto", display: "flex" },
        }, ctaAnchor)
      : null;

    // Inner text content stacks below the image with consistent spacing. The
    // image sits flush at the top of the card; text gets its own padding.
    const textStack = (titleEl || bodyEl || ctaEl)
      ? React.createElement("div", {
          key: "text",
          style: {
            display: "flex",
            flexDirection: "column" as const,
            gap: 12,
            padding: imageEl ? "16px" : 0,
            flex: 1,
            textAlign: "start" as const,
          },
        }, titleEl, bodyEl, ctaEl)
      : null;

    // Logical column flow + `textAlign: start` flips correctly under RTL
    // (Req 6.12). The overflow clip keeps the image's corners within the card.
    const card = React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column" as const,
        height: "100%",
        boxSizing: "border-box" as const,
        overflow: "hidden",
        textAlign: "start" as const,
      },
    }, imageEl, textStack);

    return styledRender(props, card);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CARDGRID — responsive slot host that lays nested Card blocks out in a grid
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 7 — CardGrid". Validates Requirements 6.5–6.8, 6.10, 6.12, 6.13.
//
// CardGrid is a container-like block in the `layout` palette category
// (registration is handled separately). Unlike the data-array blocks
// (Testimonial / LogoCloud / PricingTable), it owns NO `cards` array: instead it
// nests real `Card` children through a single Puck Slot (`card-content`),
// exactly like Section / Columns nest arbitrary children (Req 6.6). The slot
// disallows `Section` so authors cannot nest a full-bleed section inside a card
// grid, keeping the nesting sane and consistent with the other slot hosts.
//
// The children are arranged in a responsive grid driven by the shared
// breakpoint-aware `columns` field (Req 6.7) and the `gridStyle` helper, with a
// configurable `gap`. `responsiveDefaults` collapses the grid to a single column
// on mobile (Req 6.8). The grid auto-flows in the inline direction, so cards
// reverse to RTL order under `dir="rtl"` with no hard-coded left/right
// (Req 6.12). Shared spacing-border helpers are applied via `styledRender`
// (Req 6.10).
//
// Render invokes the slot "the Columns way" — `typeof props["card-content"] ===
// "function" ? props["card-content"]() : null` — so an empty slot simply renders
// an empty grid container (consistent with an empty Columns/Section), never
// throwing. The markup is deterministic for fixed props, preserving the
// byte-stable public render (Req 6.13).

// Gap select values mapped to concrete CSS lengths for `gridStyle`, mirroring
// the `Columns` block's gap scale.
const CARDGRID_GAP_PX: Record<string, string> = {
  "0": "0",
  sm: "16px",
  md: "24px",
  lg: "40px",
};

const CardGrid: OraComponentConfig = {
  label: "Card Grid",
  responsiveDefaults: {
    // Cards collapse to a single column on mobile so each card stays legible on
    // small viewports (Req 6.8).
    columns: { mobile: 1 },
  },
  fields: {
    // ── Nested Card children via a Puck Slot (Req 6.6) ──────────────────────
    // `disallow: ["Section"]` keeps nesting sane, matching Section / Columns.
    "card-content": { type: "slot", disallow: ["Section"] },

    // ── Responsive columns (Req 6.7) — breakpoint-aware `columns` field ──────
    [COLUMNS_FIELD_NAME]: responsiveColumnsField("Columns", 4),

    // ── Gap between cards ───────────────────────────────────────────────────
    gap: createCustomSelectField("Gap", [
      { label: "None", value: "0" },
      { label: "Small", value: "sm" },
      { label: "Medium", value: "md" },
      { label: "Large", value: "lg" },
    ]),

    // ── Shared style helpers (Req 6.10) ─────────────────────────────────────
    ...spacingBorderFields,
  },
  defaultProps: {
    "card-content": [],
    [COLUMNS_FIELD_NAME]: "3",
    gap: "md",
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const gap = CARDGRID_GAP_PX[props.gap as string] ?? CARDGRID_GAP_PX.md;

    // Invoke the slot the Columns way: render the nested children when the slot
    // is provided, otherwise render nothing (an empty grid container).
    const children =
      typeof (props as Record<string, unknown>)["card-content"] === "function"
        ? (((props as Record<string, unknown>)["card-content"]) as () => React.ReactNode)()
        : null;

    // Responsive grid (Req 6.7). The per-breakpoint column count comes from the
    // breakpoint-aware `columns` field via `gridStyle`; `responsiveDefaults`
    // collapses it to one column on mobile (Req 6.8). `alignItems: stretch`
    // keeps every card the same height; the grid auto-flows in the inline
    // direction so cards reverse under `dir="rtl"` (Req 6.12).
    const grid = React.createElement(
      "div",
      {
        style: {
          ...gridStyle(props, { gap }),
          alignItems: "stretch",
        },
      },
      children,
    );

    return styledRender(props, grid);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SOCIAL LINKS — a row of icon anchors linking to social profiles
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 8 — SocialLinks". Validates Requirements 7.1–7.10.
//
// The block exposes an `items` array (each: an `icon` chosen from the social /
// brand keys, a destination `href`, and an optional accessible-name `label`), an
// `iconSize` slider, an `iconColor` picker (via `makeColorField`), an `align`
// select (left/center/right), and the shared spacing-border / animation helpers
// (Req 7.4, 7.8). Icons resolve through `ICON_MAP`, which already includes the
// inline-SVG brand set merged from `blocks/social-icons.ts` (Req 7.3).
//
// Render is a static flex row of semantic anchors, each holding the resolved
// `ICON_MAP[icon]` component sized/colored per props (Req 7.5). Because the brand
// glyphs are `aria-hidden`, every anchor carries an explicit `aria-label` so it
// has a discernible accessible name — the author `label` when present, otherwise
// "Visit our {Name}" (Req 7.6). External (`http(s)://`) destinations get
// `rel="noopener noreferrer"` via the shared `isExternalButtonUrl` (Req 7.7).
// Alignment maps to `justifyContent`, and the row flows in the inline direction
// with no hard-coded left/right, so icons reverse to RTL order under `dir="rtl"`
// (Req 7.9). No breakpoint-aware fields are used, so the output is byte-stable
// (Req 7.10).

// Display names for the built-in social keys, used to build the fallback
// accessible name ("Visit our {Name}") when an item has no explicit `label`.
const SOCIAL_LINK_NAMES: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
};

// Selectable icon options for a social item — the brand keys merged into
// ICON_MAP from `blocks/social-icons.ts` (Req 7.3). Every value is a registered
// ICON_MAP key so each selection resolves to a renderable icon component.
const SOCIAL_ICON_OPTIONS = [
  { label: "Facebook", value: "facebook" },
  { label: "Instagram", value: "instagram" },
  { label: "X (Twitter)", value: "x" },
  { label: "LinkedIn", value: "linkedin" },
  { label: "YouTube", value: "youtube" },
  { label: "TikTok", value: "tiktok" },
  { label: "WhatsApp", value: "whatsapp" },
];

/**
 * Build the discernible accessible name for a social anchor (Req 7.6).
 *
 * Uses the author-provided `label` when present; otherwise falls back to
 * "Visit our {Name}", where the name is the friendly display name for a known
 * social key or the capitalized key for any other icon. Deterministic so the
 * rendered `aria-label` stays byte-stable.
 */
function socialAccessibleName(icon: string, label?: string): string {
  const trimmed = (label ?? "").trim();
  if (trimmed) return trimmed;
  const key = (icon ?? "").trim();
  const name =
    SOCIAL_LINK_NAMES[key.toLowerCase()] ||
    (key ? key.charAt(0).toUpperCase() + key.slice(1) : "us");
  return `Visit our ${name}`;
}

/**
 * Render a single social link as a semantic anchor wrapping its icon (Req 7.5,
 * 7.6, 7.7).
 *
 * The icon comes from `ICON_MAP[icon]` sized/colored per props; when the key
 * has no registered component the item is skipped by the caller. The brand
 * glyphs are `aria-hidden`, so the anchor itself carries the accessible name
 * via `aria-label`. External destinations get `rel="noopener noreferrer"`.
 */
function renderSocialItem(
  item: Record<string, unknown>,
  key: React.Key,
  iconSize: number,
  iconColor: string,
): React.ReactElement | null {
  const icon = String((item as Partial<SocialItem>).icon ?? "").trim();
  const href = String((item as Partial<SocialItem>).href ?? "").trim();
  const IconComp = icon ? ICON_MAP[icon] : undefined;

  // Skip items with no usable destination or no resolvable icon so we never
  // emit an empty or broken anchor.
  if (!href || !IconComp) return null;

  const accessibleName = socialAccessibleName(icon, (item as Partial<SocialItem>).label);

  return React.createElement(
    "a",
    {
      key,
      href,
      "aria-label": accessibleName,
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: iconColor,
        lineHeight: 0,
        textDecoration: "none",
      },
      ...(isExternalButtonUrl(href) ? { rel: "noopener noreferrer" } : {}),
    },
    React.createElement(IconComp, { size: iconSize, color: iconColor }),
  );
}

const SocialLinks: OraComponentConfig = {
  label: "Social Links",
  fields: {
    // ── Per-item array (Req 7.2) ────────────────────────────────────────────
    items: {
      type: "array",
      label: "Social Links",
      getItemSummary: (item: Record<string, unknown>, i?: number) => {
        const icon = String((item as Partial<SocialItem>).icon ?? "").trim();
        const name = SOCIAL_LINK_NAMES[icon.toLowerCase()] || icon || "Link";
        return `${(i ?? 0) + 1}. ${name}`;
      },
      defaultItemProps: { icon: "facebook", href: "", label: "" },
      arrayFields: {
        icon: createCustomSelectField("Icon", SOCIAL_ICON_OPTIONS, "Pick the social platform / icon."),
        href: { type: "text", label: "Link URL" },
        label: { type: "text", label: "Accessible Name (optional)" },
      },
    },

    // ── Icon appearance (Req 7.4) ───────────────────────────────────────────
    iconSize: makeSliderField("Icon Size", 16, 64, "px", "Rendered width/height of each icon."),
    iconColor: makeColorField("Icon Color", "#2C2C2C", "Color applied to every icon."),

    // ── Alignment (Req 7.4) — logical, so it flips correctly under RTL ──────
    align: createCustomSelectField("Alignment", [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ]),

    // ── Shared style helpers (Req 7.8) ──────────────────────────────────────
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    items: [
      { icon: "facebook", href: "", label: "" },
      { icon: "instagram", href: "", label: "" },
      { icon: "x", href: "", label: "" },
      { icon: "linkedin", href: "", label: "" },
    ],
    iconSize: 24,
    iconColor: "#2C2C2C",
    align: "left",
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    const items = (props.items as Array<Record<string, unknown>>) ?? [];
    const iconSize = Number(props.iconSize) || 24;
    const iconColor = (props.iconColor as string) || "#2C2C2C";

    // ── Alignment (logical, so it flips under RTL — Req 7.9) ────────────────
    const align = (props.align as string) || "left";
    const justifyMap: Record<string, React.CSSProperties["justifyContent"]> = {
      left: "flex-start",
      center: "center",
      right: "flex-end",
    };

    // Drop items without a usable href or resolvable icon (Req 7.5).
    const anchors = items
      .map((item, i) => renderSocialItem(item, i, iconSize, iconColor))
      .filter((el): el is React.ReactElement => el !== null);

    // Static flex row of anchors. The row flows in the inline direction with no
    // hard-coded left/right, so it reverses to RTL order under `dir="rtl"`
    // (Req 7.9). Alignment maps to `justifyContent` (Req 7.4).
    const row = React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: justifyMap[align] || "flex-start",
          gap: "16px",
        },
      },
      ...anchors,
    );

    return styledRender(props, row);
  },
};
//

// ═══════════════════════════════════════════════════════════════════════════════
// COUNTDOWN — a live countdown timer to an author-set date-time / time zone
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 9 — Countdown". Validates Requirements 8.1, 8.2, 8.9 (this task);
//   the runtime behavior (8.3–8.8, 8.10, 11.3, 13.4) lives in `CountdownRuntime`.
//
// The block exposes a `targetDateTime` free-input field (an ISO 8601 date-time
// the author types, e.g. `2026-12-31T23:59:59`), a `timeZone` select over a set
// of common IANA zones (default the site zone, Asia/Dubai), and an
// `expiryMessage` text field shown at/after expiry (Req 8.2). The shared
// typography / spacing-border / animation style helpers (Req 8.9) are applied to
// the container via `styledRender`.
//
// Render is intentionally thin: it delegates to the `"use client"`
// `CountdownRuntime` via `React.createElement` wrapped in `styledRender`,
// mirroring how the other interactive blocks (ImageCarousel, Gallery, TabGroup,
// ExperienceLauncher) hand off to a dedicated runtime. The runtime owns the
// per-second tick, hydration-safe pre-tick markup, expiry handling, and the
// `aria-live` region; the block here owns only fields, defaults, and styling.

// Common IANA time zones offered in the `timeZone` select. Kept small and
// stable (each value is a valid IANA id understood by `Intl.DateTimeFormat`) so
// the resolved target instant is deterministic on server and client (Req 8.5).
const COUNTDOWN_TIMEZONE_OPTIONS = [
  { label: "Dubai (GST, UTC+4)", value: "Asia/Dubai" },
  { label: "Riyadh (AST, UTC+3)", value: "Asia/Riyadh" },
  { label: "London (GMT/BST)", value: "Europe/London" },
  { label: "Paris / Berlin (CET/CEST)", value: "Europe/Paris" },
  { label: "New York (ET)", value: "America/New_York" },
  { label: "Chicago (CT)", value: "America/Chicago" },
  { label: "Los Angeles (PT)", value: "America/Los_Angeles" },
  { label: "Mumbai (IST)", value: "Asia/Kolkata" },
  { label: "Singapore (SGT)", value: "Asia/Singapore" },
  { label: "Tokyo (JST)", value: "Asia/Tokyo" },
  { label: "Sydney (AET)", value: "Australia/Sydney" },
  { label: "UTC", value: "UTC" },
];

// The site's default time zone (matches the booking/calendar logic elsewhere,
// which treats local time as Asia/Dubai / UTC+4).
const COUNTDOWN_DEFAULT_TIMEZONE = "Asia/Dubai";

// A sensible far-future placeholder so a freshly dropped block counts down
// rather than immediately showing the expiry message. Authors replace this with
// their real launch/promo instant.
const COUNTDOWN_DEFAULT_TARGET = "2026-12-31T23:59:59";

const Countdown: OraComponentConfig = {
  label: "Countdown",
  fields: {
    // ── Target instant (Req 8.2) ────────────────────────────────────────────
    // Free-text ISO 8601 date-time. No unit suffix; the placeholder shows the
    // expected shape. Interpreted in `timeZone` below (Req 8.5).
    targetDateTime: createFreeInputField(
      "Target Date & Time",
      "",
      [],
      "ISO date-time, e.g. 2026-12-31T23:59:59 (interpreted in the time zone below).",
      "2026-12-31T23:59:59",
    ),

    // ── Time zone (Req 8.5) ─────────────────────────────────────────────────
    timeZone: createCustomSelectField(
      "Time Zone",
      COUNTDOWN_TIMEZONE_OPTIONS,
      "All visitors count down to the same instant in this time zone.",
    ),

    // ── Expiry message (Req 8.2, 8.4) ───────────────────────────────────────
    expiryMessage: { type: "text", label: "Expiry Message" },

    // ── Shared style helpers (Req 8.9) ──────────────────────────────────────
    ...typographyFields,
    ...spacingBorderFields,
    ...animationFields,
  },
  defaultProps: {
    targetDateTime: COUNTDOWN_DEFAULT_TARGET,
    timeZone: COUNTDOWN_DEFAULT_TIMEZONE,
    expiryMessage: "This offer has ended.",
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
    ...animationDefaults,
  },
  render: (props) => {
    // Thin delegation to the runtime (Req 8.1). All timer logic, hydration-safe
    // pre-tick markup, expiry handling, and the live region live in
    // `CountdownRuntime`; the container styling comes from `styledRender`.
    const targetDateTime = (props.targetDateTime as string) || "";
    const timeZone = (props.timeZone as string) || COUNTDOWN_DEFAULT_TIMEZONE;
    const expiryMessage =
      (props.expiryMessage as string) || "This offer has ended.";

    return styledRender(
      props,
      React.createElement(CountdownRuntime, {
        targetDateTime,
        timeZone,
        expiryMessage,
      }),
    );
  },
};
//

// ═══════════════════════════════════════════════════════════════════════════════
// BREADCRUMBS — a semantic breadcrumb trail of label + optional-link items
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design reference: `.kiro/specs/page-builder-block-library/design.md`
//   §"Block 10 — Breadcrumbs". Validates Requirements 9.1–9.9.
//   The `BreadcrumbList` JSON-LD `<script>` (Req 9.9) is emitted as a sibling
//   of the <ol> inside the same <nav> (see `buildBreadcrumbList` below).
//
// The block exposes an ordered `items` array (each item: `label` text + optional
// `href` text), a `separator` select over a small set of glyphs, and the shared
// `typographyFields` / `spacingBorderFields` style helpers (Req 9.8). Author item
// order is preserved (Req 9.3).
//
// Render is fully static: `<nav aria-label="Breadcrumb">` › `<ol>` › `<li>` per
// item (Req 9.3, 9.4). Items with an `href` render as anchors; the hrefless
// "current page" item renders as plain text marked `aria-current="page"`
// (Req 9.5). Visual separators between items are `aria-hidden="true"` spans
// (Req 9.6). The list flows in the inline direction with no hard-coded
// left/right, so it reverses to RTL order under `dir="rtl"` (Req 9.7).

// Separator glyphs offered in the `separator` select. Kept small and stable so
// the rendered markup is deterministic (Req 9.10). Values are the literal glyph
// rendered (aria-hidden) between items.
const BREADCRUMB_SEPARATOR_OPTIONS = [
  { label: "Slash  /", value: "/" },
  { label: "Chevron  ›", value: "›" },
  { label: "Dash  —", value: "—" },
];

const BREADCRUMB_DEFAULT_SEPARATOR = "/";

/**
 * Renders a single breadcrumb `<li>`. Items with a non-empty `href` become
 * anchors (Req 9.5); the hrefless current-page item becomes plain text marked
 * `aria-current="page"` (Req 9.5). A visual, `aria-hidden` separator span
 * (Req 9.6) is appended after every item except the last so it sits *between*
 * items in the inline (RTL-aware) flow.
 */
function renderBreadcrumbItem(
  item: Record<string, unknown>,
  index: number,
  isLast: boolean,
  separator: string,
): React.ReactElement {
  const label = String((item as Partial<BreadcrumbItem>).label ?? "");
  const href = String((item as Partial<BreadcrumbItem>).href ?? "").trim();

  // Item content: anchor when linked, otherwise plain text for the current page.
  const content = href
    ? React.createElement("a", { href }, label)
    : React.createElement("span", { "aria-current": "page" }, label);

  // Separator between items only (not after the final crumb). Hidden from AT
  // (Req 9.6); it lives inside the <li> so it flows with the inline direction.
  const sep = isLast
    ? null
    : React.createElement(
        "span",
        {
          "aria-hidden": "true",
          style: { display: "inline-block", margin: "0 0.5em" },
        },
        separator,
      );

  return React.createElement(
    "li",
    {
      key: index,
      style: { display: "inline-flex", alignItems: "center" },
    },
    content,
    sep,
  );
}

/**
 * Builds the `BreadcrumbList` schema.org object emitted as JSON-LD (Req 9.9).
 *
 * Each source item becomes a `ListItem` in author order with `position` 1..n.
 * The `item` URL key is present ONLY when the source item has a non-empty
 * `href` (the hrefless current page is position-only). Keys are written in a
 * fixed insertion order (`@type` → `position` → `name` → `item`) and the object
 * itself in `@context` → `@type` → `itemListElement` order, so
 * `JSON.stringify` produces a deterministic, byte-stable string with no
 * `Date`/random input (preserves Byte_Stable_Render — Req 9.10).
 */
function buildBreadcrumbList(
  items: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => {
      const label = String((item as Partial<BreadcrumbItem>).label ?? "");
      const href = String((item as Partial<BreadcrumbItem>).href ?? "").trim();
      const listItem: Record<string, unknown> = {
        "@type": "ListItem",
        position: i + 1,
        name: label,
      };
      // `item` URL only when the source item is linked (Req 9.9).
      if (href) {
        listItem.item = href;
      }
      return listItem;
    }),
  };
}

const Breadcrumbs: OraComponentConfig = {
  label: "Breadcrumbs",
  fields: {
    // ── Ordered per-item array (Req 9.2) ────────────────────────────────────
    items: {
      type: "array",
      label: "Breadcrumbs",
      getItemSummary: (item: Record<string, unknown>, i?: number) => {
        const label = String((item as Partial<BreadcrumbItem>).label ?? "").trim();
        return `${(i ?? 0) + 1}. ${label || "Untitled"}`;
      },
      defaultItemProps: { label: "", href: "" },
      arrayFields: {
        label: { type: "text", label: "Label" },
        href: { type: "text", label: "Link URL (leave empty for current page)" },
      },
    },

    // ── Separator glyph (Req 9.6) ───────────────────────────────────────────
    separator: createCustomSelectField(
      "Separator",
      BREADCRUMB_SEPARATOR_OPTIONS,
      "Glyph shown between items. Hidden from assistive technology.",
    ),

    // ── Shared style helpers (Req 9.8) ──────────────────────────────────────
    ...typographyFields,
    ...spacingBorderFields,
  },
  defaultProps: {
    items: [
      { label: "Home", href: "/" },
      { label: "Current Page", href: "" },
    ],
    separator: BREADCRUMB_DEFAULT_SEPARATOR,
    ...typographyDefaultsText,
    ...spacingBorderDefaults,
  },
  render: (props) => {
    const items = (props.items as Array<Record<string, unknown>>) ?? [];
    const separator = (props.separator as string) || BREADCRUMB_DEFAULT_SEPARATOR;

    // Ordered list of crumbs in author order (Req 9.3). The <ol> flows in the
    // inline direction with no hard-coded left/right, so it reverses to RTL
    // order under `dir="rtl"` (Req 9.7).
    const list = React.createElement(
      "ol",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          listStyle: "none",
          margin: 0,
          padding: 0,
        },
      },
      ...items.map((item, i) =>
        renderBreadcrumbItem(item, i, i === items.length - 1, separator),
      ),
    );

    // `BreadcrumbList` JSON-LD structured data (Req 9.9). Serialized via
    // `JSON.stringify` (never author HTML), so labels are JSON-escaped and no
    // script injection is possible. `</` is additionally escaped to `\u003c` so
    // a label can never break out of the <script> element. The object is built
    // with a fixed key order and no Date/random input, so the serialized string
    // is deterministic and the render stays byte-stable (Req 9.10).
    const breadcrumbList = buildBreadcrumbList(items);
    const jsonLd = React.createElement("script", {
      type: "application/ld+json",
      dangerouslySetInnerHTML: {
        __html: JSON.stringify(breadcrumbList).replace(/</g, "\\u003c"),
      },
    });

    // Semantic landmark wrapper (Req 9.3, 9.4). The JSON-LD `<script>` sits as a
    // sibling of the <ol> inside the same <nav>; the list markup is unchanged.
    const nav = React.createElement(
      "nav",
      { "aria-label": "Breadcrumb" },
      list,
      jsonLd,
    );

    return styledRender(props, nav);
  },
};
//
// All higher-level "blocks" (Hero, Property Card, Footer, etc.) are now
// expressed as nested **templates** of these atomic components. See
// ./templates/component-templates.ts and the Templates sidebar plugin.

/**
 * Wraps every component's `render` function with `withBreakpointResolution`
 * so that breakpoint-aware props (fontSize, _padding, _margin, etc.) are
 * resolved to their active-breakpoint scalar before the render runs.
 *
 * This is the core fix for Bug Condition 1: style changes not reflected on
 * the canvas because render functions received BreakpointValue objects
 * instead of scalar strings.
 */
function wrapAllRenders(
  components: Record<string, OraComponentConfig>,
): Record<string, OraComponentConfig> {
  const wrapped: Record<string, OraComponentConfig> = {};
  for (const [name, component] of Object.entries(components)) {
    const responsiveDefaults = component.responsiveDefaults;

    // Registration-time validation: fail fast if responsiveDefaults is invalid
    if (responsiveDefaults) {
      const errors = validateResponsiveDefaults(name, responsiveDefaults);
      if (errors.length > 0) {
        const messages = errors.map((e) => `  - ${e.reason}${e.field ? ` (field: ${e.field})` : ""}`).join("\n");
        throw new Error(
          `[pageBuilderConfig] Component "${name}" has invalid responsiveDefaults:\n${messages}`,
        );
      }
    }

    // Inject tracking fields into every component
    const fieldsWithTracking = { ...(component.fields ?? {}), ...trackingFields };
    const defaultPropsWithTracking = { ...(component.defaultProps ?? {}), ...trackingDefaults };

    if (component.render) {
      wrapped[name] = {
        ...component,
        fields: fieldsWithTracking,
        defaultProps: defaultPropsWithTracking,
        render: withBreakpointResolution(
          component.render as (props: Record<string, unknown>) => React.ReactElement,
          responsiveDefaults,
        ),
      };
    } else {
      wrapped[name] = {
        ...component,
        fields: fieldsWithTracking,
        defaultProps: defaultPropsWithTracking,
      };
    }
  }
  return wrapped;
}

// ─── Per-Page Analytics Configuration (Root Fields) ─────────────────────────
// Task 13.1 & 13.2: Analytics fields stored under root.props._analytics

const EVENT_VOCABULARY_OPTIONS = EVENT_VOCABULARY.map((name) => ({
  label: name.replace(/_/g, " "),
  value: name,
}));

const CONSENT_OVERRIDE_OPTIONS = [
  { label: "Inherit site default", value: "inherit" },
  { label: "Analytics only", value: "analytics-only" },
  { label: "No tracking", value: "no-tracking" },
];

const SURVEY_TRIGGER_TYPE_OPTIONS = [
  { label: "None", value: "" },
  { label: "Exit Intent", value: "exit-intent" },
  { label: "Time on Page", value: "time-on-page" },
  { label: "Scroll Depth", value: "scroll-depth" },
];

const analyticsRootFields = {
  _analytics: {
    type: "object" as const,
    label: "Analytics",
    objectFields: {
      pageTemplate: {
        type: "custom" as const,
        label: "Page Template",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
          React.createElement("div", null,
            React.createElement("input", {
              type: "text",
              value: (value as string) || "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.slice(0, 50)),
              placeholder: "e.g. project-landing, unit-detail",
              maxLength: 50,
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
          ),
      },
      projectId: {
        type: "custom" as const,
        label: "Project Tag",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
          React.createElement("div", null,
            React.createElement("input", {
              type: "text",
              value: (value as string) || "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.slice(0, 50)),
              placeholder: "e.g. Marina, Creek",
              maxLength: 50,
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
          ),
      },
      unitType: {
        type: "custom" as const,
        label: "Unit Type",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
          React.createElement("div", null,
            React.createElement("input", {
              type: "text",
              value: (value as string) || "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.slice(0, 50)),
              placeholder: "e.g. 2br-apartment",
              maxLength: 50,
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
          ),
      },
      priceBand: {
        type: "custom" as const,
        label: "Price Band",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
          React.createElement("div", null,
            React.createElement("input", {
              type: "text",
              value: (value as string) || "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.slice(0, 50)),
              placeholder: "e.g. 1.5m-2m",
              maxLength: 50,
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
          ),
      },
      conversionGoal: createCustomSelectField(
        "Conversion Goal",
        [{ label: "None", value: "" }, ...EVENT_VOCABULARY_OPTIONS],
        "Primary conversion event for this page.",
      ),
      funnelSteps: {
        type: "custom" as const,
        label: "Funnel Steps",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) => {
          const current = (value as string) || "";
          return React.createElement("div", null,
            React.createElement("input", {
              type: "text",
              value: current,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
              placeholder: "page_viewed,form_started,form_submitted",
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
            React.createElement("div", { style: { fontSize: 10, color: "#6B6B6B", marginTop: 4 } }, "Comma-separated event names (2–6 steps)"),
          );
        },
      },
      experimentFlag: {
        type: "custom" as const,
        label: "Experiment Flag",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
          React.createElement("div", null,
            React.createElement("input", {
              type: "text",
              value: (value as string) || "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.slice(0, 100)),
              placeholder: "PostHog feature flag key",
              maxLength: 100,
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
          ),
      },
      surveyTriggerType: createCustomSelectField(
        "Survey Trigger",
        SURVEY_TRIGGER_TYPE_OPTIONS,
        "When to fire the PostHog survey.",
      ),
      surveyTriggerValue: {
        type: "custom" as const,
        label: "Survey Trigger Value",
        render: ({ value, onChange }: { value: unknown; onChange: (v: string) => void }) =>
          React.createElement("div", null,
            React.createElement("input", {
              type: "number",
              value: (value as string) || "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
              placeholder: "e.g. 30 (seconds) or 75 (%)",
              min: 5,
              max: 300,
              style: { width: "100%", minHeight: 36, border: "1px solid #E8E4DF", padding: "0 10px", fontSize: 12, color: "#2C2C2C", background: "#FFF", boxSizing: "border-box" as const },
            }),
          ),
      },
      consentOverride: createCustomSelectField(
        "Consent Override",
        CONSENT_OVERRIDE_OPTIONS,
        "Override site-level consent mode for this page.",
      ),
    },
  },
};

const analyticsRootDefaults: { _analytics: PageAnalyticsConfig & { surveyTriggerType?: string; surveyTriggerValue?: string; funnelSteps?: string } } = {
  _analytics: {
    pageTemplate: "",
    projectId: "",
    unitType: "",
    priceBand: "",
    conversionGoal: "",
    funnelSteps: "",
    experimentFlag: "",
    surveyTriggerType: "",
    surveyTriggerValue: "",
    consentOverride: "inherit",
  } as any,
};

export const pageBuilderConfig: OraConfig = {
  categories: {
    layout: {
      components: ["Section", "Container", "Columns", "Flex", "Accordion", "Spacer", "Divider", "CardGrid"],
      title: "Layout",
      defaultExpanded: true,
    },
    blocks: {
      components: ["Heading", "Text", "Button", "InlineLink", "Image", "Video", "Quote", "Icon", "ImageCarousel", "Gallery", "Card"],
      title: "Blocks",
    },
    components: {
      components: ["FilterTabs", "ScrollIndicator", "IconFeatureList", "AccordionGroup", "StatsGrid", "LocationMap", "ContactLocationsMap", "FeaturedProjects", "FeaturedCommunities", "ProjectSection", "ExperienceLauncher", "CTA", "Testimonial", "TabGroup", "LogoCloud", "PricingTable", "SocialLinks", "Countdown", "Breadcrumbs"],
      title: "Components",
    },
  },
  root: {
    fields: {
      ...analyticsRootFields,
    },
    defaultProps: {
      ...analyticsRootDefaults,
    },
  },
  components: wrapAllRenders({
    Section, Container, Columns, Flex, Accordion, Spacer, Divider,
    Heading, Text, Button, InlineLink, Image, Video, Quote, Icon, ImageCarousel, Gallery,
    FilterTabs, ScrollIndicator, IconFeatureList, AccordionGroup, StatsGrid, LocationMap,
    ContactLocationsMap,
    FeaturedProjects, FeaturedCommunities, ProjectSection,
    ExperienceLauncher,
    CTA,
    Testimonial,
    TabGroup,
    LogoCloud,
    PricingTable,
    Card,
    CardGrid,
    SocialLinks,
    Countdown,
    Breadcrumbs,
  }),
};
