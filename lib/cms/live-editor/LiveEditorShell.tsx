"use client";

/**
 * LiveEditorShell — the client composition root for the Live_Editor.
 *
 * Spec: live-page-editor — task 4.2.
 * _Requirements: 1.1, 3.1, 5.4, 7.4_
 *
 * This is the chrome-free, full-bleed shell that hosts the live page render
 * plus all floating editing affordances at `/ora-panel/live/[id]`. It composes
 * mostly-existing building blocks (the design's "integration / composition"
 * thesis) rather than introducing new editor logic:
 *
 *   <BreakpointProvider initial="desktop">       ← Req 5.5 (toolbar default)
 *     <div data-live-editor-root dir=...>         ← Req 3.1 / 10.7 (full-bleed + RTL)
 *       <Puck headless config=editorConfig ...>   ← same pattern as InlineEditorClient
 *         <LivePreview>                            ← Req 1.1, 5.4, 7.4 (live render)
 *           <PreviewStage>                         ← virtual width + zoom (task 4.1)
 *             <PageRenderer editMode breakpointCss data={appState.data} />
 *         <InlineEditorInner alwaysOn>             ← shared selection→sheet wiring
 *           (selection overlay + configuration sheet + save bar)
 *         {slots for ResponsiveToolbar / ComponentSheet}
 *
 * The visible preview is driven by the headless Puck's `appState.data`, so
 * configuration edits and component insertions reflect in the render with no
 * reload (Req 7.4, 5.4). `editMode` makes the renderer emit `data-puck-id`
 * annotations so block selection can map clicks back to component ids.
 *
 * Scope of task 8.1 (selection + toolbar wiring on top of 4.2):
 *   - Selection is DOM-driven by `useNavigationNeutralizer` (the sole
 *     capture-phase selection driver), scoped to the preview region. Resolved
 *     blocks are routed into a `useInlineSelection` instance (mounted
 *     `active=false`) that is injected into the shared `InlineEditorInner`, so
 *     there are not two competing selection drivers.
 *   - The `ResponsiveToolbar` is mounted so the floating breakpoint control is
 *     present in the live editor.
 *   - The Component_Sheet (task 7.x) and the shell-owned dirty/lock + leave
 *     guard (task 10.2) land in later tasks. This file leaves a clearly marked
 *     structural mount point for the component sheet.
 *
 * The prop interface is the contract from design.md (LiveEditorShell) and is
 * preserved exactly from the task 2.1 placeholder. The component remains a
 * default export so the route import (`app/ora-panel/live/[id]/page.tsx`)
 * keeps working.
 */

import React from "react";
import { type Data as PuckData, Puck } from "@puckeditor/core";
import { BreakpointProvider } from "@/lib/page-builder/breakpoint-context";
import { headlessOverrides } from "@/lib/page-builder/builder-shell/headless-overrides";
import { migratePageData } from "@/lib/page-builder/migrate-data";
import { usePuckStore } from "@/lib/page-builder/use-puck-store";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";
import type { PageData } from "@/lib/page-builder/types";
import {
  editorConfig,
  INLINE_EDITOR_PERMISSIONS,
  InlineEditorInner,
} from "@/lib/cms/inline-editor/InlineEditorInner";
import { useInlineSelection } from "@/lib/cms/inline-editor/useInlineSelection";
import { useNavigationNeutralizer } from "./useNavigationNeutralizer";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
import { PreviewStage } from "./PreviewStage";
import { ComponentSheet } from "./ComponentSheet";

/**
 * Puck's root zone compound key — the content array at the top level of the
 * page (`data.content`). Mirrors `rootAreaId` + `rootZone` in
 * `@puckeditor/core` and the builder's own insertion code
 * (`InsertionContext`, `SelectedElementHeader`). Live-editor insertions always
 * target the root zone (Req 6.8, 6.9).
 */
const ROOT_ZONE = "root:default-zone";

/**
 * Generate a fresh component instance id for an inserted block. Identical
 * strategy to the builder's `InsertionContext`/`SelectedElementHeader`: the
 * `${type}-${uuid}` shape is opaque to Puck (which only requires uniqueness),
 * and the non-crypto fallback keeps it safe where `crypto.randomUUID` is
 * unavailable (older jsdom).
 */
function generateComponentId(componentType: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${componentType}-${suffix}`;
}

/** Find the root `content`-array index of a block by its `data-puck-id`. -1 if absent. */
function indexOf(data: PuckData | undefined, id: string | null): number {
  if (!data?.content || !id) return -1;
  return data.content.findIndex(
    (item) => (item.props as { id?: unknown })?.id === id,
  );
}

export interface LiveEditorShellProps {
  pageId: string;
  initialData: PuckData;
  /** Version identifier the editor loaded; echoed back on save (Req 8.1). */
  version: string | null;
  /** Active locale; drives RTL mirroring of Editor_UI (Req 10.7). */
  locale: "en" | "ar";
}

/**
 * LivePreview — sits *inside* `<Puck>` so it can read the live
 * `appState.data` via `usePuckStore()` and render it through `PageRenderer`.
 *
 * Rendering from `appState.data` (rather than the static `initialData`) is
 * what makes configuration edits and component insertions reflect in the
 * preview without a reload (Req 5.4, 7.4). `editMode` emits the `data-puck-id`
 * annotations selection depends on; `breakpointCss` enables the responsive
 * pipeline so the preview matches production at the active breakpoint
 * (Req 1.1).
 *
 * `appState.data` is Puck's `Data` shape; `PageRenderer` validates and
 * filters it as `PageData`, so we cross the (structurally-compatible) type
 * boundary with an explicit cast — the same boundary `PageRenderer` itself
 * crosses internally.
 */
function LivePreview(): React.ReactElement {
  const appState = usePuckStore((s) => s.appState);
  const data = appState?.data as unknown as PageData;

  return (
    <PreviewStage>
      <PageRenderer data={data} editMode breakpointCss />
    </PreviewStage>
  );
}

/**
 * LiveEditorBody — the in-`<Puck>` composition that owns the DOM-driven
 * selection pipeline (task 8.1).
 *
 * Selection-driver approach (design.md):
 *   The LIVE editor's selection is driven by the capture-phase
 *   `useNavigationNeutralizer`, which is the SOLE selection driver. To avoid
 *   two competing `pointerdown` listeners, the shared `InlineEditorInner` is
 *   mounted with an externally-provided `selection` — a `useInlineSelection`
 *   instance this body owns and mounts `active=false` (its own listener is
 *   off). The neutralizer's `onSelectBlock(id, el)` pushes the resolved block
 *   into that selection via `setSelectedId`/`setSelectedEl`. The public
 *   `InlineEditorClient` is untouched: it mounts `InlineEditorInner` with no
 *   `selection` prop, so the inner keeps its own active listener.
 *
 * Re-targeting (Req 7.6): the inner maps `selectedId` → Puck `itemSelector`
 * and keeps the Configuration_Sheet open across selection changes, so the
 * panel re-renders for the newly selected block without closing; the
 * `SelectionOverlay` follows `selectedEl`. Closing the sheet retains the
 * current selection/indicator (Req 7.7); clearing selection closes the sheet
 * and hides the overlay (Req 7.8). Property edits commit through the Puck
 * field layer the inner already wires (Req 7.4, 7.5).
 */
function LiveEditorBody({
  pageId,
  seedData,
}: {
  pageId: string;
  seedData: PuckData;
}): React.ReactElement {
  // Selection state container. `active=false` keeps the hook's own
  // `pointerdown` listener OFF so the neutralizer is the sole selection
  // driver (design.md / Req 4).
  const selection = useInlineSelection(false);
  const { selectedId, setSelectedId, setSelectedEl } = selection;

  // Live Puck store access for component insertion (task 7.5). The visible
  // preview is driven by `appState.data`, and inserts are committed by
  // dispatching a Puck `insert` action — the same action the builder uses
  // (`InsertionContext`).
  const appState = usePuckStore((s) => s.appState);
  const dispatch = usePuckStore((s) => s.dispatch);

  // Keep stable refs to the latest dispatch / appState / selectedId so the
  // `onInsert` callback can read them without churning its identity on every
  // render (mirrors `InlineEditorInner`'s ref pattern). The neutralizer +
  // ComponentSheet would otherwise re-arm on each keystroke-driven re-render.
  const dispatchRef = React.useRef(dispatch);
  dispatchRef.current = dispatch;
  const appStateRef = React.useRef(appState);
  appStateRef.current = appState;
  const selectedIdRef = React.useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  // Scope the neutralizer to the preview region only. Everything inside this
  // ref is live page content (NOT `data-inline-editor-ui`), so activations
  // there select blocks; the floating Editor_UI rendered as siblings is
  // exempt (Req 4.7).
  const previewRootRef = React.useRef<HTMLDivElement>(null);

  const handleSelectBlock = React.useCallback(
    (id: string | null, el: HTMLElement | null) => {
      setSelectedId(id);
      setSelectedEl(el);
    },
    [setSelectedId, setSelectedEl],
  );

  useNavigationNeutralizer({
    rootRef: previewRootRef,
    onSelectBlock: handleSelectBlock,
  });

  // ── Component insertion dispatch (task 7.5) ────────────────────────────
  //
  // Inserts the chosen palette component into the root content array via a
  // Puck `insert` action — the exact action the builder uses
  // (`InsertionContext`/`SelectedElementHeader`), so the new block is built
  // from its `defaultProps` and reflected in the preview (driven by
  // `appState.data`) with no reload.
  //
  // Position (Req 6.8, 6.9): when a block is selected, insert immediately
  // AFTER it (`selectedIndex + 1`); when nothing is selected, insert at the
  // END of the page (`content.length`). The selected index is resolved from
  // the Selected_Block's `data-puck-id` (its `props.id`) using the same
  // `indexOf` lookup `InlineEditorInner` uses, so selection and insertion
  // agree on block identity. A stale/absent id (index -1) falls back to the
  // end, never a negative destination.
  //
  // Failure handling (Req 6.10): the dispatch is wrapped in try/catch. On a
  // thrown error the Puck reducer never produces new state, so `appState.data`
  // is left unchanged; we return `false` so the ComponentSheet surfaces its
  // inline error indication. A successful dispatch returns `true`.
  const onInsert = React.useCallback((type: string): boolean => {
    try {
      const data = appStateRef.current?.data as PuckData | undefined;
      const content = data?.content ?? [];
      const selectedIndex = indexOf(data, selectedIdRef.current);
      const destinationIndex =
        selectedIndex >= 0 ? selectedIndex + 1 : content.length;

      dispatchRef.current({
        type: "insert",
        componentType: type,
        destinationIndex,
        destinationZone: ROOT_ZONE,
        id: generateComponentId(type),
      });
      return true;
    } catch {
      // Leave page content unchanged and signal failure (Req 6.10).
      return false;
    }
  }, []);

  return (
    <>
      {/* Preview region — the neutralizer's scope and the "canvas" of the
          live editor. Driven by appState.data so edits/insertions reflect
          immediately (Req 5.4, 7.4). */}
      <div
        ref={previewRootRef}
        data-live-editor-preview-region=""
        style={{ position: "relative", width: "100%", minHeight: "100vh" }}
      >
        <LivePreview />
      </div>

      {/* Shared selection→sheet wiring, externally driven by the neutralizer.
          Renders the selection overlay, configuration sheet, and save bar
          (each marked data-inline-editor-ui internally). */}
      <InlineEditorInner
        pageId={pageId}
        initialData={seedData}
        selection={selection}
        // onExit: full leave-guard + navigation lands in task 10.2. For now
        // exiting is a no-op so the always-on live surface stays mounted.
        onExit={() => {
          /* task 10.2: confirm unsaved changes, then navigate away. */
        }}
      />

      {/* ── Floating Editor_UI ──────────────────────────────────────────────
          Each overlay is positioned fixed/absolute and marked
          data-inline-editor-ui so it occupies no layout space (Req 3.5) and
          is exempt from navigation neutralization (Req 4.7). */}

      {/* Responsive_Toolbar (Req 5) — floating breakpoint segmented control.
          Renders its own fixed, data-inline-editor-ui root. */}
      <ResponsiveToolbar />

      {/* Component_Sheet (Req 6) — ORA-branded bottom-anchored draggable
          add-component sheet. Mounted into the component-sheet slot with the
          shell's current selection (drives insertion target — Req 6.8/6.9) and
          the `onInsert` dispatch above (Req 6.10). It renders its own
          absolute, data-inline-editor-ui root, so it occupies no layout space
          and is exempt from navigation neutralization (Req 3.5, 4.7). */}
      <ComponentSheet selectedId={selectedId} onInsert={onInsert} />
    </>
  );
}

/**
 * LiveEditorShell — full composition (task 4.2).
 */
export default function LiveEditorShell({
  pageId,
  initialData,
  version,
  locale,
}: LiveEditorShellProps): React.ReactElement {
  // Migrate legacy DropZone data to the inline slot model before seeding the
  // headless Puck store (idempotent — matches InlineEditorClient). Memoized so
  // the migration runs once per loaded document rather than on every render.
  const seedData = React.useMemo(() => migratePageData(initialData), [initialData]);

  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <BreakpointProvider initial="desktop">
      {/* Full-bleed root: occupies 100% of the viewport with no reserved
          chrome (Req 3.1); `dir` mirrors Editor_UI for RTL locales (Req 10.7).
          `data-live-editor-root` is the stable hook the segment layout
          (task 3.2) and tests target. */}
      <div
        data-live-editor-root=""
        data-page-id={pageId}
        // Loaded version is echoed back on save (Req 8.1); the save-bar wiring
        // lands in task 10.x. Surfaced here so it's carried through the shell.
        data-loaded-version={version ?? undefined}
        dir={dir}
        style={{
          position: "relative",
          width: "100%",
          minHeight: "100vh",
          overflow: "hidden",
        }}
      >
        <Puck
          config={editorConfig}
          data={seedData}
          overrides={headlessOverrides}
          permissions={INLINE_EDITOR_PERMISSIONS}
        >
          <LiveEditorBody pageId={pageId} seedData={seedData} />
        </Puck>
      </div>
    </BreakpointProvider>
  );
}
