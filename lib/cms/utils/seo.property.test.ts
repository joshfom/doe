import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generatePageMetadata } from "./seo";

/**
 * Feature: ora-cms-platform, Property 21: SEO meta tags from page metadata
 *
 * For any page with non-empty metaTitle and metaDescription, the generated
 * metadata SHALL contain title and description.
 *
 * **Validates: Requirements 13.4**
 */
describe("Property 21: SEO meta tags from page metadata", () => {
  const nonEmptyString = fc.string({ minLength: 1, maxLength: 200 }).filter(
    (s) => s.trim().length > 0
  );

  const localeArb = fc.constantFrom("en" as const, "ar" as const);

  const slugArb = fc
    .stringMatching(/^[a-z0-9][a-z0-9\-\/]*$/)
    .filter((s) => s.length > 0 && s.length <= 100);

  it("should contain title and description when metaTitle and metaDescription are non-empty", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        nonEmptyString,
        localeArb,
        slugArb,
        (metaTitle, metaDescription, locale, slug) => {
          const metadata = generatePageMetadata({
            metaTitle,
            metaDescription,
            slug,
            locale,
          });

          // Title must be present and match
          expect(metadata.title).toBe(metaTitle);

          // Description must be present and match
          expect(metadata.description).toBe(metaDescription);

          // Open Graph title and description must be present
          expect(metadata.openGraph).toBeDefined();
          const og = metadata.openGraph as Record<string, unknown>;
          expect(og.title).toBe(metaTitle);
          expect(og.description).toBe(metaDescription);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("should include hreflang alternates for both locales", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        nonEmptyString,
        localeArb,
        slugArb,
        (metaTitle, metaDescription, locale, slug) => {
          const metadata = generatePageMetadata({
            metaTitle,
            metaDescription,
            slug,
            locale,
          });

          expect(metadata.alternates).toBeDefined();
          expect(metadata.alternates!.languages).toBeDefined();

          const langs = metadata.alternates!.languages as Record<string, string>;
          expect(langs.en).toBeDefined();
          expect(langs.ar).toBeDefined();
        }
      ),
      { numRuns: 20 }
    );
  });

  it("should omit title from metadata when metaTitle is null", () => {
    fc.assert(
      fc.property(nonEmptyString, localeArb, slugArb, (metaDescription, locale, slug) => {
        const metadata = generatePageMetadata({
          metaTitle: null,
          metaDescription,
          slug,
          locale,
        });

        expect(metadata.title).toBeUndefined();
        expect(metadata.description).toBe(metaDescription);
      }),
      { numRuns: 20 }
    );
  });
});
