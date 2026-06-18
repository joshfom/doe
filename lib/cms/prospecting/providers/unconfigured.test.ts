import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ProviderRegistry,
  searchAllProviders,
  isUnconfigured,
  type EnrichmentProvider,
  type ProspectFilter,
  type ProviderId,
  type ProviderResult,
  type Unconfigured,
} from "./index";

/**
 * Unit tests for the unconfigured + licensing paths of the enrichment provider
 * fan-out (task 4.5).
 *
 * Validates:
 * - Req 2.4 — a provider whose credentials are absent (its `search` returns
 *   `{ unconfigured: true }`) is SKIPPED and recorded in `unconfiguredProviders`,
 *   while a configured provider still returns its candidates; the whole search
 *   never fails. With ALL providers unconfigured the search returns no candidates
 *   and records them all (no throw).
 * - Req 3.5 — a provider flagged as ToS-violating / licensing-excluded is excluded
 *   from the fan-out. The registry (task 4.1) does not model a "ToS-violating"
 *   flag, so exclusion is enforced upstream by simply NOT registering such a
 *   provider; this test asserts an unregistered (excluded) provider contributes
 *   nothing to the fan-out.
 *
 * All providers here are fake stubs implementing the `EnrichmentProvider`
 * contract — no real apollo/pdl/cognism/crunchbase adapters and no network.
 */

// ── Fake provider stubs ─────────────────────────────────────────────────────────

const ASOF = "2026-01-15T00:00:00.000Z";

/** A single candidate stamped to a provider, for assertion by `sourceProvider`. */
function candidate(provider: ProviderId): ProviderResult {
  return {
    targetType: "person",
    displayName: `${provider}-candidate`,
    companyName: "Acme Family Office",
    title: "Managing Partner",
    email: `${provider}@example.com`,
    attributes: {
      title: {
        value: "Managing Partner",
        source: provider,
        asOf: ASOF,
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: provider,
    sourceRef: `${provider}-ref-1`,
    lawfulBasis: "legitimate_interest",
  };
}

/** A configured provider: `search` returns one candidate stamped to its id. */
function configuredProvider(id: ProviderId): EnrichmentProvider {
  return {
    id,
    search: vi.fn(async (): Promise<ProviderResult[] | Unconfigured> => [
      candidate(id),
    ]),
    enrich: vi.fn(async () => ({ unconfigured: true }) as Unconfigured),
  };
}

/** A missing-credential provider: `search` returns the unconfigured signal. */
function unconfiguredProvider(id: ProviderId): EnrichmentProvider {
  return {
    id,
    search: vi.fn(async (): Promise<ProviderResult[] | Unconfigured> => ({
      unconfigured: true,
    })),
    enrich: vi.fn(async () => ({ unconfigured: true }) as Unconfigured),
  };
}

const FILTER: ProspectFilter = {
  targetType: "person",
  geography: ["DIFC"],
  titles: ["Managing Partner"],
};

// ── Req 2.4 — unconfigured provider skipped, configured still returns ────────────

describe("searchAllProviders — unconfigured paths (Req 2.4)", () => {
  it("skips a missing-credential provider and still returns configured candidates", async () => {
    const apollo = configuredProvider("apollo"); // configured
    const pdl = unconfiguredProvider("pdl"); // missing credentials

    const { results, unconfiguredProviders, failedProviders } =
      await searchAllProviders(FILTER, [apollo, pdl]);

    // The configured provider's candidate still comes back …
    expect(results).toHaveLength(1);
    expect(results[0].sourceProvider).toBe("apollo");
    // … the unconfigured one is recorded and skipped …
    expect(unconfiguredProviders).toEqual(["pdl"]);
    // … and nothing failed: the whole search succeeded.
    expect(failedProviders).toEqual([]);
  });

  it("returns no candidates and records all when EVERY provider is unconfigured", async () => {
    const apollo = unconfiguredProvider("apollo");
    const pdl = unconfiguredProvider("pdl");
    const cognism = unconfiguredProvider("cognism");

    // Must not throw even when no provider can serve the search.
    const { results, unconfiguredProviders, failedProviders } =
      await searchAllProviders(FILTER, [apollo, pdl, cognism]);

    expect(results).toEqual([]);
    expect(unconfiguredProviders.sort()).toEqual(["apollo", "cognism", "pdl"]);
    expect(failedProviders).toEqual([]);
  });

  it("isolates a throwing provider without sinking the search", async () => {
    const apollo = configuredProvider("apollo");
    const pdl: EnrichmentProvider = {
      id: "pdl",
      search: vi.fn(async () => {
        throw new Error("provider transport error");
      }),
      enrich: vi.fn(async () => ({ unconfigured: true }) as Unconfigured),
    };

    const { results, unconfiguredProviders, failedProviders } =
      await searchAllProviders(FILTER, [apollo, pdl]);

    expect(results).toHaveLength(1);
    expect(results[0].sourceProvider).toBe("apollo");
    expect(failedProviders).toEqual(["pdl"]);
    expect(unconfiguredProviders).toEqual([]);
  });
});

// ── Req 3.5 — a ToS-violating / licensing-excluded provider is excluded ──────────

describe("provider registry — licensing exclusion (Req 3.5)", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("excludes a provider that is not registered (the licensing-exclusion mechanism)", async () => {
    // Two compliant, licensed providers are registered …
    const apollo = configuredProvider("apollo");
    const cognism = configuredProvider("cognism");
    registry.register(apollo);
    registry.register(cognism);

    // … while a ToS-violating source (e.g. unlicensed scraping) is deliberately
    // NOT registered, so it can never enter the fan-out (Req 3.5).
    const excludedScraper = configuredProvider("pdl");

    const configured = registry.getConfiguredProviders();
    const configuredIds = configured.map((p) => p.id);

    expect(configuredIds.sort()).toEqual(["apollo", "cognism"]);
    expect(configuredIds).not.toContain(excludedScraper.id);

    // Fanning out over the configured set yields only the licensed providers'
    // candidates — the excluded scraper contributes nothing and is never called.
    const { results, unconfiguredProviders, failedProviders } =
      await searchAllProviders(FILTER, configured);

    expect(results.map((r) => r.sourceProvider).sort()).toEqual([
      "apollo",
      "cognism",
    ]);
    expect(results.map((r) => r.sourceProvider)).not.toContain(
      excludedScraper.id
    );
    expect(unconfiguredProviders).toEqual([]);
    expect(failedProviders).toEqual([]);
    expect(excludedScraper.search).not.toHaveBeenCalled();
  });

  it("removing a provider (unregister) excludes it from a subsequent search", async () => {
    const apollo = configuredProvider("apollo");
    const tosViolating = configuredProvider("crunchbase");
    registry.register(apollo);
    registry.register(tosViolating);

    expect(registry.getConfiguredProviders()).toHaveLength(2);

    // Flagged ToS-violating after the fact → removed from the registry.
    registry.unregister("crunchbase");

    const configured = registry.getConfiguredProviders();
    expect(configured.map((p) => p.id)).toEqual(["apollo"]);

    const { results } = await searchAllProviders(FILTER, configured);
    expect(results.map((r) => r.sourceProvider)).toEqual(["apollo"]);
    expect(tosViolating.search).not.toHaveBeenCalled();
  });

  it("returns an empty result when every provider is excluded (none registered)", async () => {
    const { results, unconfiguredProviders, failedProviders } =
      await searchAllProviders(FILTER, registry.getConfiguredProviders());

    expect(results).toEqual([]);
    expect(unconfiguredProviders).toEqual([]);
    expect(failedProviders).toEqual([]);
  });
});

// ── isUnconfigured guard sanity (the skip signal underpinning Req 2.4) ───────────

describe("isUnconfigured", () => {
  it("narrows the unconfigured signal and rejects real results", () => {
    expect(isUnconfigured({ unconfigured: true })).toBe(true);
    expect(isUnconfigured([candidate("apollo")])).toBe(false);
    expect(isUnconfigured(null as unknown as Unconfigured)).toBe(false);
  });
});
