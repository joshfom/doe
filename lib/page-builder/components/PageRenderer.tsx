"use client";

import React from "react";
import { Render } from "@puckeditor/core";
import { pageBuilderConfig } from "../config";
import { migratePageData } from "../migrate-data";
import { validatePageData } from "../schema";
import { renderBreakpointCSS, collectAnnotatedBlockIds } from "../render-breakpoint-css";
import { withEditModeAnnotations } from "./edit-mode-annotations";
import { withBreakpointClassNames } from "./breakpoint-class-wrapper";
import { withTrackingWrapper } from "./tracking-wrapper-annotations";
import { PageContextProvider } from "@/lib/analytics/page-context";
import type { PageAnalyticsConfig } from "@/lib/analytics/types";
import type { PageData } from "../types";

export interface PageRendererProps {
  data: PageData;
  fallback?: React.ReactNode;
  /**
   * Slice 3 (task 12.2). When `true`, emit per-breakpoint CSS as a
   * `<style>` tag before the rendered tree. The flag is opt-in so the
   * anonymous public path can keep emitting byte-identical baseline HTML
   * for any PageData without breakpoint-aware fields or visibility flags
   * (Property 5, Req 16.1). Routes wire this from the `breakpoint_css`
   * feature flag.
   *
   * Even when `breakpointCss` is `true`, the `<style>` tag is omitted
   * entirely if the data produces no CSS — that preserves byte-identical
   * output for legacy data (Property 5).
   */
  breakpointCss?: boolean;
  /**
   * Slice 2 hook (task 15.5). When `true`, downstream block render output
   * is annotated with `data-puck-id` so the inline editor can map clicks
   * to component ids. Currently a passthrough; full annotation lands with
   * Slice 2.
   */
  editMode?: boolean;
}

/**
 * Filters PageData to only include components whose `type` exists
 * in the pageBuilderConfig, gracefully skipping unknown keys.
 */
function filterKnownComponents(data: PageData): PageData {
  const knownTypes = new Set(Object.keys(pageBuilderConfig.components));

  const filteredContent = data.content.filter((item) =>
    knownTypes.has(item.type)
  );

  let filteredZones: PageData["zones"];
  if (data.zones) {
    filteredZones = {};
    for (const [zoneKey, items] of Object.entries(data.zones)) {
      filteredZones[zoneKey] = items.filter((item) =>
        knownTypes.has(item.type)
      );
    }
  }

  return {
    root: data.root,
    content: filteredContent,
    zones: filteredZones,
  };
}

/**
 * Extracts PageAnalyticsConfig from root.props._analytics.
 * Handles the flat storage format (surveyTriggerType/surveyTriggerValue)
 * and converts to the structured PageAnalyticsConfig type.
 */
function extractAnalyticsConfig(data: PageData): PageAnalyticsConfig | undefined {
  const raw = data.root?.props?._analytics as Record<string, unknown> | undefined;
  if (!raw) return undefined;

  const config: PageAnalyticsConfig = {};

  if (raw.pageTemplate && typeof raw.pageTemplate === "string") {
    config.pageTemplate = raw.pageTemplate;
  }
  if (raw.projectId && typeof raw.projectId === "string") {
    config.projectId = raw.projectId;
  }
  if (raw.unitType && typeof raw.unitType === "string") {
    config.unitType = raw.unitType;
  }
  if (raw.priceBand && typeof raw.priceBand === "string") {
    config.priceBand = raw.priceBand;
  }
  if (raw.conversionGoal && typeof raw.conversionGoal === "string") {
    config.conversionGoal = raw.conversionGoal;
  }
  if (raw.funnelSteps && typeof raw.funnelSteps === "string") {
    const steps = (raw.funnelSteps as string).split(",").map((s) => s.trim()).filter(Boolean);
    if (steps.length >= 2 && steps.length <= 6) {
      config.funnelSteps = steps;
    }
  }
  if (raw.experimentFlag && typeof raw.experimentFlag === "string") {
    config.experimentFlag = raw.experimentFlag;
  }
  if (raw.surveyTriggerType && typeof raw.surveyTriggerType === "string") {
    const type = raw.surveyTriggerType as "exit-intent" | "time-on-page" | "scroll-depth";
    const value = Number(raw.surveyTriggerValue);
    if (type && Number.isFinite(value) && value > 0) {
      config.surveyTrigger = { type, value };
    }
  }
  if (raw.consentOverride && typeof raw.consentOverride === "string" && raw.consentOverride !== "inherit") {
    config.consentOverride = raw.consentOverride as "analytics-only" | "no-tracking";
  }

  // Return undefined if all fields are empty
  const hasAnyValue = config.pageTemplate || config.projectId || config.unitType ||
    config.priceBand || config.conversionGoal || config.funnelSteps ||
    config.experimentFlag || config.surveyTrigger || config.consentOverride;

  return hasAnyValue ? config : undefined;
}

/**
 * Renders a published page using Puck's <Render> component.
 * Validates incoming data and filters out unknown component types.
 */
export function PageRenderer({
  data,
  fallback,
  breakpointCss = false,
  editMode = false,
}: PageRendererProps) {
  const validation = validatePageData(data);

  if (!validation.success) {
    return (
      <>
        {fallback ?? (
          <div role="alert">
            <p>This page could not be rendered due to invalid data.</p>
          </div>
        )}
      </>
    );
  }

  const filteredData = filterKnownComponents(data);

  // Migrate legacy DropZone data to inline slot model (idempotent).
  const migratedData = migratePageData(filteredData as unknown as import("@puckeditor/core").Data) as unknown as PageData;

  // Task 13.4: Extract per-page analytics config from root.props._analytics
  const analyticsConfig = extractAnalyticsConfig(migratedData);

  // Property 5 (Req 16.1): only emit a <style> tag when the breakpoint CSS
  // pipeline is opted in AND the data actually contributes CSS. Legacy
  // PageData (no breakpoint-aware fields, no _visibility flags) keeps
  // producing byte-identical output.
  const css = breakpointCss ? renderBreakpointCSS(migratedData) : "";

  // Task 12.3 (Req 15.2): when breakpoint CSS is emitted, wrap block
  // render functions so blocks that carry breakpoint-aware fields get a
  // `pb-block-{id}` class on their root element. The CSS custom properties
  // emitted by `renderBreakpointCSS` are scoped to that class, so without
  // it the properties have no target. Blocks without breakpoint data are
  // left untouched (Property 5).
  const annotatedIds = css.length > 0 ? collectAnnotatedBlockIds(migratedData) : new Set<string>();
  let renderConfig = annotatedIds.size > 0
    ? withBreakpointClassNames(pageBuilderConfig, annotatedIds)
    : pageBuilderConfig;

  // Slice 2 (task 15.5): when editMode=true, swap in a config wrapper that
  // emits `data-puck-id` on every block's root element so the inline
  // editor's `useInlineSelection` hook can map clicks back to component
  // ids. editMode is always `false` for anonymous SSR (Req 16.1) — the
  // gate lives in `lib/cms/inline-editor/server-gate.ts`.
  if (editMode) {
    renderConfig = withEditModeAnnotations(renderConfig);
  }

  // Task 15.4 (Req 8.2): wrap component render functions with
  // TrackingWrapper for components that have `_trackAsEvent: true`.
  // The wrapper emits `data-ph-capture-attribute-*` attributes for
  // PostHog autocapture and sets up IntersectionObserver for visibility
  // tracking. Components without tracking enabled render unchanged.
  renderConfig = withTrackingWrapper(renderConfig);

  const renderContent = css.length === 0
    ? <Render config={renderConfig} data={migratedData} />
    : (
      <>
        <style data-pb-breakpoint-css="">{css}</style>
        <Render config={renderConfig} data={migratedData} />
      </>
    );

  // Task 13.4: Wrap rendered content with PageContextProvider
  return (
    <PageContextProvider config={analyticsConfig}>
      {renderContent}
    </PageContextProvider>
  );
}
