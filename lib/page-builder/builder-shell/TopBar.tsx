"use client";

import React from "react";
import {
  Undo2,
  Redo2,
  Eye,
  Save as SaveIcon,
  Rocket,
} from "lucide-react";
import { usePuckStore } from "@/lib/page-builder/use-puck-store";
import { ORA_THEME } from "./inspector/tokens";
import { useBuilderShell } from "./shell-context";
import { BreakpointSwitcher } from "./BreakpointSwitcher";

const buttonBase: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  border: "none",
  borderRadius: 0,
  cursor: "pointer",
  textTransform: "uppercase",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const ghostBtn: React.CSSProperties = {
  ...buttonBase,
  background: "transparent",
  color: ORA_THEME.white,
};

const primaryBtn: React.CSSProperties = {
  ...buttonBase,
  background: ORA_THEME.gold,
  color: ORA_THEME.white,
};

const outlineBtn: React.CSSProperties = {
  ...buttonBase,
  background: "transparent",
  color: ORA_THEME.white,
  border: `1px solid rgba(255,255,255,0.25)`,
};

export function TopBar() {
  const {
    documentTitle,
    setDocumentTitle,
    dirty,
    saving,
    publishing,
    onSave,
    onPublish,
    onPreview,
  } = useBuilderShell();
  const history = usePuckStore((s) => s.history);
  const [confirmingPublish, setConfirmingPublish] = React.useState(false);

  // beforeunload guard — block navigation if there are unsaved changes
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const requestPublish = () => setConfirmingPublish(true);
  const confirmPublish = async () => {
    setConfirmingPublish(false);
    await onPublish();
  };

  return (
    <header
      role="banner"
      data-testid="ora-topbar"
      style={{
        gridColumn: "1 / -1",
        gridRow: "1",
        background: ORA_THEME.charcoalDark,
        color: ORA_THEME.white,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        borderBottom: `1px solid ${ORA_THEME.charcoal}`,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        ORA
      </span>
      <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.2)" }} />
      <input
        type="text"
        aria-label="Document title"
        value={documentTitle}
        onChange={(e) => setDocumentTitle(e.target.value)}
        style={{
          flex: "0 1 320px",
          minWidth: 120,
          padding: "4px 8px",
          fontSize: 13,
          color: ORA_THEME.white,
          background: "transparent",
          border: "1px solid transparent",
          outline: "none",
          fontWeight: 500,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "transparent";
        }}
      />
      {dirty ? (
        <span
          aria-label="Unsaved changes"
          title="Unsaved changes"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: ORA_THEME.gold,
          }}
        />
      ) : null}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        aria-label="Undo"
        onClick={() => history.back()}
        disabled={!history.hasPast}
        style={{ ...ghostBtn, opacity: history.hasPast ? 1 : 0.4 }}
      >
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        onClick={() => history.forward()}
        disabled={!history.hasFuture}
        style={{ ...ghostBtn, opacity: history.hasFuture ? 1 : 0.4 }}
      >
        <Redo2 size={16} aria-hidden="true" />
      </button>

      <button type="button" onClick={onPreview} style={outlineBtn}>
        <Eye size={14} aria-hidden="true" />
        Preview
      </button>
      <BreakpointSwitcher />
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        style={{ ...outlineBtn, opacity: saving ? 0.6 : 1 }}
      >
        <SaveIcon size={14} aria-hidden="true" />
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={requestPublish}
        disabled={publishing}
        style={{ ...primaryBtn, opacity: publishing ? 0.6 : 1 }}
      >
        <Rocket size={14} aria-hidden="true" />
        {publishing ? "Publishing…" : "Publish"}
      </button>

      {confirmingPublish ? (
        <PublishConfirmModal
          onCancel={() => setConfirmingPublish(false)}
          onConfirm={confirmPublish}
        />
      ) : null}
    </header>
  );
}

function PublishConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm publish"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: ORA_THEME.white,
          color: ORA_THEME.charcoal,
          width: 380,
          padding: 20,
          border: `1px solid ${ORA_THEME.border}`,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Publish document?</h2>
        <p style={{ margin: "10px 0 18px 0", fontSize: 13, color: ORA_THEME.muted }}>
          Publishing will make the latest saved version visible to readers. You can
          unpublish at any time.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...buttonBase,
              background: "transparent",
              color: ORA_THEME.charcoal,
              border: `1px solid ${ORA_THEME.border}`,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ ...buttonBase, background: ORA_THEME.gold, color: ORA_THEME.white }}
          >
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
