/**
 * Pure feature-flag utilities — safe to import from both server and client code.
 *
 * These functions have no React dependencies and no "use client" directive,
 * so they can be called from Server Components, Route Handlers, and middleware
 * as well as from client-side React hooks.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The set of recognized feature flags. Extend this union to add a new flag —
 * every consumer stays type-safe without any other change.
 */
export type FeatureFlag =
  | "branded_builder"
  | "breakpoint_css"
  | "inline_editor";

// ── Constants ────────────────────────────────────────────────────────────────

/** Enumerable list of known flags — useful for admin UIs or rollout matrices. */
export const FEATURE_FLAGS: readonly FeatureFlag[] = [
  "branded_builder",
  "breakpoint_css",
  "inline_editor",
] as const;

/** Default value for every feature flag. Always `false`. */
export const FEATURE_FLAG_DEFAULT = false;

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a raw value stored in `site_settings.value` (which is always a `text`
 * column) into a boolean. Only the literal string `"true"` (case-insensitive,
 * trimmed) resolves to `true`; everything else resolves to `false`.
 */
export function parseFeatureFlag(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return FEATURE_FLAG_DEFAULT;
  return raw.trim().toLowerCase() === "true";
}

export interface SettingEntry {
  key: string;
  value: string;
}

/**
 * Resolve a single flag from an already-loaded settings array.
 */
export function resolveFeatureFlag(
  flag: FeatureFlag,
  settings: ReadonlyArray<SettingEntry> | null | undefined,
): boolean {
  if (!settings) return FEATURE_FLAG_DEFAULT;
  const entry = settings.find((s) => s.key === flag);
  return entry ? parseFeatureFlag(entry.value) : FEATURE_FLAG_DEFAULT;
}

/**
 * Resolve every known flag into a typed record.
 */
export function resolveFeatureFlags(
  settings: ReadonlyArray<SettingEntry> | null | undefined,
): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const flag of FEATURE_FLAGS) {
    out[flag] = resolveFeatureFlag(flag, settings);
  }
  return out;
}
