import { eq } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { targets } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import {
  getConfiguredProviders,
  isUnconfigured,
  type EnrichmentProvider,
  type ProviderId,
  type TargetRef,
} from "@/lib/cms/prospecting/providers";
import type { ProvenancedField } from "@/lib/cms/prospecting/target";
import type { JobContext, JobHandler } from "./index";

// ── enrichment_fetch (Prospecting Workspace S7) — Design §Architecture (job
// extensions), §Components #4; Requirements 3.1, 3.2, 8.2 ─────────────────────
//
// One `enrichment_fetch` job == one Account/Person intelligence assembly for ONE
// Target, fanned out across the configured providers, persisted as provenanced
// attributes. The enrich path runs as a job (rather than inline) so a retry is
// idempotent by `jobKey` (`enrichmentJobKey` in `prospecting/providers/cache.ts`),
// bounding the (billable) provider fetch to AT MOST ONE charge per jobKey via the
// spine's at-most-once claim (Req 8.2 / CC-Idem).
//
// CONTAINER-ONLY: registered + run on the worker tier ([container-only]).
//
// PROVENANCE (Req 3.2 / CC-Provenance): every merged field is a
// {@link ProvenancedField} carrying its provider source + as-of (+ lawful basis
// for PII), so purchased data is never indistinguishable from first-party data.

/** Payload carried on an `enrichment_fetch` job. */
export interface EnrichmentFetchPayload {
  /** The Target to enrich. */
  targetId: string;
}

function parsePayload(payload: unknown): EnrichmentFetchPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const targetId = typeof p.targetId === "string" ? p.targetId : undefined;
  if (!targetId) {
    throw new Error("enrichment_fetch: payload.targetId is required");
  }
  return { targetId };
}

/**
 * Fan a Target's enrichment out across the providers and merge their provenanced
 * attributes. A provider returning `{ unconfigured: true }` is skipped; one that
 * throws is isolated so a single flaky source cannot sink the run. Later
 * providers win on a key collision (deterministic last-write in provider order).
 */
async function enrichAllProviders(
  ref: TargetRef,
  providers: EnrichmentProvider[]
): Promise<{
  attributes: Record<string, ProvenancedField>;
  unconfiguredProviders: ProviderId[];
  failedProviders: ProviderId[];
}> {
  const attributes: Record<string, ProvenancedField> = {};
  const unconfiguredProviders: ProviderId[] = [];
  const failedProviders: ProviderId[] = [];

  const settled = await Promise.allSettled(
    providers.map((p) => p.enrich(ref))
  );

  settled.forEach((outcome, i) => {
    const provider = providers[i];
    if (outcome.status === "rejected") {
      failedProviders.push(provider.id);
      return;
    }
    if (isUnconfigured(outcome.value)) {
      unconfiguredProviders.push(provider.id);
      return;
    }
    Object.assign(attributes, outcome.value.attributes);
  });

  return { attributes, unconfiguredProviders, failedProviders };
}

/**
 * Build a {@link JobHandler} for `enrichment_fetch`, injecting the providers to
 * fan out to (defaults to the shared registry). Tests pass fake providers (and a
 * counting one) to assert the provider fetch happens AT MOST ONCE per jobKey
 * across repeated / concurrent re-runs.
 */
export function createEnrichmentFetchHandler(
  providers?: EnrichmentProvider[]
): JobHandler {
  return async (db: Database, payload: unknown, _ctx: JobContext) => {
    const { targetId } = parsePayload(payload);
    // Resolve the registry at call time when no explicit providers are injected,
    // so adapters that register after module load are still seen.
    const activeProviders = providers ?? getConfiguredProviders();

    const [target] = await db
      .select({
        id: targets.id,
        displayName: targets.displayName,
        companyName: targets.companyName,
        email: targets.email,
        rawPhone: targets.rawPhone,
        country: targets.country,
        sourceRef: targets.sourceRef,
        attributes: targets.attributes,
      })
      .from(targets)
      .where(eq(targets.id, targetId))
      .limit(1);

    if (!target) {
      throw new Error(`enrichment_fetch: target "${targetId}" not found`);
    }

    const ref: TargetRef = {
      targetId: target.id,
      displayName: target.displayName ?? undefined,
      companyName: target.companyName ?? undefined,
      email: target.email ?? undefined,
      phone: target.rawPhone ?? undefined, // transient lookup only — never persisted raw
      country: target.country ?? undefined,
      sourceRef: target.sourceRef ?? undefined,
    };

    const { attributes } = await enrichAllProviders(ref, activeProviders);

    // Merge onto any existing per-field provenance map; new provider fields win.
    const existing =
      (target.attributes as Record<string, ProvenancedField> | null) ?? {};
    const merged = { ...existing, ...attributes };

    await db
      .update(targets)
      .set({ attributes: merged, status: "researching", updatedAt: new Date() })
      .where(eq(targets.id, targetId));

    await publishEvent(db, {
      type: "prospecting.target.enriched",
      payload: { targetId },
    });
  };
}

/** Default handler instance wired to the shared provider registry. */
export const enrichmentFetchHandler: JobHandler = createEnrichmentFetchHandler();
