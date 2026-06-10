"use client";

/**
 * BackgroundColorPicker — ORA-themed background color control.
 *
 * Spec: custom-branded-page-builder — Requirement 6.4
 *
 * Thin wrapper around the existing `<OraColorPicker>` (swatches + recents +
 * hex input + optional alpha + optional eyedropper). Defaults the label to
 * "Background" so the `Background Settings` Property_Section can drop this
 * in without extra plumbing, while still allowing a caller to override the
 * label where needed (for example "Overlay color").
 *
 * The `value` prop accepts any CSS color string — typical inputs are the
 * palette hexes in `tokens.ts` ("#FFFFFF", "#F5F3F0", …) or the special
 * keyword "transparent". When the stored value is `undefined` or the
 * `transparent` keyword, the underlying picker falls back to a sensible
 * blank swatch ("") so no preset appears active until the user commits a
 * choice. Writes flow through `onChange` unchanged and always emit a
 * non-empty CSS color string, never `undefined`.
 *
 * Styling consumes ORA tokens from `../inspector/tokens.ts` through the
 * wrapped `OraColorPicker`. The component is purely presentational and is
 * wired into `FieldControlRegistry` by a later task.
 */

import React from "react";
import { OraColorPicker } from "../inspector/controls/OraColorPicker";

export interface BackgroundColorPickerProps {
  /** Current CSS color string (e.g. "#FFFFFF", "transparent"). */
  value: string | undefined;
  /** Called with the next CSS color string — never empty. */
  onChange: (next: string) => void;
  /** Accessible label shown above the picker. Defaults to "Background". */
  label?: string;
  /** Allow editing the alpha channel (8-digit hex). Default false. */
  allowAlpha?: boolean;
}

/**
 * "transparent" is the other common sentinel value for a background slot.
 * The underlying picker expects a hex string, so we normalize keywords to
 * an empty display value and preserve the original sentinel on commit by
 * letting the caller decide — we only pass hex back up.
 */
function normalizeForDisplay(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "transparent") return "";
  return trimmed;
}

export function BackgroundColorPicker({
  value,
  onChange,
  label = "Background",
  allowAlpha = false,
}: BackgroundColorPickerProps) {
  const display = normalizeForDisplay(value);

  return (
    <OraColorPicker
      label={label}
      value={display}
      onChange={onChange}
      allowAlpha={allowAlpha}
    />
  );
}
