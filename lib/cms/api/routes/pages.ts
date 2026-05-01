import { Elysia } from "elysia";
import { eq, and, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import { pages, revisions } from "../../schema";
import { siteSettings } from "../../schema";
import { db } from "../../db";
import type { Locale, PageNamespaceGroup, PageStatus } from "../../types";
import { generateSlug, ensureUniqueSlug } from "../../utils/slug";
import { logAudit } from "../../audit";
import { checkPublicationGate } from "../../approval/gate";

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

  // PUT /pages/:id — Update page + create revision
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
    const gateResult = await checkPublicationGate(db, id, "pages", userId);

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

    // Check if AR version already exists for this namespace
    const [existingAr] = await db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.namespace, source.namespace),
          eq(pages.locale, "ar")
        )
      )
      .limit(1);

    if (existingAr) {
      set.status = 409;
      return { error: "AR locale version already exists for this namespace" };
    }

    const [cloned] = await db
      .insert(pages)
      .values({
        title: source.title,
        slug: source.slug,
        locale: "ar",
        namespace: source.namespace,
        status: "draft",
        isSystem: source.isSystem,
        data: source.data,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "page",
      entityId: cloned.id,
      summary: `Cloned page "${source.title}" to AR locale`,
    });

    set.status = 201;
    return { data: cloned };
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

    return { data: page };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const pagesRoutes = new Elysia({ name: "pages" })
  .use(publicPages)
  .use(readPages)
  .use(protectedPages);
