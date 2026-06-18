"use client";

/**
 * InlineSaveBar — floating bottom bar with dirty indicator + save/exit.
 *
 * Spec: custom-branded-page-builder — task 15.4, 17.1
 *       live-page-editor — task 10.1
 * _Requirements: 10.1, 10.2, 10.5 (custom-branded-page-builder);
 *                8.1, 8.2, 8.5, 8.7, 8.8 (live-page-editor)_
 *
 * Posts to the same `PUT /api/pages/:id` endpoint the admin builder
 * uses, so all approval-routing logic in `lib/cms/api/routes/pages.ts`
 * applies automatically (Req 8.1 / 10.1). The save body carries both the
 * edited `data` and the `version` identifier the editor loaded so the
 * endpoint can detect a stale write (Req 8.1).
 *
 * Response handling (live-page-editor Req 8):
 *   - `{ pendingDraft: true }` → surface "saved to pending draft, live
 *     unchanged" and clear the dirty indication via `onSaved` (Req 8.2).
 *   - `403 Forbidden` → `onPermissionRevoked` so the shell tears down edit
 *     mode and shows the non-dismissable notice (Req 8.5).
 *   - `409 Conflict` / stale → `onStaleConflict`; the editor data is NOT
 *     overwritten and the user is told the page changed since load (Req 8.7).
 *   - timeout (no response within 30s, via `AbortController`) or any other
 *     failure → error message; the unsaved changes are retained (Req 8.8).
 */

import { useState } from "react";

/** Save requests abort if the server does not respond within this window. */
const SAVE_TIMEOUT_MS = 30_000;

interface InlineSaveBarProps {
  pageId: string;
  /** Whether the in-memory page data differs from the last saved snapshot. */
  dirty: boolean;
  /** Builder data to POST. */
  data: unknown;
  /**
   * Version identifier of the page data the editor loaded. Echoed back on
   * save so the endpoint can detect a stale write (Req 8.1). `null` when no
   * version was provided (e.g. the public surface).
   */
  version: string | null;
  /** Called after a successful save (with `pendingDraft` flag from server). */
  onSaved: (info: { pendingDraft: boolean }) => void;
  /** Called when the user clicks "Exit Edit Mode". */
  onExit: () => void;
  /** Called on a 403 response — server rejected the save (Req 8.5). */
  onPermissionRevoked: () => void;
  /**
   * Called on a 409 / stale-version response — the stored page changed since
   * it was loaded. The editor data is left untouched (Req 8.7).
   */
  onStaleConflict?: () => void;
}

type SaveState = "idle" | "saving" | "error";

export function InlineSaveBar({
  pageId,
  dirty,
  data,
  version,
  onSaved,
  onExit,
  onPermissionRevoked,
  onStaleConflict,
}: InlineSaveBarProps) {
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [staleMsg, setStaleMsg] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState(false);

  async function handleSave() {
    setState("saving");
    setErrorMsg(null);
    setStaleMsg(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);

    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ data, version }),
        signal: controller.signal,
      });

      if (res.status === 403) {
        onPermissionRevoked();
        return;
      }

      // Stale write — the stored page changed since it was loaded. Do NOT
      // overwrite; inform the user and keep the unsaved changes (Req 8.7).
      if (res.status === 409) {
        onStaleConflict?.();
        setStaleMsg(
          "This page changed since you loaded it. Your changes were not saved.",
        );
        setState("error");
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
      // Aborts (timeout) and all other failures retain the unsaved changes
      // and surface an error message (Req 8.8).
      if (err instanceof Error && err.name === "AbortError") {
        setErrorMsg("Save timed out. Your changes were not saved.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Save failed");
      }
      setState("error");
    } finally {
      clearTimeout(timeout);
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
      {staleMsg ? (
        <span role="alert" style={{ color: "#FF6B6B", fontSize: 12 }}>
          {staleMsg}
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
