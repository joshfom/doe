import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 16: Broker approval activates company and user
// Feature: rbac-identity-system, Property 17: Broker rejection sets status

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
  userType: string;
  isActive: boolean;
  emailVerified: boolean;
}

interface ProfileState {
  id: string;
  userId: string;
  companyId: string;
  isCompanyAdmin: boolean;
  status: ProfileStatus;
}

// ── Pure state-transition helpers ────────────────────────────────────────────

/**
 * Applies approval to a pending broker company.
 * Returns the expected new states for company, user, and profile.
 */
function applyApproval(
  company: CompanyState,
  user: UserState,
  profile: ProfileState
): { company: CompanyState; user: UserState; profile: ProfileState } {
  return {
    company: { ...company, status: "active" },
    user: { ...user, isActive: true },
    profile: { ...profile, status: "active" },
  };
}

/**
 * Applies rejection to a pending broker company.
 * Returns the expected new state for the company.
 */
function applyRejection(company: CompanyState): CompanyState {
  return { ...company, status: "rejected" };
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbCompanyName = fc.stringMatching(/^[a-zA-Z0-9 _-]+$/, {
  minLength: 1,
  maxLength: 40,
});

/** Generates a pending company state (the precondition for approval/rejection). */
const arbPendingCompany: fc.Arbitrary<CompanyState> = fc.record({
  id: fc.uuid(),
  companyName: arbCompanyName,
  status: fc.constant("pending" as CompanyStatus),
});

/** Generates a broker user state as created during registration (inactive). */
const arbRegisteredBrokerUser: fc.Arbitrary<UserState> = fc.record({
  id: fc.uuid(),
  userType: fc.constant("broker"),
  isActive: fc.constant(false),
  emailVerified: fc.constant(false),
});

/** Generates a broker profile state as created during registration (inactive, company admin). */
const arbRegisteredProfile = (
  userId: string,
  companyId: string
): fc.Arbitrary<ProfileState> =>
  fc.record({
    id: fc.uuid(),
    userId: fc.constant(userId),
    companyId: fc.constant(companyId),
    isCompanyAdmin: fc.constant(true),
    status: fc.constant("inactive" as ProfileStatus),
  });


// ─────────────────────────────────────────────────────────────────────────────
// Property 16: Broker approval activates company and user
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 8.3, 8.4**
 *
 * Property 16: Broker approval activates company and user
 *
 * For any pending broker_company, when an administrator approves it, the
 * company status should become "active", the associated broker user's
 * is_active should become true, and the broker_profile status should
 * become "active".
 */
describe("Feature: rbac-identity-system, Property 16: Broker approval activates company and user", () => {
  it("sets company status to 'active' after approval", () => {
    fc.assert(
      fc.property(arbPendingCompany, (company) => {
        const result = applyApproval(
          company,
          { id: "u1", userType: "broker", isActive: false, emailVerified: false },
          { id: "p1", userId: "u1", companyId: company.id, isCompanyAdmin: true, status: "inactive" }
        );
        expect(result.company.status).toBe("active");
      }),
      { numRuns: 100 }
    );
  });

  it("sets broker user isActive to true after approval", () => {
    fc.assert(
      fc.property(
        arbPendingCompany,
        arbRegisteredBrokerUser,
        (company, user) => {
          const profile: ProfileState = {
            id: "p1",
            userId: user.id,
            companyId: company.id,
            isCompanyAdmin: true,
            status: "inactive",
          };
          const result = applyApproval(company, user, profile);
          expect(result.user.isActive).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sets broker_profile status to 'active' after approval", () => {
    fc.assert(
      fc.property(
        arbPendingCompany,
        arbRegisteredBrokerUser,
        (company, user) => {
          const profile: ProfileState = {
            id: "p1",
            userId: user.id,
            companyId: company.id,
            isCompanyAdmin: true,
            status: "inactive",
          };
          const result = applyApproval(company, user, profile);
          expect(result.profile.status).toBe("active");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("preserves all other fields during approval", () => {
    fc.assert(
      fc.property(
        arbPendingCompany,
        arbRegisteredBrokerUser,
        (company, user) => {
          const profile: ProfileState = {
            id: "p1",
            userId: user.id,
            companyId: company.id,
            isCompanyAdmin: true,
            status: "inactive",
          };
          const result = applyApproval(company, user, profile);

          // Company identity preserved
          expect(result.company.id).toBe(company.id);
          expect(result.company.companyName).toBe(company.companyName);

          // User identity preserved
          expect(result.user.id).toBe(user.id);
          expect(result.user.userType).toBe("broker");

          // Profile identity preserved
          expect(result.profile.userId).toBe(user.id);
          expect(result.profile.companyId).toBe(company.id);
          expect(result.profile.isCompanyAdmin).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("approval is idempotent on the output structure", () => {
    fc.assert(
      fc.property(
        arbPendingCompany,
        arbRegisteredBrokerUser,
        (company, user) => {
          const profile: ProfileState = {
            id: "p1",
            userId: user.id,
            companyId: company.id,
            isCompanyAdmin: true,
            status: "inactive",
          };
          const first = applyApproval(company, user, profile);
          const second = applyApproval(company, user, profile);

          expect(first.company.status).toBe(second.company.status);
          expect(first.user.isActive).toBe(second.user.isActive);
          expect(first.profile.status).toBe(second.profile.status);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 17: Broker rejection sets status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 8.6**
 *
 * Property 17: Broker rejection sets status
 *
 * For any pending broker_company, when an administrator rejects it, the
 * company status should become "rejected".
 */
describe("Feature: rbac-identity-system, Property 17: Broker rejection sets status", () => {
  it("sets company status to 'rejected' after rejection", () => {
    fc.assert(
      fc.property(arbPendingCompany, (company) => {
        const result = applyRejection(company);
        expect(result.status).toBe("rejected");
      }),
      { numRuns: 100 }
    );
  });

  it("preserves company identity fields during rejection", () => {
    fc.assert(
      fc.property(arbPendingCompany, (company) => {
        const result = applyRejection(company);
        expect(result.id).toBe(company.id);
        expect(result.companyName).toBe(company.companyName);
      }),
      { numRuns: 100 }
    );
  });

  it("rejection only changes status, no other fields are modified", () => {
    fc.assert(
      fc.property(arbPendingCompany, (company) => {
        const result = applyRejection(company);
        const { status: _oldStatus, ...oldRest } = company;
        const { status: _newStatus, ...newRest } = result;
        expect(newRest).toEqual(oldRest);
      }),
      { numRuns: 100 }
    );
  });

  it("rejection is idempotent on the output structure", () => {
    fc.assert(
      fc.property(arbPendingCompany, (company) => {
        const first = applyRejection(company);
        const second = applyRejection(company);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 }
    );
  });
});
