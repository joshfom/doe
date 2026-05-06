# Requirements Document

## Introduction

Pages Approval Draft Preview enhances the existing Content Approval Workflow for the Pages module by introducing pending draft storage, reviewer preview/compare capabilities, and commit-on-approval semantics. Currently, when a page editor saves changes and triggers approval, the edits are written directly to the live page data. This enhancement ensures that while approval is active for pages, edits are stored as a pending draft that does not overwrite the live/published content. The live version remains untouched until all approvers approve, at which point the pending draft is committed as the new live version. Reviewers gain the ability to preview the pending version and compare it against the current live version. For demonstration purposes, any employee can approve (no strict approver-role enforcement). Rejection requires a reason that is prominently displayed to the submitter.

## Glossary

- **Pending_Draft**: A snapshot of page data (Puck JSON) stored separately from the live page data, representing proposed changes that have not yet been approved.
- **Live_Data**: The current published or draft page data stored in the `pages.data` column that is served to the public site and displayed in the editor.
- **Draft_Preview**: A read-only rendering of the Pending_Draft data that allows reviewers to see what the page will look like if approved.
- **Live_Preview**: A read-only rendering of the current Live_Data for comparison purposes.
- **Commit_On_Approval**: The process of replacing Live_Data with Pending_Draft data when all required approvals are granted.
- **Rejection_Reason**: A mandatory text comment provided by a reviewer when rejecting a pending draft, explaining why the changes were not approved.
- **Page_Editor**: The Puck-based visual page builder used to edit page content in the admin panel.
- **Approval_Request**: An existing record in the approval system that tracks the review status of submitted content (extended here to reference pending draft data).
- **Reviewer**: Any employee user who can view pending drafts and submit approval or rejection decisions.

## Requirements

### Requirement 1: Pending Draft Storage

**User Story:** As a page editor, I want my changes to be stored as a pending draft when approval is active, so that the live page content remains unchanged until my edits are approved.

#### Acceptance Criteria

1. WHEN approval is enabled for the Pages module and a user saves page content, THE Page_Editor SHALL store the updated page data as a Pending_Draft on the Approval_Request record instead of overwriting the Live_Data in the pages table.
2. WHILE a Pending_Draft exists for a page, THE Page_Editor SHALL continue to serve the Live_Data to the public-facing site and to the page detail view.
3. WHEN a user opens the Page_Editor for a page that has an active Pending_Draft, THE Page_Editor SHALL load the Pending_Draft data into the editor so the user can continue editing their proposed changes.
4. THE Pending_Draft SHALL store the complete Puck JSON data structure (identical schema to the `pages.data` column) on the `approvalRequests` table in a `pendingData` column.
5. IF a user saves changes to a page that already has a pending Approval_Request, THEN THE Page_Editor SHALL update the existing Pending_Draft data on that Approval_Request rather than creating a new request.
6. WHEN approval is disabled for the Pages module, THE Page_Editor SHALL save page data directly to the pages table as it does today without creating a Pending_Draft.

### Requirement 2: Approval Request Creation with Draft Data

**User Story:** As a page editor, I want the approval process to start when I click Publish with my pending changes attached, so that reviewers can see exactly what I want to publish.

#### Acceptance Criteria

1. WHEN a user clicks Publish on a page with approval enabled, THE Approval_Workflow SHALL create an Approval_Request with the current editor data stored as the Pending_Draft.
2. WHEN a user clicks Publish on a page that already has a pending Approval_Request, THE Approval_Workflow SHALL update the existing Pending_Draft data and retain the same Approval_Request rather than creating a duplicate.
3. THE Approval_Request SHALL set the page status to "pending_review" without modifying the Live_Data in the pages table.
4. WHEN an Approval_Request is created or updated with Pending_Draft data, THE Approval_Workflow SHALL record the submitter identifier and a timestamp.

### Requirement 3: Preview and Compare for Reviewers

**User Story:** As a reviewer, I want to preview the pending version of a page and compare it to the current live version, so that I can understand what changes are being proposed before I approve or reject.

#### Acceptance Criteria

1. WHILE an Approval_Request with a Pending_Draft exists for a page, THE Review_Interface SHALL provide a "Preview Pending" link that renders the Pending_Draft data in a read-only page view.
2. WHILE an Approval_Request with a Pending_Draft exists for a page, THE Review_Interface SHALL provide a "View Current Live" link that renders the current Live_Data in a read-only page view.
3. THE Draft_Preview SHALL render the Pending_Draft data using the same Puck page builder renderer used for the public site, displayed in a full-width read-only view.
4. THE Live_Preview SHALL render the Live_Data using the same Puck page builder renderer, displayed in a full-width read-only view.
5. THE Review_Interface SHALL display both preview links side by side on the page detail view and on the Review Dashboard, enabling reviewers to open each in a separate tab for comparison.

### Requirement 4: Commit on Approval

**User Story:** As a site owner, I want the pending draft to become the live page content only when all approvers approve, so that unapproved changes never appear on the public site.

#### Acceptance Criteria

1. WHEN all assigned approvers submit an "approved" decision for an Approval_Request, THE Approval_Workflow SHALL copy the Pending_Draft data into the `pages.data` column, replacing the previous Live_Data.
2. WHEN the Pending_Draft is committed to Live_Data, THE Approval_Workflow SHALL create a revision record capturing the previous Live_Data before overwriting it.
3. WHEN the Pending_Draft is committed to Live_Data, THE Approval_Workflow SHALL set the page status to "published" and record the `publishedAt` timestamp.
4. WHEN the Pending_Draft is committed to Live_Data, THE Approval_Workflow SHALL clear the Pending_Draft from the Approval_Request and set the request status to "approved".
5. WHILE an Approval_Request is pending, THE Approval_Workflow SHALL keep the Live_Data unchanged regardless of how many partial approvals have been received.

### Requirement 5: Rejection with Mandatory Reason

**User Story:** As a reviewer, I want to be required to provide a reason when rejecting a pending draft, so that the submitter understands why their changes were not approved.

#### Acceptance Criteria

1. WHEN a reviewer clicks Reject, THE Review_Interface SHALL display a dialog prompting for a rejection reason before submitting the decision.
2. THE Review_Interface SHALL prevent submission of a rejection decision if the reason field is empty or contains only whitespace.
3. WHEN a rejection decision is submitted with a reason, THE Approval_Workflow SHALL store the reason as the comment on the Approval_Decision record.
4. WHEN an Approval_Request is rejected, THE Approval_Workflow SHALL discard the Pending_Draft data (set it to null) and revert the page status to "draft".
5. WHEN a page has a rejected Approval_Request, THE Page_Detail_View SHALL prominently display the rejection reason with the reviewer name and timestamp so the submitter can see why their changes were rejected.

### Requirement 6: Any Employee Can Approve

**User Story:** As a project manager, I want any employee to be able to approve or reject pending page drafts for demonstration purposes, so that the approval flow can be tested without strict role enforcement.

#### Acceptance Criteria

1. THE Approval_Workflow SHALL allow any user with `userType` of "employee" to submit an approval or rejection decision on any pending Approval_Request for the Pages module.
2. THE Review_Dashboard SHALL display pending page Approval_Requests to all employee users, regardless of whether they are assigned as approvers in the Approval_Configuration.
3. THE Approval_Workflow SHALL still require the configured number of approvals (from the approver count in Approval_Configuration) before committing the Pending_Draft, but any employee can provide those approvals.

### Requirement 7: Editor Behavior During Pending Approval

**User Story:** As a page editor, I want to continue editing my pending draft while it is under review, so that I can refine my changes based on informal feedback without losing my work.

#### Acceptance Criteria

1. WHILE a page has a pending Approval_Request, THE Page_Editor SHALL load the Pending_Draft data (not the Live_Data) when the editor is opened.
2. WHEN a user saves in the Page_Editor while a pending Approval_Request exists, THE Page_Editor SHALL update the Pending_Draft data on the existing Approval_Request.
3. WHILE a page has a pending Approval_Request, THE Page_Editor SHALL display a banner indicating that changes are being saved to the pending draft and the live page is unchanged.
4. IF a user saves changes to the Pending_Draft after approvers have already submitted decisions, THEN THE Approval_Workflow SHALL reset all existing decisions and notify approvers that the draft has been updated and requires re-review.

### Requirement 8: API Endpoints for Draft Preview

**User Story:** As a frontend developer, I want API endpoints that serve pending draft data and live data separately, so that the preview UI can render both versions.

#### Acceptance Criteria

1. THE API SHALL expose a `GET /api/pages/:id/pending-draft` endpoint that returns the Pending_Draft data for a page if an active Approval_Request exists, or 404 if no pending draft exists.
2. THE API SHALL expose a `GET /api/pages/:id/live-data` endpoint that returns the current Live_Data from the pages table regardless of approval status.
3. WHEN the `GET /api/pages/:id/pending-draft` endpoint is called, THE API SHALL require authentication (any employee user).
4. THE API SHALL expose a `GET /api/pages/:id` endpoint that returns the page record including a `hasPendingDraft` boolean field indicating whether an active Pending_Draft exists.

