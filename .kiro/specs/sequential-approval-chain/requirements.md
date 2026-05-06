# Requirements Document

## Introduction

Sequential Approval Chain transforms the existing flat approval model (where all configured approvers can approve in any order) into a sequential, hierarchical "chain of command" model for the Pages module. In the current system, the `approvalConfigApprovers` table stores approvers without order, and the `submitDecision` function checks whether the total count of approvals meets the threshold. This feature introduces ordered approvers that define the chain structure and flow — the request advances step-by-step through the chain, any rejection immediately terminates the entire request (cascading rejection), and the pending draft is committed only when the final step is approved.

**Demo mode authorization**: For demonstration purposes, any logged-in employee can approve or reject at any step in the chain (not restricted to the specific named approver at that position). The chain defines the *structure, visibility, and flow* (which step we're on, who is "responsible"), but the actual action can be performed by any employee. This will be tightened to strict approver enforcement in a future iteration.

## Glossary

- **Approval_Chain**: An ordered sequence of approvers configured for a content module, where each approver has a specific position (1st, 2nd, 3rd, etc.) that determines the sequential flow of review.
- **Chain_Position**: A 1-based integer representing an approver's place in the Approval_Chain sequence.
- **Current_Step_Approver**: The approver whose Chain_Position matches the current step — the person nominally responsible for review at this stage. In demo mode, any employee can act on their behalf.
- **Chain_Step**: The current position in the Approval_Chain that the approval request has reached, indicating which step is active.
- **Cascading_Rejection**: The behavior where a rejection at any step in the chain immediately terminates the entire approval request, preventing subsequent steps from ever being reached.
- **Approval_Request**: A record tracking the review status of submitted content, extended here with a `currentStep` field to track progress through the Approval_Chain.
- **Pending_Draft**: A snapshot of page data (Puck JSON) stored on the Approval_Request, representing proposed changes awaiting sequential approval.
- **Final_Step**: The last Chain_Position in the Approval_Chain, whose approval triggers the commit of the Pending_Draft to live content.
- **Approval_Service**: The backend service (`lib/cms/approval/service.ts`) responsible for processing approval decisions and managing request state transitions.
- **Settings_UI**: The Content Approval configuration section in the admin panel (`app/ora-panel/settings/page.tsx`) where approvers are configured and reordered.
- **Notification_Service**: The system responsible for sending email notifications to approvers when action is required.

## Requirements

### Requirement 1: Ordered Approver Configuration with Drag-and-Drop

**User Story:** As an administrator, I want to arrange approvers in a specific sequence via drag-and-drop when configuring the approval chain, so that the approval order reflects our organizational hierarchy.

#### Acceptance Criteria

1. THE Settings_UI SHALL display configured approvers as a vertical ordered list with visible position numbers (1, 2, 3, etc.) and drag handles.
2. THE Settings_UI SHALL allow administrators to reorder approvers via drag-and-drop, updating Chain_Position values in real-time as items are moved.
3. WHEN an administrator adds an approver to the Approval_Chain, THE Settings_UI SHALL assign the new approver the next available Chain_Position (appended to the end of the chain).
4. WHEN an administrator saves the approval configuration, THE Approval_Service SHALL persist each approver's Chain_Position as an integer column (`position`) on the `approvalConfigApprovers` table.
5. THE `approvalConfigApprovers` table SHALL enforce that Chain_Position values are unique within a given configuration (no two approvers share the same position for the same `configId`).
6. WHEN an administrator removes an approver from the middle of the chain, THE Settings_UI SHALL re-number the remaining approvers to maintain a contiguous sequence starting from 1.
7. THE Settings_UI SHALL display a visual chain/flowchart indicator showing the approval flow direction (e.g., arrows between approver cards).

### Requirement 2: Sequential Approval Flow

**User Story:** As a content submitter, I want my approval request to flow through the chain one step at a time in the configured order, so that each level of authority reviews the content before it reaches the next.

#### Acceptance Criteria

1. WHEN an Approval_Request is created for the Pages module, THE Approval_Service SHALL set the initial Chain_Step to 1, indicating the first position in the chain is active.
2. WHEN an employee submits an "approved" decision for the current step, THE Approval_Service SHALL advance the Chain_Step to the next position in the Approval_Chain.
3. WHILE the Chain_Step has not reached the Final_Step, THE Approval_Service SHALL keep the Approval_Request in "pending" status after each intermediate approval.
4. WHEN an employee submits an "approved" decision at the Final_Step, THE Approval_Service SHALL commit the Pending_Draft to live content, set the request status to "approved", and follow existing commit-on-approval semantics (create revision, set page status to "published", clear pendingData).
5. THE Approval_Service SHALL record each decision with the Chain_Step at which it was made, preserving the audit trail of sequential approvals.
6. THE Approval_Request table SHALL store the `currentStep` as an integer column, defaulting to 1 when the request is created.

### Requirement 3: Current Step Notification

**User Story:** As an approver, I want to be notified when the chain reaches my step, so that I know it is time for me to review.

#### Acceptance Criteria

1. WHEN an Approval_Request is created, THE Notification_Service SHALL notify the approver at Chain_Position 1 (the first approver in the chain).
2. WHEN the Chain_Step advances to a new position, THE Notification_Service SHALL notify the approver at that new Chain_Position.
3. THE Notification_Service SHALL include the content title, submitter name, and the step position in the chain (e.g., "Step 2 of 3") in the notification.
4. THE Notification_Service SHALL not notify approvers whose Chain_Position has not yet been reached.

### Requirement 4: Relaxed Authorization (Demo Mode)

**User Story:** As a project manager, I want any logged-in employee to be able to approve or reject at any step in the chain for demonstration purposes, so that the approval flow can be tested without requiring specific people to be available.

#### Acceptance Criteria

1. THE Approval_Service SHALL allow any user with `userType = "employee"` to submit an approval or rejection decision at the current Chain_Step, regardless of whether they are the named approver at that position.
2. THE Review_Dashboard SHALL display the approval request to all employee users, showing the current chain step and who is nominally responsible.
3. THE Review_Dashboard SHALL enable the approve/reject actions for any employee when the request is at a pending step.
4. THE Review_Dashboard SHALL display the current chain progress (e.g., "Step 2 of 3 — Nominally: [Approver Name]") to all viewers of the request.
5. THE Approval_Service SHALL record which employee actually submitted the decision (not necessarily the named approver), preserving an accurate audit trail.

### Requirement 5: Cascading Rejection

**User Story:** As a content governance manager, I want a rejection at any step in the chain to immediately terminate the entire request, so that content that fails review at any level does not proceed further.

#### Acceptance Criteria

1. WHEN an employee submits a "rejected" decision at any Chain_Step, THE Approval_Service SHALL immediately set the Approval_Request status to "rejected" regardless of the current Chain_Step position.
2. WHEN an Approval_Request is rejected, THE Approval_Service SHALL clear the Pending_Draft (set pendingData to null) and revert the page status to "draft".
3. WHEN an Approval_Request is rejected, THE Notification_Service SHALL notify the original submitter with the rejection reason and the name of the rejecting employee.
4. WHEN an Approval_Request is rejected at a step before the Final_Step, subsequent steps in the chain are never reached — the chain terminates.
5. THE Approval_Service SHALL store the rejection reason as a mandatory comment on the decision record (existing rejection-reason-required behavior is preserved).

### Requirement 6: Chain Progress Visibility (Flowchart UI)

**User Story:** As a content submitter, I want to see a visual flowchart showing how far my request has progressed through the approval chain, so that I know which step is active and how many remain.

#### Acceptance Criteria

1. THE Page_Detail_View SHALL display the full Approval_Chain as a vertical flowchart/stepper with each approver's name, Chain_Position, and current status.
2. THE Page_Detail_View SHALL visually distinguish completed steps (green/checkmark), the current active step (highlighted/pulsing), and future steps (greyed out).
3. FOR completed steps, THE Page_Detail_View SHALL show the name of the employee who actually approved, the timestamp, and any comment.
4. WHEN an Approval_Request is fully approved, THE Page_Detail_View SHALL show all chain steps as completed with their respective timestamps.
5. WHEN an Approval_Request is rejected, THE Page_Detail_View SHALL show completed steps up to the rejecting step (marked red/X), with subsequent steps shown as skipped/greyed.

### Requirement 7: Re-edit and Decision Reset

**User Story:** As a page editor, I want to be able to update my pending draft while it is under review, with the understanding that all progress through the chain resets and review starts over from step 1.

#### Acceptance Criteria

1. IF a user saves changes to the Pending_Draft after one or more steps have been approved, THEN THE Approval_Service SHALL delete all existing decisions for that Approval_Request.
2. WHEN decisions are reset due to a re-edit, THE Approval_Service SHALL reset the Chain_Step back to 1, restarting the sequential flow from the first step.
3. WHEN decisions are reset due to a re-edit, THE Notification_Service SHALL notify the approver at Chain_Position 1 that the draft has been updated and requires re-review.
4. THE Page_Editor SHALL display a warning to the submitter indicating that saving changes will reset all approval progress and restart the chain from step 1.

### Requirement 8: Approval Chain API

**User Story:** As a frontend developer, I want API endpoints that expose the chain configuration and current progress, so that the UI can render the sequential approval state as a flowchart.

#### Acceptance Criteria

1. THE API SHALL expose the approval chain configuration (ordered list of approvers with positions) via the existing `GET /api/approval-config` endpoint, including a `position` field for each approver sorted by position.
2. THE API SHALL expose the current Chain_Step and chain progress via the existing `GET /api/approvals/content/:module/:contentId` endpoint, including which step is current, the decision history in chain order, and the total number of steps.
3. WHEN the `POST /api/approvals/:id/decide` endpoint is called, THE API SHALL verify the user is an employee (demo mode) and that the request is at a pending step before processing the decision.
4. THE API SHALL return the chain progress in a format suitable for rendering a flowchart/stepper UI (ordered steps with status, approver name, actual decider name, timestamp, comment).
