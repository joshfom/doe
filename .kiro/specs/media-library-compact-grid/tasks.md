# Implementation Plan: Media Library Compact Grid

## Overview

Refactor `app/ora-panel/media/page.tsx` from a 3-column `aspect-video` card layout to a compact 6-column responsive grid with square thumbnails, hover overlays for actions, and a new copy-to-clipboard button. All existing functionality (upload, search, MIME filter, alt text editing, delete) is preserved. This is a single-file UI refactor with no API or data model changes.

## Tasks

- [x] 1. Refactor grid layout and thumbnails to compact square format
  - [x] 1.1 Update the grid container classes from `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` to `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2` for the responsive 6-column layout
    - Update both the main items grid and the skeleton loader grid to use the same column classes
    - Change skeleton placeholders from `aspect-square` (already square) to ensure they use the compact layout with `aspect-square` and the new grid classes
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.6_

  - [x] 1.2 Replace `aspect-video` thumbnails with `aspect-square` compact thumbnails
    - Change each item's thumbnail container from `aspect-video` to `aspect-square`
    - Ensure `object-cover` is on the `<img>` to fill the square without distortion
    - Set `bg-ora-cream-light` as the fallback background on the thumbnail container
    - Add `overflow-hidden` to the thumbnail container
    - Use `item.altText ?? item.filename` for the `alt` attribute
    - Add `border border-ora-sand/60` to the thumbnail container
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1_

- [x] 2. Implement hover overlay with action buttons
  - [x] 2.1 Add the hover overlay structure to each grid item
    - Wrap each grid item in a `group relative` container
    - Add an absolutely positioned overlay div with `bg-ora-charcoal/70 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150`
    - Layout the overlay with `flex flex-col justify-between p-2`
    - Display the truncated filename at the bottom of the overlay in `text-xs text-ora-white`
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 6.2, 6.3_

  - [x] 2.2 Move delete and alt-text-edit buttons into the overlay as icon-only buttons
    - Add a top-right row of icon-only action buttons (`flex justify-end gap-1`)
    - Render the delete button as an icon-only `<button>` with `Trash2` icon, `aria-label="Delete {filename}"`, styled in `ora-white` with hover highlight
    - Render the edit-alt button as an icon-only `<button>` with `Pencil` icon (from Lucide), `aria-label="Edit alt text for {filename}"`
    - Keep the delete confirmation and alt-text inline editing UI below the thumbnail (outside the overlay) so they remain accessible
    - Remove the old per-item info panel (`<div className="p-4">...</div>`) since actions and filename are now in the overlay
    - _Requirements: 3.3, 3.6, 5.4, 5.5_

- [x] 3. Implement copy-to-clipboard functionality
  - [x] 3.1 Add `copiedId` and `copyErrorId` state and the `handleCopyLink` handler
    - Add `const [copiedId, setCopiedId] = useState<string | null>(null)`
    - Add `const [copyErrorId, setCopyErrorId] = useState<string | null>(null)`
    - Implement `handleCopyLink` using `navigator.clipboard.writeText(item.storageUrl)` with try/catch
    - On success: set `copiedId` to the item ID, clear after 2 seconds with `setTimeout`
    - On failure: set `copyErrorId` to the item ID, clear after 2 seconds
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 3.2 Add the Copy Link button to the overlay action row
    - Import `Link`, `Check`, and `X` icons from `lucide-react`
    - Render a `<button>` with `title="Copy public link"` and `aria-label="Copy public link for {filename}"`
    - Default state: show `Link` icon in `ora-white`
    - Success state (when `copiedId === item.id`): show `Check` icon in `ora-gold`
    - Error state (when `copyErrorId === item.id`): show `X` icon in `ora-error`
    - Wire `onClick` to `handleCopyLink(item)`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 6.4_

- [x] 4. Checkpoint — Verify layout and interactions
  - Ensure all tests pass, ask the user if questions arise.
  - Visually confirm: 6-column grid at ≥1024px, 4 columns at md, 3 at sm, 2 at base
  - Confirm hover overlay appears/disappears, copy link works, delete and alt-text editing still function

- [x] 5. Verify preserved functionality and polish
  - [x] 5.1 Ensure upload, search, and MIME filter are unchanged
    - Verify the Upload button, hidden file input, search input, and MIME type dropdown remain in the header/filter bar with no changes to their behavior or styling
    - Confirm `useMedia`, `useUploadMedia`, `useDeleteMedia`, `useUpdateMediaAlt` hooks are still used identically
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.2 Update skeleton loader and empty state for compact layout
    - Ensure the loading skeleton grid uses `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2` with `aspect-square` placeholders
    - Ensure the empty state message is preserved with its current styling
    - _Requirements: 5.6, 5.7, 6.5_

  - [x] 5.3 Write unit tests for the compact grid refactor
    - Test that the grid container has the correct responsive Tailwind classes
    - Test that thumbnails use `aspect-square` and `object-cover`
    - Test alt text fallback: when `altText` is null, `img` alt uses `filename`
    - Test `handleCopyLink` calls `navigator.clipboard.writeText` with the correct `storageUrl`
    - Test copy success feedback: checkmark icon appears, reverts after 2 seconds
    - Test copy failure feedback: error icon appears when clipboard rejects
    - Test overlay has `opacity-0` default and `group-hover:opacity-100` class
    - Test overlay buttons have appropriate `aria-label` attributes
    - Test skeleton loader renders with `aspect-square` in the compact grid
    - Test delete confirmation and alt text editing flows still work
    - _Requirements: 1.1–1.6, 2.1–2.4, 3.1–3.6, 4.1–4.5, 5.1–5.7_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- This is a single-file refactor of `app/ora-panel/media/page.tsx` — no new files, API endpoints, or hooks are created
- The `Pencil` icon needs to be added to the Lucide imports alongside the existing `Upload`, `Trash2`, `Search` icons, plus new `Link`, `Check`, `X` icons
- Alt text editing and delete confirmation render below the thumbnail (outside the overlay) to keep those interactions accessible and usable
- Property-based testing is not applicable for this UI layout refactor
