"use client";

/**
 * InlineEditorClient — the heavy client implementation lazily imported
 * via `InlineEditorBootstrap`.
 *
 * Spec: custom-branded-page-builder — task 15.1, 15.2, 15.3, 15.4, 16.2
 * _Requirements: 8.2, 8.3, 8.4, 9.5, 10.1, 10.2, 10.5, 18.4_
 *
 * Bundled into the `inline-editor.chunk.js` chunk. Anonymous public
 * pages never load this module (Req 19.1, 19.4) — the
 * `InlineEditorProvider` server gate is the single chokepoint.
 *
 * Responsibilities:
 *   1. Fetch the live page data from `GET /api/pages/:id` so the editor
 *      starts from the same snapshot the renderer rendered.
 *   2. Mount a **headless** `<Puck>` context with the same
 *      `pageBuilderConfig` so the Slice 1 `ConfigurationPanel` (which
 *      depends on `usePuck()`) works unchanged inside our slide-in
 *      sheet (Req 8.4 — code reuse invariant).
 *   3. Wire selection: click on any `[data-puck-id]` element ⇒ select
 *      that block in Puck state ⇒ open the configuration sheet.
 *   4. Save via the same `PUT /api/pages/:id` endpoint as the admin
 *      builder so approval routing applies automatically (Req 10.1).
 *   5. On 403, tear down edit mode and show a non-dismissable notice
 *      (Req 9.5).
 *
 * Implementation notes:
 *   - Puck is mounted with `style={{ display: "none" }}`. We're not
 *     rendering its canvas — the live page is the canvas. We only need
 *     its state engine + dispatch + selection so the sheet's
 *     `ConfigurationPanel` operates against a real Puck context.
 *   - The Puck `onChange` callback drives our `dirty` flag and updates
 *     a ref the save bar reads; we intentionally do NOT replay block
 *     changes back into the live DOM. That's a follow-up (full
 *     bi-directional editing) once `data-puck-id` annotation lands in
 *     the public renderer (task 15.5). Today users see their changes
 *     after save + reload.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Puck,
  type Data as PuckData,
} from "@puckeditor/core";
import { usePuckStore } from "@/lib/page-builder/use-puck-store";
import { headlessOverrides } from "@/lib/page-builder/builder-shell/headless-overrides";
import { pageBuilderConfig } from "@/lib/page-builder/config";
import { migratePageData } from "@/lib/page-builder/migrate-data";
import { useInlineSelection } from "./useInlineSelection";
import { SelectionOverlay } from "./SelectionOverlay";
import { ConfigurationSheet } from "./ConfigurationSheet";
import { InlineSaveBar } from "./InlineSaveBar";

interface InlineEditorClientProps {
  pageId: string;
}

interface PageDataResponse {
  id: string;
  slug?: string;
  data: PuckData;
}

export function InlineEditorClient({ pageId }: InlineEditorClientProps) {
  const [initialData, setInitialData] = useState<PuckData | null>(null);
  const [pageSlug, setPageSlug] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [active, setActive] = useState(false);

  // Fetch initial page snapshot. We deliberately don't gate the editor
  // on a stale prop — the snapshot is the source of truth for the
  // editing session, separate from what's currently rendered.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pages/${pageId}`, {
          credentials: "include",
        });
        if (!res.ok) {
          setLoadError(`Failed to load page (${res.status})`);
          return;
        }
        const body = (await res.json()) as { data?: PageDataResponse };
        if (cancelled || !body?.data) return;
        setInitialData(migratePageData(body.data.data));
        setPageSlug(body.data.slug);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  // Permission-revocation lockout. Once tripped, the inline editor
  // refuses to render any UI for the rest of the session — only a
  // refresh resets it (Req 9.5).
  if (revoked) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
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
            Your edit permissions have been revoked. Please refresh the
            page.
          </p>
        </div>
      </div>
    );
  }

  // Floating "Enter Edit Mode" trigger — visible until the user opts
  // in. Keeps the page's normal behavior intact for browsing.
  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        data-inline-editor-ui=""
        data-testid="inline-editor-trigger"
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          background: "#1A1A1A",
          color: "#C9A961",
          border: "1px solid #C9A961",
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          zIndex: 9999,
        }}
      >
        Enter Edit Mode
      </button>
    );
  }

  if (loadError) {
    return (
      <div role="alert" data-inline-editor-ui="" style={alertStyle}>
        {loadError}
      </div>
    );
  }

  if (!initialData) {
    return (
      <div data-inline-editor-ui="" style={alertStyle}>
        Loading editor…
      </div>
    );
  }

  return (
    <Puck
      config={pageBuilderConfig}
      data={initialData}
      overrides={headlessOverrides}
    >
      <InlineEditorInner
        pageId={pageId}
        pageSlug={pageSlug}
        initialData={initialData}
        onPermissionRevoked={() => setRevoked(true)}
        onExit={() => setActive(false)}
      />
    </Puck>
  );
}

const alertStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  background: "#FFF",
  border: "1px solid #E5E5E5",
  padding: "8px 12px",
  fontSize: 13,
  zIndex: 9999,
};

interface InnerProps {
  pageId: string;
  pageSlug?: string;
  initialData: PuckData;
  onPermissionRevoked: () => void;
  onExit: () => void;
}

/**
 * Inner component sits inside `<Puck>` so it can use `usePuckStore()` to
 * dispatch selection and read change notifications.
 */
function InlineEditorInner({
  pageId,
  pageSlug,
  initialData,
  onPermissionRevoked,
  onExit,
}: InnerProps) {
  const appState = usePuckStore((s) => s.appState);
  const dispatch = usePuckStore((s) => s.dispatch);
  const dataRef = useRef<PuckData>(initialData);
  const [dirty, setDirty] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { selectedId, selectedEl } = useInlineSelection(true);

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

  // When the user clicks an annotated element, dispatch selection into
  // Puck and open the sheet. The configuration panel reads `selectedItem`
  // off `usePuckStore()` so it picks up the change automatically.
  useEffect(() => {
    if (!selectedId) return;
    dispatchRef.current({
      type: "setUi",
      ui: {
        itemSelector: { index: indexOf(appStateRef.current?.data, selectedId) },
      },
    });
    setSheetOpen(true);
  }, [selectedId]);

  const selectedLabel = selectedId
    ? labelFor(appState?.data, selectedId)
    : null;

  const handleSaved = useCallback(() => {
    setDirty(false);
  }, []);

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
        onSaved={handleSaved}
        onExit={onExit}
        onPermissionRevoked={onPermissionRevoked}
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
