"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Puck } from "@puckeditor/core";
import type { Data } from "@puckeditor/core";
import { pageBuilderConfig } from "../config";
import { createOverrides } from "./ui-overrides";
import { createEditorPlugins } from "./plugins";
import { defaultTheme } from "../theme";
import type { PageData, EditorTheme, ComponentInstance } from "../types";
import type { AIGenerator } from "../ai-generator";

/**
 * Strip any component instances whose `type` is no longer registered in the
 * Puck config. This protects the editor from legacy / removed component types
 * (e.g. the old ORA monolithic blocks or Tpl* placeholders) that would
 * otherwise render as "No configuration for X" on the canvas.
 */
function sanitizePageData(data: PageData): {
  data: PageData;
  removed: string[];
} {
  const known = new Set(Object.keys(pageBuilderConfig.components ?? {}));
  const removed: string[] = [];

  const filterItems = (items: ComponentInstance[]): ComponentInstance[] =>
    items.filter((item) => {
      if (known.has(item.type)) return true;
      removed.push(item.type);
      return false;
    });

  const cleanContent = filterItems(data.content ?? []);
  const cleanZones: Record<string, ComponentInstance[]> = {};
  if (data.zones) {
    const liveIds = new Set<string>();
    const collect = (items: ComponentInstance[]) => {
      for (const i of items) {
        if (i.props?.id) liveIds.add(i.props.id);
      }
    };
    collect(cleanContent);
    // Iterate until no new live IDs appear (zones can hold parents of zones).
    let changed = true;
    while (changed) {
      changed = false;
      for (const [zoneKey, items] of Object.entries(data.zones)) {
        const [ownerId] = zoneKey.split(":");
        if (!liveIds.has(ownerId)) continue;
        if (cleanZones[zoneKey]) continue;
        const filtered = filterItems(items);
        cleanZones[zoneKey] = filtered;
        const before = liveIds.size;
        collect(filtered);
        if (liveIds.size !== before) changed = true;
      }
    }
  }

  return {
    data: { ...data, content: cleanContent, zones: cleanZones },
    removed,
  };
}

export interface PageEditorProps {
  /** Initial page data to load into the editor. */
  initialData: PageData;
  /** Called when the user saves (via Puck's publish/save action). */
  onSave: (data: PageData) => Promise<void>;
  /** Optional callback when the user explicitly publishes. */
  onPublish?: (data: PageData) => Promise<void>;
  /** Editor theme configuration. */
  theme?: EditorTheme;
  /** Optional AI generator for natural-language page creation. */
  aiGenerator?: AIGenerator;
}

/**
 * PageEditor wraps Puck's `<Puck>` component with the page builder config,
 * custom UI overrides, plugin panels, and theme support.
 *
 * - `onPublish` from Puck fires when the user clicks the header save/publish button.
 *   We wire it to the `onSave` prop to persist the Page_Data JSON.
 * - Error toasts are shown on save failure; editor state is preserved.
 * - Real-time canvas preview updates on field changes are handled by Puck built-in.
 */
export function PageEditor({
  initialData,
  onSave,
  onPublish,
  theme = defaultTheme,
  aiGenerator,
}: PageEditorProps) {
  const sanitized = useMemo(() => sanitizePageData(initialData), [initialData]);
  const removedTypes = sanitized.removed;
  const [error, setError] = useState<string | null>(
    removedTypes.length > 0
      ? `Removed ${removedTypes.length} unsupported block${removedTypes.length === 1 ? "" : "s"} (${Array.from(new Set(removedTypes)).join(", ")}). Save the page to make this permanent.`
      : null
  );
  const [puckData, setPuckData] = useState<PageData>(sanitized.data);
  const [resetKey, setResetKey] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const latestDataRef = useRef<PageData>(sanitized.data);

  // Track the latest data via onChange. Puck owns its own internal state — we
  // only mirror it here so other handlers (AI prompt, publish) can read it.
  const handleChange = useCallback((data: Data) => {
    const pageData = data as unknown as PageData;
    latestDataRef.current = pageData;
  }, []);

  // AI generation handler
  const handleAIGenerate = useCallback(async () => {
    if (!aiGenerator || !aiPrompt.trim()) return;
    setAiLoading(true);
    setError(null);
    try {
      const generated = await aiGenerator.generate({
        prompt: aiPrompt.trim(),
        existingData: latestDataRef.current,
      });
      // Load generated data into the editor by remounting with the new tree
      setPuckData(generated);
      latestDataRef.current = generated;
      setResetKey((k) => k + 1);
      setAiPrompt("");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "AI generation failed — please try again or modify your prompt";
      setError(message);
    } finally {
      setAiLoading(false);
    }
  }, [aiGenerator, aiPrompt]);

  // Puck's onPublish fires when the user clicks the publish/save button in the header
  const handlePublish = useCallback(
    async (data: Data) => {
      const pageData = data as unknown as PageData;
      setError(null);
      try {
        await onSave(pageData);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save page";
        setError(message);
        return; // Preserve editor state — don't throw
      }

      // If an explicit onPublish callback is provided, call it after save
      if (onPublish) {
        try {
          await onPublish(pageData);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to publish page";
          setError(message);
        }
      }
    },
    [onSave, onPublish]
  );

  const overrides = createOverrides(theme);
  const plugins = createEditorPlugins({
    onPublish: onPublish
      ? () => {
          handlePublish(latestDataRef.current as unknown as Data);
        }
      : undefined,
  });

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {/* Error toast */}
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 9999,
            background: "#B85C5C",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 0,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: 400,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* AI prompt bar — only shown when aiGenerator is provided */}
      {aiGenerator && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "#F9F7F5",
            borderBottom: "1px solid #E8E4DF",
          }}
        >
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !aiLoading) handleAIGenerate();
            }}
            placeholder="Describe the page you want to create…"
            disabled={aiLoading}
            aria-label="AI page generation prompt"
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 14,
              border: "1px solid #E8E4DF",
              borderRadius: 0,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={aiLoading || !aiPrompt.trim()}
            aria-label="Generate page with AI"
            style={{
              padding: "6px 14px",
              fontSize: 14,
              fontWeight: 500,
              background: aiLoading || !aiPrompt.trim() ? "#9A9A9A" : "#B8956B",
              color: "#fff",
              border: "none",
              borderRadius: 0,
              cursor:
                aiLoading || !aiPrompt.trim() ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {aiLoading ? "Generating…" : "Generate"}
          </button>
        </div>
      )}

      <Puck
        key={resetKey}
        config={pageBuilderConfig}
        data={puckData}
        onChange={handleChange}
        onPublish={handlePublish}
        overrides={overrides}
        plugins={plugins}
      />
    </div>
  );
}
