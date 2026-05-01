# Requirements Document

## Introduction

This document defines the requirements for enhancing the ORA CMS Media Library page (`app/ora-panel/media/page.tsx`). The current page displays media items in a 3-column grid with large `aspect-video` thumbnails and detailed info cards, which limits how many items are visible at once. This feature redesigns the grid to a compact 6-column layout with smaller square thumbnails and adds a "Copy public link" action to each media item so that CMS users can quickly copy the `storageUrl` to their clipboard for embedding or sharing. All existing functionality (upload, search, MIME filter, alt text editing, delete) is preserved. The scope is strictly the media library page UI; the media API and data model remain unchanged.

## Glossary

- **Media_Library_Page**: The ORA CMS panel page at `app/ora-panel/media/page.tsx` that displays uploaded media items in a grid layout with search, filter, upload, and management controls
- **Media_Item**: A single uploaded file record containing id, filename, altText, mimeType, fileSize, width, height, storageUrl, storageBackend, and createdAt fields, as defined in `lib/cms/hooks/use-media.ts`
- **Media_Grid**: The CSS grid container that arranges Media_Item thumbnails in columns on the Media_Library_Page
- **Compact_Thumbnail**: A square (1:1 aspect ratio) thumbnail rendering of a Media_Item image, replacing the current `aspect-video` (16:9) thumbnail
- **Storage_URL**: The `storageUrl` field of a Media_Item, representing the publicly accessible URL of the uploaded file
- **Copy_Link_Button**: A UI button displayed on each Media_Item in the Media_Grid that copies the Storage_URL to the user's clipboard
- **Copy_Feedback**: A temporary visual indicator shown after a successful clipboard copy operation, confirming to the user that the Storage_URL has been copied
- **Item_Overlay**: A hover-activated overlay on each Compact_Thumbnail that reveals action buttons (Copy_Link_Button, delete, alt text edit) without permanently consuming layout space
- **Skeleton_Loader**: A placeholder animation displayed in the Media_Grid while media data is being fetched from the API

## Requirements

### Requirement 1: Compact 6-Column Grid Layout

**User Story:** As a CMS user, I want media items displayed as smaller thumbnails in a 6-column grid, so that I can see more items at once and browse the library faster.

#### Acceptance Criteria

1. THE Media_Grid SHALL render Media_Items in 6 columns on viewports 1024px wide and above
2. THE Media_Grid SHALL render Media_Items in 4 columns on viewports between 768px and 1023px wide
3. THE Media_Grid SHALL render Media_Items in 3 columns on viewports between 640px and 767px wide
4. THE Media_Grid SHALL render Media_Items in 2 columns on viewports below 640px wide
5. THE Media_Grid SHALL use a gap of 8px (0.5rem) between items to maximize the number of visible thumbnails
6. WHEN the Media_Library_Page loads with media data, THE Media_Grid SHALL display all returned Media_Items using the column layout appropriate for the current viewport width

### Requirement 2: Square Compact Thumbnails

**User Story:** As a CMS user, I want each media item shown as a small square thumbnail, so that the grid is visually uniform and space-efficient.

#### Acceptance Criteria

1. THE Compact_Thumbnail SHALL render each Media_Item image at a 1:1 (square) aspect ratio using CSS `aspect-square` and `object-cover` to fill the square without distortion
2. THE Compact_Thumbnail SHALL display the image using the Media_Item Storage_URL as the `src` attribute
3. THE Compact_Thumbnail SHALL use the Media_Item `altText` field as the `alt` attribute, falling back to the `filename` field when `altText` is null
4. THE Compact_Thumbnail SHALL have a light background color (`ora-cream-light`) visible while the image is loading or if the image fails to load

### Requirement 3: Hover Overlay with Actions

**User Story:** As a CMS user, I want to see action buttons when I hover over a media thumbnail, so that I can quickly perform actions without the interface feeling cluttered.

#### Acceptance Criteria

1. WHEN the user hovers over a Compact_Thumbnail, THE Item_Overlay SHALL appear with a semi-transparent dark background over the thumbnail
2. THE Item_Overlay SHALL display the Media_Item filename as truncated text at the bottom of the overlay
3. THE Item_Overlay SHALL display the Copy_Link_Button and a delete button as icon-only action buttons within the overlay
4. WHEN the user moves the pointer away from the Compact_Thumbnail, THE Item_Overlay SHALL hide
5. THE Item_Overlay SHALL transition in and out with a fade animation lasting no more than 150 milliseconds
6. WHILE the Item_Overlay is visible, THE action buttons SHALL be keyboard-focusable and operable via Enter or Space key press

### Requirement 4: Copy Public Link to Clipboard

**User Story:** As a CMS user, I want a "Copy public link" button on each media item, so that I can quickly copy the embed URL for use in content or external sharing.

#### Acceptance Criteria

1. WHEN the user clicks the Copy_Link_Button, THE Media_Library_Page SHALL copy the Media_Item Storage_URL to the user's system clipboard using the Clipboard API
2. WHEN the clipboard copy operation succeeds, THE Copy_Link_Button SHALL display Copy_Feedback by changing its icon to a checkmark for 2 seconds, then reverting to the default copy icon
3. IF the clipboard copy operation fails (e.g., browser permission denied), THEN THE Media_Library_Page SHALL display a brief error message near the Copy_Link_Button indicating the copy failed
4. THE Copy_Link_Button SHALL display a tooltip with the text "Copy public link" when hovered
5. THE Copy_Link_Button SHALL use a link/copy icon from the existing Lucide icon set used in the project

### Requirement 5: Preserved Existing Functionality

**User Story:** As a CMS user, I want all existing media library features to continue working in the new compact layout, so that I do not lose any current capabilities.

#### Acceptance Criteria

1. THE Media_Library_Page SHALL continue to support uploading new media files via the existing Upload button and file input
2. THE Media_Library_Page SHALL continue to support searching media items by filename or alt text via the existing search input
3. THE Media_Library_Page SHALL continue to support filtering media items by MIME type via the existing type dropdown
4. THE Media_Library_Page SHALL continue to support editing alt text for each Media_Item, accessible from the Item_Overlay or an item detail interaction
5. THE Media_Library_Page SHALL continue to support deleting a Media_Item with a confirmation step before the delete is executed
6. WHEN media data is loading, THE Media_Grid SHALL display Skeleton_Loader placeholders in the compact square format matching the 6-column layout
7. WHEN no media items match the current search and filter criteria, THE Media_Library_Page SHALL display an empty state message

### Requirement 6: Visual Consistency with ORA Design System

**User Story:** As a CMS user, I want the compact media grid to match the ORA panel design language, so that the page feels cohesive with the rest of the admin interface.

#### Acceptance Criteria

1. THE Compact_Thumbnail border SHALL use the existing `ora-sand/60` border color consistent with other ORA panel components
2. THE Item_Overlay background SHALL use a semi-transparent `ora-charcoal` color (e.g., `bg-ora-charcoal/70`) to maintain readability of overlay text and icons
3. THE Item_Overlay text and icons SHALL use `ora-white` color for contrast against the dark overlay background
4. THE Copy_Feedback checkmark icon SHALL use `ora-success` or `ora-gold` color to indicate a successful operation
5. THE Media_Grid SHALL use `ora-white` as the page background, consistent with the existing Media_Library_Page styling
