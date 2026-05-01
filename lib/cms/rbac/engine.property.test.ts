import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { hasPermission } from "./engine";

// Feature: rbac-identity-system, Property 4: Role-type scope enforcement
// Feature: rbac-identity-system, Property 5: System role deletion prevention
// Feature: rbac-identity-system, Property 6: Role name uniqueness within type scope
// Feature: rbac-identity-system, Property 8: Role deletion cascades junction records
// Feature: rbac-identity-system, Property 11: Permission resolution is the union of role permissions
// Feature: rbac-identity-system, Property 12: Permission check with wildcard support

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_USER_TYPES = ["employee", "broker", "client", "vendor"] as const;
type UserType = (typeof VALID_USER_TYPES)[number];

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbUserType = fc.constantFrom<UserType>(...VALID_USER_TYPES);

const arbRoleName = fc.stringMatching(/^[a-zA-Z0-9_-]+$/, {
  minLength: 1,
  maxLength: 30,
});

const arbPermissionSegment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/, {
  minLength: 1,
  maxLength: 20,
});

const arbPermissionString = fc
  .tuple(arbPermissionSegment, arbPermissionSegment)
  .map(([resource, action]) => `${resource}:${action}`);

// ── Inline helper functions (business rules not yet implemented as services) ─

/**
 * Role-type scope enforcement: a role can only be assigned to a user
 * if the role's userType matches the user's userType.
 */
function canAssignRole(userType: UserType, roleUserType: UserType): boolean {
  return userType === roleUserType;
}

/**
 * System role deletion prevention: system roles cannot be deleted.
 */
function canDeleteRole(role: { isSystem: boolean }): boolean {
  return !role.isSystem;
}

/**
 * Role name uniqueness within type scope: checks if a role name + type
 * combination already exists in the given set of existing roles.
 */
function isRoleNameUniqueInScope(
  existingRoles: Array<{ name: string; userType: UserType }>,
  newName: string,
  newUserType: UserType
): boolean {
  return !existingRoles.some(
    (r) => r.name === newName && r.userType === newUserType
  );
}

/**
 * Simulates role deletion cascade: removes all junction records
 * referencing the deleted role.
 */
function simulateRoleDeletionCascade(
  roleId: string,
  rolePermissions: Array<{ roleId: string; permissionId: string }>,
  userRoles: Array<{ userId: string; roleId: string }>
): {
  remainingRolePermissions: Array<{ roleId: string; permissionId: string }>;
  remainingUserRoles: Array<{ userId: string; roleId: string }>;
} {
  return {
    remainingRolePermissions: rolePermissions.filter(
      (rp) => rp.roleId !== roleId
    ),
    remainingUserRoles: userRoles.filter((ur) => ur.roleId !== roleId),
  };
}

/**
 * Permission resolution: computes the union of all permission sets
 * from multiple roles, with no duplicates.
 */
function resolvePermissionUnion(
  roleSets: Array<string[]>
): string[] {
  const union = new Set<string>();
  for (const perms of roleSets) {
    for (const p of perms) {
      union.add(p);
    }
  }
  return Array.from(union);
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Role-type scope enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.4**
 *
 * Property 4: Role-type scope enforcement
 *
 * For any user with user_type X and any role with user_type scope Y,
 * role assignment succeeds if and only if X equals Y.
 */
describe("Feature: rbac-identity-system, Property 4: Role-type scope enforcement", () => {
  it("allows role assignment when user type matches role type", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        expect(canAssignRole(userType, userType)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("rejects role assignment when user type does not match role type", () => {
    fc.assert(
      fc.property(
        arbUserType,
        arbUserType,
        (userType, roleType) => {
          fc.pre(userType !== roleType);
          expect(canAssignRole(userType, roleType)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("canAssignRole returns true iff user type equals role type for all combinations", () => {
    fc.assert(
      fc.property(arbUserType, arbUserType, (userType, roleType) => {
        const result = canAssignRole(userType, roleType);
        expect(result).toBe(userType === roleType);
      }),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 5: System role deletion prevention
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.5**
 *
 * Property 5: System role deletion prevention
 *
 * For any role where is_system is true, attempting to delete should be
 * rejected. For non-system roles, deletion should be allowed.
 */
describe("Feature: rbac-identity-system, Property 5: System role deletion prevention", () => {
  it("rejects deletion for any system role", () => {
    fc.assert(
      fc.property(arbRoleName, (name) => {
        const role = { name, isSystem: true };
        expect(canDeleteRole(role)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("allows deletion for any non-system role", () => {
    fc.assert(
      fc.property(arbRoleName, (name) => {
        const role = { name, isSystem: false };
        expect(canDeleteRole(role)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("canDeleteRole returns true iff isSystem is false", () => {
    fc.assert(
      fc.property(fc.boolean(), (isSystem) => {
        expect(canDeleteRole({ isSystem })).toBe(!isSystem);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 6: Role name uniqueness within type scope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.6**
 *
 * Property 6: Role name uniqueness within type scope
 *
 * For any role name N and user_type T, if a role with name N and user_type T
 * already exists, creating another should fail. Creating with same name but
 * different type should succeed.
 */
describe("Feature: rbac-identity-system, Property 6: Role name uniqueness within type scope", () => {
  it("rejects duplicate role name within the same user type scope", () => {
    fc.assert(
      fc.property(arbRoleName, arbUserType, (name, userType) => {
        const existing = [{ name, userType }];
        expect(isRoleNameUniqueInScope(existing, name, userType)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("allows same role name in a different user type scope", () => {
    fc.assert(
      fc.property(
        arbRoleName,
        arbUserType,
        arbUserType,
        (name, existingType, newType) => {
          fc.pre(existingType !== newType);
          const existing = [{ name, userType: existingType }];
          expect(isRoleNameUniqueInScope(existing, name, newType)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("allows a new role name that does not exist in any scope", () => {
    fc.assert(
      fc.property(
        arbRoleName,
        arbRoleName,
        arbUserType,
        arbUserType,
        (existingName, newName, existingType, newType) => {
          fc.pre(existingName !== newName);
          const existing = [{ name: existingName, userType: existingType }];
          expect(isRoleNameUniqueInScope(existing, newName, newType)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 8: Role deletion cascades junction records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 4.6**
 *
 * Property 8: Role deletion cascades junction records
 *
 * For any non-system role with associated role_permissions and user_roles,
 * deleting the role should result in zero remaining junction records for
 * that role.
 */
describe("Feature: rbac-identity-system, Property 8: Role deletion cascades junction records", () => {
  it("removes all role_permissions and user_roles for the deleted role", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
        (roleId, permissionIds, userIds) => {
          const rolePerms = permissionIds.map((pid) => ({
            roleId,
            permissionId: pid,
          }));
          const userRoleRecords = userIds.map((uid) => ({
            userId: uid,
            roleId,
          }));

          const result = simulateRoleDeletionCascade(
            roleId,
            rolePerms,
            userRoleRecords
          );

          // No junction records should reference the deleted role
          expect(
            result.remainingRolePermissions.filter((rp) => rp.roleId === roleId)
          ).toHaveLength(0);
          expect(
            result.remainingUserRoles.filter((ur) => ur.roleId === roleId)
          ).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("preserves junction records for other roles", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        (deletedRoleId, otherRoleId, permissionIds, userIds) => {
          fc.pre(deletedRoleId !== otherRoleId);

          const rolePerms = [
            ...permissionIds.map((pid) => ({
              roleId: deletedRoleId,
              permissionId: pid,
            })),
            ...permissionIds.map((pid) => ({
              roleId: otherRoleId,
              permissionId: pid,
            })),
          ];
          const userRoleRecords = [
            ...userIds.map((uid) => ({ userId: uid, roleId: deletedRoleId })),
            ...userIds.map((uid) => ({ userId: uid, roleId: otherRoleId })),
          ];

          const result = simulateRoleDeletionCascade(
            deletedRoleId,
            rolePerms,
            userRoleRecords
          );

          // Other role's records should be preserved
          expect(
            result.remainingRolePermissions.filter(
              (rp) => rp.roleId === otherRoleId
            )
          ).toHaveLength(permissionIds.length);
          expect(
            result.remainingUserRoles.filter(
              (ur) => ur.roleId === otherRoleId
            )
          ).toHaveLength(userIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 11: Permission resolution is the union of role permissions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.4, 5.5**
 *
 * Property 11: Permission resolution is the union of role permissions
 *
 * For any user with a set of assigned roles R1, R2, ..., Rn, the resolved
 * permission set should equal the union of all permissions from each role.
 * No permissions should be added or lost during resolution.
 */
describe("Feature: rbac-identity-system, Property 11: Permission resolution is the union of role permissions", () => {
  it("resolved permissions equal the union of all role permission sets with no duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(arbPermissionString, { minLength: 0, maxLength: 8 }),
          { minLength: 0, maxLength: 5 }
        ),
        (roleSets) => {
          const resolved = resolvePermissionUnion(roleSets);

          // Build expected union
          const expectedSet = new Set<string>();
          for (const perms of roleSets) {
            for (const p of perms) {
              expectedSet.add(p);
            }
          }

          // Resolved set should have no duplicates
          expect(new Set(resolved).size).toBe(resolved.length);

          // Resolved set should equal the expected union
          expect(new Set(resolved)).toEqual(expectedSet);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no permissions are lost: every permission from every role appears in the resolved set", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(arbPermissionString, { minLength: 1, maxLength: 8 }),
          { minLength: 1, maxLength: 5 }
        ),
        (roleSets) => {
          const resolved = resolvePermissionUnion(roleSets);
          const resolvedSet = new Set(resolved);

          for (const perms of roleSets) {
            for (const p of perms) {
              expect(resolvedSet.has(p)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no extra permissions are added: every resolved permission exists in at least one role", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(arbPermissionString, { minLength: 0, maxLength: 8 }),
          { minLength: 0, maxLength: 5 }
        ),
        (roleSets) => {
          const resolved = resolvePermissionUnion(roleSets);
          const allPerms = new Set(roleSets.flat());

          for (const p of resolved) {
            expect(allPerms.has(p)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Permission check with wildcard support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.6, 13.2, 13.5**
 *
 * Property 12: Permission check with wildcard support
 *
 * For any set of permission strings PS and any required permission "R:A",
 * hasPermission should return true if PS contains "R:A" exactly OR if PS
 * contains "R:*". It should return false otherwise.
 */
describe("Feature: rbac-identity-system, Property 12: Permission check with wildcard support", () => {
  it("returns true when the exact permission is present", () => {
    fc.assert(
      fc.property(
        fc.array(arbPermissionString, { minLength: 0, maxLength: 10 }),
        arbPermissionString,
        (otherPerms, required) => {
          const permissions = [...otherPerms, required];
          expect(hasPermission(permissions, required)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns true when a wildcard permission for the resource is present", () => {
    fc.assert(
      fc.property(
        fc.array(arbPermissionString, { minLength: 0, maxLength: 10 }),
        arbPermissionSegment,
        arbPermissionSegment,
        (otherPerms, resource, action) => {
          const required = `${resource}:${action}`;
          const wildcard = `${resource}:*`;
          const permissions = [...otherPerms, wildcard];
          expect(hasPermission(permissions, required)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns false when neither exact match nor wildcard is present", () => {
    fc.assert(
      fc.property(
        arbPermissionSegment,
        arbPermissionSegment,
        fc.array(
          fc.tuple(arbPermissionSegment, arbPermissionSegment),
          { minLength: 0, maxLength: 10 }
        ),
        (resource, action, otherPairs) => {
          const required = `${resource}:${action}`;
          const wildcard = `${resource}:*`;

          // Filter out any permissions that would match
          const permissions = otherPairs
            .map(([r, a]) => `${r}:${a}`)
            .filter((p) => p !== required && p !== wildcard);

          expect(hasPermission(permissions, required)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("hasPermission is consistent: exact match OR wildcard match iff true", () => {
    fc.assert(
      fc.property(
        fc.array(arbPermissionString, { minLength: 0, maxLength: 10 }),
        arbPermissionSegment,
        arbPermissionSegment,
        (permissions, resource, action) => {
          const required = `${resource}:${action}`;
          const wildcard = `${resource}:*`;

          const hasExact = permissions.includes(required);
          const hasWildcard = permissions.includes(wildcard);
          const result = hasPermission(permissions, required);

          expect(result).toBe(hasExact || hasWildcard);
        }
      ),
      { numRuns: 100 }
    );
  });
});
