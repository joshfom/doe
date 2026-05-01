import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { IdentityResult } from "./identity";
import type { OtpVerificationState } from "./otp";

// ── Mock external dependencies before importing the module under test ────────

vi.mock("./email", () => ({
  sendOtpEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../tickets/service", () => ({
  createTicket: vi
    .fn()
    .mockResolvedValue({ ticketNumber: "TKT-MOCK-001", id: "mock-ticket-id" }),
}));

vi.mock("./handoff", () => ({
  initiateHandoff: vi.fn().mockResolvedValue(undefined),
}));

// Import the function under test after mocks are set up
import { handleOtpGate } from "./otp";

// ── Keyword lists (must match the implementation in otp.ts) ──────────────────

const SENSITIVE_KEYWORDS = [
  "payment dispute",
  "refund",
  "account change",
  "financial correction",
];

const PAYMENT_KEYWORDS = [
  "payment status",
  "make payment",
  "payment method",
  "installment",
];

const PERSONAL_KEYWORDS = [
  "my unit",
  "my account",
  "my status",
  "construction progress",
  "lease",
  "handover",
];

const ALL_KEYWORDS = [
  ...SENSITIVE_KEYWORDS,
  ...PAYMENT_KEYWORDS,
  ...PERSONAL_KEYWORDS,
];

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Safe filler text that does NOT contain any category keyword. */
const safeFillerArb = fc
  .array(fc.constantFrom(..."abcdefghijkmnopqrtuvwxyz0123456789 "), {
    minLength: 0,
    maxLength: 20,
  })
  .map((chars) => chars.join(""))
  .filter((s) => !ALL_KEYWORDS.some((kw) => s.toLowerCase().includes(kw)));

/** A message containing a personal keyword surrounded by safe filler. */
const personalMessageArb = fc
  .tuple(
    fc.constantFrom(...PERSONAL_KEYWORDS),
    safeFillerArb,
    safeFillerArb
  )
  .map(([kw, prefix, suffix]) => `${prefix} ${kw} ${suffix}`);

/** A message containing a payment keyword surrounded by safe filler. */
const paymentMessageArb = fc
  .tuple(
    fc.constantFrom(...PAYMENT_KEYWORDS),
    safeFillerArb,
    safeFillerArb
  )
  .map(([kw, prefix, suffix]) => `${prefix} ${kw} ${suffix}`);

/** A message containing a sensitive keyword surrounded by safe filler. */
const sensitiveMessageArb = fc
  .tuple(
    fc.constantFrom(...SENSITIVE_KEYWORDS),
    safeFillerArb,
    safeFillerArb
  )
  .map(([kw, prefix, suffix]) => `${prefix} ${kw} ${suffix}`);

/** A general message that contains no category keywords. */
const generalMessageArb = safeFillerArb.filter((s) => s.trim().length > 0);

/** Language arbitrary. */
const languageArb = fc.constantFrom<"en" | "ar">("en", "ar");

/** Non-verified OTP states (everything except "verified"). */
const nonVerifiedStateArb = fc.constantFrom<OtpVerificationState>(
  "not_required",
  "pending",
  "expired"
);

/** Any OTP verification state. */
const anyOtpStateArb = fc.constantFrom<OtpVerificationState>(
  "not_required",
  "pending",
  "verified",
  "expired"
);

/** Identity type for recognized users (client or tenant). */
const recognizedIdentityTypeArb = fc.constantFrom<"client" | "tenant">(
  "client",
  "tenant"
);

/** Build a recognized (client/tenant) IdentityResult. */
function buildRecognizedIdentity(
  type: "client" | "tenant"
): IdentityResult {
  if (type === "client") {
    return {
      type: "client",
      clientId: "test-client-id",
      firstName: "Ahmed",
      units: [],
    };
  }
  return {
    type: "tenant",
    tenantId: "test-tenant-id",
    firstName: "Sara",
    units: [],
  };
}

/** Build a visitor IdentityResult. */
function buildVisitorIdentity(): IdentityResult {
  return {
    type: "visitor",
    units: [],
  };
}

// ── Mock Database ────────────────────────────────────────────────────────────

/**
 * Creates a mock database object that handles the Drizzle ORM chained query
 * pattern. The mock supports:
 * - select().from().where().limit() → returns mock data
 * - update().set().where() → resolves
 * - insert().values().returning() → returns mock data
 *
 * For the OTP gate property tests, the key DB interaction is `lookupEmail`
 * which does: db.select({email}).from(aiClients/aiTenants).where(...).limit(1)
 */
function createMockDb() {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ email: "test@example.com" }]),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: "mock-otp-id",
        conversationId: "test-conv-id",
        otpHash: "mock-hash",
        email: "test@example.com",
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        createdAt: new Date(),
        verifiedAt: null,
      },
    ]),
    orderBy: vi.fn().mockReturnThis(),
  };

  // Make update and insert also return the chainable
  chainable.select.mockReturnValue(chainable);

  const db = {
    select: vi.fn(() => chainable),
    update: vi.fn(() => chainable),
    insert: vi.fn(() => chainable),
  };

  return db;
}

// ── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: ai-otp-verification, Property 1: OTP gate blocks non-verified personal and payment queries", () => {
  /**
   * **Validates: Requirements 1.1, 4.1**
   *
   * For any recognized identity (client or tenant), for any message classified
   * as a personal or payment query, and for any OTP verification state that is
   * not "verified" (i.e., "not_required", "pending", or "expired"), the OTP gate
   * SHALL return `action: "respond"` and SHALL NOT return `action: "proceed"`.
   */

  it("personal queries from recognized users with non-verified state → action: respond", () => {
    return fc.assert(
      fc.asyncProperty(
        recognizedIdentityTypeArb,
        personalMessageArb,
        nonVerifiedStateArb,
        languageArb,
        async (identityType, message, otpState, language) => {
          const db = createMockDb();
          const identity = buildRecognizedIdentity(identityType);

          const result = await handleOtpGate(
            db as any,
            "test-conv-id",
            message,
            identity,
            language,
            otpState
          );

          expect(result.action).toBe("respond");
          expect(result.action).not.toBe("proceed");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("payment queries from recognized users with non-verified state → action: respond", () => {
    return fc.assert(
      fc.asyncProperty(
        recognizedIdentityTypeArb,
        paymentMessageArb,
        nonVerifiedStateArb,
        languageArb,
        async (identityType, message, otpState, language) => {
          const db = createMockDb();
          const identity = buildRecognizedIdentity(identityType);

          const result = await handleOtpGate(
            db as any,
            "test-conv-id",
            message,
            identity,
            language,
            otpState
          );

          expect(result.action).toBe("respond");
          expect(result.action).not.toBe("proceed");
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ai-otp-verification, Property 2: General queries always pass through regardless of OTP state", () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any message classified as a general query, and for any OTP verification
   * state (including "not_required", "pending", "verified", "expired"), the OTP
   * gate SHALL return `action: "proceed"`.
   */

  it("general queries always proceed regardless of identity type and OTP state", () => {
    const anyIdentityArb = fc.constantFrom<"client" | "tenant" | "visitor">(
      "client",
      "tenant",
      "visitor"
    );

    return fc.assert(
      fc.asyncProperty(
        anyIdentityArb,
        generalMessageArb,
        anyOtpStateArb,
        languageArb,
        async (identityType, message, otpState, language) => {
          const db = createMockDb();
          const identity =
            identityType === "visitor"
              ? buildVisitorIdentity()
              : buildRecognizedIdentity(identityType);

          const result = await handleOtpGate(
            db as any,
            "test-conv-id",
            message,
            identity,
            language,
            otpState
          );

          expect(result.action).toBe("proceed");
          expect(result.queryCategory).toBe("general");
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ai-otp-verification, Property 3: Verified state allows personal queries", () => {
  /**
   * **Validates: Requirements 1.3, 8.1**
   *
   * For any recognized identity (client or tenant), for any message classified
   * as a personal query, when the OTP verification state is "verified", the OTP
   * gate SHALL return `action: "proceed"`.
   */

  it("personal queries from recognized users with verified state → action: proceed", () => {
    return fc.assert(
      fc.asyncProperty(
        recognizedIdentityTypeArb,
        personalMessageArb,
        languageArb,
        async (identityType, message, language) => {
          const db = createMockDb();
          const identity = buildRecognizedIdentity(identityType);

          const result = await handleOtpGate(
            db as any,
            "test-conv-id",
            message,
            identity,
            language,
            "verified"
          );

          expect(result.action).toBe("proceed");
          expect(result.queryCategory).toBe("personal");
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ai-otp-verification, Property 4: Visitor personal queries get identification prompt", () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any visitor identity (type = "visitor"), for any message classified as
   * a personal query, the OTP gate SHALL return `action: "respond"` with a
   * message that asks the user to provide their phone number or email,
   * regardless of OTP verification state.
   */

  it("visitor + personal query → respond with identification prompt", () => {
    return fc.assert(
      fc.asyncProperty(
        personalMessageArb,
        anyOtpStateArb,
        languageArb,
        async (message, otpState, language) => {
          const db = createMockDb();
          const identity = buildVisitorIdentity();

          const result = await handleOtpGate(
            db as any,
            "test-conv-id",
            message,
            identity,
            language,
            otpState
          );

          expect(result.action).toBe("respond");
          expect(result.response).toBeDefined();

          // The response should mention phone/email identification
          if (language === "en") {
            expect(result.response).toContain("phone number or email");
          } else {
            expect(result.response).toContain("هاتفك");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ai-otp-verification, Property 11: Sensitive queries never proceed to RAG", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any message classified as a sensitive query, regardless of identity type
   * or OTP verification state, the OTP gate SHALL NOT return `action: "proceed"`.
   * It SHALL always return `action: "respond"` with an escalation response.
   */

  it("sensitive queries never proceed, regardless of identity and OTP state", () => {
    const anyIdentityArb = fc.constantFrom<"client" | "tenant" | "visitor">(
      "client",
      "tenant",
      "visitor"
    );

    return fc.assert(
      fc.asyncProperty(
        anyIdentityArb,
        sensitiveMessageArb,
        anyOtpStateArb,
        languageArb,
        async (identityType, message, otpState, language) => {
          const db = createMockDb();
          const identity =
            identityType === "visitor"
              ? buildVisitorIdentity()
              : buildRecognizedIdentity(identityType);

          const result = await handleOtpGate(
            db as any,
            "test-conv-id",
            message,
            identity,
            language,
            otpState
          );

          expect(result.action).toBe("respond");
          expect(result.action).not.toBe("proceed");
          expect(result.queryCategory).toBe("sensitive");
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ── Import mocked modules for assertion ──────────────────────────────────────

import { sendOtpEmail } from "./email";
import { createTicket } from "../tickets/service";
import { escalateSensitiveQuery } from "./otp";

// ── Unit Tests ───────────────────────────────────────────────────────────────

describe("Unit Tests: OTP gate and escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: OTP email delivery failure returns error response (Req 2.5) ──

  describe("OTP email delivery failure (Req 2.5)", () => {
    it("returns error response and offers retry/human agent when email send fails", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      // Mock sendOtpEmail to return failure
      vi.mocked(sendOtpEmail).mockResolvedValueOnce({
        success: false,
        error: "SMTP delivery failed",
      });

      // Send a confirmation message ("yes") from a recognized identity
      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "yes",
        identity,
        "en",
        "not_required"
      );

      expect(result.action).toBe("respond");
      expect(result.response).toBeDefined();
      // Response should mention retry or human representative
      expect(
        result.response!.includes("try again") ||
          result.response!.includes("representative")
      ).toBe(true);
    });

    it("returns Arabic error response when language is ar", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      vi.mocked(sendOtpEmail).mockResolvedValueOnce({
        success: false,
        error: "SMTP delivery failed",
      });

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "نعم",
        identity,
        "ar",
        "not_required"
      );

      expect(result.action).toBe("respond");
      expect(result.response).toBeDefined();
      // Arabic response should mention retry or representative
      expect(
        result.response!.includes("مرة أخرى") ||
          result.response!.includes("ممثلينا")
      ).toBe(true);
    });
  });

  // ── Test 2: Payment query response includes safety warning (Req 4.2, 4.4) ──

  describe("Payment query safety warning (Req 4.2, 4.4)", () => {
    it("includes English safety warning for verified client payment query", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "What is my payment status?",
        identity,
        "en",
        "verified"
      );

      expect(result.action).toBe("respond");
      expect(result.queryCategory).toBe("payment");
      expect(result.response).toContain(
        "No payment should be sent to any personal account"
      );
    });

    it("includes Arabic safety warning for verified client payment query in Arabic", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "What is my payment status?",
        identity,
        "ar",
        "verified"
      );

      expect(result.action).toBe("respond");
      expect(result.queryCategory).toBe("payment");
      expect(result.response).toContain(
        "لا يجب إرسال أي دفعة إلى أي حساب شخصي"
      );
    });
  });

  // ── Test 3: Sensitive query creates ticket with correct priority (Req 5.4) ──

  describe("Sensitive query priority mapping (Req 5.4)", () => {
    it("creates ticket with high priority for payment dispute", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      await handleOtpGate(
        db as any,
        "test-conv-id",
        "I have a payment dispute with my last transaction",
        identity,
        "en",
        "not_required"
      );

      expect(createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ priority: "high" })
      );
    });

    it("creates ticket with high priority for refund request", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      await handleOtpGate(
        db as any,
        "test-conv-id",
        "I need a refund for my deposit",
        identity,
        "en",
        "not_required"
      );

      expect(createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ priority: "high" })
      );
    });

    it("creates ticket with medium priority for account change", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      await handleOtpGate(
        db as any,
        "test-conv-id",
        "I need an account change for my profile",
        identity,
        "en",
        "not_required"
      );

      expect(createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ priority: "medium" })
      );
    });

    it("creates ticket with medium priority for financial correction", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      await handleOtpGate(
        db as any,
        "test-conv-id",
        "I need a financial correction on my invoice",
        identity,
        "en",
        "not_required"
      );

      expect(createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ priority: "medium" })
      );
    });
  });

  // ── Test 4: 6-digit code during pending state triggers verification ──

  describe("6-digit code input during pending state", () => {
    it("triggers verification attempt when 6-digit code is sent in pending state", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      // Mock the DB to return a pending OTP record with a known hash
      // We need the select chain to return a pending OTP record
      // The attemptOtpVerification function does:
      //   db.select().from(otpRecords).where(...).limit(1)
      // Our mock's limit() returns the OTP record by default.
      // The hash for "123456" via SHA-256:
      const crypto = await import("crypto");
      const expectedHash = crypto
        .createHash("sha256")
        .update("123456")
        .digest("hex");

      // Override the limit mock to return a matching OTP record
      const chainable = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: "mock-otp-id",
            conversationId: "test-conv-id",
            otpHash: expectedHash,
            email: "test@example.com",
            status: "pending",
            attemptCount: 0,
            maxAttempts: 3,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            createdAt: new Date(),
            verifiedAt: null,
          },
        ]),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnThis(),
      };
      chainable.select.mockReturnValue(chainable);

      const mockDb = {
        select: vi.fn(() => chainable),
        update: vi.fn(() => chainable),
        insert: vi.fn(() => chainable),
      };

      const result = await handleOtpGate(
        mockDb as any,
        "test-conv-id",
        "123456",
        identity,
        "en",
        "pending"
      );

      expect(result.action).toBe("respond");
      // Successful verification response
      expect(result.response).toContain("verified");
    });
  });

  // ── Test 5: Non-6-digit input during pending state is regular message ──

  describe("Non-6-digit input during pending state", () => {
    it("treats 'hello' as a regular message classification, not a verification attempt", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "hello",
        identity,
        "en",
        "pending"
      );

      // "hello" has no keywords, so it's classified as general and proceeds
      expect(result.action).toBe("proceed");
      expect(result.queryCategory).toBe("general");
    });

    it("treats '12345' (5 digits) as a regular message, not a verification attempt", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "12345",
        identity,
        "en",
        "pending"
      );

      // 5 digits is not a 6-digit code, so it's treated as general
      expect(result.action).toBe("proceed");
      expect(result.queryCategory).toBe("general");
    });

    it("treats '1234567' (7 digits) as a regular message, not a verification attempt", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "1234567",
        identity,
        "en",
        "pending"
      );

      expect(result.action).toBe("proceed");
      expect(result.queryCategory).toBe("general");
    });
  });

  // ── Test 6: User confirmation triggers OTP generation and email send ──

  describe("User confirmation triggers OTP generation and email send", () => {
    it("sends OTP email when user confirms with 'yes'", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      vi.mocked(sendOtpEmail).mockResolvedValueOnce({ success: true });

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "yes",
        identity,
        "en",
        "not_required"
      );

      expect(result.action).toBe("respond");
      expect(sendOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: "test@example.com",
          recipientName: "Ahmed",
          language: "en",
        })
      );
      // The OTP code should be a 6-digit string
      const callArgs = vi.mocked(sendOtpEmail).mock.calls[0][0];
      expect(callArgs.otpCode).toMatch(/^\d{6}$/);
      // Response should mention the masked email (t**t@example.com)
      expect(result.response).toContain("t**t@example.com");
    });

    it("sends OTP email when user confirms with 'send'", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("tenant");

      vi.mocked(sendOtpEmail).mockResolvedValueOnce({ success: true });

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "send",
        identity,
        "en",
        "not_required"
      );

      expect(result.action).toBe("respond");
      expect(sendOtpEmail).toHaveBeenCalled();
      // Response should mention the masked email
      expect(result.response).toContain("t**t@example.com");
    });

    it("sends OTP email when user confirms with Arabic 'نعم'", async () => {
      const db = createMockDb();
      const identity = buildRecognizedIdentity("client");

      vi.mocked(sendOtpEmail).mockResolvedValueOnce({ success: true });

      const result = await handleOtpGate(
        db as any,
        "test-conv-id",
        "نعم",
        identity,
        "ar",
        "not_required"
      );

      expect(result.action).toBe("respond");
      expect(sendOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          language: "ar",
        })
      );
      // Arabic response should mention the masked email
      expect(result.response).toContain("t**t@example.com");
    });
  });
});
