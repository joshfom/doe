import { Elysia } from "elysia";
import { eq, and, ne, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import {
  posts,
  postCategories,
  postTags,
  postRevisions,
  categories,
  tags,
  siteSettings,
} from "../../schema";
import { db } from "../../db";
import type { Locale, PostNamespaceGroup, PostStatus, PostType, ContentModule } from "../../types";
import { generateSlug, ensureUniqueSlug } from "../../utils/slug";
import { logAudit } from "../../audit";
import { checkPublicationGate } from "../../approval/gate";
import { syncBlogPost } from "../../ai/content-sync";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicPosts = new Elysia({ name: "posts-public" })
  // GET /posts/public/:locale/:slug — Single published post with categories and tags
  .get("/posts/public/:locale/:slug", async ({ params, set }) => {
    const locale = params.locale as "en" | "ar";
    const { slug } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.locale, locale),
          eq(posts.slug, slug),
          eq(posts.status, "published")
        )
      )
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Fetch categories for this post
    const postCats = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(postCategories)
      .innerJoin(categories, eq(postCategories.categoryId, categories.id))
      .where(eq(postCategories.postId, post.id));

    // Fetch tags for this post
    const postTagsList = await db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
      })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(postTags.postId, post.id));

    return { data: { ...post, categories: postCats, tags: postTagsList } };
  })

  // GET /posts/public/:locale — List published posts with pagination
  .get("/posts/public/:locale", async ({ params, query }) => {
    const locale = params.locale as "en" | "ar";
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize as string) || 12);
    const offset = (page - 1) * pageSize;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(eq(posts.locale, locale), eq(posts.status, "published"))
      );

    const total = countResult?.count ?? 0;

    const results = await db
      .select({
        id: posts.id,
        title: posts.title,
        slug: posts.slug,
        excerpt: posts.excerpt,
        featuredImage: posts.featuredImage,
        publishedAt: posts.publishedAt,
        postType: posts.postType,
        locale: posts.locale,
        namespace: posts.namespace,
      })
      .from(posts)
      .where(
        and(eq(posts.locale, locale), eq(posts.status, "published"))
      )
      .orderBy(sql`${posts.publishedAt} DESC NULLS LAST`)
      .limit(pageSize)
      .offset(offset);

    // Fetch categories for each post
    const postsWithCategories = await Promise.all(
      results.map(async (post) => {
        const postCats = await db
          .select({
            id: categories.id,
            name: categories.name,
            slug: categories.slug,
          })
          .from(postCategories)
          .innerJoin(categories, eq(postCategories.categoryId, categories.id))
          .where(eq(postCategories.postId, post.id));

        return { ...post, categories: postCats };
      })
    );

    return {
      data: postsWithCategories,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  });


// ── Read-only routes (no auth required for admin reads) ──────────────────────

const readPosts = new Elysia({ name: "posts-read" })
  // GET /posts/trash — List trashed posts (must be before /posts/:id)
  .get("/posts/trash", async () => {
    // Read retention days from site_settings
    const [retentionSetting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, "blog_trash_retention_days"))
      .limit(1);

    const retentionDays = retentionSetting
      ? parseInt(retentionSetting.value) || 3
      : 3;

    const trashedPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.status, "trashed"))
      .orderBy(sql`${posts.trashedAt} DESC NULLS LAST`);

    const now = new Date();
    const data = trashedPosts.map((post) => {
      const trashedAt = post.trashedAt ? new Date(post.trashedAt) : now;
      const daysSinceTrashed = Math.floor(
        (now.getTime() - trashedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysRemaining = Math.max(0, retentionDays - daysSinceTrashed);

      return {
        ...post,
        daysRemaining,
      };
    });

    return { data };
  })

  // GET /posts — List non-trashed posts grouped by namespace
  .get("/posts", async ({ query }) => {
    const { locale, status, postType } = query as {
      locale?: "en" | "ar";
      status?: "draft" | "published";
      postType?: "blog" | "news";
    };

    const conditions = [ne(posts.status, "trashed")];
    if (locale) conditions.push(eq(posts.locale, locale));
    if (status) conditions.push(eq(posts.status, status));
    if (postType) conditions.push(eq(posts.postType, postType));

    const allPosts = await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(posts.createdAt);

    // Group by namespace for PostNamespaceGroup[] format
    const groupMap = new Map<string, PostNamespaceGroup>();

    for (const post of allPosts) {
      let group = groupMap.get(post.namespace);
      if (!group) {
        group = {
          namespace: post.namespace,
          slug: post.slug,
          postType: post.postType as PostType,
          locales: {},
        };
        groupMap.set(post.namespace, group);
      }

      const localeKey = post.locale as "en" | "ar";
      group.locales[localeKey] = {
        id: post.id,
        title: post.title,
        status: post.status as PostStatus,
      };
    }

    return { data: Array.from(groupMap.values()) };
  })

  // GET /posts/:id — Get single post with all fields including SEO, categories, tags
  .get("/posts/:id", async ({ params, set }) => {
    const { id } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Fetch categories
    const postCats = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(postCategories)
      .innerJoin(categories, eq(postCategories.categoryId, categories.id))
      .where(eq(postCategories.postId, post.id));

    // Fetch tags
    const postTagsList = await db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
      })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(postTags.postId, post.id));

    return { data: { ...post, categories: postCats, tags: postTagsList } };
  });


// ── Protected routes (auth required) ─────────────────────────────────────────

const protectedPosts = new Elysia({ name: "posts-protected" })
  .use(authGuard)

  // POST /posts — Create post
  .post("/posts", async ({ body, userId, set }) => {
    const {
      title,
      postType,
      locale,
      content,
      excerpt,
      featuredImage,
      metaTitle,
      metaDescription,
      metaKeywords,
      ogImage,
      canonicalUrl,
      robotsDirective,
    } = body as {
      title?: string;
      postType?: "blog" | "news";
      locale?: Locale;
      content?: unknown;
      excerpt?: string;
      featuredImage?: string;
      metaTitle?: string;
      metaDescription?: string;
      metaKeywords?: string;
      ogImage?: string;
      canonicalUrl?: string;
      robotsDirective?: string;
    };

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      set.status = 400;
      return { error: "Title is required" };
    }

    const postLocale: Locale = locale ?? "en";
    const postPostType = postType ?? "blog";

    // Generate slug and ensure uniqueness within locale
    const baseSlug = generateSlug(title);
    const existingSlugs = (
      await db
        .select({ slug: posts.slug })
        .from(posts)
        .where(eq(posts.locale, postLocale))
    ).map((r) => r.slug);

    const slug = ensureUniqueSlug(baseSlug, existingSlugs);
    const namespace = crypto.randomUUID();

    const [created] = await db
      .insert(posts)
      .values({
        title: title.trim(),
        slug,
        locale: postLocale,
        namespace,
        postType: postPostType,
        status: "draft",
        content: content ?? null,
        excerpt: excerpt ?? null,
        featuredImage: featuredImage ?? null,
        metaTitle: metaTitle ?? null,
        metaDescription: metaDescription ?? null,
        metaKeywords: metaKeywords ?? null,
        ogImage: ogImage ?? null,
        canonicalUrl: canonicalUrl ?? null,
        robotsDirective: robotsDirective ?? "index, follow",
        authorId: userId,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "post",
      entityId: created.id,
      summary: `Created post "${created.title}" (${created.locale})`,
    });

    set.status = 201;
    return { data: created };
  })

  // PUT /posts/:id — Update post (creates revision first)
  .put("/posts/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const {
      title,
      slug,
      content,
      excerpt,
      featuredImage,
      metaTitle,
      metaDescription,
      metaKeywords,
      ogImage,
      canonicalUrl,
      robotsDirective,
    } = body as {
      title?: string;
      slug?: string;
      content?: unknown;
      excerpt?: string;
      featuredImage?: string;
      metaTitle?: string;
      metaDescription?: string;
      metaKeywords?: string;
      ogImage?: string;
      canonicalUrl?: string;
      robotsDirective?: string;
    };

    // Fetch current post
    const [existing] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Create revision with PREVIOUS data before updating
    const [lastRevision] = await db
      .select({ revisionNumber: postRevisions.revisionNumber })
      .from(postRevisions)
      .where(eq(postRevisions.postId, id))
      .orderBy(sql`${postRevisions.revisionNumber} DESC`)
      .limit(1);

    const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

    await db.insert(postRevisions).values({
      postId: id,
      userId,
      data: {
        content: existing.content,
        excerpt: existing.excerpt,
        featuredImage: existing.featuredImage,
        metaTitle: existing.metaTitle,
        metaDescription: existing.metaDescription,
        metaKeywords: existing.metaKeywords,
        ogImage: existing.ogImage,
        canonicalUrl: existing.canonicalUrl,
        robotsDirective: existing.robotsDirective,
      },
      titleSnapshot: existing.title,
      slugSnapshot: existing.slug,
      action: "save",
      revisionNumber: nextRevisionNumber,
    });

    // Build update payload
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) updates.title = title;
    if (slug !== undefined) updates.slug = slug;
    if (content !== undefined) updates.content = content;
    if (excerpt !== undefined) updates.excerpt = excerpt;
    if (featuredImage !== undefined) updates.featuredImage = featuredImage;
    if (metaTitle !== undefined) updates.metaTitle = metaTitle;
    if (metaDescription !== undefined) updates.metaDescription = metaDescription;
    if (metaKeywords !== undefined) updates.metaKeywords = metaKeywords;
    if (ogImage !== undefined) updates.ogImage = ogImage;
    if (canonicalUrl !== undefined) updates.canonicalUrl = canonicalUrl;
    if (robotsDirective !== undefined) updates.robotsDirective = robotsDirective;

    const [updated] = await db
      .update(posts)
      .set(updates)
      .where(eq(posts.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "post",
      entityId: id,
      summary: `Updated post "${updated.title}"`,
    });

    // Sync to AI knowledge base if post is published (fire-and-forget)
    if (updated.status === "published") {
      try {
        syncBlogPost(db, id, "update").catch((err) =>
          console.error("[Content Sync] Failed to sync updated post:", err)
        );
      } catch (err) {
        console.error("[Content Sync] Failed to trigger sync for updated post:", err);
      }
    }

    return { data: updated };
  })

  // DELETE /posts/:id — Soft delete (move to trash)
  .delete("/posts/:id", async ({ params, userId, set }) => {
    const { id } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    const [updated] = await db
      .update(posts)
      .set({
        status: "trashed",
        trashedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "trash",
      entityType: "post",
      entityId: id,
      summary: `Trashed post "${post.title}" (${post.locale})`,
    });

    // Sync to AI knowledge base — remove from KB (fire-and-forget)
    try {
      syncBlogPost(db, id, "delete").catch((err) =>
        console.error("[Content Sync] Failed to sync trashed post:", err)
      );
    } catch (err) {
      console.error("[Content Sync] Failed to trigger sync for trashed post:", err);
    }

    return { data: updated };
  })

  // POST /posts/:id/restore — Restore from trash
  .post("/posts/:id/restore", async ({ params, userId, set }) => {
    const { id } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    const [updated] = await db
      .update(posts)
      .set({
        status: "draft",
        trashedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "restore",
      entityType: "post",
      entityId: id,
      summary: `Restored post "${post.title}" (${post.locale})`,
    });

    return { data: updated };
  })

  // DELETE /posts/:id/permanent — Hard delete from trash
  .delete("/posts/:id/permanent", async ({ params, userId, set }) => {
    const { id } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Hard delete — cascade will remove postCategories, postTags, postRevisions, postViews, postShares
    await db.delete(posts).where(eq(posts.id, id));

    // Sync to AI knowledge base — remove from KB on permanent delete (fire-and-forget)
    try {
      syncBlogPost(db, id, "delete").catch((err) =>
        console.error("[Content Sync] Failed to sync permanently deleted post:", err)
      );
    } catch (err) {
      console.error("[Content Sync] Failed to trigger sync for permanently deleted post:", err);
    }

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "post",
      entityId: id,
      summary: `Permanently deleted post "${post.title}" (${post.locale})`,
    });

    return { data: { success: true } };
  })

  // POST /posts/:id/publish — Publish post (with publication gate)
  .post("/posts/:id/publish", async ({ params, userId, set }) => {
    const { id } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Determine content module from post type
    const contentModule = (post.postType === "news" ? "news" : "blog") as ContentModule;

    // Check publication gate
    const gateResult = await checkPublicationGate(db, id, contentModule, userId);

    if (!gateResult.allowed) {
      set.status = 202;
      return { data: { approvalRequestId: gateResult.approvalRequestId, message: gateResult.reason } };
    }

    const [updated] = await db
      .update(posts)
      .set({
        status: "published",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "publish",
      entityType: "post",
      entityId: id,
      summary: `Published post "${post.title}" (${post.locale})`,
    });

    // Sync to AI knowledge base on publish (fire-and-forget)
    try {
      syncBlogPost(db, id, "publish").catch((err) =>
        console.error("[Content Sync] Failed to sync published post:", err)
      );
    } catch (err) {
      console.error("[Content Sync] Failed to trigger sync for published post:", err);
    }

    return { data: updated };
  })

  // POST /posts/:id/unpublish — Unpublish post
  .post("/posts/:id/unpublish", async ({ params, userId, set }) => {
    const { id } = params;

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    const [updated] = await db
      .update(posts)
      .set({
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "unpublish",
      entityType: "post",
      entityId: id,
      summary: `Unpublished post "${post.title}" (${post.locale})`,
    });

    // Sync to AI knowledge base — remove from KB on unpublish (fire-and-forget)
    try {
      syncBlogPost(db, id, "delete").catch((err) =>
        console.error("[Content Sync] Failed to sync unpublished post:", err)
      );
    } catch (err) {
      console.error("[Content Sync] Failed to trigger sync for unpublished post:", err);
    }

    return { data: updated };
  })

  // POST /posts/:id/clone-locale — Clone post to AR locale
  .post("/posts/:id/clone-locale", async ({ params, userId, set }) => {
    const { id } = params;

    const [source] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!source) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Check if AR version already exists for this namespace
    const [existingAr] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.namespace, source.namespace),
          eq(posts.locale, "ar")
        )
      )
      .limit(1);

    if (existingAr) {
      set.status = 409;
      return { error: "AR locale version already exists for this namespace" };
    }

    const [cloned] = await db
      .insert(posts)
      .values({
        title: source.title,
        slug: source.slug,
        locale: "ar",
        namespace: source.namespace,
        postType: source.postType,
        status: "draft",
        content: source.content,
        excerpt: source.excerpt,
        featuredImage: source.featuredImage,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        metaKeywords: source.metaKeywords,
        ogImage: source.ogImage,
        canonicalUrl: source.canonicalUrl,
        robotsDirective: source.robotsDirective,
        authorId: userId,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "post",
      entityId: cloned.id,
      summary: `Cloned post "${source.title}" to AR locale`,
    });

    set.status = 201;
    return { data: cloned };
  })

  // PUT /posts/:id/categories — Replace post's category assignments
  .put("/posts/:id/categories", async ({ params, body, set }) => {
    const { id } = params;
    const { categoryIds } = body as { categoryIds?: string[] };

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Delete existing category assignments
    await db.delete(postCategories).where(eq(postCategories.postId, id));

    // Insert new category assignments
    if (categoryIds && categoryIds.length > 0) {
      await db.insert(postCategories).values(
        categoryIds.map((categoryId) => ({
          postId: id,
          categoryId,
        }))
      );
    }

    return { data: { success: true } };
  })

  // PUT /posts/:id/tags — Replace post's tag assignments
  .put("/posts/:id/tags", async ({ params, body, set }) => {
    const { id } = params;
    const { tagIds } = body as { tagIds?: string[] };

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    // Delete existing tag assignments
    await db.delete(postTags).where(eq(postTags.postId, id));

    // Insert new tag assignments
    if (tagIds && tagIds.length > 0) {
      await db.insert(postTags).values(
        tagIds.map((tagId) => ({
          postId: id,
          tagId,
        }))
      );
    }

    return { data: { success: true } };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const postsRoutes = new Elysia({ name: "posts" })
  .use(publicPosts)
  .use(readPosts)
  .use(protectedPosts);
