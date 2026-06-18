import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { sanitizeMemory } from "./memory";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";

/**
 * **Feature: agentic-foundation, Property 19: For any candidate memory value containing a phone number, the persisted value contains no raw phone number and stores the salted hash in its place.**
 *
 * **Validates: Requirements 4.7**
 *
 * `sanitizeMemory` (Design §Components #3, "Phone privacy", CC-Privacy) is the
 * pre-write hook that recursively scrubs a candidate memory value before it is
 * persisted: every plausible phone number is replaced, in place, by its salted
 * SHA-256 hash (reusing the voice surface's `computePhoneHash`), so neither
 * working memory nor recalled messages ever store a raw number (Requirement
 * 4.7).
 *
 * We generate candidate E.164 numbers (a `+` followed by 8..15 digits, the
 * plausibility window `normalizePhoneToE164` accepts) and embed each into a
 * nested memory value — inside free text, as a bare field value, and inside an
 * array — alongside digit-free surrounding text so the only raw phone material
 * in the structure is the generated number(s). A random non-empty salt is
 * generated per run to exercise the *salted* guarantee. We then assert that the
 * sanitized clone:
 *   (a) contains no raw phone number anywhere (the canonical `+digits` string
 *       is absent from every string in the serialized output), and
 *   (b) stores the salted hash in its place (each occurrence is replaced by
 *       exactly `computePhoneHash(e164, salt)`), and
 *   (c) leaves the original input untouched (the hook is pure).
 */

// A candidate phone number: "+" followed by 8..15 digits — the E.164
// plausibility window normalizePhoneToE164 accepts. Surrounding text is kept
// digit-free so the generated number is the only raw phone material present.
const e164Arb: fc.Arbitrary<string> = fc
  .integer({ min: 8, max: 15 })
  .chain((len) =>
    fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: len, maxLength: len })
      .map((ds) => `+${ds.join("")}`),
  );

// A non-empty salt makes the stored hash a *salted* hash.
const saltArb = fc.string({ minLength: 1, maxLength: 32 });

describe("sanitizeMemory — phones stored only as a salted hash (Property 19)", () => {
  it("replaces every raw phone in a candidate memory value with its salted hash", () => {
    fc.assert(
      fc.property(e164Arb, saltArb, (phone, salt) => {
        // The number sanitizeMemory will key the hash on (idempotent here, since
        // `phone` is already canonical E.164) and the expected salted hash.
        const e164 = normalizePhoneToE164(phone);
        const expectedHash = computePhoneHash(e164, salt);

        // A candidate memory value carrying the phone in several shapes. The
        // surrounding prose is intentionally digit-free.
        const candidate = {
          entityKind: "lead",
          note: `Reach the caller at ${phone} as soon as possible.`,
          phone: phone,
          history: [`first call ${phone}`, "no answer", { last: phone }],
          writtenBy: "agent:text-lead",
        };
        const before = JSON.stringify(candidate);

        const sanitized = sanitizeMemory(candidate, salt) as typeof candidate;
        const serialized = JSON.stringify(sanitized);

        // (a) No raw phone number survives anywhere in the persisted value.
        expect(serialized).not.toContain(phone);

        // (b) The salted hash is stored in its place — at every occurrence.
        expect(sanitized.note).toBe(
          `Reach the caller at ${expectedHash} as soon as possible.`,
        );
        expect(sanitized.phone).toBe(expectedHash);
        expect(sanitized.history[0]).toBe(`first call ${expectedHash}`);
        expect(sanitized.history[1]).toBe("no answer");
        expect((sanitized.history[2] as { last: string }).last).toBe(expectedHash);
        expect(serialized).toContain(expectedHash);

        // (c) The hook is pure — the original input is untouched.
        expect(JSON.stringify(candidate)).toBe(before);
      }),
      { numRuns: 200 },
    );
  });
});
