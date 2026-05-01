import { Elysia } from "elysia";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import { posts, postViews, postShares } from "../../schema";
import { db } from "../../db";

// ── Public routes (no auth) — view/share tracking ───────────────────────────

const publicStats = new Elysia({ name: "stats-public" })

  // POST /stats/view/:postId — Increment view count (upsert)
  .post("/stats/view/:postId", async ({ params, set }) => {
    const { postId } = params;

    // Verify post exists
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Check if a view record exists for this post
    const [existing] = await db
      .select()
      .from(postViews)
      .where(eq(postViews.postId, postId))
      .limit(1);

    if (existing) {
      await db
        .update(postViews)
        .set({ count: existing.count + 1 })
        .where(eq(postViews.id, existing.id));
    } else {
      await db.insert(postViews).values({ postId, count: 1 });
    }

    return { data: { success: true } };
  })

  // POST /stats/share/:postId — Increment share count for platform (upsert)
  .post("/stats/share/:postId", async ({ params, body, set }) => {
    const { postId } = params;
    const { platform } = body as { platform?: string };

    if (!platform || typeof platform !== "string" || platform.trim().length === 0) {
      set.status = 400;
      return { error: "Platform is required" };
    }

    // Verify post exists
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Check if a share record exists for this post + platform
    const [existing] = await db
      .select()
      .from(postShares)
      .where(
        and(
          eq(postShares.postId, postId),
          eq(postShares.platform, platform.trim())
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(postShares)
        .set({ count: existing.count + 1 })
        .where(eq(postShares.id, existing.id));
    } else {
      await db
        .insert(postShares)
        .values({ postId, platform: platform.trim(), count: 1 });
    }

    return { data: { success: true } };
  });

// ── Protected routes (auth required) — stats queries ─────────────────────────

const protectedStats = new Elysia({ name: "stats-protected" })
  .use(authGuard)

  // GET /stats/overview — Total posts, total views, total shares
  .get("/stats/overview", async ({ query }) => {
    const { postType, from, to } = query as {
      postType?: "blog" | "news";
      from?: string;
      to?: string;
    };

    // Build conditions for posts
    const postConditions = [];
    if (postType) postConditions.push(eq(posts.postType, postType));
    if (from) postConditions.push(gte(posts.createdAt, new Date(from)));
    if (to) postConditions.push(lte(posts.createdAt, new Date(to)));

    const postWhere = postConditions.length > 0 ? and(...postConditions) : undefined;

    // Total posts count
    const [postCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(postWhere);

    // Get post IDs matching filters for view/share aggregation
    const matchingPosts = postWhere
      ? db.select({ id: posts.id }).from(posts).where(postWhere)
      : db.select({ id: posts.id }).from(posts);

    // Total views
    const [viewCount] = await db
      .select({ total: sql<number>`coalesce(sum(${postViews.count}), 0)::int` })
      .from(postViews)
      .where(
        postWhere
          ? sql`${postViews.postId} in (${matchingPosts})`
          : undefined
      );

    // Total shares
    const [shareCount] = await db
      .select({ total: sql<number>`coalesce(sum(${postShares.count}), 0)::int` })
      .from(postShares)
      .where(
        postWhere
          ? sql`${postShares.postId} in (${matchingPosts})`
          : undefined
      );

    return {
      data: {
        totalPosts: postCount?.count ?? 0,
        totalViews: viewCount?.total ?? 0,
        totalShares: shareCount?.total ?? 0,
      },
    };
  })

  // GET /stats/top-posts — Top posts ranked by view count
  .get("/stats/top-posts", async ({ query }) => {
    const { postType, limit: limitStr } = query as {
      postType?: "blog" | "news";
      limit?: string;
    };

    const resultLimit = Math.max(1, parseInt(limitStr as string) || 10);

    const conditions = [];
    if (postType) conditions.push(eq(posts.postType, postType));
    const postWhere = conditions.length > 0 ? and(...conditions) : undefined;

    const topPosts = await db
      .select({
        postId: posts.id,
        title: posts.title,
        slug: posts.slug,
        locale: posts.locale,
        postType: posts.postType,
        status: posts.status,
        publishedAt: posts.publishedAt,
        viewCount: sql<number>`coalesce(${postViews.count}, 0)::int`,
      })
      .from(posts)
      .leftJoin(postViews, eq(posts.id, postViews.postId))
      .where(postWhere)
      .orderBy(sql`coalesce(${postViews.count}, 0) DESC`)
      .limit(resultLimit);

    return { data: topPosts };
  })

  // GET /stats/shares — Per-platform share count breakdown
  .get("/stats/shares", async () => {
    const breakdown = await db
      .select({
        platform: postShares.platform,
        total: sql<number>`coalesce(sum(${postShares.count}), 0)::int`,
      })
      .from(postShares)
      .groupBy(postShares.platform)
      .orderBy(sql`sum(${postShares.count}) DESC`);

    return { data: breakdown };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const statsRoutes = new Elysia({ name: "stats" })
  .use(publicStats)
  .use(protectedStats);
