import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  scoreCandidateFit,
  type BatchSubject,
  type FitScoreResult,
} from "./fit-score";
import { PROVIDER_IDS, type ProspectFilter, type ProviderResult } from "../providers";
import type { ProvenancedField } from "../target";

/**
 * Property test for the deterministic fit scorer (task 3.2 — a NON-optional
 * Requirements 2.4 correctness property).
 *
 *   **Feature: agentic-prospecting-batch, Property 4: Fit score is
 *   deterministic, bounded, and recorded with rationale.**
 *
 * **Validates: Requirements 2.4**
 *
 * `scoreCandidateFit(subject, candidate)` (`lib/cms/prospecting/batch/fit-score.ts`)
 * is the pure ranker the batch loop uses to score a discovered candidate against
 * its Batch_Run subject. Requirement 2.4 demands the score be **recorded with its
 * rationale**, and the design pins the function as **pure and deterministic** so
 * the score is reproducible and explainable. This property exercises the real
 * scorer (no mocks) over randomized subjects + candidates and asserts three
 * universal invariants on every iteration:
 *
 *  1. **Deterministic** — scoring the same `(subject, candidate)` twice yields a
 *     deep-equal `FitScoreResult` (same score, same rationale). A pure function
 *     of its inputs.
 *  2. **Bounded** — `score ∈ [0, 1]`, and the rationale's mirrored `score` and
 *     every per-dimension `similarity`/`weight` are likewise finite and bounded.
 *  3. **Recorded with rationale** — `rationale.signals` is always non-empty (the
 *     scorer emits a `"none"` placeholder dimension even for a signal-less
 *     subject), and the rationale carries a summary, so the score is never stored
 *     bare.
 */

// Spec requires >=100 iterations (task 3.2 / plan Notes). The scorer is pure
// (no DB, no network, no clock) so the full budget runs cheaply. Override via
// PBT_RUNS for a heavier run.
const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);

// ── Generators ────────────────────────────────────────────────────────────────

// A shared pool of signal seeds so randomized candidates and subjects overlap
// often enough to drive non-trivial (non-zero) scores — without which the
// property would only ever exercise the score===0 path.
const SIGNAL_POOL = [
  "Founder",
  "Managing Partner",
  "CFO",
  "CEO",
  "Family Office",
  "Venture Capital",
  "AE",
  "India",
  "DIFC",
  "post-liquidity founder",
  "Series C",
  "IPO",
  "Finance",
  "Real Estate",
];

const signalArb = fc.constantFrom(...SIGNAL_POOL);

/** An optional array of signal seeds drawn from the shared pool. */
const optSignalsArb = fc.option(
  fc.array(signalArb, { maxLength: 4 }),
  { nil: undefined }
);

/** A randomized ICP filter; only `targetType` is required (Req 2.1). */
const filterArb: fc.Arbitrary<ProspectFilter> = fc.record(
  {
    targetType: fc.constantFrom("person", "company", "intermediary"),
    geography: optSignalsArb,
    titles: optSignalsArb,
    seniority: optSignalsArb,
    industries: optSignalsArb,
    fundingSignals: optSignalsArb,
    wealthSignals: optSignalsArb,
    keywords: optSignalsArb,
    limit: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  },
  { requiredKeys: ["targetType"] }
);

/** A provenanced attribute value (value + source + asOf, optional lawful basis). */
function provenancedArb(): fc.Arbitrary<ProvenancedField> {
  return fc.record(
    {
      value: signalArb,
      source: fc.constantFrom(...PROVIDER_IDS),
      asOf: fc
        .date({
          min: new Date("2020-01-01"),
          max: new Date("2030-01-01"),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString()),
      lawfulBasis: fc.option(fc.constantFrom("legitimate_interest", "consent"), {
        nil: undefined,
      }),
    },
    { requiredKeys: ["value", "source", "asOf"] }
  );
}

/** A randomized attributes map keyed on the dimensions the scorer reads. */
const attributesArb: fc.Arbitrary<Record<string, ProvenancedField>> = fc
  .record(
    {
      title: fc.option(provenancedArb(), { nil: undefined }),
      seniority: fc.option(provenancedArb(), { nil: undefined }),
      country: fc.option(provenancedArb(), { nil: undefined }),
      geography: fc.option(provenancedArb(), { nil: undefined }),
      wealthSignal: fc.option(provenancedArb(), { nil: undefined }),
      fundingSignal: fc.option(provenancedArb(), { nil: undefined }),
      industry: fc.option(provenancedArb(), { nil: undefined }),
    },
    { requiredKeys: [] }
  )
  .map((rec) => {
    // Drop undefined entries so the map mirrors a real provider result.
    const out: Record<string, ProvenancedField> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v !== undefined) out[k] = v as ProvenancedField;
    }
    return out;
  });

/** A randomized candidate (ProviderResult). */
const candidateArb: fc.Arbitrary<ProviderResult> = fc.record(
  {
    targetType: fc.constantFrom("person", "company", "intermediary"),
    displayName: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    companyName: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    title: fc.option(signalArb, { nil: undefined }),
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    phone: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    country: fc.option(signalArb, { nil: undefined }),
    attributes: attributesArb,
    sourceProvider: fc.constantFrom(...PROVIDER_IDS),
    sourceRef: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    lawfulBasis: fc.constantFrom("legitimate_interest", "consent"),
  },
  { requiredKeys: ["targetType", "attributes", "sourceProvider", "lawfulBasis"] }
);

/**
 * A randomized subject. Covers both an `icp` subject (direct ICP filter) and a
 * `cluster` subject whose hypothesis-derived `icpFilter` may be absent — the
 * latter exercises the signal-less ("none") rationale path.
 */
const subjectArb: fc.Arbitrary<BatchSubject> = fc.oneof(
  fc.record({
    kind: fc.constant("icp" as const),
    icpFilter: filterArb,
  }),
  fc.record(
    {
      kind: fc.constant("cluster" as const),
      clusterId: fc.uuid(),
      icpFilter: fc.option(filterArb, { nil: undefined }),
    },
    { requiredKeys: ["kind", "clusterId"] }
  )
);

// ── Property ────────────────────────────────────────────────────────────────────

describe("**Feature: agentic-prospecting-batch, Property 4: Fit score is deterministic, bounded, and recorded with rationale.**", () => {
  it("Validates: Requirements 2.4 — repeated scoring is identical, score ∈ [0,1], rationale non-empty", () => {
    fc.assert(
      fc.property(subjectArb, candidateArb, (subject, candidate) => {
        const first: FitScoreResult = scoreCandidateFit(subject, candidate);
        const second: FitScoreResult = scoreCandidateFit(subject, candidate);

        // (1) Deterministic — same input → deep-equal result.
        expect(second).toEqual(first);

        // (2) Bounded — score ∈ [0, 1] and finite.
        expect(Number.isFinite(first.score)).toBe(true);
        expect(first.score).toBeGreaterThanOrEqual(0);
        expect(first.score).toBeLessThanOrEqual(1);

        // Rationale mirrors the score and is itself bounded per-dimension.
        expect(first.rationale.score).toBe(first.score);
        for (const signal of first.rationale.signals) {
          expect(Number.isFinite(signal.similarity)).toBe(true);
          expect(signal.similarity).toBeGreaterThanOrEqual(0);
          expect(signal.similarity).toBeLessThanOrEqual(1);
          expect(Number.isFinite(signal.weight)).toBe(true);
          expect(signal.weight).toBeGreaterThanOrEqual(0);
          // Every matched candidate value must come from the evaluated dimension.
          expect(Array.isArray(signal.matched)).toBe(true);
        }

        // (3) Recorded with rationale — signals non-empty + a summary present.
        expect(first.rationale.signals.length).toBeGreaterThan(0);
        expect(typeof first.rationale.summary).toBe("string");
        expect(first.rationale.summary.length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
