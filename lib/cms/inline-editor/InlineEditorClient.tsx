"use client";

/**
 * InlineEditorClient — the heavy client implementation lazily imported
 * via `InlineEditorBootstrap`.
 *
 * Spec: custom-branded-page-builder — task 15.1, 15.2, 15.3, 15.4, 16.2
 * Spec: live-page-editor — task 1.6 (extract shared inner + `alwaysOn` gate)
 * _Requirements: 8.2, 8.3, 8.4, 9.5, 10.1, 10.2, 10.5, 18.4 / 3.4, 7.3_
 *
 * Bundled into the `inline-editor.chunk.js` chunk. Anonymous public
 * pages never load this module (Req 19.1, 19.4) — the
 * `InlineEditorProvider` server gate is the single chokepoint.
 *
 * This client owns the *public-page* concerns only:
 *   1. Fetch the live page data from `GET /api/pages/:id` so the editor
 *      starts from the same snapshot the renderer rendered.
 *   2. The opt-in "Enter Edit Mode" gate (skippable via `alwaysOn`):
 *      until the user opts in (or `alwaysOn` is set), the page behaves
 *      normally for browsing.
 *   3. Mount a **headless** `<Puck>` context with the shared
 *      `editorConfig` and host the shared `InlineEditorInner`, which
 *      carries the selection→sheet wiring and the permission-revocation
 *      lockout (the single source of truth shared with the live editor).
 *
 * Implementation notes:
 *   - Puck is mounted with headless overrides — we're not rendering its
 *     canvas; the live page is the canvas. We only need its state engine
 *     + dispatch + selection so the sheet's `ConfigurationPanel` operates
 *     against a real Puck context.
 */

import { useEffect, useState } from "react";
import { type Data as PuckData, Puck } from "@puckeditor/core";
import { headlessOverrides } from "@/lib/page-builder/builder-shell/headless-overrides";
import { migratePageData } from "@/lib/page-builder/migrate-data";
import {
  editorConfig,
  INLINE_EDITOR_PERMISSIONS,
  InlineEditorInner,
} from "./InlineEditorInner";

interface InlineEditorClientProps {
  pageId: string;
  /**
   * When `true`, mount the editor immediately and skip the public-page
   * "Enter Edit Mode" opt-in gate. Defaults to `false` so the public
   * surface preserves its opt-in behavior; the live editor mounts the
   * shared inner directly and so passes/relies on always-on behavior.
   */
  alwaysOn?: boolean;
}

interface PageDataResponse {
  id: string;
  slug?: string;
  data: PuckData;
}

export function InlineEditorClient({
  pageId,
  alwaysOn = false,
}: InlineEditorClientProps) {
  const [initialData, setInitialData] = useState<PuckData | null>(null);
  const [pageSlug, setPageSlug] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  // When `alwaysOn`, the gate is bypassed and the editor mounts directly.
  const [active, setActive] = useState(alwaysOn);

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

  // Floating "Enter Edit Mode" trigger — the public opt-in gate, visible
  // until the user opts in. Bypassed entirely when `alwaysOn` so the inner
  // mounts directly with no gate.
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
      config={editorConfig}
      data={initialData}
      overrides={headlessOverrides}
      permissions={INLINE_EDITOR_PERMISSIONS}
    >
      <InlineEditorInner
        pageId={pageId}
        pageSlug={pageSlug}
        initialData={initialData}
        onExit={() => {
          // No gate to return to when always-on.
          if (!alwaysOn) setActive(false);
        }}
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
