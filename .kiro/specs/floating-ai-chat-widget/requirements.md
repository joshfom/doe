# Requirements Document

## Introduction

This document defines the requirements for enhancing the existing ORA AI floating chat widget (`ChatWidget` component at `lib/cms/components/ChatWidget.tsx`). The current widget renders as a fixed-size panel (380×520px) in the bottom-right corner of the public frontend. Users report the panel is too small for long conversations and rich AI responses. This feature adds drag-to-resize capability, a larger default size, a minimized bubble state, and improved content handling — while preserving the existing chat API integration, bilingual support (EN/AR), ORA branding, and session persistence. The scope is strictly frontend UI; the backend chat API (`/api/ai/chat`) remains unchanged.

## Glossary

- **Chat_Widget**: The `ChatWidget` React component rendered on all public frontend pages that provides the floating AI chat interface, currently located at `lib/cms/components/ChatWidget.tsx`
- **Chat_Panel**: The expanded chat window containing the header, message area, and input field, displayed when the Chat_Widget is in the open state
- **Chat_Bubble**: The minimized floating button (circular, 56px diameter) that serves as the toggle to open or close the Chat_Panel
- **Resize_Handle**: A draggable UI element on the edges or corners of the Chat_Panel that allows users to change the panel dimensions by clicking and dragging
- **Minimum_Size**: The smallest allowed dimensions for the Chat_Panel (320px wide × 400px tall), below which the Resize_Handle prevents further shrinking
- **Maximum_Size**: The largest allowed dimensions for the Chat_Panel, constrained to 90% of the viewport width and 90% of the viewport height
- **Default_Size**: The initial dimensions of the Chat_Panel when first opened (400px wide × 600px tall), replacing the current 380×520px
- **Persisted_Size**: The user's last-used Chat_Panel dimensions, stored in browser localStorage and restored on subsequent opens
- **Message_Area**: The scrollable region within the Chat_Panel that displays the conversation history (user and assistant messages)
- **Public_Frontend**: The public-facing Next.js pages served under `app/(en)/` and `app/ar/` routes where the Chat_Widget is rendered

## Requirements

### Requirement 1: Larger Default Chat Panel Size

**User Story:** As a site visitor, I want the chat panel to open at a larger default size, so that I can read AI responses and hold conversations comfortably without the content feeling cramped.

#### Acceptance Criteria

1. WHEN the Chat_Panel opens for the first time in a session (no Persisted_Size exists), THE Chat_Widget SHALL render the Chat_Panel at the Default_Size of 400px wide and 600px tall
2. WHEN the viewport is smaller than the Default_Size, THE Chat_Widget SHALL render the Chat_Panel at `min(400px, 100vw - 2rem)` wide and `min(600px, 100vh - 6rem)` tall to prevent overflow
3. THE Chat_Panel SHALL remain anchored to the bottom-right corner of the viewport for LTR locales and the bottom-left corner for RTL locales

### Requirement 2: Drag-to-Resize Chat Panel

**User Story:** As a site visitor, I want to drag the edges or corners of the chat panel to resize it, so that I can adjust the panel to a comfortable size for my screen and conversation.

#### Acceptance Criteria

1. THE Chat_Panel SHALL display Resize_Handles on the top edge, the leading side edge (left edge in LTR, right edge in RTL), and the top-leading corner of the Chat_Panel
2. WHEN a user clicks and drags a Resize_Handle, THE Chat_Widget SHALL update the Chat_Panel dimensions in real time following the pointer position
3. THE Chat_Widget SHALL enforce the Minimum_Size constraint of 320px wide and 400px tall during resize operations
4. THE Chat_Widget SHALL enforce the Maximum_Size constraint of 90% of viewport width and 90% of viewport height during resize operations
5. WHILE a resize operation is in progress, THE Chat_Widget SHALL apply a `cursor` style matching the resize direction (e.g., `ns-resize` for top edge, `ew-resize` for side edge, `nwse-resize` or `nesw-resize` for corner) to the document body
6. WHEN a resize operation completes (pointer released), THE Chat_Widget SHALL store the resulting dimensions as the Persisted_Size in browser localStorage
7. WHEN the Chat_Panel opens and a Persisted_Size exists in localStorage, THE Chat_Widget SHALL restore the Chat_Panel to the Persisted_Size, clamped to the current viewport constraints

### Requirement 3: Minimize to Chat Bubble

**User Story:** As a site visitor, I want to minimize the chat panel back to a small floating button, so that I can reclaim screen space while keeping the conversation accessible.

#### Acceptance Criteria

1. WHEN the Chat_Panel is open, THE Chat_Widget SHALL display a minimize control in the Chat_Panel header (distinct from the existing close button)
2. WHEN the user clicks the minimize control, THE Chat_Widget SHALL collapse the Chat_Panel to the Chat_Bubble state while preserving the conversation history and input state in memory
3. WHEN the user clicks the Chat_Bubble after minimizing, THE Chat_Widget SHALL restore the Chat_Panel to its previous dimensions (Persisted_Size or Default_Size) with the conversation history and input state intact
4. WHEN the Chat_Widget is in the Chat_Bubble state and a new assistant message arrives, THE Chat_Widget SHALL display an unread message count badge on the Chat_Bubble
5. THE Chat_Bubble SHALL remain the existing 56px diameter circular button with the ORA gold background and message icon

### Requirement 4: Long Conversation and Rich Content Handling

**User Story:** As a site visitor, I want the chat panel to handle long conversations and rich responses well, so that I can have extended interactions with ORA AI without the interface becoming unusable.

#### Acceptance Criteria

1. THE Message_Area SHALL auto-scroll to the latest message when a new message is added, provided the user has not manually scrolled up to review earlier messages
2. WHILE the user has scrolled up in the Message_Area, THE Chat_Widget SHALL display a "scroll to bottom" indicator that, when clicked, scrolls the Message_Area to the latest message
3. THE Message_Area SHALL render assistant messages with basic rich text formatting: paragraphs, line breaks, bold text, and numbered or bulleted lists
4. THE Chat_Panel input field SHALL expand to a multi-line textarea that grows up to 4 lines of text and then scrolls, allowing users to compose longer messages
5. WHEN the Message_Area contains more than 50 messages, THE Chat_Widget SHALL continue to render and scroll without perceptible lag or layout jank

### Requirement 5: Mobile Responsiveness

**User Story:** As a mobile user, I want the chat widget to work well on my phone, so that I can interact with ORA AI on small screens.

#### Acceptance Criteria

1. WHEN the viewport width is 640px or less, THE Chat_Panel SHALL expand to full-screen mode (100vw wide, 100vh tall minus safe area insets) instead of the floating panel layout
2. WHILE in full-screen mode, THE Chat_Panel SHALL display a close button in the header that returns to the Chat_Bubble state
3. WHILE in full-screen mode, THE Resize_Handles SHALL be hidden since the panel occupies the full viewport
4. WHEN the viewport is resized from below 640px to above 640px (e.g., device rotation), THE Chat_Widget SHALL transition from full-screen mode to the floating panel layout at the Persisted_Size or Default_Size

### Requirement 6: RTL and Bilingual Support

**User Story:** As an Arabic-speaking user, I want the resizable chat widget to work correctly in RTL layout, so that the resize handles, anchoring, and text direction feel natural.

#### Acceptance Criteria

1. WHILE the locale is set to Arabic (`ar`), THE Chat_Widget SHALL anchor the Chat_Panel to the bottom-left corner of the viewport
2. WHILE the locale is set to Arabic, THE Resize_Handles SHALL appear on the top edge, the right edge (leading side in RTL), and the top-right corner
3. WHILE the locale is set to Arabic, THE Chat_Panel SHALL apply `dir="rtl"` to all content including the header, Message_Area, and input field
4. THE Chat_Widget SHALL use the existing i18n strings for all UI labels (title, placeholder, close, send, open) and add new i18n strings for the minimize control label and the scroll-to-bottom indicator label

### Requirement 7: Visual Consistency with ORA Brand

**User Story:** As a site visitor, I want the enhanced chat widget to match the ORA website design, so that the experience feels cohesive and professional.

#### Acceptance Criteria

1. THE Chat_Panel SHALL use the existing ORA design tokens: `ora-charcoal` header background, `ora-white` panel background, `ora-gold` accent for user message bubbles and send button, `ora-cream` for assistant message bubbles, and `ora-sand` for borders
2. THE Resize_Handles SHALL be visually subtle (e.g., a thin 4px transparent hit area with no visible border) so they do not disrupt the clean panel aesthetic, but SHALL change the cursor on hover to indicate resizability
3. THE Chat_Panel SHALL use the existing `shadow-ora-lg` box shadow and `border-ora-sand` border styling
4. WHEN the Chat_Panel is resized, THE Chat_Widget SHALL maintain the existing layout proportions: fixed-height header, flexible Message_Area, and fixed-height input area
