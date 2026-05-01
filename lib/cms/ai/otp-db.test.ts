import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOtpRecord,
  getActiveOtp,
  attemptOtpVerification,
  invalidateConversationOtps,
  hashOtp,
} from "./otp";

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build a mock Drizzle `db` object that supports the chained query-builder
 * patterns used by the OTP database operations:
 *
 *   db.insert(table).values({…}).returning()
 *   db.update(table).set({…}).where(…)
 *   db.select().from(table).where(…).limit(n)
 */
function createMockDb() {
  const limitFn = vi.fn();
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  const returningFn = vi.fn();
  const insertValuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const insertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

  const updateWhereFn = vi.fn();
  const updateSetFn = vi.fn().mockReturnValue({ where: updateWhereFn });
  const updateFn = vi.fn().mockReturnValue({ set: updateSetFn });

  return {
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    // Expose inner mocks for assertions
    _select: { from: fromFn, where: whereFn, limit: limitFn },
    _insert: { values: insertValuesFn, returning: returningFn },
    _update: { set: updateSetFn, where: updateWhereFn },
  };
}

type MockDb = ReturnType<typeof createMockDb>;

// ── Test constants ───────────────────────────────────────────────────────────

const CONVERSATION_ID = "conv-001";
const EMAIL = "ahmed@example.com";
const OTP_CODE = "123456";
const OTP_HASH = hashOtp(OTP_CODE);
const EXPIRES_AT = new Date(Date.now() + 5 * 60 * 1000);

function makePendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "otp-001",
    conversationId: CONVERSATION_ID,
    otpHash: OTP_HASH,
    email: EMAIL,
    status: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    expiresAt: EXPIRES_AT,
    createdAt: new Date(),
    verifiedAt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("OTP Database Operations", () => {
  let mockDb: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
  });

  // ── createOtpRecord ──────────────────────────────────────────────────────

  describe("createOtpRecord", () => {
    it("stores all required fields in the OTP record", async () => {
      const newRecord = makePendingRecord();

      // invalidateConversationOtps: update().set().where() — no pending found
      mockDb._update.where.mockResolvedValueOnce(undefined);
      // insert().values().returning() — returns the new record
      mockDb._insert.returning.mockResolvedValueOnce([newRecord]);
      // update conversation state: update().set().where()
      mockDb._update.where.mockResolvedValueOnce(undefined);

      const result = await createOtpRecord(
        mockDb as any,
        CONVERSATION_ID,
        EMAIL,
        OTP_HASH,
        EXPIRES_AT
      );

      expect(result).toEqual(newRecord);

      // Verify insert was called with correct values
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb._insert.values).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        otpHash: OTP_HASH,
        email: EMAIL,
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        expiresAt: EXPIRES_AT,
      });
    });

    it("invalidates previous pending OTPs before creating a new one (Property 7)", async () => {
      const newRecord = makePendingRecord({ id: "otp-002" });

      // invalidateConversationOtps calls update().set().where()
      mockDb._update.where.mockResolvedValueOnce(undefined);
      // insert new record
      mockDb._insert.returning.mockResolvedValueOnce([newRecord]);
      // update conversation state
      mockDb._update.where.mockResolvedValueOnce(undefined);

      await createOtpRecord(
        mockDb as any,
        CONVERSATION_ID,
        EMAIL,
        OTP_HASH,
        EXPIRES_AT
      );

      // The first update call should be the invalidation (setting status to "invalidated")
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "invalidated" })
      );
    });

    it("updates conversation otpVerificationState to 'pending'", async () => {
      const newRecord = makePendingRecord();

      mockDb._update.where.mockResolvedValueOnce(undefined);
      mockDb._insert.returning.mockResolvedValueOnce([newRecord]);
      mockDb._update.where.mockResolvedValueOnce(undefined);

      await createOtpRecord(
        mockDb as any,
        CONVERSATION_ID,
        EMAIL,
        OTP_HASH,
        EXPIRES_AT
      );

      // The second update().set() call should set conversation state to "pending"
      const setCalls = mockDb._update.set.mock.calls;
      // setCalls[0] = invalidation { status: "invalidated" }
      // setCalls[1] = conversation state { otpVerificationState: "pending", updatedAt: ... }
      expect(setCalls.length).toBeGreaterThanOrEqual(2);
      expect(setCalls[1][0]).toEqual(
        expect.objectContaining({ otpVerificationState: "pending" })
      );
    });
  });

  // ── getActiveOtp ─────────────────────────────────────────────────────────

  describe("getActiveOtp", () => {
    it("returns the pending OTP record when one exists and is not expired", async () => {
      const record = makePendingRecord();
      mockDb._select.limit.mockResolvedValueOnce([record]);

      const result = await getActiveOtp(mockDb as any, CONVERSATION_ID);

      expect(result).toEqual(record);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("returns null when no pending OTP exists", async () => {
      mockDb._select.limit.mockResolvedValueOnce([]);

      const result = await getActiveOtp(mockDb as any, CONVERSATION_ID);

      expect(result).toBeNull();
    });

    it("returns null when the only pending OTP has expired", async () => {
      const expiredRecord = makePendingRecord({
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      });
      mockDb._select.limit.mockResolvedValueOnce([expiredRecord]);

      const result = await getActiveOtp(mockDb as any, CONVERSATION_ID);

      expect(result).toBeNull();
    });
  });

  // ── attemptOtpVerification ───────────────────────────────────────────────

  describe("attemptOtpVerification", () => {
    it("returns 'verified' and updates OTP status to 'used' on correct code", async () => {
      const record = makePendingRecord();
      // select pending OTP
      mockDb._select.limit.mockResolvedValueOnce([record]);
      // update OTP to "used"
      mockDb._update.where.mockResolvedValueOnce(undefined);
      // update conversation to "verified"
      mockDb._update.where.mockResolvedValueOnce(undefined);

      const result = await attemptOtpVerification(
        mockDb as any,
        CONVERSATION_ID,
        OTP_CODE
      );

      expect(result).toEqual({ status: "verified" });

      // First update: OTP record → "used"
      expect(mockDb._update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "used" })
      );
    });

    it("updates conversation state to 'verified' on successful verification", async () => {
      const record = makePendingRecord();
      mockDb._select.limit.mockResolvedValueOnce([record]);
      mockDb._update.where.mockResolvedValueOnce(undefined);
      mockDb._update.where.mockResolvedValueOnce(undefined);

      await attemptOtpVerification(mockDb as any, CONVERSATION_ID, OTP_CODE);

      // Second set() call should update conversation state
      const setCalls = mockDb._update.set.mock.calls;
      expect(setCalls[1][0]).toEqual(
        expect.objectContaining({ otpVerificationState: "verified" })
      );
    });

    it("returns 'invalid_code' with remaining attempts on incorrect code (Property 9)", async () => {
      const record = makePendingRecord({ attemptCount: 0, maxAttempts: 3 });
      // select pending OTP
      mockDb._select.limit.mockResolvedValueOnce([record]);
      // update attempt count
      mockDb._update.where.mockResolvedValueOnce(undefined);

      const result = await attemptOtpVerification(
        mockDb as any,
        CONVERSATION_ID,
        "999999" // wrong code
      );

      expect(result).toEqual({ status: "invalid_code", remainingAttempts: 2 });

      // Should increment attempt count
      expect(mockDb._update.set).toHaveBeenCalledWith(
        expect.objectContaining({ attemptCount: 1 })
      );
    });

    it("decrements remaining attempts correctly on second failed attempt", async () => {
      const record = makePendingRecord({ attemptCount: 1, maxAttempts: 3 });
      mockDb._select.limit.mockResolvedValueOnce([record]);
      mockDb._update.where.mockResolvedValueOnce(undefined);

      const result = await attemptOtpVerification(
        mockDb as any,
        CONVERSATION_ID,
        "999999"
      );

      expect(result).toEqual({ status: "invalid_code", remainingAttempts: 1 });
      expect(mockDb._update.set).toHaveBeenCalledWith(
        expect.objectContaining({ attemptCount: 2 })
      );
    });

    it("returns 'max_attempts_reached' and locks OTP after 3 failed attempts", async () => {
      const record = makePendingRecord({ attemptCount: 2, maxAttempts: 3 });
      // select pending OTP
      mockDb._select.limit.mockResolvedValueOnce([record]);
      // update OTP to "expired"
      mockDb._update.where.mockResolvedValueOnce(undefined);
      // update conversation to "expired"
      mockDb._update.where.mockResolvedValueOnce(undefined);

      const result = await attemptOtpVerification(
        mockDb as any,
        CONVERSATION_ID,
        "999999"
      );

      expect(result).toEqual({ status: "max_attempts_reached" });

      // OTP should be set to "expired" with attemptCount 3
      expect(mockDb._update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "expired", attemptCount: 3 })
      );
    });

    it("sets conversation state to 'expired' when max attempts reached", async () => {
      const record = makePendingRecord({ attemptCount: 2, maxAttempts: 3 });
      mockDb._select.limit.mockResolvedValueOnce([record]);
      mockDb._update.where.mockResolvedValueOnce(undefined);
      mockDb._update.where.mockResolvedValueOnce(undefined);

      await attemptOtpVerification(mockDb as any, CONVERSATION_ID, "999999");

      const setCalls = mockDb._update.set.mock.calls;
      expect(setCalls[1][0]).toEqual(
        expect.objectContaining({ otpVerificationState: "expired" })
      );
    });

    it("returns 'expired' when OTP has expired even with correct code (Property 10)", async () => {
      const expiredRecord = makePendingRecord({
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      });
      // select pending OTP (DB still returns it as "pending" status)
      mockDb._select.limit.mockResolvedValueOnce([expiredRecord]);
      // update OTP to "expired"
      mockDb._update.where.mockResolvedValueOnce(undefined);
      // update conversation to "expired"
      mockDb._update.where.mockResolvedValueOnce(undefined);

      const result = await attemptOtpVerification(
        mockDb as any,
        CONVERSATION_ID,
        OTP_CODE // correct code, but OTP is expired
      );

      expect(result).toEqual({ status: "expired" });

      // Should mark OTP as expired in DB
      expect(mockDb._update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "expired" })
      );
    });

    it("sets conversation state to 'expired' when OTP has time-expired", async () => {
      const expiredRecord = makePendingRecord({
        expiresAt: new Date(Date.now() - 1000),
      });
      mockDb._select.limit.mockResolvedValueOnce([expiredRecord]);
      mockDb._update.where.mockResolvedValueOnce(undefined);
      mockDb._update.where.mockResolvedValueOnce(undefined);

      await attemptOtpVerification(mockDb as any, CONVERSATION_ID, OTP_CODE);

      const setCalls = mockDb._update.set.mock.calls;
      expect(setCalls[1][0]).toEqual(
        expect.objectContaining({ otpVerificationState: "expired" })
      );
    });

    it("returns 'no_active_otp' when no pending OTP exists", async () => {
      mockDb._select.limit.mockResolvedValueOnce([]);

      const result = await attemptOtpVerification(
        mockDb as any,
        CONVERSATION_ID,
        OTP_CODE
      );

      expect(result).toEqual({ status: "no_active_otp" });

      // Should not call any update
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ── invalidateConversationOtps ───────────────────────────────────────────

  describe("invalidateConversationOtps", () => {
    it("sets all pending OTPs to 'invalidated'", async () => {
      mockDb._update.where.mockResolvedValueOnce(undefined);

      await invalidateConversationOtps(mockDb as any, CONVERSATION_ID);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._update.set).toHaveBeenCalledWith({ status: "invalidated" });
      expect(mockDb._update.where).toHaveBeenCalled();
    });
  });
});
