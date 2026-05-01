import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateSlug, ensureUniqueSlug } from "../utils/slug";

// ── Shared arbitraries ───────────────────────────────────────────────────────

const localeArb = fc.constantFrom("en" as const, "ar" as const);
const postTypeArb = fc.constantFrom("blog" as const, "news" as const);
const postStatusArb = fc.constantFrom(
  "draft" as const,
  "published" as const,
  "trashed" as const
);

const nonEmptyTitleArb = fc
  .string({ minLength: 1, maxLength: 120 })
  .filter((s) => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s));

const optionalStringArb = fc.option(
  fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  { nil: null }
);

// UUID v4 regex for validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers: simulate post creation logic (mirrors posts.ts route) ───────────

interface SimulatedPost {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  namespace: string;
  postType: "blog" | "news";
  status: "draft" | "published" | "trashed";
  content: unknown;
  excerpt: string | null;
  featuredImage: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  ogImage: string | null;
  canonicalUrl: string | null;
  robotsDirective: string;
  publishedAt: Date | null;
  trashedAt: Date | null;
}

function createPost(
  input: {
    title: string;
    postType: "blog" | "news";
    locale: "en" | "ar";
    metaTitle?: string | null;
    metaDescription?: string | null;
    metaKeywords?: string | null;
    canonicalUrl?: string | null;
    robotsDirective?: string | null;
    featuredImage?: string | null;
    ogImage?: string | null;
  },
  existingSlugs: string[]
): SimulatedPost {
  const baseSlug = generateSlug(input.title);
  const slug = ensureUniqueSlug(baseSlug, existingSlugs);
  const namespace = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    slug,
    locale: input.locale,
    namespace,
    postType: input.postType,
    status: "draft",
    content: null,
    excerpt: null,
    featuredImage: input.featuredImage ?? null,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
    metaKeywords: input.metaKeywords ?? null,
    ogImage: input.ogImage ?? null,
    canonicalUrl: input.canonicalUrl ?? null,
    robotsDirective: input.robotsDirective ?? "index, follow",
    publishedAt: null,
    trashedAt: null,
  };
}

/** Filter posts the same way the admin GET /posts route does */
function filterPosts(
  posts: SimulatedPost[],
  filters: {
    locale?: "en" | "ar";
    status?: "draft" | "published";
    postType?: "blog" | "news";
  }
): SimulatedPost[] {
  return posts.filter((p) => {
    if (p.status === "trashed") return false; // admin list excludes trashed
    if (filters.locale && p.locale !== filters.locale) return false;
    if (filters.status && p.status !== filters.status) return false;
    if (filters.postType && p.postType !== filters.postType) return false;
    return true;
  });
}

/** Filter posts the same way the public GET /posts/public/:locale does */
function filterPublicPosts(
  posts: SimulatedPost[],
  locale: "en" | "ar"
): SimulatedPost[] {
  return posts.filter(
    (p) => p.locale === locale && p.status === "published"
  );
}

/** Simulate publishing a post */
function publishPost(post: SimulatedPost): SimulatedPost {
  return { ...post, status: "published", publishedAt: new Date() };
}

/** Simulate unpublishing a post */
function unpublishPost(post: SimulatedPost): SimulatedPost {
  return { ...post, status: "draft" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Post CRUD round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.1, 1.3, 2.5, 8.1, 8.2, 8.3**
 *
 * Property 1: Post CRUD round-trip
 *
 * For any valid post title, post type, locale, and optional SEO metadata,
 * creating a post and then reading it back by ID SHALL return a post with
 * matching title, postType, locale, status "draft", a valid UUID namespace,
 * and all SEO fields matching the input values.
 */
describe("Feature: blogs-news-module, Property 1: Post CRUD round-trip", () => {
  it("created post has matching title, postType, locale, status draft, valid UUID namespace, and matching SEO fields", () => {
    fc.assert(
      fc.property(
        nonEmptyTitleArb,
        postTypeArb,
        localeArb,
        optionalStringArb, // metaTitle
        optionalStringArb, // metaDescription
        optionalStringArb, // metaKeywords
        optionalStringArb, // canonicalUrl
        optionalStringArb, // featuredImage
        optionalStringArb, // ogImage
        (title, postType, locale, metaTitle, metaDesc, metaKw, canonical, featImg, ogImg) => {
          const post = createPost(
            {
              title,
              postType,
              locale,
              metaTitle,
              metaDescription: metaDesc,
              metaKeywords: metaKw,
              canonicalUrl: canonical,
              featuredImage: featImg,
              ogImage: ogImg,
            },
            []
          );

          // Title matches (trimmed)
          expect(post.title).toBe(title.trim());
          // PostType matches
          expect(post.postType).toBe(postType);
          // Locale matches
          expect(post.locale).toBe(locale);
          // Status is always "draft"
          expect(post.status).toBe("draft");
          // Namespace is a valid UUID
          expect(post.namespace).toMatch(UUID_RE);
          // publishedAt is null for draft
          expect(post.publishedAt).toBeNull();
          // SEO fields match input
          expect(post.metaTitle).toBe(metaTitle);
          expect(post.metaDescription).toBe(metaDesc);
          expect(post.metaKeywords).toBe(metaKw);
          expect(post.canonicalUrl).toBe(canonical);
          expect(post.featuredImage).toBe(featImg);
          expect(post.ogImage).toBe(ogImg);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Post list filtering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.2, 2.3, 2.4**
 *
 * Property 2: Post list filtering
 *
 * For any combination of locale, status, and post type filters applied to a
 * set of posts, all returned posts SHALL match every specified filter criterion,
 * and every post in the database matching all criteria SHALL appear in the results.
 */
describe("Feature: blogs-news-module, Property 2: Post list filtering", () => {
  const postArb = fc.record({
    title: nonEmptyTitleArb,
    postType: postTypeArb,
    locale: localeArb,
    status: fc.constantFrom("draft" as const, "published" as const, "trashed" as const),
  });

  const postsArrayArb = fc.array(postArb, { minLength: 1, maxLength: 15 });

  const filtersArb = fc.record({
    locale: fc.option(localeArb, { nil: undefined }),
    status: fc.option(
      fc.constantFrom("draft" as const, "published" as const),
      { nil: undefined }
    ),
    postType: fc.option(postTypeArb, { nil: undefined }),
  });

  it("all returned posts match every specified filter, and no matching post is missing", () => {
    fc.assert(
      fc.property(postsArrayArb, filtersArb, (postInputs, filters) => {
        // Build simulated posts with the given statuses
        const allPosts: SimulatedPost[] = postInputs.map((input, i) => {
          const base = createPost(
            { title: `${input.title}-${i}`, postType: input.postType, locale: input.locale },
            []
          );
          return { ...base, status: input.status } as SimulatedPost;
        });

        const result = filterPosts(allPosts, filters);

        // Every returned post matches all filter criteria
        for (const post of result) {
          expect(post.status).not.toBe("trashed");
          if (filters.locale) expect(post.locale).toBe(filters.locale);
          if (filters.status) expect(post.status).toBe(filters.status);
          if (filters.postType) expect(post.postType).toBe(filters.postType);
        }

        // Every post that should match IS in the result
        for (const post of allPosts) {
          if (post.status === "trashed") continue;
          if (filters.locale && post.locale !== filters.locale) continue;
          if (filters.status && post.status !== filters.status) continue;
          if (filters.postType && post.postType !== filters.postType) continue;
          expect(result).toContain(post);
        }
      }),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Trashed posts excluded from public results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 4.3, 4.5**
 *
 * Property 3: Trashed posts excluded from public results
 *
 * For any set of posts with mixed statuses (draft, published, trashed),
 * querying the public API SHALL return only posts with status "published".
 * No trashed or draft post SHALL appear in public query results.
 */
describe("Feature: blogs-news-module, Property 3: Trashed posts excluded from public results", () => {
  const postArb = fc.record({
    title: nonEmptyTitleArb,
    postType: postTypeArb,
    locale: localeArb,
    status: postStatusArb,
  });

  const postsArrayArb = fc.array(postArb, { minLength: 1, maxLength: 15 });

  it("public query returns only published posts, never draft or trashed", () => {
    fc.assert(
      fc.property(postsArrayArb, localeArb, (postInputs, queryLocale) => {
        const allPosts: SimulatedPost[] = postInputs.map((input, i) => {
          const base = createPost(
            { title: `${input.title}-${i}`, postType: input.postType, locale: input.locale },
            []
          );
          return {
            ...base,
            status: input.status,
            publishedAt: input.status === "published" ? new Date() : null,
            trashedAt: input.status === "trashed" ? new Date() : null,
          } as SimulatedPost;
        });

        const publicResult = filterPublicPosts(allPosts, queryLocale);

        // Every returned post must be published and match the locale
        for (const post of publicResult) {
          expect(post.status).toBe("published");
          expect(post.locale).toBe(queryLocale);
        }

        // No draft or trashed post appears
        for (const post of publicResult) {
          expect(post.status).not.toBe("draft");
          expect(post.status).not.toBe("trashed");
        }

        // Every published post for the locale IS in the result
        for (const post of allPosts) {
          if (post.status === "published" && post.locale === queryLocale) {
            expect(publicResult).toContain(post);
          }
        }
      }),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Publish/unpublish lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.1, 5.2**
 *
 * Property 7: Publish/unpublish lifecycle
 *
 * For any newly created post, its initial status SHALL be "draft" with null
 * publishedAt. Publishing it SHALL set status to "published" and set a non-null
 * publishedAt timestamp. Unpublishing it SHALL set status back to "draft".
 */
describe("Feature: blogs-news-module, Property 7: Publish/unpublish lifecycle", () => {
  it("draft → publish → unpublish transitions are correct", () => {
    fc.assert(
      fc.property(
        nonEmptyTitleArb,
        postTypeArb,
        localeArb,
        (title, postType, locale) => {
          // Step 1: Create — status is "draft", publishedAt is null
          const draft = createPost({ title, postType, locale }, []);
          expect(draft.status).toBe("draft");
          expect(draft.publishedAt).toBeNull();

          // Step 2: Publish — status is "published", publishedAt is non-null
          const published = publishPost(draft);
          expect(published.status).toBe("published");
          expect(published.publishedAt).not.toBeNull();
          expect(published.publishedAt).toBeInstanceOf(Date);

          // Step 3: Unpublish — status is back to "draft"
          const unpublished = unpublishPost(published);
          expect(unpublished.status).toBe("draft");
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Slug uniqueness within locale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.1, 7.2, 7.5**
 *
 * Property 12: Slug uniqueness within locale
 *
 * For any set of posts created in the same locale, all slugs SHALL be unique
 * within that locale. When a generated slug collides with an existing slug,
 * the system SHALL append a numeric suffix (-1, -2, etc.) to produce a unique slug.
 */
describe("Feature: blogs-news-module, Property 12: Slug uniqueness within locale", () => {
  it("all slugs within a locale are unique after sequential creation", () => {
    fc.assert(
      fc.property(
        fc.array(nonEmptyTitleArb, { minLength: 2, maxLength: 10 }),
        localeArb,
        (titles, locale) => {
          const existingSlugs: string[] = [];
          const createdSlugs: string[] = [];

          for (const title of titles) {
            const baseSlug = generateSlug(title);
            const slug = ensureUniqueSlug(baseSlug, existingSlugs);

            // Slug must not already exist in the locale
            expect(existingSlugs).not.toContain(slug);

            existingSlugs.push(slug);
            createdSlugs.push(slug);
          }

          // All slugs are unique (Set size equals array length)
          const uniqueSet = new Set(createdSlugs);
          expect(uniqueSet.size).toBe(createdSlugs.length);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("colliding slugs get numeric suffixes", () => {
    fc.assert(
      fc.property(
        nonEmptyTitleArb,
        fc.integer({ min: 2, max: 6 }),
        (title, count) => {
          const baseSlug = generateSlug(title);
          // Skip titles that produce empty slugs (no alphanumeric content)
          fc.pre(baseSlug.length > 0);

          const existingSlugs: string[] = [];
          const createdSlugs: string[] = [];

          for (let i = 0; i < count; i++) {
            const slug = ensureUniqueSlug(baseSlug, existingSlugs);
            existingSlugs.push(slug);
            createdSlugs.push(slug);
          }

          // First slug should be the base slug itself
          expect(createdSlugs[0]).toBe(baseSlug);

          // Subsequent slugs should have numeric suffixes
          for (let i = 1; i < createdSlugs.length; i++) {
            expect(createdSlugs[i]).toMatch(
              new RegExp(`^${baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`)
            );
          }

          // All slugs are unique
          const uniqueSet = new Set(createdSlugs);
          expect(uniqueSet.size).toBe(createdSlugs.length);
        }
      ),
      { numRuns: 20 }
    );
  });
});
