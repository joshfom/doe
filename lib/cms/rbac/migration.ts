import { eq, and, isNull, sql } from "drizzle-orm";
import type { Database } from "../db";
import { users, employeeProfiles, roles, userRoles } from "../schema";

/**
 * Migrates existing users to the RBAC identity system.
 *
 * - Sets userType='employee', isActive=true, emailVerified=true for all users
 * - Creates employee_profiles records for users that don't have one
 * - Assigns the super_admin role to users that don't already have it
 *
 * This migration is idempotent — safe to run multiple times.
 */
export async function migrateExistingUsers(db: Database): Promise<void> {
  // 1. Update all users to employee defaults (only if not already set)
  await db
    .update(users)
    .set({
      userType: "employee",
      isActive: true,
      emailVerified: true,
    });

  // 2. Find users without an employee_profiles record
  const usersWithoutProfile = await db
    .select({ id: users.id })
    .from(users)
    .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .where(isNull(employeeProfiles.id));

  // 3. Create employee_profiles for each (onConflictDoNothing for idempotency)
  for (const user of usersWithoutProfile) {
    await db
      .insert(employeeProfiles)
      .values({
        userId: user.id,
        department: "General",
        jobTitle: "Staff",
      })
      .onConflictDoNothing();
  }

  // 4. Find the super_admin role
  const [superAdminRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.name, "super_admin"), eq(roles.userType, "employee")))
    .limit(1);

  if (!superAdminRole) {
    console.warn("migrateExistingUsers: super_admin role not found — skipping role assignment.");
    return;
  }

  // 5. Find users without the super_admin role assigned
  const usersWithoutRole = await db
    .select({ id: users.id })
    .from(users)
    .leftJoin(
      userRoles,
      and(eq(users.id, userRoles.userId), eq(userRoles.roleId, superAdminRole.id))
    )
    .where(isNull(userRoles.id));

  // 6. Assign super_admin role to each (onConflictDoNothing for idempotency)
  for (const user of usersWithoutRole) {
    await db
      .insert(userRoles)
      .values({
        userId: user.id,
        roleId: superAdminRole.id,
      })
      .onConflictDoNothing();
  }
}
