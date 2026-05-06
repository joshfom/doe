# feat: admin panel improvements + project landing page designer

**Branch:** `feat/admin-ai-copilot` → `main`

---

## Summary

Admin panel UX improvements, project landing page designer, image carousel component, and bug fixes.

## Changes

### Admin Panel Sidebar
- Flyover expansion — sidebar overlays content instead of pushing layout
- Tooltip on hover for collapsed menu items (fixed positioning, no clipping)

### Project Landing Page Designer
- New Puck-based visual editor at `/ora-panel/projects/[id]/design`
- Default real-estate template (hero, overview, gallery, features, CTA)
- Saves `landingPageData` to project record via PATCH API
- Frontend renders custom layout when `landingPageData` is present
- DB migration: `landing_page_data` jsonb column on projects table

### Image Carousel Component
- New `ImageCarousel` block in the page builder (Basic category)
- Autoplay with configurable interval (3–10s)
- Fade or slide transitions
- Navigation dots + arrows (toggleable)
- Overlay color/opacity for text readability
- Upload multiple images or add by URL

### Bug Fixes
- **Project edit save**: validation schema now accepts `null` for nullable fields
- **Page editor hooks order**: moved `useMemo` above early returns
- **Clone to Arabic**: ensures unique slug + copies all SEO fields
- **Admin AI copilot**: reports + agentic actions

## Migration Required

```sql
ALTER TABLE "projects" ADD COLUMN "landing_page_data" jsonb;
```

Run `bun run db:migrate` or apply `drizzle/0013_rich_silhouette.sql`.

## Testing

- Open any project → click "Design Landing Page" → editor loads with template
- Collapse sidebar → hover icons → tooltips appear
- Pages list → click "Create Arabic" on any EN page → clones successfully
- Project edit → change fields → Save → persists without error
