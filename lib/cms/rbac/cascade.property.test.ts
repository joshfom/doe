import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 22: Company suspension cascades to all users
// Feature: rbac-identity-system, Property 23: Company reactivation restores only active-profile users

// ── Types ────────────────────────────────────────────────────────────────────

type CompanyStatus = "pending" | "active" | "suspended" | "rejected";
type ProfileStatus = "active" | "inactive";

interface CompanyState {
  id: string;
  companyName: string;
  status: CompanyStatus;
}

interface UserState {
  id: string;
  isActive: boolean;
}

interface BrokerProfileState {
  id: string;
  userId: string;
  companyId: string;
  isCompanyAdmin: boolean;
  status: ProfileStatus;
}

interface CompanyWithUsers {
  company: CompanyState;
  users: UserState[];
  profiles: BrokerProfileState[];
}

// ── Pure cascade helpers (simulate the DB cascade logic in-memory) ───────────

/**
 * Simulates company suspension cascade.
 * Sets company status to "suspended" and all linked users' isActive to false.
 */
function applySuspension(state: CompanyWithUsers): CompanyWithUsers {
  return {
    company: { ...state.company, status: "suspended" },
    users: state.users.map((u) => ({ ...u, isActive: false })),
    profiles: state.profiles,
  };
}

/**
 * Simulates company reactivation cascade.
 * Sets company status to "active" and restores isActive to true only for
 * users whose broker_profile status is "active". Users with inactive profiles
 * remain isActive false.
 */
function applyReactivation(state: CompanyWithUsers): CompanyWithUsers {
  const activeProfileUserIds = new Set(
    state.profiles
      .filter((p) => p.status === "active")
      .map((p) => p.userId)
  );

  return {
    company: { ...state.company, status: "active" },
    users: state.users.map((u) => ({
      ...u,
      isActive: activeProfileUserIds.has(u.id),
    })),
    profiles: state.profiles,
  };
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbCompanyName = fc.stringMatching(/^[a-zA-Z0-9 _-]+$/, {
  minLength: 1,
  maxLength: 40,
});

/** Generates an active company (precondition for suspension). */
const arbActiveCompany: fc.Arbitrary<CompanyState> = fc.record({
  id: fc.uuid(),
  companyName: arbCompanyName,
  status: fc.constant("active" as CompanyStatus),
});

/** Generates a suspended company (precondition for reactivation). */
const arbSuspendedCompany: fc.Arbitrary<CompanyState> = fc.record({
  id: fc.uuid(),
  companyName: arbCompanyName,
  status: fc.constant("suspended" as CompanyStatus),
});

/**
 * Generates a company with N linked users and profiles.
 * Each user has a corresponding broker profile with a random active/inactive status.
 */
function arbCompanyWithUsers(
  companyArb: fc.Arbitrary<CompanyState>,
  minUsers: number,
  maxUsers: number
): fc.Arbitrary<CompanyWithUsers> {
  return companyArb.chain((company) =>
    fc
      .array(
        fc.record({
          userId: fc.uuid(),
          profileId: fc.uuid(),
          isCompanyAdmin: fc.boolean(),
          profileStatus: fc.constantFrom(
            "active" as ProfileStatus,
            "inactive" as ProfileStatus
          ),
          userIsActive: fc.boolean(),
        }),
        { minLength: minUsers, maxLength: maxUsers }
      )
      .map((entries) => ({
        company,
        users: entries.map((e) => ({
          id: e.userId,
          isActive: e.userIsActive,
        })),
        profiles: entries.map((e) => ({
          id: e.profileId,
          userId: e.userId,
          companyId: company.id,
          isCompanyAdmin: e.isCompanyAdmin,
          status: e.profileStatus,
        })),
      }))
  );
}

/**
 * Generates a company with a guaranteed mix of active and inactive profiles.
 * At least one active-profile user and at least one inactive-profile user.
 */
function arbCompanyWithMixedProfiles(
  companyArb: fc.Arbitrary<CompanyState>
): fc.Arbitrary<CompanyWithUsers> {
  return companyArb.chain((company) =>
    fc
      .tuple(
        // At least one active-profile user
        fc.array(
          fc.record({ userId: fc.uuid(), profileId: fc.uuid() }),
          { minLength: 1, maxLength: 5 }
        ),
        // At least one inactive-profile user
        fc.array(
          fc.record({ userId: fc.uuid(), profileId: fc.uuid() }),
          { minLength: 1, maxLength: 5 }
        )
      )
      .map(([activeEntries, inactiveEntries]) => {
        const users: UserState[] = [];
        const profiles: BrokerProfileState[] = [];

        for (const e of activeEntries) {
          users.push({ id: e.userId, isActive: false }); // suspended state
          profiles.push({
            id: e.profileId,
            userId: e.userId,
            companyId: company.id,
            isCompanyAdmin: false,
            status: "active",
          });
        }

        for (const e of inactiveEntries) {
          users.push({ id: e.userId, isActive: false }); // suspended state
          profiles.push({
            id: e.profileId,
            userId: e.userId,
            companyId: company.id,
            isCompanyAdmin: false,
            status: "inactive",
          });
        }

        return { company, users, profiles };
      })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 22: Company suspension cascades to all users
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 10.1**
 *
 * Property 22: Company suspension cascades to all users
 *
 * For any broker_company with N linked users, setting the company status to
 * "suspended" should result in all N users having is_active set to false.
 */
describe("Feature: rbac-identity-system, Property 22: Company suspension cascades to all users", () => {
  it("sets company status to 'suspended'", () => {
    fc.assert(
      fc.property(
        arbCompanyWithUsers(arbActiveCompany, 1, 10),
        (state) => {
          const result = applySuspension(state);
          expect(result.company.status).toBe("suspended");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sets isActive to false for all N linked users", () => {
    fc.assert(
      fc.property(
        arbCompanyWithUsers(arbActiveCompany, 1, 10),
        (state) => {
          const result = applySuspension(state);
          expect(result.users.length).toBe(state.users.length);
          for (const user of result.users) {
            expect(user.isActive).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("works correctly with zero users (empty company)", () => {
    fc.assert(
      fc.property(
        arbCompanyWithUsers(arbActiveCompany, 0, 0),
        (state) => {
          const result = applySuspension(state);
          expect(result.company.status).toBe("suspended");
          expect(result.users.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does not modify broker profile statuses during suspension", () => {
    fc.assert(
      fc.property(
        arbCompanyWithUsers(arbActiveCompany, 1, 10),
        (state) => {
          const result = applySuspension(state);
          for (let i = 0; i < result.profiles.length; i++) {
            expect(result.profiles[i].status).toBe(state.profiles[i].status);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("preserves user identity fields during suspension", () => {
    fc.assert(
      fc.property(
        arbCompanyWithUsers(arbActiveCompany, 1, 10),
        (state) => {
          const result = applySuspension(state);
          for (let i = 0; i < result.users.length; i++) {
            expect(result.users[i].id).toBe(state.users[i].id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 23: Company reactivation restores only active-profile users
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 10.2**
 *
 * Property 23: Company reactivation restores only active-profile users
 *
 * For any broker_company with a mix of active-profile and inactive-profile
 * users, reactivation should set is_active to true only for users whose
 * broker_profile status is "active". Users with inactive profiles should
 * remain is_active false.
 */
describe("Feature: rbac-identity-system, Property 23: Company reactivation restores only active-profile users", () => {
  it("sets company status to 'active'", () => {
    fc.assert(
      fc.property(
        arbCompanyWithMixedProfiles(arbSuspendedCompany),
        (state) => {
          const result = applyReactivation(state);
          expect(result.company.status).toBe("active");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sets isActive to true for users with active broker profiles", () => {
    fc.assert(
      fc.property(
        arbCompanyWithMixedProfiles(arbSuspendedCompany),
        (state) => {
          const result = applyReactivation(state);
          const activeProfileUserIds = new Set(
            state.profiles
              .filter((p) => p.status === "active")
              .map((p) => p.userId)
          );
          for (const user of result.users) {
            if (activeProfileUserIds.has(user.id)) {
              expect(user.isActive).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("keeps isActive false for users with inactive broker profiles", () => {
    fc.assert(
      fc.property(
        arbCompanyWithMixedProfiles(arbSuspendedCompany),
        (state) => {
          const result = applyReactivation(state);
          const inactiveProfileUserIds = new Set(
            state.profiles
              .filter((p) => p.status === "inactive")
              .map((p) => p.userId)
          );
          for (const user of result.users) {
            if (inactiveProfileUserIds.has(user.id)) {
              expect(user.isActive).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the count of reactivated users equals the count of active profiles", () => {
    fc.assert(
      fc.property(
        arbCompanyWithMixedProfiles(arbSuspendedCompany),
        (state) => {
          const result = applyReactivation(state);
          const activeProfileCount = state.profiles.filter(
            (p) => p.status === "active"
          ).length;
          const reactivatedCount = result.users.filter(
            (u) => u.isActive === true
          ).length;
          expect(reactivatedCount).toBe(activeProfileCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does not modify broker profile statuses during reactivation", () => {
    fc.assert(
      fc.property(
        arbCompanyWithMixedProfiles(arbSuspendedCompany),
        (state) => {
          const result = applyReactivation(state);
          for (let i = 0; i < result.profiles.length; i++) {
            expect(result.profiles[i].status).toBe(state.profiles[i].status);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("preserves user identity fields during reactivation", () => {
    fc.assert(
      fc.property(
        arbCompanyWithMixedProfiles(arbSuspendedCompany),
        (state) => {
          const result = applyReactivation(state);
          for (let i = 0; i < result.users.length; i++) {
            expect(result.users[i].id).toBe(state.users[i].id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
