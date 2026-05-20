"use client";

/**
 * BackgroundImageUploader — ORA-themed media picker for background images.
 *
 * Spec: custom-branded-page-builder — Requirements 6.4, 6.5
 *
 * Presents a thumbnail preview of the currently selected background image
 * or a placeholder "Add background image" button. Clicking either opens
 * the existing global `<MediaPickerModal>` from
 * `lib/cms/components/MediaPickerModal.tsx` with `mimeTypeFilter="image/"`.
 * The selected asset's `storageUrl` is written to `onChange` unchanged
 * (Req 6.5). A "Remove" button clears the slot by calling `onChange(undefined)`.
 *
 * Styling follows the same inline-style / `ORA_THEME` token approach used
 * by the sibling controls in this folder (`StepperField`,
 * `SegmentedAlignControl`) so the Background Settings Property_Section has
 * a consistent visual language end-to-end.
 *
 * Assumptions about the MediaPickerModal contract
 * ------------------------------------------------
 * `MediaPickerModal` takes only `{ open, onClose, onSelect?, onSelectItem?,
 * mimeTypeFilter? }` — no tenant id or other required props. It resolves
 * the current user's tenant internally via `apiFetch` against `/api/media`.
 * We therefore pass only `open`, `onClose`, `onSelect`, and
 * `mimeTypeFilter="image/"`. If in future the modal needs a tenant id
 * prop, this component's signature will not need to change; the modal
 * itself will source it the same way all other call sites do.
 *
 * This component is purely presentational and does not wire itself into
 * `FieldControlRegistry` — that wiring is handled by a later task.
 */

import React from "react";
import { ImagePlus, X } from "lucide-react";
import { MediaPickerModal } from "@/lib/cms/components/MediaPickerModal";
import { ORA_THEME } from "../inspector/tokens";

export interface BackgroundImageUploaderProps {
  /** Current background image URL, or `undefined` when no image is set. */
  value: string | undefined;
  /** Called with the selected asset URL, or `undefined` when cleared. */
  onChange: (next: string | undefined) => void;
  /** Accessible label shown above the uploader. Defaults to "Background image". */
  label?: string;
}

export function BackgroundImageUploader({
  value,
  onChange,
  label = "Background image",
}: BackgroundImageUploaderProps) {
  const [open, setOpen] = React.useState(false);

  const handleOpen = React.useCallback(() => setOpen(true), []);
  const handleClose = React.useCallback(() => setOpen(false), []);
  const handleSelect = React.useCallback(
    (url: string) => {
      onChange(url);
    },
    [onChange],
  );
  const handleRemove = React.useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <div style={rowStyle}>
      {label ? <div style={labelStyle}>{label}</div> : null}

      {hasValue ? (
        <div style={previewRowStyle}>
          <button
            type="button"
            onClick={handleOpen}
            aria-label="Replace background image"
            title="Replace background image"
            style={thumbButtonStyle}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Background image preview"
              style={thumbImgStyle}
            />
          </button>
          <div style={actionColumnStyle}>
            <button
              type="button"
              onClick={handleOpen}
              aria-label="Replace background image"
              style={replaceButtonStyle}
            >
              Replace
            </button>
            <button
              type="button"
              onClick={handleRemove}
              aria-label="Remove background image"
              style={removeButtonStyle}
            >
              <X size={12} aria-hidden />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          aria-label="Add background image"
          style={placeholderButtonStyle}
        >
          <ImagePlus size={16} aria-hidden />
          <span>Add background image</span>
        </button>
      )}

      <MediaPickerModal
        open={open}
        onClose={handleClose}
        onSelect={handleSelect}
        mimeTypeFilter="image/"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles — consume ORA tokens from ../inspector/tokens.ts
// ─────────────────────────────────────────────────────────────────────────

const rowStyle: React.CSSProperties = {
  marginBottom: 12,
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 6,
};

const previewRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
};

const thumbButtonStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  padding: 0,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 4,
  overflow: "hidden",
  background: ORA_THEME.creamLight,
  cursor: "pointer",
  flex: "0 0 auto",
  outlineOffset: 2,
};

const thumbImgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const actionColumnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
  minWidth: 0,
};

const replaceButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 28,
  padding: "0 10px",
  fontSize: 12,
  fontFamily: "inherit",
  color: ORA_THEME.charcoal,
  background: ORA_THEME.white,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  cursor: "pointer",
};

const removeButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  height: 28,
  padding: "0 10px",
  fontSize: 12,
  fontFamily: "inherit",
  color: ORA_THEME.danger,
  background: ORA_THEME.white,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  cursor: "pointer",
};

const placeholderButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  height: 72,
  padding: "0 12px",
  fontSize: 12,
  fontFamily: "inherit",
  color: ORA_THEME.muted,
  background: ORA_THEME.creamLight,
  border: `1px dashed ${ORA_THEME.border}`,
  borderRadius: 4,
  cursor: "pointer",
  outlineOffset: 2,
};
