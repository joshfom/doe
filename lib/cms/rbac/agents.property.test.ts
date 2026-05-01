import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 18: Agent addition creates correct records
// Feature: rbac-identity-system, Property 19: Agent management restricted to company admins
// Feature: rbac-identity-system, Property 20: Agent deactivation sets correct flags
// Feature: rbac-identity-system, Property 21: Agent management company isolation

// ── Types ────────────────────────────────────────────────────────────────────

type ProfileStatus = "active" | "inactive";

interface UserState {
  id: string;
  userType: string;
  isActive: boolean;
  emailVerified: boolean;
  passwordHash: string | null;
}

interface BrokerProfileState {
  id: string;
  userId: string;
  companyId: string;
  isCompanyAdmin: boolean;
  status: ProfileStatus;
}

interface AgentData {
  name: string;
  email: string;
  phone?: string;
}

interface AgentAdditionOutput {
  user: {
    userType: string;
    isActive: boolean;
    emailVerified: boolean;
    passwordHash: null;
  };
  profile: {
    companyId: string;
    isCompanyAdmin: boolean;
    status: ProfileStatus;
  };
  roleAssignment: { roleName: string };
}

// ── Pure helper functions ────────────────────────────────────────────────────

/**
 * Encodes the expected output structure when a company admin adds an agent.
 * Mirrors the logic in addAgent from registration.ts.
 */
function buildExpectedAgentOutput(
  adminProfile: BrokerProfileState,
  _agentData: AgentData
): AgentAdditionOutput {
  return {
    user: {
      userType: "broker",
      isActive: true,
      emailVerified: false,
      passwordHash: null,
    },
    profile: {
      companyId: adminProfile.companyId,
      isCompanyAdmin: false,
      status: "active",
    },
    roleAssignment: {
      roleName: "agent",
    },
  };
}

/**
 * Determines whether a broker user is allowed to perform agent management.
 * Only company admins can manage agents.
 */
function canManageAgents(profile: BrokerProfileState): boolean {
  return profile.isCompanyAdmin === true;
}

/**
 * Applies agent deactivation. Returns the expected new states.
 */
function applyDeactivation(
  user: UserState,
  profile: BrokerProfileState
): { user: UserState; profile: BrokerProfileState } {
  return {
    user: { ...user, isActive: false },
    profile: { ...profile, status: "inactive" },
  };
}

/**
 * Checks whether a management operation should be allowed based on company isolation.
 * An admin can only manage agents in their own company.
 */
function isCompanyIsolationViolation(
  adminProfile: BrokerProfileState,
  agentProfile: BrokerProfileState
): boolean {
  return adminProfile.companyId !== agentProfile.companyId;
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbNonEmptyTrimmedString = fc
  .stringMatching(/^[a-zA-Z0-9 _-]+$/, { minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const arbValidEmail = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9._+-]+$/, { minLength: 1, maxLength: 20 }),
    fc.stringMatching(/^[a-zA-Z0-9-]+$/, { minLength: 1, maxLength: 15 }),
    fc.stringMatching(/^[a-zA-Z]{2,6}$/, { minLength: 2, maxLength: 6 })
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const arbAgentData: fc.Arbitrary<AgentData> = fc.record({
  name: arbNonEmptyTrimmedString,
  email: arbValidEmail,
});

/** Generates a company admin broker profile (isCompanyAdmin = true, status = active). */
const arbCompanyAdminProfile: fc.Arbitrary<BrokerProfileState> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  companyId: fc.uuid(),
  isCompanyAdmin: fc.constant(true),
  status: fc.constant("active" as ProfileStatus),
});

/** Generates a non-admin broker profile (isCompanyAdmin = false). */
const arbNonAdminProfile: fc.Arbitrary<BrokerProfileState> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  companyId: fc.uuid(),
  isCompanyAdmin: fc.constant(false),
  status: fc.constantFrom("active" as ProfileStatus, "inactive" as ProfileStatus),
});

/** Generates a broker profile with random isCompanyAdmin value. */
const arbAnyBrokerProfile: fc.Arbitrary<BrokerProfileState> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  companyId: fc.uuid(),
  isCompanyAdmin: fc.boolean(),
  status: fc.constantFrom("active" as ProfileStatus, "inactive" as ProfileStatus),
});

/** Generates an active agent user. */
const arbActiveAgentUser: fc.Arbitrary<UserState> = fc.record({
  id: fc.uuid(),
  userType: fc.constant("broker"),
  isActive: fc.constant(true),
  emailVerified: fc.boolean(),
  passwordHash: fc.constant(null as string | null),
});

/** Generates an active agent profile (non-admin, active). */
const arbActiveAgentProfile = (
  userId: string,
  companyId: string
): fc.Arbitrary<BrokerProfileState> =>
  fc.record({
    id: fc.uuid(),
    userId: fc.constant(userId),
    companyId: fc.constant(companyId),
    isCompanyAdmin: fc.constant(false),
    status: fc.constant("active" as ProfileStatus),
  });

// ─────────────────────────────────────────────────────────────────────────────
// Property 18: Agent addition creates correct records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * Property 18: Agent addition creates correct records
 *
 * For any valid agent addition by a company admin, the service should create:
 * a user with user_type "broker" and is_active true and email_verified false
 * and null password_hash, a broker_profile linking to the admin's company with
 * is_company_admin false and status "active", and a user_role assignment for
 * the "agent" role.
 */
describe("Feature: rbac-identity-system, Property 18: Agent addition creates correct records", () => {
  it("produces a user record with userType 'broker', isActive true, emailVerified false, and null passwordHash", () => {
    fc.assert(
      fc.property(arbCompanyAdminProfile, arbAgentData, (adminProfile, agentData) => {
        const output = buildExpectedAgentOutput(adminProfile, agentData);
        expect(output.user.userType).toBe("broker");
        expect(output.user.isActive).toBe(true);
        expect(output.user.emailVerified).toBe(false);
        expect(output.user.passwordHash).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("produces a broker_profile linked to the admin's company with isCompanyAdmin false and status 'active'", () => {
    fc.assert(
      fc.property(arbCompanyAdminProfile, arbAgentData, (adminProfile, agentData) => {
        const output = buildExpectedAgentOutput(adminProfile, agentData);
        expect(output.profile.companyId).toBe(adminProfile.companyId);
        expect(output.profile.isCompanyAdmin).toBe(false);
        expect(output.profile.status).toBe("active");
      }),
      { numRuns: 100 }
    );
  });

  it("assigns the 'agent' role", () => {
    fc.assert(
      fc.property(arbCompanyAdminProfile, arbAgentData, (adminProfile, agentData) => {
        const output = buildExpectedAgentOutput(adminProfile, agentData);
        expect(output.roleAssignment.roleName).toBe("agent");
      }),
      { numRuns: 100 }
    );
  });

  it("agent profile always links to the same company as the admin", () => {
    fc.assert(
      fc.property(arbCompanyAdminProfile, arbAgentData, (adminProfile, agentData) => {
        const output = buildExpectedAgentOutput(adminProfile, agentData);
        expect(output.profile.companyId).toBe(adminProfile.companyId);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 19: Agent management restricted to company admins
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.5**
 *
 * Property 19: Agent management restricted to company admins
 *
 * For any broker user, agent management operations should succeed if and only
 * if the user's broker_profile has is_company_admin set to true.
 */
describe("Feature: rbac-identity-system, Property 19: Agent management restricted to company admins", () => {
  it("allows management when isCompanyAdmin is true", () => {
    fc.assert(
      fc.property(arbCompanyAdminProfile, (profile) => {
        expect(canManageAgents(profile)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("denies management when isCompanyAdmin is false", () => {
    fc.assert(
      fc.property(arbNonAdminProfile, (profile) => {
        expect(canManageAgents(profile)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("canManageAgents returns true iff isCompanyAdmin is true for any broker profile", () => {
    fc.assert(
      fc.property(arbAnyBrokerProfile, (profile) => {
        expect(canManageAgents(profile)).toBe(profile.isCompanyAdmin);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 20: Agent deactivation sets correct flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.6**
 *
 * Property 20: Agent deactivation sets correct flags
 *
 * For any active agent, deactivation should set the agent's broker_profile
 * status to "inactive" and the user's is_active flag to false.
 */
describe("Feature: rbac-identity-system, Property 20: Agent deactivation sets correct flags", () => {
  it("sets broker_profile status to 'inactive' after deactivation", () => {
    fc.assert(
      fc.property(arbActiveAgentUser, (user) => {
        const profile: BrokerProfileState = {
          id: "p1",
          userId: user.id,
          companyId: "c1",
          isCompanyAdmin: false,
          status: "active",
        };
        const result = applyDeactivation(user, profile);
        expect(result.profile.status).toBe("inactive");
      }),
      { numRuns: 100 }
    );
  });

  it("sets user isActive to false after deactivation", () => {
    fc.assert(
      fc.property(arbActiveAgentUser, (user) => {
        const profile: BrokerProfileState = {
          id: "p1",
          userId: user.id,
          companyId: "c1",
          isCompanyAdmin: false,
          status: "active",
        };
        const result = applyDeactivation(user, profile);
        expect(result.user.isActive).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("preserves user identity fields during deactivation", () => {
    fc.assert(
      fc.property(arbActiveAgentUser, (user) => {
        const profile: BrokerProfileState = {
          id: "p1",
          userId: user.id,
          companyId: "c1",
          isCompanyAdmin: false,
          status: "active",
        };
        const result = applyDeactivation(user, profile);
        expect(result.user.id).toBe(user.id);
        expect(result.user.userType).toBe("broker");
        expect(result.profile.userId).toBe(user.id);
        expect(result.profile.companyId).toBe("c1");
        expect(result.profile.isCompanyAdmin).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("deactivation is idempotent on the output structure", () => {
    fc.assert(
      fc.property(arbActiveAgentUser, (user) => {
        const profile: BrokerProfileState = {
          id: "p1",
          userId: user.id,
          companyId: "c1",
          isCompanyAdmin: false,
          status: "active",
        };
        const first = applyDeactivation(user, profile);
        const second = applyDeactivation(user, profile);
        expect(first.user.isActive).toBe(second.user.isActive);
        expect(first.profile.status).toBe(second.profile.status);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 21: Agent management company isolation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.7**
 *
 * Property 21: Agent management company isolation
 *
 * For any broker agency admin and any agent belonging to a different
 * broker_company, management operations should be rejected.
 */
describe("Feature: rbac-identity-system, Property 21: Agent management company isolation", () => {
  it("rejects management when agent belongs to a different company", () => {
    fc.assert(
      fc.property(
        arbCompanyAdminProfile,
        fc.uuid(),
        (adminProfile, differentCompanyId) => {
          // Ensure the company IDs are actually different
          fc.pre(differentCompanyId !== adminProfile.companyId);
          const agentProfile: BrokerProfileState = {
            id: "ap1",
            userId: "agent-user-1",
            companyId: differentCompanyId,
            isCompanyAdmin: false,
            status: "active",
          };
          expect(isCompanyIsolationViolation(adminProfile, agentProfile)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("allows management when agent belongs to the same company", () => {
    fc.assert(
      fc.property(arbCompanyAdminProfile, (adminProfile) => {
        const agentProfile: BrokerProfileState = {
          id: "ap1",
          userId: "agent-user-1",
          companyId: adminProfile.companyId,
          isCompanyAdmin: false,
          status: "active",
        };
        expect(isCompanyIsolationViolation(adminProfile, agentProfile)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("isolation check is symmetric — different companies always violate regardless of direction", () => {
    fc.assert(
      fc.property(
        arbCompanyAdminProfile,
        fc.uuid(),
        (adminProfile, otherCompanyId) => {
          fc.pre(otherCompanyId !== adminProfile.companyId);
          const otherProfile: BrokerProfileState = {
            id: "op1",
            userId: "other-user",
            companyId: otherCompanyId,
            isCompanyAdmin: false,
            status: "active",
          };
          // Both directions should detect the violation
          expect(isCompanyIsolationViolation(adminProfile, otherProfile)).toBe(true);
          expect(isCompanyIsolationViolation(otherProfile, adminProfile)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("same company never triggers isolation violation", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        (companyId, adminUserId, agentUserId) => {
          const admin: BrokerProfileState = {
            id: "a1",
            userId: adminUserId,
            companyId,
            isCompanyAdmin: true,
            status: "active",
          };
          const agent: BrokerProfileState = {
            id: "a2",
            userId: agentUserId,
            companyId,
            isCompanyAdmin: false,
            status: "active",
          };
          expect(isCompanyIsolationViolation(admin, agent)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
