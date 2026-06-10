/**
 * Property tests for visibility resolution.
 *
 * Spec: custom-branded-page-builder — tasks 11.5, 12.5
 * Property 8: Default visibility — for any block without `_visibility`,
 * `resolveVisibility` yields `{ desktop: true, tablet: true, mobile: true }`.
 * _Validates: Requirements 13.2, 13.3, 16.4, 21.3_
 *
 * Tag: Feature: custom-branded-page-builder, Property 8: Default visibility
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_VISIBILITY,
  hasNonDefaultVisibility,
  resolveVisibility,
} from "./visibility";
import { renderBreakpointCSS } from "./render-breakpoint-css";
import { BREAKPOINTS } from "./breakpoints";
import type { PageData } from "./types";

const ITERATIONS = { numRuns: 200 };

describe("Feature: custom-branded-page-builder — Property 8: Default visibility", () => {
  it("resolves to fully visible for null/undefined/missing values", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.string(),
          fc.integer(),
          fc.boolean(),
        ),
        (raw) => {
          // Anything that is not a partial VisibilityFlags object resolves
          // to the fully-visible defaults.
          if (raw === null || raw === undefined || typeof raw !== "object") {
            expect(resolveVisibility(raw)).toEqual(DEFAULT_VISIBILITY);
          }
        },
      ),
      ITERATIONS,
    );
  });

  it("treats every missing key as `true`", () => {
    const flagArb = fc.option(fc.boolean(), { nil: undefined });
    fc.assert(
      fc.property(
        fc.record(
          { desktop: flagArb, tablet: flagArb, mobile: flagArb },
          { requiredKeys: [] },
        ),
        (raw) => {
          const r = resolveVisibility(raw);
          expect(r.desktop).toBe(typeof raw.desktop === "boolean" ? raw.desktop : true);
          expect(r.tablet).toBe(typeof raw.tablet === "boolean" ? raw.tablet : true);
          expect(r.mobile).toBe(typeof raw.mobile === "boolean" ? raw.mobile : true);
        },
      ),
      ITERATIONS,
    );
  });

  it("hasNonDefaultVisibility is true iff any flag is explicitly false", () => {
    const flagArb = fc.option(fc.boolean(), { nil: undefined });
    fc.assert(
      fc.property(
        fc.record(
          { desktop: flagArb, tablet: flagArb, mobile: flagArb },
          { requiredKeys: [] },
        ),
        (raw) => {
          const expected =
            raw.desktop === false || raw.tablet === false || raw.mobile === false;
          expect(hasNonDefaultVisibility(raw)).toBe(expected);
        },
      ),
      ITERATIONS,
    );
  });
});

/**
 * Property 3: Visibility emits exactly one block + display:none per hidden tier.
 *
 * Spec: custom-branded-page-builder — task 12.5
 * _Validates: Requirements 13.3, 16.4, 21.3_
 *
 * For a single-block PageData with a `_visibility` flag, the per-breakpoint
 * CSS contains exactly one `display: none;` declaration scoped to that
 * block's class for every breakpoint where the flag is `false`, and zero
 * for every breakpoint where the flag is `true`. The block itself is
 * present in the data exactly once (HTML emission is intrinsic to
 * `PageRenderer` walking each block once).
 *
 * Tag: Feature: custom-branded-page-builder, Property 3: Visibility single emission
 */
describe("Feature: custom-branded-page-builder — Property 3: Visibility single emission", () => {
  const flagsArb = fc.record(
    {
      desktop: fc.boolean(),
      tablet: fc.boolean(),
      mobile: fc.boolean(),
    },
    { requiredKeys: [] },
  );

  it("emits display:none in exactly the @media tiers where the flag is false", () => {
    fc.assert(
      fc.property(fc.uuid(), flagsArb, (id, flags) => {
        const data: PageData = {
          root: { props: { title: "t" } },
          content: [
            {
              type: "Hero",
              props: { id, _visibility: flags },
            },
          ],
        };

        const css = renderBreakpointCSS(data);
        const resolved = resolveVisibility(flags);

        const tiers = [
          {
            bp: "desktop" as const,
            mq: `@media (min-width: ${BREAKPOINTS.desktop.min}px)`,
          },
          {
            bp: "tablet" as const,
            mq: `@media (min-width: ${BREAKPOINTS.tablet.min}px) and (max-width: ${BREAKPOINTS.tablet.max}px)`,
          },
          {
            bp: "mobile" as const,
            mq: `@media (max-width: ${BREAKPOINTS.mobile.max}px)`,
          },
        ];

        for (const { bp, mq } of tiers) {
          const ruleHead = `${mq} { .pb-block-${id} {`;
          if (!resolved[bp]) {
            // exactly one rule for this breakpoint, containing display:none
            const idx = css.indexOf(ruleHead);
            expect(idx, `expected ${bp} rule to be emitted`).toBeGreaterThanOrEqual(0);
            const after = css.slice(idx);
            expect(after).toContain("display: none;");
            // and only one occurrence of the rule head
            expect(css.split(ruleHead).length - 1).toBe(1);
          } else if (!hasNonDefaultVisibility(flags)) {
            // No flag is false → no CSS emitted at all for this block
            expect(css).toBe("");
          } else {
            // This tier is visible but another tier is hidden → the rule
            // for *this* tier must NOT contain display:none.
            const idx = css.indexOf(ruleHead);
            // Either the tier rule is absent (visible & nothing else to
            // emit) or, if present for some other reason, it must not
            // include display:none.
            if (idx >= 0) {
              const next = css.indexOf("} }", idx);
              const segment = css.slice(idx, next);
              expect(segment).not.toContain("display: none;");
            }
          }
        }
      }),
      ITERATIONS,
    );
  });
});
