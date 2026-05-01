import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 27: Migration idempotence
// Feature: rbac-identity-system, Property 28: Migration creates profiles and assigns roles for existing users

// ── Types ────────────────────────────────────────────────────────────────────

interface UserState {
  id: string;
  userType: string;
  isActive: boolean;
  emailVerified: boolean;
}

interface EmployeeProfileState {
  userId: string;
  department: string;
  jobTitle: string;
}

interface UserRoleState {
  userId: string;
  roleId: string;
}

interface MigrationState {
  users: UserState[];
  employeeProfiles: EmployeeProfileState[];
  userRoles: UserRoleState[];
  superAdminRoleId: string;
}

// ── Pure migration helper (simulates the DB migration logic in-memory) ──────

/**
 * Simulates migrateExistingUsers in-memory.
 * 1. Sets all users to employee/active/verified
 * 2. Creates employee_profiles for users that don't have one
 * 3. Assigns super_admin role to users that don't already have it
 */
function applyMigration(state: MigrationState): MigrationState {
  // 1. Update all users to employee defaults
  const updatedUsers = state.users.map((u) => ({
    ...u,
    userType: "employee",
    isActive: true,
    emailVerified: true,
  }));

  // 2. Create employee_profiles for users without one (no duplicates)
  const existingProfileUserIds = new Set(
    state.employeeProfiles.map((p) => p.userId)
  );
  const newProfiles: EmployeeProfileState[] = [];
  for (const user of updatedUsers) {
    if (!existingProfileUserIds.has(user.id)) {
      newProfiles.push({
        userId: user.id,
        department: "General",
        jobTitle: "Staff",
      });
    }
  }
  const allProfiles = [...state.employeeProfiles, ...newProfiles];

  // 3. Assign super_admin role to users without it (no duplicates)
  const existingRoleUserIds = new Set(
    state.userRoles
      .filter((r) => r.roleId === state.superAdminRoleId)
      .map((r) => r.userId)
  );
  const newRoles: UserRoleState[] = [];
  for (const user of updatedUsers) {
    if (!existingRoleUserIds.has(user.id)) {
      newRoles.push({
        userId: user.id,
        roleId: state.superAdminRoleId,
      });
    }
  }
  const allRoles = [...state.userRoles, ...newRoles];

  return {
    users: updatedUsers,
    employeeProfiles: allProfiles,
    userRoles: allRoles,
    superAdminRoleId: state.superAdminRoleId,
  };
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbUserType = fc.constantFrom("employee", "broker", "client", "vendor");

const arbUser: fc.Arbitrary<UserState> = fc.record({
  id: fc.uuid(),
  userType: arbUserType,
  isActive: fc.boolean(),
  emailVerified: fc.boolean(),
});

/**
 * Generates a pre-migration state: a set of users with no profiles or roles yet.
 * This simulates the state before migration has ever run.
 */
function arbFreshMigrationState(): fc.Arbitrary<MigrationState> {
  return fc.tuple(
    fc.array(arbUser, { minLength: 1, maxLength: 10 }),
    fc.uuid()
  ).map(([users, superAdminRoleId]) => ({
    users,
    employeeProfiles: [],
    userRoles: [],
    superAdminRoleId,
  }));
}

/**
 * Generates a partially-migrated state: some users may already have profiles
 * and/or role assignments.
 */
function arbPartialMigrationState(): fc.Arbitrary<MigrationState> {
  return fc.tuple(
    fc.array(arbUser, { minLength: 1, maxLength: 10 }),
    fc.uuid()
  ).chain(([users, superAdminRoleId]) => {
    // Randomly decide which users already have profiles
    return fc.tuple(
      fc.array(fc.boolean(), { minLength: users.length, maxLength: users.length }),
      fc.array(fc.boolean(), { minLength: users.length, maxLength: users.length })
    ).map(([hasProfile, hasRole]) => {
      const profiles: EmployeeProfileState[] = [];
      const roles: UserRoleState[] = [];

      for (let i = 0; i < users.length; i++) {
        if (hasProfile[i]) {
          profiles.push({
            userId: users[i].id,
            department: "Existing",
            jobTitle: "Existing",
          });
        }
        if (hasRole[i]) {
          roles.push({
            userId: users[i].id,
            roleId: superAdminRoleId,
          });
        }
      }

      return {
        users,
        employeeProfiles: profiles,
        userRoles: roles,
        superAdminRoleId,
      };
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 27: Migration idempotence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 12.5**
 *
 * Property 27: Migration idempotence
 *
 * For any database state, running the migration N times should produce the
 * same result as running it once. No duplicate profiles or role assignments
 * should be created.
 */
describe("Feature: rbac-identity-system, Property 27: Migration idempotence", () => {
  it("running migration twice produces the same result as running it once", () => {
    fc.assert(
      fc.property(
        arbPartialMigrationState(),
        (state) => {
          const afterOnce = applyMigration(state);
          const afterTwice = applyMigration(afterOnce);

          expect(afterTwice.users).toEqual(afterOnce.users);
          expect(afterTwice.employeeProfiles).toEqual(afterOnce.employeeProfiles);
          expect(afterTwice.userRoles).toEqual(afterOnce.userRoles);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("running migration N times (N >= 1) produces the same result as once", () => {
    fc.assert(
      fc.property(
        arbPartialMigrationState(),
        fc.integer({ min: 2, max: 5 }),
        (state, n) => {
          const afterOnce = applyMigration(state);
          let current = state;
          for (let i = 0; i < n; i++) {
            current = applyMigration(current);
          }

          expect(current.users).toEqual(afterOnce.users);
          expect(current.employeeProfiles).toEqual(afterOnce.employeeProfiles);
          expect(current.userRoles).toEqual(afterOnce.userRoles);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no duplicate employee_profiles are created after multiple runs", () => {
    fc.assert(
      fc.property(
        arbPartialMigrationState(),
        (state) => {
          const afterOnce = applyMigration(state);
          const afterTwice = applyMigration(afterOnce);

          const profileUserIds = afterTwice.employeeProfiles.map((p) => p.userId);
          const uniqueIds = new Set(profileUserIds);
          expect(uniqueIds.size).toBe(profileUserIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no duplicate user_roles are created after multiple runs", () => {
    fc.assert(
      fc.property(
        arbPartialMigrationState(),
        (state) => {
          const afterOnce = applyMigration(state);
          const afterTwice = applyMigration(afterOnce);

          const roleKeys = afterTwice.userRoles.map(
            (r) => `${r.userId}:${r.roleId}`
          );
          const uniqueKeys = new Set(roleKeys);
          expect(uniqueKeys.size).toBe(roleKeys.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 28: Migration creates profiles and assigns roles for existing users
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 12.3, 12.4**
 *
 * Property 28: Migration creates profiles and assigns roles for existing users
 *
 * For any set of pre-existing users, after migration each user should have
 * exactly one employee_profile record and exactly one user_role assignment
 * for the super_admin role.
 */
describe("Feature: rbac-identity-system, Property 28: Migration creates profiles and assigns roles for existing users", () => {
  it("every user has exactly one employee_profile after migration", () => {
    fc.assert(
      fc.property(
        arbFreshMigrationState(),
        (state) => {
          const result = applyMigration(state);

          for (const user of result.users) {
            const profileCount = result.employeeProfiles.filter(
              (p) => p.userId === user.id
            ).length;
            expect(profileCount).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every user has exactly one super_admin role assignment after migration", () => {
    fc.assert(
      fc.property(
        arbFreshMigrationState(),
        (state) => {
          const result = applyMigration(state);

          for (const user of result.users) {
            const roleCount = result.userRoles.filter(
              (r) => r.userId === user.id && r.roleId === state.superAdminRoleId
            ).length;
            expect(roleCount).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all users have userType='employee', isActive=true, emailVerified=true after migration", () => {
    fc.assert(
      fc.property(
        arbFreshMigrationState(),
        (state) => {
          const result = applyMigration(state);

          for (const user of result.users) {
            expect(user.userType).toBe("employee");
            expect(user.isActive).toBe(true);
            expect(user.emailVerified).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("employee_profiles have default department and jobTitle values", () => {
    fc.assert(
      fc.property(
        arbFreshMigrationState(),
        (state) => {
          const result = applyMigration(state);

          for (const profile of result.employeeProfiles) {
            expect(profile.department).toBe("General");
            expect(profile.jobTitle).toBe("Staff");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("preserves existing profiles when some users already have them", () => {
    fc.assert(
      fc.property(
        arbPartialMigrationState(),
        (state) => {
          const result = applyMigration(state);

          // Every pre-existing profile should still be present
          for (const existing of state.employeeProfiles) {
            const found = result.employeeProfiles.find(
              (p) => p.userId === existing.userId
            );
            expect(found).toBeDefined();
            // Existing profiles keep their original values
            expect(found!.department).toBe(existing.department);
            expect(found!.jobTitle).toBe(existing.jobTitle);
          }

          // Every user should have exactly one profile
          for (const user of result.users) {
            const profileCount = result.employeeProfiles.filter(
              (p) => p.userId === user.id
            ).length;
            expect(profileCount).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
