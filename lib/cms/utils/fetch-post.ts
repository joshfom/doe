import { db } from "@/lib/cms/db";
import {
  posts,
  categories,
  tags,
  postCategories,
  postTags,
  users,
} from "@/lib/cms/schema";
import { eq, and, desc, sql, ne, inArray } from "drizzle-orm";

/**
 * Fetch a single published post by locale and slug.
 * Returns null if not found or not published.
 */
export async function fetchPublicPost(locale: string, slug: string) {
  try {
    const [post] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.locale, locale as "en" | "ar"),
          eq(posts.slug, slug),
          eq(posts.status, "published")
        )
      )
      .limit(1);

    if (!post) return null;

    // Fetch categories for this post
    const postCats = await db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(postCategories)
      .innerJoin(categories, eq(postCategories.categoryId, categories.id))
      .where(eq(postCategories.postId, post.id));

    // Fetch tags for this post
    const postTagsList = await db
      .select({ id: tags.id, name: tags.name, slug: tags.slug })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(postTags.postId, post.id));

    // Fetch author info
    const [author] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, post.authorId))
      .limit(1);

    return {
      ...post,
      categories: postCats,
      tags: postTagsList,
      author: author || null,
    };
  } catch {
    return null;
  }
}


/**
 * Fetch published posts for listing (paginated).
 * Returns posts with total count for pagination.
 */
export async function fetchPublicPosts(
  locale: string,
  page: number = 1,
  pageSize: number = 12,
  postType?: "blog" | "news"
) {
  try {
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(posts.locale, locale as "en" | "ar"),
      eq(posts.status, "published"),
    ];
    if (postType) conditions.push(eq(posts.postType, postType));

    const postsResult = await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.publishedAt))
      .limit(pageSize)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(...conditions));

    // Fetch categories for each post
    const postsWithCategories = await Promise.all(
      postsResult.map(async (post) => {
        const postCats = await db
          .select({ id: categories.id, name: categories.name, slug: categories.slug })
          .from(postCategories)
          .innerJoin(categories, eq(postCategories.categoryId, categories.id))
          .where(eq(postCategories.postId, post.id));

        return { ...post, categories: postCats };
      })
    );

    return {
      posts: postsWithCategories,
      total: countResult?.count ?? 0,
    };
  } catch {
    return { posts: [], total: 0 };
  }
}

/**
 * Fetch posts by category slug (paginated).
 * Returns posts, total count, and the category record.
 */
export async function fetchPostsByCategory(
  locale: string,
  categorySlug: string,
  page: number = 1,
  pageSize: number = 12
) {
  try {
    const offset = (page - 1) * pageSize;

    // Find the category
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, categorySlug))
      .limit(1);

    if (!category) return { posts: [], total: 0, category: null };

    // Get post IDs in this category
    const postIdsInCategory = await db
      .select({ postId: postCategories.postId })
      .from(postCategories)
      .where(eq(postCategories.categoryId, category.id));

    const postIdList = postIdsInCategory.map((r) => r.postId);
    if (postIdList.length === 0) return { posts: [], total: 0, category };

    const postsResult = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.locale, locale as "en" | "ar"),
          eq(posts.status, "published"),
          inArray(posts.id, postIdList)
        )
      )
      .orderBy(desc(posts.publishedAt))
      .limit(pageSize)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          eq(posts.locale, locale as "en" | "ar"),
          eq(posts.status, "published"),
          inArray(posts.id, postIdList)
        )
      );

    return {
      posts: postsResult,
      total: countResult?.count ?? 0,
      category,
    };
  } catch {
    return { posts: [], total: 0, category: null };
  }
}


/**
 * Fetch posts by tag slug (paginated).
 * Returns posts, total count, and the tag record.
 */
export async function fetchPostsByTag(
  locale: string,
  tagSlug: string,
  page: number = 1,
  pageSize: number = 12
) {
  try {
    const offset = (page - 1) * pageSize;

    // Find the tag
    const [tag] = await db
      .select()
      .from(tags)
      .where(eq(tags.slug, tagSlug))
      .limit(1);

    if (!tag) return { posts: [], total: 0, tag: null };

    // Get post IDs with this tag
    const postIdsWithTag = await db
      .select({ postId: postTags.postId })
      .from(postTags)
      .where(eq(postTags.tagId, tag.id));

    const postIdList = postIdsWithTag.map((r) => r.postId);
    if (postIdList.length === 0) return { posts: [], total: 0, tag };

    const postsResult = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.locale, locale as "en" | "ar"),
          eq(posts.status, "published"),
          inArray(posts.id, postIdList)
        )
      )
      .orderBy(desc(posts.publishedAt))
      .limit(pageSize)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          eq(posts.locale, locale as "en" | "ar"),
          eq(posts.status, "published"),
          inArray(posts.id, postIdList)
        )
      );

    return {
      posts: postsResult,
      total: countResult?.count ?? 0,
      tag,
    };
  } catch {
    return { posts: [], total: 0, tag: null };
  }
}

/**
 * Fetch related posts for a given post.
 * Strategy: find posts sharing categories or tags, excluding the current post.
 * Falls back to recent posts of the same post type if not enough matches.
 */
export async function fetchRelatedPosts(
  postId: string,
  locale: string,
  limit: number = 3
) {
  try {
    // Get the current post to know its type
    const [currentPost] = await db
      .select({ id: posts.id, postType: posts.postType })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!currentPost) return [];

    // Get category IDs for the current post
    const postCatIds = await db
      .select({ categoryId: postCategories.categoryId })
      .from(postCategories)
      .where(eq(postCategories.postId, postId));

    // Get tag IDs for the current post
    const postTagIds = await db
      .select({ tagId: postTags.tagId })
      .from(postTags)
      .where(eq(postTags.postId, postId));

    const catIds = postCatIds.map((r) => r.categoryId);
    const tagIds = postTagIds.map((r) => r.tagId);

    const relatedPostIds = new Set<string>();

    // Find posts sharing categories
    if (catIds.length > 0) {
      const byCat = await db
        .select({ postId: postCategories.postId })
        .from(postCategories)
        .where(inArray(postCategories.categoryId, catIds));

      for (const r of byCat) {
        if (r.postId !== postId) relatedPostIds.add(r.postId);
      }
    }

    // Find posts sharing tags
    if (tagIds.length > 0) {
      const byTag = await db
        .select({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, tagIds));

      for (const r of byTag) {
        if (r.postId !== postId) relatedPostIds.add(r.postId);
      }
    }

    const relatedIdArray = Array.from(relatedPostIds);

    // Fetch related posts that are published and in the same locale
    let relatedPosts = relatedIdArray.length > 0
      ? await db
          .select()
          .from(posts)
          .where(
            and(
              inArray(posts.id, relatedIdArray),
              eq(posts.locale, locale as "en" | "ar"),
              eq(posts.status, "published"),
              ne(posts.id, postId)
            )
          )
          .orderBy(desc(posts.publishedAt))
          .limit(limit)
      : [];

    // Fallback: fill remaining slots with recent posts of the same type
    if (relatedPosts.length < limit) {
      const excludeIds = [postId, ...relatedPosts.map((p) => p.id)];
      const remaining = limit - relatedPosts.length;

      const fallbackPosts = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.locale, locale as "en" | "ar"),
            eq(posts.status, "published"),
            eq(posts.postType, currentPost.postType),
            sql`${posts.id} != ALL(${excludeIds})`
          )
        )
        .orderBy(desc(posts.publishedAt))
        .limit(remaining);

      relatedPosts = [...relatedPosts, ...fallbackPosts];
    }

    return relatedPosts;
  } catch {
    return [];
  }
}
