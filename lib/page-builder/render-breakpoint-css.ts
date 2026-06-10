/**
 * renderBreakpointCSS — emit per-breakpoint CSS for a Puck PageData.
 *
 * Spec: custom-branded-page-builder — task 12.1
 * _Requirements: 15.1, 15.2, 15.3, 16.1, 16.4_
 *
 * Pure function. No React, no DOM. Walks the page data once, finds every
 * block that carries either:
 *   1. a breakpoint-aware field (`BREAKPOINT_AWARE_FIELDS`) populated as
 *      a {@link BreakpointValue} with explicit slots, or
 *   2. an explicit non-default `_visibility` flag (any `false`).
 *
 * For each such block it emits a CSS rule scoped to `.pb-block-{id}`:
 *   - CSS custom properties for breakpoint-aware fields, scoped inside
 *     `@media` rules so the cascade applies the right tier.
 *   - `display: none` inside the relevant `@media` rule for every
 *     visibility slot where the flag is `false` (Req 13.3, 16.4).
 *
 * Returns an empty string when no block carries breakpoint-aware data —
 * that gives byte-identical baseline output (Req 16.1, Property 5) so
 * `PageRenderer` can decide whether to emit a `<style>` tag at all.
 *
 * NOTE: Block render functions need to (a) wrap their root element with
 * `className="pb-block-{id}"` and (b) consume the emitted CSS custom
 * properties to actually apply per-breakpoint values. That cooperation
 * lands in task 12.3. Until then this function provides the CSS pipeline
 * without forcing changes to existing block definitions — visibility
 * still works because the `display: none` rule applies to any element
 * carrying the class, and a small wrapper in `PageRenderer.tsx` adds the
 * class to top-level blocks (task 12.2).
 */

import type { PageData, ComponentInstance } from "./types";
import { BREAKPOINTS } from "./breakpoints";
import {
  isBreakpointValue,
  type Breakpoint,
  type BreakpointValue,
} from "./breakpoints";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";
import {
  hasNonDefaultVisibility,
  resolveVisibility,
} from "./visibility";

const ALL_BREAKPOINTS: ReadonlyArray<Breakpoint> = ["desktop", "tablet", "mobile"];

/** Build the `@media` selector string for a breakpoint tier. */
function mediaQueryFor(bp: Breakpoint): string {
  switch (bp) {
    case "desktop":
      return `@media (min-width: ${BREAKPOINTS.desktop.min}px)`;
    case "tablet":
      return `@media (min-width: ${BREAKPOINTS.tablet.min}px) and (max-width: ${BREAKPOINTS.tablet.max}px)`;
    case "mobile":
      return `@media (max-width: ${BREAKPOINTS.mobile.max}px)`;
  }
}

/**
 * Convert a single CSS-friendly value to a string. Numeric values get a
 * `px` unit appended to keep callers from having to repeat the unit on
 * every prop. Object/array values are stringified via JSON only as a
 * defensive fallback — block authors are expected to store strings.
 */
function valueToCss(raw: unknown): string {
  if (typeof raw === "number") return `${raw}px`;
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

/**
 * Convert a prop name like `_padding` into a CSS custom property name
 * like `--pb-padding`. The leading underscore (used by some ORA blocks
 * to mark internal props) is stripped; camelCase is converted to
 * kebab-case.
 */
function propToCssVar(name: string): string {
  const stripped = name.startsWith("_") ? name.slice(1) : name;
  const kebab = stripped.replace(/([A-Z])/g, "-$1").toLowerCase();
  return `--pb-${kebab}`;
}

interface BlockCssChunks {
  /** Per-breakpoint blocks of property declarations, keyed by breakpoint. */
  byBp: Record<Breakpoint, string[]>;
}

function emptyChunks(): BlockCssChunks {
  return { byBp: { desktop: [], tablet: [], mobile: [] } };
}

/**
 * Inspect a single block's props and append the CSS declarations it
 * contributes to each breakpoint. Returns `null` if the block produces
 * no CSS at all (so the caller can skip emitting an empty class rule).
 */
function collectBlockCss(item: ComponentInstance): BlockCssChunks | null {
  const props = (item.props ?? {}) as Record<string, unknown>;
  const chunks = emptyChunks();
  let producedAny = false;

  for (const [name, value] of Object.entries(props)) {
    if (!BREAKPOINT_AWARE_FIELDS.has(name)) continue;
    if (!isBreakpointValue(value)) continue;
    const bv = value as BreakpointValue<unknown>;
    for (const bp of ALL_BREAKPOINTS) {
      const slotValue = bv[bp];
      if (slotValue === undefined) continue;
      const cssValue = valueToCss(slotValue);
      if (cssValue === "") continue;
      chunks.byBp[bp].push(`${propToCssVar(name)}: ${cssValue};`);
      producedAny = true;
    }
  }

  if (hasNonDefaultVisibility(props._visibility)) {
    const flags = resolveVisibility(props._visibility);
    for (const bp of ALL_BREAKPOINTS) {
      if (!flags[bp]) {
        chunks.byBp[bp].push("display: none;");
        producedAny = true;
      }
    }
  }

  return producedAny ? chunks : null;
}

/** Emit a single class block's CSS as a string. */
function emitBlockCss(id: string, chunks: BlockCssChunks): string {
  const parts: string[] = [];
  for (const bp of ALL_BREAKPOINTS) {
    const decls = chunks.byBp[bp];
    if (decls.length === 0) continue;
    parts.push(
      `${mediaQueryFor(bp)} { .pb-block-${id} { ${decls.join(" ")} } }`,
    );
  }
  return parts.join("\n");
}

/**
 * Walk every block (root content + all zones) and concatenate the per-
 * breakpoint CSS. Returns `""` when no block contributes anything.
 */
export function renderBreakpointCSS(data: PageData): string {
  const chunks: string[] = [];

  const visit = (items: ReadonlyArray<ComponentInstance> | undefined) => {
    if (!items) return;
    for (const item of items) {
      const id = (item.props as { id?: unknown })?.id;
      if (typeof id !== "string" || id.length === 0) continue;
      const blockChunks = collectBlockCss(item);
      if (!blockChunks) continue;
      chunks.push(emitBlockCss(id, blockChunks));
    }
  };

  visit(data.content);
  if (data.zones) {
    for (const items of Object.values(data.zones)) {
      visit(items);
    }
  }

  return chunks.join("\n");
}

/**
 * Returns the set of block ids that carry per-breakpoint CSS. Used by
 * `PageRenderer` to decide which blocks need a `pb-block-{id}` class
 * wrapper without re-walking the data.
 */
export function collectAnnotatedBlockIds(data: PageData): Set<string> {
  const ids = new Set<string>();
  const visit = (items: ReadonlyArray<ComponentInstance> | undefined) => {
    if (!items) return;
    for (const item of items) {
      const id = (item.props as { id?: unknown })?.id;
      if (typeof id !== "string" || id.length === 0) continue;
      if (collectBlockCss(item)) ids.add(id);
    }
  };
  visit(data.content);
  if (data.zones) {
    for (const items of Object.values(data.zones)) visit(items);
  }
  return ids;
}
