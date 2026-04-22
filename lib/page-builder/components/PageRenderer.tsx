"use client";

import React from "react";
import { Render } from "@puckeditor/core";
import { pageBuilderConfig } from "../config";
import { validatePageData } from "../schema";
import type { PageData } from "../types";

export interface PageRendererProps {
  data: PageData;
  fallback?: React.ReactNode;
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
 * Renders a published page using Puck's <Render> component.
 * Validates incoming data and filters out unknown component types.
 */
export function PageRenderer({ data, fallback }: PageRendererProps) {
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

  return <Render config={pageBuilderConfig} data={filteredData} />;
}
