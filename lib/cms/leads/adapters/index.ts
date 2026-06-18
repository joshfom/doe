/**
 * Lead Engine (S3) — the Ingestion_Adapter registry.
 *
 * The {@link AdapterRegistry} maps each {@link LeadSource} to exactly one
 * {@link IngestionAdapter} and provides source-keyed lookup. Only *registered*
 * sources are present, and a source may be registered at most once, so the
 * platform provides exactly one adapter per source and none for any other
 * origin (Req 1.1).
 *
 * Adapters are added by listing them in {@link ADAPTERS}; the `web_form`
 * adapter is registered here (task 2.1), and the `email`, `whatsapp`,
 * `meta_lead_ads`, and `portal` adapters (task 2.2). All five Lead_Sources are
 * now present, so the registry maps exactly one adapter per source (Req 1.1).
 *
 * Design references: §Components #1, §Module layout (`adapters/index.ts`).
 * Requirements: 1.1, 1.2.
 */

import type { IngestionAdapter, LeadSource } from "../inbound";
import { emailAdapter } from "./email";
import { metaLeadAdsAdapter } from "./meta-lead-ads";
import { portalAdapter } from "./portal";
import { webFormAdapter } from "./web-form";
import { whatsappAdapter } from "./whatsapp";

/**
 * The set of registered adapters — exactly one per {@link LeadSource}. Each
 * contributes itself under its own {@link IngestionAdapter.source}; duplicates
 * are rejected at build time.
 */
const ADAPTERS: readonly IngestionAdapter[] = [
  webFormAdapter,
  emailAdapter,
  whatsappAdapter,
  metaLeadAdsAdapter,
  portalAdapter,
];

/** A source-keyed, read-only mapping of every registered Ingestion_Adapter. */
export type AdapterRegistry = ReadonlyMap<LeadSource, IngestionAdapter>;

/**
 * Build the registry from the adapter list, rejecting a second adapter for any
 * source so each {@link LeadSource} maps to exactly one adapter (Req 1.1).
 */
function buildRegistry(
  adapters: readonly IngestionAdapter[]
): Map<LeadSource, IngestionAdapter> {
  const map = new Map<LeadSource, IngestionAdapter>();
  for (const adapter of adapters) {
    if (map.has(adapter.source)) {
      throw new Error(
        `Duplicate Ingestion_Adapter registered for source "${adapter.source}"`
      );
    }
    map.set(adapter.source, adapter);
  }
  return map;
}

const registry = buildRegistry(ADAPTERS);

/** The registry: each registered {@link LeadSource} → its one adapter. */
export const adapterRegistry: AdapterRegistry = registry;

/**
 * Look up the Ingestion_Adapter for a {@link LeadSource}, or `undefined` when
 * no adapter is registered for that source (Req 1.1, 1.2).
 */
export function getAdapter(source: LeadSource): IngestionAdapter | undefined {
  return registry.get(source);
}

/** Whether an Ingestion_Adapter is registered for the given source. */
export function hasAdapter(source: LeadSource): boolean {
  return registry.has(source);
}

/** The list of sources that currently have a registered adapter. */
export function registeredSources(): LeadSource[] {
  return [...registry.keys()];
}
