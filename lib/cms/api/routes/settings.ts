import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authGuard } from "../auth";
import { siteSettings } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicSettings = new Elysia({ name: "settings-public" })
  // GET /settings — List all settings
  .get("/settings", async () => {
    const rows = await db.select().from(siteSettings);
    return {
      data: rows.map((r) => ({ key: r.key, value: r.value })),
    };
  })

  // GET /settings/:key — Get single setting value
  .get("/settings/:key", async ({ params }) => {
    const [row] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, params.key))
      .limit(1);

    return { data: { key: params.key, value: row?.value ?? "" } };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedSettings = new Elysia({ name: "settings-protected" })
  .use(authGuard)

  // PUT /settings — Bulk update settings
  .put("/settings", async ({ body, userId, set }) => {
    const { settings } = body as { settings?: Record<string, string> };

    if (!settings || typeof settings !== "object") {
      set.status = 400;
      return { error: "settings is required and must be an object" };
    }

    const entries = Object.entries(settings);

    for (const [key, value] of entries) {
      const [existing] = await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.key, key))
        .limit(1);

      if (existing) {
        await db
          .update(siteSettings)
          .set({ value, updatedAt: new Date() })
          .where(eq(siteSettings.key, key));
      } else {
        await db.insert(siteSettings).values({ key, value });
      }
    }

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "settings",
      entityId: "bulk",
      summary: `Updated settings: ${entries.map(([k]) => k).join(", ")}`,
    });

    // Return the full updated settings list
    const rows = await db.select().from(siteSettings);
    return {
      data: rows.map((r) => ({ key: r.key, value: r.value })),
    };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const settingsRoutes = new Elysia({ name: "settings" })
  .use(publicSettings)
  .use(protectedSettings);
