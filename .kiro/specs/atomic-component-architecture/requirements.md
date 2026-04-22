# Requirements Document

## Introduction

The page builder currently uses compound components (e.g. `ContentBlock`, `HighlightBlock`) that bundle multiple UI elements into monolithic units. Users cannot independently style, rearrange, or swap individual pieces within these compounds. This refactor decomposes the component system into atomic, independently editable components that can be freely composed inside layout containers with DropZones. Compound components become pre-composed templates that expand into atomic pieces on drop. The result is a flexible, composable page builder aligned with the ORA design system.

## Glossary

- **Page_Builder**: The Puck-based visual editor system defined in `lib/page-builder/config.ts` that allows users to compose pages from registered components.
- **Component_Registry**: The `components` map within the Puck `Config` object that defines all available components, their fields, defaults, and render functions.
- **DropZone**: A Puck primitive (`@puckeditor/core`) that defines a named region within a layout component where child components can be placed via drag-and-drop.
- **Layout_Component**: A component whose primary purpose is spatial arrangement; it contains one or more DropZones and does not render content itself.
- **Atomic_Component**: A self-contained, individually styleable component that renders a single piece of content (heading, text, button, image, etc.) and can be dropped into any DropZone.
- **ORA_Component**: A domain-specific component with a fixed internal layout (e.g. HeroBanner, PropertyCard) that is not decomposed into atomic pieces.
- **Template_Component**: A pre-composed group of atomic and layout components that expands into its constituent parts when dropped onto the canvas, appearing in a dedicated "Templates" sidebar category.
- **Style_System**: The set of configurable style fields (typography, spacing, border, animation) available on every atomic component.
- **Section**: A full-width edge-to-edge layout component that controls background color, image, and overlay. The outermost wrapper for page content.
- **Container**: A layout component that sits inside a Section and controls content max-width (720px, 960px, 1200px, full) and padding. Has a single DropZone.
- **Columns**: A layout component that creates a CSS grid (2, 3, or 4 columns) with a DropZone per column.
- **Accordion**: A collapsible layout component with a title and a DropZone for its content.
- **Compound_Component**: A legacy component (e.g. ContentBlock, HighlightBlock) that bundles multiple content elements into a single non-decomposable unit.

## Requirements

### Requirement 1: Remove Compound Components from the Component Registry

**User Story:** As a page builder user, I want compound components removed from the component list, so that I am guided toward composable atomic components instead of rigid monolithic blocks.

#### Acceptance Criteria

1. WHEN the Page_Builder configuration is loaded, THE Component_Registry SHALL NOT contain the `ContentBlock` component.
2. WHEN the Page_Builder configuration is loaded, THE Component_Registry SHALL NOT contain the `HighlightBlock` component.
3. WHEN the Page_Builder configuration is loaded, THE Component_Registry SHALL NOT contain the `Gallery` component.
4. WHEN the Page_Builder configuration is loaded, THE Component_Registry SHALL contain all Atomic_Component types (Heading, Text, Button, Link, Image, Quote, Spacer, Divider, Icon).
5. WHEN the Page_Builder configuration is loaded, THE Component_Registry SHALL contain all Layout_Component types (Section, Container, Columns, Accordion).
6. WHEN the Page_Builder configuration is loaded, THE Component_Registry SHALL contain all ORA_Component types (HeroBanner, PropertyCard, FilterTabs, StatRow, FeatureGrid, Footer, MegaFooter).

### Requirement 2: Add Container Layout Component

**User Story:** As a page builder user, I want a Container component that controls content width and padding, so that I can constrain content within a full-width Section.

#### Acceptance Criteria

1. THE Container SHALL provide a `maxWidth` field with options: 720px, 960px, 1200px, and full.
2. THE Container SHALL provide padding fields for top, bottom, left, and right.
3. THE Container SHALL render a single DropZone named `container-content` where child components can be placed.
4. WHEN a Container is rendered, THE Container SHALL center its content horizontally within its parent using auto margins.
5. WHEN the `maxWidth` field is set to a pixel value, THE Container SHALL constrain its content to the specified maximum width.
6. WHEN the `maxWidth` field is set to `full`, THE Container SHALL allow content to span the full width of its parent.

### Requirement 3: Separate Section and Container Responsibilities

**User Story:** As a page builder user, I want Section to handle only background styling and Container to handle content width, so that I have clear separation of layout concerns.

#### Acceptance Criteria

1. THE Section SHALL provide fields for background color, background image, background opacity, overlay, and text color.
2. THE Section SHALL render a single DropZone named `section-content` where child components (typically Containers) can be placed.
3. THE Section SHALL NOT provide a `maxWidth` or content-width-constraining field.
4. THE Section SHALL render as a full-width edge-to-edge element with no content width constraint.
5. WHEN a Section contains a Container, THE Container SHALL control the content width independently of the Section.

### Requirement 4: Add New Atomic Components (Link, Quote, Icon)

**User Story:** As a page builder user, I want Link, Quote/Blockquote, and Icon as standalone atomic components, so that I can use them independently in any DropZone.

#### Acceptance Criteria

1. THE Link Atomic_Component SHALL provide fields for link text, URL, color, and hover color.
2. THE Link Atomic_Component SHALL render as an inline anchor element with configurable styling.
3. THE Quote Atomic_Component SHALL provide fields for quote text, border accent color, and font style (italic, normal).
4. THE Quote Atomic_Component SHALL render as a blockquote element with a configurable left border accent.
5. THE Quote Atomic_Component SHALL include typography fields (font size, weight, color, alignment, letter spacing, line height).
6. THE Icon Atomic_Component SHALL provide a field to select an icon from a predefined set of icon names.
7. THE Icon Atomic_Component SHALL provide fields for icon size and icon color.
8. THE Icon Atomic_Component SHALL render the selected icon from the predefined set at the specified size and color.

### Requirement 5: Universal Style System for Atomic Components

**User Story:** As a page builder user, I want every atomic component to have consistent style controls, so that I can fine-tune spacing, borders, and animations on any element.

#### Acceptance Criteria

1. THE Style_System SHALL provide padding fields (top, bottom, left, right) on every Atomic_Component.
2. THE Style_System SHALL provide margin fields (top, bottom) on every Atomic_Component.
3. THE Style_System SHALL provide border fields (width, color, radius) on every Atomic_Component.
4. THE Style_System SHALL provide animation fields (entrance animation type, duration, delay, hover effect) on every Atomic_Component.
5. WHEN typography is applicable to an Atomic_Component (Heading, Text, Button, Link, Quote), THE Style_System SHALL provide typography fields (font size, weight, color, alignment, letter spacing, line height).
6. FOR ALL Atomic_Components registered in the Component_Registry, each Atomic_Component SHALL include spacing and border fields in its field definitions.

### Requirement 6: Template Components for Pre-Composed Blocks

**User Story:** As a page builder user, I want pre-composed template blocks that expand into editable atomic components, so that I can quickly scaffold common layouts and then customize every piece.

#### Acceptance Criteria

1. THE Template_Component system SHALL define a "Content Block" template that expands into Section > Container > Columns(2) > [Image, [Quote + Text + Button]].
2. THE Template_Component system SHALL define a "Hero Section" template that expands into Section(full background) > Container > [Heading + Text + Button].
3. THE Template_Component system SHALL define a "Feature Section" template that expands into Section > Container > [Heading + FeatureGrid].
4. THE Template_Component system SHALL define a "CTA Section" template that expands into Section(dark background) > Container > [Heading + Text + Button].
5. THE Template_Component system SHALL define a "Testimonial Section" template that expands into Section > Container > [Heading + Columns > [Quote, Quote, Quote]].
6. WHEN a Template_Component is dropped onto the canvas, THE Page_Builder SHALL expand the template into its constituent atomic and layout components.
7. WHEN a Template_Component has been expanded, each constituent component SHALL be independently editable, movable, and deletable.
8. THE Template_Component definitions SHALL appear in a separate "Templates" category in the Page_Builder sidebar.

### Requirement 7: Sidebar Category Organization

**User Story:** As a page builder user, I want components organized into clear sidebar categories, so that I can quickly find layout containers, atomic elements, ORA-specific components, and templates.

#### Acceptance Criteria

1. THE Page_Builder sidebar SHALL display a "Layout" category containing Section, Container, Columns, Accordion, Spacer, and Divider.
2. THE Page_Builder sidebar SHALL display a "Basic" category containing Heading, Text, Button, Link, Image, Quote, and Icon.
3. THE Page_Builder sidebar SHALL display an "ORA" category containing HeroBanner, PropertyCard, FilterTabs, StatRow, FeatureGrid, Footer, and MegaFooter.
4. THE Page_Builder sidebar SHALL display a "Templates" category containing all Template_Component definitions.
5. THE "Layout" category SHALL be expanded by default when the sidebar loads.

### Requirement 8: Button Component Full Styling

**User Story:** As a page builder user, I want the Button component to support all ORA design system variants and full color customization, so that I can create any button style without needing a new component.

#### Acceptance Criteria

1. THE Button Atomic_Component SHALL provide a `variant` field with options: default, gold, secondary, outline, and ghost.
2. THE Button Atomic_Component SHALL provide a `size` field with options: small, medium, and large.
3. THE Button Atomic_Component SHALL provide fields for link URL, button text, full-width toggle, and alignment (left, center, right).
4. THE Button Atomic_Component SHALL include spacing, border, and animation fields from the Style_System.
5. WHEN the `variant` field is set to `gold`, THE Button SHALL render with the ORA gold background color (#B8956B) and white text.
6. WHEN the `fullWidth` field is enabled, THE Button SHALL render spanning the full width of its parent container.

### Requirement 9: Image Component with Media Library Integration

**User Story:** As a page builder user, I want the Image component to support CMS media library uploads and full image controls, so that I can manage images through the existing media system.

#### Acceptance Criteria

1. THE Image Atomic_Component SHALL provide an image upload field that integrates with the CMS media library API (`/api/media`).
2. THE Image Atomic_Component SHALL provide an alt text field for accessibility.
3. THE Image Atomic_Component SHALL provide image sizing fields (width, max-width, height, aspect ratio).
4. THE Image Atomic_Component SHALL provide image fit and position fields (object-fit, x-position, y-position).
5. THE Image Atomic_Component SHALL provide alignment field (left, center, right).
6. THE Image Atomic_Component SHALL include spacing, border, and animation fields from the Style_System.

### Requirement 10: Heading Component with Full Typography Control

**User Story:** As a page builder user, I want the Heading component to support h1 through h6 levels with full typography control, so that I can create any heading style.

#### Acceptance Criteria

1. THE Heading Atomic_Component SHALL provide a `level` field with options: h1, h2, h3, h4, h5, and h6.
2. THE Heading Atomic_Component SHALL render the appropriate HTML heading element (h1–h6) based on the selected level.
3. THE Heading Atomic_Component SHALL include all typography fields: font family, font size, font weight, color, alignment, letter spacing, line height, font style, text decoration, and text transform.
4. THE Heading Atomic_Component SHALL include spacing, border, and animation fields from the Style_System.

### Requirement 11: Existing Page Template Migration

**User Story:** As a page builder user, I want existing page templates (e.g. Bayn Landing) to be updated to use the new atomic component architecture, so that templates remain functional after the refactor.

#### Acceptance Criteria

1. WHEN the `bayn-landing` template is loaded, THE template data SHALL use Section, Container, and atomic components instead of the removed Compound_Components.
2. WHEN the `property-showcase` template is loaded, THE template data SHALL reference only components that exist in the updated Component_Registry.
3. WHEN the `specs-page` template is loaded, THE template data SHALL reference only components that exist in the updated Component_Registry.
4. FOR ALL built-in page templates, each template SHALL pass validation against the page data schema after migration.

### Requirement 12: Component Configuration Serialization Round-Trip

**User Story:** As a developer, I want component configurations to survive serialization and deserialization without data loss, so that page data stored in the database remains intact.

#### Acceptance Criteria

1. FOR ALL Atomic_Components, serializing a component's props to JSON and deserializing back SHALL produce an equivalent props object (round-trip property).
2. FOR ALL Layout_Components, serializing a component's props to JSON and deserializing back SHALL produce an equivalent props object (round-trip property).
3. FOR ALL Template_Component definitions, serializing the expanded template data to JSON and deserializing back SHALL produce an equivalent page data structure (round-trip property).
4. WHEN a page containing nested Layout_Components with Atomic_Components in DropZones is serialized, THE serialized JSON SHALL preserve the complete component tree including all zone assignments.
