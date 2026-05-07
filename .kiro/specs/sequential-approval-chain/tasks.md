# Implementation Plan: Sequential Approval Chain

## Overview

Transform the existing flat approval model into a sequential, step-by-step "chain of command" for the Pages module. Implementation follows bottom-up order: schema changes → service logic → API routes → hooks → UI components. Each step builds on the previous, with property-based tests validating correctness properties from the design.

## Tasks

- [x] 1. Schema changes and migration
  - [x] 1.1 Add `position` column to `approvalConfigApprovers` table in `lib/cms/schema.ts`
    - Add `position: integer("position").notNull().default(0)` column
    - Add unique index `approval_config_approvers_position_idx` on `(configId, position)`
    - _Requirements: 1.4, 1.5_

  - [x] 1.2 Add `currentStep` column to `approvalRequests` table in `lib/cms/schema.ts`
    - Add `currentStep: integer("current_step").notNull().default(1)` column
    - _Requirements: 2.1, 2.6_

  - [x] 1.3 Add `chainStep` column to `approvalDecisions` table and update unique index in `lib/cms/schema.ts`
    - Add `chainStep: integer("chain_step")` column (nullable)
    - Replace existing unique index to include `chainStep`: `(requestId, approverId, chainStep)`
    - _Requirements: 2.5_

  - [x] 1.4 Generate Drizzle migration for all schema changes
    - Run `npx drizzle-kit generate` to produce the SQL migration file
    - Verify migration SQL matches the design: ALTER TABLE statements for all three tables, DROP and CREATE INDEX for the updated unique constraint
    - _Requirements: 1.4, 1.5, 2.6_

- [x] 2. Position utility functions
  - [x] 2.1 Create `lib/cms/approval/positions.ts` with pure position management functions
    - Implement `reorderPositions(items, fromIndex, toIndex)` — move item and return new contiguous 1-based positions
    - Implement `removeAndRenumber(items, removeIndex)` — remove item and re-number remaining from 1
    - Implement `appendApprover(items, userId)` — append new item at position N+1
    - All functions return `{ userId: string; position: number }[]`
    - _Requirements: 1.2, 1.3, 1.6_

  - [x] 2.2 Write property test for position integrity (Property 1)
    - **Property 1: Position integrity after reorder, add, and remove**
    - Generate random approver lists (1–10 items), apply random mutations (reorder, add, remove), verify contiguous 1-based positions with no gaps or duplicates and correct set membership
    - **Validates: Requirements 1.2, 1.3, 1.6**

- [x] 3. Checkpoint — Verify schema and position utilities
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Modify approval service for sequential flow
  - [x] 4.1 Modify `submitDecision` in `lib/cms/approval/service.ts` for sequential step advancement
    - Insert decision with `chainStep: request.currentStep`
    - On rejection: set status to "rejected", clear pendingData, revert page to draft (existing behavior preserved)
    - On approval at intermediate step (currentStep < totalSteps): increment `currentStep`, keep status "pending"
    - On approval at final step (currentStep >= totalSteps): commit pendingData → pages.data, create revision, set status "approved", clear pendingData (existing commit-on-approval semantics)
    - Use row-level lock on approvalRequests within transaction to prevent race conditions
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 5.1, 5.2_

  - [x] 4.2 Modify `resetDecisions` in `lib/cms/approval/service.ts` to also reset `currentStep` to 1
    - After deleting all decisions, update `approvalRequests.currentStep` to 1
    - _Requirements: 7.1, 7.2_

  - [x] 4.3 Modify `createApprovalRequestWithDraft` to explicitly set `currentStep: 1`
    - Add `currentStep: 1` to the insert values
    - _Requirements: 2.1, 2.6_

  - [x] 4.4 Modify `getApprovalProgress` in `lib/cms/approval/service.ts` for chain-aware response
    - Fetch ordered approvers with positions from `approvalConfigApprovers` joined with `users`
    - Include `currentStep`, `totalSteps`, `chain` (ordered approver list), and decisions with `chainStep` in response
    - _Requirements: 8.2, 8.4_

  - [x] 4.5 Write property test for initial step (Property 3)
    - **Property 3: Initial step is always 1**
    - Generate random content submissions, verify `currentStep = 1` on created requests
    - **Validates: Requirements 2.1, 2.6**

  - [x] 4.6 Write property test for intermediate approval (Property 4)
    - **Property 4: Intermediate approval advances step without resolving**
    - Generate chains of length 2–10, approve at various intermediate steps, verify `currentStep` increments and status stays "pending"
    - **Validates: Requirements 2.2, 2.3**

  - [x] 4.7 Write property test for final step approval (Property 5)
    - **Property 5: Final step approval commits pending draft**
    - Generate chains of various lengths, advance to final step, approve, verify commit semantics (pendingData → pages.data, revision created, status = approved)
    - **Validates: Requirements 2.4**

  - [x] 4.8 Write property test for decision chain step recording (Property 6)
    - **Property 6: Decision records the chain step**
    - Generate decisions at various steps, verify `chainStep` field matches the step at submission time
    - **Validates: Requirements 2.5, 4.5**

  - [x] 4.9 Write property test for cascading rejection (Property 7)
    - **Property 7: Cascading rejection terminates and cleans up**
    - Generate chains of various lengths, reject at random steps, verify status = "rejected", pendingData = null, page status = "draft"
    - **Validates: Requirements 5.1, 5.2, 5.4**

  - [x] 4.10 Write property test for rejection reason validation (Property 8)
    - **Property 8: Rejection reason validation**
    - Generate whitespace-only strings and valid non-whitespace strings, verify rejection/acceptance behavior
    - **Validates: Requirements 5.5**

  - [x] 4.11 Write property test for re-edit reset (Property 9)
    - **Property 9: Re-edit resets all decisions and step**
    - Generate requests with 1–5 existing decisions at various steps, trigger re-edit, verify all decisions deleted and `currentStep = 1`
    - **Validates: Requirements 7.1, 7.2**

  - [x] 4.12 Write property test for employee authorization (Property 10)
    - **Property 10: Employee authorization**
    - Generate users with various `userType` values, verify only employees can submit decisions and their ID is recorded
    - **Validates: Requirements 4.1, 4.5, 8.3**

- [x] 5. Checkpoint — Verify service logic and property tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Notification service for step-based notifications
  - [x] 6.1 Add `notifyApproverAtStep` function in `lib/cms/approval/notifications.ts`
    - Look up the approver at the given chain position for the content module
    - Send notification email with content title, submitter name, and step context ("Step X of Y")
    - Catch and log notification failures without blocking the approval workflow
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 6.2 Integrate `notifyApproverAtStep` into `submitDecision` and `createApprovalRequestWithDraft`
    - Call `notifyApproverAtStep` when request is created (notify step 1 approver)
    - Call `notifyApproverAtStep` when step advances (notify next step approver)
    - Call `notifyApproverAtStep` in `resetDecisions` flow (notify step 1 approver after re-edit)
    - _Requirements: 3.1, 3.2, 7.3_

- [x] 7. Modify approval API routes
  - [x] 7.1 Update `GET /approvals/content/:module/:contentId` response in `lib/cms/api/routes/approvals.ts`
    - Include `currentStep`, `totalSteps`, `chain` (ordered approvers), and decisions with `chainStep` in response
    - _Requirements: 8.2, 8.4_

  - [x] 7.2 Update approval config API to persist positions
    - Modify `PUT /api/approval-config` to accept and persist `position` for each approver
    - Validate positions are contiguous 1-based integers; normalize if non-contiguous
    - Return approvers sorted by position in `GET /api/approval-config`
    - _Requirements: 1.4, 8.1_

  - [x] 7.3 Write property test for configuration round-trip (Property 2)
    - **Property 2: Configuration position round-trip**
    - Generate random ordered approver lists, save via API, read back, verify identical order and positions
    - **Validates: Requirements 1.4, 8.1**

  - [x] 7.4 Write property test for API response completeness (Property 11)
    - **Property 11: API chain progress response completeness**
    - Generate requests at various chain positions with various decision histories, verify response shape includes `currentStep`, `totalSteps`, `chain` array of correct length sorted by position, and `decisions` array with `chainStep` fields
    - **Validates: Requirements 8.2, 8.4**

- [x] 8. Checkpoint — Verify API routes and integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Settings UI with drag-and-drop reordering
  - [x] 9.1 Install `@dnd-kit/core` and `@dnd-kit/sortable` packages
    - Add exact versions to dependencies in `package.json`
    - _Requirements: 1.2_

  - [x] 9.2 Create `OrderedApproverList` component with drag-and-drop
    - Create component at appropriate location under the settings UI
    - Display approvers as vertical ordered list with visible position numbers (1, 2, 3, ...)
    - Add drag handles on each approver card
    - Show visual flow arrows between approver cards indicating approval direction
    - On drag end: call `reorderPositions` and update local state
    - On remove: call `removeAndRenumber` and update local state
    - On add: call `appendApprover` and update local state
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

  - [x] 9.3 Integrate `OrderedApproverList` into `ContentApprovalSection` in settings page
    - Replace existing approver picker with the new ordered list component
    - Wire `handleSaveModule` to send ordered approvers with positions to the API
    - _Requirements: 1.2, 1.4_

  - [x] 9.4 Write unit tests for Settings UI drag-and-drop behavior
    - Test that position numbers render correctly
    - Test that drag-and-drop reorder updates local state
    - Test that remove from middle re-numbers remaining approvers
    - Test that flow arrows render between approver cards
    - _Requirements: 1.1, 1.2, 1.6, 1.7_

- [ ] 10. Approval Chain Stepper component (flowchart progress UI)
  - [x] 10.1 Create `ApprovalChainStepper` component at `lib/cms/components/ApprovalChainStepper.tsx`
    - Accept props: `chain`, `decisions`, `currentStep`, `totalSteps`, `requestStatus`
    - Render vertical flowchart/stepper with each approver's name, position, and status
    - Visual states: completed (green checkmark), active (highlighted/pulsing), future (greyed out), rejected (red X), skipped (greyed with strikethrough)
    - For completed steps: show actual approver name, timestamp, and comment
    - For rejected step: show rejection reason and rejecting employee name
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [-] 10.2 Integrate `ApprovalChainStepper` into page detail view (`app/ora-panel/pages/[id]/page.tsx`)
    - Fetch chain progress data from `GET /approvals/content/pages/:contentId`
    - Render the stepper component showing current chain state
    - Show "Step X of Y — Nominally: [Approver Name]" format for active step
    - _Requirements: 6.1, 6.2, 4.2, 4.4_

  - [x] 10.3 Add re-edit warning in page editor when pending approval exists
    - Display warning message indicating that saving changes will reset all approval progress and restart the chain from step 1
    - _Requirements: 7.4_

  - [x] 10.4 Write unit tests for `ApprovalChainStepper` visual states
    - Test completed steps show green checkmark with approver name and timestamp
    - Test active step shows highlighted state with nominal approver
    - Test future steps show greyed out state
    - Test rejected step shows red X with reason
    - Test skipped steps after rejection show greyed with strikethrough
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 11. Final checkpoint — Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after major sections
- Property tests validate the 11 correctness properties defined in the design document using `fast-check` and `pg-mem`
- The implementation uses TypeScript throughout, consistent with the existing codebase
- Existing commit-on-approval semantics from pages-approval-draft-preview are preserved and extended
- Demo mode authorization (any employee can approve) is maintained per Requirements 4.x
