"use client";

import React from "react";
import { usePuck } from "@puckeditor/core";
import { ORA_THEME } from "./inspector/tokens";
import { useBuilderShell } from "./shell-context";

export function StatusBar() {
  const { dirty, lastSavedAt, errorMessage, dismissError } = useBuilderShell();
  const { selectedItem } = usePuck();

  const breadcrumb = selectedItem
    ? `${selectedItem.type} · ${String(selectedItem.props.id ?? "").slice(0, 16)}`
    : "No selection";

  return (
    <footer
      data-testid="ora-statusbar"
      style={{
        gridColumn: "1 / -1",
        gridRow: "3",
        background: ORA_THEME.white,
        borderTop: `1px solid ${ORA_THEME.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 12,
        fontSize: 11,
        color: ORA_THEME.muted,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span>{breadcrumb}</span>
      <span style={{ flex: 1 }} />
      {errorMessage ? (
        <button
          type="button"
          onClick={dismissError}
          style={{
            background: "transparent",
            border: `1px solid ${ORA_THEME.danger}`,
            color: ORA_THEME.danger,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 11,
            borderRadius: 0,
          }}
          aria-label="Dismiss error"
        >
          {errorMessage} ✕
        </button>
      ) : null}
      <span>
        {dirty
          ? "Unsaved changes"
          : lastSavedAt
            ? `Saved ${formatTime(lastSavedAt)}`
            : "Not saved yet"}
      </span>
    </footer>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
