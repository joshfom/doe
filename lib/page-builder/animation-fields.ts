/**
 * Animation fields for any component — entrance animations, hover effects, parallax.
 * Uses Framer Motion under the hood but configured via simple dropdowns.
 */

import React from "react";
import type { CSSProperties } from "react";

const C = { bg: "#F9F7F5", border: "#E8E4DF", text: "#2C2C2C", muted: "#9A9A9A", inactive: "#F5F3F0", inactiveText: "#6B6B6B", active: "#2C2C2C", activeText: "#FFF" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const labelStyle: CSSProperties = { fontSize: 11, color: C.muted, minWidth: 55, flexShrink: 0 };
const selectStyle: CSSProperties = {
  height: 28, border: `1px solid ${C.border}`, borderRadius: 0, fontSize: 12,
  color: C.text, background: "#FFF", outline: "none", boxSizing: "border-box",
  flex: 1, padding: "0 20px 0 6px", appearance: "none", WebkitAppearance: "none", cursor: "pointer",
};

interface P { value: unknown; onChange: (v: string) => void; readOnly?: boolean; }

function sel(p: P, label: string, opts: { l: string; v: string }[]) {
  const cur = (p.value as string) || opts[0]?.v || "";
  return React.createElement("div", { style: rowStyle },
    React.createElement("span", { style: labelStyle }, label),
    React.createElement("div", { style: { position: "relative", flex: 1 } },
      React.createElement("select", { value: cur, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => p.onChange(e.target.value), disabled: p.readOnly, style: selectStyle },
        ...opts.map(o => React.createElement("option", { key: o.v, value: o.v }, o.l))
      ),
      React.createElement("span", { style: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 9, color: C.muted } }, "▾"),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION FIELDS
// ═══════════════════════════════════════════════════════════════════════════════

export const animationFields = {
  _animation: {
    type: "object" as const,
    label: "Animation",
    objectFields: {
      entrance: { type: "custom" as const, label: "Entrance",
        render: (p: P) => sel(p, "Entrance", [
          { l: "None", v: "none" }, { l: "Fade In", v: "fade-in" }, { l: "Fade Up", v: "fade-up" },
          { l: "Fade Down", v: "fade-down" }, { l: "Fade Left", v: "fade-left" }, { l: "Fade Right", v: "fade-right" },
          { l: "Zoom In", v: "zoom-in" }, { l: "Zoom Out", v: "zoom-out" },
        ]) },
      duration: { type: "custom" as const, label: "Duration",
        render: (p: P) => sel(p, "Duration", [
          { l: "0.3s", v: "0.3" }, { l: "0.5s", v: "0.5" }, { l: "0.7s", v: "0.7" },
          { l: "1s", v: "1" }, { l: "1.5s", v: "1.5" }, { l: "2s", v: "2" },
        ]) },
      delay: { type: "custom" as const, label: "Delay",
        render: (p: P) => sel(p, "Delay", [
          { l: "None", v: "0" }, { l: "0.1s", v: "0.1" }, { l: "0.2s", v: "0.2" },
          { l: "0.3s", v: "0.3" }, { l: "0.5s", v: "0.5" }, { l: "1s", v: "1" },
        ]) },
      hover: { type: "custom" as const, label: "Hover",
        render: (p: P) => sel(p, "Hover", [
          { l: "None", v: "none" }, { l: "Scale Up", v: "scale-up" }, { l: "Scale Down", v: "scale-down" },
          { l: "Lift", v: "lift" }, { l: "Glow", v: "glow" }, { l: "Darken", v: "darken" },
        ]) },
    },
  },
};

export const animationDefaults = {
  _animation: { entrance: "none", duration: "0.5", delay: "0", hover: "none" },
};

/** Get Framer Motion props from animation settings */
export function getMotionProps(props: Record<string, unknown>): {
  initial?: Record<string, unknown>;
  whileInView?: Record<string, unknown>;
  whileHover?: Record<string, unknown>;
  viewport?: Record<string, unknown>;
  transition?: Record<string, unknown>;
} {
  const anim = (props._animation as Record<string, unknown>) ?? {};
  const entrance = (anim.entrance as string) || "none";
  const duration = parseFloat(anim.duration as string) || 0.5;
  const delay = parseFloat(anim.delay as string) || 0;
  const hover = (anim.hover as string) || "none";

  if (entrance === "none" && hover === "none") return {};

  const result: Record<string, unknown> = {};

  // Entrance animations
  if (entrance !== "none") {
    const entranceMap: Record<string, { initial: Record<string, unknown>; animate: Record<string, unknown> }> = {
      "fade-in": { initial: { opacity: 0 }, animate: { opacity: 1 } },
      "fade-up": { initial: { opacity: 0, y: 30 }, animate: { opacity: 1, y: 0 } },
      "fade-down": { initial: { opacity: 0, y: -30 }, animate: { opacity: 1, y: 0 } },
      "fade-left": { initial: { opacity: 0, x: -30 }, animate: { opacity: 1, x: 0 } },
      "fade-right": { initial: { opacity: 0, x: 30 }, animate: { opacity: 1, x: 0 } },
      "zoom-in": { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 } },
      "zoom-out": { initial: { opacity: 0, scale: 1.1 }, animate: { opacity: 1, scale: 1 } },
    };
    const e = entranceMap[entrance];
    if (e) {
      result.initial = e.initial;
      result.whileInView = e.animate;
      result.viewport = { once: true, margin: "-50px" };
      result.transition = { duration, delay, ease: "easeOut" };
    }
  }

  // Hover effects
  if (hover !== "none") {
    const hoverMap: Record<string, Record<string, unknown>> = {
      "scale-up": { scale: 1.03 },
      "scale-down": { scale: 0.97 },
      "lift": { y: -4 },
      "glow": { boxShadow: "0 0 20px rgba(184,149,107,0.3)" },
      "darken": { filter: "brightness(0.9)" },
    };
    result.whileHover = hoverMap[hover] || {};
  }

  return result;
}
