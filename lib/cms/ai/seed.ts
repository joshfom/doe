import { eq, and } from "drizzle-orm";
import type { Database } from "../db";
import { roles, permissions, rolePermissions } from "../schema";

// ── AI Permission Definitions ────────────────────────────────────────────────

export const AI_PERMISSIONS = [
  { resource: "ai", action: "chat", description: "Use AI chat" },
  { resource: "ai", action: "conversations:read", description: "View AI conversations" },
  { resource: "ai", action: "knowledge-base:manage", description: "Manage AI knowledge base" },
  { resource: "ai", action: "clients:manage", description: "Manage AI client records" },
  { resource: "ai", action: "tenants:manage", description: "Manage AI tenant records" },
  { resource: "ai", action: "units:manage", description: "Manage AI unit records" },
  { resource: "ai", action: "appointments:manage", description: "Manage AI appointments" },
  { resource: "ai", action: "analytics:read", description: "View AI analytics" },
  { resource: "ai", action: "config:manage", description: "Manage AI configuration" },
] as const;

// ── AI Role → Permission Mappings ────────────────────────────────────────────

/**
 * Maps role names to the AI permission keys they should receive.
 * super_admin already has `*:*` via the main RBAC seed, so no explicit grants needed.
 */
export const AI_ROLE_PERMISSION_MAP: Record<string, string[]> = {
  sales_manager: [
    "ai:conversations:read",
    "ai:clients:manage",
    "ai:appointments:manage",
    "ai:analytics:read",
  ],
};

// ── Seed Function ────────────────────────────────────────────────────────────

/**
 * Seeds AI-related permissions and role assignments.
 * Called from server startup alongside existing seed functions.
 * Idempotent: checks before inserting permissions, uses onConflictDoNothing for role grants.
 */
export async function seedAiPermissions(db: Database): Promise<void> {
  // 1. Seed AI permissions (idempotent: check before insert)
  for (const perm of AI_PERMISSIONS) {
    const existing = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.resource, perm.resource),
          eq(permissions.action, perm.action),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(permissions).values({
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      });
    }
  }

  // 2. Seed role → AI permission grants (idempotent: onConflictDoNothing)
  for (const [roleName, permKeys] of Object.entries(AI_ROLE_PERMISSION_MAP)) {
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, roleName))
      .limit(1);

    if (!role) continue;

    for (const permKey of permKeys) {
      const [resource, action] = permKey.split(":");

      const [perm] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.resource, resource),
            eq(permissions.action, action),
          ),
        )
        .limit(1);

      if (!perm) continue;

      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    }
  }

  console.log("AI permissions seed complete.");
}
