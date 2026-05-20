"use client";

/**
 * PageSettingsFields — page-level settings shown on the `Configurations` tab
 * of the ConfigurationPanel when no block is selected.
 *
 * Spec: custom-branded-page-builder — Requirement 3.5
 *
 * This is a small shared helper so later tasks (full slug/SEO editing, e.g.
 * tied into the pages API) and the inline editor's ConfigurationSheet can
 * render the same page-level surface. For now:
 *   - `title` is live-editable and backed by `useBuilderShell()` (the same
 *     source the TopBar already writes to, so changes here keep the existing
 *     dirty-tracking and save flow working).
 *   - `slug` is shown read-only. Slug editing lives outside the builder shell
 *     today; a later task will wire it through the Pages API.
 *   - `seo.description` is a placeholder input — the `pages.data.root.props`
 *     shape does not yet carry SEO metadata. Future work (outside the scope
 *     of task 3.1) will extend the document/root props and wire this field.
 */

import React from "react";
import { useBuilderShell } from "../shell-context";
import { OraTextField } from "../inspector/controls/OraFields";
import { ORA_THEME } from "../inspector/tokens";

export interface PageSettingsFieldsProps {
  /** Current page slug — display-only for now. */
  slug?: string;
}

export function PageSettingsFields({ slug }: PageSettingsFieldsProps) {
  const { documentTitle, setDocumentTitle } = useBuilderShell();

  return (
    <div data-testid="ora-page-settings">
      <OraTextField
        label="Title"
        value={documentTitle}
        onChange={(next) => setDocumentTitle(next)}
        placeholder="Page title"
      />

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Slug</label>
        <input
          type="text"
          value={slug ?? ""}
          readOnly
          aria-readonly="true"
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            fontFamily: "inherit",
            color: ORA_THEME.muted,
            background: ORA_THEME.creamLight,
            border: `1px solid ${ORA_THEME.border}`,
            borderRadius: 0,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={hintStyle}>
          Slug is managed from the pages list. Editing here is wired in a later
          task.
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>SEO description</label>
        <textarea
          value=""
          readOnly
          aria-readonly="true"
          rows={3}
          placeholder="Will be editable once SEO metadata is wired into page data."
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            fontFamily: "inherit",
            color: ORA_THEME.muted,
            background: ORA_THEME.creamLight,
            border: `1px solid ${ORA_THEME.border}`,
            borderRadius: 0,
            outline: "none",
            boxSizing: "border-box",
            resize: "vertical",
            minHeight: 60,
          }}
        />
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: ORA_THEME.muted,
  marginTop: 4,
};
