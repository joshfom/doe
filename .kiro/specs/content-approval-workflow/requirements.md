# Requirements Document

## Introduction

Content Approval Workflow adds a gating layer to Ora CMS so that no content (pages, blog posts, news articles, or construction updates) can go live without explicit sign-off from designated approvers. Administrators configure which modules require approval and assign up to N approvers per module in Application Settings. When approval is enabled for a module, every save or publish action routes the content into a "pending review" queue and notifies all assigned approvers by email. Content remains unpublished until the required approvals are granted.

## Glossary

- **Approval_Workflow**: The end-to-end process by which content changes are submitted, reviewed, and either approved or rejected before publication.
- **Approver**: A registered User who has been designated in Application Settings to review and approve content changes for a given module.
- **Content_Module**: A distinct content type managed by Ora CMS. Current modules are: Pages, Blog, News, and Construction Updates.
- **Approval_Configuration**: The per-module settings that control whether approval is required and which Users are assigned as approvers.
- **Pending_Review**: The status assigned to content that has been submitted for approval but has not yet received the required sign-off.
- **Approval_Request**: A record created when content is submitted for review, tracking the content item, the submitter, and the approval decisions from each Approver.
- **Approval_Decision**: An individual Approver's response to an Approval_Request — either "approved" or "rejected", with an optional comment.
- **Submitter**: The User who initiates a content change that triggers the Approval_Workflow.
- **Notification_Service**: The component responsible for sending email notifications to Approvers and Submitters.
- **Review_Dashboard**: The admin panel view where Approvers can see all Approval_Requests assigned to them and take action.

## Requirements

### Requirement 1: Per-Module Approval Toggle

**User Story:** As an administrator, I want to enable or disable approval requirements independently for each content module, so that I can control which types of content require sign-off before publishing.

#### Acceptance Criteria

1. THE Approval_Configuration SHALL provide a boolean toggle for each Content_Module (Pages, Blog, News, Construction Updates) that controls whether approval is required.
2. WHEN an administrator disables approval for a Content_Module, THE Approval_Configuration SHALL allow content in that module to be published directly without review.
3. WHEN an administrator enables approval for a Content_Module, THE Approval_Configuration SHALL require all content changes in that module to pass through the Approval_Workflow before publication.
4. THE Approval_Configuration SHALL persist toggle state across browser sessions by storing the value in the database.

### Requirement 2: Approver Assignment

**User Story:** As an administrator, I want to assign multiple users as approvers for each content module, so that the right people review content before it goes live.

#### Acceptance Criteria

1. THE Approval_Configuration SHALL allow an administrator to assign one or more registered Users as Approvers for each Content_Module.
2. WHEN an administrator assigns Approvers, THE Approval_Configuration SHALL accept a minimum of one and a maximum configurable number of Approvers per Content_Module.
3. THE Approval_Configuration SHALL only allow selection of Users who exist in the users table.
4. WHEN an administrator removes an Approver from a Content_Module, THE Approval_Configuration SHALL retain existing Approval_Requests that were assigned to that Approver but exclude the removed Approver from future Approval_Requests.
5. THE Approval_Configuration SHALL display the currently assigned Approvers for each Content_Module in the Application Settings page.

### Requirement 3: Content Submission for Review

**User Story:** As a content editor, I want my changes to be automatically submitted for review when approval is enabled, so that content follows the approval process without extra manual steps.

#### Acceptance Criteria

1. WHEN a Submitter saves or publishes content in a Content_Module that has approval enabled, THE Approval_Workflow SHALL create an Approval_Request and set the content status to Pending_Review.
2. WHEN a Submitter saves content in a Content_Module that has approval disabled, THE Approval_Workflow SHALL allow the content to be saved or published directly without creating an Approval_Request.
3. THE Approval_Request SHALL record the content item identifier, the Content_Module type, the Submitter identifier, and a timestamp.
4. WHILE content is in Pending_Review status, THE Approval_Workflow SHALL prevent the content from being visible on the public-facing site.
5. WHILE content is in Pending_Review status, THE Approval_Workflow SHALL display a "Pending Review" badge on the content item in the admin panel listing.

### Requirement 4: Email Notification to Approvers

**User Story:** As an approver, I want to receive an email notification when content is submitted for my review, so that I can act on pending reviews promptly.

#### Acceptance Criteria

1. WHEN an Approval_Request is created, THE Notification_Service SHALL send an email to each Approver assigned to the corresponding Content_Module.
2. THE Notification_Service SHALL include the content title, the Content_Module name, the Submitter name, and a direct link to the review page in the email body.
3. IF the Notification_Service fails to deliver an email, THEN THE Notification_Service SHALL log the failure with the Approver email address and the Approval_Request identifier.
4. WHEN an Approval_Request is resolved (approved or rejected), THE Notification_Service SHALL send a result email to the Submitter indicating the outcome.

### Requirement 5: Approval and Rejection Actions

**User Story:** As an approver, I want to approve or reject content with an optional comment, so that content editors receive clear feedback on their submissions.

#### Acceptance Criteria

1. WHEN an Approver reviews an Approval_Request, THE Approval_Workflow SHALL allow the Approver to submit an Approval_Decision of "approved" or "rejected".
2. THE Approval_Decision SHALL optionally include a text comment from the Approver.
3. WHEN all assigned Approvers for an Approval_Request submit an "approved" decision, THE Approval_Workflow SHALL change the content status from Pending_Review to published.
4. WHEN any Approver submits a "rejected" decision, THE Approval_Workflow SHALL change the content status from Pending_Review to draft and record the rejection reason.
5. THE Approval_Decision SHALL record the Approver identifier, the decision value, the optional comment, and a timestamp.
6. WHILE an Approval_Request is pending, THE Approval_Workflow SHALL display the current approval progress (e.g., "2 of 4 approved") on the content detail page.

### Requirement 6: Review Dashboard

**User Story:** As an approver, I want a centralized view of all content awaiting my review, so that I can efficiently manage my approval queue.

#### Acceptance Criteria

1. THE Review_Dashboard SHALL display a list of all Approval_Requests in Pending_Review status that are assigned to the currently logged-in Approver.
2. THE Review_Dashboard SHALL display the content title, Content_Module type, Submitter name, and submission date for each Approval_Request.
3. WHEN an Approver selects an Approval_Request from the Review_Dashboard, THE Review_Dashboard SHALL navigate to the content detail page where the Approver can view the content and submit an Approval_Decision.
4. THE Review_Dashboard SHALL indicate the approval progress for each Approval_Request (number of approvals received versus total required).
5. THE Review_Dashboard SHALL be accessible from the admin panel navigation at the path /ora-panel/reviews.

### Requirement 7: Approval Audit Trail

**User Story:** As an administrator, I want a complete audit trail of all approval actions, so that I can track who approved or rejected content and when.

#### Acceptance Criteria

1. WHEN an Approval_Decision is submitted, THE Approval_Workflow SHALL create an entry in the audit log with the Approver identifier, the decision value, the Approval_Request identifier, and a timestamp.
2. WHEN an Approval_Request status changes (created, approved, rejected), THE Approval_Workflow SHALL create an audit log entry recording the status transition.
3. THE Approval_Workflow SHALL make the approval history viewable on the content detail page, showing each Approval_Decision with the Approver name, decision, comment, and timestamp.

### Requirement 8: Publication Gate Enforcement

**User Story:** As a site owner, I want to guarantee that no content goes live without approval when approval is enabled, so that all published content has been vetted.

#### Acceptance Criteria

1. WHILE approval is enabled for a Content_Module, THE Approval_Workflow SHALL intercept all publish actions and route content through the Approval_Request process.
2. WHILE approval is enabled for a Content_Module, THE Approval_Workflow SHALL reject any direct status change from draft to published that bypasses the Approval_Request process.
3. WHEN approval is disabled for a Content_Module, THE Approval_Workflow SHALL allow direct publishing without creating an Approval_Request.
4. IF a Content_Module's approval setting is changed from disabled to enabled, THEN THE Approval_Workflow SHALL apply the approval requirement only to future publish actions and leave already-published content unchanged.
5. IF a Content_Module's approval setting is changed from enabled to disabled, THEN THE Approval_Workflow SHALL auto-resolve any Pending_Review Approval_Requests for that module by changing their status to the content's previous status (draft).
