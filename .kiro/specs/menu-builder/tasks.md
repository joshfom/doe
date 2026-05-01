# Implementation Plan: Menu Builder

## Overview

Implement a complete navigation management system for the ORA CMS platform: database schema for menus and menu items, Elysia API routes, React Query hooks, admin panel menu builder with drag-and-drop, and a glassmorphic frontend navigation bar with dropdowns, mega menus, mobile responsiveness, RTL support, and a Register Interest dialog. All code uses TypeScript following existing ORA CMS patterns.

## Tasks

- [x] 1. Database schema and types
  - [x] 1.1 Add `menus` and `menu_items` tables to `lib/cms/schema.ts`
    - Add `menus` table with columns: id (UUID PK), name (text), slug (text, unique), created_at, updated_at
    - Add `menu_items` table with columns: id (UUID PK), menu_id (FK to menus, cascade delete), parent_id (UUID, nullable self-ref), label (text), url (text, default "#"), icon (text, nullable), item_type (text enum: link/dropdown/mega, default "link"), dropdown_type (text enum: simple/mega, nullable), mega_columns (integer, default 3), position (integer, default 0), created_at, updated_at
    - Add indexes on `menu_items.menu_id` and `menu_items.parent_id`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 1.2 Add menu-related types to `lib/cms/types.ts`
    - Add `ItemType`, `DropdownType`, `MenuItemTree`, `MenuWithItems`, `MenuItemRecord`, `ReorderItem` types as specified in the design
    - Extend `AuditEntityType` union to include `"menu"`
    - _Requirements: 12.5, 1.9_

  - [x] 1.3 Generate Drizzle migration
    - Run `bunx drizzle-kit generate` to create the migration SQL for the new tables
    - Run `bunx drizzle-kit push` to apply the migration
    - _Requirements: 12.1, 12.2_

- [x] 2. Pure utility functions and property tests
  - [x] 2.1 Create `lib/cms/utils/menu-tree.ts` with pure utility functions
    - Implement `buildMenuTree(flatItems): MenuItemTree[]` — groups by parentId, sorts by position, recursively attaches children
    - Implement `flattenMenuTree(tree): FlatMenuItem[]` — inverse of buildMenuTree, converts nested tree back to flat array with parentId and position
    - Implement `validateNestingDepth(items): boolean` — validates no item exceeds 2 levels of nesting (root=0, child=1, grandchild=2)
    - Implement `isActiveUrl(itemUrl, currentUrl): boolean` — returns true for exact match or path-prefix match (non-root URLs)
    - _Requirements: 1.5, 3.4, 3.5, 5.5, 13.7_

  - [x] 2.2 Write property test: Menu tree build/flatten round-trip
    - **Property 2: Round-trip consistency** — For any valid flat array of menu items, `flattenMenuTree(buildMenuTree(items))` produces equivalent items
    - File: `lib/cms/menu-builder/tree.property.test.ts`
    - **Validates: Requirements 1.5, 13.7**

  - [x] 2.3 Write property test: Maximum nesting depth validation
    - **Property 6: Nesting depth validation** — `validateNestingDepth(items)` returns true iff no item exceeds 2 levels
    - File: `lib/cms/menu-builder/tree.property.test.ts`
    - **Validates: Requirements 3.4, 3.5**

  - [x] 2.4 Write property test: Link items cannot have children
    - **Property 8: Link items have no children** — No item of type "link" has any children pointing to it
    - File: `lib/cms/menu-builder/tree.property.test.ts`
    - **Validates: Requirements 4.5**

  - [x] 2.5 Write property test: Slug generation produces valid URL-safe slugs
    - **Property 1: Valid slug generation** — For any non-empty name, `generateSlug(name)` produces a non-empty string with only lowercase alphanumeric and hyphens, no leading/trailing hyphens
    - File: `lib/cms/menu-builder/invariants.property.test.ts`
    - **Validates: Requirements 1.1**

  - [x] 2.6 Write property test: New item position auto-assignment
    - **Property 3: Position auto-assignment** — Adding a new item to a parent level with N items assigns position N
    - File: `lib/cms/menu-builder/invariants.property.test.ts`
    - **Validates: Requirements 2.1**

  - [x] 2.7 Write property test: dropdown_type consistency with item_type
    - **Property 5: dropdown_type/item_type consistency** — dropdown_type is null when item_type is "link", "simple" when "dropdown", "mega" when "mega"
    - File: `lib/cms/menu-builder/invariants.property.test.ts`
    - **Validates: Requirements 2.5, 2.6, 2.7, 12.5**

  - [x] 2.8 Write property test: Active state URL matching
    - **Property 9: Active URL matching** — Active detection returns true iff current URL matches exactly or is a path-prefix match for non-root URLs
    - File: `lib/cms/menu-builder/invariants.property.test.ts`
    - **Validates: Requirements 5.5**

  - [x] 2.9 Write property test: Delete item promotes children and preserves count minus one
    - **Property 4: Delete promotes children** — After deleting a non-leaf item, children get the deleted item's parentId and total count is original minus one
    - File: `lib/cms/menu-builder/reorder.property.test.ts`
    - **Validates: Requirements 2.4**

  - [x] 2.10 Write property test: Reorder preserves item count
    - **Property 7: Reorder count preservation** — For any valid bulk reorder, total item count remains equal
    - File: `lib/cms/menu-builder/reorder.property.test.ts`
    - **Validates: Requirements 3.7**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Menu API routes
  - [x] 4.1 Create `lib/cms/api/routes/menus.ts` Elysia plugin
    - Implement public routes: `GET /menus/active` (returns active menu with hierarchical items), `GET /menus/:id` (returns menu with hierarchical items)
    - Implement read routes: `GET /menus` (list all menus ordered by created_at)
    - Implement protected routes: `POST /menus` (create with name validation, duplicate check, slug generation), `PUT /menus/:id` (update name, regenerate slug), `DELETE /menus/:id` (cascade delete)
    - Implement item routes: `POST /menus/:id/items` (add item with label validation, auto-position, dropdown_type consistency), `PUT /menus/:id/items/:itemId` (update fields with dropdown_type consistency), `DELETE /menus/:id/items/:itemId` (delete and promote children)
    - Implement `PUT /menus/:id/reorder` (bulk reorder with validation: item IDs belong to menu, nesting depth check, single transaction)
    - Implement `POST /menus/:id/set-active` (update site_settings active_menu_id)
    - Use `buildMenuTree()` for hierarchical responses
    - Log audit entries for create, update, delete, set-active operations with entity type "menu"
    - Follow the existing `postsRoutes` pattern (publicMenus, readMenus, protectedMenus sub-plugins)
    - _Requirements: 1.1–1.9, 2.1–2.7, 3.1–3.7, 4.5, 11.2, 11.3, 13.1–13.6_

  - [x] 4.2 Register `menusRoutes` in `lib/cms/api/index.ts`
    - Import and `.use(menusRoutes)` following the existing route registration pattern
    - _Requirements: 13.6_

- [x] 5. Server-side fetch utility and React Query hooks
  - [x] 5.1 Create `fetchActiveMenu()` in `lib/cms/utils/fetch-menu.ts`
    - Server-side utility that fetches `GET /api/menus/active` and returns `MenuWithItems | null`
    - Follow the same pattern as `fetchSiteSettings()` in `lib/cms/utils/fetch-page.ts`
    - _Requirements: 5.6, 11.4, 11.5_

  - [x] 5.2 Create `lib/cms/hooks/use-menus.ts` React Query hooks
    - Implement `menuKeys` query key factory
    - Implement `useMenus()`, `useMenu(id)`, `useActiveMenu()`
    - Implement `useCreateMenu()`, `useUpdateMenu()`, `useDeleteMenu()` mutations with optimistic updates
    - Implement `useCreateMenuItem()`, `useUpdateMenuItem()`, `useDeleteMenuItem()` mutations
    - Implement `useReorderMenuItems()` mutation with optimistic update
    - Implement `useSetActiveMenu()` mutation
    - Export from `lib/cms/hooks/index.ts`
    - Follow the `use-posts.ts` pattern for query keys, mutations, and cache invalidation
    - _Requirements: 1.1–1.8, 2.1–2.7, 3.1–3.6, 11.1–11.3_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Admin panel menu builder
  - [x] 7.1 Create `app/ora-panel/menus/page.tsx` menu builder page
    - Display list of all menus with create, edit, delete actions
    - Menu selector to choose which menu to edit
    - "Set as Active" toggle/button for each menu
    - "Add Menu Item" form with fields: label, URL, icon (optional Lucide icon name), item type (link/dropdown/mega)
    - When item type is "mega", show column count selector (2, 3, or 4)
    - Sortable tree view using `@dnd-kit/core` and `@dnd-kit/sortable` for drag-and-drop reordering and nesting
    - Item editor panel for editing selected item properties (label, URL, icon, item type, dropdown type, mega columns)
    - Delete action per item with confirmation prompt
    - Visual nesting with indentation
    - Follow ORA design system (warm-neutral palette, square corners, thin strokes, gold accent)
    - _Requirements: 10.1–10.7, 4.1–4.5, 11.1–11.3_

  - [x] 7.2 Add "Menus" to sidebar navItems in `app/ora-panel/layout.tsx`
    - Add `{ href: '/ora-panel/menus', label: 'Menus', icon: Menu }` to the navItems array
    - Import `Menu` icon from lucide-react
    - _Requirements: 14.1, 14.2_

- [x] 8. CTA settings in admin panel
  - [x] 8.1 Add Navigation CTA fields to `app/ora-panel/settings/page.tsx`
    - Add a "Navigation" section with "Navigation CTA Label" and "Navigation CTA URL" input fields
    - Use site_settings keys `nav_cta_label` and `nav_cta_url`
    - _Requirements: 8.1, 8.2_

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Frontend navigation components
  - [x] 10.1 Create `lib/cms/components/NavigationBar.tsx` server component
    - Fetch active menu via `fetchActiveMenu()` and site settings via `fetchSiteSettings()`
    - Pass menu data, CTA label, CTA URL to `NavigationBarClient`
    - _Requirements: 5.6, 11.4, 11.5_

  - [x] 10.2 Create `NavigationBarClient` client component in `lib/cms/components/NavigationBarClient.tsx`
    - Glassmorphic fixed-position bar with `backdrop-blur` and semi-transparent background
    - Site logo from `public/site-logo.svg` on the left as link to home
    - Centered menu items from active menu
    - CTA button on the right (from props)
    - Active state indicator (bold text + small downward triangle) based on current pathname using `isActiveUrl()`
    - RTL support via `dir` attribute from parent layout
    - Hamburger icon below 768px replacing centered menu items
    - _Requirements: 5.1–5.7, 7.1_

  - [x] 10.3 Create `DropdownPanel` component in `lib/cms/components/DropdownPanel.tsx`
    - Renders simple dropdown children as vertical list
    - Framer Motion `AnimatePresence` for fade-in/out animation
    - 150ms close delay on mouse leave
    - Viewport overflow prevention (horizontal position adjustment)
    - Keyboard navigation (Tab/Arrow keys) and Escape to close
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 10.4 Create `MegaMenuPanel` component in `lib/cms/components/MegaMenuPanel.tsx`
    - Renders mega menu children in multi-column grid (configurable 2-4 columns)
    - Each direct child is a section header with nested children below
    - Same animation, delay, overflow, and keyboard behavior as DropdownPanel
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 4.1, 4.2_

  - [x] 10.5 Create `MobileMenuOverlay` component in `lib/cms/components/MobileMenuOverlay.tsx`
    - Full-screen overlay triggered by hamburger icon
    - Vertical list with expandable sub-items (+/- toggle)
    - CTA button at bottom
    - Slide-in animation via Framer Motion
    - Close on link navigation
    - _Requirements: 7.1–7.6_

  - [x] 10.6 Create `RegisterInterestDialog` component in `lib/cms/components/RegisterInterestDialog.tsx`
    - Centered modal overlay with backdrop (`bg-ora-charcoal/40`)
    - Card component with `max-w-xl`
    - Title "Register Your Interest", placeholder paragraph, close button
    - Close on backdrop click, close button, or Escape key
    - CTA button triggers this dialog when URL is `#register-interest`
    - _Requirements: 9.1–9.5, 8.3_

- [x] 11. Integrate NavigationBar into layouts
  - [x] 11.1 Add NavigationBar to `app/(en)/layout.tsx`
    - Import and render `NavigationBar` server component above children
    - _Requirements: 5.1–5.7_

  - [x] 11.2 Add NavigationBar to `app/ar/layout.tsx`
    - Import and render `NavigationBar` server component above children
    - RTL layout handled by parent `dir="rtl"` attribute
    - _Requirements: 5.7_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1–9)
- Unit tests validate specific examples and edge cases
- The `@dnd-kit` packages may need to be installed: `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- The `fast-check` package may need to be installed for property tests: `bun add -d fast-check`
