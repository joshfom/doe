# ORA CMS Platform

A full-featured content management system built with Next.js 16, Elysia.js, Drizzle ORM, and a Puck-based visual page builder. ORA CMS provides a complete admin panel, multilingual page and blog management (English/Arabic), a drag-and-drop page builder with atomic components, media library, menu builder, form builder, and a luxury warm-neutral design system.

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Framer Motion
- **Backend API**: Elysia.js (Bun runtime)
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Better Auth (session-based)
- **Page Builder**: Puck Editor (`@puckeditor/core`)
- **Rich Text**: Tiptap (blog/news content)
- **State Management**: TanStack React Query (optimistic updates)
- **Drag & Drop**: dnd-kit (menu builder, page builder)
- **Validation**: Zod
- **Testing**: Vitest, fast-check (property-based), React Testing Library
- **Icons**: Lucide React (stroke-1 thin style)
- **Fonts**: Geist Sans / Geist Mono

---

## Features

### Visual Page Builder

A self-contained Puck-based page builder module at `lib/page-builder/` with:

- Drag-and-drop visual editor with custom ORA-branded UI overrides
- Atomic component architecture — individually styleable, composable components
- Layout components: Section, Container, Columns, Accordion, Spacer, Divider
- Basic components: Heading, Text, Button, InlineLink, Image, Video, Quote, Icon
- Interactive components: FilterTabs, ScrollIndicator, IconFeatureList, AccordionGroup, StatsGrid
- Universal style system with padding, margin, border, and animation fields on every component
- Full typography control (font size, weight, color, alignment, letter spacing, line height)
- Component template system for pre-composed blocks (Content Block, Hero Section, Feature Section, CTA Section, Testimonial Section)
- AI-powered page generation via Puck AI `generate()` API
- Server-side rendering with Puck's `<Render>` component
- Zod schema validation at save and render boundaries
- Reusable module architecture — embeddable in any Next.js or React app

### Admin Panel (`/ora-panel`)

A protected admin interface with session-based authentication:

- **Dashboard** — Overview stats (pages, posts, media, submissions)
- **Pages** — Full CRUD with namespace-based locale pairing, draft/published workflow, revision history, rollback support
- **Blog** — Tiptap rich text editor, blog/news post types, hierarchical categories, flat tags, SEO controls, revision history, soft-delete with auto-purge
- **Media Library** — Upload, browse, search images with reference tracking and safe deletion
- **Menus** — WordPress-style drag-and-drop menu builder with simple dropdowns and mega menu support
- **Footer Settings** — Configurable global footer
- **Form Submissions** — View submissions from forms placed on pages
- **Site Settings** — Global key-value config (company name, contact details, social links, CTA button, active menu)
- **Audit Log** — Full audit trail of all CMS actions with filtering by entity, action, user, and date range
- **Auth** — Login/register with Better Auth session management
- Collapsible sidebar navigation with ORA design system styling

### Multilingual Support (EN/AR)

- Namespace-based locale pairing — EN and AR versions share a namespace UUID
- English pages served at clean URLs (`/about`), Arabic at `/ar/about`
- RTL layout support with `dir="rtl"` for Arabic
- `hreflang` tags for SEO
- Locale completion indicators in admin (green/amber/gray)
- One-click locale cloning for both pages and blog posts

### Blog & News Module

- Tiptap-based rich text editor with headings, bold, italic, lists, links, images, blockquotes, code blocks
- Blog and News post types
- Hierarchical categories with parent-child relationships
- Flat tags with autocomplete
- WordPress-level SEO: meta title, description, keywords, canonical URL, robots directive, OpenGraph image
- Schema.org structured data (Article for blogs, NewsArticle for news)
- Featured image and OG image via media library
- Social sharing buttons (Twitter/X, Facebook, LinkedIn, WhatsApp, copy link)
- View and share count analytics with stats dashboard
- Post revision history with rollback
- Soft-delete trash system with configurable auto-purge (default 3 days)
- SSR blog listing with pagination, individual post pages, category and tag archive pages
- Related posts based on shared categories/tags
- Bilingual frontend: `/blog/{slug}` (EN) and `/ar/blog/{slug}` (AR)

### Menu Builder

- Create multiple named menus with drag-and-drop item reordering and nesting
- Three item types: link, simple dropdown, mega menu (2-4 column grid)
- Max 2-level nesting depth
- Glassmorphic frontend navigation bar with frosted glass effect
- Active page indicator (bold text + triangle)
- Configurable CTA button via site settings
- Register Interest skeleton dialog
- Full mobile responsive: hamburger menu with full-screen overlay
- RTL support
- SSR rendering for fast initial load

### Media Library

- Upload images with metadata (filename, dimensions, alt text, MIME type, file size)
- Configurable storage backends: local filesystem, AWS S3, Cloudflare R2
- Media picker integration in page builder and blog editor
- Reference tracking — prevents deletion of media used by pages
- Search by filename and alt text

### Form Builder

- Visual form component for the page builder
- Field types: text, email, phone, textarea, select, checkbox, radio
- Form submissions stored in database and viewable in admin
- Configurable Salesforce integration and webhook endpoints

### Newsletter Subscriptions

- Email subscription collection with locale tracking
- Source page tracking
- Unique email constraint

### Design System

ORA uses a luxury warm-neutral design system:

- Warm cream/sand/stone color palette (not cold grays)
- Gold accent (`#B8956B`) for CTAs, focus rings, active states
- Square corners by default — no border-radius on buttons, cards, inputs
- Thin strokes — all icons use `stroke-1`, borders are 1px
- Minimal shadows — prefer borders over box-shadows
- Generous whitespace and clean typography
- Muted status colors using `bg-{color}/10 text-{color}` pattern

See `design-system.md` for the full token reference.

---

## Project Structure

```
app/
├── (en)/                    # English public routes (served at root /)
│   ├── blog/                # Blog listing, posts, category/tag archives
│   └── [...slug]/           # Dynamic pages
├── ar/                      # Arabic public routes (/ar/*)
│   ├── blog/                # Arabic blog
│   └── [...slug]/           # Arabic dynamic pages
├── ora-panel/               # Admin panel
│   ├── blog/                # Post editor, categories, tags, stats
│   ├── pages/               # Page management + Puck editor
│   ├── media/               # Media library
│   ├── menus/               # Menu builder
│   ├── footer-settings/     # Footer configuration
│   ├── submissions/         # Form submissions
│   ├── settings/            # Site settings
│   └── audit/               # Audit log
├── api/[...slugs]/          # Elysia API passthrough
└── builder/                 # Standalone page builder

lib/
├── page-builder/            # Puck visual page builder module
│   ├── components/          # PageEditor, PageRenderer, UI overrides
│   ├── templates/           # Component and page templates
│   ├── config.ts            # Puck component registry
│   ├── schema.ts            # Zod validation schemas
│   ├── data-store.ts        # Abstract persistence interface
│   ├── page-manager.ts      # CRUD + slug + publish workflow
│   ├── ai-generator.ts      # AI page generation interface
│   └── index.ts             # Barrel export
└── cms/                     # CMS platform layer
    ├── api/                 # Elysia.js API server + route modules
    │   └── routes/          # pages, posts, media, menus, categories, tags, etc.
    ├── components/          # NavigationBar, FormBuilder, TiptapEditor, MediaPicker, etc.
    ├── hooks/               # TanStack Query hooks for all entities
    ├── utils/               # Slug generation, SEO, rich text renderer, menu tree, etc.
    ├── schema.ts            # Drizzle ORM table definitions
    ├── db.ts                # Database connection
    ├── storage.ts           # Storage backend abstraction
    ├── audit.ts             # Audit logging
    ├── seed.ts              # First-run system page seeder
    └── types.ts             # Shared TypeScript types

drizzle/                     # Database migrations
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (runtime for Elysia API)
- [Node.js](https://nodejs.org/) 20+
- PostgreSQL

### Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/ora_cms"
BETTER_AUTH_SECRET="your-secret-key"
API_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3000"
```

Optional storage backend config:

```env
STORAGE_BACKEND="local"  # local | s3 | r2
```

### Installation

```bash
bun install
```

### Database Setup

```bash
# Generate migrations from schema
bun run db:generate

# Apply migrations
bun run db:migrate

# Seed system pages (Home + Contact in EN/AR)
bun run db:seed
```

### Development

Run both the Next.js dev server and the Elysia API server:

```bash
# Terminal 1 — Next.js frontend
bun run dev

# Terminal 2 — Elysia API server (with hot reload)
bun run api:dev
```

Open [http://localhost:3000](http://localhost:3000) for the public site and [http://localhost:3000/ora-panel](http://localhost:3000/ora-panel) for the admin panel.

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
| `bun run db:seed` | Seed system pages |
| `bun run test` | Run tests (Vitest) |
| `bun run lint` | Run ESLint |

---

## API Endpoints

The Elysia API serves all data operations at `/api/*`:

| Module | Endpoints |
|--------|-----------|
| Auth | `/api/auth/session`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout` |
| Pages | `/api/pages`, `/api/pages/:id`, `/api/pages/:id/publish`, `/api/pages/:id/clone-locale`, `/api/pages/public/:locale/:slug` |
| Revisions | `/api/revisions/:pageId` |
| Posts | `/api/posts`, `/api/posts/:id`, `/api/posts/:id/publish`, `/api/posts/:id/clone-locale`, `/api/posts/public/:locale/:slug` |
| Post Revisions | `/api/posts/:id/revisions`, `/api/posts/:id/revisions/:revisionId/rollback` |
| Categories | `/api/categories` (CRUD) |
| Tags | `/api/tags` (CRUD) |
| Stats | `/api/stats/overview`, `/api/stats/top-posts`, `/api/stats/view/:postId`, `/api/stats/share/:postId` |
| Media | `/api/media` (CRUD + upload) |
| Menus | `/api/menus`, `/api/menus/active`, `/api/menus/:id/items`, `/api/menus/:id/reorder` |
| Forms | `/api/forms`, `/api/forms/submissions` |
| Settings | `/api/settings` |
| Footer | `/api/footer` |
| Newsletter | `/api/newsletter` |
| Audit | `/api/audit` |
| Component Templates | `/api/component-templates` |

All mutating endpoints require a valid auth session. Public read endpoints are unauthenticated.

---

## Testing

```bash
bun run test
```

The test suite includes:

- Unit tests for slug generation, schema validation, component config, menu tree utilities
- Property-based tests (fast-check) for JSON round-trips, CRUD integrity, slug uniqueness, taxonomy operations, analytics, SEO metadata, URL routing, and more
- Component tests with React Testing Library
- Integration tests for the page builder lifecycle

---

## ORA AI Assistant (Planned)

A future module for an autonomous AI virtual assistant:

- RAG pipeline with pgvector for semantic search over the knowledge base
- Client/tenant identification and personalized responses
- Appointment booking
- Auto-sync with CMS blog content
- Chat widget on the public frontend
- Multilingual support (EN/AR)
- Human handoff workflow
- Admin panel for knowledge base management, conversation review, and analytics

---

## License

Private — all rights reserved.
