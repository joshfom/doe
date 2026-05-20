// Feature: custom-branded-page-builder, Property 2: Value resolution fallback
// Feature: custom-branded-page-builder, Property 7: Slot clear semantics
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  clearSlot,
  resolveBreakpointValue,
  type Breakpoint,
  type BreakpointValue,
} from "./breakpoints";

/**
 * Feature: custom-branded-page-builder, Property 2: Value resolution fallback
 *
 * **Validates: Requirements 15.4, 15.5, 21.2**
 *
 * For any `BreakpointValue<T>` `b` with an arbitrary subset of
 * `{desktop, tablet, mobile}` populated, `resolveBreakpointValue` obeys the
 * fall-through rule:
 *
 * - `resolveBreakpointValue(b, "mobile")`  equals `b.mobile  ?? b.tablet ?? b.desktop`
 * - `resolveBreakpointValue(b, "tablet")`  equals `b.tablet  ?? b.desktop`
 * - `resolveBreakpointValue(b, "desktop")` equals `b.desktop`
 *
 * The test is parametrised twice: once over strings (the dominant value type
 * for CSS-like dimensions such as `"24px"`) and once over numbers, to catch
 * any accidental string-specific behaviour in the resolver.
 *
 * Note: task 1.6 extends this file with Property 7 (slot clear semantics).
 * Keep additions additive — do not restructure the `describe` blocks below.
 */

// --- Arbitraries ---

/**
 * Generate a `BreakpointValue<T>` with an arbitrary subset of slots
 * populated. `requiredKeys: []` on `fc.record` lets fast-check drop
 * individual keys, and `fc.option(..., { nil: undefined })` lets an
 * individual slot be explicitly `undefined` — both shapes are valid and
 * the resolver must treat an absent key and an explicit `undefined` the
 * same way.
 */
function breakpointValueArb<T>(
  slotArb: fc.Arbitrary<T>,
): fc.Arbitrary<BreakpointValue<T>> {
  return fc.record(
    {
      desktop: fc.option(slotArb, { nil: undefined }),
      tablet: fc.option(slotArb, { nil: undefined }),
      mobile: fc.option(slotArb, { nil: undefined }),
    },
    { requiredKeys: [] },
  ) as fc.Arbitrary<BreakpointValue<T>>;
}

// --- Property 2: parametrised over strings ---

describe("Feature: custom-branded-page-builder, Property 2: Value resolution fallback (strings)", () => {
  it("resolveBreakpointValue(b, 'mobile') equals b.mobile ?? b.tablet ?? b.desktop", () => {
    fc.assert(
      fc.property(breakpointValueArb(fc.string()), (b) => {
        const resolved = resolveBreakpointValue<string>(b, "mobile");
        const expected = b.mobile ?? b.tablet ?? b.desktop;
        expect(resolved).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("resolveBreakpointValue(b, 'tablet') equals b.tablet ?? b.desktop", () => {
    fc.assert(
      fc.property(breakpointValueArb(fc.string()), (b) => {
        const resolved = resolveBreakpointValue<string>(b, "tablet");
        const expected = b.tablet ?? b.desktop;
        expect(resolved).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("resolveBreakpointValue(b, 'desktop') equals b.desktop", () => {
    fc.assert(
      fc.property(breakpointValueArb(fc.string()), (b) => {
        const resolved = resolveBreakpointValue<string>(b, "desktop");
        expect(resolved).toStrictEqual(b.desktop);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2: parametrised over numbers (guards against string-specific behaviour) ---

describe("Feature: custom-branded-page-builder, Property 2: Value resolution fallback (numbers)", () => {
  // `noNaN` + `noDefaultInfinity` because `NaN` is not reflexively equal to
  // itself under `toStrictEqual`, which would mask real divergences.
  const numberSlotArb = fc.double({ noNaN: true, noDefaultInfinity: true });

  it("resolveBreakpointValue(b, 'mobile') equals b.mobile ?? b.tablet ?? b.desktop", () => {
    fc.assert(
      fc.property(breakpointValueArb(numberSlotArb), (b) => {
        const resolved = resolveBreakpointValue<number>(b, "mobile");
        const expected = b.mobile ?? b.tablet ?? b.desktop;
        expect(resolved).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("resolveBreakpointValue(b, 'tablet') equals b.tablet ?? b.desktop", () => {
    fc.assert(
      fc.property(breakpointValueArb(numberSlotArb), (b) => {
        const resolved = resolveBreakpointValue<number>(b, "tablet");
        const expected = b.tablet ?? b.desktop;
        expect(resolved).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("resolveBreakpointValue(b, 'desktop') equals b.desktop", () => {
    fc.assert(
      fc.property(breakpointValueArb(numberSlotArb), (b) => {
        const resolved = resolveBreakpointValue<number>(b, "desktop");
        expect(resolved).toStrictEqual(b.desktop);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: custom-branded-page-builder, Property 7: Slot clear semantics
 *
 * **Validates: Requirements 11.4**
 *
 * `clearSlot(value, bp)` returns a `BreakpointValue<T>` in which the key
 * `bp` is omitted entirely — not stored as `null`, not stored as
 * `undefined`. This is the "clear this breakpoint" semantic surfaced by
 * the Configuration Panel: when a user removes the value for a slot, the
 * storage object must not retain a residual sentinel that would (a) defeat
 * the nullish-coalescing fallback used by `resolveBreakpointValue`, or
 * (b) survive JSON serialization to the `pages.data` column.
 *
 * Properties covered for every slot `bp ∈ {desktop, tablet, mobile}`:
 *
 *   1. `hasOwnProperty(bp)` is `false` on the returned object.
 *   2. `Object.keys(result)` does not include `bp`.
 *   3. Slots other than `bp` are preserved verbatim (same value, same
 *      own-property presence) — clearing one slot does not leak across
 *      into siblings.
 *   4. The input object is not mutated — `clearSlot` returns a fresh
 *      shallow copy, so callers relying on referential inequality for
 *      change detection remain correct.
 *   5. JSON round-trip of the cleared result does not reintroduce the
 *      cleared key — this guards against any future `toJSON` override or
 *      serializer quirk that might emit `"bp":null`.
 *
 * The test is parametrised over strings (the dominant value type for
 * CSS-like dimensions such as `"24px"`) since the helper is type-agnostic
 * and Property 2 already covers the numeric case for the resolver.
 */

// --- Arbitrary scoped to Property 7 ---

const breakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
  "desktop",
  "tablet",
  "mobile",
);

/**
 * Generate a `BreakpointValue<string>` where each slot may be present or
 * absent. We use `fc.string()` for slot values and let fast-check drop
 * individual keys via `requiredKeys: []`.
 *
 * Unlike the Property 2 arbitrary, slots here are never explicitly
 * `undefined`: Property 7 is about the presence of the *key*, and an
 * explicit `undefined` would be indistinguishable from an already-cleared
 * slot, masking the behaviour under test.
 */
function populatedBreakpointValueArb(): fc.Arbitrary<BreakpointValue<string>> {
  return fc.record(
    {
      desktop: fc.string(),
      tablet: fc.string(),
      mobile: fc.string(),
    },
    { requiredKeys: [] },
  ) as fc.Arbitrary<BreakpointValue<string>>;
}

// --- Property 7 ---

describe("Feature: custom-branded-page-builder, Property 7: Slot clear semantics", () => {
  it("clearSlot(value, bp) omits key bp entirely — no null, no undefined", () => {
    fc.assert(
      fc.property(
        populatedBreakpointValueArb(),
        breakpointArb,
        (value, bp) => {
          const cleared = clearSlot(value, bp);

          // The cleared slot must not appear as an own property under any
          // disguise: not `null`, not `undefined`, not an enumerable key.
          expect(
            Object.prototype.hasOwnProperty.call(cleared, bp),
          ).toBe(false);
          expect(Object.keys(cleared)).not.toContain(bp);
          expect(bp in cleared).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clearSlot preserves sibling slots verbatim", () => {
    fc.assert(
      fc.property(
        populatedBreakpointValueArb(),
        breakpointArb,
        (value, bp) => {
          const cleared = clearSlot(value, bp);

          for (const other of ["desktop", "tablet", "mobile"] as const) {
            if (other === bp) continue;
            const hadOther = Object.prototype.hasOwnProperty.call(
              value,
              other,
            );
            const keepsOther = Object.prototype.hasOwnProperty.call(
              cleared,
              other,
            );
            expect(keepsOther).toBe(hadOther);
            if (hadOther) {
              expect(cleared[other]).toStrictEqual(value[other]);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clearSlot does not mutate its input", () => {
    fc.assert(
      fc.property(
        populatedBreakpointValueArb(),
        breakpointArb,
        (value, bp) => {
          // Snapshot the own-property set and values before the call.
          const snapshotKeys = Object.keys(value).sort();
          const snapshotPairs = snapshotKeys.map(
            (k) => [k, (value as Record<string, string>)[k]] as const,
          );

          clearSlot(value, bp);

          expect(Object.keys(value).sort()).toStrictEqual(snapshotKeys);
          for (const [k, v] of snapshotPairs) {
            expect((value as Record<string, string>)[k]).toStrictEqual(v);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("JSON round-trip of clearSlot output does not reintroduce the cleared key", () => {
    fc.assert(
      fc.property(
        populatedBreakpointValueArb(),
        breakpointArb,
        (value, bp) => {
          const cleared = clearSlot(value, bp);
          const roundTripped = JSON.parse(
            JSON.stringify(cleared),
          ) as BreakpointValue<string>;

          expect(
            Object.prototype.hasOwnProperty.call(roundTripped, bp),
          ).toBe(false);
          expect(Object.keys(roundTripped)).not.toContain(bp);
        },
      ),
      { numRuns: 100 },
    );
  });
});
