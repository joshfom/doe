# Implementation Plan: Atomic Component Architecture

## Overview

Refactor the ORA page builder to a fully atomic, composable architecture. Most atomic components already exist. The remaining work is: refactor Section to remove `maxWidth`, add Icon component, create the template component system, update sidebar categories, and migrate existing page templates. Property-based and unit tests validate correctness.

## Tasks

- [x] 1. Refactor Section component to remove maxWidth
  - [x] 1.1 Remove `maxWidth` field and default from Section in `lib/page-builder/config.ts`
    - Remove the `maxWidth` field definition from `Section.fields`
    - Remove `maxWidth: "1200"` from `Section.defaultProps`
    - Update `Section.render` to remove `maxWidth` logic — the inner `<div>` wrapping the DropZone should have `position: relative; zIndex: 2` only, no `maxWidth`, no horizontal padding
    - Existing page data with `maxWidth` on Section should be silently ignored (field removed from UI, old data harmless)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.2 Write unit tests for Section refactor
    - Verify Section fields do NOT include `maxWidth`
    - Verify Section defaultProps do NOT include `maxWidth`
    - Verify Section renders full-width with no content constraint
    - _Requirements: 3.3, 3.4_

- [x] 2. Add Icon atomic component
  - [x] 2.1 Create Icon component with Lucide icon map in `lib/page-builder/config.ts`
    - Import ~20 curated Lucide icons (Home, Phone, Mail, MapPin, Star, Heart, Check, ArrowRight, Building, Palmtree, Waves, Sun, Shield, Car, Bed, Bath, Eye, Download, ExternalLink, Quote)
    - Create `ICON_MAP: Record<string, React.ComponentType>` mapping icon name strings to Lucide components
    - Define Icon component with fields: `icon` (select from ICON_MAP keys), `size` (select: 16/20/24/32/40/48/64), `color` (reuse colorField), `alignment` (toggle: left/center/right), `strokeWidth` (select: 1/1.5/2, default 1)
    - Include `_padding`, `_margin`, `_border`, and animation fields
    - Render: wrap Lucide component in a div with alignment, pass size/color/strokeWidth
    - Handle invalid icon name gracefully — render fallback placeholder
    - Register Icon in `pageBuilderConfig.components`
    - _Requirements: 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.6_

  - [x] 2.2 Write property test: Icon renders valid SVG for any predefined icon name
    - **Property 3: Icon renders valid SVG for any predefined icon name**
    - Generate random icon name from ICON_MAP keys, random valid size, random hex color
    - Render Icon component and verify output contains an SVG element
    - **Validates: Requirements 4.6, 4.7, 4.8**

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create template component system
  - [x] 4.1 Define ComponentTemplate interface and template builder utilities
    - Create `lib/page-builder/templates/component-templates.ts`
    - Define `ComponentTemplate` interface with `id`, `name`, `description`, `build()` function
    - `build()` returns `{ content: ComponentInstance[], zones: Record<string, ComponentInstance[]> }` with fresh unique IDs each call (use `crypto.randomUUID()`)
    - Export a helper `generateId()` for unique ID generation
    - _Requirements: 6.6, 6.7_

  - [x] 4.2 Implement 5 template definitions
    - **Content Block**: Section > Container > Columns(2) > [Image, [Quote + Text + Button]]
    - **Hero Section**: Section(bg image, dark overlay) > Container > [Heading + Text + Button]
    - **Feature Section**: Section > Container > [Heading + FeatureGrid]
    - **CTA Section**: Section(charcoal bg) > Container > [Heading + Text + Button(gold)]
    - **Testimonial Section**: Section > Container > [Heading + Columns(3) > [Quote, Quote, Quote]]
    - Each template uses realistic ORA design system defaults (colors, fonts, spacing)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 4.3 Register template components in Puck config
    - Create thin Puck component wrappers (TplContentBlock, TplHeroSection, TplFeatureSection, TplCTASection, TplTestimonialSection) in `lib/page-builder/config.ts`
    - Each wrapper triggers template expansion on insertion (via `resolveData` or initial render)
    - Register all 5 in `pageBuilderConfig.components`
    - _Requirements: 6.6, 6.7, 7.4_

  - [x] 4.4 Write property test: Template expansion produces unique component IDs
    - **Property 5: Template expansion produces unique component IDs**
    - For each template, call `build()`, collect all IDs from content and zones, verify uniqueness
    - Call `build()` twice, verify no ID overlap between invocations
    - **Validates: Requirements 6.6, 6.7**

  - [x] 4.5 Write property test: Template expanded data JSON round-trip
    - **Property 8: Template expanded data JSON round-trip**
    - For each template, call `build()`, JSON.stringify then JSON.parse, verify deep equality
    - **Validates: Requirements 12.3, 12.4**

- [x] 5. Update sidebar categories
  - [x] 5.1 Add "Templates" category and Icon to "Basic" in `lib/page-builder/config.ts`
    - Add `"Icon"` to the `basic.components` array
    - Add `templates` category with components: `["TplContentBlock", "TplHeroSection", "TplFeatureSection", "TplCTASection", "TplTestimonialSection"]` and title "Templates"
    - _Requirements: 7.2, 7.4_

  - [x] 5.2 Write unit tests for sidebar categories
    - Verify "Layout" category contains Section, Container, Columns, Accordion, Spacer, Divider
    - Verify "Basic" category contains Heading, Text, Button, InlineLink, Image, Quote, Icon
    - Verify "ORA" category contains HeroBanner, PropertyCard, FeatureGrid, FilterTabs, StatRow, Footer, MegaFooter
    - Verify "Templates" category contains all 5 template components
    - Verify "Layout" category has `defaultExpanded: true`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Migrate existing page templates to atomic components
  - [x] 7.1 Migrate `bayn-landing` template in `lib/page-builder/templates/index.ts`
    - Replace ContentBlock usage with Section > Container > Columns(2) > [Image, [Quote + Text + Button]]
    - Use `zones` data format for nested DropZone children (keyed by `"parentId:zoneName"`)
    - Ensure all referenced component types exist in the updated registry
    - _Requirements: 11.1, 11.4_

  - [x] 7.2 Migrate `property-showcase` template
    - Verify all component types referenced exist in the updated registry
    - Update any compound component references if present
    - _Requirements: 11.2, 11.4_

  - [x] 7.3 Migrate `specs-page` template
    - Verify all component types referenced exist in the updated registry
    - Update any compound component references if present
    - _Requirements: 11.3, 11.4_

  - [x] 7.4 Write property test: All built-in page templates pass schema validation
    - **Property 6: All built-in page templates pass schema validation**
    - For each template in the registry, call `validatePageData(template.data)` and assert `success: true`
    - **Validates: Requirements 11.4**

- [x] 8. Write remaining property tests
  - [x] 8.1 Write property test: Style system fields present on all atomic components
    - **Property 1: Style system fields present on all atomic components**
    - For each atomic component (Heading, Text, Button, InlineLink, Image, Quote, Spacer, Divider, Icon), verify fields include `_padding`, `_margin`, `_border`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.6**

  - [x] 8.2 Write property test: Typography fields present on text-bearing atomic components
    - **Property 2: Typography fields present on text-bearing atomic components**
    - For each text-bearing component (Heading, Text, Button, InlineLink, Quote), verify fields include fontFamily, fontSize, fontWeight, color, textAlign, letterSpacing, lineHeight
    - **Validates: Requirements 5.5**

  - [x] 8.3 Write property test: Heading renders correct HTML tag for any level
    - **Property 4: Heading renders correct HTML tag for any level**
    - For each level h1-h6, render Heading and verify the output tag matches
    - **Validates: Requirements 10.2**

  - [x] 8.4 Write property test: Component props JSON round-trip
    - **Property 7: Component props JSON round-trip**
    - For each component in the registry, JSON.stringify then JSON.parse its defaultProps, verify deep equality
    - **Validates: Requirements 12.1, 12.2**

- [x] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design uses TypeScript throughout — all implementation uses TypeScript
- ContentBlock, HighlightBlock, and Gallery remain in the component registry for backward compatibility but are excluded from sidebar categories (already done)
- Container, Quote, InlineLink, style fields, typography fields, animation fields, and Button borderRadius are already implemented
- Property tests use `fast-check` and go in `lib/page-builder/config.property.test.ts`
- Unit tests go in a new `lib/page-builder/config.test.ts` or extend the existing property test file
