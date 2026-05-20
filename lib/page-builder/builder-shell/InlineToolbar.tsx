"use client";

/**
 * InlineToolbar — floating rich-text toolbar for Tiptap editors on text fields.
 *
 * Spec: custom-branded-page-builder
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
 *
 * Req 5.1: WHEN a user focuses a rich-text field on the canvas, THE
 *   Builder_Shell SHALL display an Inline_Toolbar anchored to the field
 *   with actions for bold, italic, underline, text color, highlight
 *   color, and AI assist.
 * Req 5.2: WHEN a user activates bold, italic, or underline, THE
 *   Inline_Toolbar SHALL toggle the corresponding inline formatting on
 *   the current selection.
 * Req 5.3: WHEN a user activates text color or highlight color, THE
 *   Inline_Toolbar SHALL open an ORA-themed color picker and apply the
 *   chosen color to the current selection.
 * Req 5.4: WHEN a user activates AI assist on a non-empty selection,
 *   THE Inline_Toolbar SHALL invoke the existing AI assist action and
 *   replace the selection with the returned text.
 * Req 5.5: IF the text field loses focus to an element outside the
 *   Inline_Toolbar, THEN THE Inline_Toolbar SHALL hide within 150 ms.
 *
 * Architecture notes:
 *
 * The toolbar is a self-positioning portal. It's driven entirely by the
 * Tiptap `Editor` instance passed in as a prop — the caller is only
 * responsible for configuring that editor's extension set (StarterKit +
 * Underline at minimum; TextStyle + Color + Highlight for the colour
 * actions to actually mutate the document). The toolbar does not mount
 * or own the editor.
 *
 * Visibility state machine (Req 5.1, 5.5):
 *   - The toolbar subscribes to the editor's `focus` and `blur` events via
 *     `editor.on("focus", ...)` / `editor.on("blur", ...)`.
 *   - When the editor has focus OR the toolbar itself has focus (via a
 *     `focusin`/`focusout` listener on the toolbar container), the
 *     toolbar stays visible.
 *   - When BOTH lose focus, a 150 ms timer starts. If focus returns to
 *     either the editor or the toolbar before it elapses, the timer is
 *     cancelled. Otherwise the toolbar unmounts. This gives the user a
 *     frictionless path from the text field to the toolbar's color
 *     picker popover without the toolbar vanishing mid-click.
 *
 * Positioning (Req 5.1):
 *   - Anchors to `editor.view.dom.getBoundingClientRect()` via
 *     `useSyncExternalStore` with an rAF-throttled scroll/resize
 *     subscription. Same approach as `ElementHeader` so the two floating
 *     pieces of chrome behave consistently on complex scroll
 *     compositions.
 *   - Renders 40 px above the editor's top edge, clamped to 4 px so the
 *     toolbar stays on-screen when the field is flush with the viewport
 *     top.
 *
 * Color pickers (Req 5.3):
 *   - Clicking the text-color or highlight button opens the ORA palette
 *     picker in a local popover anchored below the respective button.
 *   - The popover lives inside the toolbar's container, so focus
 *     excursions into the picker keep the toolbar considered focused and
 *     do not start the 150 ms hide timer.
 *   - The commands dispatched are `setMark("textStyle", { color })` and
 *     `setMark("highlight", { color })`. These are no-ops in schemas
 *     without the matching mark types, which keeps this component
 *     decoupled from the editor's extension configuration. Blocks that
 *     want functional colour marks configure TextStyle + Color +
 *     Highlight on their own editor instance.
 *
 * AI assist (Req 5.4):
 *   - Reads the current selection text via
 *     `editor.state.doc.textBetween(from, to, " ")`.
 *   - When the selection is empty, the button is disabled and `onAiAssist`
 *     is not called.
 *   - The returned text replaces the selection via a single Tiptap chain:
 *     delete the range, then insertContent at the same position. We keep
 *     the editor focused so the user can immediately continue editing.
 *
 * Accessibility (Req 18.2 cross-cut):
 *   - The container is `role="toolbar"` with an `aria-label`.
 *   - Every icon-only button carries `aria-label` and a `title` tooltip.
 *   - The text-color and highlight-color buttons use `aria-expanded` and
 *     `aria-haspopup="dialog"` to expose their popover relationship.
 */

import React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Palette,
  Highlighter,
  Link2,
  Sparkles,
} from "lucide-react";
import { ORA_THEME } from "./inspector/tokens";
import { OraColorPicker } from "./inspector/controls/OraColorPicker";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface InlineToolbarProps {
  /**
   * The Tiptap editor this toolbar drives. When `null` the toolbar
   * renders nothing — the caller can mount `<InlineToolbar />`
   * unconditionally and toggle visibility by flipping this prop.
   */
  editor: Editor | null;
  /**
   * Optional AI-assist callback. Receives the current selection text and
   * returns the replacement text. When omitted, the AI assist button is
   * disabled.
   */
  onAiAssist?: (selection: string) => Promise<string>;
}

/**
 * Exported for tests. The spec (Req 5.5) fixes the auto-hide debounce at
 * 150 ms; tests can import the constant to assert timing without
 * hard-coding the magic number.
 */
export const INLINE_TOOLBAR_HIDE_DELAY_MS = 150;

// ─── Positioning ─────────────────────────────────────────────────────────────

interface Position {
  top: number;
  left: number;
}

const TOOLBAR_HEIGHT = 36;
const OFFSET_ABOVE_EDITOR = 40;
const MIN_TOP = 4;

function computePosition(editorEl: HTMLElement): Position {
  const rect = editorEl.getBoundingClientRect();
  const top = Math.max(MIN_TOP, rect.top - OFFSET_ABOVE_EDITOR);
  return { top, left: rect.left };
}

// ─── Client-only gate ───────────────────────────────────────────────────────

function useIsClient(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// ─── Anchor position hook ───────────────────────────────────────────────────

/**
 * Track the editor DOM element's viewport geometry through
 * `useSyncExternalStore`. The snapshot is memoised by a string key so
 * repeated reads return a referentially stable object (satisfying the
 * external-store contract and avoiding extra React re-renders).
 */
function useEditorAnchorPosition(editor: Editor | null): Position | null {
  const cachedKey = React.useRef<string>("");
  const cachedValue = React.useRef<Position | null>(null);

  const editorEl = editor?.view?.dom ?? null;

  const getSnapshot = React.useCallback((): Position | null => {
    if (!editorEl) {
      if (cachedKey.current !== "__null__") {
        cachedKey.current = "__null__";
        cachedValue.current = null;
      }
      return cachedValue.current;
    }
    const pos = computePosition(editorEl as HTMLElement);
    const key = `${pos.top}:${pos.left}`;
    if (key !== cachedKey.current) {
      cachedKey.current = key;
      cachedValue.current = pos;
    }
    return cachedValue.current;
  }, [editorEl]);

  const getServerSnapshot = React.useCallback((): Position | null => null, []);

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!editorEl) return () => {};

      let rafId: number | null = null;
      let pending = false;
      const schedule = () => {
        if (pending) return;
        pending = true;
        rafId = requestAnimationFrame(() => {
          pending = false;
          rafId = null;
          notify();
        });
      };

      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(editorEl as HTMLElement);
      }

      return () => {
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        if (resizeObserver) resizeObserver.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    },
    [editorEl],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ─── Visibility state ───────────────────────────────────────────────────────

/**
 * Orchestrates the visibility of the toolbar with a 150 ms debounced
 * hide (Req 5.5). The returned `visible` boolean is `true` whenever the
 * editor or the toolbar container currently owns focus; it becomes
 * `false` exactly `INLINE_TOOLBAR_HIDE_DELAY_MS` milliseconds after the
 * last focused one loses focus, and that transition is cancellable by
 * either side regaining focus in the interim.
 *
 * The returned `toolbarRef` must be attached to the toolbar's root DOM
 * node so the hook can install a `focusin`/`focusout` listener on it.
 * Those bubbling events cover the color-picker popover and any future
 * nested focusable content without needing to plumb individual handlers.
 */
function useToolbarVisibility(editor: Editor | null): {
  visible: boolean;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
} {
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const editorFocused = React.useRef<boolean>(editor?.isFocused ?? false);
  const toolbarFocused = React.useRef<boolean>(false);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [visible, setVisible] = React.useState<boolean>(
    editor?.isFocused ?? false,
  );

  const cancelHide = React.useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = React.useCallback(() => {
    // Guard against re-entrancy: if a timer is already ticking we leave
    // it alone. Multiple blur events in rapid succession (e.g. a click
    // that bubbles through both the editor and a neighbouring element)
    // collapse into a single 150 ms window.
    if (hideTimerRef.current !== null) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (!editorFocused.current && !toolbarFocused.current) {
        setVisible(false);
      }
    }, INLINE_TOOLBAR_HIDE_DELAY_MS);
  }, []);

  // Subscribe to the editor's focus/blur lifecycle.
  React.useEffect(() => {
    if (!editor) {
      editorFocused.current = false;
      cancelHide();
      setVisible(false);
      return;
    }

    editorFocused.current = editor.isFocused;
    if (editor.isFocused) {
      cancelHide();
      setVisible(true);
    }

    const handleFocus = () => {
      editorFocused.current = true;
      cancelHide();
      setVisible(true);
    };
    const handleBlur = () => {
      editorFocused.current = false;
      if (!toolbarFocused.current) scheduleHide();
    };

    editor.on("focus", handleFocus);
    editor.on("blur", handleBlur);

    return () => {
      editor.off("focus", handleFocus);
      editor.off("blur", handleBlur);
    };
  }, [editor, cancelHide, scheduleHide]);

  // Subscribe to focus excursions into/out of the toolbar itself. We
  // use native `focusin`/`focusout` because they bubble (unlike the
  // React synthetic `onFocus`/`onBlur` which do but with some quirks in
  // portals), so the popover's inputs reach us naturally.
  React.useEffect(() => {
    const node = toolbarRef.current;
    if (!node) return;

    const handleFocusIn = () => {
      toolbarFocused.current = true;
      cancelHide();
      setVisible(true);
    };
    const handleFocusOut = (event: FocusEvent) => {
      // `event.relatedTarget` is the element receiving focus next. If
      // it's still inside the toolbar, ignore the event — this avoids
      // spurious hide timers while focus moves between picker swatches.
      const next = event.relatedTarget as Node | null;
      if (next && node.contains(next)) return;
      toolbarFocused.current = false;
      if (!editorFocused.current) scheduleHide();
    };

    node.addEventListener("focusin", handleFocusIn);
    node.addEventListener("focusout", handleFocusOut);
    return () => {
      node.removeEventListener("focusin", handleFocusIn);
      node.removeEventListener("focusout", handleFocusOut);
    };
    // Re-attach whenever the editor changes, because the `visible` state
    // is driven by both. Passing `visible` as a dep ensures the handlers
    // close over the latest refs after the first render.
  }, [editor, visible, cancelHide, scheduleHide]);

  // Clear any pending timer on unmount so a delayed setState never hits
  // a destroyed component.
  React.useEffect(() => {
    return () => cancelHide();
  }, [cancelHide]);

  return { visible, toolbarRef };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InlineToolbar({ editor, onAiAssist }: InlineToolbarProps) {
  const isClient = useIsClient();
  const position = useEditorAnchorPosition(editor);
  const { visible, toolbarRef } = useToolbarVisibility(editor);

  // Which popover is currently open — `null`, `"color"`, `"highlight"`, or `"link"`.
  // Kept local to the toolbar so closing the popover when focus leaves
  // happens naturally via the visibility machinery.
  const [openPicker, setOpenPicker] = React.useState<
    null | "color" | "highlight" | "link"
  >(null);

  // Force re-render when the editor's selection state changes so that
  // `isActive("bold")` etc. drive the `data-active` attribute used for
  // button styling. We subscribe to `transaction` (fires on any state
  // change) rather than `selectionUpdate` so typing that changes active
  // marks without moving the selection still refreshes the toolbar.
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!editor) return;
    const handler = () => forceRender();
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Close the open color picker whenever the toolbar hides.
  React.useEffect(() => {
    if (!visible) setOpenPicker(null);
  }, [visible]);

  // Ref for the Link button — used by LinkPopover to restore focus on close.
  const linkButtonRef = React.useRef<HTMLButtonElement>(null);

  if (!isClient || typeof document === "undefined") return null;
  if (!editor) return null;
  if (!visible || !position) return null;

  // ── Command helpers ────────────────────────────────────────────────────
  //
  // Each helper re-focuses the editor so the formatting applies to the
  // selection the user just had. Tiptap's `.focus()` in the chain
  // restores the selection that was active when the editor last blurred
  // (which is exactly the moment the user clicked the toolbar button).

  const toggleBold = () => {
    editor.chain().focus().toggleBold().run();
  };
  const toggleItalic = () => {
    editor.chain().focus().toggleItalic().run();
  };
  const toggleUnderline = () => {
    // Underline lives in `@tiptap/extension-underline` and is included
    // with StarterKit v3. If it's absent from the schema the chain is a
    // no-op, which we accept silently — the toolbar is UI-only and
    // doesn't enforce editor configuration.
    editor.chain().focus().toggleUnderline().run();
  };

  const setAlignLeft = () => {
    editor.chain().focus().setTextAlign("left").run();
  };
  const setAlignCenter = () => {
    editor.chain().focus().setTextAlign("center").run();
  };
  const setAlignRight = () => {
    editor.chain().focus().setTextAlign("right").run();
  };
  const setAlignJustify = () => {
    editor.chain().focus().setTextAlign("justify").run();
  };

  const applyTextColor = (color: string) => {
    // `setMark("textStyle", { color })` is the canonical way to apply a
    // foreground colour through the TextStyle + Color extensions. If
    // those extensions aren't loaded the mark type is unknown and
    // Tiptap silently skips the transaction, which is the behaviour we
    // want here (the toolbar stays decoupled from editor config).
    editor.chain().focus().setMark("textStyle", { color }).run();
    setOpenPicker(null);
  };

  const applyHighlightColor = (color: string) => {
    editor.chain().focus().setMark("highlight", { color }).run();
    setOpenPicker(null);
  };

  const handleAiAssist = async () => {
    if (!onAiAssist) return;
    const { from, to } = editor.state.selection;
    if (from === to) return; // empty selection — button should be disabled
    const selectionText = editor.state.doc.textBetween(from, to, " ");
    if (!selectionText) return;
    try {
      const replacement = await onAiAssist(selectionText);
      if (typeof replacement !== "string" || replacement.length === 0) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent(replacement)
        .run();
    } catch {
      // Swallow errors — the AI assist callback is the correct place to
      // surface failures (toasts, logging). The toolbar just stays put.
    }
  };

  // ── Active-state readers ───────────────────────────────────────────────

  const isBoldActive = editor.isActive("bold");
  const isItalicActive = editor.isActive("italic");
  const isUnderlineActive = editor.isActive("underline");
  const isAlignLeftActive = editor.isActive({ textAlign: "left" });
  const isAlignCenterActive = editor.isActive({ textAlign: "center" });
  const isAlignRightActive = editor.isActive({ textAlign: "right" });
  const isAlignJustifyActive = editor.isActive({ textAlign: "justify" });
  const hasSelection = editor.state.selection.from !== editor.state.selection.to;
  const aiAvailable = typeof onAiAssist === "function" && hasSelection;
  const isLinkActive = editor.isActive("link");

  // Current colours for the pickers (read as attributes of the active
  // marks, falling back to sensible defaults).
  const currentTextColor =
    (editor.getAttributes("textStyle").color as string | undefined) ??
    ORA_THEME.charcoal;
  const currentHighlight =
    (editor.getAttributes("highlight").color as string | undefined) ??
    "#FFF3B0";

  // ── Render ─────────────────────────────────────────────────────────────

  const toolbar = (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text formatting"
      data-inline-toolbar
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        height: TOOLBAR_HEIGHT,
        display: "inline-flex",
        alignItems: "stretch",
        background: ORA_THEME.charcoal,
        color: ORA_THEME.white,
        border: `1px solid ${ORA_THEME.gold}`,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        zIndex: 9100,
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <IconButton
        ariaLabel="Bold"
        title="Bold (Cmd+B)"
        onClick={toggleBold}
        Icon={Bold}
        active={isBoldActive}
      />
      <IconButton
        ariaLabel="Italic"
        title="Italic (Cmd+I)"
        onClick={toggleItalic}
        Icon={Italic}
        active={isItalicActive}
      />
      <IconButton
        ariaLabel="Underline"
        title="Underline (Cmd+U)"
        onClick={toggleUnderline}
        Icon={Underline}
        active={isUnderlineActive}
      />
      <Divider />
      <IconButton
        ariaLabel="Align left"
        title="Align left"
        onClick={setAlignLeft}
        Icon={AlignLeft}
        active={isAlignLeftActive}
      />
      <IconButton
        ariaLabel="Align center"
        title="Align center"
        onClick={setAlignCenter}
        Icon={AlignCenter}
        active={isAlignCenterActive}
      />
      <IconButton
        ariaLabel="Align right"
        title="Align right"
        onClick={setAlignRight}
        Icon={AlignRight}
        active={isAlignRightActive}
      />
      <IconButton
        ariaLabel="Align justify"
        title="Justify"
        onClick={setAlignJustify}
        Icon={AlignJustify}
        active={isAlignJustifyActive}
      />
      <Divider />
      <IconButton
        ariaLabel="Text color"
        title="Text color"
        onClick={() =>
          setOpenPicker((p) => (p === "color" ? null : "color"))
        }
        Icon={Palette}
        active={openPicker === "color"}
        ariaHasPopup="dialog"
        ariaExpanded={openPicker === "color"}
      />
      <IconButton
        ariaLabel="Highlight color"
        title="Highlight color"
        onClick={() =>
          setOpenPicker((p) => (p === "highlight" ? null : "highlight"))
        }
        Icon={Highlighter}
        active={openPicker === "highlight"}
        ariaHasPopup="dialog"
        ariaExpanded={openPicker === "highlight"}
      />
      <IconButton
        ariaLabel="Link"
        title="Link"
        onClick={() =>
          setOpenPicker((p) => (p === "link" ? null : "link"))
        }
        Icon={Link2}
        active={isLinkActive || openPicker === "link"}
        ariaHasPopup="dialog"
        ariaExpanded={openPicker === "link"}
        buttonRef={linkButtonRef}
      />
      <Divider />
      <IconButton
        ariaLabel="AI assist"
        title={
          onAiAssist
            ? hasSelection
              ? "AI assist on selection"
              : "Select text to use AI assist"
            : "AI assist unavailable"
        }
        onClick={handleAiAssist}
        Icon={Sparkles}
        disabled={!aiAvailable}
        tone="accent"
      />

      {openPicker === "color" ? (
        <PickerPopover label="Text color">
          <OraColorPicker
            label="Text color"
            value={currentTextColor}
            onChange={applyTextColor}
          />
        </PickerPopover>
      ) : null}
      {openPicker === "highlight" ? (
        <PickerPopover label="Highlight color">
          <OraColorPicker
            label="Highlight color"
            value={currentHighlight}
            onChange={applyHighlightColor}
          />
        </PickerPopover>
      ) : null}
      {openPicker === "link" ? (
        <LinkPopover
          editor={editor}
          onClose={() => setOpenPicker(null)}
          linkButtonRef={linkButtonRef}
        />
      ) : null}
    </div>
  );

  return createPortal(toolbar, document.body);
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

interface IconButtonProps {
  ariaLabel: string;
  title: string;
  onClick: () => void;
  Icon: React.ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "accent";
  ariaHasPopup?: "dialog" | "menu" | "listbox";
  ariaExpanded?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

function IconButton({
  ariaLabel,
  title,
  onClick,
  Icon,
  active = false,
  disabled = false,
  tone = "default",
  ariaHasPopup,
  ariaExpanded,
  buttonRef,
}: IconButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaHasPopup ? undefined : active || undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaHasPopup ? ariaExpanded : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      data-active={active || undefined}
      // Prevent the click from stealing focus. Tiptap (via ProseMirror)
      // treats a focus change as a blur on the editor which would start
      // the 150 ms hide timer before our `editor.chain().focus()` call
      // runs. `preventDefault` on mousedown keeps the editor focused.
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      style={{
        ...iconButtonBaseStyle,
        background: active ? ORA_THEME.charcoalDark : "transparent",
        color: disabled
          ? ORA_THEME.muted
          : tone === "accent"
            ? ORA_THEME.gold
            : active
              ? ORA_THEME.gold
              : ORA_THEME.white,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 1,
        alignSelf: "stretch",
        background: ORA_THEME.gold,
        opacity: 0.4,
      }}
    />
  );
}

function PickerPopover({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // The popover is positioned below the toolbar (which is itself fixed
  // at `position.top`). Using `position: absolute` with
  // `top: TOOLBAR_HEIGHT` places it immediately under the toolbar.
  // Width is fixed at 224 px to comfortably fit the 7-column swatch
  // grid from `OraColorPicker`.
  return (
    <div
      role="dialog"
      aria-label={label}
      style={{
        position: "absolute",
        top: TOOLBAR_HEIGHT,
        left: 0,
        width: 224,
        marginTop: 4,
        padding: 12,
        background: ORA_THEME.white,
        color: ORA_THEME.charcoal,
        border: `1px solid ${ORA_THEME.border}`,
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.18)",
        zIndex: 1,
      }}
      onMouseDown={(event) => {
        // Keep focus inside the toolbar tree when interacting with the
        // picker's plain swatch buttons. The text input inside the
        // picker still takes focus normally because we don't call
        // preventDefault on input clicks (the listener only fires on
        // the popover wrapper, which doesn't bubble from inputs that
        // call `stopPropagation`).
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

/**
 * LinkPopover — anchored below the Link button. Contains a URL input,
 * "Apply" and "Remove" buttons.
 *
 * - "Apply" with a non-empty URL and non-empty selection sets the `link` mark.
 * - "Apply" with an empty URL removes the `link` mark.
 * - "Remove" removes the `link` mark unconditionally.
 *
 * Auto-hide integration (Req 2.8): This component is rendered as a child
 * of the toolbar's root `<div ref={toolbarRef}>`. The `useToolbarVisibility`
 * hook's `focusin`/`focusout` listeners on that container naturally cover
 * the popover — focus moving to the popover's input or buttons bubbles as
 * `focusin` on the toolbar container, keeping `toolbarFocused` true and
 * preventing the 150 ms hide timer from starting. No additional wiring is
 * needed because the popover lives inside the toolbar DOM tree.
 *
 * Focus trap (Req 10.4): Tab/Shift+Tab cycles through the focusable
 * elements (URL input, Remove button, Apply button) without escaping to
 * the toolbar or the page. On close, focus is restored to the Link button.
 */
function LinkPopover({
  editor,
  onClose,
  linkButtonRef,
}: {
  editor: Editor;
  onClose: () => void;
  linkButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  // Pre-fill the input with the current link URL if the cursor is on a link.
  const currentHref =
    (editor.getAttributes("link").href as string | undefined) ?? "";
  const [url, setUrl] = React.useState(currentHref);

  const popoverRef = React.useRef<HTMLDivElement>(null);

  // Close with focus restoration to the Link button.
  const closeAndRestoreFocus = React.useCallback(() => {
    onClose();
    // Restore focus to the Link button after the popover unmounts.
    // Use requestAnimationFrame to ensure the DOM has settled.
    requestAnimationFrame(() => {
      linkButtonRef.current?.focus();
    });
  }, [onClose, linkButtonRef]);

  const handleApply = () => {
    if (url.trim()) {
      // Non-empty URL: set the link mark on the current selection.
      editor
        .chain()
        .focus()
        .setLink({ href: url.trim() })
        .run();
    } else {
      // Empty URL: remove the link mark.
      editor.chain().focus().unsetLink().run();
    }
    closeAndRestoreFocus();
  };

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    closeAndRestoreFocus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleApply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
    } else if (event.key === "Tab") {
      // Focus trap: cycle through focusable elements inside the popover.
      const container = popoverRef.current;
      if (!container) return;

      const focusableElements = container.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])',
      );
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        // Shift+Tab: if at the first element, wrap to the last.
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if at the last element, wrap to the first.
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Link"
      data-link-popover
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        top: TOOLBAR_HEIGHT,
        left: 0,
        width: 280,
        marginTop: 4,
        padding: 12,
        background: ORA_THEME.white,
        color: ORA_THEME.charcoal,
        border: `1px solid ${ORA_THEME.border}`,
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.18)",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseDown={(event) => {
        // Prevent focus loss from the toolbar tree when clicking inside
        // the popover's non-input areas.
        event.stopPropagation();
      }}
    >
      <input
        type="url"
        aria-label="URL"
        placeholder="https://example.com"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        autoFocus
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          border: `1px solid ${ORA_THEME.border}`,
          borderRadius: 4,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleRemove}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            fontFamily: "system-ui, sans-serif",
            background: "transparent",
            color: ORA_THEME.charcoal,
            border: `1px solid ${ORA_THEME.border}`,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Remove
        </button>
        <button
          type="button"
          onClick={handleApply}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            fontFamily: "system-ui, sans-serif",
            background: ORA_THEME.charcoal,
            color: ORA_THEME.white,
            border: `1px solid ${ORA_THEME.charcoal}`,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const iconButtonBaseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: "100%",
  padding: 0,
  background: "transparent",
  border: "none",
  borderLeft: `1px solid rgba(184, 149, 107, 0.25)`, // ORA_THEME.gold @ 25%
  borderRadius: 0,
  fontFamily: "inherit",
  outlineOffset: -2,
};
