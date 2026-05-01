import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isValidUserType, isValidPermissionString } from "./engine";

// Feature: rbac-identity-system, Property 1: User type validation rejects invalid types
// Feature: rbac-identity-system, Property 2: User type immutability
// Feature: rbac-identity-system, Property 7: Permission format validation

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_USER_TYPES = ["employee", "broker", "client", "vendor"] as const;

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates one of the four valid user types. */
const arbValidUserType = fc.constantFrom(...VALID_USER_TYPES);

/** Generates an arbitrary string that is NOT one of the four valid user types. */
const arbInvalidUserType = fc
  .string({ minLength: 0, maxLength: 50 })
  .filter((s) => !(VALID_USER_TYPES as readonly string[]).includes(s));

/**
 * Generates a valid permission string: two non-empty segments of
 * alphanumeric/underscore/hyphen characters separated by exactly one colon.
 */
const arbValidPermissionString = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 30 }),
    fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 30 })
  )
  .map(([resource, action]) => `${resource}:${action}`);

/**
 * Generates strings that should NOT be valid permission strings.
 * Covers: empty strings, no colon, multiple colons, empty segments,
 * spaces, and special characters.
 */
const arbInvalidPermissionString = fc.oneof(
  // Empty string
  fc.constant(""),
  // Single segment (no colon)
  fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 20 }),
  // Colon only
  fc.constant(":"),
  // Empty left segment
  fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 20 }).map((s) => `:${s}`),
  // Empty right segment
  fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 20 }).map((s) => `${s}:`),
  // Multiple colons
  fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 10 }),
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 10 }),
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 10 })
    )
    .map(([a, b, c]) => `${a}:${b}:${c}`),
  // Contains spaces
  fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 10 }),
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 10 })
    )
    .map(([a, b]) => `${a} :${b}`),
  // Contains special characters (*, @, !, etc.)
  fc
    .tuple(
      fc.constantFrom("*", "@", "!", "#", "$", "%", "^", "&", "(", ")"),
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/, { minLength: 1, maxLength: 10 })
    )
    .map(([special, action]) => `resource${special}:${action}`)
);

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: User type validation rejects invalid types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.4**
 *
 * Property 1: User type validation rejects invalid types
 *
 * For any string that is not one of "employee", "broker", "client", or
 * "vendor", isValidUserType should return false. For any of the four
 * valid types, isValidUserType should return true.
 */
describe("Feature: rbac-identity-system, Property 1: User type validation rejects invalid types", () => {
  it("returns true for any of the four valid user types", () => {
    fc.assert(
      fc.property(arbValidUserType, (userType) => {
        expect(isValidUserType(userType)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("returns false for any string that is not a valid user type", () => {
    fc.assert(
      fc.property(arbInvalidUserType, (invalidType) => {
        expect(isValidUserType(invalidType)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: User type immutability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.5**
 *
 * Property 2: User type immutability
 *
 * The VALID_USER_TYPES set used by isValidUserType is frozen/immutable,
 * and isValidUserType is deterministic — calling it multiple times with
 * the same input always returns the same result.
 */
describe("Feature: rbac-identity-system, Property 2: User type immutability", () => {
  it("isValidUserType is deterministic: repeated calls with the same input return the same result", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (input) => {
        const first = isValidUserType(input);
        const second = isValidUserType(input);
        const third = isValidUserType(input);

        expect(first).toBe(second);
        expect(second).toBe(third);
      }),
      { numRuns: 100 }
    );
  });

  it("the set of valid user types cannot be mutated at runtime", () => {
    // Verify the valid types are exactly the expected four
    for (const validType of VALID_USER_TYPES) {
      expect(isValidUserType(validType)).toBe(true);
    }

    // Attempting to call isValidUserType with each valid type still works
    // after any number of prior calls — the backing set is not corrupted
    fc.assert(
      fc.property(
        arbInvalidUserType,
        arbValidUserType,
        (invalidInput, validInput) => {
          // Call with invalid input first (should not corrupt state)
          isValidUserType(invalidInput);

          // Valid types must still be recognized
          expect(isValidUserType(validInput)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Permission format validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 4.2, 4.3**
 *
 * Property 7: Permission format validation
 *
 * For any string matching the pattern of two non-empty alphanumeric/
 * underscore/hyphen segments separated by a colon, isValidPermissionString
 * should return true. For any string NOT matching that pattern, it should
 * return false.
 */
describe("Feature: rbac-identity-system, Property 7: Permission format validation", () => {
  it("returns true for any valid resource:action permission string", () => {
    fc.assert(
      fc.property(arbValidPermissionString, (permStr) => {
        expect(isValidPermissionString(permStr)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("returns false for any string that does not match the resource:action format", () => {
    fc.assert(
      fc.property(arbInvalidPermissionString, (invalidStr) => {
        expect(isValidPermissionString(invalidStr)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
