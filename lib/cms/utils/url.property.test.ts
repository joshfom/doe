import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolvePageUrl } from "./url";

/**
 * Feature: ora-cms-platform, Property 14: URL resolution with default language
 *
 * EN pages resolve at `/{slug}`, AR pages at `/ar/{slug}`,
 * root `/` resolves to EN home, `/ar/` to AR home.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.8**
 */
describe("Property 14: URL resolution with default language", () => {
  const nonRootSlugArb = fc
    .stringMatching(/^[a-z0-9][a-z0-9\-\/]*$/)
    .filter((s) => s.length > 0 && s.length <= 100 && s !== "/");

  it("EN pages with non-root slug resolve at /{slug}", () => {
    fc.assert(
      fc.property(nonRootSlugArb, (slug) => {
        const url = resolvePageUrl("en", slug);
        expect(url).toBe(`/${slug}`);
        // Must NOT have /ar/ prefix
        expect(url.startsWith("/ar/")).toBe(false);
      }),
      { numRuns: 20 }
    );
  });

  it("AR pages with non-root slug resolve at /ar/{slug}", () => {
    fc.assert(
      fc.property(nonRootSlugArb, (slug) => {
        const url = resolvePageUrl("ar", slug);
        expect(url).toBe(`/ar/${slug}`);
        // Must start with /ar/
        expect(url.startsWith("/ar/")).toBe(true);
      }),
      { numRuns: 20 }
    );
  });

  it("root slug resolves to / for EN home (no redirect)", () => {
    expect(resolvePageUrl("en", "/")).toBe("/");
    expect(resolvePageUrl("en", "")).toBe("/");
  });

  it("root slug resolves to /ar for AR home", () => {
    expect(resolvePageUrl("ar", "/")).toBe("/ar");
    expect(resolvePageUrl("ar", "")).toBe("/ar");
  });

  it("EN URLs never have locale prefix, AR URLs always have /ar prefix", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("en" as const, "ar" as const),
        nonRootSlugArb,
        (locale, slug) => {
          const url = resolvePageUrl(locale, slug);

          if (locale === "en") {
            expect(url.startsWith("/ar/")).toBe(false);
            expect(url).toBe(`/${slug}`);
          } else {
            expect(url.startsWith("/ar/")).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
