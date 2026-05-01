# Requirements Document

## Introduction

The RBAC Identity System introduces a comprehensive Role-Based Access Control and Multi-Tenant Identity layer to the Ora platform. The system transforms the existing single-type user model into a multi-tenant identity model supporting four user types — employees, brokers, clients, and vendors — each with dedicated portals and profile schemas. A granular permission system using a resource:action pattern governs what each user can do, while a zero-trust middleware validates every request against user type, portal scope, role assignments, and individual permissions. The broker subsystem adds multi-tenancy through broker companies that own agents, with a full registration-to-approval lifecycle. Existing users are migrated to the employee type with backward-compatible profiles.

## Glossary

- **Identity_System**: The core module responsible for user authentication, user type discrimination, profile management, and session handling across all portals.
- **User_Type**: A discriminator on the users table that classifies a user as one of: "employee", "broker", "client", or "vendor". Each type maps to a dedicated portal and profile table.
- **Employee**: A user with user_type "employee" who accesses the Ora admin panel at /ora-panel. Employees are Ora staff such as content editors, sales managers, finance personnel, and super administrators.
- **Broker**: A user with user_type "broker" who accesses the broker portal at /broker-portal. Brokers are either agency administrators or agents belonging to a Broker_Company.
- **Client**: A user with user_type "client" who accesses the client portal at /client-portal. Clients are property buyers or investors. This type is reserved for future implementation.
- **Vendor**: A user with user_type "vendor" who accesses the vendor portal at /vendor-portal. Vendors are suppliers, contractors, or service providers. This type is reserved for future implementation.
- **Portal**: A URL-scoped section of the application dedicated to a specific User_Type. Each portal path prefix maps to exactly one User_Type.
- **RBAC_Engine**: The module that evaluates whether a user has the required permission to perform an action, based on the user's assigned roles and the permissions attached to those roles.
- **Role**: A named grouping of permissions scoped to a specific User_Type. Employee roles include super_admin, content_manager, sales_manager, finance, and viewer. Broker roles include agency_admin and agent.
- **Permission**: A granular access right expressed as a resource:action string (e.g., "pages:publish", "bookings:create", "commissions:approve").
- **Role_Permission**: A junction record linking a Role to a Permission, defining which actions a role grants.
- **User_Role**: A junction record linking a user to a Role, with tracking of who granted the assignment and when.
- **Zero_Trust_Middleware**: The per-request validation pipeline that extracts the session, verifies user status, confirms portal-type alignment, loads roles and permissions, and enforces the required permission for the endpoint.
- **Broker_Company**: An organization record representing a brokerage agency. A Broker_Company has a status (pending, active, suspended, rejected) and owns one or more Broker_Profiles.
- **Broker_Profile**: A profile record linking a broker user to a Broker_Company, tracking whether the user is the company administrator and the profile's active/inactive status.
- **Employee_Profile**: A profile record for employee users containing department, job title, and employee-specific metadata.
- **Registration_Flow**: The multi-step process by which a new broker agency applies for access, is reviewed by an Ora administrator, and upon approval receives credentials.
- **Permission_Check**: The act of verifying that a user's loaded permissions include the specific resource:action string required by an endpoint.
- **Migration_Service**: The component responsible for transitioning existing users to the employee User_Type and creating corresponding Employee_Profile records.

## Requirements

### Requirement 1: Multi-Type User Identity Model

**User Story:** As a platform architect, I want the users table to support multiple user types with a discriminator column, so that a single authentication system can serve employees, brokers, clients, and vendors with type-specific behavior.

#### Acceptance Criteria

1. THE Identity_System SHALL extend the existing users table with a user_type column that accepts the values "employee", "broker", "client", and "vendor".
2. THE Identity_System SHALL extend the existing users table with an is_active boolean column that defaults to true.
3. THE Identity_System SHALL extend the existing users table with an email_verified boolean column that defaults to false.
4. WHEN a new user is created, THE Identity_System SHALL require a valid user_type value to be provided.
5. THE Identity_System SHALL enforce that every user has exactly one user_type value that does not change after creation.
6. THE Identity_System SHALL allow the password_hash column to be nullable to support broker users who are created before credentials are issued.

### Requirement 2: Type-Specific Profile Tables

**User Story:** As a platform architect, I want each user type to have a dedicated profile table, so that type-specific data is cleanly separated from the shared user record.

#### Acceptance Criteria

1. THE Identity_System SHALL provide an employee_profiles table with columns for user_id (foreign key to users), department, job_title, and phone_number.
2. THE Identity_System SHALL provide a broker_companies table with columns for id, company_name, trade_license_number, trade_license_document_url, contact_email, contact_phone, status (pending, active, suspended, rejected), and timestamps.
3. THE Identity_System SHALL provide a broker_profiles table with columns for user_id (foreign key to users), company_id (foreign key to broker_companies), is_company_admin boolean, status (active, inactive), and timestamps.
4. THE Identity_System SHALL provide a client_profiles table with columns for user_id (foreign key to users) and timestamps, reserved for future use.
5. THE Identity_System SHALL provide a vendor_profiles table with columns for user_id (foreign key to users) and timestamps, reserved for future use.
6. THE Identity_System SHALL enforce a one-to-one relationship between a user and the profile table corresponding to the user's user_type.

### Requirement 3: Role Definition and Scoping

**User Story:** As a super administrator, I want roles to be defined and scoped by user type, so that employee roles and broker roles remain separate and cannot be cross-assigned.

#### Acceptance Criteria

1. THE RBAC_Engine SHALL provide a roles table with columns for id, name, display_name, description, user_type scope, is_system boolean, and timestamps.
2. THE RBAC_Engine SHALL seed the following system roles for user_type "employee": super_admin, content_manager, sales_manager, finance, and viewer.
3. THE RBAC_Engine SHALL seed the following system roles for user_type "broker": agency_admin and agent.
4. WHEN a role is assigned to a user, THE RBAC_Engine SHALL verify that the role's user_type scope matches the user's user_type.
5. THE RBAC_Engine SHALL prevent deletion of system roles (is_system = true).
6. THE RBAC_Engine SHALL enforce unique role names within the same user_type scope.

### Requirement 4: Granular Permission Model

**User Story:** As a super administrator, I want permissions defined as resource:action pairs, so that access control is fine-grained and auditable.

#### Acceptance Criteria

1. THE RBAC_Engine SHALL provide a permissions table with columns for id, resource, action, and description.
2. THE RBAC_Engine SHALL enforce that each permission is expressed as a resource:action string where resource and action are non-empty alphanumeric strings separated by a colon.
3. THE RBAC_Engine SHALL enforce unique combinations of resource and action in the permissions table.
4. THE RBAC_Engine SHALL provide a role_permissions junction table linking roles to permissions.
5. THE RBAC_Engine SHALL provide a user_roles junction table linking users to roles, with columns for granted_by (foreign key to users) and granted_at timestamp.
6. WHEN a role is deleted, THE RBAC_Engine SHALL cascade-delete all role_permissions and user_roles records associated with that role.

### Requirement 5: Zero-Trust Per-Request Authorization

**User Story:** As a security engineer, I want every API request to be validated against the user's type, status, roles, and permissions, so that no request is implicitly trusted.

#### Acceptance Criteria

1. WHEN an API request is received, THE Zero_Trust_Middleware SHALL extract the session token and resolve the user_id.
2. WHEN a user_id is resolved, THE Zero_Trust_Middleware SHALL verify that the user's is_active flag is true and email_verified flag is true.
3. WHEN a request targets a portal-scoped path, THE Zero_Trust_Middleware SHALL verify that the user's user_type matches the portal prefix (/ora-panel requires "employee", /broker-portal requires "broker", /client-portal requires "client", /vendor-portal requires "vendor").
4. WHEN a user passes type and status checks, THE Zero_Trust_Middleware SHALL load all roles assigned to the user via the user_roles table.
5. WHEN roles are loaded, THE Zero_Trust_Middleware SHALL resolve all permissions granted by those roles via the role_permissions table.
6. WHEN an endpoint requires a specific permission, THE Zero_Trust_Middleware SHALL check that the resolved permission set includes the required resource:action string.
7. IF any validation step fails, THEN THE Zero_Trust_Middleware SHALL return an appropriate HTTP error (401 for authentication failures, 403 for authorization failures) and halt request processing.
8. WHEN a broker user passes initial checks, THE Zero_Trust_Middleware SHALL additionally verify that the broker_profiles.status is "active" and the associated broker_companies.status is "active".

### Requirement 6: Portal-Type Isolation

**User Story:** As a platform operator, I want each portal to be accessible only by its designated user type, so that employees cannot access broker features and vice versa.

#### Acceptance Criteria

1. THE Zero_Trust_Middleware SHALL map the portal path prefix /ora-panel to user_type "employee".
2. THE Zero_Trust_Middleware SHALL map the portal path prefix /broker-portal to user_type "broker".
3. THE Zero_Trust_Middleware SHALL map the portal path prefix /client-portal to user_type "client".
4. THE Zero_Trust_Middleware SHALL map the portal path prefix /vendor-portal to user_type "vendor".
5. IF a user's user_type does not match the portal being accessed, THEN THE Zero_Trust_Middleware SHALL return HTTP 403 and deny access.
6. THE Zero_Trust_Middleware SHALL apply portal-type checks before loading roles and permissions to fail fast on type mismatches.

### Requirement 7: Broker Company Registration Flow

**User Story:** As a brokerage agency owner, I want to register my company and admin account through a public form, so that I can apply for access to the broker portal.

#### Acceptance Criteria

1. THE Registration_Flow SHALL provide a public registration endpoint at /broker-portal/register that accepts company details (company_name, trade_license_number, trade_license_document, contact_email, contact_phone) and admin person details (name, email, phone).
2. WHEN a valid registration is submitted, THE Registration_Flow SHALL create a Broker_Company record with status "pending".
3. WHEN a valid registration is submitted, THE Registration_Flow SHALL create a user record with user_type "broker", is_active false, email_verified false, and a null password_hash.
4. WHEN a valid registration is submitted, THE Registration_Flow SHALL create a Broker_Profile record linking the user to the company with is_company_admin set to true and status "inactive".
5. WHEN a valid registration is submitted, THE Registration_Flow SHALL assign the "agency_admin" role to the newly created broker user.
6. IF a registration is submitted with an email that already exists in the users table, THEN THE Registration_Flow SHALL reject the submission with a descriptive error.
7. THE Registration_Flow SHALL validate that all required fields are present and that the email format is valid before creating any records.

### Requirement 8: Broker Application Review by Ora Admin

**User Story:** As an Ora administrator, I want to review pending broker applications and approve or reject them, so that only vetted agencies gain access to the broker portal.

#### Acceptance Criteria

1. THE Identity_System SHALL display pending Broker_Company applications in the Ora admin panel at /ora-panel/broker/agencies.
2. THE Identity_System SHALL display company details, uploaded documents, and admin contact information for each pending application.
3. WHEN an Ora administrator approves a Broker_Company application, THE Identity_System SHALL set the Broker_Company status to "active".
4. WHEN an Ora administrator approves a Broker_Company application, THE Identity_System SHALL set the associated broker user's is_active flag to true and the Broker_Profile status to "active".
5. WHEN an Ora administrator approves a Broker_Company application, THE Identity_System SHALL generate a temporary password for the broker admin user and send a welcome email containing the temporary password and a login link to /broker-portal.
6. WHEN an Ora administrator rejects a Broker_Company application, THE Identity_System SHALL set the Broker_Company status to "rejected" and send a rejection notification email to the applicant.
7. THE Identity_System SHALL require the "brokers:manage" permission to access the broker application review functionality.

### Requirement 9: Broker Agent Management

**User Story:** As a broker agency admin, I want to add and manage agents within my company, so that my team members can access the broker portal with appropriate permissions.

#### Acceptance Criteria

1. WHEN a broker agency admin adds an agent, THE Identity_System SHALL create a user record with user_type "broker", is_active true, email_verified false, and a null password_hash.
2. WHEN a broker agency admin adds an agent, THE Identity_System SHALL create a Broker_Profile record linking the agent to the same Broker_Company with is_company_admin set to false and status "active".
3. WHEN a broker agency admin adds an agent, THE Identity_System SHALL assign the "agent" role to the new user.
4. WHEN a broker agency admin adds an agent, THE Identity_System SHALL generate a temporary password and send a welcome email to the agent with credentials and a login link.
5. THE Identity_System SHALL restrict agent management to broker users who have is_company_admin set to true in their Broker_Profile.
6. WHEN a broker agency admin deactivates an agent, THE Identity_System SHALL set the agent's Broker_Profile status to "inactive" and the user's is_active flag to false.
7. THE Identity_System SHALL prevent a broker agency admin from managing agents belonging to a different Broker_Company.

### Requirement 10: Broker Company Status Cascade

**User Story:** As an Ora administrator, I want suspending a broker company to automatically lock out all its agents, so that company-level enforcement applies to all members.

#### Acceptance Criteria

1. WHEN an Ora administrator sets a Broker_Company status to "suspended", THE Identity_System SHALL set is_active to false for all users linked to that company via broker_profiles.
2. WHEN an Ora administrator reactivates a Broker_Company by setting status to "active", THE Identity_System SHALL set is_active to true for all users linked to that company whose Broker_Profile status is "active".
3. WHILE a Broker_Company status is "suspended", THE Zero_Trust_Middleware SHALL deny access to all users linked to that company regardless of their individual is_active flag.
4. THE Identity_System SHALL log all company status changes in the audit log with the administrator's user_id, the company_id, and the old and new status values.

### Requirement 11: Employee Role-Based Panel Visibility

**User Story:** As an Ora employee, I want the admin panel to show only the sections I have permission to access, so that the interface is relevant to my role.

#### Acceptance Criteria

1. THE Identity_System SHALL expose the current user's resolved permissions to the frontend via the session endpoint.
2. WHEN rendering the Ora admin panel navigation, THE Identity_System SHALL display only the menu items for which the current user has at least one relevant permission.
3. THE RBAC_Engine SHALL grant the super_admin role all permissions across all resources.
4. THE RBAC_Engine SHALL grant the content_manager role permissions for pages, blog posts, media, and component templates.
5. THE RBAC_Engine SHALL grant the sales_manager role permissions for broker management, bookings, and lead-related resources.
6. THE RBAC_Engine SHALL grant the finance role permissions for commissions, invoices, and financial reporting resources.
7. THE RBAC_Engine SHALL grant the viewer role read-only permissions across all resources.

### Requirement 12: Existing User Migration

**User Story:** As a platform operator, I want all existing users to be migrated to the employee type with appropriate profiles, so that the transition to the multi-type model is seamless.

#### Acceptance Criteria

1. THE Migration_Service SHALL add the user_type column to the existing users table with a default value of "employee" so that all existing rows receive the "employee" type.
2. THE Migration_Service SHALL add the is_active column with a default value of true and the email_verified column with a default value of true for all existing users.
3. THE Migration_Service SHALL create an Employee_Profile record for each existing user with default values for department and job_title.
4. THE Migration_Service SHALL assign the super_admin role to all existing users to preserve their current unrestricted access.
5. THE Migration_Service SHALL execute as a database migration that is idempotent and safe to run multiple times.
6. THE Migration_Service SHALL preserve all existing foreign key relationships to the users table without data loss.

### Requirement 13: Permission-Protected API Endpoints

**User Story:** As a security engineer, I want every API endpoint to declare its required permission, so that the zero-trust middleware can enforce access control consistently.

#### Acceptance Criteria

1. THE RBAC_Engine SHALL provide a mechanism for each API route to declare the required resource:action permission string.
2. WHEN an API route declares a required permission, THE Zero_Trust_Middleware SHALL enforce that the requesting user's resolved permissions include that permission before executing the route handler.
3. IF an API route does not declare a required permission, THEN THE Zero_Trust_Middleware SHALL require only valid authentication (session and active user) to access the route.
4. THE RBAC_Engine SHALL provide a helper function that accepts a permission string and returns an Elysia-compatible middleware guard.
5. THE RBAC_Engine SHALL support wildcard permissions where a role with "resource:*" has access to all actions on that resource.

### Requirement 14: Session Enhancement with Identity Context

**User Story:** As a frontend developer, I want the session endpoint to return the user's type, roles, and permissions, so that the UI can render appropriate navigation and controls.

#### Acceptance Criteria

1. WHEN a valid session is queried, THE Identity_System SHALL return the user's user_type, is_active status, and email_verified status in the session response.
2. WHEN a valid session is queried, THE Identity_System SHALL return the list of role names assigned to the user.
3. WHEN a valid session is queried, THE Identity_System SHALL return the full list of resolved permission strings for the user.
4. WHEN a valid session is queried for a broker user, THE Identity_System SHALL return the Broker_Company id, company_name, and company status.
5. WHEN a valid session is queried for a broker user, THE Identity_System SHALL return the Broker_Profile is_company_admin flag and profile status.
6. THE Identity_System SHALL cache the resolved roles and permissions for the duration of the session to avoid repeated database lookups on every request.

### Requirement 15: Audit Trail for RBAC Operations

**User Story:** As a compliance officer, I want all role assignments, permission changes, and access denials to be logged, so that security events are traceable.

#### Acceptance Criteria

1. WHEN a role is assigned to or removed from a user, THE RBAC_Engine SHALL create an audit log entry recording the actor user_id, the target user_id, the role name, and the action (assign or revoke).
2. WHEN a permission is added to or removed from a role, THE RBAC_Engine SHALL create an audit log entry recording the actor user_id, the role name, the permission string, and the action (add or remove).
3. WHEN the Zero_Trust_Middleware denies a request due to insufficient permissions, THE RBAC_Engine SHALL create an audit log entry recording the user_id, the requested resource:action, and the denial reason.
4. WHEN a Broker_Company status changes, THE Identity_System SHALL create an audit log entry recording the administrator user_id, the company_id, the previous status, and the new status.
5. THE RBAC_Engine SHALL use the existing audit_log table schema with entity_type values of "role_assignment", "permission_change", "access_denial", and "company_status_change".
