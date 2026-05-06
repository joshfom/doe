# Implementation Plan: Pages Approval Draft Preview

## Overview

Adds pending draft semantics to the Pages approval workflow so that edits during active approval are stored in `approvalRequests.pendingData` rather than overwriting `pages.data`. Implementation proceeds bottom-up: schema → services → API routes → hooks → UI, with property-based tests validating the 9 correctness properties from the design document.

## Tasks

- [x] 1. Database schema extension and migration
  - [x] 1.1 Add `pendingData` column to `approvalRequests` table in `lib/cms/schema.ts`
    - Add `pendingData: jsonb("pending_data")` column to the existing `approvalRequests` table definition
    - Column is nullable (null when no pending draft exists)
    - _Requirements: 1.4, 2.1_

  - [x] 1.2 Generate Drizzle migration
    - Run `npx drizzle-kit generate` to create the SQL migration file in `drizzle/`
    - Verify the generated migration includes the new `pending_data` column on `approval_requests`
    - _Requirements: 1.4_

- [x] 2. Core service modifications — Save routing and decision logic
  - [x] 2.1 Add helper functions for pending draft operations in `lib/cms/approval/service.ts`
    - Export `getActiveApprovalRequest(db, contentId, contentModule)` — returns the pending approval request for a page (if any)
    - Export `updatePendingData(db, requestId, data)` — updates `pendingData` on an existing approval request
    - Export `resetDecisions(db, requestId)` — deletes all existing `approvalDecisions` for a request (for re-review after re-edit)
    - Export `createApprovalRequestWithDraft(db, contentId, contentModule, submitterId, data)` — creates a new approval request with `pendingData` populated
    - _Requirements: 1.1, 1.5, 7.2, 7.4_

  - [x] 2.2 Modify `submitDecision` in `lib/cms/approval/service.ts` for commit-on-approval
    - On full approval: copy `pendingData` → `pages.data`, create a revision record with the previous `pages.data`, set page status to "published" with `publishedAt`, clear `pendingData` (set to null), set request status to "approved"
    - On rejection: set `pendingData` to null, revert page status to "draft", store rejection reason as decision comment
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.3, 5.4_

  - [x] 2.3 Write property test: Save-to-pending routing (Property 1)
    - **Property 1: Save-to-pending routing**
    - **Validates: Requirements 1.1, 1.5, 1.6, 2.1, 2.2, 2.3, 7.2**

  - [x] 2.4 Write property test: Live data invariant (Property 2)
    - **Property 2: Live data invariant**
    - **Validates: Requirements 1.2, 4.5, 8.2**

  - [x] 2.5 Write property test: Commit-on-approval (Property 5)
    - **Property 5: Commit-on-approval**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x] 2.6 Write property test: Rejection cleanup (Property 6)
    - **Property 6: Rejection cleanup**
    - **Validates: Requirements 5.4**

  - [x] 2.7 Write property test: Decision reset on re-edit (Property 8)
    - **Property 8: Decision reset on re-edit**
    - **Validates: Requirements 7.4**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. API route modifications and new endpoints
  - [x] 4.1 Modify `PUT /pages/:id` in `lib/cms/api/routes/pages.ts` to route saves to pending draft
    - Check if approval is enabled for "pages" module
    - If enabled and active approval request exists: update `pendingData` on existing request + reset decisions
    - If enabled and no active request exists: create new approval request with `pendingData`, set page status to "pending_review"
    - If disabled: save directly to `pages.data` (existing behavior)
    - Still create a revision record when saving directly (existing behavior preserved)
    - _Requirements: 1.1, 1.5, 1.6, 2.1, 2.2, 7.2, 7.4_

  - [x] 4.2 Add `GET /pages/:id/pending-draft` endpoint in `lib/cms/api/routes/pages.ts`
    - Requires authentication (any employee user via `authGuard`)
    - Returns `pendingData` from the active approval request for the page
    - Returns 404 if no active pending request with `pendingData` exists
    - _Requirements: 8.1, 8.3_

  - [x] 4.3 Add `GET /pages/:id/live-data` endpoint in `lib/cms/api/routes/pages.ts`
    - Requires authentication (any employee user via `authGuard`)
    - Returns the current `pages.data` regardless of approval status
    - _Requirements: 8.2_

  - [x] 4.4 Modify `GET /pages/:id` to include `hasPendingDraft` boolean
    - Query `approvalRequests` for an active pending request with non-null `pendingData` for this page
    - Include `hasPendingDraft: true/false` in the response
    - _Requirements: 8.4_

  - [x] 4.5 Modify `POST /approvals/:id/decide` in `lib/cms/api/routes/approvals.ts` for relaxed authorization
    - Allow any user with `userType = "employee"` to submit decisions on pages approval requests (not just assigned approvers)
    - Enforce mandatory non-empty, non-whitespace rejection reason (return 400 if invalid)
    - _Requirements: 5.2, 6.1, 6.2_

  - [x] 4.6 Write property test: Pending draft retrieval (Property 3)
    - **Property 3: Pending draft retrieval**
    - **Validates: Requirements 1.3, 7.1, 8.1, 8.4**

  - [x] 4.7 Write property test: Pending data round-trip (Property 4)
    - **Property 4: Pending data round-trip**
    - **Validates: Requirements 1.4**

  - [x] 4.8 Write property test: Rejection reason validation (Property 7)
    - **Property 7: Rejection reason validation**
    - **Validates: Requirements 5.2, 5.3**

  - [x] 4.9 Write property test: Any-employee authorization with threshold (Property 9)
    - **Property 9: Any-employee authorization with threshold**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. React Query hooks for pending draft
  - [x] 6.1 Add pending draft hooks to `lib/cms/hooks/use-approvals.ts`
    - Add `usePendingDraft(pageId)` — GET `/api/pages/:id/pending-draft`, returns pending data or undefined
    - Add `useLiveData(pageId)` — GET `/api/pages/:id/live-data`, returns current live page data
    - Add query keys: `approvalKeys.pendingDraft(pageId)` and `approvalKeys.liveData(pageId)`
    - _Requirements: 8.1, 8.2_

  - [x] 6.2 Export new hooks from `lib/cms/hooks/index.ts`
    - Add exports for `usePendingDraft` and `useLiveData`
    - _Requirements: 8.1, 8.2_

- [x] 7. UI — Page Editor modifications
  - [x] 7.1 Modify page editor at `app/ora-panel/pages/[id]/edit/page.tsx` to load pending draft
    - On mount, check if page has a pending draft (via `usePendingDraft` hook or `hasPendingDraft` from page detail)
    - If pending draft exists: load `pendingData` into the Puck editor instead of `pages.data`
    - Display a banner: "Changes are saved to pending draft — live page is unchanged"
    - Save button continues to use `PUT /pages/:id` (which now routes to pendingData server-side)
    - _Requirements: 1.3, 7.1, 7.2, 7.3_

- [x] 8. UI — Preview pages and review interface
  - [x] 8.1 Create preview-pending page at `app/ora-panel/pages/[id]/preview-pending/page.tsx`
    - Fetch pending draft data via `GET /pages/:id/pending-draft`
    - Render using the Puck `<Render>` component in a full-width read-only view
    - Show "Preview: Pending Draft" header with link back to page detail
    - _Requirements: 3.1, 3.3_

  - [x] 8.2 Create preview-live page at `app/ora-panel/pages/[id]/preview-live/page.tsx`
    - Fetch live data via `GET /pages/:id/live-data`
    - Render using the Puck `<Render>` component in a full-width read-only view
    - Show "Preview: Current Live" header with link back to page detail
    - _Requirements: 3.2, 3.4_

  - [x] 8.3 Add preview links to page detail view at `app/ora-panel/pages/[id]/page.tsx`
    - When `hasPendingDraft` is true, show "Preview Pending" and "View Current Live" links side by side
    - Links open in new tabs targeting the preview-pending and preview-live pages
    - _Requirements: 3.5_

  - [x] 8.4 Add preview links to Review Dashboard at `app/ora-panel/reviews/page.tsx`
    - For pages module items with pending drafts, add "Preview Pending" and "View Live" action links
    - _Requirements: 3.5_

  - [x] 8.5 Modify `ApprovalActions` component at `lib/cms/components/ApprovalActions.tsx` for rejection reason enforcement
    - Add a rejection dialog/modal that requires a non-empty reason before submitting
    - Disable the "Reject" submit button when reason is empty or whitespace-only
    - Display rejection reason prominently when a request has been rejected (reviewer name + timestamp + reason)
    - _Requirements: 5.1, 5.2, 5.5_

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Integration wiring and final verification
  - [x] 10.1 Modify publication gate at `lib/cms/approval/gate.ts` to store pendingData on request creation
    - When `checkPublicationGate` creates an approval request, accept and store the page data as `pendingData` on the new request
    - Pass the current editor data through from the publish endpoint
    - _Requirements: 2.1, 2.4_

  - [x] 10.2 Modify `POST /pages/:id/publish` to pass current data to the publication gate
    - Before calling `checkPublicationGate`, read the current `pages.data` (or the body data if provided)
    - Pass it to the gate so it can be stored as `pendingData` on the approval request
    - _Requirements: 2.1, 2.3_

  - [x] 10.3 Modify `usePendingApprovals` or Review Dashboard to show all pending pages requests to any employee
    - Ensure the `GET /api/approvals/pending` endpoint returns pages approval requests for all employees (not just assigned approvers)
    - _Requirements: 6.2_

  - [x] 10.4 Wire decision reset notification — when decisions are reset after re-edit, log an audit entry
    - When `resetDecisions` is called, log `approval_decide` audit entry noting decisions were reset
    - _Requirements: 7.4_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- The `pendingData` column is the critical schema change — all other features depend on it
- The save-routing logic in `PUT /pages/:id` is the key enforcement point for draft isolation
- Commit-on-approval in `submitDecision` must be atomic (within a transaction) to prevent partial commits
- The relaxed authorization (any employee can approve) is scoped to the pages module for demo purposes
