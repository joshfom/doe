# Implementation Plan: Support Ticketing System

## Overview

Adds a lead-oriented support ticket module to the Ora platform with three creation channels (manual, API, public form), enforced lifecycle transitions (Open → Assigned → In Progress → Resolved → Closed), email notifications, pluggable CRM integration (Salesforce first), and full audit trail. Implementation proceeds bottom-up: schema & types → ticket number generator → lifecycle engine → ticket service → notifications → CRM adapter layer → validation & rate limiting → API routes → RBAC seed → admin panel pages, with property-based tests validating the 18 correctness properties from the design document.

## Tasks

- [x] 1. Database schema extensions and type definitions
  - [x] 1.1 Add ticket tables to `lib/cms/schema.ts`
    - Add `tickets` table with all columns per design: id, ticketNumber (unique), subject, description, status (enum: open/assigned/in_progress/resolved/closed), priority (enum: low/medium/high/urgent), category, contactName, contactEmail, contactPhone, source (enum: manual/api/form), assigneeId (FK → users), createdBy (FK → users), externalCrmId, createdAt, updatedAt, resolvedAt, closedAt
    - Add indexes on status, assigneeId, category, createdAt, contactEmail
    - Add `ticketNotes` table with id, ticketId (FK → tickets, onDelete cascade), authorId (FK → users), content, isInternal (default true), createdAt
    - Add `ticketCategories` table with id, name (unique), displayName, description, isActive (default true), createdAt
    - Add `crmSyncLog` table with id, ticketId (FK → tickets), direction (enum: outbound/inbound), action, status (enum: success/failed/pending), externalRefId, errorMessage, requestPayload (jsonb), responsePayload (jsonb), attemptedAt, completedAt
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 12.1_

  - [x] 1.2 Create PostgreSQL sequence for ticket numbers
    - Add a Drizzle migration that creates the `ticket_number_seq` PostgreSQL sequence
    - This sequence guarantees monotonically increasing ticket numbers under concurrent inserts
    - _Requirements: 1.4, 15.1, 15.3_

  - [x] 1.3 Extend type definitions in `lib/cms/types.ts`
    - Add `TicketStatus`, `TicketPriority`, `TicketSource` type aliases
    - Extend `AuditAction` with `"ticket_create"`, `"ticket_assign"`, `"ticket_status_change"`, `"ticket_note_add"`
    - Extend `AuditEntityType` with `"ticket"`, `"ticket_status_change"`, `"ticket_note"`
    - _Requirements: 1.1, 2.7, 14.1, 14.2, 14.3, 14.4_

  - [x] 1.4 Generate Drizzle migration
    - Run `npx drizzle-kit generate` to create the SQL migration file in `drizzle/`
    - Verify the generated migration includes all new tables, indexes, and the ticket_number_seq sequence
    - _Requirements: 1.1, 1.2, 1.3, 12.1_

- [x] 2. Ticket number generator and lifecycle engine
  - [x] 2.1 Implement ticket number generator at `lib/cms/tickets/ticket-number.ts`
    - Export `generateTicketNumber(db): Promise<string>` — calls `nextval('ticket_number_seq')` and formats as `ORA-XXXXXX`
    - Export `formatTicketNumber(seq: number): string` — pure function, zero-pads to 6 digits with `ORA-` prefix
    - Export `parseTicketNumber(ticketNumber: string): number | null` — extracts numeric portion, returns null for invalid format
    - _Requirements: 1.4, 15.1, 15.2, 15.4_

  - [x] 2.2 Write property test for ticket number round-trip
    - **Property 1: Ticket number round-trip**
    - **Validates: Requirements 1.4, 15.2, 15.4**

  - [x] 2.3 Implement lifecycle engine at `lib/cms/tickets/lifecycle.ts`
    - Export `VALID_TRANSITIONS` lookup table mapping each status to its allowed next statuses
    - Export `isValidTransition(from, to): boolean` — pure function checking the lookup table
    - Export `transitionTicketStatus(db, ticketId, newStatus, actorId, assigneeId?)` — validates transition, applies side effects (resolved_at, closed_at timestamps, assignee check), writes audit log, triggers notifications, syncs to CRM, all within a transaction
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.4 Write property test for status transition validity
    - **Property 2: Status transition validity**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 2.5 Write property test for status transition side effects
    - **Property 3: Status transition side effects**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Ticket service and validation
  - [x] 4.1 Implement validation schemas at `lib/cms/tickets/validation.ts`
    - Define Zod schemas: `createTicketSchema`, `publicTicketSchema`, `transitionStatusSchema`, `assignTicketSchema`, `addNoteSchema`, `ticketFiltersSchema`, `createCategorySchema`, `updateCategorySchema`
    - Validate subject, description, contactName, contactEmail as non-empty; contactEmail as valid email format
    - Priority defaults to "medium", category is optional
    - _Requirements: 3.4, 4.6, 5.4_

  - [x] 4.2 Implement ticket service at `lib/cms/tickets/service.ts`
    - Export `createTicket(db, input: CreateTicketInput)` — generates ticket number, inserts ticket with status "open", writes audit log, triggers creation notification, syncs to CRM
    - Export `assignTicket(db, ticketId, assigneeId, actorId)` — validates assignee is active employee, sets assigneeId, transitions to "assigned" if currently "open", writes audit log, triggers assignment notification
    - Export `addNote(db, ticketId, authorId, content, isInternal?)` — inserts ticket_notes record, writes audit log
    - Export `getTicketById(db, ticketId)` — returns ticket with notes and audit trail
    - Export `listTickets(db, filters: TicketFilters)` — returns paginated results with filtering by status, priority, category, assignee, date range, source; search by ticket_number, subject, contact_name, contact_email; includes status count summaries
    - _Requirements: 3.2, 3.3, 4.2, 4.3, 4.4, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.4, 7.5, 7.7, 8.2, 8.3_

  - [x] 4.3 Write property test for ticket creation invariants
    - **Property 4: Ticket creation invariants**
    - **Validates: Requirements 3.2, 3.3, 4.2, 4.3, 4.4, 5.2**

  - [x] 4.4 Write property test for ticket creation input validation
    - **Property 5: Ticket creation input validation**
    - **Validates: Requirements 3.4, 4.6, 5.4**

  - [x] 4.5 Write property test for assignment validates active employee
    - **Property 6: Assignment validates active employee**
    - **Validates: Requirements 6.3, 6.5**

  - [x] 4.6 Write property test for note creation sets author correctly
    - **Property 18: Note creation sets author correctly**
    - **Validates: Requirements 8.3**

- [x] 5. Ticket querying and filtering
  - [x] 5.1 Implement query logic within `lib/cms/tickets/service.ts` (listTickets and getTicketById)
    - Implement filtering by status, priority, category, assignee, date range (createdAt), and source
    - Implement search across ticket_number, subject, contact_name, contact_email (case-insensitive)
    - Implement pagination with configurable page size (default 20)
    - Implement status count summary (group by status, return counts)
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.7_

  - [x] 5.2 Write property test for ticket filtering correctness
    - **Property 7: Ticket filtering correctness**
    - **Validates: Requirements 7.2, 7.7**

  - [x] 5.3 Write property test for ticket search correctness
    - **Property 8: Ticket search correctness**
    - **Validates: Requirements 7.3**

  - [x] 5.4 Write property test for pagination bounds
    - **Property 9: Pagination bounds**
    - **Validates: Requirements 7.4**

  - [x] 5.5 Write property test for status count accuracy
    - **Property 10: Status count accuracy**
    - **Validates: Requirements 7.5**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Email notifications and audit trail
  - [x] 7.1 Implement ticket notifications at `lib/cms/tickets/notifications.ts`
    - Export `sendTicketCreatedEmail(db, ticket)` — sends confirmation to contact_email with ticket number and subject
    - Export `sendTicketAssignedEmail(db, ticket, assigneeEmail)` — notifies assignee of new assignment
    - Export `sendTicketResolvedEmail(db, ticket)` — notifies contact that ticket is resolved
    - Export `sendTicketClosedEmail(db, ticket)` — notifies contact that ticket is closed
    - Use existing `sendEmail` from `lib/cms/approval/notifications.ts` and SMTP env vars
    - Catch failures, log to audit_log with entity_type "notification", never block ticket operation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 7.2 Write property test for notification triggers on lifecycle events
    - **Property 12: Notification triggers on lifecycle events**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [x] 7.3 Write property test for notification failure does not block ticket operation
    - **Property 13: Notification failure does not block ticket operation**
    - **Validates: Requirements 9.6**

  - [x] 7.4 Wire audit logging into ticket service
    - Ensure `createTicket` logs entity_type "ticket", action "ticket_create"
    - Ensure `assignTicket` logs entity_type "ticket", action "ticket_assign" with old/new assignee in changes
    - Ensure `transitionTicketStatus` logs entity_type "ticket_status_change" with old/new status in changes
    - Ensure `addNote` logs entity_type "ticket_note", action "ticket_note_add"
    - Use existing `logAudit` from `lib/cms/audit.ts`
    - _Requirements: 2.7, 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 7.5 Write property test for ticket audit trail completeness
    - **Property 11: Ticket audit trail completeness**
    - **Validates: Requirements 2.7, 14.1, 14.2, 14.3, 14.4**

- [x] 8. CRM adapter layer
  - [x] 8.1 Implement CRM adapter interface and registry at `lib/cms/tickets/crm/adapter.ts` and `lib/cms/tickets/crm/registry.ts`
    - Define `CrmAdapter` interface with `createCase`, `updateCase`, `getCaseStatus` methods
    - Define `CrmCaseInput` and `CrmCaseResult` DTOs (generic, not CRM-specific)
    - Implement adapter registry with `registerAdapter(name, adapter)` and `getActiveAdapter(): CrmAdapter | null`
    - Registry reads `CRM_ADAPTER` from env or `site_settings`; returns null if not configured
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 8.2 Implement Salesforce adapter at `lib/cms/tickets/crm/salesforce.ts`
    - Implement `SalesforceAdapter` class implementing `CrmAdapter`
    - Authenticate via OAuth 2.0 client credentials (SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL)
    - Create/update Salesforce Cases, store returned Case ID in ticket's external_crm_id
    - Retry up to 3 times with exponential backoff (1s, 2s, 4s) on failure
    - Log all sync attempts to crm_sync_log table
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 8.3 Implement CRM sync logging in ticket service
    - Create crm_sync_log record with status "pending" before API call
    - Update to "success" with external_ref_id and completed_at on success
    - Update to "failed" with error_message after all retries exhausted
    - _Requirements: 12.2, 12.3, 12.4_

  - [x] 8.4 Write property test for CRM sync log lifecycle
    - **Property 15: CRM sync log lifecycle**
    - **Validates: Requirements 12.2, 12.3, 12.4**

- [x] 9. Rate limiter and public form endpoint
  - [x] 9.1 Implement rate limiter at `lib/cms/tickets/rate-limit.ts`
    - Export `RateLimiter` class with `isAllowed(ip): boolean` and `record(ip): void`
    - In-memory sliding window: 5 submissions per IP per 15-minute window
    - Auto-cleanup of expired entries
    - _Requirements: 5.3_

  - [x] 9.2 Write property test for rate limiter enforcement
    - **Property 14: Rate limiter enforcement**
    - **Validates: Requirements 5.3**

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Ticket category management
  - [x] 11.1 Implement category service functions in `lib/cms/tickets/service.ts`
    - Export `createCategory(db, input)` — validates unique name, inserts record
    - Export `listCategories(db, includeInactive?)` — returns categories, defaults to active only
    - Export `updateCategory(db, categoryId, updates)` — updates name, displayName, description
    - Export `deactivateCategory(db, categoryId)` — sets is_active to false (soft delete)
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 11.2 Write property test for category name uniqueness
    - **Property 16: Category name uniqueness**
    - **Validates: Requirements 16.2**

  - [x] 11.3 Write property test for category deactivation preserves record
    - **Property 17: Category deactivation preserves record**
    - **Validates: Requirements 16.3**

- [x] 12. API routes — tickets and categories
  - [x] 12.1 Implement ticket API routes at `lib/cms/api/routes/tickets.ts`
    - `POST /tickets` — create ticket (authenticated, requires `tickets:create`), returns ticketId and ticketNumber
    - `POST /tickets/public` — create ticket from public form (unauthenticated, rate-limited), source "form", createdBy null
    - `GET /tickets` — list tickets with filtering, search, pagination (authenticated, requires `tickets:read`)
    - `GET /tickets/:id` — get ticket detail with notes and audit trail (authenticated, requires `tickets:read`)
    - `PATCH /tickets/:id/status` — transition ticket status (authenticated, requires `tickets:update`)
    - `PATCH /tickets/:id/assign` — assign/reassign ticket (authenticated, requires `tickets:assign`)
    - `POST /tickets/:id/notes` — add note to ticket (authenticated, requires `tickets:update`)
    - Use existing `identityGuard` and `requirePermission` middleware from `lib/cms/rbac/middleware.ts`
    - _Requirements: 3.1, 3.5, 4.1, 4.5, 5.1, 5.2, 6.4, 7.6, 7.7, 8.4, 8.5, 13.6_

  - [x] 12.2 Implement ticket category API routes at `lib/cms/api/routes/ticket-categories.ts`
    - `POST /ticket-categories` — create category (requires `tickets:manage`)
    - `GET /ticket-categories` — list categories (requires `tickets:read`)
    - `PATCH /ticket-categories/:id` — update category (requires `tickets:manage`)
    - `DELETE /ticket-categories/:id` — deactivate category (requires `tickets:manage`)
    - _Requirements: 16.1, 16.4, 16.5_

  - [x] 12.3 Wire ticket routes into main API at `lib/cms/api/index.ts`
    - Import and `.use()` both `ticketsRoutes` and `ticketCategoriesRoutes` in the main Elysia API composition
    - _Requirements: 4.1, 7.7_

- [x] 13. RBAC seed for ticket permissions
  - [x] 13.1 Create ticket permission seed at `lib/cms/tickets/seed.ts`
    - Register permissions: `tickets:create`, `tickets:read`, `tickets:update`, `tickets:assign`, `tickets:delete`, `tickets:manage`
    - Grant `super_admin` all ticket permissions (via wildcard, already covered by `*:*`)
    - Grant `sales_manager`: `tickets:create`, `tickets:read`, `tickets:update`, `tickets:assign`
    - Grant `content_manager`: `tickets:read`
    - Grant `viewer`: `tickets:read`
    - Make seed idempotent (check-before-insert)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 13.2 Integrate ticket seed into server startup at `lib/cms/api/server.ts`
    - Import and call `seedTicketPermissions` alongside existing `seedRbac`
    - _Requirements: 13.1_

- [x] 14. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Admin panel — ticket listing page
  - [x] 15.1 Create ticket listing page at `app/ora-panel/tickets/page.tsx`
    - Display paginated ticket list with columns: ticket number, subject, status, priority, category, assignee, created date
    - Implement filter controls for status, priority, category, assignee, date range, source
    - Implement search bar for ticket_number, subject, contact_name, contact_email
    - Display status count summary badges (open, assigned, in_progress, resolved, closed)
    - Use React Query for data fetching, matching existing patterns in `app/ora-panel/`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 16. Admin panel — ticket detail and creation pages
  - [x] 16.1 Create ticket detail page at `app/ora-panel/tickets/[id]/page.tsx`
    - Display all ticket fields, full note history ordered by creation time, and audit trail
    - Include status transition controls (buttons for valid next statuses)
    - Include assignment control (select employee dropdown)
    - Include note input form for adding internal notes
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 16.2 Create ticket creation form at `app/ora-panel/tickets/new/page.tsx`
    - Form fields: subject, description, contact name, contact email, contact phone (optional), priority (dropdown), category (dropdown from active categories)
    - Validate required fields before submission
    - On success, redirect to the new ticket's detail page
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 17. Admin panel — navigation and wiring
  - [x] 17.1 Add tickets navigation item to `app/ora-panel/layout.tsx`
    - Add `{ href: '/ora-panel/tickets', label: 'Tickets', icon: Ticket2, permission: 'tickets:read' }` to the `navItems` array
    - Import `Ticket2` icon from `lucide-react`
    - _Requirements: 7.1, 7.6, 13.6_

- [x] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check (already in devDependencies)
- Unit tests validate specific examples and edge cases
- The CRM adapter layer is designed for extensibility — only Salesforce is implemented in Phase 1, but HubSpot/Zoho can be added by implementing the `CrmAdapter` interface
- Email notifications reuse the existing SMTP infrastructure from `lib/cms/approval/notifications.ts`
- Audit logging reuses the existing `logAudit` function from `lib/cms/audit.ts`
- RBAC enforcement reuses the existing middleware from `lib/cms/rbac/middleware.ts`
- All 18 correctness properties from the design are covered across dedicated property test files
