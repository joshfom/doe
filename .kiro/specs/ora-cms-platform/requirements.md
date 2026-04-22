# Requirements Document

## Introduction

This document defines the requirements for the ORA CMS Platform — a full content management system built on top of the existing Puck visual page builder module (`lib/page-builder/`). The platform wraps the builder with a complete admin panel, multilingual page management (English/Arabic), media library, form builder, site settings, authentication, versioning, and a public frontend. The tech stack uses Elysia.js for the backend API, Better Auth for authentication, Drizzle ORM for database access, and TanStack Query with optimistic updates for client-side state management. The existing page builder components (HeroBanner, ContentBlock, PropertyCard, etc.) are consumed as-is; this spec focuses exclusively on the CMS platform layer.

## Glossary

- **CMS_Platform**: The complete ORA content management system encompassing the Admin_Panel, Public_Frontend, API_Layer, and all supporting subsystems
- **Admin_Panel**: The protected administrative interface served at `/ora-panel` for managing pages, media, forms, settings, and audit history
- **Public_Frontend**: The server-rendered public website that displays published page content at clean locale-prefixed URLs
- **API_Layer**: The Elysia.js backend API that provides type-safe endpoints for all CMS operations (pages, media, forms, settings, auth)
- **Page_Builder**: The existing Puck-based visual page builder module at `lib/page-builder/` including all registered ORA components, Editor, and Renderer
- **PageData**: The JSON payload format produced by the Page_Builder (defined in `lib/page-builder/types.ts`) that describes a page's component tree and props
- **Page_Record**: A database entity combining page metadata (title, slug, status, locale, timestamps) with its PageData JSON content
- **System_Page**: A page created automatically during first setup (Home and Contact) that cannot be deleted by users
- **Locale_Pair**: Two Page_Records sharing the same namespace but differing in locale (EN and AR), representing the same logical page in two languages
- **Namespace**: A shared identifier that groups Locale_Pair pages together, enabling the system to associate EN and AR versions of the same page
- **Revision**: A timestamped snapshot of a Page_Record's PageData and metadata, stored for version history and rollback
- **Audit_Entry**: A log record capturing which user performed what action on which entity, with a timestamp
- **Media_Item**: A file (image) stored in the configured storage backend with metadata (filename, dimensions, alt text, MIME type, storage URL)
- **Media_Picker**: A UI component within the Page_Builder editor that allows selecting Media_Items from the Media_Library for use in page components
- **Form_Definition**: A configuration object describing a form's fields, validation rules, and submission endpoints, created via the visual Form_Builder
- **Form_Submission**: A database record containing the data submitted by a public user through a rendered Form_Definition
- **Site_Settings**: A global key-value configuration stored in the database (social links, phone, email, address, company name) that components can reference
- **Slug**: A URL-safe string derived from a page title using the slugify package, used as the page's URL path segment
- **Storage_Backend**: The configurable file storage destination for media uploads (local filesystem, AWS S3, or Cloudflare R2)
- **Auth_Session**: A Better Auth session representing an authenticated admin user with access to the Admin_Panel

## Requirements

### Requirement 1: Admin Panel Shell and Authentication

**User Story:** As an administrator, I want a protected admin panel at `/ora-panel` with login required, so that only authorized users can manage CMS content.

#### Acceptance Criteria

1. THE CMS_Platform SHALL serve the Admin_Panel at the `/ora-panel` route prefix, completely separated from Public_Frontend routes with no route conflicts
2. WHEN an unauthenticated user navigates to any `/ora-panel` route, THE Admin_Panel SHALL redirect the user to the login page
3. WHEN a user submits valid credentials on the login page, THE Auth_Session SHALL be created using Better Auth and THE Admin_Panel SHALL redirect the user to the dashboard
4. IF a user submits invalid credentials, THEN THE Admin_Panel SHALL display a descriptive error message without revealing whether the username or password was incorrect
5. THE Admin_Panel SHALL provide a dashboard view at `/ora-panel` displaying an overview of total pages, published pages, draft pages, recent form submissions count, and media items count
6. THE Admin_Panel SHALL provide navigation to the following sections: Dashboard, Pages, Media Library, Form Submissions, Site Settings, and Audit Log
7. WHEN an authenticated user clicks a logout action, THE Auth_Session SHALL be terminated and THE Admin_Panel SHALL redirect the user to the login page

### Requirement 2: Page CRUD and Slug Generation

**User Story:** As a content editor, I want to create, read, update, and delete pages with auto-generated slugs, so that I can manage site content efficiently.

#### Acceptance Criteria

1. WHEN a user creates a new page with a title, THE CMS_Platform SHALL auto-generate a Slug from the title using the slugify package
2. WHEN a Slug is generated, THE CMS_Platform SHALL check the database for duplicates and append a numeric suffix if the Slug already exists
3. THE CMS_Platform SHALL allow users to manually override the auto-generated Slug before saving
4. THE API_Layer SHALL expose type-safe endpoints for creating, reading, updating, listing, and deleting Page_Records via Elysia.js
5. WHEN a user updates a page's title, THE CMS_Platform SHALL offer to regenerate the Slug while warning that changing a published page's Slug affects its public URL
6. THE CMS_Platform SHALL store PageData as a JSON column in the database using Drizzle ORM
7. WHEN a page is deleted, THE CMS_Platform SHALL delete all Revisions and Audit_Entries associated with that page
8. THE Admin_Panel SHALL use TanStack Query with optimistic updates for all page CRUD operations to provide immediate UI feedback

### Requirement 3: System Pages and First-Run Setup

**User Story:** As a platform operator, I want Home and Contact pages created automatically on first setup, so that the site has essential pages from the start.

#### Acceptance Criteria

1. WHEN the CMS_Platform is initialized for the first time (empty database), THE CMS_Platform SHALL create a Home page with Slug `/` and a Contact page with Slug `contact` as System_Pages in both EN and AR locales
2. THE CMS_Platform SHALL mark System_Pages with a flag that prevents deletion through the Admin_Panel or API_Layer
3. IF a user attempts to delete a System_Page, THEN THE CMS_Platform SHALL reject the operation and display a message indicating that system pages cannot be deleted
4. THE CMS_Platform SHALL allow System_Pages to be edited, published, and unpublished like any other page

### Requirement 4: Draft and Published Status

**User Story:** As a content editor, I want pages to have draft and published states, so that I can prepare content without it being visible to the public.

#### Acceptance Criteria

1. WHEN a new page is created, THE CMS_Platform SHALL set its initial status to draft
2. WHEN a user publishes a page, THE CMS_Platform SHALL change the status to published and record a published timestamp
3. WHEN a user unpublishes a page, THE CMS_Platform SHALL change the status back to draft
4. WHILE a page has draft status, THE Public_Frontend SHALL NOT render the page at its public URL
5. WHEN a public user requests the URL of a draft page, THE Public_Frontend SHALL return a 404 response
6. THE Admin_Panel SHALL provide an internal preview URL for each page that renders the current PageData regardless of publish status, accessible only to authenticated users

### Requirement 5: Page Versioning and Revision History

**User Story:** As a content editor, I want every page save to create a revision, so that I can view history and roll back to previous versions.

#### Acceptance Criteria

1. WHEN a user saves changes to a page, THE CMS_Platform SHALL create a new Revision containing a snapshot of the PageData, the page metadata, and a timestamp
2. THE CMS_Platform SHALL store Revisions in the database using Drizzle ORM with a foreign key reference to the parent Page_Record
3. THE Admin_Panel SHALL display a revision history list for each page showing revision number, timestamp, and the user who made the change
4. WHEN a user selects a previous Revision, THE Admin_Panel SHALL display a preview of that Revision's PageData
5. WHEN a user confirms a rollback to a selected Revision, THE CMS_Platform SHALL replace the current PageData with the selected Revision's PageData and create a new Revision recording the rollback action
6. THE CMS_Platform SHALL retain all Revisions for a page until the page is deleted

### Requirement 6: Audit Log

**User Story:** As an administrator, I want an audit log tracking who changed what and when, so that I can monitor content changes and maintain accountability.

#### Acceptance Criteria

1. WHEN a user performs a create, update, delete, publish, unpublish, or rollback action on any entity, THE CMS_Platform SHALL create an Audit_Entry recording the user identifier, action type, entity type, entity identifier, and timestamp
2. THE Admin_Panel SHALL provide an audit log viewer at `/ora-panel/audit` displaying Audit_Entries in reverse chronological order
3. THE Admin_Panel SHALL support filtering Audit_Entries by entity type, action type, user, and date range
4. THE Audit_Entry SHALL store a summary of the changes made (e.g., which fields changed) when applicable

### Requirement 7: Multilingual Page Management (EN/AR)

**User Story:** As a content editor, I want to manage pages in English and Arabic as locale pairs, so that the site serves content in both languages.

#### Acceptance Criteria

1. THE CMS_Platform SHALL support two configurable locales: English (EN) and Arabic (AR)
2. WHEN a user creates a new page, THE CMS_Platform SHALL create it in the EN locale and assign it a Namespace identifier
3. WHEN a user creates the AR version of an existing EN page, THE CMS_Platform SHALL clone the EN PageData into a new AR Page_Record sharing the same Namespace and Slug
4. THE Admin_Panel page index SHALL display language completion status for each Namespace using color indicators: green when all locales are published, amber when only one locale is published, and gray when no locale is published
5. WHEN a Namespace is missing a locale version, THE Admin_Panel SHALL display a clickable action to create the missing locale version from the page index
6. THE CMS_Platform SHALL automatically assign the same Slug to both locale versions within a Namespace
7. WHEN the AR locale version of a page is rendered, THE Public_Frontend SHALL apply `dir="rtl"` to the HTML document and load an Arabic font

### Requirement 8: URL Routing with Default Language

**User Story:** As a site visitor, I want English pages served at clean URLs without a prefix and Arabic pages at `/ar/` prefixed URLs, so that the default language loads directly without redirects.

#### Acceptance Criteria

1. THE Public_Frontend SHALL serve EN pages (default language) at `/{slug}` without a locale prefix (e.g., `domain.com/about`)
2. THE Public_Frontend SHALL serve AR pages at `/ar/{slug}` with the `/ar/` locale prefix (e.g., `domain.com/ar/about`)
3. THE Public_Frontend SHALL serve the EN Home page at `/` (root URL, no redirect) and the AR Home page at `/ar/`
4. THE Public_Frontend SHALL include `hreflang` tags on every page: `<link rel="alternate" hreflang="en" href="/{slug}" />` and `<link rel="alternate" hreflang="ar" href="/ar/{slug}" />`
5. WHEN a public user requests a URL with a non-existent or draft Slug, THE Public_Frontend SHALL return a 404 response
6. WHEN a public user requests a URL under `/ar/` with a non-existent or draft Slug, THE Public_Frontend SHALL return a 404 response
7. THE Public_Frontend SHALL render pages server-side (SSR via Next.js) for SEO optimization
8. THE Public_Frontend SHALL NOT redirect crawlers or users from the root URL — `/` SHALL directly serve the English home page content

### Requirement 9: Media Library Management

**User Story:** As a content editor, I want a media library to upload, browse, and manage images, so that I can reuse media assets across pages.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a media management interface at `/ora-panel/media`
2. WHEN a user uploads an image, THE CMS_Platform SHALL store the file in the configured Storage_Backend (local filesystem, S3, or R2) and create a Media_Item record in the database with filename, dimensions, alt text, MIME type, file size, and storage URL
3. THE Admin_Panel SHALL support browsing Media_Items with search by filename and alt text, and filtering by MIME type
4. THE CMS_Platform SHALL track which Page_Records and component instances reference each Media_Item
5. IF a user attempts to delete a Media_Item that is referenced by one or more Page_Records, THEN THE CMS_Platform SHALL reject the deletion and display a message listing the pages that reference the media
6. WHEN a Media_Item is not referenced by any Page_Record, THE CMS_Platform SHALL allow deletion of both the database record and the stored file
7. THE Page_Builder editor SHALL include a Media_Picker component that allows users to browse and select Media_Items from the Media_Library when editing image fields in components

### Requirement 10: Form Builder and Submissions

**User Story:** As a content editor, I want to build forms visually and view submissions in the admin panel, so that I can capture leads and user data without developer involvement.

#### Acceptance Criteria

1. THE Page_Builder SHALL include a Form component that can be placed on any page via the visual editor
2. THE Form component SHALL support the following field types: text, email, phone, textarea, select, checkbox, and radio
3. WHEN a public user submits a form on the Public_Frontend, THE CMS_Platform SHALL validate the submission data and store it as a Form_Submission record in the database
4. THE Admin_Panel SHALL provide a form submissions viewer at `/ora-panel/submissions` displaying submissions grouped by form, with timestamp and submission data
5. THE CMS_Platform SHALL support a configurable Salesforce integration endpoint for pushing Form_Submission data as leads
6. THE CMS_Platform SHALL support a configurable webhook URL per Form_Definition for pushing Form_Submission data to external systems via HTTP POST
7. IF a form submission fails validation, THEN THE Public_Frontend SHALL display field-level error messages and preserve the user's input

### Requirement 11: Site Settings

**User Story:** As an administrator, I want global site settings stored in the database, so that I can change shared information (social links, contact details, company name) once and have it update everywhere.

#### Acceptance Criteria

1. THE CMS_Platform SHALL store Site_Settings as key-value pairs in the database, including: company name, phone number, email address, physical address, and social media links
2. THE Admin_Panel SHALL provide a settings editor at `/ora-panel/settings` for modifying Site_Settings
3. WHEN a Site_Settings value is updated, THE CMS_Platform SHALL make the updated value available to all page renders without requiring page republication
4. THE Public_Frontend SHALL inject Site_Settings into the page rendering context so that Page_Builder components can reference settings values (e.g., displaying the company phone number in a footer component)
5. WHEN a Site_Settings key is referenced by a component but the key has no value, THE Public_Frontend SHALL render an empty string for that reference

### Requirement 12: Page Builder Integration in Admin Panel

**User Story:** As a content editor, I want the visual page builder embedded within the admin panel, so that I can edit pages without leaving the CMS.

#### Acceptance Criteria

1. THE Admin_Panel SHALL embed the Page_Builder Editor component for creating and editing page content within the `/ora-panel/pages/{id}/edit` route
2. WHEN a user opens a page for editing, THE Admin_Panel SHALL load the page's current PageData into the Page_Builder Editor
3. WHEN a user saves in the Page_Builder Editor, THE CMS_Platform SHALL persist the updated PageData through the API_Layer, create a Revision, and record an Audit_Entry
4. WHEN an authenticated user views a published page on the Public_Frontend, THE Public_Frontend SHALL display an "Edit page" button that navigates to the Admin_Panel editor for that page
5. THE Admin_Panel SHALL pass the Media_Picker and Site_Settings context to the Page_Builder Editor so that components can access media and settings during editing

### Requirement 13: Public Frontend Rendering

**User Story:** As a site visitor, I want published pages rendered with clean URLs and SEO-friendly markup, so that I can browse the site and search engines can index it.

#### Acceptance Criteria

1. THE Public_Frontend SHALL render published pages using the Page_Builder Renderer component with the stored PageData and Component_Library configuration
2. THE Public_Frontend SHALL inject Site_Settings into the rendering context so that components can display global values
3. WHEN a page's PageData references a component key that does not exist in the Component_Library, THE Public_Frontend SHALL skip the unknown component and render the remaining content without error
4. THE Public_Frontend SHALL generate appropriate HTML meta tags (title, description, Open Graph) from page metadata for SEO
5. WHEN a public user requests a URL that does not match any published page, THE Public_Frontend SHALL return a 404 page

### Requirement 14: API Layer and Type Safety

**User Story:** As a developer, I want a fully type-safe API layer using Elysia.js and Drizzle ORM, so that the frontend and backend share validated types and runtime errors are minimized.

#### Acceptance Criteria

1. THE API_Layer SHALL be implemented using Elysia.js with request and response validation schemas derived from Drizzle ORM table definitions
2. THE API_Layer SHALL expose RESTful endpoints for all CMS entities: pages, revisions, media, form submissions, site settings, and audit entries
3. THE API_Layer SHALL validate all incoming request bodies and query parameters against typed schemas and return descriptive error responses for invalid input
4. THE API_Layer SHALL require a valid Auth_Session for all mutating endpoints (create, update, delete, publish, unpublish)
5. THE API_Layer SHALL allow unauthenticated read access to published page data and site settings for the Public_Frontend
6. FOR ALL Page_Record objects, serializing the PageData to JSON and parsing it back SHALL produce an equivalent PageData object (round-trip integrity)

### Requirement 15: Database Schema and ORM

**User Story:** As a developer, I want a well-structured database schema managed by Drizzle ORM, so that all CMS data is stored reliably with proper relationships and migrations.

#### Acceptance Criteria

1. THE CMS_Platform SHALL define Drizzle ORM schemas for the following entities: pages (with locale, namespace, slug, status, system flag, PageData JSON), revisions (with page reference, PageData snapshot, user reference, timestamp), media items (with storage URL, metadata, usage tracking), form definitions, form submissions, site settings, audit entries, and user accounts
2. THE CMS_Platform SHALL enforce referential integrity between related entities (e.g., revisions reference pages, audit entries reference users)
3. THE CMS_Platform SHALL use database indexes on frequently queried columns: page slug + locale, page namespace, page status, media item references, and audit entry timestamps
4. WHEN a page is deleted, THE CMS_Platform SHALL cascade-delete all associated revisions and audit entries

