import { eq, and } from "drizzle-orm";
import type { Database } from "../db";
import { roles, permissions, rolePermissions } from "../schema";

// ── Ticket Permission Definitions ────────────────────────────────────────────

export const TICKET_PERMISSIONS = [
  { resource: "tickets", action: "create", description: "Create tickets" },
  { resource: "tickets", action: "read", description: "View tickets" },
  { resource: "tickets", action: "update", description: "Update tickets" },
  { resource: "tickets", action: "assign", description: "Assign tickets" },
  { resource: "tickets", action: "approve", description: "Approve or reject ticket-based requests (NOC, move-in, vendor access)" },
  { resource: "tickets", action: "delete", description: "Delete tickets" },
  { resource: "tickets", action: "manage", description: "Manage ticket settings and categories" },
] as const;

// ── Ticket Role → Permission Mappings ────────────────────────────────────────

/**
 * Maps role names to the ticket permission keys they should receive.
 * super_admin already has `*:*` via the main RBAC seed, so no explicit grants needed.
 */
export const TICKET_ROLE_PERMISSION_MAP: Record<string, string[]> = {
  sales_manager: [
    "tickets:create",
    "tickets:read",
    "tickets:update",
    "tickets:assign",
    "tickets:approve",
  ],
  content_manager: ["tickets:read"],
  viewer: ["tickets:read"],
  // Off-plan / construction-stage roles
  project_manager: [
    "tickets:create",
    "tickets:read",
    "tickets:update",
    "tickets:assign",
    "tickets:approve",
  ],
  hse_officer: [
    "tickets:read",
    "tickets:update",
    "tickets:approve",
  ],
  site_security: [
    "tickets:read",
    "tickets:update",
  ],
  marketing: [
    "tickets:create",
    "tickets:read",
    "tickets:update",
  ],
  contractor: [
    "tickets:create",
    "tickets:read",
  ],
  consultant: [
    "tickets:create",
    "tickets:read",
  ],
  booked_client: [
    "tickets:create",
    "tickets:read",
  ],
  prospective_buyer: [
    "tickets:create",
  ],
};

// ── Seed Function ────────────────────────────────────────────────────────────

/**
 * Seeds ticket-related permissions and role assignments.
 * Called from server startup alongside existing seedRbac.
 * Idempotent: checks before inserting permissions, uses onConflictDoNothing for role grants.
 */
export async function seedTicketPermissions(db: Database): Promise<void> {
  // 1. Seed ticket permissions (idempotent: check before insert)
  for (const perm of TICKET_PERMISSIONS) {
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

  // 2. Seed role → ticket permission grants (idempotent: onConflictDoNothing)
  for (const [roleName, permKeys] of Object.entries(TICKET_ROLE_PERMISSION_MAP)) {
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

  console.log("Ticket permissions seed complete.");
}
