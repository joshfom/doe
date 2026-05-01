/**
 * CRM Adapter Registry
 *
 * Maintains a map of registered CRM adapters keyed by name.
 * The active adapter is resolved from the `CRM_ADAPTER` environment variable.
 * If no adapter is configured, `getActiveAdapter()` returns null and CRM sync
 * is silently skipped.
 */

import type { CrmAdapter } from "./adapter";

// ── Internal adapter map ─────────────────────────────────────────────────────

const adapters = new Map<string, CrmAdapter>();

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a concrete CRM adapter under the given name.
 * Overwrites any previously registered adapter with the same name.
 */
export function registerAdapter(name: string, adapter: CrmAdapter): void {
  adapters.set(name, adapter);
}

/**
 * Return the currently active CRM adapter, or `null` if none is configured.
 *
 * Resolution order:
 * 1. Read the `CRM_ADAPTER` environment variable.
 * 2. Look up the adapter by name in the registry.
 * 3. If the env var is not set or no adapter is registered under that name,
 *    return `null` (CRM sync will be skipped).
 *
 * Note: In a future iteration this can also fall back to reading from the
 * `site_settings` table, but env-var resolution is sufficient for Phase 1.
 */
export function getActiveAdapter(): CrmAdapter | null {
  const adapterName = process.env.CRM_ADAPTER;

  if (!adapterName) {
    return null;
  }

  return adapters.get(adapterName) ?? null;
}

/**
 * Remove all registered adapters. Useful for testing.
 */
export function clearAdapters(): void {
  adapters.clear();
}
