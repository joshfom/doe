/**
 * Responsive defaults type, validation, and utilities.
 *
 * A `ResponsiveDefaults` declaration lives on a component definition and
 * specifies per-breakpoint fallback values for breakpoint-aware fields.
 * These values are applied at render time when no explicit author value
 * exists for a given (field, breakpoint) pair. They are never persisted
 * to stored page data.
 *
 * Design references: `.kiro/specs/default-responsive-component-defaults/design.md`
 * Validates: Requirements 1.1, 1.2, 1.4, 1.6
 */

import type { BreakpointValue } from "./breakpoints";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Per-component responsive defaults declaration.
 * Keys must be members of BREAKPOINT_AWARE_FIELDS.
 * Each entry must include at least a `mobile` slot.
 */
export type ResponsiveDefaults = Partial<
  Record<string, BreakpointValue<unknown>>
>;

/**
 * Validation result for a responsiveDefaults declaration.
 */
export interface ResponsiveDefaultsValidationError {
  component: string;
  field?: string;
  slot?: string;
  reason: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_SLOT_KEYS: ReadonlySet<string> = new Set([
  "desktop",
  "tablet",
  "mobile",
]);

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates a responsiveDefaults object against the rules:
 * 1. All keys must be in BREAKPOINT_AWARE_FIELDS
 * 2. All slot keys must be "desktop" | "tablet" | "mobile"
 * 3. Every declared entry must have a defined `mobile` slot
 *
 * Returns an array of errors (empty = valid).
 */
export function validateResponsiveDefaults(
  componentName: string,
  defaults: ResponsiveDefaults,
): ResponsiveDefaultsValidationError[] {
  const errors: ResponsiveDefaultsValidationError[] = [];

  for (const fieldKey of Object.keys(defaults)) {
    // Rule 1: field key must be a registered breakpoint-aware field
    if (!BREAKPOINT_AWARE_FIELDS.has(fieldKey)) {
      errors.push({
        component: componentName,
        field: fieldKey,
        reason: `Field "${fieldKey}" is not a registered breakpoint-aware field`,
      });
      continue;
    }

    const entry = defaults[fieldKey];
    if (entry === undefined || entry === null) {
      continue;
    }

    // Rule 2: all slot keys must be valid breakpoint names
    for (const slotKey of Object.keys(entry)) {
      if (!VALID_SLOT_KEYS.has(slotKey)) {
        errors.push({
          component: componentName,
          field: fieldKey,
          slot: slotKey,
          reason: `Slot key "${slotKey}" is not a valid breakpoint (must be "desktop", "tablet", or "mobile")`,
        });
      }
    }

    // Rule 3: every declared entry must have a defined mobile slot
    if (entry.mobile === undefined) {
      errors.push({
        component: componentName,
        field: fieldKey,
        reason: `Field "${fieldKey}" declares responsive defaults but is missing a "mobile" slot`,
      });
    }
  }

  return errors;
}
