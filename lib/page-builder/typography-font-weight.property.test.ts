import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { typographyPropsToCSS } from "./typography-fields";

/**
 * **Validates: Requirements 4.2, 4.3**
 *
 * Property 3: Font weight is correctly applied
 *
 * For any valid font weight value from the set {100, 200, 300, 400, 500, 600,
 * 700, 800, 900, 950}, when passed as `fontWeight` in a props object to
 * `typographyPropsToCSS`, the returned CSSProperties SHALL contain `fontWeight`
 * equal to that numeric value.
 */
describe("Feature: branded-font-enforcement, Property 3: Font weight is correctly applied", () => {
  const validWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

  it("returned CSSProperties contains fontWeight matching the input for all valid weights", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validWeights),
        (weight) => {
          const result = typographyPropsToCSS({ fontWeight: String(weight) });
          expect(result.fontWeight).toBe(weight);
        }
      ),
      { numRuns: 100 }
    );
  });
});
