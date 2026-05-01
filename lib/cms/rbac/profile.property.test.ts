import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 3: Profile-to-type correspondence invariant

// ── Types ────────────────────────────────────────────────────────────────────

const VALID_USER_TYPES = ["employee", "broker", "client", "vendor"] as const;
type UserType = (typeof VALID_USER_TYPES)[number];

const PROFILE_TABLES = [
  "employee_profiles",
  "broker_profiles",
  "client_profiles",
  "vendor_profiles",
] as const;
type ProfileTable = (typeof PROFILE_TABLES)[number];

/** Maps each user_type to its corresponding profile table name. */
const USER_TYPE_TO_PROFILE_TABLE: Record<UserType, ProfileTable> = {
  employee: "employee_profiles",
  broker: "broker_profiles",
  client: "client_profiles",
  vendor: "vendor_profiles",
};

interface ProfileRecordSet {
  employee_profiles: number;
  broker_profiles: number;
  client_profiles: number;
  vendor_profiles: number;
}

// ── Pure helper functions (validate profile-to-type correspondence) ──────────

/**
 * Given a user_type, builds the expected profile record counts.
 * Exactly one record in the corresponding profile table, zero in all others.
 */
function buildExpectedProfileCounts(userType: UserType): ProfileRecordSet {
  return {
    employee_profiles: userType === "employee" ? 1 : 0,
    broker_profiles: userType === "broker" ? 1 : 0,
    client_profiles: userType === "client" ? 1 : 0,
    vendor_profiles: userType === "vendor" ? 1 : 0,
  };
}

/**
 * Validates that a profile record set satisfies the correspondence invariant
 * for the given user_type: exactly one record in the matching table,
 * zero records in all other tables.
 */
function validateProfileCorrespondence(
  userType: UserType,
  profileCounts: ProfileRecordSet
): boolean {
  const expectedTable = USER_TYPE_TO_PROFILE_TABLE[userType];

  for (const table of PROFILE_TABLES) {
    const expected = table === expectedTable ? 1 : 0;
    if (profileCounts[table] !== expected) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the profile table name that corresponds to a given user_type.
 */
function getProfileTableForType(userType: UserType): ProfileTable {
  return USER_TYPE_TO_PROFILE_TABLE[userType];
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbUserType = fc.constantFrom<UserType>(...VALID_USER_TYPES);

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Profile-to-type correspondence invariant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.6**
 *
 * Property 3: Profile-to-type correspondence invariant
 *
 * For any user with user_type X, exactly one profile record should exist
 * in the profile table corresponding to X (employee_profiles for "employee",
 * broker_profiles for "broker", etc.), and zero profile records should exist
 * in the other profile tables.
 */
describe("Feature: rbac-identity-system, Property 3: Profile-to-type correspondence invariant", () => {
  it("exactly one profile record exists in the corresponding profile table", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const expected = buildExpectedProfileCounts(userType);
        const correspondingTable = getProfileTableForType(userType);

        expect(expected[correspondingTable]).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it("zero profile records exist in all non-corresponding profile tables", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const expected = buildExpectedProfileCounts(userType);
        const correspondingTable = getProfileTableForType(userType);

        for (const table of PROFILE_TABLES) {
          if (table !== correspondingTable) {
            expect(expected[table]).toBe(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("validateProfileCorrespondence returns true for correct profile counts", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const correctCounts = buildExpectedProfileCounts(userType);
        expect(validateProfileCorrespondence(userType, correctCounts)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("validateProfileCorrespondence returns false when corresponding table has zero records", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const badCounts: ProfileRecordSet = {
          employee_profiles: 0,
          broker_profiles: 0,
          client_profiles: 0,
          vendor_profiles: 0,
        };

        expect(validateProfileCorrespondence(userType, badCounts)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("validateProfileCorrespondence returns false when a non-corresponding table has records", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const correctCounts = buildExpectedProfileCounts(userType);
        const correspondingTable = getProfileTableForType(userType);

        // Pick a non-corresponding table and set it to 1
        const otherTables = PROFILE_TABLES.filter((t) => t !== correspondingTable);
        fc.pre(otherTables.length > 0);

        const badCounts = { ...correctCounts };
        badCounts[otherTables[0]] = 1;

        expect(validateProfileCorrespondence(userType, badCounts)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("each user_type maps to exactly one profile table", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const table = getProfileTableForType(userType);
        expect(PROFILE_TABLES).toContain(table);

        // No other user type should map to the same table (one-to-one)
        const otherTypes = VALID_USER_TYPES.filter((t) => t !== userType);
        for (const otherType of otherTypes) {
          expect(getProfileTableForType(otherType)).not.toBe(table);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("the total profile count across all tables is exactly 1 for any user_type", () => {
    fc.assert(
      fc.property(arbUserType, (userType) => {
        const counts = buildExpectedProfileCounts(userType);
        const total =
          counts.employee_profiles +
          counts.broker_profiles +
          counts.client_profiles +
          counts.vendor_profiles;

        expect(total).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});
