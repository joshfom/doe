/**
 * Shared test utilities for the page builder.
 *
 * The builder render functions are wrapped with `withBreakpointResolution`,
 * which calls `useBreakpoint()` internally. Tests that invoke
 * `Component.render(props)` and render the resulting element directly fail
 * with `Invalid hook call` / `useContext` returning null because there is no
 * surrounding `BreakpointProvider`. `renderBlock` wraps the element in a
 * `BreakpointProvider` so those hook-driven renders work in tests.
 *
 * Spec: builder-production-hardening — Requirement 5.1 (test-suite repair).
 */

import React from "react";
import { render } from "@testing-library/react";
import { BreakpointProvider } from "./breakpoint-context";
import type { Breakpoint } from "./breakpoints";

/**
 * Render a Puck block's element inside the `BreakpointProvider` so
 * hook-wrapped renders (`withBreakpointResolution` → `useBreakpoint`) work
 * in tests.
 *
 * Returns the Testing Library render result so callers can destructure
 * `{ container, getByText, ... }` as usual.
 *
 * @param element The block element to render (e.g. the output of `render(props)`).
 * @param opts.breakpoint Initial active breakpoint. Defaults to `"desktop"`.
 */
export function renderBlock(
  element: React.ReactElement,
  opts?: { breakpoint?: Breakpoint },
) {
  return render(
    <BreakpointProvider initial={opts?.breakpoint ?? "desktop"}>
      {element}
    </BreakpointProvider>,
  );
}
