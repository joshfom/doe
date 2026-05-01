# Implementation Plan: RBAC Identity System

## Overview

Transforms the Ora platform from a single-type user model into a multi-tenant identity system with four user types (employee, broker, client, vendor), dedicated profile tables, role-based access control with granular `resource:action` permissions, zero-trust middleware, broker registration/approval lifecycle, and company status cascade. Implementation proceeds bottom-up: schema → RBAC engine → middleware → services → session enhancement → API routes → seed data → migration, with property-based tests validating the 28 correctness properties from the design document.

## Tasks

- [x] 1. Database schema extensions and new tables
  - [x] 1.1 Extend the `users` table in `lib/cms/schema.ts`
    - Add `userType` column: `text("user_type", { enum: ["employee", "broker", "client", "vendor"] }).notNull().default("employee")`
    - Add `isActive` column: `boolean("is_active").notNull().default(true)`
    - Add `emailVerified` column: `boolean("email_verified").notNull().default(false)`
    - Change `passwordHash` from `.notNull()` to nullable (remove `.notNull()`)
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x] 1.2 Add profile tables to `lib/cms/schema.ts`
    - Add `employeeProfiles` table with `id`, `userId` (FK → users, unique), `department`, `jobTitle`, `phoneNumber`, `createdAt`, `updatedAt`
    - Add `brokerCompanies` table with `id`, `companyName`, `tradeLicenseNumber`, `tradeLicenseDocumentUrl`, `contactEmail`, `contactPhone`, `status` (enum: pending/active/suspended/rejected), `createdAt`, `updatedAt`
    - Add `brokerProfiles` table with `id`, `userId` (FK → users, unique), `companyId` (FK → brokerCompanies), `isCompanyAdmin`, `status` (enum: active/inactive), `createdAt`, `updatedAt`
    - Add `clientProfiles` table with `id`, `userId` (FK → users, unique), `createdAt`, `updatedAt`
    - Add `vendorProfiles` table with `id`, `userId` (FK → users, unique), `createdAt`, `updatedAt`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.3 Add RBAC tables to `lib/cms/schema.ts`
    - Add `roles` table with `id`, `name`, `displayName`, `description`, `userType` (enum), `isSystem` (boolean, default false), `createdAt`, `updatedAt`, plus unique index on `(name, userType)`
    - Add `permissions` table with `id`, `resource`, `action`, `description`, plus unique index on `(resource, action)`
    - Add `rolePermissions` junction table with `id`, `roleId` (FK → roles, onDelete cascade), `permissionId` (FK → permissions, onDelete cascade), plus unique index on `(roleId, permissionId)`
    - Add `userRoles` junction table with `id`, `userId` (FK → users, onDelete cascade), `roleId` (FK → roles, onDelete cascade), `grantedBy` (FK → users, nullable), `grantedAt`, plus unique index on `(userId, roleId)`
    - _Requirements: 3.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.4 Generate Drizzle migration
    - Run `npx drizzle-kit generate` to create the SQL migration file in `drizzle/`
    - Verify the generated migration includes all new tables, column changes, and indexes
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 4.1_


- [x] 2. RBAC engine — permission resolver, cache, and validation
  - [x] 2.1 Implement permission validation and user type utilities at `lib/cms/rbac/engine.ts`
    - Export `isValidUserType(value: string): boolean` — validates against the four allowed types
    - Export `isValidPermissionString(value: string): boolean` — validates `resource:action` format (two non-empty alphanumeric segments separated by colon)
    - Export `hasPermission(permissions: string[], required: string): boolean` — checks exact match or wildcard (`resource:*`) match
    - Export `resolvePermissions(roles: Role[]): Promise<string[]>` — queries `rolePermissions` + `permissions` tables, returns union of all permission strings
    - Export `loadUserRoles(userId: string): Promise<Role[]>` — queries `userRoles` + `roles` tables
    - _Requirements: 1.4, 1.5, 4.2, 5.4, 5.5, 5.6, 13.5_

  - [x] 2.2 Write property test: User type validation rejects invalid types
    - **Property 1: User type validation rejects invalid types**
    - **Validates: Requirements 1.4**

  - [x] 2.3 Write property test: User type immutability
    - **Property 2: User type immutability**
    - **Validates: Requirements 1.5**

  - [x] 2.4 Write property test: Permission format validation
    - **Property 7: Permission format validation**
    - **Validates: Requirements 4.2, 4.3**

  - [x] 2.5 Implement permission cache at `lib/cms/rbac/cache.ts`
    - Export `PermissionCache` class with `get(userId)`, `set(userId, data)`, `invalidate(userId)` methods
    - Use in-memory Map with TTL-based expiration
    - Cache stores `{ roles: string[], permissions: string[], cachedAt: number }`
    - _Requirements: 14.6_

  - [x] 2.6 Write property test: Role-type scope enforcement
    - **Property 4: Role-type scope enforcement**
    - **Validates: Requirements 3.4**

  - [x] 2.7 Write property test: System role deletion prevention
    - **Property 5: System role deletion prevention**
    - **Validates: Requirements 3.5**

  - [x] 2.8 Write property test: Role name uniqueness within type scope
    - **Property 6: Role name uniqueness within type scope**
    - **Validates: Requirements 3.6**

  - [x] 2.9 Write property test: Role deletion cascades junction records
    - **Property 8: Role deletion cascades junction records**
    - **Validates: Requirements 4.6**

  - [x] 2.10 Write property test: Permission resolution is the union of role permissions
    - **Property 11: Permission resolution is the union of role permissions**
    - **Validates: Requirements 5.4, 5.5**

  - [x] 2.11 Write property test: Permission check with wildcard support
    - **Property 12: Permission check with wildcard support**
    - **Validates: Requirements 5.6, 13.2, 13.5**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Middleware guards — identity, portal, and permission enforcement
  - [x] 4.1 Implement `identityGuard` at `lib/cms/rbac/middleware.ts`
    - Create Elysia plugin that extends `authGuard` and derives identity context into request
    - Load user record with `userType`, `isActive`, `emailVerified` fields
    - Return 401 if `isActive` is false (message: "Account is deactivated")
    - Return 401 if `emailVerified` is false (message: "Email not verified")
    - For broker users: load `brokerProfiles` and `brokerCompanies` status; return 403 if profile inactive or company not active
    - Derive `userType`, `isActive`, `emailVerified`, and broker context into Elysia request context
    - _Requirements: 5.1, 5.2, 5.7, 5.8_

  - [x] 4.2 Implement `portalGuard` at `lib/cms/rbac/middleware.ts`
    - Export `portalGuard(portal: string): Elysia` factory function
    - Define portal-to-type mapping: `/ora-panel` → `employee`, `/broker-portal` → `broker`, `/client-portal` → `client`, `/vendor-portal` → `vendor`
    - Verify `userType` matches the portal prefix; return 403 on mismatch
    - Apply portal check before role/permission loading (fail fast)
    - _Requirements: 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 4.3 Implement `requirePermission` at `lib/cms/rbac/middleware.ts`
    - Export `requirePermission(permission: string): Elysia` factory function
    - Load roles and resolve permissions (using cache), then check required permission
    - Return 403 with `{ error: "Access denied: insufficient permissions", required: permission }` on failure
    - If no permission string is declared, require only valid authentication
    - _Requirements: 5.6, 5.7, 13.1, 13.2, 13.3, 13.4_

  - [x] 4.4 Write property test: Active status gate in middleware
    - **Property 9: Active status gate in middleware**
    - **Validates: Requirements 5.2**

  - [x] 4.5 Write property test: Portal-type alignment
    - **Property 10: Portal-type alignment**
    - **Validates: Requirements 5.3, 6.5**

  - [x] 4.6 Write property test: Broker middleware requires active profile and company
    - **Property 13: Broker middleware requires active profile and company**
    - **Validates: Requirements 5.8, 10.3**

- [x] 5. Broker registration and approval services
  - [x] 5.1 Implement registration service at `lib/cms/rbac/registration.ts`
    - Export `registerBrokerCompany(db, data: BrokerRegistrationInput): Promise<{ company, user, profile }>`
    - Validate all required fields (company_name, trade_license_number, contact_email, contact_phone, admin name, admin email, admin phone)
    - Validate email format; reject with descriptive error if invalid
    - Check for duplicate email in users table; return 409 if exists
    - In a single transaction: create `brokerCompanies` record (status: pending), create `users` record (userType: broker, isActive: false, emailVerified: false, passwordHash: null), create `brokerProfiles` record (isCompanyAdmin: true, status: inactive), assign `agency_admin` role via `userRoles`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 5.2 Write property test: Broker registration creates correct records
    - **Property 14: Broker registration creates correct records**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [x] 5.3 Write property test: Registration input validation
    - **Property 15: Registration input validation**
    - **Validates: Requirements 7.7**

  - [x] 5.4 Implement broker approval/rejection logic in registration service
    - Export `approveBrokerCompany(db, companyId, actorId): Promise<void>` — set company status to active, set broker user isActive to true, set brokerProfile status to active, generate temporary password, log audit entry
    - Export `rejectBrokerCompany(db, companyId, actorId): Promise<void>` — set company status to rejected, log audit entry
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 5.5 Write property test: Broker approval activates company and user
    - **Property 16: Broker approval activates company and user**
    - **Validates: Requirements 8.3, 8.4**

  - [x] 5.6 Write property test: Broker rejection sets status
    - **Property 17: Broker rejection sets status**
    - **Validates: Requirements 8.6**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Agent management and company cascade services
  - [x] 7.1 Implement agent management in `lib/cms/rbac/registration.ts`
    - Export `addAgent(db, companyAdminUserId, agentData): Promise<{ user, profile }>` — verify caller is company admin, create user (userType: broker, isActive: true, emailVerified: false, passwordHash: null), create brokerProfile (isCompanyAdmin: false, status: active, linked to admin's company), assign agent role, generate temporary password
    - Export `deactivateAgent(db, companyAdminUserId, agentUserId): Promise<void>` — verify caller is company admin of same company, set brokerProfile status to inactive, set user isActive to false
    - Reject operations if caller is not company admin or agent belongs to different company
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 7.2 Write property test: Agent addition creates correct records
    - **Property 18: Agent addition creates correct records**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [x] 7.3 Write property test: Agent management restricted to company admins
    - **Property 19: Agent management restricted to company admins**
    - **Validates: Requirements 9.5**

  - [x] 7.4 Write property test: Agent deactivation sets correct flags
    - **Property 20: Agent deactivation sets correct flags**
    - **Validates: Requirements 9.6**

  - [x] 7.5 Write property test: Agent management company isolation
    - **Property 21: Agent management company isolation**
    - **Validates: Requirements 9.7**

  - [x] 7.6 Implement cascade service at `lib/cms/rbac/cascade.ts`
    - Export `suspendCompany(db, companyId, actorId): Promise<void>` — in a transaction: set company status to suspended, set isActive to false for all users linked via brokerProfiles, log audit entry with old/new status
    - Export `reactivateCompany(db, companyId, actorId): Promise<void>` — in a transaction: set company status to active, set isActive to true only for users whose brokerProfile status is active, log audit entry
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 7.7 Write property test: Company suspension cascades to all users
    - **Property 22: Company suspension cascades to all users**
    - **Validates: Requirements 10.1**

  - [x] 7.8 Write property test: Company reactivation restores only active-profile users
    - **Property 23: Company reactivation restores only active-profile users**
    - **Validates: Requirements 10.2**

- [x] 8. Session enhancement and audit logging
  - [x] 8.1 Enhance session endpoint in `lib/cms/api/auth.ts`
    - Modify `GET /auth/session` to return `userType`, `isActive`, `emailVerified`, `roles` (array of role names), `permissions` (array of resolved permission strings)
    - For broker users: include `broker` object with `companyId`, `companyName`, `companyStatus`, `isCompanyAdmin`, `profileStatus`
    - Use permission cache to avoid repeated DB lookups
    - Update `authPlugin` login response to include identity context
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x] 8.2 Write property test: Session returns complete identity context
    - **Property 24: Session returns complete identity context**
    - **Validates: Requirements 14.2, 14.3**

  - [x] 8.3 Write property test: Session returns broker-specific context
    - **Property 25: Session returns broker-specific context**
    - **Validates: Requirements 14.4, 14.5**

  - [x] 8.4 Implement RBAC audit logging
    - Add audit log entries for role assignment/revocation (entity_type: "role_assignment")
    - Add audit log entries for permission addition/removal to roles (entity_type: "permission_change")
    - Add audit log entries for access denials in middleware (entity_type: "access_denial")
    - Add audit log entries for company status changes (entity_type: "company_status_change")
    - Use the existing `auditLog` table schema in `lib/cms/schema.ts`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 8.5 Write property test: RBAC audit trail completeness
    - **Property 26: RBAC audit trail completeness**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 10.4**

  - [x] 8.6 Write property test: Profile-to-type correspondence invariant
    - **Property 3: Profile-to-type correspondence invariant**
    - **Validates: Requirements 2.6**

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Seed data for system roles and permissions
  - [x] 10.1 Create seed script at `lib/cms/rbac/seed.ts`
    - Seed employee system roles: `super_admin`, `content_manager`, `sales_manager`, `finance`, `viewer` (all with `isSystem: true`)
    - Seed broker system roles: `agency_admin`, `agent` (all with `isSystem: true`)
    - Seed permissions for each role per the design:
      - `super_admin`: all permissions (wildcard or explicit full set)
      - `content_manager`: pages, blog posts, media, component templates permissions
      - `sales_manager`: broker management, bookings, lead-related permissions
      - `finance`: commissions, invoices, financial reporting permissions
      - `viewer`: read-only permissions across all resources
      - `agency_admin`: broker portal permissions for managing agents and company
      - `agent`: broker portal permissions for own bookings and leads
    - Seed `role_permissions` junction records linking roles to permissions
    - Make seed idempotent (upsert or check-before-insert)
    - _Requirements: 3.2, 3.3, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 10.2 Integrate seed into server startup at `lib/cms/api/server.ts`
    - Import and call the RBAC seed function alongside existing `seedSystemPages`
    - _Requirements: 3.2, 3.3_

- [x] 11. Data migration for existing users
  - [x] 11.1 Create data migration script
    - Set `user_type = 'employee'` for all existing users (handled by column default)
    - Set `is_active = true` and `email_verified = true` for all existing users
    - Create an `employee_profiles` record for each existing user with default department and job_title values
    - Assign the `super_admin` role to all existing users via `user_roles`
    - Ensure migration is idempotent — safe to run multiple times without creating duplicates
    - Preserve all existing foreign key relationships to the users table
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 11.2 Write property test: Migration idempotence
    - **Property 27: Migration idempotence**
    - **Validates: Requirements 12.5**

  - [x] 11.3 Write property test: Migration creates profiles and assigns roles for existing users
    - **Property 28: Migration creates profiles and assigns roles for existing users**
    - **Validates: Requirements 12.3, 12.4**

- [x] 12. Update existing auth flow for backward compatibility
  - [x] 12.1 Update `authPlugin` login in `lib/cms/api/auth.ts`
    - Modify login to handle nullable `passwordHash` (reject login for users with null password_hash)
    - Add `userType`, `isActive`, `emailVerified` checks to login flow
    - Return enhanced session data on successful login
    - _Requirements: 1.6, 5.2, 14.1_

  - [x] 12.2 Update `authPlugin` register in `lib/cms/api/auth.ts`
    - Set `userType: "employee"` for users created via the existing register endpoint
    - Set `emailVerified: true` for admin-registered users (backward compatibility)
    - _Requirements: 1.4, 12.1_

  - [x] 12.3 Wire middleware guards into existing API routes
    - Add `identityGuard` to existing protected route groups in `lib/cms/api/routes/`
    - Add `requirePermission` with appropriate permission strings to existing endpoints (pages, posts, media, settings, etc.)
    - Ensure routes without explicit permission still require valid authentication
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Frontend session integration and panel visibility
  - [x] 14.1 Update session hooks and types for identity context
    - Update session response types in frontend to include `userType`, `roles`, `permissions`, and optional `broker` context
    - Update any existing session hooks to consume the enhanced session data
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 14.2 Implement permission-based navigation filtering in `app/ora-panel/layout.tsx`
    - Filter `navItems` based on the current user's resolved permissions from the session
    - Show only menu items for which the user has at least one relevant permission
    - `super_admin` sees all items; `content_manager` sees pages/blog/media; `sales_manager` sees broker/bookings; `finance` sees financial sections; `viewer` sees read-only views
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [x] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- Client and vendor profile tables are created but reserved for future implementation
- The migration must run before seed data to ensure existing users get employee profiles and super_admin roles
- SMTP/email functionality for broker welcome emails can be stubbed initially (same pattern as approval notifications)
- All 28 correctness properties from the design are covered across 11 property test files

