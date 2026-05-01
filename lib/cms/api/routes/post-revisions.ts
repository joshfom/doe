import { Elysia } from "elysia";
import { eq, desc, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import { posts, postRevisions } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicPostRevisions = new Elysia({ name: "post-revisions-public" })
  // GET /posts/:id/revisions — List revisions for a post
  .get("/posts/:id/revisions", async ({ params, set }) => {
    const { id } = params;

    // Verify post exists
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    const revisionList = await db
      .select({
        id: postRevisions.id,
        revisionNumber: postRevisions.revisionNumber,
        action: postRevisions.action,
        titleSnapshot: postRevisions.titleSnapshot,
        createdAt: postRevisions.createdAt,
        userId: postRevisions.userId,
      })
      .from(postRevisions)
      .where(eq(postRevisions.postId, id))
      .orderBy(desc(postRevisions.revisionNumber));

    return { data: revisionList };
  })

  // GET /posts/:id/revisions/:revisionId — Get single revision with full data snapshot
  .get("/posts/:id/revisions/:revisionId", async ({ params, set }) => {
    const { id, revisionId } = params;

    const [revision] = await db
      .select()
      .from(postRevisions)
      .where(eq(postRevisions.id, revisionId))
      .limit(1);

    if (!revision || revision.postId !== id) {
      set.status = 404;
      return { error: "Revision not found" };
    }

    return { data: revision };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedPostRevisions = new Elysia({ name: "post-revisions-protected" })
  .use(authGuard)

  // POST /posts/:id/revisions/:revisionId/rollback — Rollback to a revision
  .post(
    "/posts/:id/revisions/:revisionId/rollback",
    async ({ params, userId, set }) => {
      const { id, revisionId } = params;

      // Fetch the target revision
      const [targetRevision] = await db
        .select()
        .from(postRevisions)
        .where(eq(postRevisions.id, revisionId))
        .limit(1);

      if (!targetRevision || targetRevision.postId !== id) {
        set.status = 404;
        return { error: "Revision not found" };
      }

      // Fetch the current post
      const [post] = await db
        .select()
        .from(posts)
        .where(eq(posts.id, id))
        .limit(1);

      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }

      // Get next revision number
      const [lastRevision] = await db
        .select({ revisionNumber: postRevisions.revisionNumber })
        .from(postRevisions)
        .where(eq(postRevisions.postId, id))
        .orderBy(sql`${postRevisions.revisionNumber} DESC`)
        .limit(1);

      const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

      // Create a revision of the CURRENT state before rollback (undo point)
      await db.insert(postRevisions).values({
        postId: id,
        userId,
        data: {
          content: post.content,
          excerpt: post.excerpt,
          featuredImage: post.featuredImage,
          metaTitle: post.metaTitle,
          metaDescription: post.metaDescription,
          metaKeywords: post.metaKeywords,
          ogImage: post.ogImage,
          canonicalUrl: post.canonicalUrl,
          robotsDirective: post.robotsDirective,
        },
        titleSnapshot: post.title,
        slugSnapshot: post.slug,
        action: "rollback",
        revisionNumber: nextRevisionNumber,
      });

      // Extract snapshot data from the target revision
      const snapshot = targetRevision.data as Record<string, unknown>;

      // Overwrite post content/SEO with target revision's snapshot, plus title and slug
      const [updated] = await db
        .update(posts)
        .set({
          title: targetRevision.titleSnapshot,
          slug: targetRevision.slugSnapshot,
          content: snapshot.content ?? null,
          excerpt: (snapshot.excerpt as string) ?? null,
          featuredImage: (snapshot.featuredImage as string) ?? null,
          metaTitle: (snapshot.metaTitle as string) ?? null,
          metaDescription: (snapshot.metaDescription as string) ?? null,
          metaKeywords: (snapshot.metaKeywords as string) ?? null,
          ogImage: (snapshot.ogImage as string) ?? null,
          canonicalUrl: (snapshot.canonicalUrl as string) ?? null,
          robotsDirective: (snapshot.robotsDirective as string) ?? null,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, id))
        .returning();

      // Log audit entry
      await logAudit(db, {
        userId,
        action: "rollback",
        entityType: "post",
        entityId: id,
        summary: `Rolled back post "${updated.title}" to revision #${targetRevision.revisionNumber}`,
      });

      return { data: updated };
    }
  );

// ── Combine and export ───────────────────────────────────────────────────────

export const postRevisionsRoutes = new Elysia({ name: "post-revisions" })
  .use(publicPostRevisions)
  .use(protectedPostRevisions);
