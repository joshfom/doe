// Feature: custom-branded-page-builder, Property 1: Round-trip migration
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  migrateLegacyScalar,
  resolveBreakpointValue,
  type Breakpoint,
} from "./breakpoints";

/**
 * Feature: custom-branded-page-builder, Property 1: Round-trip migration
 *
 * **Validates: Requirements 14.1, 14.3, 21.1**
 *
 * For any legacy scalar `v` (a non-null, non-undefined primitive that was
 * previously stored as a flat field value), applying the lazy on-read
 * migration via `migrateLegacyScalar(v)` and then resolving the resulting
 * `BreakpointValue` at any breakpoint `bp ∈ {desktop, tablet, mobile}` SHALL
 * return a value equal to `v`.
 *
 * This makes the migration lossless: pages authored before the per-breakpoint
 * feature continue to render the same value on every breakpoint after upgrade
 * (Req 14.3), which is the foundation for byte-identical public HTML for
 * unchanged pages (Req 16.1).
 */

// --- Arbitraries ---

/**
 * Legacy scalar arbitrary: strings, numbers, or booleans.
 *
 * Excludes `null`/`undefined` because `migrateLegacyScalar` treats those as
 * "no baseline" and returns `{}`, which resolves to `undefined` on every
 * breakpoint. Excludes objects because the migration only wraps non-object
 * primitives — objects are either already `BreakpointValue` shapes or some
 * other nested structure outside the scope of this property.
 *
 * `fc.double`/`fc.float` would introduce `NaN`, which breaks
 * reflexive equality; use `fc.integer` and a finite-double filter instead
 * so `===` round-trips cleanly.
 */
const legacyScalarArb: fc.Arbitrary<string | number | boolean> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
);

const breakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
  "desktop",
  "tablet",
  "mobile",
);

// --- Property 1 ---

describe("Feature: custom-branded-page-builder, Property 1: Round-trip migration", () => {
  it("resolveBreakpointValue(migrateLegacyScalar(v), bp) equals v for every breakpoint", () => {
    fc.assert(
      fc.property(legacyScalarArb, breakpointArb, (v, bp) => {
        const migrated = migrateLegacyScalar<typeof v>(v);
        const resolved = resolveBreakpointValue<typeof v>(migrated, bp);
        expect(resolved).toStrictEqual(v);
      }),
      { numRuns: 20 },
    );
  });

  it("for any legacy scalar v, resolution agrees across all three breakpoints", () => {
    fc.assert(
      fc.property(legacyScalarArb, (v) => {
        const migrated = migrateLegacyScalar<typeof v>(v);
        const desktop = resolveBreakpointValue<typeof v>(migrated, "desktop");
        const tablet = resolveBreakpointValue<typeof v>(migrated, "tablet");
        const mobile = resolveBreakpointValue<typeof v>(migrated, "mobile");
        expect(desktop).toStrictEqual(v);
        expect(tablet).toStrictEqual(v);
        expect(mobile).toStrictEqual(v);
      }),
      { numRuns: 20 },
    );
  });
});
