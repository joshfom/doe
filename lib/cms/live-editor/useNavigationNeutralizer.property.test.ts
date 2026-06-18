// @vitest-environment jsdom
/**
 * Navigation neutralization + single-block selection — Property 2.
 *
 * Spec: live-page-editor — task 5.2
 * _Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
 *
 * For any element inside the editable page region that is NOT within
 * `data-inline-editor-ui`, activating it — via pointer click, modified pointer
 * click (Cmd/Ctrl/Shift/Alt), keyboard activation (Enter/Space), or form
 * submission — prevents the default action of the element and of every
 * interactive ancestor (no navigation, new tab, button default, or form
 * submission occurs) and sets exactly one block (the nearest `data-puck-id`
 * ancestor) as the Selected_Block.
 *
 * Tag: Feature: live-page-editor, Property 2: Activation is neutralized and
 * selects exactly one block — for any non-Editor_UI element, pointer/
 * modified-pointer/keyboard/form activation prevents the default of the element
 * and every interactive ancestor and selects exactly the nearest data-puck-id
 * block.
 */
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { renderHook } from "@testing-library/react";
import type * as React from "react";

import { useNavigationNeutralizer } from "./useNavigationNeutralizer";

// ---------------------------------------------------------------------------
// DOM-tree generators
// ---------------------------------------------------------------------------

/** Tags exercised by the generator: interactive + non-interactive. */
type Tag =
  | "a"
  | "button"
  | "roleButton"
  | "roleLink"
  | "tabindex"
  | "form"
  | "div"
  | "span"
  | "p";

const INTERACTIVE_TAGS: ReadonlySet<Tag> = new Set<Tag>([
  "a",
  "button",
  "roleButton",
  "roleLink",
  "tabindex",
  "form",
]);

function isInteractive(tag: Tag): boolean {
  return INTERACTIVE_TAGS.has(tag);
}

/** Build a concrete DOM element for a generated tag descriptor. */
function makeEl(tag: Tag): HTMLElement {
  switch (tag) {
    case "a": {
      const a = document.createElement("a");
      a.setAttribute("href", "https://example.com/path");
      // exercise the "open in new tab" surface that must also be neutralized
      a.setAttribute("target", "_blank");
      return a;
    }
    case "button": {
      const b = document.createElement("button");
      b.setAttribute("type", "button");
      return b;
    }
    case "roleButton": {
      const d = document.createElement("div");
      d.setAttribute("role", "button");
      d.setAttribute("tabindex", "0");
      return d;
    }
    case "roleLink": {
      const s = document.createElement("span");
      s.setAttribute("role", "link");
      s.setAttribute("tabindex", "0");
      return s;
    }
    case "tabindex": {
      const d = document.createElement("div");
      d.setAttribute("tabindex", "0");
      return d;
    }
    case "form":
      return document.createElement("form");
    default:
      return document.createElement(tag);
  }
}

type Activation =
  | "click"
  | "modified-click"
  | "keyboard-enter"
  | "keyboard-space"
  | "submit";

const tagArb = fc.constantFrom<Tag>(
  "a",
  "button",
  "roleButton",
  "roleLink",
  "tabindex",
  "div",
  "span",
  "p",
);

const ancestorSpecArb = fc.record({
  tag: tagArb,
  hasPuckId: fc.boolean(),
});

const scenarioArb = fc.record({
  activation: fc.constantFrom<Activation>(
    "click",
    "modified-click",
    "keyboard-enter",
    "keyboard-space",
    "submit",
  ),
  // nested chain of ancestors between the block root and the activated leaf
  ancestors: fc.array(ancestorSpecArb, { maxLength: 4 }),
  leafTag: tagArb,
  leafHasPuckId: fc.boolean(),
  modifier: fc.constantFrom<"ctrlKey" | "metaKey" | "shiftKey" | "altKey">(
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "altKey",
  ),
  // whether to bury one or more nested data-puck-id roots (already covered by
  // ancestor.hasPuckId, but force the outer block root to always exist)
});

/**
 * The leaf must satisfy the activation: keyboard activation only fires on
 * controls the neutralizer recognizes as activating.
 */
function effectiveLeafTag(activation: Activation, leafTag: Tag): Tag {
  if (activation === "keyboard-enter") {
    return (["a", "button", "roleButton", "roleLink"] as Tag[]).includes(leafTag)
      ? leafTag
      : "button";
  }
  if (activation === "keyboard-space") {
    return (["button", "roleButton"] as Tag[]).includes(leafTag)
      ? leafTag
      : "button";
  }
  return leafTag;
}

describe("Feature: live-page-editor — Property 2: Activation is neutralized and selects exactly one block", () => {
  it("prevents the default of the element and every interactive ancestor and selects the nearest data-puck-id block", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { activation, ancestors, leafTag, leafHasPuckId, modifier } =
          scenario;

        // --- build the DOM tree -------------------------------------------
        // rootEl hosts the neutralizer's capture-phase handlers (the editable
        // region root). It is intentionally NOT a block — blocks live inside.
        const rootEl = document.createElement("div");
        document.body.appendChild(rootEl);

        // Always include an outer block root so a nearest data-puck-id exists.
        const blockRoot = document.createElement("div");
        blockRoot.setAttribute("data-puck-id", "block-root");
        rootEl.appendChild(blockRoot);

        // Elements whose default/handlers must NOT fire (interactive ancestors
        // of the target, plus the target itself when interactive).
        const guardedEls: HTMLElement[] = [];

        let current: HTMLElement = blockRoot;
        ancestors.forEach((spec, i) => {
          const el = makeEl(spec.tag);
          if (spec.hasPuckId) el.setAttribute("data-puck-id", `anc-${i}`);
          current.appendChild(el);
          if (isInteractive(spec.tag)) guardedEls.push(el);
          current = el;
        });

        // --- create the activation target ---------------------------------
        let target: HTMLElement;
        if (activation === "submit") {
          const form = document.createElement("form");
          if (leafHasPuckId) form.setAttribute("data-puck-id", "leaf");
          const submitBtn = document.createElement("button");
          submitBtn.setAttribute("type", "submit");
          form.appendChild(submitBtn);
          current.appendChild(form);
          target = form;
          guardedEls.push(form);
        } else {
          const tag = effectiveLeafTag(activation, leafTag);
          const leaf = makeEl(tag);
          if (leafHasPuckId) leaf.setAttribute("data-puck-id", "leaf");
          current.appendChild(leaf);
          target = leaf;
          if (isInteractive(tag)) guardedEls.push(leaf);
        }

        // Expected selection: the nearest data-puck-id ancestor of the target
        // (inclusive of the target itself), resolved independently of the hook.
        const expectedEl = target.closest("[data-puck-id]") as HTMLElement;
        const expectedId = expectedEl.getAttribute("data-puck-id");

        // Spy listeners on every guarded element, in BOTH phases. Because the
        // neutralizer calls stopPropagation in the capture phase on rootEl
        // (an ancestor of all guarded elements), none of these may ever fire —
        // which is exactly what "prevents the default of every interactive
        // ancestor" means in a jsdom environment.
        let guardedFired = false;
        const markFired = () => {
          guardedFired = true;
        };
        const eventName =
          activation === "submit"
            ? "submit"
            : activation.startsWith("keyboard")
              ? "keydown"
              : "click";
        for (const el of guardedEls) {
          el.addEventListener(eventName, markFired, true); // capture
          el.addEventListener(eventName, markFired, false); // bubble
        }

        // --- mount the hook ------------------------------------------------
        const rootRef = {
          current: rootEl,
        } as React.RefObject<HTMLElement | null>;
        const onSelectBlock = vi.fn();
        const { unmount } = renderHook(() =>
          useNavigationNeutralizer({ rootRef, onSelectBlock }),
        );

        try {
          // --- dispatch the activation -----------------------------------
          let evt: Event;
          switch (activation) {
            case "click":
              evt = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
              });
              break;
            case "modified-click":
              evt = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                [modifier]: true,
              });
              break;
            case "keyboard-enter":
              evt = new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
                cancelable: true,
              });
              break;
            case "keyboard-space":
              evt = new KeyboardEvent("keydown", {
                key: " ",
                bubbles: true,
                cancelable: true,
              });
              break;
            case "submit":
            default:
              evt = new Event("submit", { bubbles: true, cancelable: true });
              break;
          }

          target.dispatchEvent(evt);

          // 1. The default action of the element (and, by stopPropagation, of
          //    every interactive ancestor) is prevented.
          expect(evt.defaultPrevented).toBe(true);
          expect(guardedFired).toBe(false);

          // 2. Exactly one block — the nearest data-puck-id ancestor — is
          //    selected, reported exactly once.
          expect(onSelectBlock).toHaveBeenCalledTimes(1);
          expect(onSelectBlock).toHaveBeenCalledWith(expectedId, expectedEl);
        } finally {
          unmount();
          rootEl.remove();
        }
      }),
      { numRuns: 100 },
    );
  });
});
