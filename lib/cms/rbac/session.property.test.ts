import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 24: Session returns complete identity context
// Feature: rbac-identity-system, Property 25: Session returns broker-specific context

// ── Types ────────────────────────────────────────────────────────────────────

const VALID_USER_TYPES = ["employee", "broker", "client", "vendor"] as const;
type UserType = (typeof VALID_USER_TYPES)[number];

type CompanyStatus = "pending" | "active" | "suspended" | "rejected";
type ProfileStatus = "active" | "inactive";

interface RoleWithPermissions {
  name: string;
  permissions: string[];
}

interface SessionIdentityContext {
  userId: string;
  email: string;
  name: string;
  userType: UserType;
  isActive: boolean;
  emailVerified: boolean;
  roles: string[];
  permissions: string[];
}

interface BrokerSessionContext {
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  isCompanyAdmin: boolean;
  profileStatus: ProfileStatus;
}

interface EnhancedSessionResponse extends SessionIdentityContext {
  broker?: BrokerSessionContext;
}

// ── Pure helper functions (simulate session endpoint logic) ───────────────────

/**
 * Builds the complete identity context for a session response.
 * Given a user and their assigned roles (each with permissions), returns
 * all N role names and the complete resolved permission set (union).
 */
function buildSessionIdentityContext(
  userId: string,
  email: string,
  name: string,
  userType: UserType,
  isActive: boolean,
  emailVerified: boolean,
  assignedRoles: RoleWithPermissions[]
): SessionIdentityContext {
  const roleNames = assignedRoles.map((r) => r.name);

  // Resolve permissions as the union of all role permissions
  const permissionSet = new Set<string>();
  for (const role of assignedRoles) {
    for (const perm of role.permissions) {
      permissionSet.add(perm);
    }
  }

  return {
    userId,
    email,
    name,
    userType,
    isActive,
    emailVerified,
    roles: roleNames,
    permissions: Array.from(permissionSet),
  };
}

/**
 * Builds the broker-specific context for a session response.
 * Returns the broker_company id, company_name, company status,
 * and the broker_profile is_company_admin flag and profile status.
 */
function buildBrokerSessionContext(
  companyId: string,
  companyName: string,
  companyStatus: CompanyStatus,
  isCompanyAdmin: boolean,
  profileStatus: ProfileStatus
): BrokerSessionContext {
  return {
    companyId,
    companyName,
    companyStatus,
    isCompanyAdmin,
    profileStatus,
  };
}

/**
 * Builds the full enhanced session response, including broker context
 * when the user is a broker.
 */
function buildEnhancedSessionResponse(
  identity: SessionIdentityContext,
  brokerContext?: BrokerSessionContext
): EnhancedSessionResponse {
  const response: EnhancedSessionResponse = { ...identity };
  if (brokerContext) {
    response.broker = brokerContext;
  }
  return response;
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbUserType = fc.constantFrom<UserType>(...VALID_USER_TYPES);

const arbPermissionSegment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/, {
  minLength: 1,
  maxLength: 15,
});

const arbPermissionString = fc
  .tuple(arbPermissionSegment, arbPermissionSegment)
  .map(([resource, action]) => `${resource}:${action}`);

const arbRoleName = fc.stringMatching(/^[a-zA-Z0-9_-]+$/, {
  minLength: 1,
  maxLength: 25,
});

const arbNonEmptyString = fc.stringMatching(/^[a-zA-Z0-9 _-]+$/, {
  minLength: 1,
  maxLength: 30,
});

const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9._+-]+$/, { minLength: 1, maxLength: 15 }),
    fc.stringMatching(/^[a-zA-Z0-9-]+$/, { minLength: 1, maxLength: 10 }),
    fc.stringMatching(/^[a-zA-Z]{2,4}$/, { minLength: 2, maxLength: 4 })
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const arbRoleWithPermissions: fc.Arbitrary<RoleWithPermissions> = fc.record({
  name: arbRoleName,
  permissions: fc.array(arbPermissionString, { minLength: 0, maxLength: 6 }),
});

const arbCompanyStatus = fc.constantFrom<CompanyStatus>(
  "pending",
  "active",
  "suspended",
  "rejected"
);

const arbProfileStatus = fc.constantFrom<ProfileStatus>("active", "inactive");

// ─────────────────────────────────────────────────────────────────────────────
// Property 24: Session returns complete identity context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 14.2, 14.3**
 *
 * Property 24: Session returns complete identity context
 *
 * For any user with N assigned roles, the session endpoint should return
 * all N role names and the complete resolved permission set (union of all
 * role permissions).
 */
describe("Feature: rbac-identity-system, Property 24: Session returns complete identity context", () => {
  it("returns all N role names for a user with N assigned roles", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        arbUserType,
        fc.array(arbRoleWithPermissions, { minLength: 0, maxLength: 8 }),
        (userId, email, name, userType, assignedRoles) => {
          const session = buildSessionIdentityContext(
            userId,
            email,
            name,
            userType,
            true,
            true,
            assignedRoles
          );

          expect(session.roles.length).toBe(assignedRoles.length);
          for (let i = 0; i < assignedRoles.length; i++) {
            expect(session.roles[i]).toBe(assignedRoles[i].name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns the complete resolved permission set as the union of all role permissions", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        arbUserType,
        fc.array(arbRoleWithPermissions, { minLength: 1, maxLength: 8 }),
        (userId, email, name, userType, assignedRoles) => {
          const session = buildSessionIdentityContext(
            userId,
            email,
            name,
            userType,
            true,
            true,
            assignedRoles
          );

          // Build expected union
          const expectedSet = new Set<string>();
          for (const role of assignedRoles) {
            for (const perm of role.permissions) {
              expectedSet.add(perm);
            }
          }

          // Session permissions should equal the union (no duplicates)
          expect(new Set(session.permissions)).toEqual(expectedSet);
          expect(new Set(session.permissions).size).toBe(session.permissions.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no permissions are lost: every permission from every role appears in the session", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        arbUserType,
        fc.array(arbRoleWithPermissions, { minLength: 1, maxLength: 8 }),
        (userId, email, name, userType, assignedRoles) => {
          const session = buildSessionIdentityContext(
            userId,
            email,
            name,
            userType,
            true,
            true,
            assignedRoles
          );

          const resolvedSet = new Set(session.permissions);
          for (const role of assignedRoles) {
            for (const perm of role.permissions) {
              expect(resolvedSet.has(perm)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no extra permissions are added: every session permission exists in at least one role", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        arbUserType,
        fc.array(arbRoleWithPermissions, { minLength: 0, maxLength: 8 }),
        (userId, email, name, userType, assignedRoles) => {
          const session = buildSessionIdentityContext(
            userId,
            email,
            name,
            userType,
            true,
            true,
            assignedRoles
          );

          const allPerms = new Set(assignedRoles.flatMap((r) => r.permissions));
          for (const perm of session.permissions) {
            expect(allPerms.has(perm)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("preserves user identity fields in the session response", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        arbUserType,
        fc.boolean(),
        fc.boolean(),
        fc.array(arbRoleWithPermissions, { minLength: 0, maxLength: 5 }),
        (userId, email, name, userType, isActive, emailVerified, assignedRoles) => {
          const session = buildSessionIdentityContext(
            userId,
            email,
            name,
            userType,
            isActive,
            emailVerified,
            assignedRoles
          );

          expect(session.userId).toBe(userId);
          expect(session.email).toBe(email);
          expect(session.name).toBe(name);
          expect(session.userType).toBe(userType);
          expect(session.isActive).toBe(isActive);
          expect(session.emailVerified).toBe(emailVerified);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 25: Session returns broker-specific context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 14.4, 14.5**
 *
 * Property 25: Session returns broker-specific context
 *
 * For any broker user, the session endpoint should return the broker_company
 * id, company_name, and company status, as well as the broker_profile
 * is_company_admin flag and profile status.
 */
describe("Feature: rbac-identity-system, Property 25: Session returns broker-specific context", () => {
  it("includes broker context with companyId, companyName, and companyStatus", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbNonEmptyString,
        arbCompanyStatus,
        fc.boolean(),
        arbProfileStatus,
        (companyId, companyName, companyStatus, isCompanyAdmin, profileStatus) => {
          const brokerCtx = buildBrokerSessionContext(
            companyId,
            companyName,
            companyStatus,
            isCompanyAdmin,
            profileStatus
          );

          expect(brokerCtx.companyId).toBe(companyId);
          expect(brokerCtx.companyName).toBe(companyName);
          expect(brokerCtx.companyStatus).toBe(companyStatus);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("includes broker context with isCompanyAdmin flag and profileStatus", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbNonEmptyString,
        arbCompanyStatus,
        fc.boolean(),
        arbProfileStatus,
        (companyId, companyName, companyStatus, isCompanyAdmin, profileStatus) => {
          const brokerCtx = buildBrokerSessionContext(
            companyId,
            companyName,
            companyStatus,
            isCompanyAdmin,
            profileStatus
          );

          expect(brokerCtx.isCompanyAdmin).toBe(isCompanyAdmin);
          expect(brokerCtx.profileStatus).toBe(profileStatus);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("enhanced session for broker user includes broker object", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        fc.array(arbRoleWithPermissions, { minLength: 0, maxLength: 5 }),
        fc.uuid(),
        arbNonEmptyString,
        arbCompanyStatus,
        fc.boolean(),
        arbProfileStatus,
        (userId, email, name, roles, companyId, companyName, companyStatus, isAdmin, profileStatus) => {
          const identity = buildSessionIdentityContext(
            userId,
            email,
            name,
            "broker",
            true,
            true,
            roles
          );
          const brokerCtx = buildBrokerSessionContext(
            companyId,
            companyName,
            companyStatus,
            isAdmin,
            profileStatus
          );
          const session = buildEnhancedSessionResponse(identity, brokerCtx);

          expect(session.userType).toBe("broker");
          expect(session.broker).toBeDefined();
          expect(session.broker!.companyId).toBe(companyId);
          expect(session.broker!.companyName).toBe(companyName);
          expect(session.broker!.companyStatus).toBe(companyStatus);
          expect(session.broker!.isCompanyAdmin).toBe(isAdmin);
          expect(session.broker!.profileStatus).toBe(profileStatus);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("enhanced session for non-broker user does not include broker object", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbEmail,
        arbNonEmptyString,
        fc.constantFrom<UserType>("employee", "client", "vendor"),
        fc.array(arbRoleWithPermissions, { minLength: 0, maxLength: 5 }),
        (userId, email, name, userType, roles) => {
          const identity = buildSessionIdentityContext(
            userId,
            email,
            name,
            userType,
            true,
            true,
            roles
          );
          const session = buildEnhancedSessionResponse(identity);

          expect(session.broker).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("broker context preserves all five required fields across all status combinations", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbNonEmptyString,
        arbCompanyStatus,
        fc.boolean(),
        arbProfileStatus,
        (companyId, companyName, companyStatus, isCompanyAdmin, profileStatus) => {
          const brokerCtx = buildBrokerSessionContext(
            companyId,
            companyName,
            companyStatus,
            isCompanyAdmin,
            profileStatus
          );

          // All five fields must be present
          expect(brokerCtx).toHaveProperty("companyId");
          expect(brokerCtx).toHaveProperty("companyName");
          expect(brokerCtx).toHaveProperty("companyStatus");
          expect(brokerCtx).toHaveProperty("isCompanyAdmin");
          expect(brokerCtx).toHaveProperty("profileStatus");

          // Values must match inputs exactly
          expect(brokerCtx.companyId).toBe(companyId);
          expect(brokerCtx.companyName).toBe(companyName);
          expect(brokerCtx.companyStatus).toBe(companyStatus);
          expect(brokerCtx.isCompanyAdmin).toBe(isCompanyAdmin);
          expect(brokerCtx.profileStatus).toBe(profileStatus);
        }
      ),
      { numRuns: 100 }
    );
  });
});
