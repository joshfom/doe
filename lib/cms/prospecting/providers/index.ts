/**
 * Prospecting Workspace (S7) — Account/Person enrichment provider registry +
 * contract (Design §Components #4; Requirements 2.1, 2.4, 3.1).
 *
 * This module defines the provider-agnostic seam for Account/Person Intelligence
 * (Apollo / People Data Labs / Cognism / Crunchbase — Appendix A). It mirrors the
 * `MarketDataAdapter` pattern (`lib/cms/market/adapter.ts`): a thin, swappable
 * contract plus an `{ unconfigured: true }` signal so a provider whose
 * credentials are absent can be SKIPPED without failing a multi-provider search
 * (Req 2.4). The concrete adapters that fulfil this contract live alongside this
 * file (`apollo.ts` / `pdl.ts` / `cognism.ts` / `crunchbase.ts`, task 4.2) and
 * register themselves into the registry below.
 *
 * The one rule, preserved: an `EnrichmentProvider` is never called from a model
 * or a browser directly. `prospect_search` and `enrich_target` (the catalog
 * tools) fan out to the registered providers behind `dispatchTool`; this module
 * is the pure orchestration seam those tools delegate to (Req 2.2 / CC-Audit).
 *
 * Every field a provider returns is wrapped as a {@link ProvenancedField}
 * (mirroring `provenancedFieldSchema` in `../target.ts`): a `value`, the `source`
 * provider id, an `asOf` fetch timestamp, and — for PII — a `lawfulBasis` marker,
 * so purchased data is never indistinguishable from first-party data
 * (CC-Provenance, Req 3.2).
 */

import type { ProvenancedField } from "../target";
import { TARGET_TYPES } from "../target";

// ── Provider identity ──────────────────────────────────────────────────────────

/**
 * The Account/Person providers S7 wires (Appendix A). `"demo"` is a synthetic,
 * env-gated provider (`PROSPECT_DEMO=true`) that returns believable candidates
 * with `source: "demo"` provenance when no commercial provider is configured —
 * so the workspace is demoable end-to-end without a paid data subscription.
 */
export const PROVIDER_IDS = [
  "apollo",
  "pdl",
  "cognism",
  "crunchbase",
  "demo",
] as const;

/** A registered provider's stable id; also the `source` stamped on its fields. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

// ── The unconfigured signal ────────────────────────────────────────────────────

/**
 * Returned by `search`/`enrich` when a provider's credentials are absent (Req
 * 2.4, 3.1). It mirrors the market adapter's `UnconfiguredSource`: the caller
 * records an unconfigured-source indication and continues with the other
 * providers rather than failing the whole search.
 */
export interface Unconfigured {
  unconfigured: true;
}

/** Type guard: narrows a provider result to the unconfigured signal. */
export function isUnconfigured<T>(
  result: T | Unconfigured
): result is Unconfigured {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as Unconfigured).unconfigured === true
  );
}

/**
 * Thrown by a provider when the upstream source answers HTTP 429 (request quota
 * exhausted). Distinct from a generic failure so the fan-out can record it as a
 * RATE-LIMITED provider (surfaced to the rep as "provider limit reached — showing
 * representative data") rather than a silent skip. The demo provider then carries
 * the search so the workspace still produces candidates.
 */
export class ProviderRateLimitError extends Error {
  constructor(
    readonly providerId: string,
    readonly status: number = 429
  ) {
    super(`${providerId} request limit reached (HTTP ${status})`);
    this.name = "ProviderRateLimitError";
  }
}

// ── The ICP filter (Requirement 2.1) ───────────────────────────────────────────

/**
 * An ICP filter for `prospect_search`. Expresses at least target_type,
 * geography, title/seniority, company size/industry, funding/liquidity signal,
 * and wealth/role signal (Req 2.1). All fields beyond `targetType` are optional
 * so the same filter shape serves both the property-led (hypothesis-derived) and
 * the ICP-led (direct) entry points (Req 10.5).
 */
export interface ProspectFilter {
  /** Which prospecting mode to search for. */
  targetType: (typeof TARGET_TYPES)[number];
  /** Geography seeds — countries / cities / feeder markets (e.g. "India", "DIFC"). */
  geography?: string[];
  /** Title / seniority seeds (e.g. "Founder", "Managing Partner", "CFO"). */
  titles?: string[];
  /** Seniority band, where a provider supports it. */
  seniority?: string[];
  /** Company size band (headcount). */
  companySize?: { min?: number; max?: number };
  /** Industry seeds (e.g. "Venture Capital", "Family Office"). */
  industries?: string[];
  /** Funding / liquidity-event signals (e.g. "Series C", "acquisition", "IPO"). */
  fundingSignals?: string[];
  /** Wealth / role signals indicating buying power (e.g. "post-liquidity founder"). */
  wealthSignals?: string[];
  /** Optional free-text keywords passed through to providers that support them. */
  keywords?: string[];
  /** Max candidates to request per provider (cost guardrail). */
  limit?: number;
}

// ── Provider results + enrichment ───────────────────────────────────────────────

/**
 * A single candidate Target returned by a provider search. Identity fields
 * (`displayName`, `companyName`, `title`, `email`, `phone`, `country`) are
 * surfaced plainly for matching/display, while every enriched attribute is a
 * {@link ProvenancedField} carrying its own source + as-of (+ lawful basis for
 * PII). The record carries acquisition provenance (`sourceProvider`,
 * `sourceRef`, `lawfulBasis`) so `record_target` can persist it field-identically
 * (Req 1.3, 3.2, CC-Provenance).
 *
 * NOTE: `phone` here is the raw provider value held transiently; `record_target`
 * persists it only as a salted hash (CC-Privacy, Req 1.5).
 */
export interface ProviderResult {
  targetType: (typeof TARGET_TYPES)[number];
  displayName?: string;
  companyName?: string;
  title?: string;
  email?: string;
  phone?: string;
  country?: string;
  /** Per-field provenance map (key → value/source/asOf/lawfulBasis). */
  attributes: Record<string, ProvenancedField>;
  /** The provider that returned this candidate (record-acquisition provenance). */
  sourceProvider: ProviderId;
  /** The provider's stable id for this candidate, for idempotent re-fetch. */
  sourceRef?: string;
  /** Record-level lawful basis for holding this candidate's data. */
  lawfulBasis: string;
}

/**
 * A reference to an existing Target to enrich. A provider matches on whichever
 * identity keys it supports; at least one should be present for a useful lookup.
 */
export interface TargetRef {
  targetId?: string;
  displayName?: string;
  companyName?: string;
  email?: string;
  /** Raw phone held transiently for the lookup only — never persisted raw. */
  phone?: string;
  country?: string;
  /** The provider's own id for this Target from a prior search, when known. */
  sourceRef?: string;
}

/**
 * The Account/Person intelligence a provider assembles for a {@link TargetRef}.
 * Every assembled field is a {@link ProvenancedField}; the result is treated as
 * data (stored), never as a model-computed value (Req 3.3, CC-SQL).
 */
export interface ProviderEnrichment {
  /** The provider that assembled this intelligence. */
  sourceProvider: ProviderId;
  /** The provider's stable id for the enriched entity, when available. */
  sourceRef?: string;
  /** Per-field provenance map (key → value/source/asOf/lawfulBasis). */
  attributes: Record<string, ProvenancedField>;
}

// ── The provider contract ───────────────────────────────────────────────────────

/**
 * Provider-agnostic Account/Person intelligence source (Design §Components #4).
 * `search` turns an ICP filter into candidate Targets; `enrich` assembles
 * intelligence for one Target. Either returns `{ unconfigured: true }` when the
 * provider's credentials are absent so the fan-out can skip it (Req 2.4, 3.1).
 */
export interface EnrichmentProvider {
  readonly id: ProviderId;
  search(filter: ProspectFilter): Promise<ProviderResult[] | Unconfigured>;
  enrich(target: TargetRef): Promise<ProviderEnrichment | Unconfigured>;
}

// ── The registry ────────────────────────────────────────────────────────────────

/**
 * A lazily-resolved factory for a provider, invoked on first use — so a provider
 * that constructs an HTTP client only when credentials are present can defer that
 * work until it is actually called. Register one via {@link ProviderRegistry.registerLazy}.
 */
export type ProviderFactory = () => EnrichmentProvider;

/**
 * In-memory registry of Account/Person enrichment providers, keyed by id.
 *
 * The four concrete adapters register themselves here (task 4.2); until then the
 * registry is empty and `searchAllProviders` returns no candidates. Registration
 * is idempotent per id (a later `register`/`registerLazy` for the same id
 * replaces the prior one), so a module re-import or a test re-seed never
 * double-registers.
 */
export class ProviderRegistry {
  private readonly factories = new Map<ProviderId, ProviderFactory>();
  private readonly resolved = new Map<ProviderId, EnrichmentProvider>();

  /** Register a ready provider instance under its id. */
  register(provider: EnrichmentProvider): void {
    this.resolved.set(provider.id, provider);
    this.factories.delete(provider.id);
  }

  /**
   * Register a provider lazily: `factory` is invoked at most once, on the first
   * `get(id)`/fan-out that needs it, then the resolved instance is cached. The
   * `id` is supplied explicitly so the registry needs no construction to key it.
   */
  registerLazy(id: ProviderId, factory: ProviderFactory): void {
    this.factories.set(id, factory);
    this.resolved.delete(id);
  }

  /** Remove a provider by id (idempotent; used by tests). */
  unregister(id: ProviderId): void {
    this.resolved.delete(id);
    this.factories.delete(id);
  }

  /** Remove every registered provider (used by tests). */
  clear(): void {
    this.resolved.clear();
    this.factories.clear();
  }

  /** True when a provider is registered under `id`. */
  has(id: ProviderId): boolean {
    return this.resolved.has(id) || this.factories.has(id);
  }

  /** Resolve a single registered provider by id, or `undefined` when absent. */
  get(id: ProviderId): EnrichmentProvider | undefined {
    const existing = this.resolved.get(id);
    if (existing) return existing;

    const factory = this.factories.get(id);
    if (!factory) return undefined;

    const provider = factory();
    this.resolved.set(id, provider);
    this.factories.delete(id);
    return provider;
  }

  /**
   * Return all registered providers, in the canonical {@link PROVIDER_IDS}
   * order so a fan-out is deterministic. "Configured" here means "registered";
   * whether each provider's *credentials* are present is discovered at call time
   * via the `{ unconfigured: true }` signal (Req 2.4).
   */
  getConfiguredProviders(): EnrichmentProvider[] {
    const providers: EnrichmentProvider[] = [];
    for (const id of PROVIDER_IDS) {
      if (!this.has(id)) continue;
      const provider = this.get(id);
      if (provider) providers.push(provider);
    }
    return providers;
  }
}

/**
 * Resolve a factory's id by invoking it once (the result is cached by the
 * registry on first `register`). Factories are cheap to construct; the resolved
 * instance is reused thereafter.
 */
function peekFactoryId(factory: ProviderFactory): ProviderId {
  return factory().id;
}

/** The process-wide registry the catalog tools and adapters share. */
export const providerRegistry = new ProviderRegistry();

/** Register a provider into the shared registry (used by the concrete adapters). */
export function registerProvider(provider: EnrichmentProvider): void {
  providerRegistry.register(provider);
}

/** Lazily register a provider into the shared registry (resolved on first use). */
export function registerProviderLazy(
  id: ProviderId,
  factory: ProviderFactory
): void {
  providerRegistry.registerLazy(id, factory);
}

/** Get every registered (configured) provider from the shared registry. */
export function getConfiguredProviders(): EnrichmentProvider[] {
  return providerRegistry.getConfiguredProviders();
}

// ── The fan-out helper (Requirement 2.4) ────────────────────────────────────────

/** The aggregated outcome of fanning a single ICP search across providers. */
export interface SearchAllResult {
  /** Candidate Targets from every configured provider, concatenated. */
  results: ProviderResult[];
  /** Ids of providers that returned `{ unconfigured: true }` and were skipped. */
  unconfiguredProviders: ProviderId[];
  /** Ids of providers that threw and were skipped (the search still succeeds). */
  failedProviders: ProviderId[];
  /** Ids of providers skipped because their request quota was exhausted (429). */
  rateLimitedProviders: ProviderId[];
}

/**
 * Fan an ICP `filter` out across the registered providers and aggregate their
 * candidates (Req 2.4). A provider that returns `{ unconfigured: true }` is
 * SKIPPED and recorded in `unconfiguredProviders` — it never fails the whole
 * search while another provider is configured. A provider that throws is
 * likewise isolated into `failedProviders` so one flaky source cannot sink the
 * run. With no providers registered the result is empty (no candidates, nothing
 * unconfigured).
 *
 * DEMO AS A TRUE FALLBACK: the synthetic `demo` provider is held back and only
 * consulted when the LIVE providers produced ZERO candidates — i.e. every live
 * provider was unconfigured, failed, or hit its quota (429), or simply matched
 * nobody. When at least one live candidate comes back we have real data, so the
 * demo provider is never called and never mixed into live results. This makes
 * "call the APIs, fall back to demo on error / rate limit / quota" the actual
 * runtime behaviour the rep sees (rather than demo always contributing).
 *
 * This is the pure orchestration the `prospect_search` catalog tool calls behind
 * `dispatchTool`; it performs no DB writes and no caching itself (caching/billing
 * guardrails live in the tool/job layer, task 4.2).
 *
 * @param filter    the ICP filter to search.
 * @param providers the providers to fan out to; defaults to the shared registry.
 */
export async function searchAllProviders(
  filter: ProspectFilter,
  providers: EnrichmentProvider[] = getConfiguredProviders()
): Promise<SearchAllResult> {
  // Hold the demo provider back as a fallback; fan out the live providers first.
  const liveProviders = providers.filter((p) => p.id !== "demo");
  const demoProvider = providers.find((p) => p.id === "demo");

  const result = await fanOut(filter, liveProviders);

  // Only consult the demo provider when the live fan-out produced NO candidates
  // (all unconfigured / failed / rate-limited / no match). It carries the search
  // so the workspace still yields prospects, clearly stamped `source: "demo"`.
  if (result.results.length === 0 && demoProvider) {
    const demoOutcome = await fanOut(filter, [demoProvider]);
    result.results.push(...demoOutcome.results);
    result.unconfiguredProviders.push(...demoOutcome.unconfiguredProviders);
    result.failedProviders.push(...demoOutcome.failedProviders);
    result.rateLimitedProviders.push(...demoOutcome.rateLimitedProviders);
  }

  return result;
}

/** Fan a filter across the given providers and aggregate, isolating failures. */
async function fanOut(
  filter: ProspectFilter,
  providers: EnrichmentProvider[]
): Promise<SearchAllResult> {
  const results: ProviderResult[] = [];
  const unconfiguredProviders: ProviderId[] = [];
  const failedProviders: ProviderId[] = [];
  const rateLimitedProviders: ProviderId[] = [];

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.search(filter))
  );

  settled.forEach((outcome, i) => {
    const provider = providers[i];
    if (outcome.status === "rejected") {
      // A 429 is recorded distinctly so the rep sees "limit reached" (and the
      // demo provider's results carry the search); any other error is a plain
      // isolated failure.
      if (outcome.reason instanceof ProviderRateLimitError) {
        rateLimitedProviders.push(provider.id);
      } else {
        failedProviders.push(provider.id);
      }
      return;
    }
    if (isUnconfigured(outcome.value)) {
      unconfiguredProviders.push(provider.id);
      return;
    }
    results.push(...outcome.value);
  });

  return { results, unconfiguredProviders, failedProviders, rateLimitedProviders };
}
