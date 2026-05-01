# Requirements Document

## Introduction

The Support Ticketing System adds a lead-oriented support ticket module to the Ora platform. Tickets represent inbound inquiries from leads or customers — created manually by Ora employees, programmatically via an API (enabling AI chat agents to create tickets hands-free), or through a public-facing submission form. Each ticket follows a defined lifecycle (Open → Assigned → In Progress → Resolved → Closed) with status transitions enforced by the system. The module integrates with the existing RBAC permission model, sends transactional email notifications on key events, and synchronizes ticket data to external CRMs through a pluggable adapter layer (Salesforce first, with the ability to swap or add HubSpot, Zoho, and others). Phase 2 will embed an autonomous AI digital employee for intelligent routing, auto-categorization, and chat-to-ticket automation — this requirements document covers the Phase 1 foundation.

## Glossary

- **Ticketing_System**: The core module responsible for ticket creation, lifecycle management, assignment, and querying within the Ora platform.
- **Ticket**: A record representing an inbound support inquiry from a lead or customer. Each ticket has a unique human-readable ticket number, a status, a priority, a category, contact information, and a description of the issue.
- **Ticket_Number**: A unique, human-readable identifier for a ticket, formatted as `ORA-XXXXXX` where X is a zero-padded sequential integer (e.g., ORA-000001). This number is shared with the contact and used for external reference.
- **Ticket_Status**: The current lifecycle state of a ticket. Valid values are "open", "assigned", "in_progress", "resolved", and "closed".
- **Ticket_Priority**: The urgency level of a ticket. Valid values are "low", "medium", "high", and "urgent".
- **Ticket_Category**: A classification label for the ticket's subject area (e.g., "billing", "technical", "general_inquiry", "sales", "complaint"). Categories are configurable.
- **Ticket_Note**: An internal comment or reply attached to a ticket, visible to Ora employees. Notes track the conversation history and resolution steps.
- **Contact**: The person who submitted the inquiry. Identified by name, email, and optionally phone number. A contact may or may not be a registered user.
- **Assignee**: The Ora employee assigned to handle a ticket. Assignment is tracked via user_id referencing the existing users table.
- **CRM_Adapter**: An abstraction layer that synchronizes ticket data to an external CRM system. The adapter interface is generic; concrete implementations exist for specific CRMs (Salesforce first).
- **CRM_Sync_Log**: A record tracking each synchronization attempt between the Ticketing_System and an external CRM, including status, external reference ID, and error details.
- **Ticket_API**: The programmatic interface (REST endpoints) for creating and querying tickets. Designed for both internal Ora panel use and external consumers such as AI chat agents.
- **Notification_Service**: The component responsible for sending transactional emails on ticket events (creation, assignment, status changes) using the existing SMTP infrastructure.
- **Audit_Trail**: Entries in the existing audit_log table recording ticket lifecycle events for compliance and traceability.

## Requirements

### Requirement 1: Ticket Data Model

**User Story:** As a platform architect, I want a well-structured ticket data model with all necessary fields, so that tickets can be created, tracked, and queried efficiently.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a `tickets` table with columns for id (UUID primary key), ticket_number (unique text), subject (text), description (text), status (Ticket_Status enum), priority (Ticket_Priority enum), category (text), contact_name (text), contact_email (text), contact_phone (nullable text), source (enum: "manual", "api", "form"), assignee_id (nullable foreign key to users), created_by (nullable foreign key to users), external_crm_id (nullable text), created_at (timestamp), updated_at (timestamp), resolved_at (nullable timestamp), and closed_at (nullable timestamp).
2. THE Ticketing_System SHALL provide a `ticket_notes` table with columns for id (UUID primary key), ticket_id (foreign key to tickets), author_id (foreign key to users), content (text), is_internal (boolean defaulting to true), created_at (timestamp).
3. THE Ticketing_System SHALL provide a `ticket_categories` table with columns for id (UUID primary key), name (text, unique), display_name (text), description (nullable text), is_active (boolean defaulting to true), and created_at (timestamp).
4. THE Ticketing_System SHALL generate a unique Ticket_Number in the format `ORA-XXXXXX` (zero-padded sequential integer) for each new ticket.
5. THE Ticketing_System SHALL enforce a unique constraint on the ticket_number column.
6. THE Ticketing_System SHALL index the tickets table on status, assignee_id, category, created_at, and contact_email for efficient querying.

### Requirement 2: Ticket Lifecycle Management

**User Story:** As a support agent, I want tickets to follow a defined lifecycle with enforced transitions, so that ticket progress is predictable and auditable.

#### Acceptance Criteria

1. THE Ticketing_System SHALL enforce the following valid status transitions: "open" to "assigned", "open" to "in_progress", "assigned" to "in_progress", "in_progress" to "resolved", "resolved" to "closed", and "resolved" to "in_progress" (reopen).
2. IF a status transition is attempted that is not in the valid transition set, THEN THE Ticketing_System SHALL reject the transition and return a descriptive error.
3. WHEN a ticket status changes to "assigned", THE Ticketing_System SHALL require a non-null assignee_id.
4. WHEN a ticket status changes to "resolved", THE Ticketing_System SHALL set the resolved_at timestamp to the current time.
5. WHEN a ticket status changes to "closed", THE Ticketing_System SHALL set the closed_at timestamp to the current time.
6. WHEN a ticket status changes from "resolved" back to "in_progress", THE Ticketing_System SHALL clear the resolved_at timestamp.
7. THE Ticketing_System SHALL record every status transition in the audit_log table with entity_type "ticket_status_change", the actor user_id, the ticket_id, and the old and new status values.

### Requirement 3: Ticket Creation — Manual

**User Story:** As an Ora employee, I want to create tickets manually from the admin panel, so that I can log support inquiries received via phone, email, or walk-in.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a ticket creation form in the Ora admin panel at /ora-panel/tickets/new.
2. WHEN an Ora employee submits a valid ticket creation form, THE Ticketing_System SHALL create a ticket record with status "open", the provided contact details, subject, description, priority, and category, and source set to "manual".
3. WHEN a ticket is created manually, THE Ticketing_System SHALL set the created_by field to the authenticated employee's user_id.
4. THE Ticketing_System SHALL validate that subject, description, contact_name, and contact_email are non-empty before creating a ticket.
5. THE Ticketing_System SHALL require the "tickets:create" permission to access the manual ticket creation form.

### Requirement 4: Ticket Creation — API

**User Story:** As an AI chat agent developer, I want a clean REST API to create tickets programmatically, so that the AI can create tickets hands-free during a chat session and return the ticket number to the user.

#### Acceptance Criteria

1. THE Ticket_API SHALL provide a POST endpoint at /api/tickets that accepts subject, description, contact_name, contact_email, contact_phone (optional), priority (optional, defaults to "medium"), and category (optional).
2. WHEN a valid ticket creation request is received via the API, THE Ticket_API SHALL create a ticket record with status "open" and source set to "api".
3. WHEN a ticket is created via the API by an authenticated user, THE Ticket_API SHALL set the created_by field to the authenticated user's user_id.
4. WHEN a ticket is successfully created via the API, THE Ticket_API SHALL return the ticket_id and ticket_number in the response body.
5. THE Ticket_API SHALL require valid authentication (active session) to create tickets via the API endpoint.
6. THE Ticket_API SHALL validate that subject, description, contact_name, and contact_email are non-empty and that contact_email is a valid email format.

### Requirement 5: Ticket Creation — Public Form

**User Story:** As a lead visiting the website, I want to submit a support request through a public form, so that I can get help without needing an account.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a public-facing ticket submission endpoint at /api/tickets/public that does not require authentication.
2. WHEN a valid public submission is received, THE Ticketing_System SHALL create a ticket record with status "open", source set to "form", and created_by set to null.
3. THE Ticketing_System SHALL apply rate limiting to the public submission endpoint to prevent abuse (maximum 5 submissions per IP address per 15-minute window).
4. THE Ticketing_System SHALL validate that subject, description, contact_name, and contact_email are non-empty and that contact_email is a valid email format before creating a ticket from a public submission.

### Requirement 6: Ticket Assignment

**User Story:** As a support manager, I want to assign tickets to specific agents, so that responsibility is clear and workload can be distributed.

#### Acceptance Criteria

1. WHEN a ticket is assigned to an Ora employee, THE Ticketing_System SHALL set the assignee_id to the target employee's user_id and transition the status to "assigned" if the current status is "open".
2. WHEN a ticket is reassigned to a different Ora employee, THE Ticketing_System SHALL update the assignee_id and record the reassignment in the audit_log.
3. THE Ticketing_System SHALL verify that the target assignee is an active user with user_type "employee" before completing the assignment.
4. THE Ticketing_System SHALL require the "tickets:assign" permission to assign or reassign tickets.
5. IF the target assignee user is not active or is not of user_type "employee", THEN THE Ticketing_System SHALL reject the assignment with a descriptive error.

### Requirement 7: Ticket Querying and Listing

**User Story:** As an Ora employee, I want to view, filter, and search tickets, so that I can find and manage support inquiries efficiently.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a ticket listing page in the Ora admin panel at /ora-panel/tickets.
2. THE Ticketing_System SHALL support filtering tickets by status, priority, category, assignee, date range, and source.
3. THE Ticketing_System SHALL support searching tickets by ticket_number, subject, contact_name, and contact_email.
4. THE Ticketing_System SHALL support pagination with configurable page size (default 20 items per page).
5. THE Ticketing_System SHALL display ticket count summaries grouped by status on the listing page.
6. THE Ticketing_System SHALL require the "tickets:read" permission to access the ticket listing.
7. THE Ticket_API SHALL provide a GET endpoint at /api/tickets that returns paginated ticket results with the same filtering and search capabilities.

### Requirement 8: Ticket Detail View and Notes

**User Story:** As a support agent, I want to view full ticket details and add internal notes, so that I can track the conversation history and resolution steps.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a ticket detail page in the Ora admin panel at /ora-panel/tickets/[id].
2. THE Ticketing_System SHALL display all ticket fields, the full note history ordered by creation time, and the audit trail for the ticket on the detail page.
3. WHEN an Ora employee adds a note to a ticket, THE Ticketing_System SHALL create a ticket_notes record with the author_id set to the authenticated user's user_id.
4. THE Ticketing_System SHALL require the "tickets:read" permission to view ticket details.
5. THE Ticketing_System SHALL require the "tickets:update" permission to add notes to a ticket.

### Requirement 9: Email Notifications

**User Story:** As a lead who submitted a ticket, I want to receive email notifications when my ticket is created and when its status changes, so that I stay informed about my inquiry.

#### Acceptance Criteria

1. WHEN a ticket is created, THE Notification_Service SHALL send a confirmation email to the contact_email containing the Ticket_Number, subject, and a message confirming receipt.
2. WHEN a ticket status changes to "assigned", THE Notification_Service SHALL send an email to the Assignee's email address notifying them of the new assignment with the Ticket_Number and subject.
3. WHEN a ticket status changes to "resolved", THE Notification_Service SHALL send an email to the contact_email notifying the contact that the ticket has been resolved, including the Ticket_Number.
4. WHEN a ticket status changes to "closed", THE Notification_Service SHALL send an email to the contact_email confirming the ticket is closed, including the Ticket_Number.
5. THE Notification_Service SHALL use the existing SMTP infrastructure (nodemailer transport configured via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM environment variables).
6. IF an email notification fails to send, THEN THE Notification_Service SHALL log the failure to the audit_log with entity_type "notification" and continue processing without blocking the ticket operation.

### Requirement 10: CRM Integration — Adapter Interface

**User Story:** As a platform architect, I want a pluggable CRM adapter interface, so that the ticketing system can sync to Salesforce today and swap or add other CRMs (HubSpot, Zoho) later without changing core ticket logic.

#### Acceptance Criteria

1. THE CRM_Adapter SHALL define a TypeScript interface with methods for: createCase (create a case/ticket in the external CRM), updateCase (update an existing case in the external CRM), and getCaseStatus (retrieve the current status of a case from the external CRM).
2. THE CRM_Adapter interface SHALL accept and return generic data transfer objects that are not coupled to any specific CRM's API schema.
3. THE Ticketing_System SHALL provide a CRM adapter registry that maps adapter names to concrete adapter implementations.
4. THE Ticketing_System SHALL load the active CRM adapter name from a configuration source (environment variable CRM_ADAPTER or site_settings table).
5. IF no CRM adapter is configured, THEN THE Ticketing_System SHALL operate without CRM synchronization and log a warning on startup.

### Requirement 11: CRM Integration — Salesforce Adapter

**User Story:** As a sales manager, I want tickets to sync to Salesforce as cases, so that the sales team can track support inquiries alongside lead data in the CRM.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a Salesforce adapter that implements the CRM_Adapter interface.
2. WHEN a ticket is created, THE Salesforce adapter SHALL create a corresponding Case in Salesforce and store the returned Salesforce Case ID in the ticket's external_crm_id field.
3. WHEN a ticket status changes, THE Salesforce adapter SHALL update the corresponding Case status in Salesforce.
4. THE Salesforce adapter SHALL authenticate with Salesforce using OAuth 2.0 client credentials flow, configured via environment variables (SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL).
5. IF a Salesforce API call fails, THEN THE Salesforce adapter SHALL log the failure to the CRM_Sync_Log table with the error details and retry up to 3 times with exponential backoff.

### Requirement 12: CRM Sync Logging

**User Story:** As a platform operator, I want all CRM synchronization attempts logged, so that I can diagnose sync failures and verify data consistency.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide a `crm_sync_log` table with columns for id (UUID primary key), ticket_id (foreign key to tickets), direction (enum: "outbound", "inbound"), action (text, e.g., "create_case", "update_case"), status (enum: "success", "failed", "pending"), external_ref_id (nullable text), error_message (nullable text), request_payload (nullable jsonb), response_payload (nullable jsonb), attempted_at (timestamp), and completed_at (nullable timestamp).
2. WHEN a CRM synchronization is attempted, THE Ticketing_System SHALL create a CRM_Sync_Log record with status "pending" before the API call.
3. WHEN a CRM synchronization succeeds, THE Ticketing_System SHALL update the CRM_Sync_Log record status to "success" and store the external_ref_id and completed_at timestamp.
4. WHEN a CRM synchronization fails after all retries, THE Ticketing_System SHALL update the CRM_Sync_Log record status to "failed" and store the error_message.

### Requirement 13: RBAC Integration

**User Story:** As a super administrator, I want ticketing permissions integrated into the existing RBAC system, so that access to ticket operations is controlled by roles.

#### Acceptance Criteria

1. THE Ticketing_System SHALL register the following permissions in the permissions table: "tickets:create", "tickets:read", "tickets:update", "tickets:assign", "tickets:delete", and "tickets:manage".
2. THE RBAC_Engine SHALL grant the super_admin role all ticket permissions ("tickets:*").
3. THE RBAC_Engine SHALL grant the sales_manager role the permissions "tickets:create", "tickets:read", "tickets:update", and "tickets:assign".
4. THE RBAC_Engine SHALL grant the content_manager role the permission "tickets:read".
5. THE RBAC_Engine SHALL grant the viewer role the permission "tickets:read".
6. WHEN a ticket API endpoint is accessed, THE Zero_Trust_Middleware SHALL enforce the required ticket permission before executing the handler.

### Requirement 14: Ticket Audit Trail

**User Story:** As a compliance officer, I want all ticket operations logged in the audit trail, so that ticket history is fully traceable.

#### Acceptance Criteria

1. WHEN a ticket is created, THE Ticketing_System SHALL create an audit_log entry with entity_type "ticket", action "ticket_create", and the ticket_id as entity_id.
2. WHEN a ticket is assigned or reassigned, THE Ticketing_System SHALL create an audit_log entry with entity_type "ticket", action "ticket_assign", the ticket_id as entity_id, and the old and new assignee in the changes field.
3. WHEN a ticket status changes, THE Ticketing_System SHALL create an audit_log entry with entity_type "ticket_status_change", the ticket_id as entity_id, and the old and new status in the changes field.
4. WHEN a note is added to a ticket, THE Ticketing_System SHALL create an audit_log entry with entity_type "ticket_note", action "ticket_note_add", and the ticket_id as entity_id.
5. THE Ticketing_System SHALL use the existing audit_log table and logAudit function from lib/cms/audit.ts.

### Requirement 15: Ticket Number Generation — Uniqueness and Format

**User Story:** As a support agent, I want ticket numbers to be unique, sequential, and human-readable, so that tickets can be referenced unambiguously in conversations and emails.

#### Acceptance Criteria

1. THE Ticketing_System SHALL maintain a database sequence or counter to generate monotonically increasing ticket numbers.
2. THE Ticketing_System SHALL format ticket numbers as `ORA-` followed by a six-digit zero-padded integer (e.g., ORA-000001, ORA-000042).
3. WHEN two tickets are created concurrently, THE Ticketing_System SHALL guarantee that each receives a distinct Ticket_Number with no duplicates.
4. FOR ALL valid Ticket records, parsing the Ticket_Number to extract the numeric portion and formatting it back to `ORA-XXXXXX` SHALL produce the original Ticket_Number (round-trip property).

### Requirement 16: Ticket Category Management

**User Story:** As a super administrator, I want to manage ticket categories, so that tickets can be classified consistently and categories can evolve over time.

#### Acceptance Criteria

1. THE Ticketing_System SHALL provide API endpoints to create, list, update, and deactivate ticket categories.
2. THE Ticketing_System SHALL enforce unique category names in the ticket_categories table.
3. WHEN a category is deactivated, THE Ticketing_System SHALL set is_active to false rather than deleting the record, preserving referential integrity with existing tickets.
4. THE Ticketing_System SHALL require the "tickets:manage" permission to create, update, or deactivate categories.
5. THE Ticketing_System SHALL allow any user with "tickets:read" permission to list active categories.
