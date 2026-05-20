"use client";

/**
 * InlineRichtextController — side-effect-only controller that manages the
 * inline richtext editing lifecycle on the Puck canvas.
 *
 * Spec: builder-canvas-polish-and-inline-richtext
 * Tasks: 6.1–6.9
 *
 * Responsibilities:
 * - Listen (capture phase) on the document for `pointerdown` events.
 * - Walk up from `event.target` to find the nearest `[data-puck-id]` +
 *   `[data-puck-field]` pair.
 * - Implement the two-step gesture: first click stashes `{ blockId, timestamp }`;
 *   second click within 500ms on the same block's richtext element promotes to
 *   edit mode.
 * - Lazy-import Tiptap and extensions on first promotion.
 * - Construct a Tiptap Editor bound to the rendered DOM element.
 * - Expose the editor through InlineRichtextContext.
 * - On editor update, sanitize and debounce a `replace` dispatch at 100ms.
 * - On outside click, destroy editor after 150ms and flush pending dispatch.
 * - On Escape, destroy editor, flush, keep block selected.
 */

import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { usePuckStore } from "../use-puck-store";
import { isRichtextField } from "./richtext-fields";
import { sanitizeRichTextHtml } from "../config";
import { INLINE_TOOLBAR_HIDE_DELAY_MS } from "./InlineToolbar";

// ─── Context ─────────────────────────────────────────────────────────────────

interface InlineRichtextContextValue {
  editor: Editor | null;
  targetBlockId: string | null;
  targetField: string | null;
}

const InlineRichtextContext = createContext<InlineRichtextContextValue>({
  editor: null,
  targetBlockId: null,
  targetField: null,
});

/**
 * Hook consumed by InlineToolbar and other components that need access
 * to the currently active inline richtext editor instance.
 */
export function useActiveRichtextEditor(): Editor | null {
  return useContext(InlineRichtextContext).editor;
}

export { InlineRichtextContext };

// ─── Constants ───────────────────────────────────────────────────────────────

/** Window (ms) within which a second click on the same block promotes to edit mode. */
const DOUBLE_CLICK_WINDOW_MS = 500;

/** Debounce interval (ms) for dispatching replace after editor updates. */
const DISPATCH_DEBOUNCE_MS = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk up from `target` to find the nearest element with both
 * `data-puck-id` and `data-puck-field` attributes.
 */
function findPuckFieldTarget(target: EventTarget | null): {
  blockId: string;
  field: string;
  element: HTMLElement;
} | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.documentElement) {
    const puckId = el.getAttribute("data-puck-id");
    const puckField = el.getAttribute("data-puck-field");
    if (puckId && puckField) {
      return { blockId: puckId, field: puckField, element: el };
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Walk up from `target` to find the nearest element with `data-puck-id`.
 */
function findPuckBlockTarget(target: EventTarget | null): {
  blockId: string;
  element: HTMLElement;
} | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.documentElement) {
    const puckId = el.getAttribute("data-puck-id");
    if (puckId) {
      return { blockId: puckId, element: el };
    }
    el = el.parentElement;
  }
  return null;
}

// ─── Lazy Tiptap loader ──────────────────────────────────────────────────────

interface TiptapModules {
  Editor: typeof import("@tiptap/react").Editor;
  StarterKit: typeof import("@tiptap/starter-kit").default;
  Underline: typeof import("@tiptap/extension-underline").default;
  TextStyle: typeof import("@tiptap/extension-text-style").TextStyle;
  Color: typeof import("@tiptap/extension-color").default;
  Highlight: typeof import("@tiptap/extension-highlight").default;
  TextAlign: typeof import("@tiptap/extension-text-align").default;
  Link: typeof import("@tiptap/extension-link").default;
}

let tiptapModulesCache: TiptapModules | null = null;

async function loadTiptapModules(): Promise<TiptapModules> {
  if (tiptapModulesCache) return tiptapModulesCache;

  const [
    { Editor },
    { default: StarterKit },
    { default: Underline },
    { TextStyle },
    { default: Color },
    { default: Highlight },
    { default: TextAlign },
    { default: Link },
  ] = await Promise.all([
    import("@tiptap/react"),
    import("@tiptap/starter-kit"),
    import("@tiptap/extension-underline"),
    import("@tiptap/extension-text-style"),
    import("@tiptap/extension-color"),
    import("@tiptap/extension-highlight"),
    import("@tiptap/extension-text-align"),
    import("@tiptap/extension-link"),
  ]);

  tiptapModulesCache = { Editor, StarterKit, Underline, TextStyle, Color, Highlight, TextAlign, Link };
  return tiptapModulesCache;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InlineRichtextController({ children }: { children?: React.ReactNode }): React.ReactElement | null {
  // Puck store access
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const dispatch = usePuckStore((s) => s.dispatch);
  const getSelectorForId = usePuckStore((s) => s.getSelectorForId);

  // Editor state
  const [editor, setEditor] = useState<Editor | null>(null);
  const [targetBlockId, setTargetBlockId] = useState<string | null>(null);
  const [targetField, setTargetField] = useState<string | null>(null);

  // Two-step gesture state machine refs
  const lastClickedBlockRef = useRef<{ blockId: string; timestamp: number } | null>(null);

  // Debounce timer for dispatch
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending HTML to dispatch
  const pendingHtmlRef = useRef<string | null>(null);
  // Track the active editor element for outside-click detection
  const editorElementRef = useRef<HTMLElement | null>(null);
  // Track the editor instance in a ref for cleanup callbacks
  const editorRef = useRef<Editor | null>(null);
  // Track block/field for dispatch in callbacks
  const targetBlockIdRef = useRef<string | null>(null);
  const targetFieldRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    targetBlockIdRef.current = targetBlockId;
  }, [targetBlockId]);
  useEffect(() => {
    targetFieldRef.current = targetField;
  }, [targetField]);

  // ─── Flush pending dispatch ──────────────────────────────────────────

  const flushPendingDispatch = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const html = pendingHtmlRef.current;
    const blockId = targetBlockIdRef.current;
    const field = targetFieldRef.current;

    if (html === null || !blockId || !field) return;

    pendingHtmlRef.current = null;

    // Re-resolve the selector at flush time in case the block moved
    const selector = getSelectorForId(blockId);
    if (!selector) return; // Block was deleted — drop the edit silently

    dispatch({
      type: "replace",
      destinationZone: selector.zone,
      destinationIndex: selector.index,
      data: {
        type: selectedItem?.type ?? "",
        props: {
          ...(selectedItem?.props as Record<string, unknown>),
          id: selectedItem?.props?.id as string,
          [field]: html,
        },
      },
    });
  }, [dispatch, getSelectorForId, selectedItem]);

  // ─── Destroy editor ──────────────────────────────────────────────────

  const destroyEditor = useCallback(() => {
    flushPendingDispatch();

    const currentEditor = editorRef.current;
    if (currentEditor) {
      currentEditor.destroy();
    }

    setEditor(null);
    setTargetBlockId(null);
    setTargetField(null);
    editorElementRef.current = null;
    lastClickedBlockRef.current = null;
  }, [flushPendingDispatch]);

  // ─── Schedule debounced dispatch ─────────────────────────────────────

  const scheduleDebouncedDispatch = useCallback(
    (html: string) => {
      pendingHtmlRef.current = html;

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const pendingHtml = pendingHtmlRef.current;
        if (pendingHtml === null) return;
        pendingHtmlRef.current = null;

        const blockId = targetBlockIdRef.current;
        const field = targetFieldRef.current;
        if (!blockId || !field) return;

        const selector = getSelectorForId(blockId);
        if (!selector) return;

        dispatch({
          type: "replace",
          destinationZone: selector.zone,
          destinationIndex: selector.index,
          data: {
            type: selectedItem?.type ?? "",
            props: {
              ...(selectedItem?.props as Record<string, unknown>),
              id: selectedItem?.props?.id as string,
              [field]: pendingHtml,
            },
          },
        });
      }, DISPATCH_DEBOUNCE_MS);
    },
    [dispatch, getSelectorForId, selectedItem],
  );

  // ─── Promote to edit mode ────────────────────────────────────────────

  const promoteToEditMode = useCallback(
    async (blockId: string, field: string, element: HTMLElement) => {
      try {
        const modules = await loadTiptapModules();

        // Get initial HTML from the selected item's props
        const initialHtml =
          (selectedItem?.props as Record<string, unknown>)?.[field] as string ?? "";

        const newEditor = new modules.Editor({
          element,
          extensions: [
            modules.StarterKit,
            modules.Underline,
            modules.TextStyle,
            modules.Color,
            modules.Highlight.configure({ multicolor: true }),
            modules.TextAlign.configure({
              types: ["heading", "paragraph"],
            }),
            modules.Link.configure({
              openOnClick: false,
            }),
          ],
          content: initialHtml,
          autofocus: true,
          editorProps: {
            attributes: {
              role: "textbox",
              "aria-multiline": "true",
              "aria-label": `Edit ${field}`,
            },
          },
        });

        // Listen for updates and schedule debounced dispatch
        newEditor.on("update", () => {
          const html = newEditor.getHTML();
          const sanitized = sanitizeRichTextHtml(html);
          scheduleDebouncedDispatch(sanitized);
        });

        setEditor(newEditor);
        setTargetBlockId(blockId);
        setTargetField(field);
        editorElementRef.current = element;
      } catch {
        // Tiptap failed to mount — stay in idle state, no toast
        setEditor(null);
        setTargetBlockId(null);
        setTargetField(null);
        editorElementRef.current = null;
      }
    },
    [selectedItem, scheduleDebouncedDispatch],
  );

  // ─── Capture-phase pointerdown listener ──────────────────────────────

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      // If we're currently editing, check for outside click
      if (editorRef.current) {
        const editorEl = editorElementRef.current;
        const toolbarEl = document.querySelector("[data-inline-toolbar]");

        const isInsideEditor = editorEl?.contains(target as Node) ?? false;
        const isInsideToolbar = toolbarEl?.contains(target as Node) ?? false;

        if (!isInsideEditor && !isInsideToolbar) {
          // Outside click — destroy after INLINE_TOOLBAR_HIDE_DELAY_MS (150ms)
          setTimeout(() => {
            destroyEditor();
          }, INLINE_TOOLBAR_HIDE_DELAY_MS);
          return;
        }
        // Click is inside editor or toolbar — do nothing
        return;
      }

      // Not currently editing — handle two-step gesture
      const fieldTarget = findPuckFieldTarget(target);
      const blockTarget = findPuckBlockTarget(target);

      if (fieldTarget && isRichtextField(fieldTarget.field)) {
        // Click is on a richtext field element
        const now = Date.now();
        const last = lastClickedBlockRef.current;

        if (
          last &&
          last.blockId === fieldTarget.blockId &&
          now - last.timestamp < DOUBLE_CLICK_WINDOW_MS
        ) {
          // Second click within window on same block's richtext field → promote
          event.preventDefault();
          event.stopPropagation();
          lastClickedBlockRef.current = null;
          promoteToEditMode(fieldTarget.blockId, fieldTarget.field, fieldTarget.element);
        } else {
          // First click — stash block info
          lastClickedBlockRef.current = {
            blockId: fieldTarget.blockId,
            timestamp: now,
          };
        }
      } else if (blockTarget) {
        // Click on a block but not on a richtext field
        const now = Date.now();
        lastClickedBlockRef.current = {
          blockId: blockTarget.blockId,
          timestamp: now,
        };
      } else {
        // Click outside any block — reset gesture state
        lastClickedBlockRef.current = null;
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [destroyEditor, promoteToEditMode]);

  // ─── Escape key handler ──────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editorRef.current) {
        event.preventDefault();
        event.stopPropagation();
        destroyEditor();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [destroyEditor]);

  // ─── Cleanup on unmount ──────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      if (editorRef.current) {
        editorRef.current.destroy();
      }
    };
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────

  const contextValue = React.useMemo<InlineRichtextContextValue>(
    () => ({ editor, targetBlockId, targetField }),
    [editor, targetBlockId, targetField],
  );

  if (children !== undefined) {
    return (
      <InlineRichtextContext.Provider value={contextValue}>
        {children}
      </InlineRichtextContext.Provider>
    );
  }

  return null;
}
