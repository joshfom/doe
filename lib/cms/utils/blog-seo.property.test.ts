import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateBlogMetadata } from "./blog-seo";
import { generateStructuredData } from "./structured-data";

// ── Shared arbitraries ───────────────────────────────────────────────────────

const localeArb = fc.constantFrom("en" as const, "ar" as const);
const postTypeArb = fc.constantFrom("blog" as const, "news" as const);

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

const slugArb = fc
  .stringMatching(/^[a-z0-9][a-z0-9\-]*$/)
  .filter((s) => s.length > 0 && s.length <= 100);

const urlArb = fc
  .stringMatching(/^https?:\/\/[a-z0-9]+/)
  .filter((s) => s.length > 5 && s.length <= 200);

const isoDateArb = fc
  .integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
  .map((ms) => new Date(ms).toISOString());

// ─────────────────────────────────────────────────────────────────────────────
// Property 13: OG image falls back to featured image
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 8.4**
 *
 * Property 13: OG image falls back to featured image
 *
 * For any post where ogImage is null or empty but featuredImage is set,
 * the generated blog metadata SHALL use the featuredImage URL as the
 * OpenGraph image.
 */
describe("Feature: blogs-news-module, Property 13: OG image falls back to featured image", () => {
  it("uses featuredImage as OG image when ogImage is null", () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb, // metaTitle
        nonEmptyStringArb, // metaDescription
        slugArb,
        localeArb,
        postTypeArb,
        urlArb, // featuredImage
        (metaTitle, metaDescription, slug, locale, postType, featuredImage) => {
          const metadata = generateBlogMetadata({
            metaTitle,
            metaDescription,
            slug,
            locale,
            postType,
            ogImage: null,
            featuredImage,
          });

          const og = metadata.openGraph as Record<string, unknown>;
          expect(og).toBeDefined();
          expect(og.images).toBeDefined();

          const images = og.images as Array<{ url: string }>;
          expect(images[0].url).toBe(featuredImage);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("uses featuredImage as OG image when ogImage is empty string", () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        nonEmptyStringArb,
        slugArb,
        localeArb,
        postTypeArb,
        urlArb,
        (metaTitle, metaDescription, slug, locale, postType, featuredImage) => {
          const metadata = generateBlogMetadata({
            metaTitle,
            metaDescription,
            slug,
            locale,
            postType,
            ogImage: "",
            featuredImage,
          });

          const og = metadata.openGraph as Record<string, unknown>;
          expect(og).toBeDefined();
          expect(og.images).toBeDefined();

          const images = og.images as Array<{ url: string }>;
          expect(images[0].url).toBe(featuredImage);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("uses explicit ogImage when provided (not the featuredImage)", () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        slugArb,
        localeArb,
        postTypeArb,
        urlArb, // ogImage
        urlArb, // featuredImage
        (metaTitle, slug, locale, postType, ogImage, featuredImage) => {
          const metadata = generateBlogMetadata({
            metaTitle,
            slug,
            locale,
            postType,
            ogImage,
            featuredImage,
          });

          const og = metadata.openGraph as Record<string, unknown>;
          expect(og).toBeDefined();
          expect(og.images).toBeDefined();

          const images = og.images as Array<{ url: string }>;
          expect(images[0].url).toBe(ogImage);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 14: Schema.org structured data type mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * Property 14: Schema.org structured data type mapping
 *
 * For any published post, the generated structured data SHALL have @type
 * "Article" when postType is "blog" and @type "NewsArticle" when postType
 * is "news". The structured data SHALL use title as headline, publishedAt
 * as datePublished, and updatedAt as dateModified.
 */
describe("Feature: blogs-news-module, Property 14: Schema.org structured data type mapping", () => {
  it("@type is 'Article' for blog posts and 'NewsArticle' for news", () => {
    fc.assert(
      fc.property(
        postTypeArb,
        nonEmptyStringArb, // title
        nonEmptyStringArb, // description
        isoDateArb,        // publishedAt
        isoDateArb,        // updatedAt
        nonEmptyStringArb, // authorName
        urlArb,            // url
        (postType, title, description, publishedAt, updatedAt, authorName, url) => {
          const sd = generateStructuredData({
            postType,
            title,
            description,
            publishedAt,
            updatedAt,
            authorName,
            url,
          });

          if (postType === "blog") {
            expect(sd["@type"]).toBe("Article");
          } else {
            expect(sd["@type"]).toBe("NewsArticle");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("uses title as headline, publishedAt as datePublished, updatedAt as dateModified", () => {
    fc.assert(
      fc.property(
        postTypeArb,
        nonEmptyStringArb,
        nonEmptyStringArb,
        isoDateArb,
        isoDateArb,
        nonEmptyStringArb,
        urlArb,
        (postType, title, description, publishedAt, updatedAt, authorName, url) => {
          const sd = generateStructuredData({
            postType,
            title,
            description,
            publishedAt,
            updatedAt,
            authorName,
            url,
          });

          expect(sd.headline).toBe(title);
          expect(sd.datePublished).toBe(publishedAt);
          expect(sd.dateModified).toBe(updatedAt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("always includes @context as https://schema.org", () => {
    fc.assert(
      fc.property(
        postTypeArb,
        nonEmptyStringArb,
        nonEmptyStringArb,
        isoDateArb,
        isoDateArb,
        nonEmptyStringArb,
        urlArb,
        (postType, title, description, publishedAt, updatedAt, authorName, url) => {
          const sd = generateStructuredData({
            postType,
            title,
            description,
            publishedAt,
            updatedAt,
            authorName,
            url,
          });

          expect(sd["@context"]).toBe("https://schema.org");
        }
      ),
      { numRuns: 100 }
    );
  });
});
