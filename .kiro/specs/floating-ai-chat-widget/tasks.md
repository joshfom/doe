# Tasks

## Task 1: Core resize infrastructure and size constants

- [x] 1.1 Add size constants (`MIN_WIDTH`, `MIN_HEIGHT`, `DEFAULT_WIDTH`, `DEFAULT_HEIGHT`, `MAX_VIEWPORT_RATIO`, `MOBILE_BREAKPOINT`, `STORAGE_KEY`) to `ChatWidget.tsx`
- [x] 1.2 Implement `clampSize(width, height, viewportWidth, viewportHeight)` utility function that enforces minimum and maximum size constraints
- [x] 1.3 Implement `persistSize(size)` and `loadPersistedSize()` localStorage helper functions for size persistence
- [x] 1.4 Add new state variables: `panelSize`, `isResizing`, `resizeDirection`, `isAtBottom`, `isMobile`
- [x] 1.5 Add `useEffect` to initialize `panelSize` from `loadPersistedSize()` or `DEFAULT_SIZE`, clamped to current viewport
- [x] 1.6 Add `useEffect` with `matchMedia('(max-width: 640px)')` listener to track `isMobile` state
- [x] 1.7 Write property-based test: `clampSize` output always satisfies min/max constraints for arbitrary positive inputs
- [x] 1.8 Write property-based test: `persistSize` → `loadPersistedSize` round-trip returns equivalent size for arbitrary positive integer pairs

## Task 2: Resize handles and drag interaction

- [x] 2.1 Create `ResizeHandle` sub-component with props for `direction` (`top` | `side` | `corner`) and `isRtl` flag
- [x] 2.2 Render three `ResizeHandle` instances on the Chat_Panel: top edge (full width, 4px tall), leading side edge (4px wide, full height), and top-leading corner (12×12px)
- [x] 2.3 Implement `pointerdown` handler on `ResizeHandle` that captures pointer, records starting position and starting size, and sets `isResizing` + `resizeDirection`
- [x] 2.4 Implement `pointermove` handler (attached to document during drag) that computes delta, calculates new size based on direction and RTL flag, clamps via `clampSize`, and updates `panelSize`
- [x] 2.5 Implement `pointerup` handler that releases pointer capture, clears `isResizing`, and calls `persistSize` with final dimensions
- [x] 2.6 Apply cursor styles to document body during resize (`ns-resize`, `ew-resize`, `nwse-resize`/`nesw-resize` based on direction and RTL)
- [x] 2.7 For RTL locale, position resize handles on right edge and top-right corner instead of left edge and top-left corner
- [x] 2.8 Write property-based test: resize delta direction correctness — top drag changes only height, side drag changes only width, corner changes both; RTL inverts horizontal delta

## Task 3: Larger default size and Chat Panel layout update

- [x] 3.1 Update Chat_Panel inline styles to use `panelSize.width` and `panelSize.height` instead of the hardcoded `min(380px, ...)` and `min(520px, ...)`
- [x] 3.2 Ensure Chat_Panel remains anchored to bottom-right (LTR) or bottom-left (RTL) using existing positioning logic
- [x] 3.3 Maintain fixed-height header and fixed-height input area with flexible Message_Area using flex layout
- [x] 3.4 Update existing tests that assert on the old panel dimensions to reflect the new default size

## Task 4: Minimize to bubble state

- [x] 4.1 Add minimize button (using `Minus` icon from lucide-react) to the Chat_Panel header, positioned before the close button
- [x] 4.2 Add `minimize` and `تصغير المحادثة` i18n strings for the minimize button aria-label
- [x] 4.3 Implement minimize behavior: clicking minimize sets `isOpen = false` without clearing messages or input state (same as current close behavior, which already preserves state)
- [x] 4.4 Verify that reopening after minimize restores the Chat_Panel at `panelSize` (persisted or default) with conversation history intact
- [x] 4.5 Write example test: minimize preserves conversation state — open, send message, minimize, reopen, verify messages still present

## Task 5: Long conversation and scroll management

- [x] 5.1 Add `IntersectionObserver` on a sentinel `<div>` at the bottom of the message list to track `isAtBottom` state
- [x] 5.2 Update auto-scroll logic: only auto-scroll to bottom on new messages when `isAtBottom` is true
- [x] 5.3 Add `ScrollToBottomButton` component that appears when `isAtBottom` is false, with `scrollToBottom` and `انتقل إلى الأحدث` i18n strings
- [x] 5.4 Implement click handler on `ScrollToBottomButton` that scrolls the sentinel into view with smooth behavior
- [x] 5.5 Write example test: scroll-to-bottom button appears when user scrolls up and disappears when clicked

## Task 6: Rich text rendering for assistant messages

- [x] 6.1 Implement `formatMessageContent(content: string): React.ReactNode` function that converts plain text with basic markdown to React elements (paragraphs, bold, line breaks, unordered lists, ordered lists)
- [x] 6.2 Apply `formatMessageContent` to assistant message bubbles in the message list (user messages remain plain text)
- [x] 6.3 Add `ora-richtext` CSS class to assistant message bubbles for consistent list and paragraph styling
- [x] 6.4 Write example test: `formatMessageContent` renders bold text, unordered lists, ordered lists, and paragraph breaks correctly

## Task 7: Multi-line textarea input

- [x] 7.1 Replace `<input type="text">` with `<textarea>` element, initial `rows={1}`
- [x] 7.2 Implement auto-grow logic: on each `onChange`, set `textarea.style.height` to `scrollHeight`, capped at max-height (~6rem / 4 lines)
- [x] 7.3 Add `overflow-y: auto` when content exceeds max height
- [x] 7.4 Preserve existing keyboard behavior: `Enter` sends message, `Shift+Enter` inserts newline
- [x] 7.5 Update existing tests that reference `<input>` element to use `<textarea>` selectors

## Task 8: Mobile full-screen mode

- [x] 8.1 When `isMobile && isOpen`, render Chat_Panel at 100vw × 100vh with safe area inset padding via `env(safe-area-inset-*)`
- [x] 8.2 Hide all `ResizeHandle` components when `isMobile` is true
- [x] 8.3 In mobile full-screen mode, show only close button in header (hide minimize button since full-screen has no intermediate state)
- [x] 8.4 When viewport crosses the 640px breakpoint (detected by `matchMedia` listener), transition between full-screen and floating panel modes
- [x] 8.5 Write example test: on viewport ≤640px, panel renders full-screen and resize handles are not present

## Task 9: RTL resize handle positioning and final integration

- [x] 9.1 Verify RTL locale positions Chat_Panel at bottom-left with resize handles on right edge and top-right corner
- [x] 9.2 Verify all new i18n strings render correctly for both `en` and `ar` locales
- [x] 9.3 Verify ORA design tokens are applied: `ora-charcoal` header, `ora-gold` accents, `ora-sand` borders, `shadow-ora-lg` shadow
- [x] 9.4 Run full test suite (`npm run test`) and verify all existing and new tests pass
- [x] 9.5 Verify no TypeScript errors in modified files
