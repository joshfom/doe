/**
 * Property tests for font size application and validation.
 *
 * Spec: branded-font-enforcement — task 2.5
 *
 * Property 4: Font size is correctly applied for valid values
 * For any numeric font size value in the range [8, 200], when passed as
 * `fontSize` in a props object to `typographyPropsToCSS`, the returned
 * CSSProperties SHALL contain a `fontSize` value representing that size in pixels.
 *
 * Property 5: Invalid font size values are rejected
 * For any font size input that is non-numeric or outside the range [8, 200],
 * `typographyPropsToCSS` SHALL not apply the invalid value (omits fontSize
 * from the returned CSSProperties).
 *
 * **Validates: Requirements 4.4, 4.5**
 *
 * Tag: Feature: branded-font-enforcement, Property 4: Font size is correctly applied for valid values
 * Tag: Feature: branded-font-enforcement, Property 5: Invalid font size values are rejected
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { typographyPropsToCSS } from "./typography-fields";

const ITERATIONS = { numRuns: 100 };

describe("Feature: branded-font-enforcement — Property 4: Font size is correctly applied for valid values", () => {
  it("produces correct pixel output for integer sizes in [8, 200]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 200 }),
        (size) => {
          const result = typographyPropsToCSS({ fontSize: String(size) });
          expect(result.fontSize).toBe(`${size}px`);
        },
      ),
      ITERATIONS,
    );
  });

  it("produces correct pixel output for decimal sizes in [8, 200]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 8, max: 200, noNaN: true, noDefaultInfinity: true }),
        (size) => {
          const result = typographyPropsToCSS({ fontSize: String(size) });
          expect(result.fontSize).toBe(`${size}px`);
        },
      ),
      ITERATIONS,
    );
  });

  it("does not throw for any valid size in [8, 200]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 200 }),
        (size) => {
          expect(() => typographyPropsToCSS({ fontSize: String(size) })).not.toThrow();
        },
      ),
      ITERATIONS,
    );
  });
});

describe("Feature: branded-font-enforcement — Property 5: Invalid font size values are rejected", () => {
  it("omits fontSize for out-of-range values below 8", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 7 }),
        (size) => {
          const result = typographyPropsToCSS({ fontSize: String(size) });
          expect(result.fontSize).toBeUndefined();
        },
      ),
      ITERATIONS,
    );
  });

  it("omits fontSize for out-of-range values above 200", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 201, max: 10000 }),
        (size) => {
          const result = typographyPropsToCSS({ fontSize: String(size) });
          expect(result.fontSize).toBeUndefined();
        },
      ),
      ITERATIONS,
    );
  });

  it("omits fontSize for non-numeric string inputs", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          // Filter to strings that are non-numeric (NaN when parsed)
          // and non-empty (empty strings are handled by the truthy check)
          return s.length > 0 && s !== "auto" && Number.isNaN(Number(s));
        }),
        (invalidSize) => {
          const result = typographyPropsToCSS({ fontSize: invalidSize });
          expect(result.fontSize).toBeUndefined();
        },
      ),
      ITERATIONS,
    );
  });

  it("does not throw for any invalid font size input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: 7 }).map(String),
          fc.integer({ min: 201, max: 10000 }).map(String),
          fc.string(),
          fc.constant(""),
          fc.constant("abc"),
          fc.constant("NaN"),
          fc.constant("Infinity"),
          fc.constant("-Infinity"),
        ),
        (invalidSize) => {
          expect(() => typographyPropsToCSS({ fontSize: invalidSize })).not.toThrow();
        },
      ),
      ITERATIONS,
    );
  });
});
