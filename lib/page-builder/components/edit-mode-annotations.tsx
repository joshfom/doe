/**
 * withEditModeAnnotations — wrap a Puck `Config`'s `render` functions
 * so each block emits `data-puck-id` on its rendered subtree.
 *
 * Spec: custom-branded-page-builder — task 15.5
 * _Requirements: 8.3, 16.1, 16.2_
 *
 * The inline editor's `useInlineSelection` hook walks the DOM up from
 * a click target looking for `[data-puck-id]`. Without this wrapper
 * those attributes don't exist in the public render output, so clicks
 * never resolve to a block id.
 *
 * Implementation strategy: for each component in the config, replace
 * its `render` with a wrapper that calls the original render and wraps
 * the result in a `<div data-puck-id={puck.id}>`. Puck passes the
 * component's id via the `puck` prop on every render call.
 *
 * Trade-off: the wrapping `<div>` is an extra DOM node. We add it only
 * when `editMode === true` (admin viewers); anonymous SSR paths use
 * the unwrapped config so output remains byte-identical (Property 5,
 * Req 16.1). This is verified by `public-html-stability.property.test.ts`
 * which renders with `editMode` left as the default `false`.
 *
 * The wrapper is a `display: contents` div — it participates in the
 * accessibility tree and event flow but does **not** affect layout, so
 * existing block CSS (flex/grid parents, etc.) continues to work
 * unchanged. (`display: contents` is supported in all evergreen
 * browsers and degrades to a normal block, which is harmless for the
 * edit-mode-only path.)
 */

import React from "react";
import type { Config, ComponentConfig } from "@puckeditor/core";

const ANNOTATION_STYLE: React.CSSProperties = { display: "contents" };

function annotateComponent(
  component: ComponentConfig<Record<string, unknown>>,
): ComponentConfig<Record<string, unknown>> {
  const originalRender = component.render;
  if (typeof originalRender !== "function") return component;

  // Preserve every other field (fields, defaultProps, label, etc.) —
  // we ONLY swap the render function. Block authors cannot tell the
  // wrapper exists.
  const annotatedRender: typeof originalRender = (props: any) => {
    const id =
      (props?.puck && typeof props.puck === "object"
        ? (props.puck as { id?: unknown }).id
        : undefined) ?? props?.id;
    const child = originalRender(props);
    if (typeof id !== "string" || id.length === 0) return child;
    return (
      <div data-puck-id={id} style={ANNOTATION_STYLE}>
        {child}
      </div>
    );
  };

  return { ...component, render: annotatedRender };
}

export function withEditModeAnnotations(config: Config): Config {
  const wrapped: Record<string, ComponentConfig<Record<string, unknown>>> = {};
  for (const [name, component] of Object.entries(config.components)) {
    wrapped[name] = annotateComponent(
      component as ComponentConfig<Record<string, unknown>>,
    );
  }
  return { ...config, components: wrapped };
}
