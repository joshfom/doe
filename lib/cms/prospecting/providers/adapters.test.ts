import { describe, it, expect, vi } from "vitest";

import { ApolloProvider } from "./apollo";
import { PdlProvider } from "./pdl";
import { CognismProvider } from "./cognism";
import { CrunchbaseProvider } from "./crunchbase";
import { SearchCache } from "./cache";
import { enrichmentJobKey, ENRICHMENT_FETCH_JOB_KIND } from "./cache";
import type { ProviderConfig, ProviderDeps } from "./base";
import type { HttpResponse, HttpTransport } from "./transport";
import { isUnconfigured } from "./index";
import type { ProspectFilter, ProviderResult } from "./index";

/**
 * Unit tests for the four Account/Person enrichment adapters (task 4.2).
 *
 * Per [deps]: the HTTP transport is ALWAYS mocked — the suite never hits the
 * network. These cover the contract-level behaviour each adapter inherits and
 * its provider-specific payload→provenanced-field mapping:
 *
 *  - Req 2.4 / 3.1 — when the API key is absent (config `null`) both `search`
 *    and `enrich` return `{ unconfigured: true }` WITHOUT any transport call.
 *  - Req 3.2 / CC-Provenance — every mapped field carries value/source/asOf, and
 *    PII fields (email/phone) additionally carry a lawful basis.
 *  - Req 2.3 — an identical repeat search within the cache window serves cache
 *    rather than re-billing the transport.
 *  - Req 8.2 / CC-Idem — `enrichmentJobKey` is deterministic for a given ref.
 */

const ASOF = "2026-02-01T00:00:00.000Z";
const FIXED_CLOCK = () => new Date(ASOF);

/** A JSON transport mock returning a canned body and counting calls. */
function mockTransport(body: unknown): { transport: HttpTransport; calls: () => number } {
  const fn = vi.fn(
    async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      json: async () => body,
    })
  );
  return { transport: fn, calls: () => fn.mock.calls.length };
}

const CONFIG: ProviderConfig = { apiKey: "test-key", baseUrl: "https://example.test" };

const FILTER: ProspectFilter = {
  targetType: "person",
  geography: ["DIFC"],
  titles: ["Managing Partner"],
  industries: ["Family Office"],
  fundingSignals: ["series_c"],
};

// ── Unconfigured short-circuit (Req 2.4 / 3.1) ──────────────────────────────────

describe("adapters — unconfigured short-circuit (Req 2.4, 3.1)", () => {
  const cases = [
    ["apollo", () => new ApolloProvider(null)],
    ["pdl", () => new PdlProvider(null)],
    ["cognism", () => new CognismProvider(null)],
    ["crunchbase", () => new CrunchbaseProvider(null)],
  ] as const;

  for (const [id, make] of cases) {
    it(`${id}: search/enrich return unconfigured without a transport call when the key is absent`, async () => {
      const { transport, calls } = mockTransport({});
      // Re-construct with the mock transport so we can assert it is never touched.
      const provider = make();
      // @ts-expect-error — inject the mock transport into the constructed instance for the assertion
      provider.transport = transport;

      const search = await provider.search(FILTER);
      const enrich = await provider.enrich({ companyName: "Acme" });

      expect(isUnconfigured(search)).toBe(true);
      expect(isUnconfigured(enrich)).toBe(true);
      expect(calls()).toBe(0);
    });
  }
});

// ── Provenance mapping (Req 3.2 / CC-Provenance) ────────────────────────────────

describe("apollo — maps payload to provenanced fields (Req 3.2)", () => {
  it("stamps source + asOf on every field and a lawful basis on PII", async () => {
    const { transport } = mockTransport({
      people: [
        {
          id: "a-1",
          name: "Jane Founder",
          title: "Managing Partner",
          email: "jane@acme.test",
          country: "AE",
          organization: { name: "Acme Family Office", industry: "Finance" },
        },
      ],
    });
    const deps: ProviderDeps = { transport, clock: FIXED_CLOCK };
    const provider = new ApolloProvider(CONFIG, deps);

    const result = await provider.search(FILTER);
    expect(isUnconfigured(result)).toBe(false);
    const [r] = result as ProviderResult[];

    expect(r.sourceProvider).toBe("apollo");
    expect(r.displayName).toBe("Jane Founder");
    // Non-PII field carries source + asOf.
    expect(r.attributes.title).toEqual({
      value: "Managing Partner",
      source: "apollo",
      asOf: ASOF,
      lawfulBasis: undefined,
    });
    // PII field (email) carries a lawful basis.
    expect(r.attributes.email.source).toBe("apollo");
    expect(r.attributes.email.asOf).toBe(ASOF);
    expect(r.attributes.email.lawfulBasis).toBe("legitimate_interest");
  });
});

describe("crunchbase — maps funding signals as non-PII provenanced fields", () => {
  it("returns firmographic/funding attributes with source + asOf and no PII basis", async () => {
    const { transport } = mockTransport({
      entities: [
        {
          uuid: "cb-1",
          properties: {
            name: "Acme Ventures",
            last_funding_type: "series_c",
            num_funding_rounds: 4,
            total_funding_usd: 120000000,
            categories: ["Venture Capital"],
            country_code: "AE",
          },
        },
      ],
    });
    const provider = new CrunchbaseProvider(CONFIG, { transport, clock: FIXED_CLOCK });

    const result = await provider.search({ ...FILTER, targetType: "company" });
    const [r] = result as ProviderResult[];

    expect(r.sourceProvider).toBe("crunchbase");
    expect(r.companyName).toBe("Acme Ventures");
    expect(r.attributes.lastFundingType).toEqual({
      value: "series_c",
      source: "crunchbase",
      asOf: ASOF,
      lawfulBasis: undefined,
    });
    expect(r.attributes.totalFundingUsd.value).toBe("120000000");
  });
});

// ── Cache no-rebill (Req 2.3) ───────────────────────────────────────────────────

describe("search cache — identical repeat serves cache, no re-bill (Req 2.3)", () => {
  it("calls the transport once across two identical searches within the window", async () => {
    const { transport, calls } = mockTransport({
      data: [{ id: "p-1", full_name: "Jane", work_email: "j@acme.test" }],
    });
    // A shared cache with a fixed clock so the window never elapses mid-test.
    let now = 1_000;
    const cache = new SearchCache<ProviderResult[]>(60_000, () => now);
    const provider = new PdlProvider(CONFIG, { transport, clock: FIXED_CLOCK, cache });

    await provider.search(FILTER);
    await provider.search({ ...FILTER }); // structurally identical (different object)

    expect(calls()).toBe(1);

    // Advancing past the window forces a re-bill.
    now += 120_000;
    await provider.search(FILTER);
    expect(calls()).toBe(2);
  });
});

// ── Enrichment jobKey determinism (Req 8.2 / CC-Idem) ───────────────────────────

describe("enrichmentJobKey — deterministic per provider + target ref", () => {
  it("is stable for the same ref and prefixed by the job kind", () => {
    const ref = { targetId: "t-1" };
    const k1 = enrichmentJobKey("apollo", ref);
    const k2 = enrichmentJobKey("apollo", { targetId: "t-1" });
    expect(k1).toBe(k2);
    expect(k1.startsWith(`${ENRICHMENT_FETCH_JOB_KIND}:apollo:`)).toBe(true);

    // A different provider or target yields a different key.
    expect(enrichmentJobKey("pdl", ref)).not.toBe(k1);
    expect(enrichmentJobKey("apollo", { targetId: "t-2" })).not.toBe(k1);
  });
});
