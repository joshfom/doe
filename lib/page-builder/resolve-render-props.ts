/**
 * Breakpoint-aware prop resolution utilities for block render functions.
 *
 * These helpers allow block renders to transparently handle props that may
 * be either legacy scalars or `BreakpointValue<T>` objects (introduced by
 * the per-breakpoint configuration feature). Resolution happens at render
 * time only — stored prop values are never mutated.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import {
  isBreakpointValue,
  migrateLegacyScalar,
  resolveBreakpointValue,
  type Breakpoint,
  type BreakpointValue,
} from "./breakpoints";
import type { ResponsiveDefaults } from "./responsive-defaults";

/**
 * Compound breakpoint-aware fields — these are objects (e.g. `_padding`,
 * `_margin`, `_border`) whose sub-keys may themselves be `BreakpointValue`
 * objects. After top-level resolution, we also resolve each sub-key.
 *
 * Two shapes are possible:
 *  (a) The entire compound is a `BreakpointValue<Record<string, string>>`:
 *      `{ desktop: { paddingTop: "16", ... } }` — handled by top-level resolution.
 *  (b) Individual sub-keys are `BreakpointValue<string>`:
 *      `{ paddingTop: { desktop: "16", tablet: "8" }, paddingBottom: "16" }`
 *      — handled by deep resolution below.
 */
export const COMPOUND_BREAKPOINT_FIELDS: ReadonlySet<string> = new Set([
  "_padding",
  "_margin",
  "_border",
]);

/**
 * Resolve a single prop value that may be a `BreakpointValue<T>`.
 *
 * - If `value` is a `BreakpointValue<T>` (detected via `isBreakpointValue`),
 *   returns `resolveBreakpointValue(value, activeBreakpoint)`.
 * - Otherwise returns `value` unchanged.
 */
export function resolveRenderProp(
  value: unknown,
  activeBreakpoint: Breakpoint,
): unknown {
  if (isBreakpointValue(value)) {
    return resolveBreakpointValue(value, activeBreakpoint);
  }
  return value;
}

/**
 * Deep-resolve a compound object's sub-keys. If any sub-key value is itself
 * a `BreakpointValue<T>`, resolve it to the active breakpoint scalar.
 * Returns a new object — the input is never mutated.
 */
function resolveCompoundSubKeys(
  compound: Record<string, unknown>,
  activeBreakpoint: Breakpoint,
): Record<string, unknown> {
  let needsCopy = false;
  for (const key of Object.keys(compound)) {
    if (isBreakpointValue(compound[key])) {
      needsCopy = true;
      break;
    }
  }
  if (!needsCopy) return compound;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(compound)) {
    result[key] = resolveRenderProp(compound[key], activeBreakpoint);
  }
  return result;
}

/**
 * Resolve all breakpoint-aware fields in a props object.
 *
 * Iterates over `breakpointAwareFields`; for each field name present in
 * `props`, resolves the value via `resolveRenderProp`. For compound fields
 * (listed in `COMPOUND_BREAKPOINT_FIELDS`), also resolves any sub-keys
 * that may be `BreakpointValue` objects. All other keys are preserved
 * unchanged. Returns a new object — the input is never mutated.
 *
 * Validates: Requirements 3.4
 */
export function resolveAllRenderProps(
  props: Record<string, unknown>,
  activeBreakpoint: Breakpoint,
  breakpointAwareFields: ReadonlySet<string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...props };
  for (const field of breakpointAwareFields) {
    if (field in resolved) {
      resolved[field] = resolveRenderProp(resolved[field], activeBreakpoint);

      // Deep-resolve compound fields: after top-level resolution, the value
      // should be a plain object (e.g. { paddingTop: "16", ... }). If any
      // sub-key is still a BreakpointValue, resolve it too.
      if (
        COMPOUND_BREAKPOINT_FIELDS.has(field) &&
        resolved[field] != null &&
        typeof resolved[field] === "object" &&
        !Array.isArray(resolved[field])
      ) {
        resolved[field] = resolveCompoundSubKeys(
          resolved[field] as Record<string, unknown>,
          activeBreakpoint,
        );
      }
    }
  }
  return resolved;
}

// ─── Resolution with Responsive Defaults ────────────────────────────────────

/**
 * Result of resolving a breakpoint-aware field value through the full
 * Slot_Resolution_Order. Communicates both the resolved value and its
 * provenance (for the inherited indicator in the builder UI).
 */
export interface ResolutionResult<T> {
  value: T | undefined;
  source: "explicit" | "default" | "inherited" | "scalar";
  /** Only set when `source` is `"inherited"`. */
  inheritedFrom?: Breakpoint;
}

/**
 * The breakpoint hierarchy ordered from narrowest to widest.
 * Used to iterate "upward" when searching for wider-tier explicit values.
 */
const BREAKPOINT_HIERARCHY: readonly Breakpoint[] = [
  "mobile",
  "tablet",
  "desktop",
];

/**
 * Determines whether a value is "explicitly set" — non-null, non-undefined,
 * and not an empty string.
 */
function isExplicitlySet<T>(value: T | undefined | null): value is T {
  if (value === null || value === undefined) return false;
  if (value === "") return false;
  return true;
}

/**
 * Resolve all breakpoint-aware fields in a props object, threading responsive
 * defaults through the resolution pipeline.
 *
 * For each field in `breakpointAwareFields`:
 * - If `responsiveDefaults` has an entry for that field, uses `resolveWithDefaults`
 *   to resolve the value (applying the full Slot_Resolution_Order).
 * - Otherwise, falls back to the existing `resolveRenderProp` logic.
 *
 * Compound fields (`_padding`, `_margin`, `_border`) receive deep-resolution
 * of sub-keys after top-level resolution, identical to `resolveAllRenderProps`.
 *
 * Returns a new object — the input is never mutated.
 *
 * Validates: Requirements 2.1, 2.6, 9.1, 9.3
 */
export function resolveAllRenderPropsWithDefaults(
  props: Record<string, unknown>,
  activeBreakpoint: Breakpoint,
  breakpointAwareFields: ReadonlySet<string>,
  responsiveDefaults?: ResponsiveDefaults,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...props };
  for (const field of breakpointAwareFields) {
    if (field in resolved) {
      // Use resolveWithDefaults for fields that have responsive defaults declared
      if (responsiveDefaults && field in responsiveDefaults) {
        const result = resolveWithDefaults(
          resolved[field] as BreakpointValue<unknown> | unknown | undefined,
          activeBreakpoint,
          field,
          responsiveDefaults,
        );
        resolved[field] = result.value;
      } else {
        resolved[field] = resolveRenderProp(resolved[field], activeBreakpoint);
      }

      // Deep-resolve compound fields: after top-level resolution, the value
      // should be a plain object (e.g. { paddingTop: "16", ... }). If any
      // sub-key is still a BreakpointValue, resolve it too.
      if (
        COMPOUND_BREAKPOINT_FIELDS.has(field) &&
        resolved[field] != null &&
        typeof resolved[field] === "object" &&
        !Array.isArray(resolved[field])
      ) {
        resolved[field] = resolveCompoundSubKeys(
          resolved[field] as Record<string, unknown>,
          activeBreakpoint,
        );
      }
    }
  }
  return resolved;
}

/**
 * Resolve a breakpoint-aware field value using the full Slot_Resolution_Order:
 *
 * 1. Explicit value at target breakpoint slot (non-null, non-undefined, non-empty-string)
 * 2. responsiveDefaults value for target breakpoint slot
 * 3. Explicit value at next wider tier (iterating upward through the hierarchy)
 * 4. Scalar default / undefined
 *
 * This replaces the simpler `resolveBreakpointValue` for fields where
 * `responsiveDefaults` are declared.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3
 */
export function resolveWithDefaults<T>(
  storedValue: BreakpointValue<T> | T | undefined,
  activeBreakpoint: Breakpoint,
  fieldName: string,
  responsiveDefaults: ResponsiveDefaults | undefined,
): ResolutionResult<T> {
  // Normalize legacy scalars into BreakpointValue shape
  const bv = migrateLegacyScalar<T>(storedValue);

  // Step 1: Explicit value at target breakpoint slot
  const targetSlotValue = bv[activeBreakpoint];
  if (isExplicitlySet(targetSlotValue)) {
    return { value: targetSlotValue, source: "explicit" };
  }

  // Step 2: responsiveDefaults value for target breakpoint slot
  if (responsiveDefaults) {
    const fieldDefaults = responsiveDefaults[fieldName];
    if (fieldDefaults) {
      const defaultValue = (fieldDefaults as BreakpointValue<T>)[
        activeBreakpoint
      ];
      if (isExplicitlySet(defaultValue)) {
        return { value: defaultValue, source: "default" };
      }
    }
  }

  // Step 3: Explicit value at next wider tier, iterating upward
  const activeIndex = BREAKPOINT_HIERARCHY.indexOf(activeBreakpoint);
  for (let i = activeIndex + 1; i < BREAKPOINT_HIERARCHY.length; i++) {
    const widerTier = BREAKPOINT_HIERARCHY[i];
    const widerValue = bv[widerTier];
    if (isExplicitlySet(widerValue)) {
      return {
        value: widerValue,
        source: "inherited",
        inheritedFrom: widerTier,
      };
    }
  }

  // Step 4: Scalar default / undefined
  // If the original storedValue was a legacy scalar (not a BreakpointValue),
  // migrateLegacyScalar would have placed it in the desktop slot. If we
  // reached here, no explicit value was found anywhere — return undefined.
  return { value: undefined, source: "scalar" };
}
