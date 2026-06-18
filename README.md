# DOE (Digital Operation Engine) Platform

DOE is an AI-powered real estate platform built for off-plan property developments. It combines a full multilingual CMS and visual page builder with **Ora**, an AI "digital employee" that handles sales, operations, HSE, security, and finance flows from a single conversation — backed by role-based access control, a support ticketing system, content approvals, and an end-to-end marketing analytics stack.

The platform powers public marketing sites (EN/AR), a protected admin panel (`/ora-panel`), and a conversational AI assistant that identifies visitors, verifies identity with OTP, books appointments, issues site permits, and routes approval-gated actions to the right human role.

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Framer Motion
- **Backend API**: Elysia.js (Bun runtime)
- **Database**: PostgreSQL with Drizzle ORM (+ pgvector for embeddings)
- **Auth**: Better Auth (session-based) layered with a custom RBAC identity system
- **Page Builder**: Puck Editor (`@puckeditor/core`) with responsive breakpoint controls
- **Rich Text**: Tiptap (blog/news content + inline page editing)
- **AI**: Cloudflare AI Gateway (OpenAI-compatible), RAG over pgvector, deterministic intent dispatch
- **Email / OTP**: Azure Communication Services / Microsoft Graph
- **State Management**: TanStack React Query (optimistic updates)
- **Drag & Drop**: dnd-kit (menu builder, page builder)
- **Maps**: Google Maps (`@vis.gl/react-google-maps`)
- **Analytics**: PostHog, Microsoft Clarity, GA4, Meta Pixel + server-side CAPI
- **Storage**: Pluggable — local filesystem, AWS S3, or Cloudflare R2
- **Validation**: Zod
- **Testing**: Vitest, fast-check (property-based), React Testing Library

---

## Core Capabilities

### Ora — AI Digital Employee

A conversational assistant embedded on the public site and operated from the admin panel. Ora handles intake and actions across the full project lifecycle:

- **Natural identification** — no chat login. Ora collects name/email/phone conversationally and resolves the visitor against client, tenant, broker, and vendor records.
- **OTP-gated identity verification** — any personal, payment, or contractual request triggers a 6-digit code (sent via Azure/Graph email) before Ora answers. Verification state is pinned to the conversation.
- **Deterministic intent dispatch** — actions are routed by keyword/regex intent detection with regex argument extraction, then executed through typed, audited service calls. The LLM is used only for free-form RAG replies, never to decide or execute mutations. See `docs/ai-tool-calling-pattern.md`.
- **RAG knowledge base** — semantic search over project knowledge documents using pgvector embeddings, auto-synced from CMS blog/news content.
- **Recognised intents** — site-visit booking, brochure/floor-plan/payment-plan requests, inventory and construction-progress inquiries, payment milestone reminders, oqood/DLD assistance, mortgage NOC, snag-list submission, handover appointments, hot-works and work-at-height permits, hoist/lift booking, inspection requests, material delivery, vendor access, gate passes, and lead capture.
- **Approval routing** — high-stakes actions (NOC, permits, vendor access, handover, move-in) open a `ticket_approval` row routed to the correct panel role for human decision.
- **Admin agent** — staff-facing agent for reporting and operations, with destructive actions gated behind single-use confirmation tokens (human-in-the-loop).
- **Bilingual (EN/AR)** — replies match the user's language, detected from profile preference or message script.
- **Human handoff** — escalates sensitive flows (refunds, contract changes) and repeated questions to the relevant role with a conversation summary.
- **Appointments & calendar** — booking, rescheduling, conflict checks, and calendar invites.

### Visual Page Builder

A self-contained Puck-based page builder module at `lib/page-builder/`:

- Drag-and-drop visual editor with custom ORA-branded UI overrides and outline tree
- Atomic, individually styleable, composable components
- Layout, basic, and interactive component library (Section, Container, Columns, Heading, Text, Button, Image, Video, Cards, Pricing tables, Stats, Accordions, Tabs, Logo clouds, Testimonials, and more)
- **Responsive breakpoint controls** — per-breakpoint field resolution with sensible responsive defaults
- Universal style system (padding, margin, border, animation) and full typography control on every component
- Component and page template system for pre-composed blocks
- AI-assisted page generation
- Server-side rendering via Puck's `<Render>` with Zod validation at save/render boundaries
- **Live page editor** and **inline rich-text editing** for editing published content in context

### Multilingual CMS Admin Panel (`/ora-panel`)

A protected admin interface with session auth and RBAC-driven visibility:

- **Dashboard** — overview stats
- **Pages** — full CRUD, namespace-based EN/AR locale pairing, draft/published workflow, revision history with rollback, live editor
- **Blog & News** — Tiptap rich text editor, blog/news post types, hierarchical categories, flat tags, WordPress-level SEO, Schema.org structured data, view/share analytics, revision history, soft-delete with auto-purge
- **Media Library** — upload, browse, search, reference tracking, safe deletion; compact responsive grid
- **Menus** — WordPress-style drag-and-drop builder with simple dropdowns and mega menus
- **Communities & Projects** — real-estate entity management (communities → projects → units)
- **Tickets** — support/lead ticketing with lifecycle, assignment, notes, categories, and CRM sync
- **Calendar** — appointment and booking management
- **AI** — knowledge base, conversations, clients, tenants, units, appointments, analytics, and AI config
- **Marketing** — analytics dashboard, UTM links, ad-spend tracking, conversion goals, custom events
- **Reviews** — content approval workflow queue
- **Sitemap & Settings** — sitemap management, global site settings, footer configuration
- **Submissions** — form submission inbox
- Login/register with Better Auth; collapsible sidebar with ORA design system styling

### RBAC Identity System

- Four user types: **employee, broker, client, vendor** — each with a type-specific profile table
- Role definitions scoped by user type with granular `resource:action` permissions
- Zero-trust per-request authorization middleware
- Broker company registration + approval flow, agent management, and company-status cascade
- Permission-based admin panel visibility

### Support Ticketing System

- Ticket creation via manual entry, API, or public form
- Unique ticket numbers (`ORA-XXXXXX`) and full lifecycle (Open → Assigned → In Progress → Resolved → Closed)
- Assignment, filtering, search, pagination, internal notes, category management
- Email notifications on key events
- Pluggable CRM adapter (Salesforce first) with sync logging
- Rate limiting on the public form

### Content Approval Workflow

- Per-module approval toggle (Pages, Blog, News, and more)
- Multi-approver assignment with pending-review status and progress tracking
- Email notifications to approvers, auto-resolve when approval is disabled
- Review dashboard with full audit trail

### Marketing Analytics

- Client-side tracking via PostHog, Microsoft Clarity, GA4, and Meta Pixel with a consent banner and consent-state management
- Server-side conversion events (CAPI) to Meta, Google Ads, TikTok, and Bing
- UTM link generation and auto-registration, attribution tracking, QR codes
- Ad-spend ingestion from Meta, Google, TikTok, and Bing Ads APIs
- Conversion goal configuration and custom event tracking
- Marketing dashboard with spend and performance reporting

### Multilingual Support (EN/AR)

- Namespace-based locale pairing — EN and AR versions share a namespace UUID
- English served at clean URLs (`/about`), Arabic at `/ar/about`
- RTL layout (`dir="rtl"`), `hreflang` tags, locale completion indicators, and one-click locale cloning

### Design System

ORA uses a luxury warm-neutral design system: warm cream/sand/stone palette, gold accent (`#B8956B`), square corners, thin `stroke-1` icons, minimal shadows, and generous whitespace. See `design-system.md` for the full token reference.

---

## Modules at a Glance

Each module is self-contained under `lib/` with its own service, validation, and tests, and is wired into the API (`lib/cms/api/routes/`) and admin panel (`app/ora-panel/`).

| Module | What it does | Connects to |
|--------|--------------|-------------|
| **`page-builder/`** | Puck-based visual page builder: blocks, templates, responsive breakpoint engine, AI generation, SSR render | CMS pages (persists Puck data), media library (images), live/inline editors |
| **`cms/ai/`** (Ora) | AI digital employee: chat orchestration, intent dispatch, RAG, OTP verification, identity resolution, appointments, admin agent | Cloudflare AI Gateway (LLM/embeddings), RBAC profiles (client/tenant/broker/vendor lookup), tickets + approvals (action routing), blog (knowledge sync), email/OTP |
| **`cms/rbac/`** | Identity & access control: user types, roles, granular permissions, per-request authorization middleware, seeding/migration | Better Auth sessions, every API route (guards mutations), admin panel (permission-based visibility), Ora (identity resolution) |
| **`cms/tickets/`** | Support/lead ticketing: lifecycle, assignment, notes, categories, ticket numbers, rate limiting, CRM sync | Ora (auto-creates tickets from intents), approvals (`ticket_approvals`), CRM adapters (`tickets/crm/`), email notifications, RBAC (assignment to roles) |
| **`cms/approval/`** | Content & action approval workflow: per-module toggles, multi-approver assignment, review queue | Pages/blog (publication gate), tickets (permit approvals), email notifications, audit log |
| **`cms/communities/`** & **`cms/projects/`** | Real-estate entity management: communities → projects → units | Ora (inventory/availability answers), admin panel, AI units/payment plans |
| **`cms/blog/`** | Blog & news content services: posts, categories, tags, revisions, SEO, analytics | Tiptap editor, public SSR routes, Ora knowledge base (content sync), media library |
| **`cms/menu-builder/`** | Drag-and-drop navigation menus: dropdowns, mega menus, nesting | Public navigation bar, site settings (active menu, CTA) |
| **`cms/live-editor/`** & **`cms/inline-editor/`** | Edit published pages in context — live layout edits and inline rich text | Page builder (Puck config), CMS pages, Tiptap |
| **`cms/sitemap/`** | Sitemap generation and management | CMS pages/posts, public routes |
| **`cms/storage/`** (+ `storage.ts`) | Pluggable storage backend abstraction | Media library, AWS S3 / Cloudflare R2 / local filesystem |
| **`analytics/`** | Tracking + attribution: PostHog, Clarity, GA4, Meta Pixel, consent, UTM, server-side CAPI | Public site (page/form tracking), marketing dashboard, ad-platform APIs, conversion goals |
| **`cms/api/`** | Elysia.js API server: registers all route modules, seeds RBAC/permissions at startup | Every module above, Better Auth, Drizzle DB |
| **`cms/audit.ts`** | Central audit logging of all mutations (actor, action, diff) | All modules (CMS, AI, tickets, approvals, RBAC) |

---

## Project Structure

```
app/
├── (en)/                    # English public routes (served at root /)
│   ├── blog/                # Blog listing, posts, category/tag archives
│   └── [...slug]/           # Dynamic pages
├── ar/                      # Arabic public routes (/ar/*)
├── ora-panel/               # Admin panel
│   ├── ai/                  # KB, conversations, clients, tenants, units, appointments, analytics, settings
│   ├── pages/               # Page management + Puck editor
│   ├── blog/                # Post editor, categories, tags, stats
│   ├── communities/         # Communities & projects
│   ├── tickets/             # Support / lead ticketing
│   ├── marketing/           # Analytics, UTM, ad spend, conversion goals
│   ├── calendar/            # Appointments & bookings
│   ├── media/ menus/ reviews/ sitemap/ settings/ submissions/ live/
│   └── login/ register/
├── api/[...slugs]/          # Elysia API passthrough
└── builder/                 # Standalone page builder

lib/
├── page-builder/            # Puck visual page builder module (blocks, templates, responsive engine)
├── analytics/               # PostHog/Clarity/GA4/Meta tracking, consent, attribution, CAPI
└── cms/                     # CMS + platform layer
    ├── ai/                  # Ora: chat, agent, actions, identity, otp, rag, handoff, content-sync, email
    ├── api/                 # Elysia.js API server + route modules
    ├── rbac/                # Identity, roles, permissions, middleware, seeding
    ├── tickets/             # Ticketing service + CRM adapters
    ├── approval/            # Content approval workflow
    ├── communities/         # Communities & projects services
    ├── projects/            # Project service + validation
    ├── live-editor/         # Live page editing
    ├── inline-editor/       # Inline rich-text editing
    ├── blog/ menu-builder/ sitemap/ storage/ components/ hooks/ utils/
    ├── schema.ts            # Drizzle ORM table definitions
    ├── db.ts                # Database connection
    ├── audit.ts             # Audit logging
    └── seed.ts              # First-run system page seeder

drizzle/                     # Database migrations
docs/                        # Architecture & pattern docs (e.g. ai-tool-calling-pattern.md)
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (runtime for the Elysia API)
- [Node.js](https://nodejs.org/) 20+
- PostgreSQL with the `pgvector` extension (for AI knowledge base embeddings)

### Environment Variables

Copy `.env.example` to `.env` and fill in the values. Key groups:

```env
# Database & Auth
DATABASE_URL="postgresql://user:password@localhost:5432/page_builder"
BETTER_AUTH_SECRET=""

# API
API_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3000"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"

# Cloudflare AI Gateway (OpenAI-compatible) — powers Ora
CF_AI_GATEWAY_URL="https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai"
CF_AI_API_TOKEN=""
CF_CHAT_MODEL="openai/gpt-4o-mini"
CF_CHAT_MODEL_PREMIUM="openai/gpt-4.1"
CF_EMBEDDING_MODEL="@cf/baai/bge-base-en-v1.5"

# Email / OTP (Azure Communication Services / Microsoft Graph)
AZURE_COMMUNICATION_TENANT_ID=
AZURE_COMMUNICATION_CLIENT_ID=
AZURE_COMMUNICATION_CLIENT_SECRET=
AZURE_COMMUNICATION_SENDER=

# Storage backend: local | s3 | r2
STORAGE_BACKEND="r2"
```

`.env.example` also covers Cloudflare R2 / AWS S3 storage, Google Maps, and the full analytics stack (PostHog, Clarity, GA4, Meta Pixel, CAPI, and ad-platform APIs).

### Installation

```bash
bun install
```

### Database Setup

```bash
bun run db:generate   # Generate migrations from schema
bun run db:migrate    # Apply migrations
bun run db:seed       # Seed system pages + RBAC roles/permissions
```

### Development

Run the Next.js dev server and the Elysia API server in separate terminals:

```bash
# Terminal 1 — Next.js frontend
bun run dev

# Terminal 2 — Elysia API server (with hot reload)
bun run api:dev
```

Open [http://localhost:3000](http://localhost:3000) for the public site and [http://localhost:3000/ora-panel](http://localhost:3000/ora-panel) for the admin panel.

> Note: when running under `next dev`, RBAC, ticket, community, and AI permissions are seeded automatically at API module load.

### Production

```bash
bun run build
bun run start
bun run api:start
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Next.js dev server |
| `bun run build` | Build for production |
| `bun run start` | Start production server |
| `bun run api:dev` | Start Elysia API with hot reload |
| `bun run api:start` | Start Elysia API (production) |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Apply database migrations |
| `bun run db:push` | Push schema directly (dev) |
| `bun run db:studio` | Open Drizzle Studio GUI |
| `bun run db:seed` | Seed system pages + RBAC |
| `bun run db:seed:news` | Seed sample news content |
| `bun run db:seed:demo` | Seed the `@ora-demo.com` demo dataset |
| `bun run db:seed:demo:reset` | Reset demo data (only `@ora-demo.com` records) |
| `bun run test` | Run tests (Vitest) |
| `bun run lint` | Run ESLint |

---

## API

The Elysia API serves all data operations under `/api/*`. Route groups include:

| Area | Modules |
|------|---------|
| **CMS** | pages, revisions, posts, post-revisions, categories, tags, stats, media, menus, footer, settings, forms, newsletter, component-templates, sitemap, audit |
| **AI (Ora)** | ai-chat, ai-admin, ai-conversations, ai-knowledge-base, ai-records, ai-appointments, ai-analytics, ai-config, ai-email-test, calendar |
| **Identity & Access** | auth, users (RBAC) |
| **Real Estate** | communities, projects |
| **Ticketing** | tickets, ticket-categories, interest |
| **Approvals** | approval-config, approvals |
| **Marketing** | analytics-settings, utm-links, utm-analytics, marketing-dashboard, marketing-spend, custom-events, conversion-goals |

Mutating endpoints require a valid auth session and pass through RBAC authorization; public read and AI chat endpoints are unauthenticated (the AI chat path enforces its own OTP gate for sensitive actions).

---

## AI Architecture Note

Ora deliberately does **not** use native LLM function/tool-calling. Actions are dispatched by deterministic intent detection in application code, with regex argument extraction and typed, audited service calls. The model is used only for free-form RAG replies. This keeps AI-driven actions predictable and auditable, and prevents the model from hallucinating mutations. The full rationale and file map is in [`docs/ai-tool-calling-pattern.md`](docs/ai-tool-calling-pattern.md).

---

## Testing

```bash
bun run test
```

The suite includes unit tests, property-based tests (fast-check) for JSON round-trips, CRUD integrity, slug uniqueness, taxonomy, analytics, SEO, and routing, component tests (React Testing Library), and integration tests for the page builder and AI chat lifecycle.

---

## Demo

A scripted, role-based demo of Ora (broker, investor, buyer, contractor, vendor, consultant, and tenant journeys) is documented in `DEMO-SCRIPT.md`. Reset the demo dataset between runs with `bun run db:seed:demo:reset`.

---

## License

Private — all rights reserved.
