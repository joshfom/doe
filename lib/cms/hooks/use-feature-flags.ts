"use client";

import { useSiteSettings } from "./use-settings";

// Re-export pure utilities so existing imports from this module still work
// on the client side. Server-side code should import from ./feature-flag-utils
// directly to avoid the "use client" boundary.
export {
  type FeatureFlag,
  FEATURE_FLAGS,
  FEATURE_FLAG_DEFAULT,
  parseFeatureFlag,
  resolveFeatureFlag,
  resolveFeatureFlags,
} from "./feature-flag-utils";

import { resolveFeatureFlag, resolveFeatureFlags } from "./feature-flag-utils";
import type { FeatureFlag } from "./feature-flag-utils";

// ── React hooks ──────────────────────────────────────────────────────────────

/**
 * Read a single feature flag on the client.
 *
 * Returns `false` while the settings query is loading, if the key is absent
 * from the settings table, or if the stored value is anything other than
 * `"true"`. This default-false semantics preserves baseline production
 * behavior for any slice whose flag has not been explicitly flipped on.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useSiteSettings();
  return resolveFeatureFlag(flag, data);
}

/**
 * Read every known feature flag at once as a typed record.
 */
export function useFeatureFlags(): Record<FeatureFlag, boolean> {
  const { data } = useSiteSettings();
  return resolveFeatureFlags(data);
}
