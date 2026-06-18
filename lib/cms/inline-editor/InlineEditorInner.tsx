"use client";

/**
 * InlineEditorInner — the shared editor body that lives *inside* a headless
 * `<Puck>` context and wires selection → configuration/selection overlays →
 * save bar. This is the single source of truth for the selection→sheet
 * wiring, consumed by both the public `InlineEditorClient` (behind its
 * opt-in gate) and the authenticated live editor shell (always-on).
 *
 * Spec: live-page-editor — task 1.6
 * _Requirements: 3.4, 7.3_
 *
 * Originally lived inline in `InlineEditorClient.tsx`, coupling three
 * concerns: (1) the public "Enter Edit Mode" opt-in gate, (2) the headless
 * Puck + selection + sheets wiring, and (3) the permission-revocation
 * lockout. Concern (2) — plus the lockout (3), so it is preserved for every
 * consumer — is extracted here so the live editor shell can reuse the exact
 * same wiring without re-implementing or forking it. Concern (1) stays in
 * `InlineEditorClient` and is made optional via its `alwaysOn` prop.
 *
 * Responsibilities:
 *   - Sit inside `<Puck>` so it can `usePuckStore()` to dispatch selection
 *     and read change notifications.
 *   - Map DOM selection (`useInlineSelection`) → Puck `itemSelector` and
 *     open the configuration sheet.
 *   - Render the selection overlay, configuration sheet, and save bar.
 *   - Own the permission-revocation lockout: once the save endpoint reports
 *     a revoked permission (403), render a non-dismissable notice and stop
 *     rendering any editing affordance until the page is refreshed
 *     (Req 9.5 / Req 8.5, 8.6). Keeping the lockout here makes it a single
 *     source of truth shared by every surface that mounts the inner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { type Data as PuckData } from "@puckeditor/core";
import { usePuckStore } from "@/lib/page-builder/use-puck-store";
import { withInlineRichtextMenu } from "@/lib/page-builder/builder-shell/with-inline-richtext-menu";
import { pageBuilderConfig } from "@/lib/page-builder/config";
import { type InlineSelection, useInlineSelection } from "./useInlineSelection";
import { SelectionOverlay } from "./SelectionOverlay";
import { ConfigurationSheet } from "./ConfigurationSheet";
import { InlineSaveBar } from "./InlineSaveBar";

/**
 * Editor-only config augmentation (ORA inline rich-text menus), built once.
 * Kept module-scoped since `pageBuilderConfig` is a stable singleton — this
 * avoids re-augmenting on every render. See `with-inline-richtext-menu.tsx`
 * for why this is applied at the editor layer rather than in `config.ts`.
 *
 * Exported as the shared editor config so every surface that mounts the
 * headless `<Puck>` (the public client and the live shell) uses the exact
 * same augmented config.
 */
export const editorConfig = withInlineRichtextMenu(pageBuilderConfig);

/**
 * Disable Puck's duplicate/delete so the selection overlay's action bar
 * carries only the native inline rich-text formatting bubble (the frontend
 * inline editor provides its own block actions). Mirrors `BuilderShell`.
 *
 * Exported alongside `editorConfig` so both editing surfaces mount Puck with
 * identical permissions.
 */
export const INLINE_EDITOR_PERMISSIONS = {
  duplicate: false,
  delete: false,
} as const;

/**
 * Non-dismissable permission-revocation notice. Rendered by
 * `InlineEditorInner` once a save returns 403, and exported so a host shell
 * can reuse the same overlay for its own lockout state.
 */
export function RevokedOverlay() {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      data-inline-editor-ui=""
      data-testid="inline-editor-revoked"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#FFF",
          padding: 24,
          maxWidth: 420,
          borderRadius: 8,
          textAlign: "center",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>
          Edit permissions revoked
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
          Your edit permissions have been revoked. Please refresh the page.
        </p>
      </div>
    </div>
  );
}

export interface InlineEditorInnerProps {
  pageId: string;
  pageSlug?: string;
  initialData: PuckData;
  /**
   * Version identifier of the page data the editor loaded, threaded to the
   * save bar so it is echoed back on save for stale-write detection
   * (live-page-editor Req 8.1). The public surface has no version, so this
   * defaults to `null`; the live editor shell threads the loaded version.
   */
  version?: string | null;
  /**
   * Called when the user exits edit mode. The public client returns to its
   * opt-in gate; a live shell may navigate away.
   */
  onExit: () => void;
  /**
   * Optional notification fired when the save endpoint reports the user's
   * edit permission was revoked (HTTP 403). The inner already renders the
   * non-dismissable lockout overlay itself (single source of truth); a host
   * shell can use this to lock its own affordances too.
   */
  onPermissionRevoked?: () => void;
  /**
   * Optional notification fired when the save endpoint reports a stale write
   * (HTTP 409) — the stored page changed since it was loaded. The save bar
   * already informs the user and retains the unsaved changes; a host shell
   * can use this to react (live-page-editor Req 8.7).
   */
  onStaleConflict?: () => void;
  /**
   * Externally-driven selection state.
   *
   * When provided (the live editor shell), the inner does NOT run its own
   * `pointerdown` selection listener — selection is driven entirely by the
   * shell's capture-phase `useNavigationNeutralizer`, which is the sole
   * selection driver per design.md. The shell passes a `useInlineSelection`
   * instance it owns (mounted `active=false`) so the neutralizer can push
   * id+element through `setSelectedId`/`setSelectedEl`.
   *
   * When omitted (the public `InlineEditorClient`), the inner owns an active
   * `useInlineSelection` listener exactly as before — the public surface is
   * unchanged.
   */
  selection?: InlineSelection;
}

/**
 * Inner component sits inside `<Puck>` so it can use `usePuckStore()` to
 * dispatch selection and read change notifications.
 */
export function InlineEditorInner({
  pageId,
  pageSlug,
  initialData,
  version = null,
  onExit,
  onPermissionRevoked,
  onStaleConflict,
  selection,
}: InlineEditorInnerProps) {
  const appState = usePuckStore((s) => s.appState);
  const dispatch = usePuckStore((s) => s.dispatch);
  const dataRef = useRef<PuckData>(initialData);
  const [dirty, setDirty] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [revoked, setRevoked] = useState(false);

  // When the shell injects an external selection, mount our own hook inert
  // (`active=false`) so there is exactly one selection driver (the shell's
  // neutralizer). Otherwise own an active `pointerdown` listener as before.
  const ownSelection = useInlineSelection(selection == null);
  const { selectedId, selectedEl } = selection ?? ownSelection;

  // Mirror Puck data → ref so the save bar always sees the latest
  // snapshot without forcing re-renders on every keystroke.
  useEffect(() => {
    if (!appState) return;
    const next = appState.data;
    if (next === dataRef.current) return;
    dataRef.current = next;
    setDirty(true);
  }, [appState]);

  // Keep a stable ref to dispatch and appState so the selection effect
  // doesn't re-fire on every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const appStateRef = useRef(appState);
  appStateRef.current = appState;

  // Selection → Puck `itemSelector` + sheet coupling.
  //
  // When a block is selected, re-target Puck's `itemSelector` so the wrapped
  // `ConfigurationPanel` re-renders for that block and open the sheet (Req
  // 7.1). Selecting a *different* block while the sheet is already open
  // re-targets and keeps it open — `setSheetOpen(true)` is idempotent — so the
  // panel swaps to the new block's fields without closing (Req 7.6).
  //
  // When nothing is selected, close the sheet so the Configuration_Sheet is
  // open iff a block is selected; `SelectionOverlay` already hides itself when
  // `selectedEl` is null, so no indicator is shown either (Req 7.8). The
  // configuration panel reads `selectedItem` off `usePuckStore()` so it picks
  // up the re-target automatically.
  useEffect(() => {
    if (!selectedId) {
      setSheetOpen(false);
      return;
    }
    dispatchRef.current({
      type: "setUi",
      ui: {
        itemSelector: { index: indexOf(appStateRef.current?.data, selectedId) },
      },
    });
    setSheetOpen(true);
  }, [selectedId]);

  // Permission-revocation lockout. Bubble the signal to any host shell, then
  // trip the local lockout so the inner stops rendering editing affordances.
  const handlePermissionRevoked = useCallback(() => {
    setRevoked(true);
    onPermissionRevoked?.();
  }, [onPermissionRevoked]);

  const handleSaved = useCallback(() => {
    setDirty(false);
  }, []);

  const selectedLabel = selectedId
    ? labelFor(appState?.data, selectedId)
    : null;

  // Once tripped, the inline editor refuses to render any UI for the rest
  // of the session — only a refresh resets it (Req 9.5).
  if (revoked) {
    return <RevokedOverlay />;
  }

  return (
    <>
      <SelectionOverlay
        selectedEl={selectedEl}
        selectedLabel={selectedLabel}
        onEdit={() => setSheetOpen(true)}
      />
      <ConfigurationSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        pageSlug={pageSlug}
      />
      <InlineSaveBar
        pageId={pageId}
        dirty={dirty}
        data={dataRef.current}
        version={version}
        onSaved={handleSaved}
        onExit={onExit}
        onPermissionRevoked={handlePermissionRevoked}
        onStaleConflict={onStaleConflict}
      />
    </>
  );
}

/** Find the `content`-array index of a block by id. -1 if absent. */
function indexOf(data: PuckData | undefined, id: string): number {
  if (!data?.content) return -1;
  return data.content.findIndex(
    (item) => (item.props as { id?: unknown })?.id === id,
  );
}

/** Look up a human-readable label for a block id. Falls back to the type. */
function labelFor(data: PuckData | undefined, id: string): string | null {
  const idx = indexOf(data, id);
  if (idx < 0) return null;
  const item = data!.content[idx];
  return (item.type as string) ?? null;
}
