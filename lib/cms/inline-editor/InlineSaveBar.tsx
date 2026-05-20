"use client";

/**
 * InlineSaveBar — floating bottom bar with dirty indicator + save/exit.
 *
 * Spec: custom-branded-page-builder — task 15.4, 17.1
 * _Requirements: 10.1, 10.2, 10.5_
 *
 * Posts to the same `PUT /api/pages/:id` endpoint the admin builder
 * uses, so all approval-routing logic in `lib/cms/api/routes/pages.ts`
 * applies automatically (Req 10.1). When the server returns
 * `{ pendingDraft: true }` we surface that as the post-save banner so
 * the editor knows the live page is unchanged (Req 10.5).
 *
 * On `403 Forbidden` the bar invokes `onPermissionRevoked` so the
 * client shell can tear down edit mode and show the non-dismissable
 * notice (Req 9.5).
 */

import { useState } from "react";

interface InlineSaveBarProps {
  pageId: string;
  /** Whether the in-memory page data differs from the last saved snapshot. */
  dirty: boolean;
  /** Builder data to POST. */
  data: unknown;
  /** Called after a successful save (with `pendingDraft` flag from server). */
  onSaved: (info: { pendingDraft: boolean }) => void;
  /** Called when the user clicks "Exit Edit Mode". */
  onExit: () => void;
  /** Called on a 403 response — server rejected the save. */
  onPermissionRevoked: () => void;
}

type SaveState = "idle" | "saving" | "error";

export function InlineSaveBar({
  pageId,
  dirty,
  data,
  onSaved,
  onExit,
  onPermissionRevoked,
}: InlineSaveBarProps) {
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState(false);

  async function handleSave() {
    setState("saving");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ data }),
      });

      if (res.status === 403) {
        onPermissionRevoked();
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body?.error ?? `Save failed (${res.status})`);
        setState("error");
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        pendingDraft?: boolean;
      };
      setPendingDraft(!!body.pendingDraft);
      setState("idle");
      onSaved({ pendingDraft: !!body.pendingDraft });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed");
      setState("error");
    }
  }

  return (
    <div
      data-inline-editor-ui=""
      data-testid="inline-save-bar"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#1A1A1A",
        color: "#FFF",
        padding: "10px 16px",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
        zIndex: 9999,
        fontSize: 13,
      }}
    >
      <span
        aria-label={dirty ? "Unsaved changes" : "All changes saved"}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dirty ? "#E5A82C" : "#5BBE6E",
        }}
      />
      <span>{dirty ? "Unsaved changes" : "Saved"}</span>
      {pendingDraft ? (
        <span style={{ fontSize: 12, color: "#E5A82C" }}>
          Saved to pending draft — live page unchanged
        </span>
      ) : null}
      {errorMsg ? (
        <span role="alert" style={{ color: "#FF6B6B", fontSize: 12 }}>
          {errorMsg}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || state === "saving"}
        style={{
          background: dirty ? "#C9A961" : "#555",
          color: "#1A1A1A",
          border: "none",
          padding: "6px 14px",
          fontSize: 13,
          fontWeight: 600,
          cursor: dirty ? "pointer" : "not-allowed",
        }}
      >
        {state === "saving" ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={onExit}
        style={{
          background: "transparent",
          color: "#FFF",
          border: "1px solid #555",
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Exit Edit Mode
      </button>
    </div>
  );
}
