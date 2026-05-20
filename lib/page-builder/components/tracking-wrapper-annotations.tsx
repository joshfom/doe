/**
 * withTrackingWrapper — wrap a Puck `Config`'s `render` functions
 * so each block that has `_trackAsEvent: true` gets wrapped with the
 * TrackingWrapper component for PostHog autocapture attributes and
 * visibility tracking.
 *
 * Spec: marketing-analytics — task 15.4
 * _Requirements: 8.2_
 *
 * Implementation strategy: for each component in the config, replace
 * its `render` with a wrapper that calls the original render and wraps
 * the result in a `<TrackingWrapper>` — but ONLY when the component's
 * props include `_trackAsEvent: true`.
 *
 * Components without tracking enabled render unchanged.
 *
 * The TrackingWrapper uses `display: contents` so it does not affect
 * layout — flex/grid parents, etc. continue to work unchanged.
 */

import React from "react";
import type { Config, ComponentConfig } from "@puckeditor/core";
import { TrackingWrapper } from "@/lib/analytics/tracking-wrapper";

function wrapComponent(
  component: ComponentConfig<Record<string, unknown>>,
): ComponentConfig<Record<string, unknown>> {
  const originalRender = component.render;
  if (typeof originalRender !== "function") return component;

  const wrappedRender: typeof originalRender = (props: any) => {
    const child = originalRender(props);

    // Tracking fields are stored under the `_tracking` object field
    const tracking = props?._tracking as Record<string, unknown> | undefined;

    // Only wrap if tracking is enabled on this component
    const trackAsEvent = tracking?._trackAsEvent === true;
    if (!trackAsEvent) return child;

    const eventName = (tracking?._eventName as string) || "";
    const eventProperties =
      (tracking?._eventProperties as Record<string, string>) || {};
    const conversionValue =
      tracking?._conversionValue != null && tracking._conversionValue !== ""
        ? Number(tracking._conversionValue)
        : undefined;
    const visibilityThreshold =
      tracking?._visibilityThreshold != null && tracking._visibilityThreshold !== ""
        ? Number(tracking._visibilityThreshold)
        : undefined;

    const replayUnmask = tracking?._replayUnmask === true;

    // Use puck.id as the base element ID for uniqueness
    const puckId =
      props?.puck && typeof props.puck === "object"
        ? (props.puck as { id?: unknown }).id
        : undefined;
    const elementId =
      typeof puckId === "string" && puckId.length > 0
        ? `track-${puckId}`
        : undefined;

    return (
      <TrackingWrapper
        trackAsEvent={trackAsEvent}
        eventName={eventName}
        eventProperties={eventProperties}
        conversionValue={
          conversionValue != null && Number.isFinite(conversionValue)
            ? conversionValue
            : undefined
        }
        visibilityThreshold={
          visibilityThreshold != null && Number.isFinite(visibilityThreshold)
            ? visibilityThreshold
            : undefined
        }
        elementId={elementId}
        replayUnmask={replayUnmask}
      >
        {child}
      </TrackingWrapper>
    );
  };

  return { ...component, render: wrappedRender };
}

/**
 * Returns a new Puck Config where every component's render function is
 * wrapped to emit TrackingWrapper when `_trackAsEvent` is true in the
 * component's props.
 *
 * @param config - The base Puck config (not mutated).
 */
export function withTrackingWrapper(config: Config): Config {
  const wrapped: Record<string, ComponentConfig<Record<string, unknown>>> = {};
  for (const [name, component] of Object.entries(config.components)) {
    wrapped[name] = wrapComponent(
      component as ComponentConfig<Record<string, unknown>>,
    );
  }
  return { ...config, components: wrapped };
}
