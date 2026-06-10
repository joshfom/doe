/**
 * Visibility helpers — pure, no React, no DOM.
 *
 * Spec: custom-branded-page-builder — tasks 11.3, 12.1, 12.5
 * _Requirements: 13.1, 13.2, 13.3, 16.4_
 *
 * `_visibility` is an optional per-block prop of shape {@link VisibilityFlags}.
 * The default for any unset (or partially set) value is fully visible —
 * `{ desktop: true, tablet: true, mobile: true }` (Req 13.2).
 */

import type { Breakpoint } from "./breakpoints";
import type { VisibilityFlags } from "./breakpoints";

export type { VisibilityFlags };

/** Fully-visible defaults — exported as a frozen literal for cheap reuse. */
export const DEFAULT_VISIBILITY: Readonly<VisibilityFlags> = Object.freeze({
  desktop: true,
  tablet: true,
  mobile: true,
});

/**
 * Resolve a raw value (typically `block.props._visibility`) to a fully
 * populated {@link VisibilityFlags}. Missing flags default to `true`.
 *
 * Accepts `undefined`, `null`, or a partial object. Any non-boolean entry
 * coerces to `true` so a corrupted record never renders fully hidden by
 * accident — Req 13.2 says the default is visible.
 */
export function resolveVisibility(raw: unknown): VisibilityFlags {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { ...DEFAULT_VISIBILITY };
  }
  const r = raw as Partial<Record<Breakpoint, unknown>>;
  return {
    desktop: typeof r.desktop === "boolean" ? r.desktop : true,
    tablet: typeof r.tablet === "boolean" ? r.tablet : true,
    mobile: typeof r.mobile === "boolean" ? r.mobile : true,
  };
}

/**
 * `true` when the block has any explicit `_visibility` flag set to
 * something other than the implicit default of `true`. Used by
 * `renderBreakpointCSS` to decide whether to emit a class for the block
 * at all (Req 16.1 — empty CSS for legacy data).
 */
export function hasNonDefaultVisibility(raw: unknown): boolean {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return false;
  }
  const r = raw as Partial<Record<Breakpoint, unknown>>;
  return r.desktop === false || r.tablet === false || r.mobile === false;
}
