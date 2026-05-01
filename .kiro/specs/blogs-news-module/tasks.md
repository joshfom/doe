# Implementation Plan: Blogs & News Module

## Overview

This plan implements the Blogs & News module for the ORA CMS platform. The module adds blog/news content management with Tiptap rich text editing, hierarchical categories, flat tags, SEO controls, social sharing, view/share analytics, revision history, soft-delete with auto-purge, and SSR frontend rendering. Implementation follows the established ORA CMS patterns (Drizzle schema, Elysia API, React Query hooks, Next.js App Router).

Tasks are ordered: data layer → types → API routes → hooks → utilities → admin UI → SSR frontend → wiring → tests.

## Tasks

- [x] 1. Database schema and type definitions
  - [x] 1.1 Add blog tables to Drizzle schema (`lib/cms/schema.ts`)
    - Add `posts` table with all columns (id, title, slug, locale, namespace, post_type, status with "draft"/"published"/"trashed", content JSONB, excerpt, featured_image, meta_title, meta_description, meta_keywords, og_image, canonical_url, robots_directive, author_id FK, published_at, trashed_at, created_at, updated_at) with indexes on (slug, locale), namespace, status, post_type
    - Add `categories` table (id, name, slug, parent_id self-ref nullable, created_at, updated_at) with unique index on name
    - Add `tags` table (id, name, slug, created_at) with unique index on name
    - Add `postCategories` junction table (id, post_id FK cascade, category_id FK cascade) with unique index on (post_id, category_id)
    - Add `postTags` junction table (id, post_id FK cascade, tag_id FK cascade) with unique index on (post_id, tag_id)
    - Add `postViews` table (id, post_id FK cascade, count default 0)
    - Add `postShares` table (id, post_id FK cascade, platform, count default 0) with unique index on (post_id, platform)
    - Add `postRevisions` table (id, post_id FK cascade, user_id FK, data JSONB, title_snapshot, slug_snapshot, action enum save/rollback, revision_number, created_at) with index on post_id
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9, 28.10, 28.11_

  - [x] 1.2 Generate Drizzle migration
    - Run `bun run db:generate` to create the SQL migration file for the new tables
    - _Requirements: 28.1_

  - [x] 1.3 Extend type definitions (`lib/cms/types.ts`)
    - Add `PostType` ("blog" | "news"), `PostStatus` ("draft" | "published" | "trashed"), `PostNamespaceGroup` interface (same pattern as `PageNamespaceGroup`), `CategoryTree` interface, `SharePlatform` type
    - Extend `AuditAction` to include "trash", "restore", "auto_purge"
    - Extend `AuditEntityType` to include "post", "category", "tag"
    - _Requirements: 1.1, 4.1, 12.1, 13.1, 17.2_


- [x] 2. Checkpoint — Schema and types
  - Ensure the migration generates cleanly and types compile without errors. Ask the user if questions arise.

- [x] 3. Posts API routes (`lib/cms/api/routes/posts.ts`)
  - [x] 3.1 Implement public post routes
    - `GET /api/posts/public/:locale/:slug` — Fetch a single published post by locale and slug, joining categories and tags; return 404 if not found or not published
    - `GET /api/posts/public/:locale` — List published posts for a locale with pagination (page, pageSize query params, default 12), returning posts with title, excerpt, featured_image, published_at, categories
    - _Requirements: 2.5, 2.6, 4.3, 20.1, 20.3, 21.3_

  - [x] 3.2 Implement admin read routes
    - `GET /api/posts` — List non-trashed posts grouped by namespace as `PostNamespaceGroup[]` with optional locale, status, postType filters
    - `GET /api/posts/:id` — Get single post with all fields including SEO, categories, tags
    - `GET /api/posts/trash` — List trashed posts with trashedAt and days remaining before auto-purge
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.5, 4a.1, 4b.5_

  - [x] 3.3 Implement post creation route
    - `POST /api/posts` — Create post with title (required, 400 if missing), postType, locale, content, excerpt, SEO fields; generate slug via `generateSlug`/`ensureUniqueSlug`; assign UUID namespace; set status "draft"; log audit entry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1, 7.2_

  - [x] 3.4 Implement post update route
    - `PUT /api/posts/:id` — Create revision snapshot of current state BEFORE applying update; update specified fields and set updatedAt; log audit entry; return 404 if not found
    - _Requirements: 3.1, 3.2, 3.3, 6a.1, 6a.2_

  - [x] 3.5 Implement trash, restore, and permanent delete routes
    - `DELETE /api/posts/:id` — Soft delete: set status "trashed", set trashedAt, log audit with action "trash"; return 404 if not found
    - `POST /api/posts/:id/restore` — Restore from trash: set status "draft", clear trashedAt, log audit with action "restore"
    - `DELETE /api/posts/:id/permanent` — Hard delete from trash: delete post and all cascaded associations, log audit with action "delete"
    - _Requirements: 4.1, 4.2, 4.4, 4a.2, 4a.3_

  - [x] 3.6 Implement publish and unpublish routes
    - `POST /api/posts/:id/publish` — Set status "published", set publishedAt, log audit; return 404 if not found
    - `POST /api/posts/:id/unpublish` — Set status "draft", log audit; return 404 if not found
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 3.7 Implement locale clone route
    - `POST /api/posts/:id/clone-locale` — Clone post to AR locale with same namespace, status "draft", copy all content and SEO fields; return 409 if AR already exists; log audit
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 3.8 Implement category and tag assignment routes
    - `PUT /api/posts/:id/categories` — Replace post's category assignments (delete existing, insert new junction records)
    - `PUT /api/posts/:id/tags` — Replace post's tag assignments (delete existing, insert new junction records)
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 3.9 Write property tests for post CRUD (`lib/cms/blog/post-crud.property.test.ts`)
    - **Property 1: Post CRUD round-trip** — Create post, read back, verify all fields match
    - **Property 2: Post list filtering** — Create posts with various filters, verify filtering correctness
    - **Property 3: Trashed posts excluded from public results** — Verify public API only returns published posts
    - **Property 7: Publish/unpublish lifecycle** — Verify status transitions and publishedAt behavior
    - **Property 12: Slug uniqueness within locale** — Verify slug deduplication with numeric suffixes
    - **Validates: Requirements 1.1, 1.3, 2.2, 2.3, 2.4, 4.3, 4.5, 5.1, 5.2, 7.1, 7.2, 7.5, 8.1**


  - [x] 3.10 Register posts routes in API index (`lib/cms/api/index.ts`)
    - Import `postsRoutes` and add `.use(postsRoutes)` to the Elysia API app
    - _Requirements: 1.1, 2.1_

- [x] 4. Post revisions API (`lib/cms/api/routes/post-revisions.ts`)
  - [x] 4.1 Implement revision routes
    - `GET /api/posts/:id/revisions` — List all revisions for a post ordered by revision_number descending, including author info and title_snapshot
    - `GET /api/posts/:id/revisions/:revisionId` — Get single revision with full data snapshot
    - `POST /api/posts/:id/revisions/:revisionId/rollback` — Create revision of current state (action "rollback"), then overwrite post content/SEO with target revision's snapshot; log audit with action "rollback"
    - _Requirements: 6a.1, 6a.2, 6a.3, 6a.4, 6a.5_

  - [x] 4.2 Write property tests for revisions (`lib/cms/blog/revisions.property.test.ts`)
    - **Property 9: Revision snapshot before update** — Verify revision created with pre-update state, incrementing revision numbers
    - **Property 10: Revision restore creates undo point and overwrites** — Verify rollback creates new revision and overwrites post
    - **Property 11: Revision history ordering** — Verify descending order and strictly increasing sequence
    - **Validates: Requirements 3.1, 6a.1, 6a.2, 6a.3, 6a.4**

  - [x] 4.3 Register revision routes in API index
    - Import `postRevisionsRoutes` and add `.use(postRevisionsRoutes)` to the Elysia API app
    - _Requirements: 6a.3_

- [x] 5. Categories API routes (`lib/cms/api/routes/categories.ts`)
  - [x] 5.1 Implement category CRUD routes
    - `GET /api/categories` — List all categories, build tree structure with parent-child nesting
    - `POST /api/categories` — Create category with name (generate slug), optional parentId; return 409 if name exists; log audit
    - `PUT /api/categories/:id` — Update category name and/or parentId; regenerate slug; log audit
    - `DELETE /api/categories/:id` — Delete category, promote children to root (set parentId null), remove post_categories for that category; log audit
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 5.2 Write property tests for categories (`lib/cms/blog/taxonomy.property.test.ts`)
    - **Property 16: Category parent deletion promotes children** — Verify children promoted to root and post-category associations removed
    - **Property 17: Tag update regenerates slug** — Verify slug matches generateSlug(newName)
    - **Property 18: Post-category and post-tag assignment round-trip** — Verify junction record creation, reading, and removal
    - **Validates: Requirements 12.4, 12.5, 13.3, 14.1, 14.2, 14.3**

  - [x] 5.3 Register categories routes in API index
    - Import `categoriesRoutes` and add `.use(categoriesRoutes)` to the Elysia API app
    - _Requirements: 12.1_

- [x] 6. Tags API routes (`lib/cms/api/routes/tags.ts`)
  - [x] 6.1 Implement tag CRUD routes
    - `GET /api/tags` — List all tags
    - `POST /api/tags` — Create tag with name (generate slug); return 409 if name exists; log audit
    - `PUT /api/tags/:id` — Update tag name, regenerate slug; log audit
    - `DELETE /api/tags/:id` — Delete tag and all post_tags associations; log audit
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 6.2 Register tags routes in API index
    - Import `tagsRoutes` and add `.use(tagsRoutes)` to the Elysia API app
    - _Requirements: 13.1_

- [x] 7. Stats API routes (`lib/cms/api/routes/stats.ts`)
  - [x] 7.1 Implement stats and tracking routes
    - `GET /api/stats/overview` — Return total posts, total views, total shares with optional postType and date range filters
    - `GET /api/stats/top-posts` — Return top posts ranked by view count with optional postType filter
    - `GET /api/stats/shares` — Return per-platform share count breakdown
    - `POST /api/stats/view/:postId` — Increment view count (public, no auth, upsert into post_views)
    - `POST /api/stats/share/:postId` — Increment share count for platform (public, no auth, upsert into post_shares)
    - _Requirements: 17.1, 17.2, 17.3, 18.1, 18.2, 18.3, 19.1, 19.2, 19.3, 19.4_

  - [x] 7.2 Write property tests for analytics (`lib/cms/blog/analytics.property.test.ts`)
    - **Property 19: Analytics counter increment** — Verify N view increments = count N, M share increments per platform = count M
    - **Property 20: Stats aggregation correctness** — Verify stats endpoint returns correct totals
    - **Property 21: Pagination correctness** — Verify paginated results cover all posts without duplicates
    - **Validates: Requirements 17.1, 17.2, 18.1, 18.2, 20.3**

  - [x] 7.3 Register stats routes in API index
    - Import `statsRoutes` and add `.use(statsRoutes)` to the Elysia API app
    - _Requirements: 19.1_

- [x] 8. Trash auto-purge service (`lib/cms/blog/trash-purge.ts`)
  - [x] 8.1 Implement trash auto-purge function
    - `purgeExpiredTrash(db)` — Read `blog_trash_retention_days` from site_settings (default 3); query trashed posts where `(now - trashedAt) > retention`; hard-delete each with cascade; log audit with action "auto_purge" for each purged post; return count of purged posts
    - Wire purge to run on API startup in `lib/cms/api/server.ts`
    - _Requirements: 4b.1, 4b.2, 4b.3, 4b.4_

  - [x] 8.2 Write property tests for trash (`lib/cms/blog/trash.property.test.ts`)
    - **Property 4: Trash and restore round-trip** — Verify trash sets status/trashedAt, restore clears them
    - **Property 5: Permanent delete cascades all associations** — Verify all junction/analytics/revision records removed
    - **Property 6: Auto-purge respects retention period** — Verify only expired posts purged, others untouched
    - **Validates: Requirements 4.1, 4a.2, 4a.3, 4b.1, 4b.5**


- [x] 9. Checkpoint — API layer complete
  - Ensure all API routes compile, all property tests pass (if written), and manual smoke test of post CRUD via API. Ask the user if questions arise.

- [x] 10. React Query hooks
  - [x] 10.1 Create posts hooks (`lib/cms/hooks/use-posts.ts`)
    - Implement `usePosts(filters?)`, `usePost(id)`, `useCreatePost()`, `useUpdatePost()`, `useDeletePost()` (soft delete), `usePublishPost()`, `useUnpublishPost()`, `useClonePostLocale()`, `useRestorePost()`, `usePermanentDeletePost()`, `useTrashedPosts()`
    - Follow the same patterns as `use-pages.ts` (query keys, optimistic updates, cache invalidation)
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 4a.2, 4a.3, 5.1, 5.2, 6.1_

  - [x] 10.2 Create blog categories hooks (`lib/cms/hooks/use-blog-categories.ts`)
    - Implement `useBlogCategories()`, `useCreateCategory()`, `useUpdateCategory()`, `useDeleteCategory()`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 10.3 Create blog tags hooks (`lib/cms/hooks/use-blog-tags.ts`)
    - Implement `useBlogTags()`, `useCreateTag()`, `useUpdateTag()`, `useDeleteTag()`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 10.4 Create blog stats hooks (`lib/cms/hooks/use-blog-stats.ts`)
    - Implement `useBlogStats(filters?)`, `useTopPosts(filters?)`, `useShareBreakdown()`, `useTrackView()`, `useTrackShare()`
    - _Requirements: 17.1, 18.1, 19.1, 19.2, 19.3, 19.4_

  - [x] 10.5 Create post revisions hooks (`lib/cms/hooks/use-post-revisions.ts`)
    - Implement `usePostRevisions(postId)`, `useRollbackPost()`
    - _Requirements: 6a.3, 6a.4_

  - [x] 10.6 Export new hooks from hooks index (`lib/cms/hooks/index.ts`)
    - Add re-exports for all new blog hooks
    - _Requirements: 1.1_

- [x] 11. Utility modules
  - [x] 11.1 Create rich text renderer (`lib/cms/utils/rich-text-renderer.ts`)
    - Implement `renderTiptapToHtml(content)` using `@tiptap/html` with matching extension set (StarterKit, Link, Image, CodeBlock)
    - Convert Tiptap JSON to HTML string for SSR rendering
    - _Requirements: 11.1, 11.2_

  - [x] 11.2 Write property tests for rich text renderer (`lib/cms/utils/rich-text-renderer.property.test.ts`)
    - **Property 15: Tiptap JSON to HTML round-trip** — Verify rendering produces non-empty HTML preserving all formatting semantics (headings → h1-h6, bold → strong, italic → em, lists → ol/ul, links → a, blockquotes → blockquote, code → pre/code)
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [x] 11.3 Create Schema.org structured data utility (`lib/cms/utils/structured-data.ts`)
    - Implement `generateStructuredData(input)` returning JSON-LD object with @type "Article" for blog posts and "NewsArticle" for news; include headline, datePublished, dateModified, author, image, description
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 11.4 Create blog SEO metadata utility (`lib/cms/utils/blog-seo.ts`)
    - Implement `generateBlogMetadata(input)` extending the existing `generatePageMetadata` pattern; fall back to featuredImage for OG image when ogImage is not set
    - _Requirements: 8.1, 8.4, 8.5_

  - [x] 11.5 Write property tests for blog SEO (`lib/cms/utils/blog-seo.property.test.ts`)
    - **Property 13: OG image falls back to featured image** — Verify OG image uses featuredImage when ogImage is null
    - **Property 14: Schema.org structured data type mapping** — Verify @type mapping and field usage
    - **Validates: Requirements 8.4, 9.1, 9.2, 9.3**

  - [x] 11.6 Create fetch utilities (`lib/cms/utils/fetch-post.ts`)
    - Implement `fetchPublicPost(locale, slug)`, `fetchPublicPosts(locale, page?, pageSize?)`, `fetchPostsByCategory(locale, categorySlug, page?)`, `fetchPostsByTag(locale, tagSlug, page?)`, `fetchRelatedPosts(postId, locale, limit?)`
    - Follow the same pattern as `fetch-page.ts`
    - _Requirements: 20.1, 21.1, 22.1, 22.2, 23.1, 23.2, 23.3, 23.4_

  - [x] 11.7 Write property tests for related posts (`lib/cms/blog/related-posts.property.test.ts`)
    - **Property 22: Related posts constraints** — Verify max 3 results, current post excluded, shared category/tag or same-type fallback
    - **Validates: Requirements 23.1, 23.2, 23.3, 23.4**

- [x] 12. Checkpoint — Hooks and utilities complete
  - Ensure all hooks and utility modules compile without errors. Run all property tests. Ask the user if questions arise.


- [x] 13. Tiptap editor component
  - [x] 13.1 Create Tiptap rich text editor component (`lib/cms/components/TiptapEditor.tsx`)
    - Install `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/html` dependencies
    - Implement editor with toolbar buttons for: headings (H1–H6), bold, italic, ordered list, unordered list, link, image, blockquote, code block
    - Store content as Tiptap JSON, expose `onChange(json)` callback
    - Integrate image insertion with existing `MediaPickerModal` component for media library selection
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 14. Admin panel — Post listing page (`app/ora-panel/blog/page.tsx`)
  - [x] 14.1 Implement post listing page
    - Display non-trashed posts grouped by namespace with locale completion indicators (same pattern as pages listing)
    - Add search by title/slug, filters for status (draft/published), post type (blog/news), locale (en/ar)
    - Display post type badge, status badge, and locale badges (EN/AR) for each entry
    - Add "New Post" button linking to `/ora-panel/blog/new`
    - Add "Trash" tab/toggle to view trashed posts with trashedAt date and days remaining before auto-purge
    - Provide restore and permanent delete actions on trashed posts with confirmation dialog for permanent delete
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 4a.1, 4a.3, 4a.4_

- [x] 15. Admin panel — Post editor page
  - [x] 15.1 Implement post creation page (`app/ora-panel/blog/new/page.tsx`)
    - Post creation form with title input, post type selector, locale selector
    - Tiptap rich text editor for content
    - Collapsible SEO panel with meta title, meta description, meta keywords, canonical URL, robots directive inputs
    - Featured image picker (drag/drop zone opening MediaPickerModal)
    - OG image picker (drag/drop zone, defaults to featured image display when not explicitly set)
    - Category selector with hierarchy display
    - Tag input with autocomplete from existing tags
    - Live slug preview below title that updates as user types, with visual indicator for duplicate slugs
    - _Requirements: 24.2, 24.4, 7.3, 7.4, 8.6, 14.4, 15.1, 15.2, 15.3, 15.4_

  - [x] 15.2 Implement post editor page (`app/ora-panel/blog/[id]/page.tsx`)
    - Same layout as creation page, pre-populated with existing post data
    - Add publish/unpublish action buttons
    - Add "Move to Trash" action
    - Add revision history panel showing all revisions with timestamps, authors, and "Restore" action for each
    - Add "Clone to AR" button when AR locale doesn't exist for the namespace
    - _Requirements: 24.1, 24.3, 6a.6_

- [x] 16. Admin panel — Category and tag management pages
  - [x] 16.1 Implement category management page (`app/ora-panel/blog/categories/page.tsx`)
    - Display categories in a tree structure showing parent-child hierarchy
    - Inline create, edit, and delete actions
    - Parent category selector for creating/editing child categories
    - _Requirements: 26.1, 26.2, 12.7_

  - [x] 16.2 Implement tag management page (`app/ora-panel/blog/tags/page.tsx`)
    - Display tags in a searchable flat list
    - Inline create, edit, and delete actions
    - _Requirements: 26.3, 26.4, 13.5_

- [x] 17. Admin panel — Stats dashboard (`app/ora-panel/blog/stats/page.tsx`)
  - [x] 17.1 Implement stats dashboard page
    - Display summary cards: total posts, total views, total shares
    - Display top posts list ranked by view count
    - Display per-platform share count breakdown
    - Add filters for post type (blog/news) and date range
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

- [x] 18. Sidebar navigation update (`app/ora-panel/layout.tsx`)
  - [x] 18.1 Add Blog navigation item to sidebar
    - Add `{ href: '/ora-panel/blog', label: 'Blog', icon: Newspaper }` to the `navItems` array
    - Import `Newspaper` from `lucide-react`
    - Ensure highlighting works for all `/ora-panel/blog` sub-routes
    - _Requirements: 27.1, 27.2_

- [x] 19. Checkpoint — Admin panel complete
  - Ensure all admin panel pages render without errors, navigation works, and CRUD operations function through the UI. Ask the user if questions arise.


- [x] 20. SSR frontend — Blog listing pages
  - [x] 20.1 Implement EN blog listing page (`app/(en)/blog/page.tsx`)
    - Server-rendered paginated list of published posts with title, excerpt, featured image, publication date, and categories
    - Pagination with configurable page size (default 12)
    - Generate proper meta tags (title, description, canonical URL) via `generateBlogMetadata`
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 20.2 Implement AR blog listing page (`app/ar/blog/page.tsx`)
    - Same as EN listing but for Arabic locale, RTL layout
    - _Requirements: 20.1, 20.2_

- [x] 21. SSR frontend — Individual post pages
  - [x] 21.1 Implement EN post page (`app/(en)/blog/[slug]/page.tsx`)
    - Server-render full post with title, rich text content (via `renderTiptapToHtml`), featured image, publication date, categories, tags
    - Generate SEO meta tags and OpenGraph tags via `generateBlogMetadata`
    - Include Schema.org JSON-LD structured data via `generateStructuredData`
    - Display social share buttons (Twitter/X, Facebook, LinkedIn, WhatsApp, copy link) with share dialog integration
    - Track view on page load via `POST /api/stats/view/:postId` (fire-and-forget)
    - Display up to 3 related posts at bottom via `fetchRelatedPosts`
    - Return `notFound()` if slug doesn't exist or post is not published
    - URL format: `/blog/{slug}`
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 9.1, 9.2, 9.3, 16.1, 16.2, 16.3, 18.1, 23.1, 23.2, 23.3, 23.4_

  - [x] 21.2 Implement AR post page (`app/ar/blog/[slug]/page.tsx`)
    - Same as EN post page but for Arabic locale, RTL layout
    - URL format: `/ar/blog/{slug}`
    - _Requirements: 21.1, 21.4_

- [x] 22. SSR frontend — Archive pages
  - [x] 22.1 Implement EN category archive page (`app/(en)/blog/category/[slug]/page.tsx`)
    - Server-rendered paginated list of published posts in the category
    - Include category name in page title meta tag
    - URL format: `/blog/category/{slug}`
    - _Requirements: 22.1, 22.3, 22.4_

  - [x] 22.2 Implement EN tag archive page (`app/(en)/blog/tag/[slug]/page.tsx`)
    - Server-rendered paginated list of published posts with the tag
    - Include tag name in page title meta tag
    - URL format: `/blog/tag/{slug}`
    - _Requirements: 22.2, 22.3, 22.4_

  - [x] 22.3 Implement AR category archive page (`app/ar/blog/category/[slug]/page.tsx`)
    - Same as EN category archive but for Arabic locale
    - _Requirements: 22.1, 22.3_

  - [x] 22.4 Implement AR tag archive page (`app/ar/blog/tag/[slug]/page.tsx`)
    - Same as EN tag archive but for Arabic locale
    - _Requirements: 22.2, 22.3_

- [x] 23. Social share tracking integration
  - [x] 23.1 Create share buttons client component (`lib/cms/components/ShareButtons.tsx`)
    - Implement share buttons for Twitter/X, Facebook, LinkedIn, WhatsApp, and copy-to-clipboard
    - Each button opens the respective platform's share dialog with post URL and title pre-filled
    - Copy link button copies URL to clipboard and shows confirmation toast
    - On click, fire `POST /api/stats/share/:postId` with platform param (fire-and-forget)
    - _Requirements: 16.1, 16.2, 16.3, 17.1_

- [x] 24. Checkpoint — Frontend complete
  - Ensure all SSR pages render correctly, share buttons work, view tracking fires, and related posts display. Ask the user if questions arise.

- [x] 25. Audit logging verification
  - [x] 25.1 Write property tests for audit logging (`lib/cms/blog/audit.property.test.ts`)
    - **Property 23: Mutating actions create audit entries** — Verify every mutating action (create, update, trash, restore, delete, publish, unpublish, rollback, auto_purge) on posts, categories, and tags creates an audit log entry with correct userId, action, entityType, entityId, and non-empty summary
    - **Validates: Requirements 1.4, 3.2, 4.2, 4b.4, 5.3, 5.4, 6.3, 6a.5**

  - [x] 25.2 Write property tests for URL format (`lib/cms/blog/url-format.property.test.ts`)
    - **Property 24: Blog URL format** — Verify `/blog/{slug}` for EN, `/ar/blog/{slug}` for AR, `/blog/category/{slug}` for category archives, `/blog/tag/{slug}` for tag archives
    - **Validates: Requirements 21.4, 22.4**

- [x] 26. Final checkpoint — Full integration
  - Ensure all tests pass, all admin panel pages function correctly, all SSR pages render with proper SEO, and the sidebar navigation highlights correctly. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after major milestones
- Property tests validate the 24 universal correctness properties from the design document using fast-check
- The implementation follows existing ORA CMS patterns: Drizzle schema in `lib/cms/schema.ts`, Elysia routes in `lib/cms/api/routes/`, React Query hooks in `lib/cms/hooks/`, Next.js App Router pages
- Tiptap dependencies (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/html`) need to be installed in task 13.1
