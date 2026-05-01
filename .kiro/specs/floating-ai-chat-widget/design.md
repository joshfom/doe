# Design Document: Floating AI Chat Widget Enhancement

## Overview

This design enhances the existing `ChatWidget` component (`lib/cms/components/ChatWidget.tsx`) to support drag-to-resize, a larger default size, a minimize-to-bubble state, and improved handling of long conversations and rich content. The scope is entirely frontend — the backend chat API (`POST /api/ai/chat`) and all server-side logic remain unchanged.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Resize implementation | Custom pointer event handlers (no library) | Avoids adding a dependency for a focused interaction; pointer events work across mouse and touch; the project already uses no drag library for this purpose |
| Size persistence | `localStorage` with JSON key `ora-chat-widget-size` | Survives page reloads and browser restarts; `sessionStorage` is already used for conversation ID so we keep concerns separated |
| Rich text rendering | Simple regex-based markdown-to-HTML (bold, lists, paragraphs) | Avoids adding a markdown library dependency; assistant responses use basic formatting only; sanitization via text-only parsing (no `dangerouslySetInnerHTML` with raw HTML) |
| Multi-line input | Auto-growing `<textarea>` with max 4 visible lines | Native element, accessible, works with existing keyboard handling |
| Mobile full-screen | CSS media query + React state via `matchMedia` | No resize handles needed on mobile; clean full-screen takeover; responsive to orientation changes |
| Scroll management | `IntersectionObserver` on sentinel element at bottom of message list | Efficient detection of whether user has scrolled away from bottom; no scroll event throttling needed |
| Property testing | `fast-check` (already in devDependencies) | Consistent with existing project test infrastructure |

## Architecture

### Component Structure

```
ChatWidget (root — manages state, resize logic, size persistence)
├── ChatBubble (floating toggle button with unread badge)
└── ChatPanel (the expanded chat window)
    ├── ChatPanelHeader (title, minimize button, close button)
    ├── ResizeHandle (×3: top edge, leading side edge, top-leading corner)
    ├── MessageArea (scrollable message list)
    │   ├── MessageBubble (individual message with rich text support)
    │   ├── TypingIndicator (existing loading state)
    │   └── ScrollToBottomButton (appears when scrolled up)
    └── ChatInput (auto-growing textarea + send button)
```

All sub-components will be defined within the same `ChatWidget.tsx` file to keep the enhancement self-contained, matching the existing single-file pattern. If the file grows beyond ~500 lines, the resize hook logic will be extracted to a `useResizable.ts` hook in the same directory.

### State Management

```typescript
// Existing state (unchanged)
isOpen: boolean              // Whether the chat panel is visible
messages: Message[]          // Conversation history
inputValue: string           // Current input text
isLoading: boolean           // Whether waiting for AI response
unreadCount: number          // Unread messages while minimized
conversationId: string|null  // Session conversation ID
hasInitialized: boolean      // SessionStorage restore complete

// New state
panelSize: { width: number; height: number }  // Current panel dimensions
isResizing: boolean          // Whether a resize drag is in progress
resizeDirection: 'top' | 'left' | 'right' | 'corner' | null  // Active resize edge
isAtBottom: boolean          // Whether message area is scrolled to bottom
isMobile: boolean            // Whether viewport ≤ 640px
```

### Resize Logic

The resize system uses pointer events (`pointerdown`, `pointermove`, `pointerup`) attached to the document during active drags. This approach:

1. **Captures pointer** on `pointerdown` on a `ResizeHandle` element
2. **Tracks delta** between current pointer position and the starting position
3. **Computes new size** by applying the delta to the starting dimensions
4. **Clamps** the result to `[MIN_WIDTH, maxWidth]` × `[MIN_HEIGHT, maxHeight]` where max is `0.9 * viewport`
5. **Updates state** on each `pointermove` for real-time feedback
6. **Persists** to `localStorage` on `pointerup`

For RTL locales, the side resize handle is on the right edge instead of the left, and the corner handle is top-right instead of top-left. The delta calculation inverts the horizontal axis for RTL.

```
┌─────────────────────────────┐
│  ↕ top resize handle        │  ← 4px tall, full width, transparent
├─────────────────────────────┤
│ ↔│  ORA AI Assistant  [−][×]│  ← leading side handle is 4px wide
│  │                          │
│  │  Message Area             │
│  │                          │
│  │  [Type your message...]  │
└─────────────────────────────┘
  ↗ corner handle (top-left in LTR, top-right in RTL)
```

### Size Constants

```typescript
const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 600;
const MAX_VIEWPORT_RATIO = 0.9;
const MOBILE_BREAKPOINT = 640;
const STORAGE_KEY = 'ora-chat-widget-size';
```

### Size Persistence

```typescript
// Save to localStorage
function persistSize(size: { width: number; height: number }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch { /* silently ignore */ }
}

// Load from localStorage
function loadPersistedSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
```

### Clamping Function

```typescript
function clampSize(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  const maxW = Math.floor(viewportWidth * MAX_VIEWPORT_RATIO);
  const maxH = Math.floor(viewportHeight * MAX_VIEWPORT_RATIO);
  return {
    width: Math.max(MIN_WIDTH, Math.min(width, maxW)),
    height: Math.max(MIN_HEIGHT, Math.min(height, maxH)),
  };
}
```

### Scroll Management

The `MessageArea` uses an `IntersectionObserver` watching a sentinel `<div>` at the bottom of the message list:

- When the sentinel is **visible** → `isAtBottom = true` → auto-scroll on new messages
- When the sentinel is **not visible** → `isAtBottom = false` → show "scroll to bottom" button
- Clicking the button calls `sentinelRef.current.scrollIntoView({ behavior: 'smooth' })`

### Rich Text Rendering

Assistant messages are rendered through a simple formatter that converts:
- `**text**` → `<strong>text</strong>`
- `\n\n` → paragraph breaks
- `\n` → `<br />`
- Lines starting with `- ` or `* ` → unordered list items
- Lines starting with `1. `, `2. `, etc. → ordered list items

The formatter returns React elements (not raw HTML strings) to avoid XSS risks. No `dangerouslySetInnerHTML` is used.

### Multi-line Input

The input changes from `<input type="text">` to a `<textarea>` with:
- `rows={1}` initial
- Auto-resize via `scrollHeight` measurement on each `onChange`
- `max-height` capped at 4 lines (~6rem)
- `overflow-y: auto` when content exceeds max height
- Existing `Enter` to send, `Shift+Enter` for newline behavior preserved

### Mobile Full-Screen Mode

A `matchMedia('(max-width: 640px)')` listener sets `isMobile` state:
- When `isMobile && isOpen`: panel renders at 100vw × 100vh (with safe area insets via `env(safe-area-inset-*)`)
- Resize handles are not rendered
- Header shows close button only (no minimize — close returns to bubble)
- On viewport resize crossing the breakpoint, the component transitions between modes

### i18n Additions

```typescript
const i18n = {
  en: {
    // ... existing strings
    minimize: 'Minimize chat',
    scrollToBottom: 'Scroll to latest',
  },
  ar: {
    // ... existing strings
    minimize: 'تصغير المحادثة',
    scrollToBottom: 'انتقل إلى الأحدث',
  },
};
```

## Correctness Properties

### Property 1: Size clamping invariant (Requirements 1.2, 2.3, 2.4)

For any input dimensions (width, height) and any positive viewport dimensions, the `clampSize` function output must satisfy:
- `result.width >= MIN_WIDTH`
- `result.height >= MIN_HEIGHT`
- `result.width <= floor(viewportWidth * 0.9)`
- `result.height <= floor(viewportHeight * 0.9)`
- `result.width >= MIN_WIDTH` even when `viewportWidth * 0.9 < MIN_WIDTH` (minimum takes precedence)

**Test type:** Property-based test with `fast-check` generating arbitrary positive numbers for width, height, viewportWidth, viewportHeight.

### Property 2: Size persistence round-trip (Requirement 2.6, 2.7)

For any valid size object `{ width: w, height: h }` where w and h are positive integers:
- `persistSize(size)` followed by `loadPersistedSize()` returns an object equal to the original size
- `loadPersistedSize()` returns `null` when localStorage is empty
- `loadPersistedSize()` returns `null` when localStorage contains invalid JSON

**Test type:** Property-based test with `fast-check` generating arbitrary positive integer pairs.

### Property 3: Resize delta direction correctness (Requirement 2.2, 6.2)

For any resize operation with a given direction and RTL flag:
- Top edge drag: only height changes, width remains constant
- Side edge drag: only width changes, height remains constant
- Corner drag: both width and height can change
- In RTL mode, horizontal delta is inverted compared to LTR for the same pointer movement

**Test type:** Property-based test with `fast-check` generating resize direction, RTL boolean, and delta values.

### Property 4: Layout proportions invariant (Requirement 7.4)

For any valid panel size within the clamped range, the Chat_Panel layout must maintain:
- Header height is constant (independent of panel size)
- Input area height is constant (independent of panel size, up to textarea max)
- Message area height equals panel height minus header height minus input area height

**Test type:** Property-based test verifying the arithmetic relationship holds for generated panel heights.

## File Changes

### Modified Files

| File | Change |
|------|--------|
| `lib/cms/components/ChatWidget.tsx` | Major refactor: add resize handles, size state, persistence, mobile detection, scroll management, rich text rendering, multi-line input, minimize button, updated layout |
| `lib/cms/components/ChatWidget.test.tsx` | Extend with tests for resize behavior, size persistence, minimize/restore, scroll-to-bottom, rich text rendering, mobile full-screen, RTL resize handles |

### New Files

| File | Purpose |
|------|---------|
| `lib/cms/components/__tests__/chat-widget-properties.test.ts` | Property-based tests for `clampSize`, size persistence round-trip, resize delta logic |

No new dependencies are required. The implementation uses:
- `pointer events` (native browser API)
- `matchMedia` (native browser API)
- `IntersectionObserver` (native browser API)
- `localStorage` (native browser API)
- `fast-check` (already in devDependencies) for property tests
