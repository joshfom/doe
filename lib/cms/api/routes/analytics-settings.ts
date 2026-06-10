import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authGuard } from "../auth";
import { siteSettings } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";
import { encrypt, decrypt } from "@/lib/analytics/encryption";

// Keys that contain sensitive tokens and must be encrypted at rest
const SENSITIVE_KEYS = new Set([
  "analytics_meta_capi_token",
  "analytics_tiktok_events_api_token",
]);

// Prefix used to signal that a value needs encryption from the client
const ENCRYPT_PREFIX = "__ENCRYPT__";

export const analyticsSettingsRoutes = new Elysia({
  name: "analytics-settings",
})
  .use(authGuard)

  // GET /analytics-settings — Get all analytics settings (decrypts sensitive values)
  .get("/analytics-settings", async ({ userId, set }) => {
    // Check admin permission
    const hasAccess = await checkAdminAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: admin access required" };
    }

    // Fetch all settings and filter to analytics_ prefix
    const allRows = await db.select().from(siteSettings);
    const analyticsRows = allRows.filter((r) => r.key.startsWith("analytics_"));

    const data = analyticsRows.map((r) => {
      if (SENSITIVE_KEYS.has(r.key) && r.value) {
        try {
          return { key: r.key, value: decrypt(r.value) };
        } catch {
          // If decryption fails (e.g. key changed), return empty
          return { key: r.key, value: "" };
        }
      }
      return { key: r.key, value: r.value };
    });

    return { data };
  })

  // PUT /analytics-settings — Save analytics settings (encrypts sensitive values)
  .put("/analytics-settings", async ({ body, userId, set }) => {
    // Check admin permission
    const hasAccess = await checkAdminAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: admin access required" };
    }

    const { settings } = body as { settings?: Record<string, string> };

    if (!settings || typeof settings !== "object") {
      set.status = 400;
      return { error: "settings is required and must be an object" };
    }

    const entries = Object.entries(settings);

    for (const [key, rawValue] of entries) {
      // Only allow analytics_ prefixed keys
      if (!key.startsWith("analytics_")) continue;

      let value = rawValue;

      // Handle encryption for sensitive fields
      if (SENSITIVE_KEYS.has(key)) {
        if (value.startsWith(ENCRYPT_PREFIX)) {
          // Client sent a new value to encrypt
          const plaintext = value.slice(ENCRYPT_PREFIX.length);
          value = plaintext ? encrypt(plaintext) : "";
        } else if (value) {
          // Value is already plaintext (shouldn't happen from our UI, but handle it)
          value = encrypt(value);
        }
      }

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
      entityId: "analytics",
      summary: `Updated analytics settings: ${entries.map(([k]) => k).join(", ")}`,
    });

    // Return updated analytics settings (decrypted for display)
    const allRows = await db.select().from(siteSettings);
    const analyticsRows = allRows.filter((r) => r.key.startsWith("analytics_"));

    const data = analyticsRows.map((r) => {
      if (SENSITIVE_KEYS.has(r.key) && r.value) {
        try {
          return { key: r.key, value: decrypt(r.value) };
        } catch {
          return { key: r.key, value: "" };
        }
      }
      return { key: r.key, value: r.value };
    });

    return { data };
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if the user has admin access (super_admin role or settings:update permission).
 */
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
