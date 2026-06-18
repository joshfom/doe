import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

import { ApolloProvider } from "./apollo";
import {
  SearchCache,
  enrichmentJobKey,
  ENRICHMENT_FETCH_JOB_KIND,
} from "./cache";
import type { ProviderConfig } from "./base";
import type { HttpResponse, HttpTransport } from "./transport";
import {
  isUnconfigured,
  type ProspectFilter,
  type ProviderEnrichment,
  type ProviderResult,
  type TargetRef,
} from "./index";

/**
 * Property test for the search cache + enrichment idempotency seam (task 4.3 — a
 * NON-optional CC-Idem / Requirements 2.3, 8.2 boundary test).
 *
 *   **Feature: prospecting-workspace, Property 10: Repeated identical ICP
 *   searches within the cache window serve cached results without re-billing; an
 *   enrichment_fetch with an existing jobKey produces at most one provider
 *   charge.**
 *
 * **Validates: Requirements 2.3, 8.2**
 *
 * Two cost/idempotency guardrails are exercised here against the REAL provider
 * machinery (`BaseEnrichmentProvider` + `SearchCache` + `enrichmentJobKey`),
 * with the only seams being the injectable {@link HttpTransport} (so the suite
 * never hits the network — task is [deps]) and the injectable `Clock`:
 *
 *  1. **Search cache, no re-bill (Req 2.3).** Over a randomized ICP filter and a
 *     randomized sequence of search times, the billable transport is invoked at
 *     most once per distinct filter while the window is fresh, and re-bills
 *     exactly when the window elapses. An independent oracle (mirroring the
 *     `SearchCache` TTL semantics) predicts the exact transport-call count, so
 *     the property is an equality, strictly stronger than "at most once".
 *
 *  2. **Enrichment idempotency by jobKey (Req 8.2 / CC-Idem).** Over a randomized
 *     {@link TargetRef} and a randomized number of retries, repeated enrichment
 *     dispatches keyed by `enrichmentJobKey(providerId, ref)` collapse to exactly
 *     one provider charge — BECAUSE the key is deterministic for a given logical
 *     ref. Structurally-identical refs (key order / absent-vs-undefined optional
 *     fields) derive the same key and so reconcile to one charge; distinct refs
 *     derive distinct keys and so bill separately. The job spine's
 *     `ON CONFLICT (job_key)` is modelled by a minimal in-memory runner; the
 *     determinism under test is `enrichmentJobKey`'s.
 *
 * The unit suite (`adapters.test.ts`) already covers the single-example
 * no-rebill and the jobKey-determinism cases; this is the ≥100-iteration
 * property over randomized filters, timings, and refs.
 */

// Spec requires >=100 iterations (task 4.3 / plan Notes). This test stands up no
// DB or network — only pure cache/hash logic behind a counting mock — so the
// full budget runs cheaply. Override via PBT_RUNS for an even heavier run.
const NUM_RUNS = Number(process.env.PBT_RUNS ?? 100);

const ASOF = "2026-02-01T00:00:00.000Z";
const FIXED_CLOCK = () => new Date(ASOF);

const CONFIG: ProviderConfig = {
  apiKey: "test-key",
  baseUrl: "https://example.test",
};

/** A JSON transport mock returning a canned body and counting every call. */
function mockTransport(body: unknown): {
  transport: HttpTransport;
  calls: () => number;
} {
  const fn = vi.fn(
    async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      json: async () => body,
    })
  );
  return { transport: fn, calls: () => fn.mock.calls.length };
}

// A canned Apollo people-search payload (one candidate) so a cache miss maps to
// a non-empty result; identity of the payload is irrelevant to the property.
const SEARCH_BODY = {
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
};

// A canned Apollo people-match payload for the enrich path.
const ENRICH_BODY = {
  person: {
    id: "a-1",
    name: "Jane Founder",
    title: "Managing Partner",
    email: "jane@acme.test",
    phone_numbers: [{ raw_number: "+971500000000" }],
  },
};

// ── Generators ──────────────────────────────────────────────────────────────

/** A randomized ICP filter; only `targetType` is required (Req 2.1 / 10.5). */
const filterArb: fc.Arbitrary<ProspectFilter> = fc.record(
  {
    targetType: fc.constantFrom("person", "company", "intermediary"),
    geography: fc.option(fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }), {
      nil: undefined,
    }),
    titles: fc.option(fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }), {
      nil: undefined,
    }),
    industries: fc.option(
      fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }),
      { nil: undefined }
    ),
    fundingSignals: fc.option(
      fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }),
      { nil: undefined }
    ),
    wealthSignals: fc.option(
      fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }),
      { nil: undefined }
    ),
    keywords: fc.option(fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }), {
      nil: undefined,
    }),
    limit: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  },
  { requiredKeys: ["targetType"] }
);

/** A randomized Target reference: either an id-backed or identity-key-backed ref. */
const refArb: fc.Arbitrary<TargetRef> = fc.oneof(
  fc.record({ targetId: fc.uuid() }),
  fc.record(
    {
      displayName: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
      companyName: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
      email: fc.option(fc.emailAddress(), { nil: undefined }),
      phone: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
      country: fc.option(fc.string({ maxLength: 4 }), { nil: undefined }),
      sourceRef: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    },
    { requiredKeys: [] }
  )
);

/**
 * Produce a structurally-identical copy of a ref with keys re-inserted in a
 * different order (and explicit `undefined`s sprinkled), to prove the derived
 * key is invariant to key order / absent-vs-undefined (the determinism that
 * makes the idempotency hold).
 */
function reorderRef(ref: TargetRef): TargetRef {
  const entries = Object.entries(ref).filter(([, v]) => v !== undefined);
  // Reverse insertion order, then re-add the optional keys as explicit undefined.
  const copy: Record<string, unknown> = {};
  for (const [k, v] of entries.reverse()) copy[k] = v;
  for (const k of ["country", "sourceRef", "companyName"]) {
    if (!(k in copy)) copy[k] = undefined;
  }
  return copy as TargetRef;
}

// ── Clause 1: search cache serves repeats without re-billing (Req 2.3) ───────────

describe("**Feature: prospecting-workspace, Property 10: Repeated identical ICP searches within the cache window serve cached results without re-billing; an enrichment_fetch with an existing jobKey produces at most one provider charge.**", () => {
  it("Validates: Requirements 2.3 — identical searches re-bill only when the cache window elapses", async () => {
    await fc.assert(
      fc.asyncProperty(
        filterArb,
        // The cache window (ms).
        fc.integer({ min: 1, max: 100_000 }),
        // A non-decreasing sequence of gaps (ms) between successive searches.
        fc.array(fc.integer({ min: 0, max: 200_000 }), {
          minLength: 1,
          maxLength: 12,
        }),
        async (filter, windowMs, gaps) => {
          const { transport, calls } = mockTransport(SEARCH_BODY);
          // A controllable clock; advanced explicitly per search event.
          let now = 1_000;
          const cache = new SearchCache<ProviderResult[]>(windowMs, () => now);
          const provider = new ApolloProvider(CONFIG, {
            transport,
            clock: FIXED_CLOCK,
            cache,
          });

          // Oracle mirroring SearchCache TTL semantics: a miss (re-bill) happens
          // on the first search and whenever `now - lastStoredAt > windowMs`;
          // each miss re-stamps `lastStoredAt` to the current clock.
          let expectedCalls = 0;
          let lastStoredAt: number | null = null;

          for (const gap of gaps) {
            now += gap;
            if (lastStoredAt === null || now - lastStoredAt > windowMs) {
              expectedCalls += 1;
              lastStoredAt = now;
            }
            // A structurally-identical filter copy (different object) must hit
            // the same cache slot — never a fresh bill on key-order grounds.
            const result = await provider.search({ ...filter });
            expect(isUnconfigured(result)).toBe(false);
          }

          // Equality (stronger than "at most once"): the transport billed
          // exactly when the window required, and served cache otherwise.
          expect(calls()).toBe(expectedCalls);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("Validates: Requirements 2.3 — many identical searches within one fresh window bill exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        filterArb,
        fc.integer({ min: 1, max: 50 }),
        async (filter, repeats) => {
          const { transport, calls } = mockTransport(SEARCH_BODY);
          // Fixed clock → window never elapses across the repeats.
          const cache = new SearchCache<ProviderResult[]>(60_000, () => 5_000);
          const provider = new ApolloProvider(CONFIG, {
            transport,
            clock: FIXED_CLOCK,
            cache,
          });

          for (let i = 0; i < repeats; i++) {
            await provider.search({ ...filter });
          }

          expect(calls()).toBe(1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // ── Clause 2: enrichment_fetch jobKey idempotency (Req 8.2 / CC-Idem) ──────────

  it("Validates: Requirements 8.2 — retries of an enrichment with an existing jobKey produce at most one provider charge", async () => {
    await fc.assert(
      fc.asyncProperty(
        refArb,
        // Number of retries of the SAME logical enrichment.
        fc.integer({ min: 1, max: 12 }),
        async (ref, retries) => {
          const { transport, calls } = mockTransport(ENRICH_BODY);
          const provider = new ApolloProvider(CONFIG, {
            transport,
            clock: FIXED_CLOCK,
          });

          // Minimal in-memory job runner modelling the spine's ON CONFLICT
          // (job_key) idempotency: a given jobKey runs provider.enrich at most
          // once; subsequent dispatches reconcile to the stored result.
          const done = new Map<string, ProviderEnrichment>();
          const dispatchEnrichment = async (target: TargetRef) => {
            const key = enrichmentJobKey(provider.id, target);
            expect(key.startsWith(`${ENRICHMENT_FETCH_JOB_KIND}:apollo:`)).toBe(
              true
            );
            const existing = done.get(key);
            if (existing) return existing;
            const result = await provider.enrich(target);
            if (isUnconfigured(result)) {
              throw new Error("configured provider must not be unconfigured");
            }
            done.set(key, result);
            return result;
          };

          // Dispatch the same logical enrichment `retries` times, each via a
          // structurally-identical (reordered) ref copy.
          for (let i = 0; i < retries; i++) {
            await dispatchEnrichment(reorderRef(ref));
          }

          // At most one provider charge for the shared jobKey — exactly one,
          // since the configured provider always reaches the transport once.
          expect(calls()).toBe(1);
          expect(done.size).toBe(1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("Validates: Requirements 8.2 — distinct refs derive distinct jobKeys and so bill independently", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 }),
        // How many times each distinct target is (redundantly) dispatched.
        fc.integer({ min: 1, max: 5 }),
        async (targetIds, retriesEach) => {
          const { transport, calls } = mockTransport(ENRICH_BODY);
          const provider = new ApolloProvider(CONFIG, {
            transport,
            clock: FIXED_CLOCK,
          });

          const done = new Map<string, ProviderEnrichment>();
          const dispatchEnrichment = async (target: TargetRef) => {
            const key = enrichmentJobKey(provider.id, target);
            if (done.has(key)) return done.get(key)!;
            const result = await provider.enrich(target);
            done.set(key, result as ProviderEnrichment);
            return result;
          };

          for (const targetId of targetIds) {
            for (let i = 0; i < retriesEach; i++) {
              await dispatchEnrichment({ targetId });
            }
          }

          // One charge per distinct target id, regardless of retry count.
          expect(calls()).toBe(targetIds.length);
          expect(done.size).toBe(targetIds.length);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
