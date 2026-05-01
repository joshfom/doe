/**
 * Shared style control fields (padding, margin, border) for all components.
 * These are rendered through the shared custom control system so every block
 * gets the same UI language.
 */

import type { CSSProperties } from "react";
import {
  createColorField,
  createSliderField,
  createStepperField,
  normalizeLength,
} from "./shared-field-controls";

// ─── Field Definitions ───────────────────────────────────────────────────────

export const styleFields = {
  paddingTop: createStepperField("Top", 4, 0, "Top padding"),
  paddingBottom: createStepperField("Bottom", 4, 0, "Bottom padding"),
  paddingLeft: createStepperField("Left", 4, 0, "Left padding"),
  paddingRight: createStepperField("Right", 4, 0, "Right padding"),
  marginTop: createStepperField("Top", 4, 0, "Top margin"),
  marginBottom: createStepperField("Bottom", 4, 0, "Bottom margin"),
  borderWidth: createSliderField("Width", 0, 12, "px", "Border thickness"),
  borderColor: createColorField("Color", "#E8E4DF", "Border color"),
  borderRadius: createSliderField("Radius", 0, 100, "px", "Border radius"),
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

  const pt = normalizeLength(props.paddingTop, "px");
  const pb = normalizeLength(props.paddingBottom, "px");
  const pl = normalizeLength(props.paddingLeft, "px");
  const pr = normalizeLength(props.paddingRight, "px");
  if (pt || pb || pl || pr) {
    css.padding = `${pt || "0px"} ${pr || "0px"} ${pb || "0px"} ${pl || "0px"}`;
  }

  const mt = normalizeLength(props.marginTop, "px");
  const mb = normalizeLength(props.marginBottom, "px");
  if (mt || mb) {
    css.marginTop = mt || undefined;
    css.marginBottom = mb || undefined;
  }

  const bw = Number(props.borderWidth) || 0;
  if (bw > 0) {
    css.border = `${bw}px solid ${(props.borderColor as string) || "#E8E4DF"}`;
  }

  const br = normalizeLength(props.borderRadius, "px");
  if (br) {
    css.borderRadius = br === "9999px" ? "9999px" : br;
  }

  return css;
}
