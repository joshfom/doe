"use client";

/**
 * BuilderShell — top-level ORA-owned UI surrounding a headless Puck canvas.
 *
 * Spec: custom-branded-page-builder — Slice 1 (task 8.1)
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
 *
 * Task 8.1 wires the three Slice 1 components built in tasks 5.1, 3.1, and
 * 6.1/6.2 into the shell:
 *
 *   - `ComponentPalette`   — single ORA-branded left pane with grouped,
 *                            searchable drag sources
 *   - `ConfigurationPanel` — replaces `Inspector` (three-tabbed right pane)
 *   - `SelectedElementHeader` — floating icon-only action bar over the
 *                               selected block on the canvas
 *
 * The shell is also wrapped with two providers at the top of the Puck
 * subtree:
 *
 *   - `<BreakpointProvider>` — Slice 1 stub pinned to `"desktop"`
 *     (Req 12.4 default). The full switcher lands in Slice 3 task 10.1;
 *     wrapping today lets `BreakpointAwareFieldWrapper` and the public
 *     renderer's per-breakpoint CSS pipeline hook in without another
 *     shell change.
 *   - `<FieldControlRegistryProvider>` — exposes the registry so Slice 3's
 *     `BreakpointAwareFieldWrapper` (task 11.2) can decorate individual
 *     field renderers without monkey-patching the default map.
 *
 * Kept intact:
 *   - `headlessOverrides` — every Puck chrome slot still returns `null`
 *     so the shell owns 100% of the visible UI (Req 1.2, 1.3).
 *   - `BuilderShellProvider` + `shell-context` — save/publish/dirty wiring
 *     is unchanged.
 *   - The document-store / dirty-tracking logic in this file is
 *     unchanged — only the subtree *rendered* inside `<Puck>` has been
 *     swapped.
 *
 * Everything related to state access still flows through `usePuck()` and
 * the documented `overrides` API (Req 1.5) — no patches to
 * `@puckeditor/core` internals.
 */

import React, { useCallback } from "react";
import { Puck } from "@puckeditor/core";
import type { Config, Data } from "@puckeditor/core";
import { BreakpointProvider, useBreakpoint } from "../breakpoint-context";
import { headlessOverrides } from "./headless-overrides";
import { withInlineRichtextMenu } from "./with-inline-richtext-menu";
import { TopBar } from "./TopBar";
import { ComponentPalette } from "./ComponentPalette";
import { ConfigurationPanel } from "./configuration-panel/ConfigurationPanel";
import { FieldControlRegistryProvider } from "./configuration-panel/FieldControlRegistry";
import { SelectedElementHeader } from "./SelectedElementHeader";
import { SelectionLiveRegion, SelectionAnnounceProvider } from "./SelectionLiveRegion";
import { StatusBar } from "./StatusBar";
import { BuilderShellProvider } from "./shell-context";
import { TemplateLibrarySheet } from "./TemplateLibrarySheet";
import { ComponentLibrarySheet } from "./ComponentLibrarySheet";
import { SaveToLibraryDialog } from "./SaveToLibraryDialog";
import { LibraryContext } from "./LibraryContext";
import { CanvasFrame } from "./CanvasFrame";
import { InlineRichtextController } from "./InlineRichtextController";
import { PaletteSection } from "./PaletteSection";
import { OutlineTree } from "./OutlineTree";
import type { PuckSelector } from "./page-tree";
import { PageTreeProvider, usePageTree } from "./page-tree-context";
import { InsertionProvider, useInsertion } from "./InsertionContext";
import { ComponentPickerPopover } from "./ComponentPickerPopover";
import type {
  DocumentRecord,
  SaveHandler,
  PublishHandler,
  SaveResult,
} from "./types";
import type { ComponentInstance } from "../types";
import { migratePageData } from "../migrate-data";

export interface BuilderShellProps {
  config: Config;
  document: DocumentRecord;
  onSave: SaveHandler;
  onPublish: PublishHandler;
  onPreview?: (record: DocumentRecord) => void;
}

const SHELL_THEME = {
  cream: "#F5F3F0",
  creamLight: "#F9F7F5",
  border: "#E5E1DA",
};

/**
 * Puck permissions for the Builder Shell. Duplicate/delete are disabled so
 * Puck does not inject its own buttons into the selection overlay's action bar
 * — the Builder Shell owns those via `SelectedElementHeader`. With them off,
 * the `actionBar` override slot carries ONLY the native inline rich-text menu
 * (the floating formatting bubble). See `InlineRichtextActionBar`.
 */
const BUILDER_PERMISSIONS = { duplicate: false, delete: false } as const;

export function BuilderShell({
  config,
  document,
  onSave,
  onPublish,
  onPreview,
}: BuilderShellProps) {
  // Augment the config with editor-only richtext inline menus. Done here (not
  // in `config.ts`) so the ORA inline formatting bubble — and the editor-only
  // `RichTextMenu` controls it pulls in — never reach the public renderer
  // bundle. See `with-inline-richtext-menu.tsx`.
  const editorConfig = React.useMemo(() => withInlineRichtextMenu(config), [config]);

  const initialData: Data = React.useMemo(() => {
    let raw: Data;
    if (document.mode === "page" && document.pageData) {
      raw = document.pageData;
    } else if (document.mode === "slide" && document.deck?.slides[0]) {
      raw = document.deck.slides[0].data;
    } else {
      raw = { content: [], root: { props: {} } } as Data;
    }
    return migratePageData(raw);
  }, [document]);

  const [documentTitle, setDocumentTitle] = React.useState(document.title);
  const [dirty, setDirty] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(
    document.updatedAt ?? null,
  );
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // ─── Library sheet/dialog state (Task 8) ──────────────────────────────────
  const [templateSheetOpen, setTemplateSheetOpen] = React.useState(false);
  const [componentSheetOpen, setComponentSheetOpen] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [saveDialogData, setSaveDialogData] = React.useState<{
    content: ComponentInstance[];
    zones: Record<string, ComponentInstance[]>;
  } | null>(null);

  const openSaveDialog = React.useCallback(
    (content: ComponentInstance[], zones: Record<string, ComponentInstance[]>) => {
      setSaveDialogData({ content, zones });
      setSaveDialogOpen(true);
    },
    [],
  );

  const closeSaveDialog = React.useCallback(() => {
    setSaveDialogOpen(false);
    setSaveDialogData(null);
  }, []);

  const libraryCtxValue = React.useMemo(
    () => ({ openSaveDialog }),
    [openSaveDialog],
  );

  const dataRef = React.useRef<Data>(initialData);
  const initialChangeRef = React.useRef(true);

  const handleChange = React.useCallback((next: Data) => {
    dataRef.current = next;
    if (initialChangeRef.current) {
      initialChangeRef.current = false;
      return;
    }
    setDirty(true);
  }, []);

  const buildRecord = React.useCallback((): DocumentRecord => {
    const now = new Date().toISOString();
    const base: DocumentRecord = {
      ...document,
      title: documentTitle,
      updatedAt: now,
    };
    if (document.mode === "page") {
      return { ...base, pageData: dataRef.current };
    }
    if (document.deck) {
      const [first, ...rest] = document.deck.slides;
      const updated = first ? { ...first, data: dataRef.current } : undefined;
      return {
        ...base,
        deck: updated
          ? { ...document.deck, slides: [updated, ...rest] }
          : document.deck,
      };
    }
    return base;
  }, [document, documentTitle]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const result: SaveResult = await onSave(buildRecord());
      if (!result.ok) {
        setErrorMessage(result.error ?? "Save failed");
        return;
      }
      setDirty(false);
      setLastSavedAt(new Date().toISOString());
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [buildRecord, onSave]);

  const handlePublish = React.useCallback(async () => {
    setPublishing(true);
    setErrorMessage(null);
    try {
      const result: SaveResult = await onPublish(buildRecord());
      if (!result.ok) {
        setErrorMessage(result.error ?? "Publish failed");
        return;
      }
      setDirty(false);
      setLastSavedAt(new Date().toISOString());
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }, [buildRecord, onPublish]);

  const handlePreview = React.useCallback(() => {
    if (onPreview) {
      onPreview(buildRecord());
      return;
    }
    if (typeof window !== "undefined") {
      window.open(`/preview/${document.id}`, "_blank", "noopener");
    }
  }, [buildRecord, document.id, onPreview]);

  const dismissError = React.useCallback(() => setErrorMessage(null), []);

  const ctxValue = React.useMemo(
    () => ({
      documentTitle,
      setDocumentTitle: (next: string) => {
        setDocumentTitle(next);
        setDirty(true);
      },
      dirty,
      lastSavedAt,
      saving,
      publishing,
      onSave: handleSave,
      onPublish: handlePublish,
      onPreview: handlePreview,
      errorMessage,
      dismissError,
    }),
    [
      documentTitle,
      dirty,
      lastSavedAt,
      saving,
      publishing,
      handleSave,
      handlePublish,
      handlePreview,
      errorMessage,
      dismissError,
    ],
  );

  return (
    <BuilderShellProvider value={ctxValue}>
      <BreakpointProvider>
        <FieldControlRegistryProvider>
          <Puck
            config={editorConfig}
            data={initialData}
            overrides={headlessOverrides}
            permissions={BUILDER_PERMISSIONS}
            onChange={handleChange}
          >
            <SelectionAnnounceProvider>
            <InsertionProvider>
            <PageTreeProvider>
            <LibraryContext.Provider value={libraryCtxValue}>
            <div
              className="ora-builder-shell"
              style={{
                display: "grid",
                gridTemplateColumns: "260px 1fr 340px",
                gridTemplateRows: "56px 1fr 28px",
                height: "100vh",
                background: SHELL_THEME.creamLight,
              }}
            >
              <TopBar />
              <aside
                aria-label="Component palette"
                style={{
                  gridColumn: "1",
                  gridRow: "2",
                  minHeight: 0,
                  borderRight: `1px solid ${SHELL_THEME.border}`,
                  background: "#FFF",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <PaletteSection title="Components" collapsible>
                  <ComponentPalette
                    onOpenTemplates={() => setTemplateSheetOpen(true)}
                    onOpenComponentLibrary={() => setComponentSheetOpen(true)}
                  />
                </PaletteSection>
                <PaletteSection title="Outline" collapsible>
                  <LeftRailOutline />
                </PaletteSection>
              </aside>
              <main
                aria-label="Canvas"
                tabIndex={-1}
                style={{
                  gridColumn: "2",
                  gridRow: "2",
                  overflow: "auto",
                  background: SHELL_THEME.cream,
                }}
                data-testid="ora-canvas"
              >
                <CanvasFrame>
                  <CanvasViewport>
                    <Puck.Preview />
                  </CanvasViewport>
                </CanvasFrame>
              </main>
              <aside
                aria-label="Configuration panel"
                style={{
                  gridColumn: "3",
                  gridRow: "2",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <ConfigurationPanel pageSlug={document.slug} />
              </aside>
              <StatusBar />
              {/*
                SelectedElementHeader renders via a portal to `document.body`
                so its position in the JSX tree doesn't matter — keeping it
                inside <Puck> is what gives it access to `usePuck()`.
              */}
              <SelectedElementHeader />
              <SelectionLiveRegion />
              <InlineRichtextController />
            </div>

            {/* Library sheets — rendered inside <Puck> so they can access usePuckStore */}
            <TemplateLibrarySheet
              open={templateSheetOpen}
              onClose={() => setTemplateSheetOpen(false)}
            />
            <ComponentLibrarySheet
              open={componentSheetOpen}
              onClose={() => setComponentSheetOpen(false)}
            />
            <SaveToLibraryDialog
              open={saveDialogOpen}
              onClose={closeSaveDialog}
              selectedContent={saveDialogData?.content ?? []}
              selectedZones={saveDialogData?.zones ?? {}}
            />
            </LibraryContext.Provider>
            </PageTreeProvider>
            {/*
              The picker popover lives inside the InsertionProvider so it
              can read picker state and dispatch component insertions via
              `useInsertion`. It portals to `document.body` and rendering
              gates itself on a non-null anchorEl, so its position in the
              JSX tree is purely about context wiring (Req 5.3, 5.4, 5.5).
              The InsertionProvider itself is wrapped by SelectionAnnounceProvider
              so `insertComponent` can announce the new block via the shared
              live region (Req 6.5).
            */}
            <ComponentPickerHost />
            </InsertionProvider>
            </SelectionAnnounceProvider>
          </Puck>
        </FieldControlRegistryProvider>
      </BreakpointProvider>
    </BuilderShellProvider>
  );
}

/**
 * CanvasViewport — constrains the canvas preview width to mimic the active
 * breakpoint's viewport (Req 12.2).
 *
 *   desktop → renders at 1440px virtual width, scaled to fit the available
 *             pane so a 50px headline still looks like 50px relative to a
 *             real desktop layout (instead of a giant blob in a half-width
 *             editor pane).
 *   tablet  → 1024px (unscaled if pane allows, scaled if not)
 *   mobile  → 640px  (unscaled if pane allows, scaled if not)
 *
 * Lives inside `BreakpointProvider` so it can read the active breakpoint
 * via `useBreakpoint()` without prop-drilling.
 */
const VIRTUAL_WIDTHS: Record<string, number> = {
  desktop: 1440,
  tablet: 1024,
  mobile: 640,
};

function CanvasViewport({ children }: { children: React.ReactNode }) {
  const { activeBreakpoint } = useBreakpoint();
  const virtualWidth = VIRTUAL_WIDTHS[activeBreakpoint] ?? 1440;

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);

  // Recompute scale whenever the container resizes. We render at the
  // breakpoint's "true" viewport width and scale visually so the preview
  // always reflects realistic typography / spacing.
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      const available = node.clientWidth;
      if (available <= 0) return;
      const next = Math.min(1, available / virtualWidth);
      setScale(next);
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ro) ro.observe(node);
    window.addEventListener("resize", update);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [virtualWidth]);

  return (
    <div
      ref={containerRef}
      data-testid="ora-canvas-viewport"
      data-breakpoint={activeBreakpoint}
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          // Render the inner stage at the breakpoint's "real" width so
          // typography and spacing look correct, then visually scale to
          // fit the available pane. We use the legacy `zoom` property
          // (rather than `transform: scale`) so `position: fixed` inside
          // the canvas iframe still anchors to the viewport — that keeps
          // the floating element header working.
          width: virtualWidth,
          // `zoom` is a non-standard but widely supported CSS property
          // that scales layout dimensions including hit-testing without
          // creating a new containing block for fixed elements.
          ...({ zoom: scale } as React.CSSProperties),
          flex: 1,
          minHeight: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          transition: "width 200ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * LeftRailOutline — consumes the shared PageTreeContext and renders
 * the OutlineTree component. Lives inside the <Puck> subtree so it can
 * access `usePuckStore`.
 */
function LeftRailOutline() {
  const { tree, selectedId, setSelection } = usePageTree();

  const handleSelect = useCallback(
    (selector: PuckSelector | null, id: string | null) => {
      setSelection(selector, id);
    },
    [setSelection],
  );

  return (
    <OutlineTree tree={tree} selectedId={selectedId} onSelect={handleSelect} />
  );
}

/**
 * ComponentPickerHost — bridges the shared `InsertionContext` to a single
 * `<ComponentPickerPopover>` instance.
 *
 * Spec: builder-outline-tree-and-toolbar — Task 8.2
 * _Requirements: 5.3, 5.4, 5.5_
 *
 * `InsertionButton` instances rendered inside Puck's `componentItem`
 * override push picker open requests onto the shared context. We render
 * one popover here, reading anchor / zone / index from `useInsertion()`
 * and routing selection back through `insertComponent`. The popover
 * itself gates rendering on a non-null anchor, so when the picker is
 * closed this component effectively renders nothing.
 *
 * Lives inside the `<Puck>` subtree so it can access `usePuckStore`
 * (transitively via `useInsertion` → dispatch and via the popover's own
 * config / data reads).
 */
function ComponentPickerHost() {
  const { state, closePicker, insertComponent } = useInsertion();

  return (
    <ComponentPickerPopover
      anchorEl={state?.anchorEl ?? null}
      zone={state?.zone ?? ""}
      index={state?.index ?? 0}
      onInsert={(type) => insertComponent(type)}
      onClose={closePicker}
    />
  );
}
