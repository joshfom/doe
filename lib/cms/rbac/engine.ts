import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import {
  roles,
  permissions,
  rolePermissions,
  userRoles,
} from "../schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type UserType = "employee" | "broker" | "client" | "vendor";

export type Role = typeof roles.$inferSelect;

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_USER_TYPES: ReadonlySet<string> = new Set<UserType>([
  "employee",
  "broker",
  "client",
  "vendor",
]);

/**
 * Matches two non-empty segments of alphanumeric/underscore/hyphen characters
 * separated by exactly one colon. e.g. "pages:publish", "brokers:manage"
 */
const PERMISSION_FORMAT = /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/;

// ── Validation utilities ─────────────────────────────────────────────────────

/**
 * Returns true if `value` is one of the four allowed user types.
 */
export function isValidUserType(value: string): boolean {
  return VALID_USER_TYPES.has(value);
}

/**
 * Returns true if `value` matches the `resource:action` format —
 * two non-empty segments of alphanumeric characters (plus underscore/hyphen)
 * separated by exactly one colon.
 */
export function isValidPermissionString(value: string): boolean {
  return PERMISSION_FORMAT.test(value);
}

// ── Permission checking ──────────────────────────────────────────────────────

/**
 * Checks whether `required` is satisfied by the given permission set.
 * Supports exact match and wildcard (`resource:*`) match.
 */
export function hasPermission(
  permissions: string[],
  required: string
): boolean {
  // Exact match
  if (permissions.includes(required)) return true;

  // Global wildcard (super_admin: "*:*")
  if (permissions.includes("*:*")) return true;

  const colonIdx = required.indexOf(":");
  if (colonIdx === -1) return false;

  const resource = required.slice(0, colonIdx);
  // Resource-level wildcard (e.g. "ai:*")
  return permissions.includes(`${resource}:*`);
}

// ── Database queries ─────────────────────────────────────────────────────────

/**
 * Loads all roles assigned to a user via the `user_roles` junction table.
 */
export async function loadUserRoles(
  db: Database,
  userId: string
): Promise<Role[]> {
  const rows = await db
    .select({ role: roles })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows.map((r) => r.role);
}

/**
 * Resolves the deduplicated union of all permission strings for the given roles.
 * Each permission is formatted as `resource:action`.
 */
export async function resolvePermissions(
  db: Database,
  userRoles: Role[]
): Promise<string[]> {
  if (userRoles.length === 0) return [];

  const roleIds = userRoles.map((r) => r.id);

  const rows = await db
    .select({
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, roleIds));

  const unique = new Set(rows.map((r) => `${r.resource}:${r.action}`));
  return Array.from(unique);
}
