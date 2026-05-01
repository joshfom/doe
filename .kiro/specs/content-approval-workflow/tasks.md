# Implementation Plan: Content Approval Workflow

## Overview

Adds a publication gate to Ora CMS so that content (pages, blog posts, news, construction updates) requires explicit approver sign-off before going live. Implementation proceeds bottom-up: schema → services → API routes → hooks → UI, with property-based tests validating correctness properties from the design document.

## Tasks

- [x] 1. Database schema and type extensions
  - [x] 1.1 Extend types in `lib/cms/types.ts`
    - Add `ContentModule` type: `"pages" | "blog" | "news" | "construction_updates"`
    - Add `ApprovalStatus` type: `"pending" | "approved" | "rejected"`
    - Add `ApprovalDecisionValue` type: `"approved" | "rejected"`
    - Extend `PageStatus` to include `"pending_review"`
    - Extend `PostStatus` to include `"pending_review"`
    - Extend `AuditAction` with `"approval_submit" | "approval_decide" | "approval_auto_resolve"`
    - Extend `AuditEntityType` with `"approval_request" | "notification"`
    - _Requirements: 3.1, 5.1, 7.1, 7.2_

  - [x] 1.2 Add approval tables to `lib/cms/schema.ts`
    - Add `approvalConfig` table with `id`, `contentModule` (enum text), `enabled` (boolean), `updatedAt`
    - Add unique index on `contentModule`
    - Add `approvalConfigApprovers` junction table with `id`, `configId` (FK → approvalConfig), `userId` (FK → users), unique index on `(configId, userId)`
    - Add `approvalRequests` table with `id`, `contentId`, `contentModule`, `submitterId` (FK → users), `status` (enum: pending/approved/rejected), `createdAt`, `resolvedAt`, plus indexes on `(contentId, contentModule)`, `status`, `submitterId`
    - Add `approvalDecisions` table with `id`, `requestId` (FK → approvalRequests), `approverId` (FK → users), `decision` (enum: approved/rejected), `comment`, `createdAt`, plus unique index on `(requestId, approverId)` and index on `requestId`
    - _Requirements: 1.1, 1.4, 2.1, 3.3, 5.5_

  - [x] 1.3 Extend `pages` and `posts` status enums in `lib/cms/schema.ts`
    - Change `pages.status` enum from `["draft", "published"]` to `["draft", "published", "pending_review"]`
    - Change `posts.status` enum from `["draft", "published", "trashed"]` to `["draft", "published", "trashed", "pending_review"]`
    - _Requirements: 3.1, 3.4_

  - [x] 1.4 Generate Drizzle migration
    - Run `npx drizzle-kit generate` to create the SQL migration file in `drizzle/`
    - Verify the generated migration includes all four new tables, indexes, and status enum changes
    - _Requirements: 1.4_

- [x] 2. Core services — Publication Gate and Approval Service
  - [x] 2.1 Implement Publication Gate at `lib/cms/approval/gate.ts`
    - Export `checkPublicationGate(db, contentId, contentModule, submitterId): Promise<GateResult>`
    - Query `approvalConfig` for the module; if disabled return `{ allowed: true }`
    - If enabled: create `approvalRequest` record, set content status to `pending_review` (update pages or posts table based on module), return `{ allowed: false, approvalRequestId }`
    - Call `notifyApprovers` after creating the request
    - Log `approval_submit` to audit log
    - _Requirements: 1.2, 1.3, 3.1, 3.2, 8.1, 8.2, 8.3_

  - [x] 2.2 Write property test: Approval-enabled intercepts publish
    - **Property 2: Approval-enabled intercepts publish**
    - **Validates: Requirements 1.3, 3.1, 8.1**

  - [x] 2.3 Write property test: Approval-disabled allows direct publish
    - **Property 3: Approval-disabled allows direct publish**
    - **Validates: Requirements 1.2, 3.2, 8.3**

  - [x] 2.4 Implement Approval Service at `lib/cms/approval/service.ts`
    - Export `submitDecision(db, approvalRequestId, approverId, decision, comment?): Promise<ApprovalRequest>`
      - Insert into `approvalDecisions`; if all approvers approved → set content status to `published`, request status to `approved`; if rejected → set content to `draft`, request to `rejected`
      - Use a transaction to prevent race conditions on resolution check
      - Log `approval_decide` to audit log
      - Send result notification to submitter
    - Export `getPendingForApprover(db, approverId): Promise<ApprovalRequestWithDetails[]>`
      - Join approval_requests with content tables and users to return title, module, submitter name, date
    - Export `getApprovalProgress(db, contentId, contentModule): Promise<{ approved: number; total: number; decisions: ApprovalDecisionRecord[] }>`
    - Export `autoResolvePendingRequests(db, contentModule): Promise<number>`
      - When approval is disabled, revert all pending requests for that module: set request status to `rejected`, content status to `draft`
      - Log `approval_auto_resolve` to audit log
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.4, 7.1, 7.2, 8.5_

  - [x] 2.5 Write property test: Decision round-trip
    - **Property 10: Decision round-trip**
    - **Validates: Requirements 5.1, 5.2, 5.5**

  - [x] 2.6 Write property test: All approvals trigger publication
    - **Property 11: All approvals trigger publication**
    - **Validates: Requirements 5.3**

  - [x] 2.7 Write property test: Any rejection triggers draft revert
    - **Property 12: Any rejection triggers draft revert**
    - **Validates: Requirements 5.4**

  - [x] 2.8 Write property test: Approval progress calculation
    - **Property 13: Approval progress calculation**
    - **Validates: Requirements 5.6, 6.4**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Notification Service
  - [x] 4.1 Implement Notification Service at `lib/cms/approval/notifications.ts`
    - Export `notifyApprovers(db, approvalRequest, approvers, submitterName, contentTitle, contentModule): Promise<void>`
      - Build email with content title, module name, submitter name, and review link URL
      - Call `sendEmail` for each approver; catch failures and log to audit with entity type `notification`
    - Export `notifySubmitter(db, approvalRequest, submitterEmail, outcome, contentTitle): Promise<void>`
    - Export `sendEmail(payload: EmailPayload): Promise<void>`
      - Read SMTP config from env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
      - If SMTP not configured, log warning and skip silently
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 Write property test: Email body contains required fields
    - **Property 9: Email body contains required fields**
    - **Validates: Requirements 4.2**

- [x] 5. API routes
  - [x] 5.1 Create approval config routes at `lib/cms/api/routes/approval-config.ts`
    - `GET /api/approval-config` — return all module configs with assigned approvers
    - `PUT /api/approval-config/:module` — update toggle + approvers for a module
      - Validate module against `ContentModule` enum (400 if invalid)
      - Validate approver user IDs exist in users table (400 if not)
      - Validate non-empty approver list when enabling (400 if empty)
      - When disabling: call `autoResolvePendingRequests` for the module
    - Both routes require auth via `authGuard`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 8.4, 8.5_

  - [x] 5.2 Write property test: Configuration round-trip
    - **Property 1: Configuration round-trip**
    - **Validates: Requirements 1.1, 1.4**

  - [x] 5.3 Write property test: Approver assignment round-trip
    - **Property 4: Approver assignment round-trip**
    - **Validates: Requirements 2.1**

  - [x] 5.4 Write property test: Approver assignment validation
    - **Property 5: Approver assignment validation**
    - **Validates: Requirements 2.2, 2.3**

  - [x] 5.5 Write property test: Removing approver preserves existing requests
    - **Property 6: Removing approver preserves existing requests**
    - **Validates: Requirements 2.4**

  - [x] 5.6 Create approval routes at `lib/cms/api/routes/approvals.ts`
    - `GET /api/approvals/pending` — list pending requests for current user (calls `getPendingForApprover`)
    - `GET /api/approvals/:id` — get single request with all decisions
    - `POST /api/approvals/:id/decide` — submit approve/reject decision
      - Verify user is an assigned approver for the request's module (403 if not)
      - Return 409 if request already resolved or duplicate decision
    - `GET /api/approvals/content/:module/:contentId` — get approval status for a content item
    - All routes require auth via `authGuard`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.3_

  - [x] 5.7 Write property test: Dashboard returns correct filtered data
    - **Property 14: Dashboard returns correct filtered data**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 5.8 Modify existing publish endpoints to use the publication gate
    - In `lib/cms/api/routes/posts.ts`: modify `POST /posts/:id/publish` to call `checkPublicationGate` before publishing; if gate returns `{ allowed: false }`, return 202 with `approvalRequestId`
    - In `lib/cms/api/routes/pages.ts`: modify `POST /pages/:id/publish` similarly
    - Ensure public-facing queries in both routes filter out `pending_review` status
    - _Requirements: 3.1, 3.2, 3.4, 8.1, 8.2, 8.3_

  - [x] 5.9 Write property test: Pending content excluded from public queries
    - **Property 8: Pending content excluded from public queries**
    - **Validates: Requirements 3.4**

  - [x] 5.10 Register new routes in `lib/cms/api/index.ts`
    - Import and `.use()` `approvalConfigRoutes` and `approvalRoutes`
    - _Requirements: 6.5_

  - [x] 5.11 Write property test: Approval request records required data
    - **Property 7: Approval request records required data**
    - **Validates: Requirements 3.3**

  - [x] 5.12 Write property test: Approval actions produce audit entries
    - **Property 15: Approval actions produce audit entries**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 5.13 Write property test: Non-retroactive enablement
    - **Property 16: Non-retroactive enablement**
    - **Validates: Requirements 8.4**

  - [x] 5.14 Write property test: Auto-resolve on disable
    - **Property 17: Auto-resolve on disable**
    - **Validates: Requirements 8.5**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. React Query hooks
  - [x] 7.1 Create approval hooks at `lib/cms/hooks/use-approvals.ts`
    - Define `approvalKeys` query key factory
    - `useApprovalConfig()` — GET `/api/approval-config`
    - `useUpdateApprovalConfig()` — PUT mutation, invalidates config key
    - `usePendingApprovals()` — GET `/api/approvals/pending`
    - `useApprovalDetail(id)` — GET `/api/approvals/:id`
    - `useSubmitDecision()` — POST mutation for `/api/approvals/:id/decide`, invalidates pending + detail keys
    - `useContentApprovalStatus(module, contentId)` — GET `/api/approvals/content/:module/:contentId`
    - _Requirements: 1.1, 2.5, 5.6, 6.1, 6.4_

  - [x] 7.2 Export new hooks from `lib/cms/hooks/index.ts`
    - Add exports for all approval hooks and `approvalKeys`
    - _Requirements: 2.5, 6.1_

- [x] 8. UI — Settings page extension
  - [x] 8.1 Add "Content Approval" section to `app/ora-panel/settings/page.tsx`
    - Add a new section below existing settings with heading "Content Approval"
    - For each content module (Pages, Blog, News, Construction Updates): render a toggle switch (enabled/disabled) and a multi-select user picker for approvers
    - Use `useApprovalConfig` and `useUpdateApprovalConfig` hooks
    - Fetch users list for the approver picker (use existing users endpoint or add one)
    - Save button persists changes per module
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.5_

- [x] 9. UI — Review Dashboard and Approval Actions
  - [x] 9.1 Create Review Dashboard page at `app/ora-panel/reviews/page.tsx`
    - Table listing pending approval requests with columns: content title (link to content detail), module type (badge), submitter name, submitted date, progress ("M of N approved"), Review action button
    - Use `usePendingApprovals` hook
    - Empty state when no pending reviews
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 9.2 Add Reviews nav item to admin layout at `app/ora-panel/layout.tsx`
    - Add `{ href: '/ora-panel/reviews', label: 'Reviews', icon: CheckSquare }` to `navItems` array (import `CheckSquare` from lucide-react)
    - Place it before the Settings item in the navigation order
    - _Requirements: 6.5_

  - [x] 9.3 Create ApprovalActions component at `lib/cms/components/ApprovalActions.tsx`
    - Accepts `contentId`, `contentModule` props
    - Shows current approval status and progress bar/text
    - Approve/Reject buttons visible only to assigned approvers
    - Comment textarea for optional feedback
    - Decision history timeline showing each decision with approver name, decision, comment, timestamp
    - Uses `useContentApprovalStatus` and `useSubmitDecision` hooks
    - _Requirements: 5.1, 5.2, 5.6, 7.3_

  - [x] 9.4 Integrate ApprovalActions into blog editor at `app/ora-panel/blog/[id]/page.tsx`
    - Import and render `ApprovalActions` component when content has a pending or resolved approval request
    - Show "Pending Review" badge on the editor when status is `pending_review`
    - _Requirements: 3.5, 5.6, 7.3_

  - [x] 9.5 Integrate ApprovalActions into page editor at `app/ora-panel/pages/[id]/page.tsx`
    - Import and render `ApprovalActions` component when content has a pending or resolved approval request
    - Show "Pending Review" badge on the editor when status is `pending_review`
    - _Requirements: 3.5, 5.6, 7.3_

  - [x] 9.6 Add "Pending Review" badge to blog listing at `app/ora-panel/blog/page.tsx`
    - Display a "Pending Review" badge next to posts with `pending_review` status in the admin listing table
    - _Requirements: 3.5_

  - [x] 9.7 Add "Pending Review" badge to pages listing at `app/ora-panel/pages/page.tsx`
    - Display a "Pending Review" badge next to pages with `pending_review` status in the admin listing table
    - _Requirements: 3.5_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The publication gate is the critical enforcement point — it must be integrated before any UI work
- SMTP configuration is optional; the workflow functions without email notifications
