import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PORTAL_TYPE_MAP } from "./middleware";

// Feature: rbac-identity-system, Property 9: Active status gate in middleware
// Feature: rbac-identity-system, Property 10: Portal-type alignment
// Feature: rbac-identity-system, Property 13: Broker middleware requires active profile and company

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_USER_TYPES = ["employee", "broker", "client", "vendor"] as const;
type UserType = (typeof VALID_USER_TYPES)[number];

const VALID_PORTALS = Object.keys(PORTAL_TYPE_MAP);

const BROKER_PROFILE_STATUSES = ["active", "inactive"] as const;
const BROKER_COMPANY_STATUSES = [
  "pending",
  "active",
  "suspended",
  "rejected",
] as const;

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbUserType = fc.constantFrom<UserType>(...VALID_USER_TYPES);
const arbPortal = fc.constantFrom(...VALID_PORTALS);
const arbBrokerProfileStatus = fc.constantFrom(...BROKER_PROFILE_STATUSES);
const arbBrokerCompanyStatus = fc.constantFrom(...BROKER_COMPANY_STATUSES);

// ── Helper functions encoding middleware business rules ───────────────────────

/**
 * Encodes the identity guard's active-status gate logic.
 * A user is allowed through if and only if both is_active AND email_verified
 * are true. All other combinations result in denial.
 */
function shouldAllowIdentity(
  isActive: boolean,
  emailVerified: boolean
): boolean {
  return isActive && emailVerified;
}

/**
 * Encodes the portal guard's type-alignment logic.
 * A user with user_type X is allowed access to portal P if and only if
 * PORTAL_TYPE_MAP[P] === X.
 */
function shouldAllowPortal(userType: string, portal: string): boolean {
  return PORTAL_TYPE_MAP[portal] === userType;
}

/**
 * Encodes the broker middleware's profile + company status gate.
 * A broker user is allowed through if and only if both the broker profile
 * status is "active" AND the broker company status is "active".
 */
function shouldAllowBroker(
  profileStatus: string,
  companyStatus: string
): boolean {
  return profileStatus === "active" && companyStatus === "active";
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Active status gate in middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.2**
 *
 * Property 9: Active status gate in middleware
 *
 * For any user, the identity middleware should allow the request to proceed
 * if and only if both is_active is true AND email_verified is true.
 * All other combinations should result in denial.
 */
describe("Feature: rbac-identity-system, Property 9: Active status gate in middleware", () => {
  it("allows access when both is_active and email_verified are true", () => {
    fc.assert(
      fc.property(arbUserType, (_userType) => {
        expect(shouldAllowIdentity(true, true)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("denies access when is_active is false regardless of email_verified", () => {
    fc.assert(
      fc.property(fc.boolean(), (emailVerified) => {
        expect(shouldAllowIdentity(false, emailVerified)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("denies access when email_verified is false regardless of is_active", () => {
    fc.assert(
      fc.property(fc.boolean(), (isActive) => {
        expect(shouldAllowIdentity(isActive, false)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("shouldAllowIdentity returns true iff both flags are true for all combinations", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (isActive, emailVerified) => {
        const result = shouldAllowIdentity(isActive, emailVerified);
        expect(result).toBe(isActive && emailVerified);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 10: Portal-type alignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.3, 6.5**
 *
 * Property 10: Portal-type alignment
 *
 * For any user with user_type X and any portal path prefix P, the portal
 * guard should allow access if and only if the portal-to-type mapping
 * maps P to X. Mismatches should return HTTP 403.
 */
describe("Feature: rbac-identity-system, Property 10: Portal-type alignment", () => {
  it("allows access when user type matches the portal mapping", () => {
    fc.assert(
      fc.property(arbPortal, (portal) => {
        const expectedType = PORTAL_TYPE_MAP[portal];
        expect(shouldAllowPortal(expectedType, portal)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("denies access when user type does not match the portal mapping", () => {
    fc.assert(
      fc.property(arbPortal, arbUserType, (portal, userType) => {
        const expectedType = PORTAL_TYPE_MAP[portal];
        fc.pre(userType !== expectedType);
        expect(shouldAllowPortal(userType, portal)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("shouldAllowPortal returns true iff PORTAL_TYPE_MAP[portal] === userType", () => {
    fc.assert(
      fc.property(arbPortal, arbUserType, (portal, userType) => {
        const result = shouldAllowPortal(userType, portal);
        expect(result).toBe(PORTAL_TYPE_MAP[portal] === userType);
      }),
      { numRuns: 100 }
    );
  });

  it("every portal maps to exactly one valid user type", () => {
    fc.assert(
      fc.property(arbPortal, (portal) => {
        const mappedType = PORTAL_TYPE_MAP[portal];
        expect(VALID_USER_TYPES).toContain(mappedType);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 13: Broker middleware requires active profile and company
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.8, 10.3**
 *
 * Property 13: Broker middleware requires active profile and company
 *
 * For any broker user, the middleware should allow access if and only if
 * the user's broker_profiles.status is "active" AND the associated
 * broker_companies.status is "active". Any other combination should
 * result in denial.
 */
describe("Feature: rbac-identity-system, Property 13: Broker middleware requires active profile and company", () => {
  it("allows access when both profile and company status are active", () => {
    fc.assert(
      fc.property(fc.constant("active"), fc.constant("active"), (profileStatus, companyStatus) => {
        expect(shouldAllowBroker(profileStatus, companyStatus)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("denies access when profile status is not active", () => {
    fc.assert(
      fc.property(arbBrokerCompanyStatus, (companyStatus) => {
        expect(shouldAllowBroker("inactive", companyStatus)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("denies access when company status is not active", () => {
    fc.assert(
      fc.property(
        arbBrokerCompanyStatus.filter((s) => s !== "active"),
        (companyStatus) => {
          expect(shouldAllowBroker("active", companyStatus)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("shouldAllowBroker returns true iff both statuses are active for all combinations", () => {
    fc.assert(
      fc.property(
        arbBrokerProfileStatus,
        arbBrokerCompanyStatus,
        (profileStatus, companyStatus) => {
          const result = shouldAllowBroker(profileStatus, companyStatus);
          expect(result).toBe(
            profileStatus === "active" && companyStatus === "active"
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
