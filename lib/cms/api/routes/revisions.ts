import { Elysia } from "elysia";
import { eq, desc, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import { pages, revisions } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicRevisions = new Elysia({ name: "revisions-public" })
  // GET /revisions/:pageId — List revisions for a page
  .get("/revisions/:pageId", async ({ params, set }) => {
    const { pageId } = params;

    // Verify page exists
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    const revisionList = await db
      .select({
        id: revisions.id,
        revisionNumber: revisions.revisionNumber,
        action: revisions.action,
        createdAt: revisions.createdAt,
        userId: revisions.userId,
      })
      .from(revisions)
      .where(eq(revisions.pageId, pageId))
      .orderBy(desc(revisions.revisionNumber));

    return { data: revisionList };
  })

  // GET /revisions/:pageId/:revisionId — Get single revision with full snapshot
  .get("/revisions/:pageId/:revisionId", async ({ params, set }) => {
    const { pageId, revisionId } = params;

    const [revision] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, revisionId))
      .limit(1);

    if (!revision || revision.pageId !== pageId) {
      set.status = 404;
      return { error: "Revision not found" };
    }

    return { data: revision };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedRevisions = new Elysia({ name: "revisions-protected" })
  .use(authGuard)

  // POST /revisions/:pageId/rollback/:revisionId — Rollback to a revision
  .post(
    "/revisions/:pageId/rollback/:revisionId",
    async ({ params, userId, set }) => {
      const { pageId, revisionId } = params;

      // Fetch the target revision
      const [targetRevision] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.id, revisionId))
        .limit(1);

      if (!targetRevision || targetRevision.pageId !== pageId) {
        set.status = 404;
        return { error: "Revision not found" };
      }

      // Fetch the current page
      const [page] = await db
        .select()
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);

      if (!page) {
        set.status = 404;
        return { error: "Page not found" };
      }

      // Replace page data with revision snapshot
      const [updated] = await db
        .update(pages)
        .set({
          data: targetRevision.data,
          title: targetRevision.titleSnapshot,
          slug: targetRevision.slugSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, pageId))
        .returning();

      // Get next revision number
      const [lastRevision] = await db
        .select({ revisionNumber: revisions.revisionNumber })
        .from(revisions)
        .where(eq(revisions.pageId, pageId))
        .orderBy(sql`${revisions.revisionNumber} DESC`)
        .limit(1);

      const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

      // Create a new revision with action="rollback"
      await db.insert(revisions).values({
        pageId,
        userId,
        data: targetRevision.data,
        titleSnapshot: targetRevision.titleSnapshot,
        slugSnapshot: targetRevision.slugSnapshot,
        action: "rollback",
        revisionNumber: nextRevisionNumber,
      });

      // Create audit entry
      await logAudit(db, {
        userId,
        action: "rollback",
        entityType: "page",
        entityId: pageId,
        summary: `Rolled back page "${updated.title}" to revision #${targetRevision.revisionNumber}`,
      });

      return { data: updated };
    }
  );

// ── Combine and export ───────────────────────────────────────────────────────

export const revisionsRoutes = new Elysia({ name: "revisions" })
  .use(publicRevisions)
  .use(protectedRevisions);
