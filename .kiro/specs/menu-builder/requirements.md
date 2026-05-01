# Requirements Document

## Introduction

The Menu Builder module adds a WordPress-style navigation management system to the ORA CMS platform. It consists of two major parts: (1) an admin panel menu builder at `/ora-panel/menus` where content managers create, reorder, and nest menu items with drag-and-drop, configure dropdown types (simple or mega menu), and manage a CTA button; and (2) a glassmorphic frontend navigation bar that renders the menu structure with a fixed logo, centered menu items with active state indicators, dropdown/mega menu support, a CTA button linking to a skeleton "Register Interest" dialog, and full mobile responsive behavior with RTL support. The menu structure is stored in PostgreSQL via Drizzle ORM, served through Elysia API routes, and consumed by React Query hooks — following all established ORA CMS patterns.

## Glossary

- **Menu**: A named collection of Menu_Items stored in the `menus` table, representing a complete navigation structure (e.g., "Main Navigation").
- **Menu_Item**: An individual entry in a Menu stored in the `menu_items` table, containing a label, URL, optional icon, display type, position, and optional parent reference for nesting.
- **Menu_Manager**: The backend service responsible for CRUD operations on Menus and Menu_Items, including reordering, nesting, and validation.
- **Menu_Renderer**: The frontend component that fetches the active menu from the API and renders it as a glassmorphic navigation bar with dropdowns, mega menus, and mobile responsiveness.
- **Dropdown_Type**: An enum classifying how a parent Menu_Item displays its children — either "simple" (single-column list) or "mega" (multi-column sectioned layout).
- **Item_Type**: An enum classifying a Menu_Item's behavior — "link" (plain navigable link), "dropdown" (simple dropdown parent), or "mega" (mega menu parent).
- **CTA_Button**: A fixed call-to-action button on the right side of the navigation bar, with editable label and URL, stored as site settings.
- **Register_Interest_Dialog**: A skeleton modal dialog component triggered by the CTA_Button, containing placeholder content for future form builder integration.
- **Navigation_Bar**: The glassmorphic fixed-position frontend component displaying the site logo, menu items, and CTA button.
- **Active_Indicator**: A visual marker (bold text and small downward-pointing triangle) displayed below the currently active menu item in the Navigation_Bar.
- **Admin_Panel**: The existing ORA CMS admin interface at `/ora-panel/` routes.
- **Site_Logo**: The SVG logo file at `public/site-logo.svg` displayed on the left side of the Navigation_Bar.

## Requirements

### Requirement 1: Menu CRUD Operations

**User Story:** As a content manager, I want to create, read, update, and delete navigation menus, so that I can manage multiple menu structures for the site.

#### Acceptance Criteria

1. WHEN a content manager creates a menu with a valid name, THE Menu_Manager SHALL create a Menu record with a unique slug generated from the name and return the created Menu.
2. WHEN a content manager creates a menu without a name, THE Menu_Manager SHALL return a 400 error with the message "Name is required".
3. WHEN a content manager creates a menu with a name that already exists, THE Menu_Manager SHALL return a 409 error with the message "Menu with this name already exists".
4. WHEN a content manager requests the menu list, THE Menu_Manager SHALL return all menus ordered by creation date.
5. WHEN a content manager requests a single menu by ID, THE Menu_Manager SHALL return the menu record with all associated Menu_Items in their hierarchical structure.
6. IF a requested menu ID does not exist, THEN THE Menu_Manager SHALL return a 404 error with the message "Menu not found".
7. WHEN a content manager updates a menu name, THE Menu_Manager SHALL update the name and regenerate the slug.
8. WHEN a content manager deletes a menu, THE Menu_Manager SHALL delete the menu and all associated Menu_Items via cascade.
9. WHEN a menu is created, updated, or deleted, THE Menu_Manager SHALL log an audit entry with the appropriate action, entity type "menu", and a summary containing the menu name.

### Requirement 2: Menu Item Management

**User Story:** As a content manager, I want to add, edit, and remove individual menu items with label, URL, optional icon, and item type, so that I can build the navigation structure.

#### Acceptance Criteria

1. WHEN a content manager adds a menu item with a valid label and URL, THE Menu_Manager SHALL create a Menu_Item record with the specified item type (defaulting to "link"), assign it the next position in the menu, and return the created item.
2. WHEN a content manager adds a menu item without a label, THE Menu_Manager SHALL return a 400 error with the message "Label is required".
3. WHEN a content manager updates a menu item, THE Menu_Manager SHALL update the specified fields (label, URL, icon, item type, dropdown type) and return the updated item.
4. WHEN a content manager deletes a menu item, THE Menu_Manager SHALL delete the item and promote any child items to the deleted item's parent (or root if the deleted item had no parent).
5. WHEN a content manager sets a menu item's item type to "dropdown", THE Menu_Manager SHALL set the dropdown type to "simple" by default.
6. WHEN a content manager sets a menu item's item type to "mega", THE Menu_Manager SHALL set the dropdown type to "mega".
7. WHEN a content manager sets a menu item's item type to "link", THE Menu_Manager SHALL clear the dropdown type and promote any child items to the item's parent level.

### Requirement 3: Menu Item Reordering

**User Story:** As a content manager, I want to drag and drop menu items to reorder them and create nested sub-menus, so that I can visually arrange the navigation hierarchy.

#### Acceptance Criteria

1. WHEN a content manager reorders menu items via drag-and-drop, THE Menu_Manager SHALL accept a bulk position update containing an array of item IDs with their new position and parent ID values.
2. THE Menu_Manager SHALL validate that all item IDs in the bulk update belong to the specified menu.
3. WHEN a menu item is dragged onto another item of type "dropdown" or "mega", THE Menu_Manager SHALL set the dragged item's parent ID to the target item's ID.
4. THE Menu_Manager SHALL enforce a maximum nesting depth of 2 levels (parent → child → grandchild).
5. IF a reorder operation would exceed the maximum nesting depth, THEN THE Menu_Manager SHALL return a 400 error with the message "Maximum nesting depth exceeded".
6. WHEN a bulk reorder is applied, THE Menu_Manager SHALL update all affected items' position and parent ID values in a single transaction.
7. FOR ALL valid reorder operations, the total count of menu items before and after reordering SHALL remain equal (invariant property).

### Requirement 4: Menu Item Nesting and Dropdown Configuration

**User Story:** As a content manager, I want to configure menu items as simple dropdowns or mega menus with multi-column sections, so that I can create rich navigation experiences.

#### Acceptance Criteria

1. WHEN a menu item's item type is "dropdown", THE Menu_Renderer SHALL display its children as a single-column vertical list on hover/click.
2. WHEN a menu item's item type is "mega", THE Menu_Renderer SHALL display its children in a multi-column grid layout, where each direct child acts as a column section header with its own nested children listed below.
3. THE Menu_Manager SHALL store a `mega_columns` integer field (default 3) on mega-type menu items to control the number of columns in the mega menu layout.
4. WHEN a content manager configures a mega menu item, THE Admin_Panel SHALL provide a column count selector (2, 3, or 4 columns).
5. THE Menu_Manager SHALL prevent assigning children to a menu item of type "link".

### Requirement 5: Navigation Bar Frontend Rendering

**User Story:** As a site visitor, I want a glassmorphic navigation bar with the site logo, centered menu items, and a CTA button, so that I can navigate the site with a premium visual experience.

#### Acceptance Criteria

1. THE Navigation_Bar SHALL render as a fixed-position element at the top of the viewport with a glassmorphic design (frosted glass effect using `backdrop-blur` and semi-transparent background).
2. THE Navigation_Bar SHALL display the Site_Logo from `public/site-logo.svg` on the left side as a link to the home page.
3. THE Navigation_Bar SHALL display menu items from the active menu in the center, horizontally aligned.
4. THE Navigation_Bar SHALL display the CTA_Button on the right side with the label and URL configured in site settings.
5. WHEN a menu item corresponds to the current page URL, THE Navigation_Bar SHALL display the Active_Indicator (bold text and a small downward-pointing triangle below the item).
6. THE Navigation_Bar SHALL fetch the menu structure from the public API endpoint on the server during SSR for fast initial rendering.
7. THE Navigation_Bar SHALL support both LTR (English) and RTL (Arabic) layouts, mirroring the logo, menu, and CTA positions appropriately.

### Requirement 6: Dropdown and Mega Menu Frontend Rendering

**User Story:** As a site visitor, I want dropdown and mega menu navigation to appear on hover with smooth animations, so that I can access nested pages efficiently.

#### Acceptance Criteria

1. WHEN a visitor hovers over a menu item of type "dropdown", THE Menu_Renderer SHALL display a simple dropdown panel below the item containing its child items as a vertical list.
2. WHEN a visitor hovers over a menu item of type "mega", THE Menu_Renderer SHALL display a mega menu panel below the item with child items arranged in the configured number of columns.
3. THE Menu_Renderer SHALL animate dropdown and mega menu panels with a fade-in transition using Framer Motion.
4. WHEN a visitor moves the mouse away from a dropdown or mega menu panel, THE Menu_Renderer SHALL close the panel after a 150ms delay to prevent accidental closure.
5. THE Menu_Renderer SHALL ensure dropdown and mega menu panels do not overflow the viewport horizontally, adjusting position when necessary.
6. WHEN a visitor presses the Escape key while a dropdown or mega menu is open, THE Menu_Renderer SHALL close the panel.
7. THE Menu_Renderer SHALL support keyboard navigation (Tab/Arrow keys) through dropdown and mega menu items for accessibility.

### Requirement 7: Mobile Responsive Navigation

**User Story:** As a mobile visitor, I want a hamburger menu that expands into a full-screen overlay with expandable sub-items, so that I can navigate the site on small screens.

#### Acceptance Criteria

1. WHILE the viewport width is below 768px, THE Navigation_Bar SHALL replace the centered menu items with a hamburger menu icon button.
2. WHEN a mobile visitor taps the hamburger icon, THE Navigation_Bar SHALL display a full-screen overlay containing all menu items in a vertical list.
3. WHEN a mobile visitor taps a menu item that has children, THE Navigation_Bar SHALL toggle the children's visibility with a +/- icon indicator.
4. THE Navigation_Bar SHALL display the CTA_Button at the bottom of the mobile menu overlay.
5. WHEN a mobile visitor taps a link item or navigates to a page, THE Navigation_Bar SHALL close the mobile menu overlay.
6. THE Navigation_Bar SHALL animate the mobile menu overlay open and close with a slide-in transition using Framer Motion.

### Requirement 8: CTA Button Configuration

**User Story:** As a content manager, I want to configure the navigation CTA button label and link from the admin settings, so that I can update the call-to-action without code changes.

#### Acceptance Criteria

1. THE Admin_Panel settings page SHALL provide input fields for "Navigation CTA Label" and "Navigation CTA URL" under a "Navigation" section.
2. THE Menu_Manager SHALL store the CTA label in the `site_settings` table with key "nav_cta_label" and the CTA URL with key "nav_cta_url".
3. WHEN the CTA URL is set to "#register-interest", THE Navigation_Bar SHALL open the Register_Interest_Dialog instead of navigating to a URL.
4. WHEN no CTA label is configured, THE Navigation_Bar SHALL hide the CTA_Button.

### Requirement 9: Register Interest Skeleton Dialog

**User Story:** As a site visitor, I want a "Register Interest" dialog to appear when I click the CTA button, so that I can express interest (form integration comes later).

#### Acceptance Criteria

1. WHEN a visitor clicks the CTA_Button configured to open the Register_Interest_Dialog, THE Register_Interest_Dialog SHALL open as a centered modal overlay with a backdrop.
2. THE Register_Interest_Dialog SHALL display a title "Register Your Interest", a placeholder paragraph explaining the form will be available soon, and a close button.
3. THE Register_Interest_Dialog SHALL follow the ORA design system modal pattern (Card component centered, `max-w-xl`, backdrop with `bg-ora-charcoal/40`).
4. WHEN a visitor clicks the backdrop or the close button, THE Register_Interest_Dialog SHALL close.
5. WHEN a visitor presses the Escape key, THE Register_Interest_Dialog SHALL close.

### Requirement 10: Admin Panel Menu Builder Interface

**User Story:** As a content manager, I want a dedicated menu builder page in the admin panel with drag-and-drop item management, so that I can visually construct navigation menus.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a menu builder page at `/ora-panel/menus` displaying a list of all menus with create, edit, and delete actions.
2. WHEN a content manager selects a menu to edit, THE Admin_Panel SHALL display the menu items in a sortable tree view with drag-and-drop reordering and nesting.
3. THE Admin_Panel SHALL provide an "Add Menu Item" form with fields for label, URL, icon (optional Lucide icon name), and item type (link, dropdown, mega).
4. WHEN a content manager selects a menu item in the tree, THE Admin_Panel SHALL display an edit panel with all configurable fields for that item.
5. THE Admin_Panel SHALL display a visual preview of the menu structure showing nesting levels with indentation.
6. THE Admin_Panel SHALL provide a delete action for each menu item with a confirmation prompt.
7. THE Admin_Panel SHALL follow the ORA design system (warm-neutral palette, square corners, thin strokes, gold accent).

### Requirement 11: Active Menu Selection

**User Story:** As a content manager, I want to designate one menu as the "active" navigation menu, so that the frontend renders the correct menu.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a toggle or button to set a menu as the active navigation menu.
2. THE Menu_Manager SHALL store the active menu ID in the `site_settings` table with key "active_menu_id".
3. WHEN a content manager sets a menu as active, THE Menu_Manager SHALL update the "active_menu_id" setting and log an audit entry.
4. THE Navigation_Bar SHALL fetch and render the menu identified by the "active_menu_id" setting.
5. IF no active menu is configured, THEN THE Navigation_Bar SHALL render an empty navigation (logo and CTA only, no menu items).

### Requirement 12: Database Schema for Menus

**User Story:** As a developer, I want well-structured database tables for menus and menu items following existing Drizzle ORM patterns, so that the module has a solid data foundation.

#### Acceptance Criteria

1. THE Menu_Manager SHALL use a `menus` table with columns: id (UUID PK, default random), name (text, not null), slug (text, not null, unique), created_at (timestamp, default now), updated_at (timestamp, default now).
2. THE Menu_Manager SHALL use a `menu_items` table with columns: id (UUID PK, default random), menu_id (UUID FK to menus, cascade delete, not null), parent_id (UUID FK self-referencing, nullable), label (text, not null), url (text, not null, default "#"), icon (text, nullable), item_type (text enum: "link"/"dropdown"/"mega", default "link"), dropdown_type (text enum: "simple"/"mega", nullable), mega_columns (integer, default 3), position (integer, not null, default 0), created_at (timestamp, default now), updated_at (timestamp, default now).
3. THE Menu_Manager SHALL create an index on `menu_items.menu_id` for efficient querying of items by menu.
4. THE Menu_Manager SHALL create an index on `menu_items.parent_id` for efficient querying of child items.
5. FOR ALL Menu_Item records, the `dropdown_type` field SHALL be null when `item_type` is "link", "simple" when `item_type` is "dropdown", and "mega" when `item_type` is "mega" (invariant property).

### Requirement 13: Menu API Endpoints

**User Story:** As a developer, I want RESTful API endpoints for menu management following the existing Elysia plugin pattern, so that the admin panel and frontend can interact with menu data.

#### Acceptance Criteria

1. THE Menu_Manager SHALL expose a public GET `/api/menus/:id` endpoint that returns a menu with its items in hierarchical structure for frontend rendering.
2. THE Menu_Manager SHALL expose a public GET `/api/menus/active` endpoint that returns the active menu with its items for the Navigation_Bar.
3. THE Menu_Manager SHALL expose authenticated CRUD endpoints: POST `/api/menus` (create), GET `/api/menus` (list all), PUT `/api/menus/:id` (update), DELETE `/api/menus/:id` (delete).
4. THE Menu_Manager SHALL expose authenticated item endpoints: POST `/api/menus/:id/items` (add item), PUT `/api/menus/:id/items/:itemId` (update item), DELETE `/api/menus/:id/items/:itemId` (delete item).
5. THE Menu_Manager SHALL expose an authenticated PUT `/api/menus/:id/reorder` endpoint accepting an array of `{ id, position, parentId }` objects for bulk reordering.
6. THE Menu_Manager SHALL register all routes as an Elysia plugin in `lib/cms/api/index.ts` following the existing route registration pattern.
7. FOR ALL menu item hierarchies returned by the API, serializing to JSON then deserializing SHALL produce an equivalent tree structure (round-trip property).

### Requirement 14: Admin Panel Sidebar Integration

**User Story:** As a content manager, I want the menu builder accessible from the admin panel sidebar, so that I can navigate to it alongside other CMS sections.

#### Acceptance Criteria

1. THE Admin_Panel SHALL add a "Menus" navigation item to the sidebar with a Lucide icon (Menu icon), linking to `/ora-panel/menus`.
2. THE Admin_Panel SHALL highlight the Menus navigation item when any `/ora-panel/menus` route is active.
