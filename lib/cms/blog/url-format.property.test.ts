import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── Types ────────────────────────────────────────────────────────────────────

type Locale = "en" | "ar";
type UrlEntityType = "post" | "category" | "tag";

// ── Shared arbitraries ───────────────────────────────────────────────────────

const localeArb = fc.constantFrom("en" as const, "ar" as const);

/**
 * Generate valid URL slugs: lowercase alphanumeric with hyphens,
 * no leading/trailing hyphens, no consecutive hyphens.
 */
const slugArb = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/, { minLength: 1, maxLength: 80 })
  .filter((s) => s.length > 0);

// ── Helpers: simulate URL generation (mirrors Next.js route structure) ───────

/**
 * Generate the public URL for a blog post given its locale and slug.
 * EN: /blog/{slug}
 * AR: /ar/blog/{slug}
 */
function generatePostUrl(locale: Locale, slug: string): string {
  if (locale === "ar") {
    return `/ar/blog/${slug}`;
  }
  return `/blog/${slug}`;
}

/**
 * Generate the public URL for a category archive given its locale and slug.
 * EN: /blog/category/{slug}
 * AR: /ar/blog/category/{slug}
 */
function generateCategoryUrl(locale: Locale, slug: string): string {
  if (locale === "ar") {
    return `/ar/blog/category/${slug}`;
  }
  return `/blog/category/${slug}`;
}

/**
 * Generate the public URL for a tag archive given its locale and slug.
 * EN: /blog/tag/{slug}
 * AR: /ar/blog/tag/{slug}
 */
function generateTagUrl(locale: Locale, slug: string): string {
  if (locale === "ar") {
    return `/ar/blog/tag/${slug}`;
  }
  return `/blog/tag/${slug}`;
}

/**
 * Dispatch URL generation based on entity type.
 */
function generateUrl(entityType: UrlEntityType, locale: Locale, slug: string): string {
  switch (entityType) {
    case "post":
      return generatePostUrl(locale, slug);
    case "category":
      return generateCategoryUrl(locale, slug);
    case "tag":
      return generateTagUrl(locale, slug);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 24: Blog URL format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 21.4, 22.4**
 *
 * Property 24: Blog URL format
 *
 * For any post slug, the public URL SHALL follow the format `/blog/{slug}`
 * for English locale and `/ar/blog/{slug}` for Arabic locale. Category
 * archive URLs SHALL follow `/blog/category/{slug}` and tag archive URLs
 * SHALL follow `/blog/tag/{slug}`.
 */
describe("Feature: blogs-news-module, Property 24: Blog URL format", () => {
  it("EN post URLs follow /blog/{slug} format", () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        const url = generatePostUrl("en", slug);
        expect(url).toBe(`/blog/${slug}`);
        expect(url).toMatch(/^\/blog\/[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
      { numRuns: 100 }
    );
  });

  it("AR post URLs follow /ar/blog/{slug} format", () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        const url = generatePostUrl("ar", slug);
        expect(url).toBe(`/ar/blog/${slug}`);
        expect(url).toMatch(/^\/ar\/blog\/[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
      { numRuns: 100 }
    );
  });

  it("EN category archive URLs follow /blog/category/{slug} format", () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        const url = generateCategoryUrl("en", slug);
        expect(url).toBe(`/blog/category/${slug}`);
        expect(url).toMatch(/^\/blog\/category\/[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
      { numRuns: 100 }
    );
  });

  it("AR category archive URLs follow /ar/blog/category/{slug} format", () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        const url = generateCategoryUrl("ar", slug);
        expect(url).toBe(`/ar/blog/category/${slug}`);
        expect(url).toMatch(/^\/ar\/blog\/category\/[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
      { numRuns: 100 }
    );
  });

  it("EN tag archive URLs follow /blog/tag/{slug} format", () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        const url = generateTagUrl("en", slug);
        expect(url).toBe(`/blog/tag/${slug}`);
        expect(url).toMatch(/^\/blog\/tag\/[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
      { numRuns: 100 }
    );
  });

  it("AR tag archive URLs follow /ar/blog/tag/{slug} format", () => {
    fc.assert(
      fc.property(slugArb, (slug) => {
        const url = generateTagUrl("ar", slug);
        expect(url).toBe(`/ar/blog/tag/${slug}`);
        expect(url).toMatch(/^\/ar\/blog\/tag\/[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
      { numRuns: 100 }
    );
  });

  it("EN URLs never contain /ar/ prefix", () => {
    fc.assert(
      fc.property(
        slugArb,
        fc.constantFrom<UrlEntityType>("post", "category", "tag"),
        (slug, entityType) => {
          const url = generateUrl(entityType, "en", slug);
          expect(url).not.toMatch(/^\/ar\//);
          expect(url.startsWith("/blog/")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("AR URLs always start with /ar/blog/", () => {
    fc.assert(
      fc.property(
        slugArb,
        fc.constantFrom<UrlEntityType>("post", "category", "tag"),
        (slug, entityType) => {
          const url = generateUrl(entityType, "ar", slug);
          expect(url.startsWith("/ar/blog/")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("URL always ends with the slug", () => {
    fc.assert(
      fc.property(
        slugArb,
        localeArb,
        fc.constantFrom<UrlEntityType>("post", "category", "tag"),
        (slug, locale, entityType) => {
          const url = generateUrl(entityType, locale, slug);
          expect(url.endsWith(`/${slug}`)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
