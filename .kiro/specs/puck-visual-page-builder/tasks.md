# Implementation Plan: Puck Visual Page Builder

## Overview

Build a self-contained visual page builder module (`lib/page-builder/`) on top of `@puckeditor/core`. Implementation proceeds bottom-up: core types and validation first, then data layer, components, editor/renderer wrappers, templates, AI integration, and finally the barrel export wiring everything together. All code is TypeScript with Tailwind CSS 4 styling.

## Tasks

- [x] 1. Install dependencies and set up module structure
  - Install `@puckeditor/core`, `zod`, and `fast-check` (dev)
  - Create `lib/page-builder/` directory structure with placeholder files: `types.ts`, `schema.ts`, `config.ts`, `data-store.ts`, `page-manager.ts`, `ai-generator.ts`, `theme.ts`, `index.ts`, `components/`, `templates/`
  - _Requirements: 10.1, 10.2_

- [x] 2. Define core TypeScript types and Zod schemas
  - [x] 2.1 Create core type definitions (`lib/page-builder/types.ts`)
    - Define `ComponentInstance`, `PageData`, `PageMeta`, `PageRecord`, `EditorTheme` interfaces
    - Define `ValidationResult` type
    - _Requirements: 5.1, 10.5_

  - [x] 2.2 Implement Zod schema validation (`lib/page-builder/schema.ts`)
    - Implement `componentInstanceSchema`, `pageDataSchema` using Zod
    - Implement `validatePageData(data: unknown): ValidationResult` function
    - Validation must reject missing `root`, missing `content`, component instances missing `type` or `props.id`
    - Valid data must pass; invalid data must return `{ success: false, errors: [{ path, message }] }`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 2.3 Write property test: PageData JSON serialization round-trip
    - **Property 1: PageData JSON serialization round-trip**
    - **Validates: Requirements 11.4**

  - [x] 2.4 Write property test: Schema validation rejects invalid PageData
    - **Property 6: Schema validation rejects invalid PageData**
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [x] 3. Implement DataStore interface and in-memory implementation
  - [x] 3.1 Define DataStore interface (`lib/page-builder/data-store.ts`)
    - Define `DataStore` interface with `save`, `load`, `delete` async methods
    - Create `InMemoryDataStore` implementation for testing
    - _Requirements: 5.2, 5.3, 5.6_

  - [x] 3.2 Write property test: DataStore save/load round-trip
    - **Property 2: DataStore save/load round-trip**
    - **Validates: Requirements 5.4**

- [x] 4. Implement PageManager with CRUD and publishing workflow
  - [x] 4.1 Define PageMetaStore interface and in-memory implementation
    - Define `PageMetaStore` interface with `create`, `update`, `delete`, `getById`, `getBySlug`, `list` methods
    - Create `InMemoryPageMetaStore` for testing
    - _Requirements: 6.1, 6.2_

  - [x] 4.2 Implement PageManager (`lib/page-builder/page-manager.ts`)
    - Implement `createPageManager(deps: PageManagerDeps)` factory
    - Implement `createPage(title, slug, initialData)` — validates data, checks slug uniqueness, creates meta + saves data
    - Implement `listPages()` returning all `PageMeta` entries
    - Implement `updatePage(id, updates)` — validates new data if provided, updates meta and data
    - Implement `deletePage(id)` — removes meta and data (idempotent)
    - Implement `publishPage(id)` — sets status to "published", records `publishedAt`
    - Implement `unpublishPage(id)` — sets status to "draft"
    - Enforce slug uniqueness: reject creation if slug already exists with `SlugConflictError`
    - Validate PageData via schema before every save
    - Surface DataStore errors as structured error results
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 5.5_

  - [x] 4.3 Write property test: PageManager CRUD integrity
    - **Property 3: PageManager CRUD integrity**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 4.4 Write property test: Publish/unpublish round-trip
    - **Property 4: Publish/unpublish round-trip**
    - **Validates: Requirements 6.5, 6.6**

  - [x] 4.5 Write property test: Slug uniqueness invariant
    - **Property 5: Slug uniqueness invariant**
    - **Validates: Requirements 6.7**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


- [x] 6. Build the Component Library
  - [x] 6.1 Create component scaffolding and Puck config (`lib/page-builder/config.ts`)
    - Define `pageBuilderConfig` object with `categories` (layout, content, conversion) and `components` map
    - Register component keys: Hero, CallToAction, FeaturesGrid, Testimonials, PricingTable, Footer, TextBlock, ImageBlock, ColumnsLayout
    - Each component entry must have a `render` function, `fields` (Field_Config), and `defaultProps`
    - _Requirements: 1.1, 1.2, 1.3, 12.1, 12.2_

  - [x] 6.2 Implement Hero component
    - Tailwind CSS 4 styled Hero with fields: heading (text), subheading (textarea), ctaText (text), ctaLink (text), backgroundStyle (select with constrained Tailwind values), textAlignment (radio)
    - Responsive design using sm/md/lg/xl breakpoint prefixes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 12.1, 12.2, 12.5_

  - [x] 6.3 Implement CallToAction component
    - Fields: heading (text), description (textarea), buttonText (text), buttonLink (text), variant (select)
    - Tailwind CSS 4 styled with responsive breakpoints
    - _Requirements: 2.1, 2.3_

  - [x] 6.4 Implement FeaturesGrid component
    - Fields: heading (text), features (array of objects with title, description, icon)
    - Responsive grid layout using Tailwind
    - _Requirements: 2.1, 2.3, 12.1_

  - [x] 6.5 Implement Testimonials component
    - Fields: heading (text), testimonials (array of objects with quote, author, role, avatar)
    - Tailwind CSS 4 styled
    - _Requirements: 2.1, 2.3_

  - [x] 6.6 Implement PricingTable component
    - Fields: heading (text), plans (array of objects with name, price, features, ctaText, highlighted)
    - Responsive layout with Tailwind
    - _Requirements: 2.1, 2.3_

  - [x] 6.7 Implement Footer component
    - Fields: copyright (text), links (array of objects with label, url), columns (number)
    - Tailwind CSS 4 styled
    - _Requirements: 2.1, 2.3_

  - [x] 6.8 Implement TextBlock component
    - Fields: content (textarea), alignment (radio), fontSize (select)
    - Tailwind CSS 4 styled with constrained style prop values
    - _Requirements: 2.1, 2.4_

  - [x] 6.9 Implement ImageBlock component
    - Fields: src (text), alt (text), width (select), alignment (radio)
    - Tailwind CSS 4 styled
    - _Requirements: 2.1, 2.3_

  - [x] 6.10 Implement ColumnsLayout component with DropZone
    - Fields: columns (select: 2 or 3), gap (select)
    - Use Puck's `<DropZone>` in each column to allow nested child components
    - _Requirements: 1.4, 2.1, 2.3_

  - [x] 6.11 Write property test: All component fields have default values
    - **Property 11: All component fields have default values**
    - **Validates: Requirements 12.2**

- [x] 7. Implement Template System
  - [x] 7.1 Create TemplateRegistry (`lib/page-builder/templates/index.ts`)
    - Define `PageTemplate` and `TemplateRegistry` interfaces
    - Implement `createTemplateRegistry()` factory with `list()`, `getById()`, `register()` methods
    - Validate template data against schema on registration
    - _Requirements: 8.1, 8.5_

  - [x] 7.2 Create built-in templates
    - Implement Landing_Page, About_Page, Pricing_Page, Contact_Page templates as valid PageData JSON using Component_Library components
    - Each template includes name, description, thumbnailId, and data
    - _Requirements: 8.1, 8.2_

  - [x] 7.3 Write property test: All templates produce valid PageData
    - **Property 8: All templates produce valid PageData**
    - **Validates: Requirements 8.1**

  - [x] 7.4 Write property test: Template instantiation produces independent copy
    - **Property 9: Template instantiation produces independent copy**
    - **Validates: Requirements 8.3, 8.4**

  - [x] 7.5 Write property test: Template registration round-trip
    - **Property 10: Template registration round-trip**
    - **Validates: Requirements 8.5**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Editor component with custom UI overrides
  - [x] 9.1 Create EditorTheme config (`lib/page-builder/theme.ts`)
    - Define `EditorTheme` interface with colors, logo, fontFamily
    - Implement theme-to-CSS-custom-properties mapping
    - _Requirements: 4.2_

  - [x] 9.2 Implement custom UI overrides (`lib/page-builder/components/ui-overrides.tsx`)
    - Create custom header, sidebar, and toolbar components using Puck's override system
    - Apply theme colors, typography, and iconography from EditorTheme config
    - Ensure no visible Puck default branding
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 9.3 Implement Plugin Rail panels (`lib/page-builder/components/plugins/`)
    - Create page settings panel (title, slug)
    - Create SEO metadata panel
    - Create publishing controls panel
    - Register panels via Puck's Plugin_Rail
    - _Requirements: 4.4_

  - [x] 9.4 Implement PageEditor component (`lib/page-builder/components/PageEditor.tsx`)
    - Wrap Puck `<Puck>` component with `pageBuilderConfig`, custom overrides, plugins, and theme
    - Accept `initialData`, `onSave`, `onPublish`, `theme`, `aiGenerator` props
    - Wire save handler to produce Page_Data JSON and call `onSave`
    - Display error toast on save failure, preserve editor state
    - Support real-time canvas preview updates on field changes (Puck built-in)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.5_

- [x] 10. Implement Renderer component
  - [x] 10.1 Implement PageRenderer (`lib/page-builder/components/PageRenderer.tsx`)
    - Wrap Puck `<Render>` with `pageBuilderConfig` and validated PageData
    - Validate PageData via schema before rendering; show fallback on invalid data
    - Filter out unknown component keys from PageData before passing to `<Render>` to gracefully skip them
    - Accept `data` and optional `fallback` props
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 11.2_

  - [x] 10.2 Write property test: Renderer gracefully handles unknown components
    - **Property 7: Renderer gracefully handles unknown components**
    - **Validates: Requirements 7.3, 7.4**

- [x] 11. Implement AI Generator
  - [x] 11.1 Define AIGenerator interface and PuckCloudAIGenerator (`lib/page-builder/ai-generator.ts`)
    - Define `AIGenerator` and `AIGenerateOptions` interfaces
    - Implement `PuckCloudAIGenerator` using `@puckeditor/cloud-client`'s `generate()` with `pageBuilderConfig`
    - Validate generated PageData against schema; throw on invalid output
    - Wrap cloud client errors with context (rate limits, API key issues, network failures)
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7_

  - [x] 11.2 Wire AI Generator into PageEditor
    - When `aiGenerator` prop is provided, add AI generation UI (prompt input) to the editor
    - On generation, load produced PageData into the canvas for review
    - On failure, display error message and preserve current editor state
    - _Requirements: 9.3, 9.5_

- [x] 12. Create barrel export and integration wiring
  - [x] 12.1 Create barrel export (`lib/page-builder/index.ts`)
    - Export all public components: `PageEditor`, `PageRenderer`
    - Export config: `pageBuilderConfig`
    - Export all TypeScript types: `PageData`, `PageMeta`, `PageRecord`, `DataStore`, `AIGenerator`, `AIGenerateOptions`, `PageTemplate`, `TemplateRegistry`, `EditorTheme`, `ValidationResult`
    - Export utilities: `validatePageData`, `createPageManager`, `createTemplateRegistry`, `PuckCloudAIGenerator`
    - _Requirements: 10.1, 10.5_

  - [x] 12.2 Create Next.js integration routes
    - Create editor page route that imports `PageEditor` and wires it to a DataStore implementation and PageManager
    - Create dynamic catch-all route for rendering published pages using `PageRenderer` with SSR
    - Create page listing/management route using PageManager's `listPages`
    - Wire template selection into page creation flow via PageManager + TemplateRegistry
    - _Requirements: 6.8, 7.3, 7.4, 10.3_

  - [x] 12.3 Write integration tests
    - Test PageEditor mounts without errors with valid config and data
    - Test PageRenderer produces HTML server-side
    - Test full page lifecycle: create → save → publish → render → unpublish → delete
    - _Requirements: 3.1, 7.1, 7.2, 6.1, 6.3, 6.4, 6.5, 6.6_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases
- All components use Tailwind CSS 4 exclusively — no custom CSS
- The module is self-contained under `lib/page-builder/` with no host-app dependencies leaked in
