/**
 * Breakpoint primitives — pure helpers.
 *
 * No React. No context. No DOM. These helpers are consumed by both the
 * public renderer and the builder-shell canvas preview, so they must stay
 * free of browser, framework, or editor-state dependencies.
 *
 * The React context and hooks live in `./breakpoints.tsx` (added in a
 * later task). That file re-exports the public API from this module.
 *
 * Design references: `.kiro/specs/custom-branded-page-builder/design.md`
 * Validates: Requirements 11.1, 11.4, 14.1, 14.3, 15.3, 15.4, 15.5
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** The three viewport tiers supported by the builder. */
export type Breakpoint = "desktop" | "tablet" | "mobile";

/**
 * Storage shape for a breakpoint-aware field value. Each slot is optional;
 * an absent slot means "inherit from the next-wider tier" per
 * {@link resolveBreakpointValue}.
 */
export type BreakpointValue<T> = {
  desktop?: T;
  tablet?: T;
  mobile?: T;
};

/** Per-breakpoint visibility flags. All three default to `true`. */
export type VisibilityFlags = {
  desktop: boolean;
  tablet: boolean;
  mobile: boolean;
};

// ─── Canonical thresholds ───────────────────────────────────────────────────

/**
 * Canonical breakpoint thresholds. These pixel bands are the single source
 * of truth used by `renderBreakpointCSS` (public renderer) and the
 * builder-shell canvas preview. Re-exported from `./theme.ts` so callers
 * that already import theme tokens do not need a second import path.
 *
 * Bands:
 * - `mobile`:  `0..640 px`
 * - `tablet`:  `641..1024 px`
 * - `desktop`: `>= 1025 px`
 */
export const BREAKPOINTS = {
  desktop: { min: 1025 },
  tablet: { min: 641, max: 1024 },
  mobile: { max: 640 },
} as const;

export type BreakpointsThresholds = typeof BREAKPOINTS;

// ─── Pure helpers ───────────────────────────────────────────────────────────

const BREAKPOINT_KEYS: ReadonlySet<string> = new Set<Breakpoint>([
  "desktop",
  "tablet",
  "mobile",
]);

/**
 * Structural type guard for {@link BreakpointValue}.
 *
 * Returns `true` for any plain object whose own enumerable keys are a
 * (possibly empty) subset of `{"desktop", "tablet", "mobile"}`. Arrays,
 * `null`, and primitives return `false`.
 *
 * Note: an empty object `{}` is a valid `BreakpointValue` — it simply has
 * no slots populated. This lets {@link clearSlot} return `{}` without
 * losing its shape.
 */
export function isBreakpointValue<T>(raw: unknown): raw is BreakpointValue<T> {
  if (raw === null || raw === undefined) return false;
  if (typeof raw !== "object") return false;
  if (Array.isArray(raw)) return false;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (!BREAKPOINT_KEYS.has(key)) return false;
  }
  return true;
}

/**
 * Lazy on-read migration from a legacy scalar to a {@link BreakpointValue}.
 *
 * - If `raw` is already a {@link BreakpointValue}, it is returned as-is.
 * - If `raw` is `null` or `undefined`, an empty `BreakpointValue` is returned.
 * - Otherwise `raw` is wrapped as `{ desktop: raw }` — the value that was
 *   previously applied uniformly becomes the desktop baseline, which
 *   {@link resolveBreakpointValue} then fans out to every smaller tier via
 *   fall-through.
 *
 * The migration is lossless: for any legacy scalar `v`,
 * `resolveBreakpointValue(migrateLegacyScalar(v), bp)` equals `v` for every
 * `bp` — enforced by Property 1 (Req 14.3, 21.1).
 */
export function migrateLegacyScalar<T>(raw: unknown): BreakpointValue<T> {
  if (isBreakpointValue<T>(raw)) return raw;
  if (raw === null || raw === undefined) return {};
  return { desktop: raw as T };
}

/**
 * Resolve the effective value of a breakpoint-aware field at a given
 * breakpoint, applying the fall-through rule (Req 15.4, 15.5):
 *
 * - `desktop` → `desktop` slot
 * - `tablet`  → `tablet`  slot, else `desktop`
 * - `mobile`  → `mobile`  slot, else `tablet`, else `desktop`
 *
 * Accepts either a stored {@link BreakpointValue}, a legacy scalar, or
 * `undefined`. Legacy values are migrated in-memory via
 * {@link migrateLegacyScalar}; storage is not mutated.
 */
export function resolveBreakpointValue<T>(
  value: BreakpointValue<T> | T | undefined,
  activeBreakpoint: Breakpoint,
): T | undefined {
  const bv = migrateLegacyScalar<T>(value);
  switch (activeBreakpoint) {
    case "mobile":
      return bv.mobile ?? bv.tablet ?? bv.desktop;
    case "tablet":
      return bv.tablet ?? bv.desktop;
    case "desktop":
      return bv.desktop;
  }
}

/**
 * Remove a slot from a {@link BreakpointValue} without leaving a residual
 * `null` or empty-string sentinel (Req 11.4).
 *
 * Returns a shallow copy with the `slot` key omitted entirely. If the slot
 * was already absent, the returned object is still a fresh copy so callers
 * can rely on referential inequality for change detection.
 */
export function clearSlot<T>(
  value: BreakpointValue<T>,
  slot: Breakpoint,
): BreakpointValue<T> {
  const next: BreakpointValue<T> = { ...value };
  delete next[slot];
  return next;
}
