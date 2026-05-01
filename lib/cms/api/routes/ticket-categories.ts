import { Elysia } from "elysia";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import {
  createCategory,
  listCategories,
  updateCategory,
  deactivateCategory,
} from "../../tickets/service";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../../tickets/validation";

// ── Read routes (tickets:read) ───────────────────────────────────────────────

const categoryReadRoutes = new Elysia({ name: "ticket-categories-read" })
  .use(identityGuard)
  .use(requirePermission("tickets:read"))

  // GET /ticket-categories — list categories (active only by default)
  .get("/ticket-categories", async ({ query }) => {
    const includeInactive = query.includeInactive === "true";
    const categories = await listCategories(db, includeInactive);
    return { data: categories };
  });

// ── Manage routes (tickets:manage) ───────────────────────────────────────────

const categoryManageRoutes = new Elysia({ name: "ticket-categories-manage" })
  .use(identityGuard)
  .use(requirePermission("tickets:manage"))

  // POST /ticket-categories — create category
  .post("/ticket-categories", async ({ body, set }) => {
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      const category = await createCategory(db, parsed.data);
      set.status = 201;
      return { data: category };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("already exists")) {
        set.status = 409;
        return { error: message };
      }

      throw error;
    }
  })

  // PATCH /ticket-categories/:id — update category
  .patch("/ticket-categories/:id", async ({ params, body, set }) => {
    const { id } = params;

    const parsed = updateCategorySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      const category = await updateCategory(db, id, parsed.data);
      return { data: category };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("Category not found")) {
        set.status = 404;
        return { error: "Category not found" };
      }

      if (message.includes("already exists")) {
        set.status = 409;
        return { error: message };
      }

      throw error;
    }
  })

  // DELETE /ticket-categories/:id — deactivate category (soft delete)
  .delete("/ticket-categories/:id", async ({ params, set }) => {
    const { id } = params;

    try {
      const category = await deactivateCategory(db, id);
      return { data: category };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("Category not found")) {
        set.status = 404;
        return { error: "Category not found" };
      }

      throw error;
    }
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const ticketCategoriesRoutes = new Elysia({ name: "ticket-categories" })
  .use(categoryReadRoutes)
  .use(categoryManageRoutes);
