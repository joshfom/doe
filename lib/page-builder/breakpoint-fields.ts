/**
 * Breakpoint-aware field registry.
 *
 * Single source of truth for which Puck block prop names carry
 * breakpoint-aware values (shape {@link BreakpointValue}). Consumed by:
 *
 *   1. The builder-shell `ConfigurationPanel`, which wraps matching fields
 *      with `BreakpointAwareFieldWrapper` so writes land in the active
 *      breakpoint slot only.
 *   2. The public renderer's `renderBreakpointCSS`, which emits
 *      media-query-scoped CSS custom properties for matching fields.
 *
 * Keep minimal — no other exports. A field name either represents layout,
 * spacing, or sizing (breakpoint-aware) or content (scalar). Content fields
 * such as `text`, `content`, `href`, `src`, `alt`, and `label` must NOT be
 * added here; they remain flat scalars regardless of the active
 * breakpoint (Req 11.5).
 *
 * Design references: `.kiro/specs/custom-branded-page-builder/design.md`
 * Validates: Requirements 11.1, 11.5
 */
export const BREAKPOINT_AWARE_FIELDS: ReadonlySet<string> = new Set<string>([
  // Spacing
  "_padding",
  "_margin",
  "_border",
  "btnPadding",
  // Sizing
  "height",
  "width",
  "minHeight",
  "maxHeight",
  "imgHeight",
  "imgWidth",
  // Typography metrics
  "fontSize",
  "lineHeight",
  "letterSpacing",
  // Grid gaps
  "columnGap",
  "rowGap",
  // Layout direction
  "layoutDirection",
  // Flex block direction
  "flexDirection",
  // Grid columns
  "columns",
]);
