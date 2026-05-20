"use client";

/**
 * Breakpoint resolution wrapper for Puck block render functions.
 *
 * Wraps a block's `render` function so that any prop whose name is in
 * `BREAKPOINT_AWARE_FIELDS` is resolved from a `BreakpointValue<T>` object
 * to the active-breakpoint scalar before the original render runs.
 *
 * This keeps the fix DRY — every block in `config.ts` gets resolution for
 * free by wrapping its render once, and future blocks added to the config
 * automatically benefit.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5
 */

import React from "react";
import { useBreakpoint } from "./breakpoint-context";
import {
  resolveAllRenderProps,
  resolveAllRenderPropsWithDefaults,
} from "./resolve-render-props";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";
import type { ResponsiveDefaults } from "./responsive-defaults";

/**
 * The shape of a Puck block render function.
 * Puck passes the block's props (including `puck`, `editMode`, etc.) and
 * expects a React element back.
 */
type BlockRenderFn = (props: Record<string, unknown>) => React.ReactElement;

/**
 * Wraps a Puck block render function with breakpoint-aware prop resolution.
 *
 * At render time the wrapper:
 *  1. Reads the active breakpoint from `BreakpointProvider` context.
 *  2. Calls `resolveAllRenderProps` (or `resolveAllRenderPropsWithDefaults`
 *     when `responsiveDefaults` is provided) on the incoming props, resolving
 *     every field listed in `BREAKPOINT_AWARE_FIELDS` from its potential
 *     `BreakpointValue<T>` shape to the scalar for the active breakpoint.
 *  3. Passes the resolved props object to the original render function.
 *
 * Props that are NOT in `BREAKPOINT_AWARE_FIELDS` (content fields, Puck
 * internals like `puck` and `editMode`) pass through unchanged.
 *
 * Validates: Requirements 2.1, 9.1, 9.3
 */
export function withBreakpointResolution(
  render: BlockRenderFn,
  responsiveDefaults?: ResponsiveDefaults,
): BlockRenderFn {
  const WrappedRender: BlockRenderFn = (props) => {
    const { activeBreakpoint } = useBreakpoint();
    const resolved = responsiveDefaults
      ? resolveAllRenderPropsWithDefaults(
          props,
          activeBreakpoint,
          BREAKPOINT_AWARE_FIELDS,
          responsiveDefaults,
        )
      : resolveAllRenderProps(props, activeBreakpoint, BREAKPOINT_AWARE_FIELDS);
    return render(resolved);
  };

  // Preserve the original function name for debugging / React DevTools.
  Object.defineProperty(WrappedRender, "name", {
    value: `withBreakpointResolution(${render.name || "anonymous"})`,
    configurable: true,
  });

  return WrappedRender;
}
