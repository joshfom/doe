import { Elysia } from "elysia";
import { eq, asc } from "drizzle-orm";
import { authGuard } from "../auth";
import { customEvents } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";
import { isValidEventName } from "@/lib/analytics/events";

// Custom event names share the same shape as the locked vocabulary:
// snake_case, lowercase, alphanumeric + underscores, max 64 chars.
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const NAME_MAX = 64;
const DESC_MAX = 200;

function validateEventName(name: unknown): string | null {
  if (typeof name !== "string") return "Name is required";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name is required";
  if (trimmed.length > NAME_MAX) return `Maximum ${NAME_MAX} characters allowed`;
  if (!NAME_PATTERN.test(trimmed)) {
    return "Lowercase letters, digits, and underscores only; must start with a letter";
  }
  if (isValidEventName(trimmed)) {
    return "This name is already part of the core vocabulary";
  }
  return null;
}

export const customEventsRoutes = new Elysia({ name: "custom-events" })
  // Public-ish read: any authenticated user can list active events so the
  // builder dropdown stays in sync. Admin role required for writes.
  .use(authGuard)

  // GET /custom-events — list all custom events (active by default)
  .get("/custom-events", async ({ query }) => {
    const includeInactive = query?.includeInactive === "true";

    const rows = await db
      .select()
      .from(customEvents)
      .orderBy(asc(customEvents.name));

    const data = includeInactive ? rows : rows.filter((r) => r.isActive);
    return { data };
  })

  // POST /custom-events — create a new custom event (admin only)
  .post("/custom-events", async ({ body, userId, set }) => {
    const hasAccess = await checkAdminAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: admin access required" };
    }

    const { name, description, isActive } = body as {
      name?: string;
      description?: string;
      isActive?: boolean;
    };

    const nameError = validateEventName(name);
    if (nameError) {
      set.status = 400;
      return { error: nameError };
    }

    if (description != null && typeof description !== "string") {
      set.status = 400;
      return { error: "Description must be a string" };
    }
    if (description && description.length > DESC_MAX) {
      set.status = 400;
      return { error: `Description must be at most ${DESC_MAX} characters` };
    }

    const trimmedName = (name as string).trim();

    // Reject duplicates explicitly so the client gets a clear error rather
    // than a generic unique constraint violation.
    const [existing] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.name, trimmedName))
      .limit(1);

    if (existing) {
      set.status = 409;
      return { error: "An event with this name already exists" };
    }

    const [created] = await db
      .insert(customEvents)
      .values({
        name: trimmedName,
        description: description?.trim() || null,
        isActive: isActive ?? true,
        createdBy: userId,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "custom_event",
      entityId: created.id,
      summary: `Created custom event "${created.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // PATCH /custom-events/:id — update description or active flag (admin only)
  .patch("/custom-events/:id", async ({ params, body, userId, set }) => {
    const hasAccess = await checkAdminAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: admin access required" };
    }

    const [existing] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.id, params.id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Custom event not found" };
    }

    const { description, isActive } = body as {
      description?: string | null;
      isActive?: boolean;
    };

    if (description != null && typeof description !== "string") {
      set.status = 400;
      return { error: "Description must be a string" };
    }
    if (typeof description === "string" && description.length > DESC_MAX) {
      set.status = 400;
      return { error: `Description must be at most ${DESC_MAX} characters` };
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }
    if (typeof isActive === "boolean") {
      updates.isActive = isActive;
    }

    const [updated] = await db
      .update(customEvents)
      .set(updates)
      .where(eq(customEvents.id, params.id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "custom_event",
      entityId: updated.id,
      summary: `Updated custom event "${updated.name}"`,
    });

    return { data: updated };
  })

  // DELETE /custom-events/:id — soft delete by setting isActive=false
  .delete("/custom-events/:id", async ({ params, userId, set }) => {
    const hasAccess = await checkAdminAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: admin access required" };
    }

    const [existing] = await db
      .select()
      .from(customEvents)
      .where(eq(customEvents.id, params.id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Custom event not found" };
    }

    await db
      .delete(customEvents)
      .where(eq(customEvents.id, params.id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "custom_event",
      entityId: existing.id,
      summary: `Deleted custom event "${existing.name}"`,
    });

    return { data: { id: existing.id } };
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function checkAdminAccess(userId: string): Promise<boolean> {
  const { loadUserRoles, resolvePermissions } = await import("../../rbac/engine");
  try {
    const userRolesList = await loadUserRoles(db, userId);
    const roleNames = userRolesList.map((r) => r.name);
    const perms = await resolvePermissions(db, userRolesList);
    return (
      roleNames.includes("super_admin") ||
      perms.includes("*:*") ||
      perms.includes("settings:update") ||
      perms.includes("settings:*")
    );
  } catch {
    return false;
  }
}
