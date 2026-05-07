import { Elysia } from "elysia";
import { eq, and, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import { pages, revisions, approvalConfig } from "../../schema";
import { siteSettings } from "../../schema";
import { db } from "../../db";
import type { Locale, PageNamespaceGroup, PageStatus } from "../../types";
import { generateSlug, ensureUniqueSlug } from "../../utils/slug";
import { logAudit } from "../../audit";
import { checkPublicationGate } from "../../approval/gate";
import {
  getActiveApprovalRequest,
  updatePendingData,
  resetDecisions,
  createApprovalRequestWithDraft,
} from "../../approval/service";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicPages = new Elysia({ name: "pages-public" })
  .get("/pages/public/:locale/:slug", async ({ params, set }) => {
    const locale = params.locale as "en" | "ar";
    const { slug } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.locale, locale),
          eq(pages.slug, slug),
          eq(pages.status, "published")
        )
      )
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    return { data: page };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedPages = new Elysia({ name: "pages-protected" })
  .use(authGuard)

  // POST /pages — Create page
  .post("/pages", async ({ body, userId, set }) => {
    const { title, locale, data, metaTitle, metaDescription } = body as {
      title?: string;
      locale?: Locale;
      data?: unknown;
      metaTitle?: string;
      metaDescription?: string;
    };

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      set.status = 400;
      return { error: "Title is required" };
    }

    const pageLocale: Locale = locale ?? "en";
    const pageData = data ?? { root: { props: {} }, content: [] };

    // Generate slug and ensure uniqueness within locale
    const baseSlug = generateSlug(title);
    const existingSlugs = (
      await db
        .select({ slug: pages.slug })
        .from(pages)
        .where(eq(pages.locale, pageLocale))
    ).map((r) => r.slug);

    const slug = ensureUniqueSlug(baseSlug, existingSlugs);
    const namespace = crypto.randomUUID();

    const [created] = await db
      .insert(pages)
      .values({
        title: title.trim(),
        slug,
        locale: pageLocale,
        namespace,
        status: "draft",
        data: pageData,
        metaTitle: metaTitle ?? null,
        metaDescription: metaDescription ?? null,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "page",
      entityId: created.id,
      summary: `Created page "${created.title}" (${created.locale})`,
    });

    // Auto-set first page as home page if no home page exists yet
    const [existingHome] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, "home_page_id"))
      .limit(1);

    if (!existingHome) {
      await db.insert(siteSettings).values({
        key: "home_page_id",
        value: created.id,
      });
    }

    set.status = 201;
    return { data: created };
  })

  // PUT /pages/:id — Update page + create revision (or route to pending draft)
  .put("/pages/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { title, slug, data, metaTitle, metaDescription } = body as {
      title?: string;
      slug?: string;
      data?: unknown;
      metaTitle?: string;
      metaDescription?: string;
    };

    // Fetch current page
    const [existing] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Page not found" };
    }

    // Check if approval is enabled for "pages" module
    let approvalEnabled = false;
    try {
      const [config] = await db
        .select()
        .from(approvalConfig)
        .where(eq(approvalConfig.contentModule, "pages"))
        .limit(1);
      approvalEnabled = !!config?.enabled;
    } catch {
      // Table doesn't exist or query failed — treat as disabled
    }

    if (approvalEnabled) {
      // Route save to pending draft
      const activeRequest = await getActiveApprovalRequest(db, id, "pages");

      if (activeRequest) {
        // Update existing request's pendingData and reset decisions
        await updatePendingData(db, activeRequest.id, data);
        await resetDecisions(db, activeRequest.id);

        await logAudit(db, {
          userId,
          action: "update",
          entityType: "page",
          entityId: id,
          summary: `Updated pending draft for page "${existing.title}"`,
        });

        await logAudit(db, {
          userId,
          action: "approval_decide",
          entityType: "approval_request",
          entityId: activeRequest.id,
          summary: `Decisions reset for page "${existing.title}" — draft was re-edited, re-review required`,
        });

        return { data: existing, pendingDraft: true, approvalRequestId: activeRequest.id };
      } else {
        // Create new approval request with pendingData
        const request = await createApprovalRequestWithDraft(db, id, "pages", userId, data);

        // Only flip status to pending_review for draft pages. A page that's
        // already published must stay published — its live pages.data is
        // unchanged; the in-flight edits live separately on the approval
        // request's pendingData and only commit when the chain approves.
        if (existing.status !== "published") {
          await db
            .update(pages)
            .set({ status: "pending_review", updatedAt: new Date() })
            .where(eq(pages.id, id));
        } else {
          await db
            .update(pages)
            .set({ updatedAt: new Date() })
            .where(eq(pages.id, id));
        }

        await logAudit(db, {
          userId,
          action: "approval_submit",
          entityType: "page",
          entityId: id,
          summary: `Submitted page "${existing.title}" for approval with pending draft`,
        });

        const [updatedPage] = await db
          .select()
          .from(pages)
          .where(eq(pages.id, id))
          .limit(1);

        return { data: updatedPage, pendingDraft: true, approvalRequestId: request.id };
      }
    }

    // Approval disabled — existing behavior: save directly to pages.data + create revision
    // Create revision with PREVIOUS data before updating
    const [lastRevision] = await db
      .select({ revisionNumber: revisions.revisionNumber })
      .from(revisions)
      .where(eq(revisions.pageId, id))
      .orderBy(sql`${revisions.revisionNumber} DESC`)
      .limit(1);

    const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

    await db.insert(revisions).values({
      pageId: id,
      userId,
      data: existing.data,
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
    if (data !== undefined) updates.data = data;
    if (metaTitle !== undefined) updates.metaTitle = metaTitle;
    if (metaDescription !== undefined) updates.metaDescription = metaDescription;

    const [updated] = await db
      .update(pages)
      .set(updates)
      .where(eq(pages.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "page",
      entityId: id,
      summary: `Updated page "${updated.title}"`,
    });

    return { data: updated };
  })

  // DELETE /pages/:id — Delete page
  .delete("/pages/:id", async ({ params, userId, set }) => {
    const { id } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    if (page.isSystem) {
      set.status = 403;
      return { error: "System pages cannot be deleted" };
    }

    await db.delete(pages).where(eq(pages.id, id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "page",
      entityId: id,
      summary: `Deleted page "${page.title}" (${page.locale})`,
    });

    return { data: { success: true } };
  })

  // POST /pages/:id/publish — Publish page (with publication gate)
  .post("/pages/:id/publish", async ({ params, userId, set }) => {
    const { id } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    // Check publication gate
    const gateResult = await checkPublicationGate(db, id, "pages", userId, page.data);

    if (!gateResult.allowed) {
      set.status = 202;
      return { data: { approvalRequestId: gateResult.approvalRequestId, message: gateResult.reason } };
    }

    const [updated] = await db
      .update(pages)
      .set({
        status: "published",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pages.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "publish",
      entityType: "page",
      entityId: id,
      summary: `Published page "${page.title}" (${page.locale})`,
    });

    return { data: updated };
  })

  // POST /pages/:id/unpublish — Unpublish page
  .post("/pages/:id/unpublish", async ({ params, userId, set }) => {
    const { id } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    const [updated] = await db
      .update(pages)
      .set({
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(pages.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "unpublish",
      entityType: "page",
      entityId: id,
      summary: `Unpublished page "${page.title}" (${page.locale})`,
    });

    return { data: updated };
  })

  // POST /pages/:id/clone-locale — Clone to AR locale
  .post("/pages/:id/clone-locale", async ({ params, userId, set }) => {
    const { id } = params;

    const [source] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!source) {
      set.status = 404;
      return { error: "Page not found" };
    }

    // The clone target locale is always the *other* locale in the namespace,
    // so EN → AR and AR → EN both work from the same button.
    const targetLocale: Locale = source.locale === "ar" ? "en" : "ar";

    // Refuse if the namespace already has a page in the target locale —
    // this is the documented "already translated" case (the UI already
    // hides the button in that situation; this is the server-side guard).
    const [existingTarget] = await db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.namespace, source.namespace),
          eq(pages.locale, targetLocale)
        )
      )
      .limit(1);

    if (existingTarget) {
      set.status = 409;
      return {
        error: `${targetLocale.toUpperCase()} version already exists for this page`,
        data: existingTarget,
      };
    }

    // Multilingual slug strategy:
    //   /en/about  + /ar/about    ← preferred (same slug per locale)
    //   /en/about  + /ar/about-2  ← fallback only if AR already used "about"
    //                                in a *different* namespace.
    //
    // The DB has a unique index on (slug, locale), so cross-locale
    // duplicates are allowed by design. We only suffix when there is
    // a real collision inside the target locale, and we retry inside
    // a small loop to absorb races between the SELECT below and the
    // INSERT (a parallel clone request could grab the slug first).
    const existingTargetSlugs = (
      await db
        .select({ slug: pages.slug })
        .from(pages)
        .where(eq(pages.locale, targetLocale))
    ).map((p) => p.slug);

    const baseSlug = source.slug;
    let attemptSlug = ensureUniqueSlug(baseSlug, existingTargetSlugs);

    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const [cloned] = await db
          .insert(pages)
          .values({
            title: source.title,
            slug: attemptSlug,
            locale: targetLocale,
            namespace: source.namespace,
            status: "draft",
            isSystem: source.isSystem,
            data: source.data ?? { root: { props: {} }, content: [] },
            metaTitle: source.metaTitle,
            metaDescription: source.metaDescription,
            metaKeywords: source.metaKeywords,
            ogImage: source.ogImage,
            canonicalUrl: source.canonicalUrl,
            robotsDirective: source.robotsDirective,
          })
          .returning();

        await logAudit(db, {
          userId,
          action: "create",
          entityType: "page",
          entityId: cloned.id,
          summary: `Cloned page "${source.title}" from ${source.locale.toUpperCase()} to ${targetLocale.toUpperCase()}`,
        });

        set.status = 201;
        return { data: cloned };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isUniqueViolation =
          message.includes("duplicate") ||
          message.includes("unique") ||
          message.includes("pages_slug_locale_idx");

        if (!isUniqueViolation) throw err;

        // Another request grabbed the slug between our SELECT and INSERT.
        // Bump the suffix and try again.
        existingTargetSlugs.push(attemptSlug);
        attemptSlug = ensureUniqueSlug(baseSlug, existingTargetSlugs);
      }
    }

    set.status = 409;
    return {
      error: `Could not allocate a unique ${targetLocale.toUpperCase()} slug for "${source.slug}" after ${MAX_RETRIES} attempts`,
    };
  })

  // POST /pages/:id/set-home — Set page as home page
  .post("/pages/:id/set-home", async ({ params, userId, set }) => {
    const { id } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    // Upsert the home_page_id setting
    const [existing] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, "home_page_id"))
      .limit(1);

    if (existing) {
      await db
        .update(siteSettings)
        .set({ value: id, updatedAt: new Date() })
        .where(eq(siteSettings.key, "home_page_id"));
    } else {
      await db.insert(siteSettings).values({
        key: "home_page_id",
        value: id,
      });
    }

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "settings",
      entityId: "home_page_id",
      summary: `Set page "${page.title}" as home page`,
    });

    return { data: { success: true, homePageId: id } };
  })

  // GET /pages/:id/pending-draft — Return pendingData from active approval request
  .get("/pages/:id/pending-draft", async ({ params, set }) => {
    const { id } = params;

    const activeRequest = await getActiveApprovalRequest(db, id, "pages");

    if (!activeRequest || !activeRequest.pendingData) {
      set.status = 404;
      return { error: "No pending draft" };
    }

    return { data: activeRequest.pendingData };
  })

  // GET /pages/:id/live-data — Return current pages.data regardless of approval status
  .get("/pages/:id/live-data", async ({ params, set }) => {
    const { id } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    return { data: page.data };
  });

// ── Read-only routes (no auth required) ──────────────────────────────────────

const readPages = new Elysia({ name: "pages-read" })
  // GET /pages — List pages with optional filters
  .get("/pages", async ({ query }) => {
    const { locale, status, namespace } = query as {
      locale?: "en" | "ar";
      status?: "draft" | "published";
      namespace?: string;
    };

    // Build conditions
    const conditions = [];
    if (locale) conditions.push(eq(pages.locale, locale));
    if (status) conditions.push(eq(pages.status, status));
    if (namespace) conditions.push(eq(pages.namespace, namespace));

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const allPages = await db
      .select()
      .from(pages)
      .where(whereClause)
      .orderBy(pages.createdAt);

    // Group by namespace for admin PageNamespaceGroup[] format
    const groupMap = new Map<string, PageNamespaceGroup>();

    for (const page of allPages) {
      let group = groupMap.get(page.namespace);
      if (!group) {
        group = {
          namespace: page.namespace,
          slug: page.slug,
          isSystem: page.isSystem,
          locales: {},
        };
        groupMap.set(page.namespace, group);
      }

      const localeKey = page.locale as "en" | "ar";
      group.locales[localeKey] = {
        id: page.id,
        title: page.title,
        status: page.status as PageStatus,
      };
    }

    return { data: Array.from(groupMap.values()) };
  })

  // GET /pages/:id — Get single page
  .get("/pages/:id", async ({ params, set }) => {
    const { id } = params;

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      set.status = 404;
      return { error: "Page not found" };
    }

    // Check if there's an active pending approval request with pendingData
    const activeRequest = await getActiveApprovalRequest(db, id, "pages");
    const hasPendingDraft = !!(activeRequest && activeRequest.pendingData != null);

    return { data: page, hasPendingDraft };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const pagesRoutes = new Elysia({ name: "pages" })
  .use(publicPages)
  .use(readPages)
  .use(protectedPages);
