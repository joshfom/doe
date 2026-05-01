import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import type { Database } from "../db";
import { otpRecords, aiConversations, aiClients, aiTenants } from "../schema";
import type { IdentityResult } from "./identity";
import { sendOtpEmail } from "./email";
import { createTicket } from "../tickets/service";
import { initiateHandoff } from "./handoff";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OtpGenerateResult {
  /** Plain 6-digit code (for email delivery, never stored) */
  code: string;
  /** SHA-256 hash of the code (stored in DB) */
  hash: string;
  /** Expiry timestamp — 5 minutes from generation */
  expiresAt: Date;
}

export type QueryCategory = "general" | "personal" | "payment" | "sensitive";

export type OtpVerificationResult =
  | { status: "verified" }
  | { status: "invalid_code"; remainingAttempts: number }
  | { status: "expired" }
  | { status: "max_attempts_reached" }
  | { status: "no_active_otp" };

export interface OtpGateResult {
  action: "proceed" | "respond";
  response?: string;
  queryCategory: QueryCategory;
  /**
   * Set when verification just succeeded and the orchestrator should replay
   * a previously-buffered personal/payment question through RAG instead of
   * making the user retype it.
   */
  pendingQuery?: string;
}

export type OtpVerificationState =
  | "not_required"
  | "pending"
  | "verified"
  | "expired";

// ── OTP Generation ───────────────────────────────────────────────────────────

const OTP_EXPIRY_MINUTES = 5;

/**
 * Generate a cryptographically random 6-digit OTP.
 *
 * Uses `crypto.randomInt` for uniform distribution across [0, 999999].
 * The code is zero-padded to always be exactly 6 characters.
 * Returns the plain code (for email), its SHA-256 hash (for storage),
 * and an expiry timestamp set 5 minutes in the future.
 */
export function generateOtp(): OtpGenerateResult {
  const raw = crypto.randomInt(0, 1_000_000);
  const code = String(raw).padStart(6, "0");
  const hash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  return { code, hash, expiresAt };
}

// ── OTP Hashing ──────────────────────────────────────────────────────────────

/**
 * Hash a plain OTP code using SHA-256.
 *
 * @param code — the plain 6-digit OTP string
 * @returns 64-character lowercase hexadecimal digest
 */
export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// ── OTP Verification ─────────────────────────────────────────────────────────

/**
 * Verify a plain OTP code against a stored SHA-256 hash.
 *
 * Hashes the input and compares it to the expected hash.
 *
 * @param code — the plain OTP code provided by the user
 * @param hash — the stored SHA-256 hash to compare against
 * @returns `true` if the code matches the hash
 */
export function verifyOtp(code: string, hash: string): boolean {
  return hashOtp(code) === hash;
}

// ── Email Masking ────────────────────────────────────────────────────────────

/**
 * Mask the local part of an email address for display.
 *
 * Preserves the first and last character of the local part and replaces
 * everything in between with asterisks. The domain is left unchanged.
 *
 * Examples:
 * - `"ahmed@example.com"` → `"a****d@example.com"`
 * - `"ab@example.com"` → `"ab@example.com"` (2 chars — nothing to mask)
 * - `"a@example.com"` → `"a@example.com"` (1 char — nothing to mask)
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return email;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

  if (local.length <= 2) {
    return email;
  }

  const masked = local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return masked + domain;
}

// ── Query Classification ─────────────────────────────────────────────────────

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
  "payment schedule",
  "payment plan",
  "next payment",
  "how to pay",
  "how do i pay",
  "milestone",
  "balance",
  "due",
];

const PERSONAL_KEYWORDS = [
  "my unit",
  "my account",
  "my status",
  "my reservation",
  "my booking",
  "my purchase",
  "my move",
  "my home",
  "my apartment",
  "my villa",
  "my property",
  "my contract",
  "my profile",
  "my details",
  "my information",
  "my data",
  "my dates",
  "my handover",
  "about my",
  "about me",
  "tell me about my",
  "want to know about my",
  "details about my",
  "status of my",
  "status of reservation",
  "status of booking",
  "reservation status",
  "booking status",
  "unit status",
  "construction progress",
  "lease",
  "handover",
  "وحدتي",
  "حسابي",
  "حجزي",
  "حالة حجز",
  "حالة حجزي",
  "عقدي",
  "تسليم",
  "بياناتي",
];

/**
 * Classify a user message into one of four query categories.
 *
 * Uses keyword-based matching with a strict priority order:
 * sensitive > payment > personal > general.
 *
 * When keywords from multiple categories are present, the highest-priority
 * category wins. Messages with no matching keywords are classified as "general".
 *
 * @param message — the raw user message
 * @param identityType — the resolved identity type (used by the OTP gate, not by classification)
 * @returns the query category
 */
export function classifyQuery(
  message: string,
  identityType: "client" | "tenant" | "visitor"
): QueryCategory {
  const lower = message.toLowerCase();

  if (SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "sensitive";
  }

  if (PAYMENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "payment";
  }

  if (PERSONAL_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "personal";
  }

  return "general";
}

// ── OTP Record Type ──────────────────────────────────────────────────────────

export type OtpRecord = typeof otpRecords.$inferSelect;

// ── OTP Database Operations ──────────────────────────────────────────────────

/**
 * Create a new OTP record for a conversation.
 *
 * Invalidates all existing pending OTPs for the conversation before inserting
 * the new record, ensuring only one active OTP exists at a time.
 * Updates the conversation's `otpVerificationState` to "pending".
 *
 * @param db — Drizzle database instance
 * @param conversationId — the conversation this OTP belongs to
 * @param email — the recipient email address
 * @param hash — SHA-256 hash of the plain OTP code
 * @param expiresAt — when this OTP expires
 * @returns the newly created OTP record
 */
export async function createOtpRecord(
  db: Database,
  conversationId: string,
  email: string,
  hash: string,
  expiresAt: Date
): Promise<OtpRecord> {
  // Invalidate all existing pending OTPs for this conversation
  await invalidateConversationOtps(db, conversationId);

  // Insert the new OTP record
  const [record] = await db
    .insert(otpRecords)
    .values({
      conversationId,
      otpHash: hash,
      email,
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      expiresAt,
    })
    .returning();

  // Update conversation OTP verification state to "pending"
  await db
    .update(aiConversations)
    .set({ otpVerificationState: "pending", updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId));

  return record;
}

/**
 * Find the active (pending, non-expired) OTP for a conversation.
 *
 * Returns `null` if no pending OTP exists or if the only pending OTP
 * has already expired.
 *
 * @param db — Drizzle database instance
 * @param conversationId — the conversation to look up
 * @returns the active OTP record, or null
 */
export async function getActiveOtp(
  db: Database,
  conversationId: string
): Promise<OtpRecord | null> {
  const [record] = await db
    .select()
    .from(otpRecords)
    .where(
      and(
        eq(otpRecords.conversationId, conversationId),
        eq(otpRecords.status, "pending")
      )
    )
    .limit(1);

  if (!record) return null;

  // Check if the OTP has expired
  if (new Date() > record.expiresAt) {
    return null;
  }

  return record;
}

/**
 * Attempt to verify an OTP code for a conversation.
 *
 * Checks for an active OTP, validates expiry, compares the hash, and
 * handles attempt counting. On success, marks the OTP as "used" and sets
 * the conversation state to "verified". When max attempts are reached,
 * marks the OTP as "expired" and sets the conversation state to "expired".
 *
 * @param db — Drizzle database instance
 * @param conversationId — the conversation to verify
 * @param code — the plain 6-digit OTP code provided by the user
 * @returns the verification result
 */
export async function attemptOtpVerification(
  db: Database,
  conversationId: string,
  code: string
): Promise<OtpVerificationResult> {
  // Find the pending OTP for this conversation
  const [record] = await db
    .select()
    .from(otpRecords)
    .where(
      and(
        eq(otpRecords.conversationId, conversationId),
        eq(otpRecords.status, "pending")
      )
    )
    .limit(1);

  if (!record) {
    return { status: "no_active_otp" };
  }

  // Check if the OTP has expired by time
  if (new Date() > record.expiresAt) {
    await db
      .update(otpRecords)
      .set({ status: "expired" })
      .where(eq(otpRecords.id, record.id));

    await db
      .update(aiConversations)
      .set({ otpVerificationState: "expired", updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));

    return { status: "expired" };
  }

  // Compare the hash
  if (verifyOtp(code, record.otpHash)) {
    // Success — mark as used and set conversation to verified
    await db
      .update(otpRecords)
      .set({ status: "used", verifiedAt: new Date() })
      .where(eq(otpRecords.id, record.id));

    await db
      .update(aiConversations)
      .set({ otpVerificationState: "verified", updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));

    return { status: "verified" };
  }

  // Incorrect code — increment attempt count
  const newAttemptCount = record.attemptCount + 1;

  if (newAttemptCount >= record.maxAttempts) {
    // Max attempts reached — lock the OTP
    await db
      .update(otpRecords)
      .set({ status: "expired", attemptCount: newAttemptCount })
      .where(eq(otpRecords.id, record.id));

    await db
      .update(aiConversations)
      .set({ otpVerificationState: "expired", updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));

    return { status: "max_attempts_reached" };
  }

  // Still has attempts remaining
  await db
    .update(otpRecords)
    .set({ attemptCount: newAttemptCount })
    .where(eq(otpRecords.id, record.id));

  return {
    status: "invalid_code",
    remainingAttempts: record.maxAttempts - newAttemptCount,
  };
}

/**
 * Invalidate all pending OTPs for a conversation.
 *
 * Sets the status of every pending OTP record for the given conversation
 * to "invalidated". Used when generating a new OTP or during conversation
 * cleanup.
 *
 * @param db — Drizzle database instance
 * @param conversationId — the conversation whose OTPs should be invalidated
 */
export async function invalidateConversationOtps(
  db: Database,
  conversationId: string
): Promise<void> {
  await db
    .update(otpRecords)
    .set({ status: "invalidated" })
    .where(
      and(
        eq(otpRecords.conversationId, conversationId),
        eq(otpRecords.status, "pending")
      )
    );
}

// ── OTP Confirmation Detection ───────────────────────────────────────────────

const OTP_CONFIRM_PATTERNS = [
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "send",
  "send it",
  "send code",
  "send the code",
  "verify",
  "verify me",
  "verify please",
  "go ahead",
  "please do",
  "confirm",
  "confirmed",
  "i confirm",
  "yes confirm",
  "yes please",
  "نعم",
  "أرسل",
  "أرسل الرمز",
  "تحقق",
  "موافق",
  "أؤكد",
];

/**
 * Detects whether a user message is confirming they want to receive an OTP.
 *
 * Matches against common confirmation phrases in English and Arabic
 * (case-insensitive). Allows short multi-word affirmations like "yes please",
 * "yes send it", "ok send the code", "go ahead and send it" — but rejects
 * longer messages that just happen to contain "yes" or "ok" inside a
 * larger sentence to avoid false positives.
 */
export function isOtpConfirmation(message: string): boolean {
  const trimmed = message.trim().toLowerCase().replace(/[!.?,]+$/g, "");

  // Exact match against any pattern
  if (OTP_CONFIRM_PATTERNS.some((p) => trimmed === p)) return true;

  // Short messages (≤ 6 words) that START with a confirm word are treated
  // as confirmations: "yes please", "yes send it", "ok go ahead", "sure send it"
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;

  const startWords = new Set([
    "yes", "yeah", "yep", "ok", "okay", "sure", "send", "verify", "confirm",
    "confirmed", "please", "go", "i", "نعم", "أرسل", "تحقق", "موافق", "أؤكد",
  ]);
  if (!startWords.has(words[0])) return false;

  // Only allow short follow-on words that are clearly affirmative filler
  const allowedFollow = new Set([
    "please", "send", "it", "the", "code", "otp", "now", "ahead", "and",
    "do", "verify", "me", "go", "yes", "sure", "ok", "okay", "confirm",
    "أرسل", "الرمز", "نعم", "تفضل", "من", "فضلك", "أؤكد",
  ]);
  return words.slice(1).every((w) => allowedFollow.has(w));
}

// ── Email Lookup ─────────────────────────────────────────────────────────────

/**
 * Look up the registered email address for a recognized client or tenant.
 *
 * @param db — Drizzle database instance
 * @param identity — the resolved identity result
 * @returns the email address, or null if not found
 */
async function lookupEmail(
  db: Database,
  identity: IdentityResult
): Promise<string | null> {
  if (identity.clientId) {
    const [client] = await db
      .select({ email: aiClients.email })
      .from(aiClients)
      .where(eq(aiClients.id, identity.clientId))
      .limit(1);
    return client?.email ?? null;
  }

  if (identity.tenantId) {
    const [tenant] = await db
      .select({ email: aiTenants.email })
      .from(aiTenants)
      .where(eq(aiTenants.id, identity.tenantId))
      .limit(1);
    return tenant?.email ?? null;
  }

  return null;
}

// ── Payment Safety Warning ───────────────────────────────────────────────────

const PAYMENT_SAFETY_WARNING_EN =
  "No payment should be sent to any personal account — only ORA official channels.";
const PAYMENT_SAFETY_WARNING_AR =
  "لا يجب إرسال أي دفعة إلى أي حساب شخصي — فقط القنوات الرسمية لـ ORA.";

// ── Sensitive Query Priority Detection ────────────────────────────────────────

const HIGH_PRIORITY_KEYWORDS = ["payment dispute", "refund"];
const MEDIUM_PRIORITY_KEYWORDS = ["account change", "financial correction"];

/**
 * Determine the ticket priority based on the message content.
 *
 * - "payment dispute" or "refund" → high
 * - "account change" or "financial correction" → medium
 * - Fallback → medium (all sensitive queries are at least medium priority)
 */
function determineSensitivePriority(
  message: string
): "high" | "medium" {
  const lower = message.toLowerCase();

  if (HIGH_PRIORITY_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "high";
  }

  return "medium";
}

// ── Escalate Sensitive Query ─────────────────────────────────────────────────

/**
 * Escalate a sensitive query by creating a support ticket and initiating
 * a human handoff.
 *
 * 1. Determines ticket priority based on message keywords:
 *    - "payment dispute" / "refund" → high
 *    - "account change" / "financial correction" → medium
 * 2. Creates a support ticket via the ticketing system with the query details,
 *    conversation reference, and user identity information.
 * 3. Initiates a human handoff so a representative can follow up.
 *
 * @param db — Drizzle database instance
 * @param conversationId — the current conversation ID
 * @param message — the user's sensitive query message
 * @param identity — the resolved identity result
 * @param language — the conversation language
 * @returns the created ticket number
 */
export async function escalateSensitiveQuery(
  db: Database,
  conversationId: string,
  message: string,
  identity: IdentityResult,
  language: "en" | "ar"
): Promise<{ ticketNumber: string }> {
  const priority = determineSensitivePriority(message);

  const contactName = identity.firstName ?? "Unknown";
  const contactEmail =
    identity.type === "client" && identity.clientId
      ? (
          await db
            .select({ email: aiClients.email })
            .from(aiClients)
            .where(eq(aiClients.id, identity.clientId))
            .limit(1)
        )[0]?.email ?? ""
      : identity.type === "tenant" && identity.tenantId
        ? (
            await db
              .select({ email: aiTenants.email })
              .from(aiTenants)
              .where(eq(aiTenants.id, identity.tenantId))
              .limit(1)
          )[0]?.email ?? ""
        : "";

  // Create a support ticket with the sensitive query details
  const { ticketNumber } = await createTicket(db, {
    subject:
      language === "ar"
        ? `استفسار حساس — محادثة ${conversationId}`
        : `Sensitive query — Conversation ${conversationId}`,
    description: message,
    contactName,
    contactEmail,
    priority,
    source: "api",
    createdBy: null,
  });

  // Initiate human handoff for the conversation
  await initiateHandoff(db, conversationId, `Sensitive query escalation: ${message}`);

  return { ticketNumber };
}

// ── OTP Chat Gate ────────────────────────────────────────────────────────────

/**
 * The main OTP gate integration function called by the chat orchestrator.
 *
 * Sits between identity resolution and RAG processing. Classifies the user's
 * query and decides whether to proceed to RAG or intercept with an OTP-related
 * response.
 *
 * **Behavior by query category and state:**
 *
 * - **General**: always proceeds to RAG regardless of OTP state.
 * - **Personal (verified)**: proceeds to RAG.
 * - **Personal (not verified, recognized)**: prompts for OTP.
 * - **Personal (visitor)**: asks user to identify themselves.
 * - **Payment (verified)**: returns payment info with safety warning, triggers handoff.
 * - **Payment (not verified, recognized)**: prompts for OTP.
 * - **Payment (visitor)**: asks user to identify themselves.
 * - **Sensitive**: always escalates (ticket + handoff), never proceeds.
 *
 * **Special "pending" state handling:**
 * - 6-digit code → attempt OTP verification.
 * - Confirmation message → generate and send OTP (shouldn't normally happen if
 *   OTP was already sent, but handles edge cases).
 * - Other messages → classify normally.
 *
 * @param db — Drizzle database instance
 * @param conversationId — the current conversation ID
 * @param message — the raw user message
 * @param identity — the resolved identity result
 * @param language — the conversation language
 * @param otpVerificationState — the current OTP verification state
 * @returns the gate result: proceed to RAG or respond with an intercepted message
 */
export async function handleOtpGate(
  db: Database,
  conversationId: string,
  message: string,
  identity: IdentityResult,
  language: "en" | "ar",
  otpVerificationState: OtpVerificationState
): Promise<OtpGateResult> {
  // ── Pending state: check for OTP code submission ─────────────────────────
  if (otpVerificationState === "pending" && /^\d{6}$/.test(message.trim())) {
    const result = await attemptOtpVerification(
      db,
      conversationId,
      message.trim()
    );

    // Classify the original intent as personal (they're in the OTP flow)
    const queryCategory: QueryCategory = "personal";

    switch (result.status) {
      case "verified": {
        // Look up any buffered personal question so the orchestrator can
        // answer it automatically without making the user retype it.
        let pendingQuery: string | undefined;
        try {
          const [row] = await db
            .select({ summary: aiConversations.handoffSummary })
            .from(aiConversations)
            .where(eq(aiConversations.id, conversationId))
            .limit(1);
          const summary = row?.summary as { pendingQuery?: string } | null;
          if (summary?.pendingQuery && typeof summary.pendingQuery === "string") {
            pendingQuery = summary.pendingQuery;
          }
          // Clear ONLY the buffered query — preserve any running summary or
          // other handoff fields so they survive the OTP round-trip.
          if (summary && typeof summary === "object") {
            const next = { ...summary } as Record<string, unknown>;
            delete next.pendingQuery;
            await db
              .update(aiConversations)
              .set({ handoffSummary: next, updatedAt: new Date() })
              .where(eq(aiConversations.id, conversationId));
          }
        } catch {
          // Best-effort
        }

        const baseEn = "You're verified! ✓";
        const baseAr = "ممتاز، تم التحقق! ✓";
        let response: string;
        if (pendingQuery) {
          response =
            language === "ar"
              ? `${baseAr} دعني أعود لسؤالك السابق…`
              : `${baseEn} Let me get back to your earlier question…`;
        } else {
          response =
            language === "ar"
              ? `${baseAr} والآن، كيف يمكنني خدمتك في حسابك؟`
              : `${baseEn} Now — how can I help you with your account?`;
        }

        return {
          action: "respond",
          response,
          queryCategory,
          pendingQuery,
        };
      }

      case "invalid_code":
        return {
          action: "respond",
          response:
            language === "ar"
              ? `الرمز غير صحيح. لديك ${result.remainingAttempts} محاولة متبقية.`
              : `That code is incorrect. You have ${result.remainingAttempts} attempt(s) remaining.`,
          queryCategory,
        };

      case "expired":
        return {
          action: "respond",
          response:
            language === "ar"
              ? "انتهت صلاحية رمز التحقق. هل تريد أن أرسل لك رمزاً جديداً؟"
              : "Your verification code has expired. Would you like me to send a new one?",
          queryCategory,
        };

      case "max_attempts_reached":
        return {
          action: "respond",
          response:
            language === "ar"
              ? "تم قفل رمز التحقق بسبب عدد كبير من المحاولات الفاشلة. هل تريد أن أرسل لك رمزاً جديداً؟"
              : "Your verification code has been locked due to too many failed attempts. Would you like me to send a new one?",
          queryCategory,
        };

      case "no_active_otp":
        return {
          action: "respond",
          response:
            language === "ar"
              ? "لا يوجد رمز تحقق نشط. هل تريد أن أرسل لك رمزاً جديداً؟"
              : "There is no active verification code. Would you like me to send a new one?",
          queryCategory,
        };
    }
  }

  // ── Check for OTP send confirmation ──────────────────────────────────────
  if (
    identity.type !== "visitor" &&
    isOtpConfirmation(message) &&
    (otpVerificationState === "not_required" ||
      otpVerificationState === "expired" ||
      otpVerificationState === "pending")
  ) {
    return await handleOtpSend(db, conversationId, identity, language);
  }

  // ── Classify the query ───────────────────────────────────────────────────
  const queryCategory = classifyQuery(message, identity.type);

  // ── General queries: always proceed ──────────────────────────────────────
  if (queryCategory === "general") {
    return { action: "proceed", queryCategory };
  }

  // ── Sensitive queries: always escalate ───────────────────────────────────
  if (queryCategory === "sensitive") {
    const { ticketNumber } = await escalateSensitiveQuery(
      db,
      conversationId,
      message,
      identity,
      language
    );

    return {
      action: "respond",
      response:
        language === "ar"
          ? `تم إنشاء تذكرة دعم برقم ${ticketNumber}. سيتواصل معك أحد ممثلينا قريباً للمساعدة في هذا الأمر.`
          : `A support ticket #${ticketNumber} has been created. A representative will follow up with you shortly to assist with this matter.`,
      queryCategory,
    };
  }

  // ── Visitor asking personal/payment questions ────────────────────────────
  if (identity.type === "visitor") {
    return {
      action: "respond",
      response:
        language === "ar"
          ? "بكل سرور أساعدك في حسابك — لكن قبل أي شيء أحتاج أتأكد أنك صاحب الحساب فعلاً. شاركني بريدك الإلكتروني أو رقم هاتفك المسجل وسأتولى الباقي. 🙂"
          : "Happy to help with your account — but first I need to make sure you're the right person. Share the email or mobile number you registered with us and I'll take it from there. 🙂",
      queryCategory,
    };
  }

  // ── Recognized identity (client/tenant) ──────────────────────────────────

  // Personal query — verified → proceed
  if (queryCategory === "personal" && otpVerificationState === "verified") {
    return { action: "proceed", queryCategory };
  }

  // Payment query — verified → respond with payment info + safety warning + handoff
  if (queryCategory === "payment" && otpVerificationState === "verified") {
    const safetyWarning =
      language === "ar" ? PAYMENT_SAFETY_WARNING_AR : PAYMENT_SAFETY_WARNING_EN;

    return {
      action: "respond",
      response:
        language === "ar"
          ? `يمكنك الاطلاع على معلومات الدفع الخاصة بك من خلال القنوات الرسمية لـ ORA كما تم مشاركتها معك وقت الحجز. ${safetyWarning} سيتم تحويلك الآن إلى أحد ممثلينا لمساعدتك في أمور الدفع.`
          : `You can view your payment information through ORA's official channels as shared with you at the time of booking. ${safetyWarning} You will now be connected with a representative to assist you with payment matters.`,
      queryCategory,
    };
  }

  // Personal or payment query — not verified → prompt for OTP
  const email = await lookupEmail(db, identity);
  const name = identity.firstName ?? "";

  if (!email) {
    return {
      action: "respond",
      response:
        language === "ar"
          ? "لم نتمكن من العثور على بريد إلكتروني مسجل لحسابك. يرجى التواصل مع فريق الدعم للمساعدة."
          : "We could not find a registered email for your account. Please contact our support team for assistance.",
      queryCategory,
    };
  }

  const masked = maskEmail(email);

  // Buffer the personal/payment question on the conversation row so we can
  // automatically answer it after OTP verification — saves the user from
  // retyping the same question. Merge into existing handoff state instead
  // of clobbering (preserves running summary etc.).
  try {
    const [existing] = await db
      .select({ s: aiConversations.handoffSummary })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);
    const merged = {
      ...((existing?.s as Record<string, unknown> | null) ?? {}),
      pendingQuery: message,
    };
    await db
      .update(aiConversations)
      .set({ handoffSummary: merged, updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
  } catch {
    // Best-effort — never fail the gate because of buffering.
  }

  return {
    action: "respond",
    response:
      language === "ar"
        ? `${name ? name + "، " : ""}سعيد بعودتك! 🙂 لحماية بياناتك، أحتاج التأكد أنك أنت قبل أن أشاركك تفاصيل حسابك. هل أرسل رمز تحقق سريع إلى ${masked}؟ يمكنك الاستمرار بالأسئلة العامة بدون تحقق.`
        : `${name ? name + ", " : ""}great to have you here! Before I open up your account details, I just want to make sure it's really you — privacy first. Want me to send a quick 6-digit code to ${masked}? You can still ask general questions in the meantime.`,
    queryCategory,
  };
}

// ── OTP Send Helper ──────────────────────────────────────────────────────────

/**
 * Handles the OTP generation and email sending flow when a user confirms
 * they want to receive an OTP.
 *
 * 1. Looks up the registered email for the identity
 * 2. Generates a new OTP
 * 3. Creates the OTP record in the database
 * 4. Sends the OTP email
 * 5. Returns the appropriate response
 */
async function handleOtpSend(
  db: Database,
  conversationId: string,
  identity: IdentityResult,
  language: "en" | "ar"
): Promise<OtpGateResult> {
  const queryCategory: QueryCategory = "personal";
  const email = await lookupEmail(db, identity);

  if (!email) {
    return {
      action: "respond",
      response:
        language === "ar"
          ? "لم نتمكن من العثور على بريد إلكتروني مسجل لحسابك. يرجى التواصل مع فريق الدعم للمساعدة."
          : "We could not find a registered email for your account. Please contact our support team for assistance.",
      queryCategory,
    };
  }

  const otp = generateOtp();

  try {
    await createOtpRecord(db, conversationId, email, otp.hash, otp.expiresAt);
  } catch {
    return {
      action: "respond",
      response:
        language === "ar"
          ? "حدث خطأ أثناء إنشاء رمز التحقق. يرجى المحاولة مرة أخرى أو التواصل مع أحد ممثلينا."
          : "An error occurred while creating the verification code. Please try again or connect with a representative.",
      queryCategory,
    };
  }

  const emailResult = await sendOtpEmail({
    recipientEmail: email,
    otpCode: otp.code,
    recipientName: identity.firstName ?? "",
    language,
  });

  if (!emailResult.success) {
    return {
      action: "respond",
      response:
        language === "ar"
          ? "لم نتمكن من إرسال رمز التحقق. يرجى المحاولة مرة أخرى أو التواصل مع أحد ممثلينا."
          : "We couldn't send the verification code. Please try again or connect with a representative.",
      queryCategory,
    };
  }

  const masked = maskEmail(email);

  return {
    action: "respond",
    response:
      language === "ar"
        ? `تم إرسال رمز التحقق إلى ${masked}. يرجى إدخال الرمز المكون من 6 أرقام.`
        : `A verification code has been sent to ${masked}. Please enter the 6-digit code.`,
    queryCategory,
  };
}
