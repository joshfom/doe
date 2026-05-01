import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authGuard } from "../auth";
import { tags, postTags } from "../../schema";
import { db } from "../../db";
import { generateSlug } from "../../utils/slug";
import { logAudit } from "../../audit";

// ── Public read routes (no auth) ─────────────────────────────────────────────

const readTags = new Elysia({ name: "tags-read" })
  .get("/tags", async () => {
    const allTags = await db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        createdAt: tags.createdAt,
      })
      .from(tags)
      .orderBy(tags.name);

    return { data: allTags };
  });

// ── Protected routes (auth required) ─────────────────────────────────────────

const protectedTags = new Elysia({ name: "tags-protected" })
  .use(authGuard)

  // POST /tags — Create tag
  .post("/tags", async ({ body, userId, set }) => {
    const { name } = body as { name?: string };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      set.status = 400;
      return { error: "Name is required" };
    }

    // Check for duplicate name
    const [existing] = await db
      .select()
      .from(tags)
      .where(eq(tags.name, name.trim()))
      .limit(1);

    if (existing) {
      set.status = 409;
      return { error: "Tag with this name already exists" };
    }

    const slug = generateSlug(name.trim());

    const [created] = await db
      .insert(tags)
      .values({
        name: name.trim(),
        slug,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "tag",
      entityId: created.id,
      summary: `Created tag "${created.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // PUT /tags/:id — Update tag
  .put("/tags/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { name } = body as { name?: string };

    const [existing] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Tag not found" };
    }

    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      updates.name = name.trim();
      updates.slug = generateSlug(name.trim());
    }

    const [updated] = await db
      .update(tags)
      .set(updates)
      .where(eq(tags.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "tag",
      entityId: id,
      summary: `Updated tag "${updated.name}"`,
    });

    return { data: updated };
  })

  // DELETE /tags/:id — Delete tag
  .delete("/tags/:id", async ({ params, userId, set }) => {
    const { id } = params;

    const [tag] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, id))
      .limit(1);

    if (!tag) {
      set.status = 404;
      return { error: "Tag not found" };
    }

    // Remove post-tag associations for this tag
    await db
      .delete(postTags)
      .where(eq(postTags.tagId, id));

    // Delete the tag
    await db.delete(tags).where(eq(tags.id, id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "tag",
      entityId: id,
      summary: `Deleted tag "${tag.name}"`,
    });

    return { data: { success: true } };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const tagsRoutes = new Elysia({ name: "tags" })
  .use(readTags)
  .use(protectedTags);
