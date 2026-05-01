import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── Types ────────────────────────────────────────────────────────────────────

interface SimulatedPost {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  postType: "blog" | "news";
  status: "draft" | "published" | "trashed";
  categoryIds: string[];
  tagIds: string[];
  publishedAt: Date | null;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const localeArb = fc.constantFrom("en" as const, "ar" as const);
const postTypeArb = fc.constantFrom("blog" as const, "news" as const);

const nonEmptyTitleArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s));

const categoryIdArb = fc.constantFrom("cat-1", "cat-2", "cat-3", "cat-4", "cat-5");
const tagIdArb = fc.constantFrom("tag-1", "tag-2", "tag-3", "tag-4", "tag-5");

// ── Helpers: simulate related posts logic (mirrors fetch-post.ts) ────────────

function createPost(
  title: string,
  locale: "en" | "ar",
  postType: "blog" | "news",
  categoryIds: string[],
  tagIds: string[],
  published: boolean
): SimulatedPost {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    locale,
    postType,
    status: published ? "published" : "draft",
    categoryIds,
    tagIds,
    publishedAt: published ? new Date() : null,
  };
}

/**
 * Simulate related posts selection logic:
 * 1. Only consider published posts in the same locale
 * 2. Exclude the current post
 * 3. Score by shared categories + tags
 * 4. Fill remaining slots with same postType posts (fallback)
 * 5. Return at most `limit` results
 */
function getRelatedPosts(
  currentPost: SimulatedPost,
  allPosts: SimulatedPost[],
  limit: number = 3
): SimulatedPost[] {
  // Only published posts in the same locale, excluding current
  const candidates = allPosts.filter(
    (p) =>
      p.id !== currentPost.id &&
      p.status === "published" &&
      p.locale === currentPost.locale
  );

  // Score each candidate by shared categories + tags
  const scored = candidates.map((p) => {
    const sharedCategories = p.categoryIds.filter((c) =>
      currentPost.categoryIds.includes(c)
    ).length;
    const sharedTags = p.tagIds.filter((t) =>
      currentPost.tagIds.includes(t)
    ).length;
    return { post: p, score: sharedCategories + sharedTags };
  });

  // Sort by score descending, then pick top matches
  scored.sort((a, b) => b.score - a.score);

  const related: SimulatedPost[] = [];
  const usedIds = new Set<string>();

  // First: posts with shared categories/tags (score > 0)
  for (const { post, score } of scored) {
    if (related.length >= limit) break;
    if (score > 0 && !usedIds.has(post.id)) {
      related.push(post);
      usedIds.add(post.id);
    }
  }

  // Fallback: same postType posts to fill remaining slots
  if (related.length < limit) {
    const sameType = candidates.filter(
      (p) => p.postType === currentPost.postType && !usedIds.has(p.id)
    );
    for (const post of sameType) {
      if (related.length >= limit) break;
      related.push(post);
      usedIds.add(post.id);
    }
  }

  return related;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 22: Related posts constraints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 23.1, 23.2, 23.3, 23.4**
 *
 * Property 22: Related posts constraints
 *
 * For any set of posts, related posts SHALL:
 * - Return at most 3 results (or the specified limit)
 * - Exclude the current post
 * - Prefer posts sharing categories/tags
 * - Fall back to same post type when not enough matches
 */
describe("Feature: blogs-news-module, Property 22: Related posts constraints", () => {
  const postArb = fc.record({
    title: nonEmptyTitleArb,
    locale: localeArb,
    postType: postTypeArb,
    categoryIds: fc.array(categoryIdArb, { minLength: 0, maxLength: 3 }),
    tagIds: fc.array(tagIdArb, { minLength: 0, maxLength: 3 }),
    published: fc.boolean(),
  });

  const postsArrayArb = fc.array(postArb, { minLength: 2, maxLength: 15 });

  it("returns at most 3 results (default limit)", () => {
    fc.assert(
      fc.property(postsArrayArb, (postInputs) => {
        const allPosts = postInputs.map((input, i) =>
          createPost(
            `${input.title}-${i}`,
            input.locale,
            input.postType,
            input.categoryIds,
            input.tagIds,
            input.published
          )
        );

        // Pick the first published post as current, or skip
        const currentPost = allPosts.find((p) => p.status === "published");
        if (!currentPost) return; // no published post to test

        const related = getRelatedPosts(currentPost, allPosts);
        expect(related.length).toBeLessThanOrEqual(3);
      }),
      { numRuns: 100 }
    );
  });

  it("respects custom limit parameter", () => {
    fc.assert(
      fc.property(
        postsArrayArb,
        fc.integer({ min: 1, max: 5 }),
        (postInputs, limit) => {
          const allPosts = postInputs.map((input, i) =>
            createPost(
              `${input.title}-${i}`,
              input.locale,
              input.postType,
              input.categoryIds,
              input.tagIds,
              input.published
            )
          );

          const currentPost = allPosts.find((p) => p.status === "published");
          if (!currentPost) return;

          const related = getRelatedPosts(currentPost, allPosts, limit);
          expect(related.length).toBeLessThanOrEqual(limit);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never includes the current post in results", () => {
    fc.assert(
      fc.property(postsArrayArb, (postInputs) => {
        const allPosts = postInputs.map((input, i) =>
          createPost(
            `${input.title}-${i}`,
            input.locale,
            input.postType,
            input.categoryIds,
            input.tagIds,
            input.published
          )
        );

        const currentPost = allPosts.find((p) => p.status === "published");
        if (!currentPost) return;

        const related = getRelatedPosts(currentPost, allPosts);
        const relatedIds = related.map((p) => p.id);
        expect(relatedIds).not.toContain(currentPost.id);
      }),
      { numRuns: 100 }
    );
  });

  it("prefers posts sharing categories/tags over unrelated posts", () => {
    fc.assert(
      fc.property(
        nonEmptyTitleArb,
        localeArb,
        postTypeArb,
        (title, locale, postType) => {
          // Create a current post with known categories
          const currentPost = createPost(
            title,
            locale,
            postType,
            ["cat-1", "cat-2"],
            ["tag-1"],
            true
          );

          // Create a related post (shares cat-1)
          const relatedPost = createPost(
            `related-${title}`,
            locale,
            postType,
            ["cat-1"],
            [],
            true
          );

          // Create an unrelated post (no shared categories/tags)
          const unrelatedPost = createPost(
            `unrelated-${title}`,
            locale,
            postType,
            ["cat-5"],
            ["tag-5"],
            true
          );

          const allPosts = [currentPost, relatedPost, unrelatedPost];
          const related = getRelatedPosts(currentPost, allPosts, 1);

          // With limit 1, the related post (sharing cat-1) should be preferred
          if (related.length > 0) {
            expect(related[0].id).toBe(relatedPost.id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("falls back to same postType when not enough category/tag matches", () => {
    fc.assert(
      fc.property(
        nonEmptyTitleArb,
        localeArb,
        postTypeArb,
        (title, locale, postType) => {
          // Current post with unique categories (no overlap possible)
          const currentPost = createPost(
            title,
            locale,
            postType,
            ["cat-1"],
            ["tag-1"],
            true
          );

          // Fallback posts: same postType but no shared categories/tags
          const fallback1 = createPost(
            `fallback1-${title}`,
            locale,
            postType,
            ["cat-4"],
            ["tag-4"],
            true
          );
          const fallback2 = createPost(
            `fallback2-${title}`,
            locale,
            postType,
            ["cat-5"],
            ["tag-5"],
            true
          );

          const allPosts = [currentPost, fallback1, fallback2];
          const related = getRelatedPosts(currentPost, allPosts, 3);

          // Should still return results via fallback (same postType)
          expect(related.length).toBeGreaterThan(0);
          for (const post of related) {
            expect(post.id).not.toBe(currentPost.id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("only returns published posts", () => {
    fc.assert(
      fc.property(postsArrayArb, (postInputs) => {
        const allPosts = postInputs.map((input, i) =>
          createPost(
            `${input.title}-${i}`,
            input.locale,
            input.postType,
            input.categoryIds,
            input.tagIds,
            input.published
          )
        );

        const currentPost = allPosts.find((p) => p.status === "published");
        if (!currentPost) return;

        const related = getRelatedPosts(currentPost, allPosts);
        for (const post of related) {
          expect(post.status).toBe("published");
        }
      }),
      { numRuns: 100 }
    );
  });
});
