# Implementation Plan: ORA AI Assistant

## Overview

Implements ORA AI — an autonomous AI virtual assistant for ORA's real estate platform. The implementation proceeds bottom-up: database schema extensions (clients, tenants, units, knowledge base, conversations, appointments, AI config) → AI core modules (identity resolver, language detector, scope boundary checker, RAG pipeline, action executor, content sync) → API routes under `/api/ai/*` → RBAC seed for AI permissions → admin panel pages under `/ora-panel/ai/*` → public chat widget component. All code is TypeScript, following existing Elysia.js route patterns, Drizzle ORM schema conventions, and TanStack Query admin panel patterns.

## Tasks

- [x] 1. Database schema extensions and type definitions
  - [x] 1.1 Add AI-related tables to `lib/cms/schema.ts`
    - Add `aiClients` table: id, firstName, lastName, email, phone, nationality, preferredLanguage (enum: en/ar), notes, createdAt, updatedAt
    - Add `aiTenants` table: id, firstName, lastName, email, phone, unitId (FK → aiUnits), leaseStartDate, leaseEndDate, rentAmount, paymentFrequency, notes, createdAt, updatedAt
    - Add `aiUnits` table: id, projectName, unitNumber, unitType (enum: apartment/villa/townhouse/office), floorNumber, areaSqm, status (enum: available/sold/reserved/rented/under_construction), constructionProgress (integer), estimatedHandoverDate, clientId (FK → aiClients, nullable), tenantId (FK → aiTenants, nullable), createdAt, updatedAt
    - Add indexes on aiClients phone, aiClients email, aiTenants phone, aiTenants email, aiUnits status
    - Add `knowledgeDocuments` table: id, title, content (text), sourceType (enum: manual/blog_sync/construction_update/faq/policy), category, locale (enum: en/ar), sourceRefId (nullable, for blog sync), lastIndexedAt, createdAt, updatedAt
    - Add `knowledgeEmbeddings` table: id, documentId (FK → knowledgeDocuments, onDelete cascade), embedding (vector(768)), chunkIndex (integer), chunkText (text), createdAt
    - Add `aiConversations` table: id, participantName, participantPhone, participantEmail, participantType (enum: client/tenant/visitor), clientId (FK → aiClients, nullable), tenantId (FK → aiTenants, nullable), channel (text), language (enum: en/ar), status (enum: active/resolved/handed_off/abandoned), handoffSummary (jsonb, nullable), resolvedAt, createdAt, updatedAt
    - Add `aiMessages` table: id, conversationId (FK → aiConversations, onDelete cascade), role (enum: user/assistant/system), content (text), metadata (jsonb — retrieved doc IDs, similarity scores, action performed), createdAt
    - Add `aiAppointments` table: id, referenceNumber (unique), conversationId (FK → aiConversations, nullable), clientId (FK → aiClients, nullable), tenantId (FK → aiTenants, nullable), contactName, contactEmail, contactPhone, appointmentType (enum: site_visit/consultation/payment_discussion/maintenance_request), scheduledDate, scheduledTime, status (enum: confirmed/cancelled/rescheduled/completed), notes, createdAt, updatedAt
    - Add `aiConfig` table: id, key (unique), value (text), updatedAt
    - Add indexes on aiConversations status, aiMessages conversationId, aiAppointments scheduledDate, aiAppointments status, knowledgeDocuments sourceType, knowledgeDocuments locale
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 3.1, 3.2, 5.1, 5.2, 6.1, 8.1, 13.1_

  - [x] 1.2 Extend type definitions in `lib/cms/types.ts`
    - Add `ConversationStatus` type: "active" | "resolved" | "handed_off" | "abandoned"
    - Add `AppointmentType` type: "site_visit" | "consultation" | "payment_discussion" | "maintenance_request"
    - Add `AppointmentStatus` type: "confirmed" | "cancelled" | "rescheduled" | "completed"
    - Add `UnitStatus` type: "available" | "sold" | "reserved" | "rented" | "under_construction"
    - Add `UnitType` type: "apartment" | "villa" | "townhouse" | "office"
    - Add `KnowledgeSourceType` type: "manual" | "blog_sync" | "construction_update" | "faq" | "policy"
    - Add `MessageRole` type: "user" | "assistant" | "system"
    - Extend `AuditAction` with AI-related actions: "ai_conversation_create", "ai_handoff", "ai_appointment_create", "ai_appointment_cancel", "ai_kb_create", "ai_kb_update", "ai_kb_delete", "ai_client_create", "ai_client_update", "ai_tenant_create", "ai_tenant_update", "ai_unit_create", "ai_unit_update"
    - Extend `AuditEntityType` with: "ai_conversation", "ai_appointment", "ai_knowledge_document", "ai_client", "ai_tenant", "ai_unit"
    - _Requirements: 12.1, 12.2, 12.3, 6.5, 8.1, 14.6_

  - [x] 1.3 Generate Drizzle migration
    - Run `npx drizzle-kit generate` to create the SQL migration file in `drizzle/`
    - Ensure the migration includes pgvector extension creation (`CREATE EXTENSION IF NOT EXISTS vector`)
    - Verify all new tables, indexes, and foreign keys are present in the generated migration
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 2. AI core — Identity resolver and language detector
  - [x] 2.1 Implement identity resolver at `lib/cms/ai/identity.ts`
    - Export `resolveIdentityByPhone(db, phone): Promise<IdentityResult>` — queries aiClients and aiTenants by phone, returns matched record(s) or null
    - Export `resolveIdentityBySession(db, userId): Promise<IdentityResult>` — resolves user from auth session, checks if linked to a client or tenant record
    - Export `resolveIdentityByEmail(db, email): Promise<IdentityResult>` — queries aiClients and aiTenants by email
    - Define `IdentityResult` type: `{ type: "client" | "tenant" | "visitor"; clientId?: string; tenantId?: string; firstName?: string; units: UnitRecord[] }`
    - Handle multiple matches by returning a disambiguation flag requiring additional info (email or unit number)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.2 Implement language detector at `lib/cms/ai/language.ts`
    - Export `detectLanguage(text: string): "en" | "ar"` — detects Arabic script using Unicode range check (\\u0600-\\u06FF)
    - Simple heuristic: if Arabic character ratio exceeds 30%, classify as Arabic; otherwise English
    - _Requirements: 11.1, 11.4_

  - [x] 2.3 Write unit tests for identity resolver
    - Test phone lookup matching a client, a tenant, and no match
    - Test multiple-match disambiguation
    - Test session-based resolution
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 2.4 Write unit tests for language detector
    - Test English text detection, Arabic text detection, mixed text, empty string
    - _Requirements: 11.1, 11.4_

- [x] 3. AI core — Scope boundary checker and RAG pipeline
  - [x] 3.1 Implement scope boundary checker at `lib/cms/ai/scope.ts`
    - Export `isWithinScope(query: string, config: ScopeConfig): boolean` — checks query against permitted topic categories and blocked keywords
    - Export `ScopeConfig` type: `{ permittedCategories: string[]; blockedKeywords: string[] }`
    - Export `loadScopeConfig(db): Promise<ScopeConfig>` — reads scope configuration from aiConfig table
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.2 Implement Cloudflare AI Gateway client at `lib/cms/ai/gateway.ts`
    - Export `generateEmbedding(text: string): Promise<number[]>` — calls Cloudflare AI Gateway embedding endpoint, returns 768-dimension vector
    - Export `generateCompletion(messages: ChatMessage[], options?: CompletionOptions): Promise<string>` — calls Cloudflare AI Gateway chat completion endpoint
    - Read gateway URL, API token, model IDs from environment variables (CF_AI_GATEWAY_URL, CF_AI_API_TOKEN, CF_EMBEDDING_MODEL, CF_CHAT_MODEL)
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 3.3 Implement RAG pipeline at `lib/cms/ai/rag.ts`
    - Export `retrieveContext(db, query: string, language: "en" | "ar", topK: number, threshold: number): Promise<RetrievedDocument[]>` — generates query embedding, performs pgvector similarity search, filters by relevance threshold, prefers documents matching conversation language
    - Export `buildPrompt(context: RAGContext): string` — constructs the LLM prompt with system instructions, retrieved documents, conversation history, user identity context, and current query
    - Export `processQuery(db, input: QueryInput): Promise<QueryResult>` — orchestrates the full RAG pipeline: embed query → retrieve context → build prompt → generate completion → return response with metadata
    - Define `RAGContext` type containing retrieved documents, conversation history, identity context, language, and current query
    - Log retrieved document IDs and similarity scores on each response
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 11.5_

  - [x] 3.4 Write unit tests for scope boundary checker
    - Test permitted query passes, blocked keyword query fails, out-of-scope query fails
    - _Requirements: 4.3, 4.4_

  - [x] 3.5 Write unit tests for RAG pipeline
    - Test embedding generation call, similarity search with threshold filtering, prompt construction with identity context
    - _Requirements: 5.2, 5.5, 5.6_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. AI core — Action executor and content sync
  - [x] 5.1 Implement action executor at `lib/cms/ai/actions.ts`
    - Export `bookAppointment(db, input: BookAppointmentInput): Promise<AppointmentResult>` — validates required fields, checks for time slot conflicts, creates appointment record with reference number, logs to audit
    - Export `cancelAppointment(db, referenceNumber: string, conversationId: string): Promise<void>` — updates appointment status to "cancelled", logs to audit
    - Export `rescheduleAppointment(db, referenceNumber: string, newDate: string, newTime: string): Promise<AppointmentResult>` — checks new slot availability, updates appointment, logs to audit
    - Export `suggestAlternativeSlots(db, date: string, appointmentType: string, count?: number): Promise<TimeSlot[]>` — finds nearest available time slots (default 3)
    - Export `lookupClientAccount(db, identityResult: IdentityResult): Promise<AccountSummary>` — retrieves client/tenant records with associated units
    - Generate reference numbers as `ORA-APT-XXXXXX` (6-digit zero-padded sequence)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 5.2 Implement content sync at `lib/cms/ai/content-sync.ts`
    - Export `syncBlogPost(db, postId: string, action: "publish" | "update" | "delete"): Promise<void>` — on publish/update: extracts plain text from Tiptap JSON, creates/updates knowledge document, generates embedding and stores in vector store; on delete: removes knowledge document and embedding
    - Export `extractPlainText(tiptapJson: any): string` — recursively extracts text content from Tiptap JSON structure
    - Export `reindexAllBlogContent(db): Promise<{ indexed: number; errors: number }>` — re-indexes all published blog posts, used for manual admin re-index action
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 5.3 Write unit tests for action executor
    - Test appointment booking with valid input, double-booking prevention, cancellation, rescheduling
    - Test alternative slot suggestion
    - _Requirements: 6.2, 6.3, 6.4, 6.7_

  - [x] 5.4 Write unit tests for content sync
    - Test Tiptap JSON text extraction, blog post sync on publish/update/delete
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 6. AI core — Chat orchestrator and human handoff
  - [x] 6.1 Implement chat orchestrator at `lib/cms/ai/chat.ts`
    - Export `handleChatMessage(db, input: ChatInput): Promise<ChatResponse>` — orchestrates the full chat flow: resolve identity → detect language → check scope → retrieve RAG context → augment with structured data if identified → execute actions if requested → generate response → persist conversation and messages
    - Create new conversation if no conversationId provided; continue existing conversation if provided
    - Store resolved identity on conversation record
    - Include source attribution in responses by referencing knowledge document titles
    - Detect action intents (appointment booking, account lookup) and delegate to action executor
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.6, 8.1, 8.6, 11.1, 11.2, 11.3, 14.2, 14.3, 14.4_

  - [x] 6.2 Implement human handoff logic at `lib/cms/ai/handoff.ts`
    - Export `initiateHandoff(db, conversationId: string, reason: string): Promise<void>` — updates conversation status to "handed_off", stores handoff summary (original query, attempted responses, reason), creates system message in conversation
    - Export `detectHandoffNeed(messages: Message[]): boolean` — detects repeated similar queries (2+ consecutive on same topic) indicating user frustration
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x] 6.3 Write unit tests for chat orchestrator
    - Test full flow: new conversation creation, identity resolution, language detection, response generation
    - Test scope boundary enforcement
    - Test action intent detection and delegation
    - _Requirements: 1.1, 2.1, 4.3, 11.1_

  - [x] 6.4 Write unit tests for human handoff
    - Test explicit handoff request detection, repeated query detection, handoff summary creation
    - _Requirements: 9.1, 9.2, 9.5_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. API routes — Chat and conversations
  - [x] 8.1 Implement chat API route at `lib/cms/api/routes/ai-chat.ts`
    - `POST /ai/chat` — accepts message text, conversationId (optional), phone (optional), email (optional); calls chat orchestrator; returns assistant response message with conversationId and metadata
    - No auth required for public chat (visitors can use it); if auth session present, resolve identity from session
    - Validate request body with Zod schema
    - _Requirements: 16.1, 16.8_

  - [x] 8.2 Implement conversations API route at `lib/cms/api/routes/ai-conversations.ts`
    - `GET /ai/conversations` — auth required, paginated list with filtering by status, channel, date range, identified flag; search by participant name, phone, or message content
    - `GET /ai/conversations/:id` — auth required, returns full conversation with all messages, sender roles, timestamps, retrieved source references, actions performed
    - _Requirements: 16.2, 16.3, 8.2, 8.3, 8.4_

  - [x] 8.3 Write unit tests for chat API route
    - Test new conversation creation, continuing existing conversation, identity resolution from session
    - _Requirements: 16.1, 16.8_

- [x] 9. API routes — Knowledge base and content sync
  - [x] 9.1 Implement knowledge base API route at `lib/cms/api/routes/ai-knowledge-base.ts`
    - `GET /ai/knowledge-base` — auth required, list knowledge documents with filtering by sourceType, category, locale; include sync status for blog-sourced documents
    - `POST /ai/knowledge-base` — auth required, create manual knowledge document, generate embedding, store in vector store
    - `PUT /ai/knowledge-base/:id` — auth required, update knowledge document, regenerate embedding
    - `DELETE /ai/knowledge-base/:id` — auth required, delete knowledge document and its embeddings from vector store
    - `POST /ai/knowledge-base/reindex` — auth required, trigger full blog content re-index
    - _Requirements: 16.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 15.6_

  - [x] 9.2 Wire content sync hooks into existing blog service
    - Add sync calls in the existing blog post publish/update/trash flows to trigger `syncBlogPost`
    - Ensure sync is non-blocking (fire-and-forget with error logging) so blog operations are not delayed
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 9.3 Write unit tests for knowledge base API
    - Test CRUD operations, embedding generation on create/update, deletion of embeddings
    - _Requirements: 3.2, 3.3, 3.5_

- [x] 10. API routes — Clients, tenants, units, and appointments
  - [x] 10.1 Implement client/tenant/unit API routes at `lib/cms/api/routes/ai-records.ts`
    - `GET /ai/clients` — auth required, paginated list with search by name, email, phone
    - `POST /ai/clients` — auth required, create client record, log to audit
    - `PUT /ai/clients/:id` — auth required, update client record, log to audit
    - `DELETE /ai/clients/:id` — auth required, delete client record
    - Same CRUD pattern for `/ai/tenants` and `/ai/units`
    - Enforce referential integrity: unit's clientId/tenantId must reference valid records
    - _Requirements: 16.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 14.6_

  - [x] 10.2 Implement appointments API route at `lib/cms/api/routes/ai-appointments.ts`
    - `GET /ai/appointments` — auth required, list appointments with filtering by date, status, type
    - `POST /ai/appointments` — auth required, create appointment (admin-initiated)
    - `PATCH /ai/appointments/:id/cancel` — auth required, cancel appointment
    - `PATCH /ai/appointments/:id/reschedule` — auth required, reschedule appointment
    - _Requirements: 16.6, 6.6_

  - [x] 10.3 Implement analytics API route at `lib/cms/api/routes/ai-analytics.ts`
    - `GET /ai/analytics` — auth required, returns aggregated stats: total conversations, conversations by status, conversations by channel, average messages per conversation, top queried topics, handoff rate, daily volume over time
    - `GET /ai/analytics/knowledge-base` — auth required, returns KB health: total indexed docs, docs by source type, last sync timestamp, stale documents count
    - _Requirements: 16.7, 13.2, 13.4, 13.5_

  - [x] 10.4 Implement AI config API route at `lib/cms/api/routes/ai-config.ts`
    - `GET /ai/config` — auth required, returns all AI configuration parameters
    - `PUT /ai/config` — auth required, update configuration parameters (model selection, top-K, relevance threshold, history length, inactivity timeout, welcome messages EN/AR, scope config)
    - Changes apply to subsequent conversations without restart
    - _Requirements: 13.1, 13.3, 4.4_

- [ ] 11. Wire AI routes into main API and RBAC seed
  - [x] 11.1 Register all AI routes in `lib/cms/api/index.ts`
    - Import and `.use()` aiChatRoutes, aiConversationsRoutes, aiKnowledgeBaseRoutes, aiRecordsRoutes, aiAppointmentsRoutes, aiAnalyticsRoutes, aiConfigRoutes
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6, 16.7_

  - [x] 11.2 Create AI permission seed at `lib/cms/ai/seed.ts`
    - Register permissions: `ai:chat`, `ai:conversations:read`, `ai:knowledge-base:manage`, `ai:clients:manage`, `ai:tenants:manage`, `ai:units:manage`, `ai:appointments:manage`, `ai:analytics:read`, `ai:config:manage`
    - Grant `super_admin` all AI permissions (already covered by `*:*` wildcard)
    - Grant `sales_manager`: `ai:conversations:read`, `ai:clients:manage`, `ai:appointments:manage`, `ai:analytics:read`
    - Make seed idempotent (check-before-insert)
    - _Requirements: 14.1, 14.6_

  - [x] 11.3 Integrate AI seed into server startup at `lib/cms/api/server.ts`
    - Import and call `seedAiPermissions` alongside existing seed functions
    - _Requirements: 14.1_

- [x] 12. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Admin panel — Knowledge base management page
  - [x] 13.1 Create knowledge base listing page at `app/ora-panel/ai/knowledge-base/page.tsx`
    - Display paginated list of knowledge documents with columns: title, source type, category, locale, content preview (truncated), last indexed timestamp
    - Implement filter controls for source type, category, and locale
    - Display sync status badge for blog-sourced documents (up-to-date, pending re-index, missing)
    - Include "Re-index All" button triggering full blog content re-index
    - Include "Add Document" button linking to creation form
    - Use TanStack Query for data fetching, matching existing admin panel patterns
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 15.5_

  - [x] 13.2 Create knowledge base document form at `app/ora-panel/ai/knowledge-base/new/page.tsx` and `app/ora-panel/ai/knowledge-base/[id]/page.tsx`
    - Form fields: title, content (textarea), source type (dropdown), category, locale (EN/AR dropdown)
    - Edit page loads existing document data
    - On save, calls POST or PUT endpoint; on delete, calls DELETE endpoint
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [ ] 14. Admin panel — Conversation review page
  - [x] 14.1 Create conversation listing page at `app/ora-panel/ai/conversations/page.tsx`
    - Display conversations in reverse chronological order with columns: participant name, status, channel, language, message count, created date
    - Implement search by participant name, phone number, or message content
    - Implement filter controls for status (active, resolved, handed_off, abandoned), channel, date range, identified flag
    - Display notification badge for "handed_off" conversations not yet reviewed
    - Use TanStack Query for data fetching
    - _Requirements: 8.2, 8.3, 8.5, 9.4_

  - [x] 14.2 Create conversation detail page at `app/ora-panel/ai/conversations/[id]/page.tsx`
    - Display full message history with sender roles, timestamps, retrieved source references, and actions performed
    - Display conversation metadata: participant info, identity resolution result, language, status, resolution status
    - Display handoff summary if status is "handed_off"
    - _Requirements: 8.4, 9.5_

- [ ] 15. Admin panel — Client, tenant, and unit management pages
  - [x] 15.1 Create client management page at `app/ora-panel/ai/clients/page.tsx`
    - Paginated list with columns: name, email, phone, nationality, preferred language, associated units count, created date
    - Search by name, email, phone
    - Include "Add Client" button
    - Use TanStack Query for data fetching
    - _Requirements: 12.6_

  - [x] 15.2 Create client form pages at `app/ora-panel/ai/clients/new/page.tsx` and `app/ora-panel/ai/clients/[id]/page.tsx`
    - Form fields: first name, last name, email, phone, nationality, preferred language (EN/AR), notes
    - Edit page shows associated units
    - _Requirements: 12.1, 12.6_

  - [x] 15.3 Create tenant management page at `app/ora-panel/ai/tenants/page.tsx`
    - Paginated list with columns: name, email, phone, unit, lease dates, rent amount, created date
    - Search by name, email, phone
    - _Requirements: 12.6_

  - [x] 15.4 Create tenant form pages at `app/ora-panel/ai/tenants/new/page.tsx` and `app/ora-panel/ai/tenants/[id]/page.tsx`
    - Form fields: first name, last name, email, phone, unit (dropdown), lease start date, lease end date, rent amount, payment frequency, notes
    - _Requirements: 12.2, 12.6_

  - [x] 15.5 Create unit management page at `app/ora-panel/ai/units/page.tsx`
    - Paginated list with columns: project name, unit number, type, floor, area, status, construction progress, client/tenant name
    - Filter by status, unit type, project name
    - _Requirements: 12.6_

  - [x] 15.6 Create unit form pages at `app/ora-panel/ai/units/new/page.tsx` and `app/ora-panel/ai/units/[id]/page.tsx`
    - Form fields: project name, unit number, unit type (dropdown), floor number, area sqm, status (dropdown), construction progress (percentage), estimated handover date, client (dropdown, nullable), tenant (dropdown, nullable)
    - _Requirements: 12.3, 12.6_

- [ ] 16. Admin panel — Appointments, analytics, and settings pages
  - [x] 16.1 Create appointment management page at `app/ora-panel/ai/appointments/page.tsx`
    - Display appointments with columns: reference number, contact name, type, scheduled date/time, status, created date
    - Filter by date range, status, appointment type
    - Include cancel and reschedule actions
    - Use TanStack Query for data fetching
    - _Requirements: 6.6_

  - [x] 16.2 Create analytics dashboard page at `app/ora-panel/ai/analytics/page.tsx`
    - Display total conversations, conversations by status (pie/bar chart), conversations by channel, average messages per conversation, top queried topics, handoff rate, daily conversation volume over time (line chart)
    - Display knowledge base health: total indexed docs, docs by source type, last sync timestamp, stale documents count
    - _Requirements: 13.2, 13.4, 13.5_

  - [x] 16.3 Create AI settings page at `app/ora-panel/ai/settings/page.tsx`
    - Form fields: language model selection, embedding model selection, top-K retrieval count, relevance threshold, conversation history length, inactivity timeout, welcome message EN, welcome message AR
    - Scope configuration section: permitted topic categories (multi-select/tags), blocked keywords (multi-select/tags)
    - Save calls PUT `/api/ai/config`
    - _Requirements: 13.1, 13.3, 4.4_

- [ ] 17. Admin panel — Navigation and layout wiring
  - [x] 17.1 Add AI section to admin panel navigation in `app/ora-panel/layout.tsx`
    - Add AI nav items to the `navItems` array with appropriate icons and permissions:
      - `{ href: '/ora-panel/ai/knowledge-base', label: 'AI Knowledge', icon: BrainCircuit, permission: 'ai:knowledge-base:manage' }`
      - `{ href: '/ora-panel/ai/conversations', label: 'AI Conversations', icon: MessageSquare, permission: 'ai:conversations:read' }`
      - `{ href: '/ora-panel/ai/clients', label: 'AI Clients', icon: Users, permission: 'ai:clients:manage' }`
      - `{ href: '/ora-panel/ai/appointments', label: 'AI Appointments', icon: CalendarDays, permission: 'ai:appointments:manage' }`
      - `{ href: '/ora-panel/ai/analytics', label: 'AI Analytics', icon: BarChart3, permission: 'ai:analytics:read' }`
      - `{ href: '/ora-panel/ai/settings', label: 'AI Settings', icon: Cog, permission: 'ai:config:manage' }`
    - Import required icons from `lucide-react`
    - _Requirements: 3.1, 8.2, 12.6, 6.6, 13.2, 13.1_

- [x] 18. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Public chat widget component
  - [x] 19.1 Implement chat widget at `lib/cms/components/ChatWidget.tsx`
    - Render a floating button at bottom-right corner of viewport
    - On click, expand into a chat panel with welcome message and input field
    - Support real-time message exchange: send user message via POST `/api/ai/chat`, display assistant response
    - Display typing indicator while waiting for response
    - Persist conversation across page navigations using sessionStorage for conversationId
    - Support minimized state with unread message count badge
    - Responsive layout for desktop and mobile viewports
    - Support `dir="rtl"` for Arabic locale
    - Match current page locale (EN/AR) for interface text
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 19.2 Integrate chat widget into public frontend layouts
    - Add `<ChatWidget />` component to `app/(en)/layout.tsx` and `app/ar/layout.tsx`
    - Pass current locale prop to the widget
    - _Requirements: 10.1, 10.5_

  - [x] 19.3 Write unit tests for chat widget
    - Test widget toggle open/close, message sending, session persistence, RTL support, unread badge
    - _Requirements: 10.1, 10.2, 10.4, 10.7_

- [ ] 20. Data privacy and security enforcement
  - [x] 20.1 Add auth guards to all AI admin API routes
    - Ensure all `/api/ai/*` routes (except `/api/ai/chat`) require valid auth session
    - Use existing `identityGuard` and `requirePermission` middleware from `lib/cms/rbac/middleware.ts`
    - Ensure `/api/ai/chat` does NOT require auth but optionally resolves identity from session if present
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 20.2 Implement data isolation in chat orchestrator
    - Ensure personalized data (client records, tenant records, unit details) is only injected into RAG context when user identity is confirmed
    - Ensure unidentified users cannot access other clients' personal information through queries
    - Log all admin access to client/tenant/conversation data in audit log
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 21. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design document has no Correctness Properties section, so property-based tests are not included; unit tests cover key behaviors
- All AI core modules go in `lib/cms/ai/` following the existing module pattern (e.g., `lib/cms/tickets/`, `lib/cms/approval/`)
- API routes follow the existing Elysia.js plugin pattern in `lib/cms/api/routes/`
- Admin panel pages follow the existing TanStack Query pattern in `app/ora-panel/`
- The chat widget uses sessionStorage for conversation persistence across page navigations
- Content sync hooks are integrated into the existing blog service to avoid polling
- Cloudflare AI Gateway configuration is read from environment variables
- pgvector extension must be enabled in the PostgreSQL database before running migrations
