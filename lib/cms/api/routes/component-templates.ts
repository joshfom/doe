import { Elysia } from "elysia";
import { eq, desc } from "drizzle-orm";
import { authGuard } from "../auth";
import { db } from "../../db";
import { componentTemplates } from "../../schema";
import { logAudit } from "../../audit";

// ── Public routes ────────────────────────────────────────────────────────────
//
// Built-in templates live client-side (in lib/page-builder/templates/
// component-templates.ts). This endpoint exposes only the user-saved ones
// stored in the database.

const publicTemplates = new Elysia({ name: "component-templates-public" })
  .get("/component-templates", async () => {
    const rows = await db
      .select()
      .from(componentTemplates)
      .orderBy(desc(componentTemplates.updatedAt));
    return { data: rows };
  })
  .get("/component-templates/:id", async ({ params, set }) => {
    const [row] = await db
      .select()
      .from(componentTemplates)
      .where(eq(componentTemplates.id, params.id))
      .limit(1);

    if (!row) {
      set.status = 404;
      return { error: "Template not found" };
    }
    return { data: row };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

interface SaveTemplateBody {
  name?: string;
  description?: string;
  scope?: "block" | "page";
  thumbnail?: string | null;
  content?: unknown;
  zones?: unknown;
}

const protectedTemplates = new Elysia({ name: "component-templates-protected" })
  .use(authGuard)

  .post("/component-templates", async ({ body, userId, set }) => {
    const {
      name,
      description = "",
      scope = "block",
      thumbnail = null,
      content,
      zones = {},
    } = body as SaveTemplateBody;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      set.status = 400;
      return { error: "Template name is required" };
    }
    if (!content || !Array.isArray(content)) {
      set.status = 400;
      return { error: "Template content must be an array of components" };
    }
    if (scope !== "block" && scope !== "page") {
      set.status = 400;
      return { error: "Scope must be 'block' or 'page'" };
    }

    const [created] = await db
      .insert(componentTemplates)
      .values({
        name: name.trim(),
        description,
        scope,
        thumbnail,
        content,
        zones: zones ?? {},
        isBuiltIn: false,
        createdBy: userId,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "component_template",
      entityId: created.id,
      summary: `Created template "${created.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  .put("/component-templates/:id", async ({ params, body, userId, set }) => {
    const updates = body as SaveTemplateBody;

    const [existing] = await db
      .select()
      .from(componentTemplates)
      .where(eq(componentTemplates.id, params.id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Template not found" };
    }
    if (existing.isBuiltIn) {
      set.status = 403;
      return { error: "Built-in templates cannot be modified" };
    }

    const [updated] = await db
      .update(componentTemplates)
      .set({
        name: updates.name?.trim() ?? existing.name,
        description: updates.description ?? existing.description,
        scope: updates.scope ?? existing.scope,
        thumbnail: updates.thumbnail ?? existing.thumbnail,
        content: updates.content ?? existing.content,
        zones: updates.zones ?? existing.zones,
        updatedAt: new Date(),
      })
      .where(eq(componentTemplates.id, params.id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "component_template",
      entityId: updated.id,
      summary: `Updated template "${updated.name}"`,
    });

    return { data: updated };
  })

  .delete("/component-templates/:id", async ({ params, userId, set }) => {
    const [existing] = await db
      .select()
      .from(componentTemplates)
      .where(eq(componentTemplates.id, params.id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Template not found" };
    }
    if (existing.isBuiltIn) {
      set.status = 403;
      return { error: "Built-in templates cannot be deleted" };
    }

    await db
      .delete(componentTemplates)
      .where(eq(componentTemplates.id, params.id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "component_template",
      entityId: existing.id,
      summary: `Deleted template "${existing.name}"`,
    });

    return { data: { success: true } };
  });

export const componentTemplatesRoutes = new Elysia({ name: "component-templates" })
  .use(publicTemplates)
  .use(protectedTemplates);
