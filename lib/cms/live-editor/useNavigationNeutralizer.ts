"use client";

/**
 * useNavigationNeutralizer — capture-phase navigation neutralization + block
 * selection for the live page editor (`/ora-panel/live/[id]`).
 *
 * Spec: live-page-editor — task 5.1
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
 *
 * A SINGLE set of capture-phase listeners is bound to `rootRef.current` for
 * `pointerdown`, `click`, `submit`, and `keydown`. Because the listeners run in
 * the capture phase from the region root, they fire before any block's own
 * bubble-phase handler, so they can cancel the activation before it navigates
 * or submits.
 *
 * Per the design, this hook is the SOLE capture-phase selection driver: the
 * shell mounts `useInlineSelection` with `active=false` (no competing
 * `pointerdown` listener) and routes the resolved block id through
 * `onSelectBlock`.
 *
 * Handling per event:
 *   1. Editor-UI exemption FIRST — if the target is inside
 *      `[data-inline-editor-ui]`, return immediately: default behavior is
 *      allowed and the selection is left unchanged (Req 4.7).
 *   2. Neutralize — `click`/`submit` and *activating* `keydown` events have
 *      their default prevented and propagation stopped, cancelling navigation
 *      (including new-tab/window via `target=_blank` and modified clicks with
 *      Cmd/Ctrl/Shift/Alt), button defaults, and form submission (Req 4.1–4.4).
 *      `pointerdown` is neutralized to suppress drag/focus side effects but does
 *      NOT commit a selection.
 *   3. Select exactly one block — selection commits on `click`/`submit`/keyboard
 *      activation. The nearest `data-puck-id` ancestor is resolved via the
 *      reused `findPuckIdFromTarget`; walking to the *nearest* ancestor
 *      guarantees exactly one containing block even when the activated element
 *      is nested inside multiple interactive ancestors (Req 4.5, 4.6).
 */

import { useEffect, useRef } from "react";

import {
  PUCK_ID_ATTR,
  findPuckIdFromTarget,
} from "@/lib/cms/inline-editor/useInlineSelection";

const EDITOR_UI_SELECTOR = "[data-inline-editor-ui]";

/**
 * Elements that activate (and therefore navigate/submit/fire their default) on
 * the keyboard. Buttons activate on both Enter and Space; anchors and form
 * submission activate on Enter only.
 */
const BUTTON_LIKE_SELECTOR =
  'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
const FORM_FIELD_SELECTOR = "input, select, textarea";

export interface NeutralizerOptions {
  /** Root element of the editable page region. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** Called with the resolved block id (or null) for the activated element. */
  onSelectBlock: (id: string | null, el: HTMLElement | null) => void;
}

/** True when the event target is part of the editor's own UI (Req 4.7). */
function isEditorUiTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(EDITOR_UI_SELECTOR) !== null
  );
}

/** Resolve the nearest `data-puck-id` block (id + element) for a target. */
function resolveBlock(target: EventTarget | null): {
  id: string | null;
  el: HTMLElement | null;
} {
  const id = findPuckIdFromTarget(target);
  const el =
    target instanceof Element
      ? (target.closest(`[${PUCK_ID_ATTR}]`) as HTMLElement | null)
      : null;
  return { id, el };
}

/**
 * Determine whether a `keydown` activates a control (and so must be
 * neutralized). Mirrors native keyboard activation semantics:
 *   - Enter activates anchors, buttons, submit controls, and triggers implicit
 *     form submission when pressed inside a form field.
 *   - Space activates buttons (and button-like inputs).
 * Any other key (typing, arrows, Tab, Escape, …) is left alone so the editor
 * UI and form fields remain usable.
 */
function isActivatingKeydown(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const isEnter = event.key === "Enter";
  const isSpace = event.key === " " || event.key === "Spacebar";
  if (!isEnter && !isSpace) return false;

  // Buttons (and button-like inputs) activate on both Enter and Space.
  if (target.closest(BUTTON_LIKE_SELECTOR)) return true;

  if (isEnter) {
    // Anchors navigate on Enter.
    if (target.closest("a")) return true;
    // Enter inside a form field triggers implicit form submission.
    if (target.closest("form") && target.closest(FORM_FIELD_SELECTOR)) {
      return true;
    }
  }

  return false;
}

export function useNavigationNeutralizer(opts: NeutralizerOptions): void {
  const { rootRef, onSelectBlock } = opts;

  // Keep the latest callback in a ref so changing its identity does not
  // re-bind the listeners.
  const onSelectRef = useRef(onSelectBlock);
  onSelectRef.current = onSelectBlock;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const neutralize = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const commitSelection = (target: EventTarget | null) => {
      const { id, el } = resolveBlock(target);
      onSelectRef.current(id, el);
    };

    const handlePointerDown = (event: Event) => {
      if (isEditorUiTarget(event.target)) return; // Req 4.7
      // Suppress drag/focus side effects; selection commits on click/keydown.
      neutralize(event);
    };

    const handleClick = (event: Event) => {
      if (isEditorUiTarget(event.target)) return; // Req 4.7
      neutralize(event); // Req 4.1, 4.2, 4.4 (incl. modified clicks)
      commitSelection(event.target); // Req 4.5, 4.6
    };

    const handleSubmit = (event: Event) => {
      if (isEditorUiTarget(event.target)) return; // Req 4.7
      neutralize(event); // Req 4.3
      commitSelection(event.target); // Req 4.5, 4.6
    };

    const handleKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (isEditorUiTarget(event.target)) return; // Req 4.7
      if (!isActivatingKeydown(event)) return; // non-activating keys keep default
      neutralize(event); // Req 4.1, 4.2, 4.3
      commitSelection(event.target); // Req 4.5, 4.6
    };

    root.addEventListener("pointerdown", handlePointerDown, true);
    root.addEventListener("click", handleClick, true);
    root.addEventListener("submit", handleSubmit, true);
    root.addEventListener("keydown", handleKeyDown, true);

    return () => {
      root.removeEventListener("pointerdown", handlePointerDown, true);
      root.removeEventListener("click", handleClick, true);
      root.removeEventListener("submit", handleSubmit, true);
      root.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [rootRef]);
}
