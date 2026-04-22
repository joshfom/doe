/**
 * Shared style control fields (padding, margin, border) for all components.
 * All numeric fields use type: "text" so users can type any value freely.
 */

import type { CSSProperties } from "react";

// ─── Field Definitions ───────────────────────────────────────────────────────

export const styleFields = {
  paddingTop: { type: "text" as const, label: "Top" },
  paddingBottom: { type: "text" as const, label: "Bottom" },
  paddingLeft: { type: "text" as const, label: "Left" },
  paddingRight: { type: "text" as const, label: "Right" },
  marginTop: { type: "text" as const, label: "Top" },
  marginBottom: { type: "text" as const, label: "Bottom" },
  borderWidth: { type: "text" as const, label: "Width" },
  borderColor: {
    type: "select" as const,
    label: "Color",
    options: [
      { label: "Sand", value: "#E8E4DF" },
      { label: "Sand Dark", value: "#D4CFC8" },
      { label: "Stone Dark", value: "#B8B3AB" },
      { label: "Charcoal", value: "#2C2C2C" },
      { label: "Gold", value: "#B8956B" },
      { label: "Charcoal Dark", value: "#1A1A1A" },
      { label: "White", value: "#FFFFFF" },
    ],
  },
  borderRadius: { type: "text" as const, label: "Radius" },
};

// ─── Default Values ──────────────────────────────────────────────────────────

export const styleDefaults = {
  paddingTop: "0",
  paddingBottom: "0",
  paddingLeft: "0",
  paddingRight: "0",
  marginTop: "0",
  marginBottom: "0",
  borderWidth: "0",
  borderColor: "#E8E4DF",
  borderRadius: "0",
};

// ─── Style to CSS ────────────────────────────────────────────────────────────

export interface StyleProps {
  paddingTop?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  paddingRight?: string;
  marginTop?: string;
  marginBottom?: string;
  borderWidth?: string;
  borderColor?: string;
  borderRadius?: string;
}

export function stylePropsToCSS(props: Record<string, unknown>): CSSProperties {
  const css: CSSProperties = {};

  const pt = Number(props.paddingTop) || 0;
  const pb = Number(props.paddingBottom) || 0;
  const pl = Number(props.paddingLeft) || 0;
  const pr = Number(props.paddingRight) || 0;
  if (pt || pb || pl || pr) {
    css.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
  }

  const mt = Number(props.marginTop) || 0;
  const mb = Number(props.marginBottom) || 0;
  if (mt || mb) {
    css.marginTop = mt ? `${mt}px` : undefined;
    css.marginBottom = mb ? `${mb}px` : undefined;
  }

  const bw = Number(props.borderWidth) || 0;
  if (bw > 0) {
    css.border = `${bw}px solid ${(props.borderColor as string) || "#E8E4DF"}`;
  }

  const br = Number(props.borderRadius) || 0;
  if (br > 0) {
    css.borderRadius = br >= 9999 ? "9999px" : `${br}px`;
  }

  return css;
}
