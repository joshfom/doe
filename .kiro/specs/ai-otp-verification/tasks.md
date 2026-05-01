# Implementation Plan: AI OTP Verification

## Overview

Adds an OTP verification gate to the ORA AI assistant chat flow. The implementation proceeds bottom-up: database schema changes (new `otp_records` table + `otp_verification_state` column on `ai_conversations`) → pure OTP functions (generation, hashing, verification, email masking) → email service (Microsoft Graph API with OAuth2 token caching) → query classifier → OTP database operations → OTP chat gate → sensitive query escalation → chat orchestrator integration → Drizzle migration. All code is TypeScript, using existing Drizzle ORM patterns, vitest for testing, and fast-check for property-based tests.

## Tasks

- [x] 1. Database schema changes
  - [x] 1.1 Add `otp_records` table and `otp_verification_state` column to `lib/cms/schema.ts`
    - Add `otpRecords` table with columns: id (UUID), conversationId (FK → aiConversations, onDelete cascade), otpHash (text), email (text), status (enum: pending/used/expired/invalidated, default pending), attemptCount (integer, default 0), maxAttempts (integer, default 3), expiresAt (timestamp), createdAt (timestamp), verifiedAt (timestamp, nullable)
    - Add composite index on `otp_records(conversation_id, status)` for efficient active OTP lookup
    - Add `otpVerificationState` column to `aiConversations` table: text enum ("not_required", "pending", "verified", "expired"), default "not_required"
    - Export the new `otpRecords` table from schema
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2_

  - [x] 1.2 Generate Drizzle migration
    - Run `npx drizzle-kit generate` to create the SQL migration file in `drizzle/`
    - Verify the migration includes the new `otp_records` table, the index, and the `otp_verification_state` column on `ai_conversations`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 2. OTP core functions and query classifier
  - [x] 2.1 Implement pure OTP functions in `lib/cms/ai/otp.ts`
    - Export `generateOtp(): OtpGenerateResult` — uses `crypto.randomInt(0, 1_000_000)` for a cryptographically random 6-digit code (zero-padded), returns `{ code, hash, expiresAt }` with 5-minute expiry
    - Export `hashOtp(code: string): string` — SHA-256 hash via `crypto.createHash('sha256')`
    - Export `verifyOtp(code: string, hash: string): boolean` — hashes input and compares against stored hash
    - Export `maskEmail(email: string): string` — masks local part preserving first and last character (e.g., `"a****d@example.com"`)
    - Define and export types: `OtpGenerateResult`, `QueryCategory`, `OtpVerificationResult`, `OtpGateResult`
    - _Requirements: 2.1, 3.6, 6.4_

  - [x] 2.2 Write property tests for OTP generation (Property 6)
    - **Property 6: OTP generation produces valid 6-digit codes**
    - Verify code is exactly 6 numeric characters in range [0, 999999], hash is 64-char lowercase hex
    - **Validates: Requirements 2.1**

  - [x] 2.3 Write property test for OTP hash round-trip (Property 8)
    - **Property 8: OTP hash round-trip verification**
    - For random 6-digit strings, `verifyOtp(code, hashOtp(code))` returns true, and hash !== code
    - **Validates: Requirements 3.6, 6.4**

  - [x] 2.4 Implement query classifier in `lib/cms/ai/otp.ts`
    - Export `classifyQuery(message: string, identityType: "client" | "tenant" | "visitor"): QueryCategory`
    - Classification priority: sensitive > payment > personal > general
    - Sensitive keywords: payment dispute, refund, account change, financial correction
    - Payment keywords: payment status, make payment, payment method, installment
    - Personal keywords: my unit, my account, my status, construction progress, lease, handover
    - General: everything else
    - _Requirements: 1.5_

  - [x] 2.5 Write property tests for query classification (Property 5)
    - **Property 5: Query classification keyword correctness**
    - Messages with category keywords classify to that category; no keywords → general; multi-category → highest priority wins
    - **Validates: Requirements 1.5**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Email service (Microsoft Graph API)
  - [x] 4.1 Implement email service at `lib/cms/ai/email.ts`
    - Export `sendOtpEmail(input: SendOtpEmailInput): Promise<{ success: boolean; error?: string }>` — sends OTP email via Microsoft Graph API
    - Implement OAuth2 client credentials token acquisition with in-memory cache (POST to `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`), cache token with `expires_in` minus 60-second buffer
    - Send email via `POST https://graph.microsoft.com/v1.0/users/{senderEmail}/sendMail` using the configured `AZURE_COMMUNICATION_SENDER`
    - Build HTML email template with ORA branding, prominent OTP code, 5-minute expiry notice, security warning, support contact — bilingual (EN/AR) based on `language` parameter
    - Read Azure credentials from environment variables: `AZURE_COMMUNICATION_TENANT_ID`, `AZURE_COMMUNICATION_CLIENT_ID`, `AZURE_COMMUNICATION_CLIENT_SECRET`, `AZURE_COMMUNICATION_SENDER`
    - Define and export `SendOtpEmailInput` type: `{ recipientEmail, otpCode, recipientName, language }`
    - _Requirements: 2.3, 2.4, 2.5, 7.1, 7.2, 7.3, 7.4_

  - [x] 4.2 Write property test for email template rendering (Property 12)
    - **Property 12: Email template contains all required elements in correct language**
    - For random names, codes, and each language, rendered HTML contains ORA brand, OTP code, expiry notice, security warning, support info; Arabic text for "ar", English for "en"
    - **Validates: Requirements 7.2, 7.3**

- [x] 5. OTP database operations
  - [x] 5.1 Implement OTP database operations in `lib/cms/ai/otp.ts`
    - Export `createOtpRecord(db, conversationId, email, hash, expiresAt): Promise<OtpRecord>` — invalidates all existing pending OTPs for the conversation, inserts new record, updates conversation `otpVerificationState` to "pending"
    - Export `getActiveOtp(db, conversationId): Promise<OtpRecord | null>` — finds the pending, non-expired OTP for a conversation
    - Export `attemptOtpVerification(db, conversationId, code): Promise<OtpVerificationResult>` — checks for active OTP, validates expiry, compares hash, increments attempt count on failure, marks as "used" and sets conversation state to "verified" on success, marks as "expired" and sets conversation state to "expired" when max attempts reached
    - Export `invalidateConversationOtps(db, conversationId): Promise<void>` — sets all pending OTPs to "invalidated"
    - _Requirements: 2.2, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 6.5_

  - [x] 5.2 Write unit tests for OTP database operations
    - Test OTP record creation stores all required fields
    - Test previous pending OTP is invalidated when new one is created (Property 7)
    - Test successful verification updates OTP status to "used" and conversation state to "verified"
    - Test incorrect code increments attempt count and reports remaining attempts (Property 9)
    - Test max attempts (3) locks OTP and sets state to "expired"
    - Test expired OTP with correct code returns "expired" (Property 10)
    - Test `getActiveOtp` returns null when no pending OTP exists
    - _Requirements: 2.2, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. OTP chat gate and sensitive query escalation
  - [x] 6.1 Implement OTP chat gate in `lib/cms/ai/otp.ts`
    - Export `handleOtpGate(db, conversationId, message, identity, language, otpVerificationState): Promise<OtpGateResult>` — the main integration function called by the chat orchestrator
    - Classify the query using `classifyQuery`
    - For general queries: always return `{ action: "proceed" }` regardless of OTP state
    - For personal queries with verified state: return `{ action: "proceed" }`
    - For personal/payment queries with non-verified state and recognized identity: prompt for OTP, offer to send to masked email
    - For personal queries from visitors: return identification prompt (provide phone/email)
    - For payment queries with verified state: return payment info response with safety warning (EN/AR) and trigger human handoff
    - For sensitive queries: always escalate (create ticket + handoff), never proceed to RAG
    - When conversation state is "pending" and message matches `/^\d{6}$/`: attempt OTP verification
    - When user confirms OTP send (e.g., "yes", "send", "نعم"): generate OTP, create record, send email
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 4.3, 4.4, 5.3, 8.1_

  - [x] 6.2 Implement sensitive query escalation in `lib/cms/ai/otp.ts`
    - Export `escalateSensitiveQuery(db, conversationId, message, identity, language): Promise<{ ticketNumber: string }>`
    - Create a support ticket via `createTicket` from `lib/cms/tickets/service.ts` with appropriate priority (high for payment disputes, medium for account changes)
    - Initiate human handoff via `initiateHandoff` from `lib/cms/ai/handoff.ts`
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 6.3 Write property tests for OTP gate (Properties 1–4, 11) in `lib/cms/ai/otp-gate.test.ts`
    - **Property 1: OTP gate blocks non-verified personal and payment queries**
    - **Validates: Requirements 1.1, 4.1**
    - **Property 2: General queries always pass through regardless of OTP state**
    - **Validates: Requirements 1.4**
    - **Property 3: Verified state allows personal queries**
    - **Validates: Requirements 1.3, 8.1**
    - **Property 4: Visitor personal queries get identification prompt**
    - **Validates: Requirements 1.2**
    - **Property 11: Sensitive queries never proceed to RAG**
    - **Validates: Requirements 5.3**

  - [x] 6.4 Write unit tests for OTP gate and escalation
    - Test OTP email delivery failure returns error response and offers retry/human agent (Req 2.5)
    - Test payment query response includes safety warning in English and Arabic (Req 4.2, 4.4)
    - Test sensitive query creates ticket with correct priority mapping (Req 5.4)
    - Test 6-digit code input during pending state triggers verification attempt
    - Test non-6-digit input during pending state is treated as regular message
    - Test user confirmation triggers OTP generation and email send
    - _Requirements: 2.5, 4.2, 4.4, 5.4_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Chat orchestrator integration
  - [x] 8.1 Integrate OTP gate into `lib/cms/ai/chat.ts`
    - Import `handleOtpGate` from `lib/cms/ai/otp.ts`
    - Import `otpVerificationState` column from schema for conversation loading
    - After Step 5 (scope boundary check) and before Step 6 (action intents), add Step 5.5: load conversation's `otpVerificationState`, call `handleOtpGate`
    - If gate returns `{ action: "respond" }`: persist user message and gate response, return early without proceeding to RAG
    - If gate returns `{ action: "proceed" }`: continue to Step 6 (action intents) and Step 7 (RAG) as normal
    - Ensure new conversations start with `otpVerificationState: "not_required"` (already the column default)
    - _Requirements: 1.1, 1.3, 1.4, 8.1, 8.2, 8.3_

  - [x] 8.2 Write unit tests for chat orchestrator OTP integration
    - Test that personal query from unverified client triggers OTP prompt instead of RAG
    - Test that general query from unverified client proceeds to RAG normally
    - Test that personal query from verified client proceeds to RAG normally
    - Test that sensitive query triggers escalation and does not reach RAG
    - _Requirements: 1.1, 1.3, 1.4, 5.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All OTP core modules go in `lib/cms/ai/otp.ts` following the existing AI module pattern
- Email service goes in `lib/cms/ai/email.ts` for separation of concerns
- Property-based tests use fast-check (already in devDependencies) with minimum 100 iterations
- Integration into `chat.ts` is the final step to ensure all components are tested before wiring
