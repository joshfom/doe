"use client";

import React, { useCallback, useRef, useState } from "react";
import { Puck } from "@puckeditor/core";
import type { Data } from "@puckeditor/core";
import { pageBuilderConfig } from "../config";
import { createOverrides } from "./ui-overrides";
import { createEditorPlugins } from "./plugins";
import { defaultTheme } from "../theme";
import type { PageData, EditorTheme } from "../types";
import type { AIGenerator } from "../ai-generator";
import { componentTemplates } from "../templates/component-templates";

// Template component type → template ID mapping
const TEMPLATE_MAP: Record<string, string> = {
  TplContentBlock: "tpl-content-block",
  TplHeroSection: "tpl-hero-section",
  TplFeatureSection: "tpl-feature-section",
  TplCTASection: "tpl-cta-section",
  TplTestimonialSection: "tpl-testimonial-section",
};

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
  const [error, setError] = useState<string | null>(null);
  const [puckData, setPuckData] = useState<PageData>(initialData);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const latestDataRef = useRef<PageData>(initialData);

  // Track the latest data via onChange — also detect and expand template components
  const expandingRef = useRef(false);
  const handleChange = useCallback((data: Data) => {
    const pageData = data as unknown as PageData;
    latestDataRef.current = pageData;

    // Don't re-enter while we're expanding a template
    if (expandingRef.current) return;

    // Check if any template component was just inserted into content or zones
    const findTemplate = (items: Array<{ type: string; props: { id: string; [k: string]: unknown } }>) =>
      items.findIndex(item => TEMPLATE_MAP[item.type] !== undefined);

    let templateIdx = findTemplate(pageData.content);
    let templateZone: string | null = null;

    if (templateIdx === -1 && pageData.zones) {
      for (const [zone, items] of Object.entries(pageData.zones)) {
        const idx = findTemplate(items);
        if (idx !== -1) {
          templateIdx = idx;
          templateZone = zone;
          break;
        }
      }
    }

    if (templateIdx === -1) return; // No template found

    const items = templateZone ? pageData.zones![templateZone] : pageData.content;
    const templateComponent = items[templateIdx];
    const templateId = TEMPLATE_MAP[templateComponent.type];
    const template = componentTemplates.find(t => t.id === templateId);
    if (!template) return;

    const expanded = template.build();
    const newData: PageData = JSON.parse(JSON.stringify(pageData));

    // Replace the template placeholder with expanded content
    if (templateZone) {
      newData.zones![templateZone].splice(templateIdx, 1, ...expanded.content);
    } else {
      newData.content.splice(templateIdx, 1, ...expanded.content);
    }

    // Merge expanded zones
    if (!newData.zones) newData.zones = {};
    Object.assign(newData.zones, expanded.zones);

    // Prevent re-entry and update
    expandingRef.current = true;
    setPuckData(newData);
    latestDataRef.current = newData;
    // Reset the flag after React processes the state update
    requestAnimationFrame(() => { expandingRef.current = false; });
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
      // Load generated data into the editor by updating the Puck data key
      setPuckData(generated);
      latestDataRef.current = generated;
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
        key={JSON.stringify(puckData)}
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
