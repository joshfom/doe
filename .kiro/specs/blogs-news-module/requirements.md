# Requirements Document

## Introduction

The Blogs & News module extends the ORA CMS platform with a purpose-built content management system for blog posts and news articles (construction updates, developer announcements, real estate industry news). Unlike the existing pages system which uses the Puck visual page builder, this module uses a rich text editor (Tiptap) for long-form content authoring. It includes WordPress-level SEO controls, hierarchical categories, flat tags, social sharing, view/share analytics, and SSR frontend rendering — all following the established ORA CMS patterns (Drizzle schema, Elysia API, React Query hooks, Next.js App Router).

## Glossary

- **Post_Manager**: The backend service responsible for CRUD operations on blog posts and news articles, including slug generation, status transitions, and locale handling.
- **Post**: A blog post or news article entity stored in the `posts` table, containing rich text content, SEO metadata, and publication state.
- **Category_Manager**: The backend service responsible for CRUD operations on hierarchical categories, including parent-child relationship enforcement.
- **Category**: A hierarchical classification entity stored in the `categories` table, supporting parent-child nesting.
- **Tag_Manager**: The backend service responsible for CRUD operations on flat tags.
- **Tag**: A flat label entity stored in the `tags` table, used for cross-cutting content classification.
- **SEO_Controller**: The component responsible for managing SEO metadata fields (meta title, meta description, meta keywords, canonical URL, robots directive, OpenGraph data, Schema.org structured data) for each post.
- **Slug_Generator**: The utility that produces URL-safe slugs from post titles, checks for duplicates within a locale, and appends numeric suffixes when collisions occur.
- **Rich_Text_Editor**: The Tiptap-based content editor embedded in the admin panel for authoring post body content with formatting, media embeds, and structured blocks.
- **Rich_Text_Renderer**: The SSR component that renders stored Tiptap JSON content to HTML on the frontend with all formatting preserved.
- **Media_Library**: The existing ORA CMS media system (`/api/media`) used for uploading and selecting images for featured images, OG images, and inline editor images.
- **Share_Tracker**: The service that records and aggregates social share events per post per platform.
- **View_Tracker**: The service that records and aggregates page view events per post.
- **Stats_Dashboard**: The admin panel view that displays view counts, share counts, and trending posts.
- **Frontend_Renderer**: The Next.js SSR pages that render blog listing, individual post, category archive, and tag archive pages for public visitors.
- **Admin_Panel**: The existing ORA CMS admin interface at `/ora-panel/` routes where content managers create and manage posts, categories, tags, and view analytics.
- **Post_Type**: An enum distinguishing between "blog" and "news" content types within the same posts table.
- **Revision_Manager**: The service responsible for creating, listing, and restoring content revisions for posts, storing snapshots of title, slug, content, and SEO fields before each update.
- **Trash_Manager**: The service responsible for soft-deleting posts to a trash state, restoring posts from trash, and permanently purging trashed posts after a configurable retention period.
- **Trash_Retention_Period**: The number of days a trashed post is retained before automatic permanent deletion, configurable via the admin settings panel (default: 3 days).

## Requirements

### Requirement 1: Post Creation

**User Story:** As a content manager, I want to create blog posts and news articles with a title, rich text body, post type, and locale, so that I can publish content for the ORA platform.

#### Acceptance Criteria

1. WHEN a content manager submits a new post with a valid title, post type, and locale, THE Post_Manager SHALL create a Post record with status "draft" and return the created Post.
2. WHEN a content manager submits a new post without a title, THE Post_Manager SHALL return a 400 error with the message "Title is required".
3. THE Post_Manager SHALL assign a UUID namespace to each new Post for locale grouping, following the same pattern as the existing pages system.
4. WHEN a new post is created, THE Post_Manager SHALL log an audit entry with action "create", entity type "post", and a summary containing the post title and locale.

### Requirement 2: Post Reading and Listing

**User Story:** As a content manager, I want to list and filter posts by locale, status, post type, category, and tag, so that I can find and manage content efficiently.

#### Acceptance Criteria

1. WHEN a content manager requests the post list, THE Post_Manager SHALL return posts grouped by namespace with locale completion indicators, following the same PageNamespaceGroup pattern as the pages system.
2. WHERE a locale filter is provided, THE Post_Manager SHALL return only posts matching the specified locale.
3. WHERE a status filter is provided, THE Post_Manager SHALL return only posts matching the specified status.
4. WHERE a post type filter is provided, THE Post_Manager SHALL return only posts matching the specified post type ("blog" or "news").
5. WHEN a content manager requests a single post by ID, THE Post_Manager SHALL return the full post record including all SEO fields and rich text content.
6. IF a requested post ID does not exist, THEN THE Post_Manager SHALL return a 404 error with the message "Post not found".

### Requirement 3: Post Updating

**User Story:** As a content manager, I want to update post title, content, SEO fields, featured image, categories, and tags, so that I can refine content before and after publication.

#### Acceptance Criteria

1. WHEN a content manager submits an update to an existing post, THE Post_Manager SHALL create a revision snapshot of the current state BEFORE applying the update, then update the specified fields and set the `updatedAt` timestamp.
2. WHEN a post is updated, THE Post_Manager SHALL log an audit entry with action "update", entity type "post", and a summary containing the post title.
3. IF the post ID provided for update does not exist, THEN THE Post_Manager SHALL return a 404 error.

### Requirement 4: Post Soft Delete (Trash)

**User Story:** As a content manager, I want to move posts to trash instead of permanently deleting them, so that I can recover accidentally deleted content.

#### Acceptance Criteria

1. WHEN a content manager requests deletion of a post, THE Trash_Manager SHALL set the post status to "trashed" and record the `trashedAt` timestamp, rather than permanently deleting it.
2. WHEN a post is trashed, THE Trash_Manager SHALL log an audit entry with action "trash", entity type "post", and a summary containing the post title and locale.
3. WHEN a post is trashed, THE Post_Manager SHALL exclude it from all public API responses and frontend rendering.
4. IF the post ID provided for trashing does not exist, THEN THE Trash_Manager SHALL return a 404 error.
5. WHEN a content manager views the post listing, THE Admin_Panel SHALL NOT display trashed posts in the default view.

### Requirement 4a: Trash Management

**User Story:** As a content manager, I want to view trashed posts, restore them, or permanently delete them, so that I have full control over the trash lifecycle.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a "Trash" view accessible from the post listing page that displays all trashed posts with their trashed date and days remaining before auto-purge.
2. WHEN a content manager restores a post from trash, THE Trash_Manager SHALL set the post status back to "draft", clear the `trashedAt` timestamp, and log an audit entry with action "restore".
3. WHEN a content manager permanently deletes a post from trash, THE Trash_Manager SHALL hard-delete the post record and all associated category/tag relationships, revisions, view counts, and share counts, and log an audit entry with action "delete".
4. THE Admin_Panel SHALL display a confirmation dialog before permanent deletion warning that this action cannot be undone.

### Requirement 4b: Automatic Trash Purge

**User Story:** As an administrator, I want trashed posts to be automatically permanently deleted after a configurable retention period, so that the database stays clean without manual intervention.

#### Acceptance Criteria

1. THE Trash_Manager SHALL automatically permanently delete posts that have been in the trash for longer than the configured Trash_Retention_Period.
2. THE Trash_Retention_Period SHALL default to 3 days and be configurable via the admin settings panel under a "Blog Settings" section.
3. THE Trash_Manager SHALL store the Trash_Retention_Period setting in the existing `site_settings` table with key "blog_trash_retention_days".
4. WHEN a trashed post is auto-purged, THE Trash_Manager SHALL log an audit entry with action "auto_purge", entity type "post", and a summary containing the post title.
5. THE Admin_Panel trash view SHALL display the remaining days before auto-purge for each trashed post, calculated as `Trash_Retention_Period - days_since_trashed`.

### Requirement 5: Post Publishing and Unpublishing

**User Story:** As a content manager, I want to publish and unpublish posts, so that I can control when content becomes visible to the public.

#### Acceptance Criteria

1. WHEN a content manager publishes a post, THE Post_Manager SHALL set the status to "published", record the `publishedAt` timestamp, and return the updated post.
2. WHEN a content manager unpublishes a post, THE Post_Manager SHALL set the status to "draft" and return the updated post.
3. WHEN a post is published, THE Post_Manager SHALL log an audit entry with action "publish".
4. WHEN a post is unpublished, THE Post_Manager SHALL log an audit entry with action "unpublish".
5. IF the post ID provided for publish/unpublish does not exist, THEN THE Post_Manager SHALL return a 404 error.

### Requirement 6: Post Locale Cloning

**User Story:** As a content manager, I want to clone a post to the AR locale, so that I can create Arabic versions of existing content.

#### Acceptance Criteria

1. WHEN a content manager clones a post to the AR locale, THE Post_Manager SHALL create a new post with locale "ar", the same namespace, status "draft", and a copy of all content and SEO fields.
2. IF an AR locale version already exists for the same namespace, THEN THE Post_Manager SHALL return a 409 error with the message "AR locale version already exists for this namespace".
3. WHEN a post is cloned, THE Post_Manager SHALL log an audit entry with action "create" and a summary indicating the clone operation.

### Requirement 6a: Post Revision History

**User Story:** As a content manager, I want a full revision history for each post so that I can view previous versions and roll back to any earlier state.

#### Acceptance Criteria

1. WHEN a post is updated, THE Revision_Manager SHALL create a revision record containing a snapshot of the post's title, slug, content, excerpt, and all SEO fields BEFORE the update is applied.
2. THE Revision_Manager SHALL assign an incrementing revision number to each revision for a given post.
3. WHEN a content manager views a post's revision history, THE Revision_Manager SHALL return all revisions for that post ordered by revision number descending, including the revision author, timestamp, and a title snapshot.
4. WHEN a content manager restores a revision, THE Revision_Manager SHALL create a new revision of the current state (for undo), then overwrite the post's content and SEO fields with the selected revision's snapshot.
5. WHEN a revision is restored, THE Revision_Manager SHALL log an audit entry with action "rollback", entity type "post", and a summary containing the post title and revision number.
6. THE Admin_Panel SHALL display a revision history panel on the post editor page showing all revisions with timestamps, authors, and a "Restore" action for each.

### Requirement 7: Slug Generation and Uniqueness

**User Story:** As a content manager, I want slugs to be auto-generated from the post title with a live preview and duplicate detection, so that I can ensure SEO-friendly unique URLs.

#### Acceptance Criteria

1. WHEN a post is created, THE Slug_Generator SHALL produce a URL-safe slug from the post title using the existing `generateSlug` utility.
2. WHEN a generated slug collides with an existing slug in the same locale, THE Slug_Generator SHALL append a numeric suffix (-1, -2, etc.) using the existing `ensureUniqueSlug` utility.
3. THE Admin_Panel SHALL display a live slug preview below the title field that updates as the content manager types.
4. THE Admin_Panel SHALL display a visual indicator when the generated slug already exists in the same locale.
5. FOR ALL valid post titles, generating a slug then checking uniqueness then storing SHALL produce a slug that is unique within the post's locale (round-trip property).

### Requirement 8: SEO Metadata Management

**User Story:** As a content manager, I want full WordPress-level SEO control including meta title, meta description, meta keywords, canonical URL, robots directive, and OpenGraph settings, so that posts rank well in search engines.

#### Acceptance Criteria

1. THE Post_Manager SHALL store meta title, meta description, meta keywords, canonical URL, and robots directive fields for each post.
2. THE Post_Manager SHALL store a featured image URL (selected via Media_Library) for each post.
3. THE Post_Manager SHALL store an OpenGraph image URL for each post, defaulting to the featured image when not explicitly set.
4. WHEN an OpenGraph image is not explicitly provided, THE SEO_Controller SHALL use the featured image URL as the OpenGraph image.
5. THE Post_Manager SHALL store a robots directive field for each post, defaulting to "index, follow".
6. THE Admin_Panel SHALL provide input fields for all SEO metadata within a collapsible SEO panel on the post editor page.

### Requirement 9: Schema.org Structured Data

**User Story:** As a content manager, I want Schema.org Article/NewsArticle structured data automatically generated for each post, so that search engines can understand the content type.

#### Acceptance Criteria

1. WHEN a published blog post is rendered on the frontend, THE Frontend_Renderer SHALL include a JSON-LD script tag with Schema.org "Article" structured data containing headline, datePublished, dateModified, author, image, and description.
2. WHEN a published news article is rendered on the frontend, THE Frontend_Renderer SHALL include a JSON-LD script tag with Schema.org "NewsArticle" structured data containing headline, datePublished, dateModified, author, image, and description.
3. THE Frontend_Renderer SHALL use the post's meta title as the headline, the `publishedAt` as datePublished, and the `updatedAt` as dateModified in the structured data.

### Requirement 10: Rich Text Editor

**User Story:** As a content manager, I want a Tiptap-based rich text editor with support for headings, bold, italic, lists, links, images, blockquotes, and code blocks, so that I can author well-formatted blog content.

#### Acceptance Criteria

1. THE Rich_Text_Editor SHALL support the following formatting: headings (H1–H6), bold, italic, ordered lists, unordered lists, links, images, blockquotes, and code blocks.
2. THE Rich_Text_Editor SHALL store content as Tiptap-compatible JSON in the post's `content` field.
3. WHEN a content manager inserts an image in the editor, THE Rich_Text_Editor SHALL open the Media_Library picker allowing drag/drop upload or selection of existing media.
4. THE Rich_Text_Editor SHALL provide a toolbar with buttons for all supported formatting options.

### Requirement 11: Rich Text SSR Rendering

**User Story:** As a site visitor, I want blog content to render on the server with all formatting preserved, so that the page loads fast and is SEO-friendly.

#### Acceptance Criteria

1. THE Rich_Text_Renderer SHALL convert Tiptap JSON content to HTML on the server during SSR.
2. THE Rich_Text_Renderer SHALL preserve all formatting (headings, bold, italic, lists, links, images, blockquotes, code blocks) in the rendered HTML.
3. FOR ALL valid Tiptap JSON documents, rendering to HTML then parsing back SHALL produce semantically equivalent content (round-trip property).

### Requirement 12: Category Management

**User Story:** As a content manager, I want to create, update, and delete hierarchical categories with parent-child relationships, so that I can organize posts by topic.

#### Acceptance Criteria

1. WHEN a content manager creates a category with a name and optional parent category, THE Category_Manager SHALL create the category and return it.
2. WHEN a content manager creates a category with a name that already exists, THE Category_Manager SHALL return a 409 error.
3. WHEN a content manager updates a category, THE Category_Manager SHALL update the name and/or parent reference.
4. WHEN a content manager deletes a category, THE Category_Manager SHALL remove the category and all post-category associations for that category.
5. IF a category has child categories, WHEN the parent category is deleted, THEN THE Category_Manager SHALL set the children's parent to null (promote to root).
6. THE Category_Manager SHALL generate a URL-safe slug from the category name.
7. THE Admin_Panel SHALL display categories in a tree structure showing parent-child hierarchy.

### Requirement 13: Tag Management

**User Story:** As a content manager, I want to create, update, and delete flat tags, so that I can cross-classify posts with flexible labels.

#### Acceptance Criteria

1. WHEN a content manager creates a tag with a name, THE Tag_Manager SHALL create the tag with an auto-generated slug and return it.
2. WHEN a content manager creates a tag with a name that already exists, THE Tag_Manager SHALL return a 409 error.
3. WHEN a content manager updates a tag, THE Tag_Manager SHALL update the name and regenerate the slug.
4. WHEN a content manager deletes a tag, THE Tag_Manager SHALL remove the tag and all post-tag associations for that tag.
5. THE Admin_Panel SHALL display tags as a flat list with search/filter capability.

### Requirement 14: Post-Category and Post-Tag Assignment

**User Story:** As a content manager, I want to assign categories and tags to posts, so that visitors can browse content by topic.

#### Acceptance Criteria

1. WHEN a content manager assigns categories to a post, THE Post_Manager SHALL create post-category relationship records.
2. WHEN a content manager assigns tags to a post, THE Post_Manager SHALL create post-tag relationship records.
3. WHEN a content manager removes a category or tag from a post, THE Post_Manager SHALL delete the corresponding relationship record.
4. THE Admin_Panel SHALL provide a category selector (with hierarchy) and a tag input (with autocomplete) on the post editor page.

### Requirement 15: Featured Image and OG Image Selection

**User Story:** As a content manager, I want to select a featured image and OpenGraph image from the media library using drag/drop or browse, so that posts have visual representation in listings and social shares.

#### Acceptance Criteria

1. THE Admin_Panel SHALL display a drag/drop zone for the featured image that opens the Media_Library picker on click.
2. THE Admin_Panel SHALL display a drag/drop zone for the OpenGraph image that opens the Media_Library picker on click.
3. WHEN a featured image is selected and no OpenGraph image is explicitly set, THE Admin_Panel SHALL display the featured image as the default OpenGraph image.
4. THE Admin_Panel SHALL allow clearing the featured image and OpenGraph image selections.

### Requirement 16: Social Sharing Buttons

**User Story:** As a site visitor, I want share buttons for Twitter/X, Facebook, LinkedIn, WhatsApp, and copy link on each post, so that I can easily share content.

#### Acceptance Criteria

1. THE Frontend_Renderer SHALL display share buttons for Twitter/X, Facebook, LinkedIn, WhatsApp, and copy-to-clipboard on each published post page.
2. WHEN a visitor clicks a share button, THE Frontend_Renderer SHALL open the respective platform's share dialog with the post URL and title pre-filled.
3. WHEN a visitor clicks the copy link button, THE Frontend_Renderer SHALL copy the post URL to the clipboard and display a confirmation message.

### Requirement 17: Share Count Tracking

**User Story:** As a content manager, I want to track how many times each post is shared per platform, so that I can measure content reach.

#### Acceptance Criteria

1. WHEN a visitor clicks a share button, THE Share_Tracker SHALL increment the share count for the post and the specific platform.
2. THE Share_Tracker SHALL store share counts per post per platform (twitter, facebook, linkedin, whatsapp, copy_link).
3. WHEN the stats endpoint is queried for a post, THE Share_Tracker SHALL return the total share count and per-platform breakdown.

### Requirement 18: View Count Tracking

**User Story:** As a content manager, I want to track how many times each post is viewed, so that I can measure content popularity.

#### Acceptance Criteria

1. WHEN a published post page is loaded by a visitor, THE View_Tracker SHALL increment the view count for that post.
2. THE View_Tracker SHALL store the total view count per post.
3. WHEN the stats endpoint is queried for a post, THE View_Tracker SHALL return the total view count.

### Requirement 19: Analytics Stats Dashboard

**User Story:** As a content manager, I want a stats dashboard in the admin panel showing view counts, share counts, and trending posts, so that I can understand content performance.

#### Acceptance Criteria

1. THE Stats_Dashboard SHALL display a summary of total posts, total views, and total shares.
2. THE Stats_Dashboard SHALL display a list of top posts ranked by view count.
3. THE Stats_Dashboard SHALL display per-platform share count breakdowns.
4. THE Stats_Dashboard SHALL allow filtering stats by post type ("blog" or "news") and date range.

### Requirement 20: SSR Blog Listing Page

**User Story:** As a site visitor, I want a server-rendered blog listing page with pagination, so that I can browse all published posts.

#### Acceptance Criteria

1. WHEN a visitor navigates to the blog listing URL, THE Frontend_Renderer SHALL render a paginated list of published posts with title, excerpt, featured image, publication date, and categories.
2. THE Frontend_Renderer SHALL render the listing page on the server (SSR) for SEO.
3. THE Frontend_Renderer SHALL support pagination with a configurable page size (default 12 posts per page).
4. THE Frontend_Renderer SHALL include proper meta tags (title, description, canonical URL) on the listing page.

### Requirement 21: SSR Individual Post Page

**User Story:** As a site visitor, I want a server-rendered individual post page with full content, author info, and metadata, so that I can read the article.

#### Acceptance Criteria

1. WHEN a visitor navigates to a post URL, THE Frontend_Renderer SHALL render the full post with title, rich text content, featured image, publication date, categories, and tags.
2. THE Frontend_Renderer SHALL render the post page on the server (SSR) with all SEO meta tags, OpenGraph tags, and Schema.org structured data.
3. IF the requested post slug does not exist or is not published, THEN THE Frontend_Renderer SHALL return a 404 page.
4. THE Frontend_Renderer SHALL generate SEO-friendly URLs in the format `/blog/{slug}` for English and `/ar/blog/{slug}` for Arabic.

### Requirement 22: Category and Tag Archive Pages

**User Story:** As a site visitor, I want to browse posts filtered by category or tag on dedicated archive pages, so that I can find related content.

#### Acceptance Criteria

1. WHEN a visitor navigates to a category archive URL, THE Frontend_Renderer SHALL render a paginated list of published posts belonging to that category.
2. WHEN a visitor navigates to a tag archive URL, THE Frontend_Renderer SHALL render a paginated list of published posts tagged with that tag.
3. THE Frontend_Renderer SHALL render archive pages on the server (SSR) with proper meta tags including the category or tag name in the title.
4. THE Frontend_Renderer SHALL generate SEO-friendly archive URLs in the format `/blog/category/{slug}` and `/blog/tag/{slug}`.

### Requirement 23: Related Posts

**User Story:** As a site visitor, I want to see related posts at the bottom of each article, so that I can discover more relevant content.

#### Acceptance Criteria

1. THE Frontend_Renderer SHALL display up to 3 related posts at the bottom of each individual post page.
2. THE Frontend_Renderer SHALL select related posts based on shared categories and tags with the current post.
3. THE Frontend_Renderer SHALL exclude the current post from the related posts list.
4. IF fewer than 3 related posts are found by category/tag matching, THEN THE Frontend_Renderer SHALL fill remaining slots with recent posts of the same post type.

### Requirement 24: Admin Panel Post Editor Page

**User Story:** As a content manager, I want a dedicated post editor page in the admin panel with the rich text editor, SEO panel, category/tag selectors, and featured image picker, so that I can manage all aspects of a post in one place.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a post editor page at `/ora-panel/blog/{id}` with the Rich_Text_Editor, SEO metadata panel, category selector, tag input, featured image picker, OG image picker, and revision history panel.
2. THE Admin_Panel SHALL provide a post creation page at `/ora-panel/blog/new` with the same editor layout.
3. THE Admin_Panel SHALL provide publish, unpublish, move to trash, and revision restore actions on the post editor page.
4. THE Admin_Panel SHALL follow the ORA design system (warm-neutral palette, square corners, thin strokes, gold accent).

### Requirement 25: Admin Panel Post Listing Page

**User Story:** As a content manager, I want a post listing page in the admin panel with search, filters, and locale indicators, so that I can manage all blog and news content.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a post listing page at `/ora-panel/blog` displaying all non-trashed posts grouped by namespace with locale completion indicators.
2. THE Admin_Panel SHALL provide search by title or slug on the post listing page.
3. THE Admin_Panel SHALL provide filters for status (draft/published), post type (blog/news), and locale (en/ar) on the post listing page.
4. THE Admin_Panel SHALL display post type, status badge, and locale badges for each post entry.
5. THE Admin_Panel SHALL provide a "Trash" tab or toggle on the post listing page to view trashed posts separately.

### Requirement 26: Admin Panel Category and Tag Management Pages

**User Story:** As a content manager, I want dedicated management pages for categories and tags in the admin panel, so that I can organize the taxonomy independently of individual posts.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a category management page at `/ora-panel/blog/categories` displaying categories in a tree structure.
2. THE Admin_Panel SHALL provide inline create, edit, and delete actions for categories.
3. THE Admin_Panel SHALL provide a tag management page at `/ora-panel/blog/tags` displaying tags in a searchable flat list.
4. THE Admin_Panel SHALL provide inline create, edit, and delete actions for tags.

### Requirement 27: Sidebar Navigation Integration

**User Story:** As a content manager, I want the blog module accessible from the admin panel sidebar, so that I can navigate to it alongside other CMS sections.

#### Acceptance Criteria

1. THE Admin_Panel SHALL add a "Blog" navigation item to the sidebar with a Lucide icon, linking to `/ora-panel/blog`.
2. THE Admin_Panel SHALL highlight the Blog navigation item when any `/ora-panel/blog` route is active.

### Requirement 28: Database Schema

**User Story:** As a developer, I want well-structured database tables for posts, categories, tags, and analytics, so that the module has a solid data foundation.

#### Acceptance Criteria

1. THE Post_Manager SHALL use a `posts` table with columns: id (UUID PK), title, slug, locale (en/ar), namespace (UUID), post_type (blog/news), status (draft/published/trashed), content (JSONB for Tiptap JSON), excerpt, featured_image, meta_title, meta_description, meta_keywords, og_image, canonical_url, robots_directive, author_id (FK to users), published_at, trashed_at, created_at, updated_at.
2. THE Category_Manager SHALL use a `categories` table with columns: id (UUID PK), name, slug, parent_id (self-referencing FK, nullable), created_at, updated_at.
3. THE Tag_Manager SHALL use a `tags` table with columns: id (UUID PK), name, slug, created_at.
4. THE Post_Manager SHALL use a `post_categories` junction table with columns: id (UUID PK), post_id (FK), category_id (FK) with a unique index on (post_id, category_id).
5. THE Post_Manager SHALL use a `post_tags` junction table with columns: id (UUID PK), post_id (FK), tag_id (FK) with a unique index on (post_id, tag_id).
6. THE View_Tracker SHALL use a `post_views` table with columns: id (UUID PK), post_id (FK), count (integer, default 0).
7. THE Share_Tracker SHALL use a `post_shares` table with columns: id (UUID PK), post_id (FK), platform (text), count (integer, default 0) with a unique index on (post_id, platform).
8. THE Revision_Manager SHALL use a `post_revisions` table with columns: id (UUID PK), post_id (FK to posts, cascade delete), user_id (FK to users), data (JSONB snapshot of content and SEO fields), title_snapshot (text), slug_snapshot (text), action (text enum: save/rollback, default "save"), revision_number (integer), created_at (timestamp).
9. THE Post_Manager SHALL create a unique index on (slug, locale) in the `posts` table, excluding trashed posts.
10. THE Category_Manager SHALL create a unique index on (name) in the `categories` table.
11. THE Tag_Manager SHALL create a unique index on (name) in the `tags` table.
