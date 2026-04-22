/**
 * Deep image customization fields — compact with inline labels.
 */

import React from "react";
import type { CSSProperties } from "react";

const C = {
  bg: "#F9F7F5", border: "#E8E4DF", text: "#2C2C2C",
  active: "#2C2C2C", activeText: "#FFF", muted: "#9A9A9A",
  inactive: "#F5F3F0", inactiveText: "#6B6B6B",
};

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const labelStyle: CSSProperties = { fontSize: 11, color: C.muted, minWidth: 55, flexShrink: 0 };
const selectStyle: CSSProperties = {
  height: 28, border: `1px solid ${C.border}`, borderRadius: 0, fontSize: 12,
  color: C.text, background: "#FFF", outline: "none", boxSizing: "border-box",
  flex: 1, padding: "0 20px 0 6px", appearance: "none", WebkitAppearance: "none", cursor: "pointer",
};
const numStyle: CSSProperties = {
  height: 28, border: `1px solid ${C.border}`, borderRadius: 0, fontSize: 12,
  color: C.text, background: "#FFF", outline: "none", boxSizing: "border-box",
  width: 60, padding: "0 4px 0 6px", flexShrink: 0,
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

function tog(p: P, label: string, opts: { l: string; v: string }[]) {
  const cur = (p.value as string) || opts[0]?.v || "";
  return React.createElement("div", { style: rowStyle },
    React.createElement("span", { style: labelStyle }, label),
    React.createElement("div", { style: { display: "flex", gap: 0 } },
      ...opts.map(o => React.createElement("button", {
        key: o.v, type: "button", disabled: p.readOnly,
        onClick: () => p.onChange(o.v),
        style: {
          height: 26, minWidth: 26, padding: "0 6px", border: `1px solid ${C.border}`, borderRadius: 0,
          fontSize: 11, cursor: "pointer", marginLeft: -1, boxSizing: "border-box",
          background: cur === o.v ? C.active : C.inactive,
          color: cur === o.v ? C.activeText : C.inactiveText,
          fontWeight: cur === o.v ? 600 : 400,
        },
      }, o.l))
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE FIELDS — grouped with inline labels
// ═══════════════════════════════════════════════════════════════════════════════

export const imageFields = {
  objectFit: { type: "custom" as const, label: "Image Fit",
    render: (p: P) => sel(p, "Fit", [{ l: "Cover", v: "cover" }, { l: "Contain", v: "contain" }, { l: "Fill", v: "fill" }, { l: "None", v: "none" }]) },
  xAlign: { type: "custom" as const, label: "X Position",
    render: (p: P) => sel(p, "X-pos", [{ l: "0%", v: "0%" }, { l: "25%", v: "25%" }, { l: "50%", v: "50%" }, { l: "75%", v: "75%" }, { l: "100%", v: "100%" }]) },
  yAlign: { type: "custom" as const, label: "Y Position",
    render: (p: P) => sel(p, "Y-pos", [{ l: "0%", v: "0%" }, { l: "25%", v: "25%" }, { l: "50%", v: "50%" }, { l: "75%", v: "75%" }, { l: "100%", v: "100%" }]) },
  imgWidth: { type: "custom" as const, label: "Width",
    render: (p: P) => sel(p, "Width", [{ l: "Auto", v: "auto" }, { l: "100%", v: "100%" }, { l: "75%", v: "75%" }, { l: "50%", v: "50%" }, { l: "400px", v: "400px" }, { l: "600px", v: "600px" }, { l: "800px", v: "800px" }]) },
  maxWidth: { type: "custom" as const, label: "Max Width",
    render: (p: P) => sel(p, "Max W", [{ l: "None", v: "none" }, { l: "100%", v: "100%" }, { l: "800px", v: "800px" }, { l: "600px", v: "600px" }, { l: "400px", v: "400px" }]) },
  imgHeight: { type: "custom" as const, label: "Height",
    render: (p: P) => sel(p, "Height", [{ l: "Auto", v: "auto" }, { l: "200px", v: "200px" }, { l: "300px", v: "300px" }, { l: "400px", v: "400px" }, { l: "500px", v: "500px" }]) },
  aspectRatio: { type: "custom" as const, label: "Aspect Ratio",
    render: (p: P) => sel(p, "Ratio", [{ l: "Auto", v: "auto" }, { l: "1:1", v: "1/1" }, { l: "4:3", v: "4/3" }, { l: "16:9", v: "16/9" }, { l: "3:4", v: "3/4" }, { l: "2:3", v: "2/3" }]) },
  alignment: { type: "custom" as const, label: "Alignment",
    render: (p: P) => tog(p, "Align", [{ l: "←", v: "left" }, { l: "⊡", v: "center" }, { l: "→", v: "right" }]) },
  imgBorderRadius: { type: "custom" as const, label: "Corners",
    render: (p: P) => sel(p, "Corners", [{ l: "None", v: "0" }, { l: "4px", v: "4" }, { l: "8px", v: "8" }, { l: "16px", v: "16" }, { l: "Full", v: "9999" }]) },
  shadow: { type: "custom" as const, label: "Shadow",
    render: (p: P) => sel(p, "Shadow", [{ l: "None", v: "none" }, { l: "Small", v: "0 1px 2px rgba(44,44,44,0.04)" }, { l: "Medium", v: "0 4px 6px rgba(44,44,44,0.06)" }, { l: "Large", v: "0 10px 15px rgba(44,44,44,0.08)" }]) },
  opacity: { type: "custom" as const, label: "Opacity",
    render: (p: P) => sel(p, "Opacity", [{ l: "100%", v: "1" }, { l: "90%", v: "0.9" }, { l: "75%", v: "0.75" }, { l: "50%", v: "0.5" }, { l: "25%", v: "0.25" }]) },
  filter: { type: "custom" as const, label: "Filter",
    render: (p: P) => sel(p, "Filter", [{ l: "None", v: "none" }, { l: "Grayscale", v: "grayscale(100%)" }, { l: "Sepia", v: "sepia(100%)" }, { l: "Blur 2px", v: "blur(2px)" }, { l: "Bright 110%", v: "brightness(1.1)" }]) },
  hoverEffect: { type: "custom" as const, label: "Hover Effect",
    render: (p: P) => sel(p, "Hover", [{ l: "None", v: "none" }, { l: "Zoom In", v: "zoom-in" }, { l: "Zoom Out", v: "zoom-out" }, { l: "Brighten", v: "brighten" }, { l: "Darken", v: "darken" }, { l: "Grayscale", v: "grayscale" }, { l: "Lift Up", v: "lift" }]) },
};

export const imageDefaults = {
  objectFit: "cover", xAlign: "50%", yAlign: "50%",
  imgWidth: "100%", maxWidth: "100%", imgHeight: "auto", aspectRatio: "auto",
  alignment: "center", imgBorderRadius: "0", shadow: "none",
  opacity: "1", filter: "none", hoverEffect: "none",
};

export function imagePropsToCSS(props: Record<string, unknown>): {
  wrapperStyle: CSSProperties; imgStyle: CSSProperties; hoverClass: string;
} {
  const wrapperStyle: CSSProperties = {};
  const imgStyle: CSSProperties = {};

  const align = props.alignment as string;
  if (align === "left") wrapperStyle.marginRight = "auto";
  else if (align === "right") wrapperStyle.marginLeft = "auto";
  else { wrapperStyle.marginLeft = "auto"; wrapperStyle.marginRight = "auto"; }

  const w = props.imgWidth as string;
  if (w && w !== "auto") wrapperStyle.width = w;
  const mw = props.maxWidth as string;
  if (mw && mw !== "none") wrapperStyle.maxWidth = mw;

  imgStyle.width = "100%"; imgStyle.display = "block";

  const h = props.imgHeight as string;
  if (h && h !== "auto") imgStyle.height = h;
  const ar = props.aspectRatio as string;
  if (ar && ar !== "auto") imgStyle.aspectRatio = ar;
  const fit = props.objectFit as string;
  if (fit) imgStyle.objectFit = fit as CSSProperties["objectFit"];
  const xA = props.xAlign as string; const yA = props.yAlign as string;
  if (xA || yA) imgStyle.objectPosition = `${xA || "50%"} ${yA || "50%"}`;
  const br = Number(props.imgBorderRadius) || 0;
  if (br > 0) imgStyle.borderRadius = br >= 9999 ? "9999px" : `${br}px`;
  const shadow = props.shadow as string;
  if (shadow && shadow !== "none") imgStyle.boxShadow = shadow;
  const opacity = parseFloat(props.opacity as string);
  if (!isNaN(opacity) && opacity < 1) imgStyle.opacity = opacity;
  const filter = props.filter as string;
  if (filter && filter !== "none") imgStyle.filter = filter;
  imgStyle.transition = "transform 0.5s ease, filter 0.5s ease, opacity 0.3s ease";

  const hover = props.hoverEffect as string;
  const hoverMap: Record<string, string> = {
    "zoom-in": "hover:scale-105", "zoom-out": "hover:scale-95",
    "brighten": "hover:brightness-110", "darken": "hover:brightness-75",
    "grayscale": "hover:grayscale", "lift": "hover:-translate-y-1", "none": "",
  };

  return { wrapperStyle, imgStyle, hoverClass: hoverMap[hover] || "" };
}
