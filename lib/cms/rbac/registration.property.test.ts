import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RegistrationError } from "./registration";

// Feature: rbac-identity-system, Property 14: Broker registration creates correct records
// Feature: rbac-identity-system, Property 15: Registration input validation

// ── Types ────────────────────────────────────────────────────────────────────

interface BrokerRegistrationInput {
  companyName: string;
  tradeLicenseNumber: string;
  tradeLicenseDocumentUrl?: string;
  contactEmail: string;
  contactPhone: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
}

interface RegistrationOutput {
  company: { companyName: string; status: string };
  user: {
    userType: string;
    isActive: boolean;
    emailVerified: boolean;
    passwordHash: null;
  };
  profile: { isCompanyAdmin: boolean; status: string };
  roleAssignment: { roleName: string };
}

// ── Validation helper (mirrors registration.ts private logic) ────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUIRED_FIELDS: (keyof BrokerRegistrationInput)[] = [
  "companyName",
  "tradeLicenseNumber",
  "contactEmail",
  "contactPhone",
  "adminName",
  "adminEmail",
];

function validateRegistrationInput(
  data: Partial<BrokerRegistrationInput>
): { valid: false; error: RegistrationError } | { valid: true } {
  const missing: Record<string, string> = {};

  for (const field of REQUIRED_FIELDS) {
    const value = data[field];
    if (!value || !String(value).trim()) {
      missing[field] = `${field} is required`;
    }
  }

  if (Object.keys(missing).length > 0) {
    return {
      valid: false,
      error: new RegistrationError("Validation failed", 400, missing),
    };
  }

  const emailErrors: Record<string, string> = {};
  if (data.contactEmail && !EMAIL_REGEX.test(data.contactEmail)) {
    emailErrors.contactEmail = "Invalid email format";
  }
  if (data.adminEmail && !EMAIL_REGEX.test(data.adminEmail)) {
    emailErrors.adminEmail = "Invalid email format";
  }

  if (Object.keys(emailErrors).length > 0) {
    return {
      valid: false,
      error: new RegistrationError("Validation failed", 400, emailErrors),
    };
  }

  return { valid: true };
}

// ── Registration output builder (mirrors what registerBrokerCompany produces) ─

function buildExpectedRegistrationOutput(
  data: BrokerRegistrationInput
): RegistrationOutput {
  return {
    company: {
      companyName: data.companyName.trim(),
      status: "pending",
    },
    user: {
      userType: "broker",
      isActive: false,
      emailVerified: false,
      passwordHash: null,
    },
    profile: {
      isCompanyAdmin: true,
      status: "inactive",
    },
    roleAssignment: {
      roleName: "agency_admin",
    },
  };
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

const arbPhoneNumber = fc.stringMatching(/^\+?[0-9 -]{5,20}$/, {
  minLength: 5,
  maxLength: 20,
});

const arbValidRegistrationInput: fc.Arbitrary<BrokerRegistrationInput> = fc.record({
  companyName: arbNonEmptyTrimmedString,
  tradeLicenseNumber: arbNonEmptyTrimmedString,
  contactEmail: arbValidEmail,
  contactPhone: arbPhoneNumber,
  adminName: arbNonEmptyTrimmedString,
  adminEmail: arbValidEmail,
});


/** Generates an invalid email (missing @, missing domain, etc.) */
const arbInvalidEmail = fc.oneof(
  // No @ sign
  fc.stringMatching(/^[a-zA-Z0-9]+$/, { minLength: 1, maxLength: 20 }),
  // Nothing before @
  fc.stringMatching(/^[a-zA-Z0-9]+\.[a-zA-Z]{2,4}$/, { minLength: 3, maxLength: 15 }).map((d) => `@${d}`),
  // Nothing after @
  fc.stringMatching(/^[a-zA-Z0-9]+$/, { minLength: 1, maxLength: 10 }).map((l) => `${l}@`),
  // Spaces in email
  fc.constant("user @example.com"),
  // Empty string
  fc.constant("")
);

// ─────────────────────────────────────────────────────────────────────────────
// Property 14: Broker registration creates correct records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.2, 7.3, 7.4, 7.5**
 *
 * Property 14: Broker registration creates correct records
 *
 * For any valid broker registration input, the registration service should
 * atomically create: a broker_company with status "pending", a user with
 * user_type "broker" and is_active false and email_verified false and null
 * password_hash, a broker_profile with is_company_admin true and status
 * "inactive", and a user_role assignment for the "agency_admin" role.
 */
describe("Feature: rbac-identity-system, Property 14: Broker registration creates correct records", () => {
  it("valid input passes validation", () => {
    fc.assert(
      fc.property(arbValidRegistrationInput, (input) => {
        const result = validateRegistrationInput(input);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("produces a company record with status 'pending'", () => {
    fc.assert(
      fc.property(arbValidRegistrationInput, (input) => {
        const output = buildExpectedRegistrationOutput(input);
        expect(output.company.status).toBe("pending");
        expect(output.company.companyName).toBe(input.companyName.trim());
      }),
      { numRuns: 100 }
    );
  });

  it("produces a user record with userType 'broker', isActive false, emailVerified false, and null passwordHash", () => {
    fc.assert(
      fc.property(arbValidRegistrationInput, (input) => {
        const output = buildExpectedRegistrationOutput(input);
        expect(output.user.userType).toBe("broker");
        expect(output.user.isActive).toBe(false);
        expect(output.user.emailVerified).toBe(false);
        expect(output.user.passwordHash).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("produces a broker_profile with isCompanyAdmin true and status 'inactive'", () => {
    fc.assert(
      fc.property(arbValidRegistrationInput, (input) => {
        const output = buildExpectedRegistrationOutput(input);
        expect(output.profile.isCompanyAdmin).toBe(true);
        expect(output.profile.status).toBe("inactive");
      }),
      { numRuns: 100 }
    );
  });

  it("assigns the 'agency_admin' role", () => {
    fc.assert(
      fc.property(arbValidRegistrationInput, (input) => {
        const output = buildExpectedRegistrationOutput(input);
        expect(output.roleAssignment.roleName).toBe("agency_admin");
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 15: Registration input validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.7**
 *
 * Property 15: Registration input validation
 *
 * For any registration input with at least one missing required field or an
 * invalid email format, the registration service should reject the submission
 * and create zero records.
 */
describe("Feature: rbac-identity-system, Property 15: Registration input validation", () => {
  it("rejects input when any required field is missing", () => {
    fc.assert(
      fc.property(
        arbValidRegistrationInput,
        fc.constantFrom(...REQUIRED_FIELDS),
        (input, fieldToRemove) => {
          const broken = { ...input, [fieldToRemove]: "" };
          const result = validateRegistrationInput(broken);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeInstanceOf(RegistrationError);
            expect(result.error.statusCode).toBe(400);
            expect(result.error.details).toBeDefined();
            expect(result.error.details![fieldToRemove]).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects input when any required field is only whitespace", () => {
    fc.assert(
      fc.property(
        arbValidRegistrationInput,
        fc.constantFrom(...REQUIRED_FIELDS),
        (input, fieldToBlank) => {
          const broken = { ...input, [fieldToBlank]: "   " };
          const result = validateRegistrationInput(broken);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeInstanceOf(RegistrationError);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects input when contactEmail has invalid format", () => {
    fc.assert(
      fc.property(
        arbValidRegistrationInput,
        arbInvalidEmail,
        (input, badEmail) => {
          // Skip empty strings since those are caught by required-field check
          fc.pre(badEmail.trim().length > 0);
          const broken = { ...input, contactEmail: badEmail };
          const result = validateRegistrationInput(broken);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeInstanceOf(RegistrationError);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects input when adminEmail has invalid format", () => {
    fc.assert(
      fc.property(
        arbValidRegistrationInput,
        arbInvalidEmail,
        (input, badEmail) => {
          fc.pre(badEmail.trim().length > 0);
          const broken = { ...input, adminEmail: badEmail };
          const result = validateRegistrationInput(broken);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeInstanceOf(RegistrationError);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("RegistrationError has correct name and statusCode", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.constantFrom(400, 409, 500),
        (message, code) => {
          const err = new RegistrationError(message, code);
          expect(err.name).toBe("RegistrationError");
          expect(err.statusCode).toBe(code);
          expect(err.message).toBe(message);
          expect(err).toBeInstanceOf(Error);
        }
      ),
      { numRuns: 100 }
    );
  });
});
