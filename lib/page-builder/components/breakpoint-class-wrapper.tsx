/**
 * withBreakpointClassNames — wrap a Puck `Config`'s `render` functions
 * so each block that carries breakpoint-aware fields gets a wrapper
 * element with `className="pb-block-{id}"`.
 *
 * Spec: custom-branded-page-builder — task 12.3
 * _Requirements: 7.1, 15.2_
 *
 * The `renderBreakpointCSS` function emits CSS custom properties scoped
 * to `.pb-block-{id}` inside `@media` rules. For those rules to take
 * effect, the block's rendered DOM must carry that class name.
 *
 * Implementation strategy: for each component in the config, replace
 * its `render` with a wrapper that calls the original render and wraps
 * the result in a `<div className="pb-block-{id}">` — but ONLY when
 * the block's id is in the provided `annotatedIds` set. Blocks without
 * breakpoint-aware data render unchanged (Property 5, Req 16.1).
 *
 * The wrapping `<div>` uses `display: contents` so it does not affect
 * layout — flex/grid parents, etc. continue to work unchanged. This is
 * the same approach used by `withEditModeAnnotations`.
 *
 * Non-breaking: block `fields`, `defaultProps`, and the render function
 * signature are unchanged (Req 7.1). Block authors cannot tell the
 * wrapper exists.
 */

import React from "react";
import type { Config, ComponentConfig } from "@puckeditor/core";

const WRAPPER_STYLE: React.CSSProperties = { display: "contents" };

function annotateComponent(
  component: ComponentConfig<Record<string, unknown>>,
  annotatedIds: ReadonlySet<string>,
): ComponentConfig<Record<string, unknown>> {
  const originalRender = component.render;
  if (typeof originalRender !== "function") return component;

  const wrappedRender: typeof originalRender = (props: any) => {
    const id =
      (props?.puck && typeof props.puck === "object"
        ? (props.puck as { id?: unknown }).id
        : undefined) ?? props?.id;

    const child = originalRender(props);

    // Only wrap blocks that actually have breakpoint-aware CSS emitted.
    // Blocks without breakpoint data render byte-identical to baseline.
    if (typeof id !== "string" || id.length === 0 || !annotatedIds.has(id)) {
      return child;
    }

    return (
      <div className={`pb-block-${id}`} style={WRAPPER_STYLE}>
        {child}
      </div>
    );
  };

  return { ...component, render: wrappedRender };
}

/**
 * Returns a new Puck Config where every component's render function is
 * wrapped to emit `className="pb-block-{id}"` on blocks whose id is in
 * the `annotatedIds` set.
 *
 * @param config - The base Puck config (not mutated).
 * @param annotatedIds - Set of block ids that carry breakpoint-aware CSS.
 *   Obtain via `collectAnnotatedBlockIds(data)`.
 */
export function withBreakpointClassNames(
  config: Config,
  annotatedIds: ReadonlySet<string>,
): Config {
  // Fast path: if no blocks need annotation, return the original config
  // unchanged — avoids allocating wrapper functions for every block.
  if (annotatedIds.size === 0) return config;

  const wrapped: Record<string, ComponentConfig<Record<string, unknown>>> = {};
  for (const [name, component] of Object.entries(config.components)) {
    wrapped[name] = annotateComponent(
      component as ComponentConfig<Record<string, unknown>>,
      annotatedIds,
    );
  }
  return { ...config, components: wrapped };
}
