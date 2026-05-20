"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import type { PageAnalyticsConfig } from "./types";

export interface PageContextProviderProps {
  config: PageAnalyticsConfig | undefined | null;
  children?: React.ReactNode;
}

/**
 * Page-level analytics context provider.
 *
 * Reads the per-page analytics config and calls `posthog.register()` with
 * non-empty page-level properties. On unmount (or when config changes),
 * unregisters the previously set properties.
 *
 * Requirements: 7.2, 7.7
 */
export function PageContextProvider({ config, children }: PageContextProviderProps) {
  const registeredKeysRef = useRef<string[]>([]);

  useEffect(() => {
    // Unregister previously set properties
    const prevKeys = registeredKeysRef.current;
    if (prevKeys.length > 0) {
      for (const key of prevKeys) {
        posthog.unregister(key);
      }
      registeredKeysRef.current = [];
    }

    if (!config) return;

    // Build properties object with only non-empty values
    const properties: Record<string, string> = {};

    if (config.pageTemplate) {
      properties.page_template = config.pageTemplate;
    }
    if (config.projectId) {
      properties.project_id = config.projectId;
    }
    if (config.unitType) {
      properties.unit_type = config.unitType;
    }
    if (config.priceBand) {
      properties.price_band = config.priceBand;
    }

    const keys = Object.keys(properties);
    if (keys.length > 0) {
      posthog.register(properties);
      registeredKeysRef.current = keys;
    }

    // Cleanup on unmount
    return () => {
      for (const key of registeredKeysRef.current) {
        posthog.unregister(key);
      }
      registeredKeysRef.current = [];
    };
  }, [
    config?.pageTemplate,
    config?.projectId,
    config?.unitType,
    config?.priceBand,
  ]);

  return <>{children}</>;
}
