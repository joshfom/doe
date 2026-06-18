/**
 * Property-based test for the pure page-identifier validator.
 *
 * Feature: live-page-editor, Property 9: Page-id format validation
 *
 * `isValidPageId` accepts a string if and only if it matches the expected
 * page-identifier format — a canonical UUID
 * (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
 * case-insensitive). The route maps every rejected (or missing) id to a
 * not-found response without invoking Page_Renderer.
 *
 * **Validates: Requirements 1.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { isValidPageId } from "@/lib/cms/live-editor/page-id";

// The canonical UUID shape the validator accepts (case-insensitive).
const PAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Generators ───────────────────────────────────────────────────────────────

const hexDigitArb = fc.constantFrom(..."0123456789abcdefABCDEF".split(""));

/** A run of `n` hex digits (mixed upper/lower case). */
function hexRun(n: number): fc.Arbitrary<string> {
  return fc.array(hexDigitArb, { minLength: n, maxLength: n }).map((cs) => cs.join(""));
}

/**
 * VALID set: well-formed canonical UUIDs. Combines fast-check's own RFC UUID
 * arbitrary (canonical-by-construction) with a hand-composed generator that
 * exercises arbitrary hex content and mixed casing, since the validator is
 * intentionally version/variant-agnostic.
 */
const validPageIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc
    .tuple(hexRun(8), hexRun(4), hexRun(4), hexRun(4), hexRun(12))
    .map((segs) => segs.join("-")),
);

const NON_HEX_CHARS = "ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ_/. ".split("");

/**
 * INVALID set: malformed or missing ids that must be rejected — empty strings,
 * slugs, arbitrary text, wrong segment lengths, non-hex characters, and
 * extra/missing dashes. Anything that happens to land on the canonical shape
 * is filtered out so the set is strictly invalid.
 */
const invalidPageIdArb: fc.Arbitrary<string> = fc
  .oneof(
    // Empty / whitespace
    fc.constant(""),
    fc.constant("   "),
    // Slugs and arbitrary prose-like ids
    fc.constantFrom(
      "home",
      "about-us",
      "blog/my-post",
      "../../etc/passwd",
      "page-123",
      "not-a-uuid",
      "12345",
    ),
    // Wrong segment lengths (7-4-4-4-12, 8-4-4-4-11, etc.)
    fc
      .tuple(hexRun(7), hexRun(4), hexRun(4), hexRun(4), hexRun(12))
      .map((s) => s.join("-")),
    fc
      .tuple(hexRun(8), hexRun(4), hexRun(4), hexRun(4), hexRun(11))
      .map((s) => s.join("-")),
    fc
      .tuple(hexRun(8), hexRun(4), hexRun(4), hexRun(4), hexRun(13))
      .map((s) => s.join("-")),
    // Missing dashes (one continuous 32-hex run)
    hexRun(32),
    // Extra dashes / extra segment
    fc
      .tuple(hexRun(8), hexRun(4), hexRun(4), hexRun(4), hexRun(6), hexRun(6))
      .map((s) => s.join("-")),
    // Non-hex character injected into an otherwise valid shape
    fc
      .tuple(
        hexRun(7),
        fc.constantFrom(...NON_HEX_CHARS),
        hexRun(4),
        hexRun(4),
        hexRun(4),
        hexRun(12),
      )
      .map(([a, bad, b, c, d, e]) => `${a}${bad}-${b}-${c}-${d}-${e}`),
    // Valid UUID with surrounding text (not fully anchored)
    fc.uuid().map((u) => ` ${u} `),
    fc.uuid().map((u) => `/ora-panel/live/${u}`),
    // Arbitrary strings (ascii + full-unicode code points)
    fc.string(),
    fc.string({ unit: "binary" }),
  )
  // Guard: ensure nothing in the "invalid" set is actually canonical.
  .filter((s) => !PAGE_ID_PATTERN.test(s));

// ── Property ─────────────────────────────────────────────────────────────────

describe("Feature: live-page-editor, Property 9: Page-id format validation", () => {
  it("accepts a string iff it matches the canonical page-id format", () => {
    fc.assert(
      fc.property(fc.oneof(validPageIdArb, invalidPageIdArb), (id) => {
        // The validator agrees with the canonical format exactly.
        expect(isValidPageId(id)).toBe(PAGE_ID_PATTERN.test(id));
      }),
      { numRuns: 100 },
    );
  });

  it("accepts every well-formed canonical UUID (valid set)", () => {
    fc.assert(
      fc.property(validPageIdArb, (id) => {
        expect(isValidPageId(id)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects every malformed or missing id (invalid set)", () => {
    fc.assert(
      fc.property(invalidPageIdArb, (id) => {
        expect(isValidPageId(id)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
