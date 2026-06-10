/**
 * Shared responsive-grid helper for the page-builder block library.
 *
 * Several of the new marketing blocks (Testimonial grid, LogoCloud,
 * PricingTable, CardGrid) lay their items out in a responsive multi-column
 * grid. Rather than each block re-deriving the column field and the inline
 * grid style, this module centralises both:
 *
 *   - `responsiveColumnsField(label, max)` builds the breakpoint-aware column
 *     selector those blocks expose.
 *   - `gridStyle(props, { gap })` resolves that field to the static desktop
 *     `grid-template-columns` inline style the render uses.
 *
 * Reuse, not reinvention:
 *   - The selector is built from the shared `createCustomSelectField` leaf
 *     helper in `shared-field-controls.ts`, so it renders identically to every
 *     other select control in the configuration panel.
 *   - The desktop value is resolved with `resolveBreakpointValue` from
 *     `breakpoints.ts` — the exact helper the existing `Columns` block uses to
 *     turn its breakpoint-aware `layoutDirection` into a static inline default.
 *     Per-breakpoint behaviour is layered on afterwards by the breakpoint-css
 *     pipeline (`renderBreakpointCSS`), which keys off the same `columns` field
 *     name; `gridStyle` only owns the deterministic desktop baseline.
 *
 * The field name is fixed to `columns` (the helper deliberately takes no name
 * parameter) so it is always a member of `BREAKPOINT_AWARE_FIELDS` and therefore
 * always breakpoint-aware. Consuming blocks assign the field to the `columns`
 * key — `COLUMNS_FIELD_NAME` is exported as the single source of truth for that
 * name so callers (and tests) never hard-code the string.
 *
 * This file intentionally does NOT import from `config.ts`: `config.ts` imports
 * these helpers, so a back-import would create a circular dependency. Everything
 * the helpers need lives here, in `shared-field-controls.ts`, or in
 * `breakpoints.ts`.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/grid.ts`
 * Validates: Requirements 12.1, 12.3
 */

import type { CSSProperties } from "react";
import type { Field } from "@puckeditor/core";
import { createCustomSelectField } from "../shared-field-controls";
import { resolveBreakpointValue, type BreakpointValue } from "../breakpoints";

/**
 * The fixed field name for the responsive column selector. It is a member of
 * `BREAKPOINT_AWARE_FIELDS`, so any block that keys {@link responsiveColumnsField}
 * here gets breakpoint-aware column behaviour for free. Exported so consuming
 * blocks and tests share one source of truth instead of repeating the literal.
 */
export const COLUMNS_FIELD_NAME = "columns" as const;

/**
 * Build the breakpoint-aware column selector used by the grid blocks.
 *
 * Returns a `createCustomSelectField`-style field offering the values `1..max`
 * (stored as strings, matching the other column selectors in `config.ts`).
 * The field carries no name of its own — consuming blocks MUST assign it to the
 * {@link COLUMNS_FIELD_NAME} (`columns`) key so it stays breakpoint-aware:
 *
 * ```ts
 * fields: {
 *   [COLUMNS_FIELD_NAME]: responsiveColumnsField("Columns", 4),
 *   // …
 * }
 * ```
 *
 * @param label Visible field label (e.g. "Columns").
 * @param max   Highest selectable column count; options run `1..max`. Values
 *              below 1 are coerced to a single-option (`1`) field.
 */
export function responsiveColumnsField(label: string, max: number): Field {
  const upper = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
  const options = Array.from({ length: upper }, (_, i) => {
    const value = String(i + 1);
    return { label: value, value };
  });

  return createCustomSelectField(
    label,
    options,
    `Number of columns on desktop (1–${upper}). Narrower breakpoints can override this per-viewport.`,
  ) as Field;
}

/** Options for {@link gridStyle}. */
export interface GridStyleOptions {
  /**
   * CSS gap applied between grid tracks (e.g. `"16px"`, `"24px"`). Passed
   * straight through to the inline style's `gap`.
   */
  gap?: string;
}

/**
 * Resolve the static desktop grid style for a block's `columns` field.
 *
 * Mirrors how the existing `Columns` block resolves `layoutDirection`: the
 * breakpoint-aware value is read at the `desktop` tier via
 * {@link resolveBreakpointValue} to produce the deterministic inline baseline,
 * while per-breakpoint overrides are emitted separately by the breakpoint-css
 * pipeline. Resolving only `desktop` here keeps the server-rendered markup
 * byte-stable.
 *
 * The resolved value is coerced to a positive integer column count (defaulting
 * to a single column for absent or invalid data) and rendered as
 * `repeat(n, 1fr)`.
 *
 * @param props The block props holding the `columns` field (scalar, legacy
 *              scalar, or {@link BreakpointValue}).
 * @param opts  The grid `gap`.
 * @returns An inline style: `display: grid`, `gridTemplateColumns`, and `gap`.
 */
export function gridStyle(
  props: Record<string, unknown>,
  { gap }: GridStyleOptions = {},
): CSSProperties {
  const resolved = resolveBreakpointValue<number | string>(
    props[COLUMNS_FIELD_NAME] as BreakpointValue<number | string> | number | string | undefined,
    "desktop",
  );

  const parsed = Math.floor(Number(resolved));
  const columns = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;

  return {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap,
  };
}
