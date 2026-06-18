"use client";

import React, { useEffect, useId, useRef } from "react";
import posthog from "posthog-js";

export interface TrackingWrapperProps {
  /** Whether to emit data-ph-capture-attribute-* attributes */
  trackAsEvent: boolean;
  /** The event name for PostHog autocapture */
  eventName: string;
  /** Additional event properties as key/value pairs */
  eventProperties?: Record<string, string>;
  /** Conversion value in AED to include in event properties */
  conversionValue?: number;
  /** Visibility threshold (0-100) for section_viewed event */
  visibilityThreshold?: number;
  /** Element ID for the wrapper (auto-generated if not provided) */
  elementId?: string;
  /** When true, emit data-ph-no-capture="false" to unmask this section in session replay */
  replayUnmask?: boolean;
  children?: React.ReactNode;
}

/**
 * Suffix-sanitises a React `useId()` value (e.g. ":r3:") into something safe to
 * embed in an element id. `useId()` is stable across the server and client
 * renders of the same component, so using it — rather than a module-level
 * mutable Set read during render — keeps the generated id identical on both
 * sides and avoids hydration mismatches.
 */
function sanitizeReactId(reactId: string): string {
  return reactId.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * TrackingWrapper — runtime component that wraps Puck components to provide
 * PostHog tracking capabilities.
 *
 * When `trackAsEvent` is true:
 * - Emits `data-ph-capture-attribute-event_name` on the wrapper div
 * - Emits `data-ph-capture-attribute-{key}={value}` for each event property
 * - Generates a unique element ID with collision suffix if needed
 *
 * When `visibilityThreshold` is set:
 * - Creates an IntersectionObserver at the configured threshold
 * - Fires `section_viewed` after 1 second of continuous visibility
 * - Only fires once per mount
 *
 * When `conversionValue` is set:
 * - Includes `conversion_value_aed` in the capture attributes
 *
 * Requirements: 8.2, 8.5, 8.6, 8.7
 */
export function TrackingWrapper({
  trackAsEvent,
  eventName,
  eventProperties,
  conversionValue,
  visibilityThreshold,
  elementId,
  replayUnmask,
  children,
}: TrackingWrapperProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hasFiredVisibility = useRef(false);
  const visibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedIdRef = useRef<string>("");
  // SSR-safe unique token; identical on the server and client for this instance.
  const reactId = useId();

  // Resolve element ID on first render. An explicit `elementId` is used verbatim;
  // otherwise the readable base is made unique with the SSR-stable `useId()` so
  // two sections sharing an event name never collide AND never mismatch on
  // hydration (the previous module-level Set diverged between server and client).
  if (resolvedIdRef.current === "" && trackAsEvent) {
    const baseId = elementId || `track-${eventName || "element"}`;
    resolvedIdRef.current = elementId
      ? baseId
      : `${baseId}-${sanitizeReactId(reactId)}`;
  }

  // IntersectionObserver for visibility tracking
  useEffect(() => {
    if (!visibilityThreshold || hasFiredVisibility.current) return;
    if (!wrapperRef.current) return;

    const threshold = Math.min(Math.max(visibilityThreshold, 0), 100) / 100;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
            // Start 1-second timer
            if (!visibilityTimerRef.current && !hasFiredVisibility.current) {
              visibilityTimerRef.current = setTimeout(() => {
                if (!hasFiredVisibility.current) {
                  hasFiredVisibility.current = true;
                  posthog.capture("section_viewed", {
                    element_id: resolvedIdRef.current || undefined,
                    event_name: eventName || undefined,
                    ...(conversionValue != null
                      ? { conversion_value_aed: conversionValue }
                      : {}),
                  });
                }
              }, 1000);
            }
          } else {
            // Element left viewport or below threshold — cancel timer
            if (visibilityTimerRef.current) {
              clearTimeout(visibilityTimerRef.current);
              visibilityTimerRef.current = null;
            }
          }
        }
      },
      { threshold },
    );

    observer.observe(wrapperRef.current);

    return () => {
      observer.disconnect();
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current);
        visibilityTimerRef.current = null;
      }
    };
  }, [visibilityThreshold, eventName, conversionValue]);

  // Build data-ph-capture-attribute-* props
  const dataAttributes: Record<string, string> = {};

  if (trackAsEvent) {
    if (eventName) {
      dataAttributes["data-ph-capture-attribute-event_name"] = eventName;
    }

    // Spread event properties as individual data attributes
    if (eventProperties) {
      for (const [key, value] of Object.entries(eventProperties)) {
        if (key && value) {
          dataAttributes[`data-ph-capture-attribute-${key}`] = value;
        }
      }
    }

    // Include conversion value if set
    if (conversionValue != null) {
      dataAttributes["data-ph-capture-attribute-conversion_value_aed"] =
        String(conversionValue);
    }
  }

  return (
    <div
      ref={wrapperRef}
      id={resolvedIdRef.current || undefined}
      style={visibilityThreshold ? undefined : { display: "contents" }}
      {...dataAttributes}
      {...(replayUnmask ? { "data-ph-no-capture": "false" } : {})}
    >
      {children}
    </div>
  );
}
