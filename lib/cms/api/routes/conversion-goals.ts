import { Elysia } from "elysia";
import { eq, asc, and } from "drizzle-orm";
import { authGuard } from "../auth";
import { conversionGoals, customEvents } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";
import { isValidEventName } from "@/lib/analytics/events";

const DISPLAY_LABEL_MAX = 255;
const MAX_ACTIVE_GOALS = 20;

export const conversionGoalsRoutes = new Elysia({ name: "conversion-goals" })
  // GET /conversion-goals/active — no auth, internal use
  .get("/conversion-goals/active", async () => {
    const rows = await db
      .select()
      .from(conversionGoals)
      .where(eq(conversionGoals.isActive, true))
      .orderBy(asc(conversionGoals.eventName));

    return { data: rows };
  })

  // All other endpoints require auth
  .use(authGuard)

  // GET /conversion-goals — list all (admin auth)
  .get("/conversion-goals", async ({ userId, set }) => {
    const hasAccess = await checkSettingsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: settings:update permission required" };
    }

    const rows = await db
      .select()
      .from(conversionGoals)
      .orderBy(asc(conversionGoals.eventName));

    return { data: rows };
  })

  // POST /conversion-goals — create (admin)
  .post("/conversion-goals", async ({ body, userId, set }) => {
    const hasAccess = await checkSettingsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: settings:update permission required" };
    }

    const { eventName, displayLabel } = body as {
      eventName?: string;
      displayLabel?: string;
    };

    // Validate eventName required
    if (!eventName || typeof eventName !== "string" || eventName.trim().length === 0) {
      set.status = 400;
      return { error: "event_name is required" };
    }

    const trimmedName = eventName.trim();

    // Validate eventName exists in EVENT_VOCABULARY or custom_events
    const isCore = isValidEventName(trimmedName);
    if (!isCore) {
      const [customEvent] = await db
        .select()
        .from(customEvents)
        .where(and(eq(customEvents.name, trimmedName), eq(customEvents.isActive, true)))
        .limit(1);

      if (!customEvent) {
        set.status = 400;
        return { error: "Event not found in vocabulary" };
      }
    }

    // Validate displayLabel
    if (displayLabel != null) {
      if (typeof displayLabel !== "string") {
        set.status = 400;
        return { error: "display_label must be a string" };
      }
      if (displayLabel.length > DISPLAY_LABEL_MAX) {
        set.status = 400;
        return { error: `display_label must be at most ${DISPLAY_LABEL_MAX} characters` };
      }
    }

    // Reject duplicates
    const [existing] = await db
      .select()
      .from(conversionGoals)
      .where(eq(conversionGoals.eventName, trimmedName))
      .limit(1);

    if (existing) {
      set.status = 409;
      return { error: "A conversion goal with this event name already exists" };
    }

    // Reject if 20 active goals exist
    const activeGoals = await db
      .select()
      .from(conversionGoals)
      .where(eq(conversionGoals.isActive, true));

    if (activeGoals.length >= MAX_ACTIVE_GOALS) {
      set.status = 400;
      return { error: "Maximum 20 active goals allowed" };
    }

    const [created] = await db
      .insert(conversionGoals)
      .values({
        eventName: trimmedName,
        displayLabel: displayLabel?.trim() || null,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "conversion_goal",
      entityId: created.id,
      summary: `Created conversion goal "${created.eventName}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // PATCH /conversion-goals/:id — update displayLabel or isActive (admin)
  .patch("/conversion-goals/:id", async ({ params, body, userId, set }) => {
    const hasAccess = await checkSettingsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: settings:update permission required" };
    }

    const [existing] = await db
      .select()
      .from(conversionGoals)
      .where(eq(conversionGoals.id, params.id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Conversion goal not found" };
    }

    const { displayLabel, isActive } = body as {
      displayLabel?: string | null;
      isActive?: boolean;
    };

    // Validate displayLabel if provided
    if (displayLabel != null && typeof displayLabel !== "string") {
      set.status = 400;
      return { error: "display_label must be a string" };
    }
    if (typeof displayLabel === "string" && displayLabel.length > DISPLAY_LABEL_MAX) {
      set.status = 400;
      return { error: `display_label must be at most ${DISPLAY_LABEL_MAX} characters` };
    }

    // If activating, check max active goals
    if (isActive === true && !existing.isActive) {
      const activeGoals = await db
        .select()
        .from(conversionGoals)
        .where(eq(conversionGoals.isActive, true));

      if (activeGoals.length >= MAX_ACTIVE_GOALS) {
        set.status = 400;
        return { error: "Maximum 20 active goals allowed" };
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (displayLabel !== undefined) {
      updates.displayLabel = displayLabel?.trim() || null;
    }
    if (typeof isActive === "boolean") {
      updates.isActive = isActive;
    }

    const [updated] = await db
      .update(conversionGoals)
      .set(updates)
      .where(eq(conversionGoals.id, params.id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "conversion_goal",
      entityId: updated.id,
      summary: `Updated conversion goal "${updated.eventName}"`,
    });

    return { data: updated };
  })

  // DELETE /conversion-goals/:id — hard delete (admin)
  .delete("/conversion-goals/:id", async ({ params, userId, set }) => {
    const hasAccess = await checkSettingsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: settings:update permission required" };
    }

    const [existing] = await db
      .select()
      .from(conversionGoals)
      .where(eq(conversionGoals.id, params.id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Conversion goal not found" };
    }

    await db
      .delete(conversionGoals)
      .where(eq(conversionGoals.id, params.id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "conversion_goal",
      entityId: existing.id,
      summary: `Deleted conversion goal "${existing.eventName}"`,
    });

    return { data: { id: existing.id } };
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function checkSettingsAccess(userId: string): Promise<boolean> {
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
