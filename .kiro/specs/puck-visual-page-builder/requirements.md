# Requirements Document

## Introduction

This document defines the requirements for a custom visual page builder CMS built on top of Puck (@puckeditor/core). The system provides a drag-and-drop page editing experience with a custom Tailwind CSS component library, AI-powered page generation, page management with publishing workflows, template system, and a data persistence layer that outputs JSON for database storage. The builder is designed to be reusable and embeddable across Next.js and standalone React applications, similar in spirit to ChaiBuilder or Prismic's visual builder but fully owned and customizable.

## Glossary

- **Builder**: The complete visual page builder application, encompassing the Editor, Renderer, Component_Library, and Page_Manager
- **Editor**: The Puck-based drag-and-drop visual editing interface where users compose pages from components
- **Renderer**: The server-side and client-side rendering engine that uses Puck's `<Render>` component to display pages from stored Page_Data
- **Component_Library**: The collection of reusable, Tailwind-styled UI components registered in the Puck configuration (e.g., Hero, CTA, Features, Testimonials, Pricing, Footer)
- **Page_Data**: The JSON payload output by Puck that fully describes a page's component tree, props, and layout — the canonical format stored in the database
- **Page_Manager**: The subsystem responsible for CRUD operations on pages, including draft/published state management and routing
- **Template_System**: The subsystem that provides pre-built page layouts (as Page_Data JSON) that users can select as starting points for new pages
- **AI_Generator**: The subsystem that accepts natural language prompts and produces valid Page_Data JSON constrained to the Component_Library, using either Puck AI's `generate()` API or a custom LLM pipeline
- **Data_Store**: The abstract persistence interface that saves and retrieves Page_Data JSON to/from a database or API backend
- **DropZone**: A Puck layout primitive that allows components to contain nested child components, enabling flexible page structures
- **Field_Config**: The Puck field definition that specifies the editable props for each component in the Editor sidebar
- **Plugin_Rail**: Puck's plugin UI extension point that allows adding custom sidebar panels to the Editor
- **Permissions_API**: Puck's built-in access control system for restricting editing capabilities per component or action

## Requirements

### Requirement 1: Component Library Registration

**User Story:** As a developer, I want a centralized Puck configuration that registers all custom components with their field definitions, so that the Editor knows which components are available and how to edit them.

#### Acceptance Criteria

1. THE Builder SHALL define a Puck configuration object that registers each component in the Component_Library with a unique key, a React render function, and a Field_Config specifying all editable props
2. WHEN a new component is added to the Component_Library, THE Builder SHALL make the component available in the Editor's component picker without requiring changes to the Editor code
3. THE Component_Library SHALL include at minimum the following component types: Hero, Call_to_Action, Features_Grid, Testimonials, Pricing_Table, Footer, Text_Block, Image_Block, and Columns_Layout
4. WHEN a component defines a DropZone in its render function, THE Editor SHALL allow users to drag and drop child components into that DropZone

### Requirement 2: Tailwind CSS Component Styling

**User Story:** As a developer, I want all components in the Component_Library to be styled with Tailwind CSS 4, so that they are consistent with the host application's design system and easy to customize.

#### Acceptance Criteria

1. THE Component_Library SHALL style all components exclusively using Tailwind CSS 4 utility classes
2. WHEN a component is rendered in the Editor or by the Renderer, THE component SHALL apply Tailwind CSS classes correctly in both contexts
3. THE Component_Library SHALL support responsive design by using Tailwind's responsive breakpoint prefixes (sm, md, lg, xl) in component markup
4. WHEN a component exposes a style-related prop (e.g., background color, text alignment), THE Field_Config SHALL provide a constrained set of Tailwind-compatible values for that prop

### Requirement 3: Visual Drag-and-Drop Editor

**User Story:** As a content editor, I want a visual drag-and-drop interface to compose pages from available components, so that I can build pages without writing code.

#### Acceptance Criteria

1. THE Editor SHALL render the Puck `<Editor>` component with the Component_Library configuration and current Page_Data
2. WHEN a user drags a component from the component picker and drops it onto the canvas, THE Editor SHALL insert the component at the drop position in the page structure
3. WHEN a user selects a component on the canvas, THE Editor SHALL display the component's editable fields in a sidebar panel
4. WHEN a user modifies a field value in the sidebar, THE Editor SHALL update the canvas preview in real time
5. WHEN a user reorders components via drag-and-drop on the canvas, THE Editor SHALL update the Page_Data to reflect the new component order
6. WHEN a user clicks a delete action on a selected component, THE Editor SHALL remove the component from the page structure and update the canvas

### Requirement 4: Custom Editor UI Theme

**User Story:** As a product owner, I want the editor interface to be reskinned with custom branding and layout overrides, so that the builder feels like a proprietary product rather than a generic tool.

#### Acceptance Criteria

1. THE Editor SHALL use Puck's UI override system to replace default header, sidebar, and toolbar components with custom-branded equivalents
2. THE Editor SHALL apply a custom color scheme, typography, and iconography that is configurable via a theme configuration object
3. WHEN the Editor loads, THE Editor SHALL display the custom-branded interface with no visible Puck default branding
4. THE Editor SHALL use Puck's Plugin_Rail to add custom sidebar panels for page settings, SEO metadata, and publishing controls

### Requirement 5: Page Data Serialization and Persistence

**User Story:** As a developer, I want the editor to output a JSON payload representing the full page structure, so that I can store it in any database and reload it for editing or rendering.

#### Acceptance Criteria

1. WHEN a user saves a page in the Editor, THE Editor SHALL produce a complete Page_Data JSON object containing the full component tree, all component props, and layout metadata
2. THE Data_Store SHALL expose an asynchronous save function that accepts a page identifier and Page_Data JSON and persists the data to the configured backend
3. THE Data_Store SHALL expose an asynchronous load function that accepts a page identifier and returns the stored Page_Data JSON
4. WHEN Page_Data is saved and then loaded, THE Data_Store SHALL return Page_Data that is equivalent to the originally saved data (round-trip integrity)
5. IF the Data_Store fails to save or load data, THEN THE Builder SHALL display an error message to the user and preserve the current Editor state without data loss
6. THE Data_Store SHALL define an abstract interface (TypeScript interface) so that different storage backends (REST API, direct database, local storage) can be swapped without changing Editor or Renderer code

### Requirement 6: Page Management and Publishing Workflow

**User Story:** As a content editor, I want to create, edit, list, and delete pages with draft and published states, so that I can manage content lifecycle before it goes live.

#### Acceptance Criteria

1. THE Page_Manager SHALL support creating a new page with a title, URL slug, and initial Page_Data (empty or from a template)
2. THE Page_Manager SHALL support listing all pages with their title, slug, status (draft or published), and last-modified timestamp
3. THE Page_Manager SHALL support updating an existing page's title, slug, and Page_Data
4. THE Page_Manager SHALL support deleting a page by its identifier
5. WHEN a user publishes a page, THE Page_Manager SHALL change the page status from draft to published and record a published timestamp
6. WHEN a user unpublishes a page, THE Page_Manager SHALL change the page status from published to draft
7. THE Page_Manager SHALL prevent two pages from having the same URL slug
8. WHEN a published page's slug is requested via a route, THE Renderer SHALL load the corresponding Page_Data and render the page using Puck's `<Render>` component

### Requirement 7: Server-Side Rendering of Pages

**User Story:** As a developer, I want published pages to be rendered server-side using Puck's `<Render>` component, so that pages are SEO-friendly and load quickly.

#### Acceptance Criteria

1. THE Renderer SHALL use Puck's `<Render>` component with the Component_Library configuration and stored Page_Data to produce the page HTML
2. WHEN a published page is requested, THE Renderer SHALL render the page on the server (SSR) and deliver the complete HTML to the client
3. WHEN Page_Data references a component key that exists in the Component_Library configuration, THE Renderer SHALL render that component with the stored props
4. IF Page_Data references a component key that does not exist in the Component_Library configuration, THEN THE Renderer SHALL skip the unknown component and render the remaining page content without error

### Requirement 8: Template System

**User Story:** As a content editor, I want to start new pages from pre-built templates, so that I can quickly create common page types without building from scratch.

#### Acceptance Criteria

1. THE Template_System SHALL provide a collection of pre-built page templates, each defined as a valid Page_Data JSON object using components from the Component_Library
2. THE Template_System SHALL include at minimum the following templates: Landing_Page, About_Page, Pricing_Page, and Contact_Page
3. WHEN a user creates a new page and selects a template, THE Page_Manager SHALL initialize the page's Page_Data with a copy of the selected template's Page_Data
4. WHEN a user edits a page created from a template, THE Editor SHALL treat the page as independent — changes to the page SHALL NOT affect the original template
5. THE Template_System SHALL allow developers to add new templates by providing a template name, description, thumbnail identifier, and valid Page_Data JSON

### Requirement 9: AI-Powered Page Generation

**User Story:** As a content editor, I want to describe a page in natural language and have AI generate a complete page layout using the available components, so that I can rapidly create pages without manual assembly.

#### Acceptance Criteria

1. THE AI_Generator SHALL accept a natural language prompt describing the desired page content and structure
2. WHEN the AI_Generator receives a prompt, THE AI_Generator SHALL produce a valid Page_Data JSON object that uses only components defined in the Component_Library
3. WHEN the AI_Generator produces Page_Data, THE Editor SHALL load the generated Page_Data into the canvas for the user to review and edit
4. THE AI_Generator SHALL constrain generated content to the props and field types defined in each component's Field_Config
5. IF the AI_Generator fails to produce valid Page_Data, THEN THE Builder SHALL display an error message and preserve the current Editor state
6. THE AI_Generator SHALL support integration with Puck AI's `generate()` API as the default generation backend
7. THE AI_Generator SHALL define an abstract interface so that alternative LLM backends can be substituted without changing the Editor integration code

### Requirement 10: Reusable and Embeddable Architecture

**User Story:** As a developer, I want the page builder to be structured as a self-contained module that I can embed in any Next.js or React application, so that I can reuse the builder across multiple projects.

#### Acceptance Criteria

1. THE Builder SHALL organize all builder-specific code (Component_Library, Editor wrappers, Renderer, Data_Store interface, AI_Generator interface, Template_System) under a dedicated module directory with a single entry-point barrel export
2. THE Builder SHALL not depend on application-specific routing, database drivers, or environment configuration — all external dependencies SHALL be injected via configuration or interface implementations
3. WHEN a developer imports the Builder module into a Next.js application, THE Builder SHALL provide ready-to-use Editor and Renderer components that accept configuration props
4. WHEN a developer imports the Builder module into a standalone React application (without Next.js), THE Builder SHALL function correctly for client-side editing and rendering
5. THE Builder SHALL export TypeScript type definitions for all public interfaces including Page_Data schema, Data_Store interface, AI_Generator interface, component prop types, and configuration types

### Requirement 11: Page Data Schema Validation

**User Story:** As a developer, I want Page_Data JSON to be validated against a schema before saving or rendering, so that invalid data does not corrupt pages or cause rendering errors.

#### Acceptance Criteria

1. WHEN Page_Data is submitted for saving, THE Data_Store SHALL validate the Page_Data against the expected schema before persisting
2. WHEN Page_Data is loaded for rendering, THE Renderer SHALL validate the Page_Data against the expected schema before rendering
3. IF Page_Data fails schema validation, THEN THE Builder SHALL reject the operation and return a descriptive validation error
4. FOR ALL valid Page_Data objects, serializing to JSON and then parsing back SHALL produce an equivalent Page_Data object (round-trip property)

### Requirement 12: Component Field Configuration

**User Story:** As a developer, I want each component to declare its editable fields with types, defaults, and validation rules, so that the Editor provides appropriate input controls and prevents invalid prop values.

#### Acceptance Criteria

1. THE Component_Library SHALL define each component's Field_Config using Puck's field type system (text, textarea, number, select, radio, array, object, custom)
2. THE Field_Config SHALL specify a default value for each field
3. WHEN the Editor renders a field input, THE Editor SHALL use the field type to select the appropriate input control (e.g., text input for text fields, dropdown for select fields)
4. WHEN a user enters a value that does not match the field's type constraint, THE Editor SHALL display a validation message and prevent the invalid value from being applied to the component props
5. THE Field_Config SHALL support grouping related fields under labeled sections in the Editor sidebar

