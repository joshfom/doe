import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authGuard } from "../auth";
import { categories, postCategories } from "../../schema";
import { db } from "../../db";
import { generateSlug } from "../../utils/slug";
import { logAudit } from "../../audit";
import type { CategoryTree } from "../../types";

// ── Helper: build tree from flat category list ───────────────────────────────

function buildCategoryTree(
  flatCategories: {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
  }[]
): CategoryTree[] {
  const map = new Map<string, CategoryTree>();
  const roots: CategoryTree[] = [];

  // Create tree nodes
  for (const cat of flatCategories) {
    map.set(cat.id, {
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      parentId: cat.parentId,
      children: [],
    });
  }

  // Wire parent-child relationships
  for (const cat of flatCategories) {
    const node = map.get(cat.id)!;
    if (cat.parentId && map.has(cat.parentId)) {
      map.get(cat.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ── Public read routes (no auth) ─────────────────────────────────────────────

const readCategories = new Elysia({ name: "categories-read" })
  .get("/categories", async () => {
    const allCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        parentId: categories.parentId,
      })
      .from(categories)
      .orderBy(categories.name);

    const tree = buildCategoryTree(allCategories);
    return { data: tree };
  });


// ── Protected routes (auth required) ─────────────────────────────────────────

const protectedCategories = new Elysia({ name: "categories-protected" })
  .use(authGuard)

  // POST /categories — Create category
  .post("/categories", async ({ body, userId, set }) => {
    const { name, parentId } = body as {
      name?: string;
      parentId?: string | null;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      set.status = 400;
      return { error: "Name is required" };
    }

    // Check for duplicate name
    const [existing] = await db
      .select()
      .from(categories)
      .where(eq(categories.name, name.trim()))
      .limit(1);

    if (existing) {
      set.status = 409;
      return { error: "Category with this name already exists" };
    }

    const slug = generateSlug(name.trim());

    const [created] = await db
      .insert(categories)
      .values({
        name: name.trim(),
        slug,
        parentId: parentId ?? null,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "category",
      entityId: created.id,
      summary: `Created category "${created.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // PUT /categories/:id — Update category
  .put("/categories/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { name, parentId } = body as {
      name?: string;
      parentId?: string | null;
    };

    const [existing] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Category not found" };
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      updates.name = name.trim();
      updates.slug = generateSlug(name.trim());
    }

    if (parentId !== undefined) {
      updates.parentId = parentId;
    }

    const [updated] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "category",
      entityId: id,
      summary: `Updated category "${updated.name}"`,
    });

    return { data: updated };
  })

  // DELETE /categories/:id — Delete category
  .delete("/categories/:id", async ({ params, userId, set }) => {
    const { id } = params;

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);

    if (!category) {
      set.status = 404;
      return { error: "Category not found" };
    }

    // Promote children to root (set parentId to null)
    await db
      .update(categories)
      .set({ parentId: null, updatedAt: new Date() })
      .where(eq(categories.parentId, id));

    // Remove post-category associations for this category
    await db
      .delete(postCategories)
      .where(eq(postCategories.categoryId, id));

    // Delete the category
    await db.delete(categories).where(eq(categories.id, id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "category",
      entityId: id,
      summary: `Deleted category "${category.name}"`,
    });

    return { data: { success: true } };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const categoriesRoutes = new Elysia({ name: "categories" })
  .use(readCategories)
  .use(protectedCategories);
