"use client";

/**
 * BuilderShell — top-level ORA-owned UI surrounding a headless Puck canvas.
 *
 * Phase 6: renders the entire layout (TopBar, LeftRail, Canvas, Inspector,
 * StatusBar) INSIDE the <Puck> tree so descendants can call `usePuck()`
 * directly. Shell-level handlers (save/publish/preview/dirty) are exposed via
 * BuilderShellProvider.
 */

import React from "react";
import { Puck } from "@puckeditor/core";
import type { Config, Data } from "@puckeditor/core";
import { headlessOverrides } from "./headless-overrides";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { ComponentsDrawer } from "./ComponentsDrawer";
import { Inspector } from "./inspector/Inspector";
import { StatusBar } from "./StatusBar";
import { BuilderShellProvider } from "./shell-context";
import type {
  DocumentRecord,
  SaveHandler,
  PublishHandler,
  SaveResult,
} from "./types";

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

export function BuilderShell({
  config,
  document,
  onSave,
  onPublish,
  onPreview,
}: BuilderShellProps) {
  const initialData: Data = React.useMemo(() => {
    if (document.mode === "page" && document.pageData) {
      return document.pageData;
    }
    if (document.mode === "slide" && document.deck?.slides[0]) {
      return document.deck.slides[0].data;
    }
    return { content: [], root: { props: {} } } as Data;
  }, [document]);

  const [documentTitle, setDocumentTitle] = React.useState(document.title);
  const [dirty, setDirty] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(
    document.updatedAt ?? null,
  );
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

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
      <Puck
        config={config}
        data={initialData}
        overrides={headlessOverrides}
        onChange={handleChange}
      >
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
            style={{
              gridColumn: "1",
              gridRow: "2",
              display: "grid",
              gridTemplateRows: "1fr auto",
              minHeight: 0,
              borderRight: `1px solid ${SHELL_THEME.border}`,
              background: "#FFF",
              overflow: "hidden",
            }}
          >
            <LeftRail />
            <ComponentsDrawer />
          </aside>
          <main
            style={{
              gridColumn: "2",
              gridRow: "2",
              overflow: "auto",
              background: SHELL_THEME.cream,
            }}
            data-testid="ora-canvas"
          >
            <Puck.Preview />
          </main>
          <Inspector />
          <StatusBar />
        </div>
      </Puck>
    </BuilderShellProvider>
  );
}
