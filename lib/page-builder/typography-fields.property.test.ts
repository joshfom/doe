import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { typographyPropsToCSS } from "./typography-fields";

/**
 * Feature: branded-font-enforcement, Property 1: typographyPropsToCSS never emits fontFamily
 *
 * Validates: Requirements 3.1, 7.2, 7.3, 7.4
 *
 * For any props object containing a `fontFamily` key with any value (including
 * null, undefined, empty string, "inherit", named fonts, CSS variable
 * expressions, numbers, objects, or any arbitrary value), `typographyPropsToCSS`
 * SHALL return a CSSProperties object that does not contain a `fontFamily`
 * property, and SHALL not throw an error.
 */

// --- Arbitraries ---

/** Generates arbitrary fontFamily values covering all edge cases */
const fontFamilyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  // Strings: arbitrary, empty, inherit, CSS variables, named fonts
  fc.string(),
  fc.constant(""),
  fc.constant("inherit"),
  fc.constant("var(--font-poppins), Poppins, sans-serif"),
  fc.constant("var(--font-urw-geometric), system-ui, sans-serif"),
  fc.constant("Georgia, serif"),
  fc.constant("Times New Roman, serif"),
  fc.constant("Arial, sans-serif"),
  fc.constant("system-ui, sans-serif"),
  // Null and undefined
  fc.constant(null),
  fc.constant(undefined),
  // Numbers
  fc.integer(),
  fc.double(),
  // Objects and arrays
  fc.object(),
  fc.array(fc.string(), { maxLength: 3 }),
);

/** Generates a props object that always includes a fontFamily key with an arbitrary value */
const propsWithFontFamilyArb = fontFamilyValueArb.map((fontFamily) => ({
  fontFamily,
  // Include some valid typography props to ensure the function processes them
  fontWeight: "400",
  fontSize: "16",
}));

/**
 * Extended version: generates a full props object with arbitrary extra keys
 * alongside fontFamily to ensure no interaction effects.
 */
const fullPropsWithFontFamilyArb = fc
  .record({
    fontFamily: fontFamilyValueArb,
    fontWeight: fc.oneof(
      fc.constant("400"),
      fc.constant("700"),
      fc.constant("900"),
      fc.constant(undefined),
    ),
    fontSize: fc.oneof(
      fc.constant("16"),
      fc.constant("32"),
      fc.constant("auto"),
      fc.constant(undefined),
    ),
    textAlign: fc.oneof(
      fc.constant("left"),
      fc.constant("center"),
      fc.constant(undefined),
    ),
  })
  .map((rec) => {
    // Remove undefined keys to simulate sparse props objects
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rec)) {
      if (value !== undefined) result[key] = value;
    }
    // Always include fontFamily (even if undefined) to test the key presence
    result.fontFamily = rec.fontFamily;
    return result;
  });

// --- Property Test ---

describe("typographyPropsToCSS never emits fontFamily", () => {
  it("returned CSSProperties has no fontFamily key for any fontFamily input value", () => {
    fc.assert(
      fc.property(propsWithFontFamilyArb, (props) => {
        const css = typographyPropsToCSS(props);
        expect(css).not.toHaveProperty("fontFamily");
      }),
      { numRuns: 100 },
    );
  });

  it("does not throw for any fontFamily value in a full props object", () => {
    fc.assert(
      fc.property(fullPropsWithFontFamilyArb, (props) => {
        expect(() => typographyPropsToCSS(props)).not.toThrow();
        const css = typographyPropsToCSS(props);
        expect(css).not.toHaveProperty("fontFamily");
      }),
      { numRuns: 100 },
    );
  });
});
