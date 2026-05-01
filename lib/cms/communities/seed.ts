import { eq, and } from "drizzle-orm";
import type { Database } from "../db";
import { roles, permissions, rolePermissions } from "../schema";

// ── Permissions for communities & projects ───────────────────────────────────

export const COMMUNITY_PROJECT_PERMISSIONS = [
  { resource: "communities", action: "read", description: "View communities" },
  { resource: "communities", action: "manage", description: "Create / update / archive communities" },
  { resource: "projects", action: "read", description: "View projects" },
  { resource: "projects", action: "manage", description: "Create / update / archive projects" },
] as const;

// super_admin gets these via *:* — only grant explicitly to other roles.
export const COMMUNITY_PROJECT_ROLE_PERMISSION_MAP: Record<string, string[]> = {
  content_manager: [
    "communities:read",
    "communities:manage",
    "projects:read",
    "projects:manage",
  ],
  sales_manager: [
    "communities:read",
    "projects:read",
  ],
  viewer: ["communities:read", "projects:read"],
};

export async function seedCommunityProjectPermissions(
  db: Database
): Promise<void> {
  for (const perm of COMMUNITY_PROJECT_PERMISSIONS) {
    const existing = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.resource, perm.resource),
          eq(permissions.action, perm.action)
        )
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

  for (const [roleName, permKeys] of Object.entries(
    COMMUNITY_PROJECT_ROLE_PERMISSION_MAP
  )) {
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
            eq(permissions.action, action)
          )
        )
        .limit(1);

      if (!perm) continue;

      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    }
  }

  console.log("Community/project permissions seed complete.");
}
