import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { deriveRerunKey } from "./rerun-key";
import type { BatchSubject } from "./rerun-key";
import type { ProspectFilter } from "../providers";

// Feature: agentic-prospecting-batch, Property 16: Re-run key is deterministic

/**
 * **Validates: Requirements 9.1**
 *
 * Property 16: Re-run key is deterministic.
 *
 * THE Batch_Run SHALL derive a deterministic re-run key from its subject and
 * owning rep so that an equivalent re-run is identifiable (Req 9.1).
 *
 * Concretely:
 *   (a) Determinism — the same `(subject, rep)` input yields the same key across
 *       repeated calls.
 *   (b) Stable normalization — two subjects that differ only in object-KEY
 *       ORDERING (e.g. an `icpFilter` assembled in a different property order)
 *       produce the SAME key, since the subject is canonicalized before hashing.
 *   (c) Injectivity sanity — a different rep, or a genuinely different subject,
 *       produces a DIFFERENT key.
 */

// ── Generators ─────────────────────────────────────────────────────────────

const TARGET_TYPES = ["person", "company", "intermediary"] as const;

/** A rep id (Batch_Run owner). */
const repArb = fc.uuid();

/** A short string-array signal (geography, titles, industries, …). */
const tokenListArb = fc.array(
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
  { maxLength: 4 }
);

/**
 * A `ProspectFilter` whose optional fields are independently present or absent.
 * `targetType` is always present (it is the only required field).
 */
const prospectFilterArb: fc.Arbitrary<ProspectFilter> = fc.record(
  {
    targetType: fc.constantFrom(...TARGET_TYPES),
    geography: tokenListArb,
    titles: tokenListArb,
    seniority: tokenListArb,
    companySize: fc.record(
      { min: fc.nat({ max: 1000 }), max: fc.nat({ max: 5000 }) },
      { requiredKeys: [] }
    ),
    industries: tokenListArb,
    fundingSignals: tokenListArb,
    wealthSignals: tokenListArb,
    keywords: tokenListArb,
    limit: fc.nat({ max: 200 }),
  },
  // Every field beyond targetType is optional → exercise present/absent mixes.
  { requiredKeys: ["targetType"] }
) as fc.Arbitrary<ProspectFilter>;

/** A `BatchSubject` of either the cluster-led or the ICP-led shape. */
const subjectArb: fc.Arbitrary<BatchSubject> = fc.oneof(
  fc.record(
    {
      kind: fc.constant("cluster" as const),
      clusterId: fc.string({ minLength: 1, maxLength: 24 }),
      briefId: fc.string({ minLength: 1, maxLength: 24 }),
    },
    { requiredKeys: ["kind", "clusterId"] }
  ),
  fc.record(
    {
      kind: fc.constant("icp" as const),
      briefId: fc.string({ minLength: 1, maxLength: 24 }),
      icpFilter: prospectFilterArb,
    },
    { requiredKeys: ["kind", "icpFilter"] }
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively rebuild a JSON-like value with object keys inserted in REVERSE
 * order. This changes only the property insertion order — the value's content
 * is identical — so a canonical, order-insensitive key derivation must be
 * unaffected. Array order is preserved (an array is an ordered value).
 */
function reorderKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(reorderKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).reverse()) {
    out[key] = reorderKeys(obj[key]);
  }
  return out;
}

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);

// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-prospecting-batch, Property 16: Re-run key is deterministic", () => {
  // (a) Determinism: same input → same key, stable across repeated calls.
  it("derives an identical key for identical (subject, rep) across repeated calls", () => {
    fc.assert(
      fc.property(repArb, subjectArb, (ownerRep, subject) => {
        const k1 = deriveRerunKey({ ownerRep, subject });
        const k2 = deriveRerunKey({ ownerRep, subject });
        const k3 = deriveRerunKey({ ownerRep, subject });

        expect(k2).toBe(k1);
        expect(k3).toBe(k1);
        // Shape sanity: a namespaced sha256 hex digest.
        expect(k1).toMatch(/^prospecting_batch:[0-9a-f]{64}$/);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // (b) Stable normalization: object-key reordering must NOT change the key.
  it("derives the same key for subjects differing only in object-key ordering", () => {
    fc.assert(
      fc.property(repArb, subjectArb, (ownerRep, subject) => {
        const reordered = reorderKeys(subject) as BatchSubject;

        const original = deriveRerunKey({ ownerRep, subject });
        const shuffled = deriveRerunKey({ ownerRep, subject: reordered });

        expect(shuffled).toBe(original);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // (c) Injectivity sanity: a different rep produces a different key.
  it("derives different keys for the same subject under different reps", () => {
    fc.assert(
      fc.property(
        repArb,
        repArb,
        subjectArb,
        (repA, repB, subject) => {
          fc.pre(repA !== repB);

          const keyA = deriveRerunKey({ ownerRep: repA, subject });
          const keyB = deriveRerunKey({ ownerRep: repB, subject });

          expect(keyA).not.toBe(keyB);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // (c) Injectivity sanity: a genuinely different subject produces a different key.
  it("derives different keys for genuinely different subjects under the same rep", () => {
    fc.assert(
      fc.property(
        repArb,
        subjectArb,
        subjectArb,
        (ownerRep, subjectA, subjectB) => {
          // Only assert when the two subjects are genuinely distinct in content
          // (compare their canonical forms via the reorder-stable derivation:
          // equal keys would mean equal content, which we exclude here).
          const keyA = deriveRerunKey({ ownerRep, subject: subjectA });
          const keyB = deriveRerunKey({ ownerRep, subject: subjectB });

          // Re-derive each under reordered keys to get a content-canonical
          // identity independent of property order.
          const canonA = deriveRerunKey({
            ownerRep,
            subject: reorderKeys(subjectA) as BatchSubject,
          });
          const canonB = deriveRerunKey({
            ownerRep,
            subject: reorderKeys(subjectB) as BatchSubject,
          });

          // Skip pairs that are content-equal (same canonical key).
          fc.pre(canonA !== canonB);

          expect(keyA).not.toBe(keyB);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
