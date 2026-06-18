// @vitest-environment jsdom

/**
 * Property-based test for the navigation neutralizer's Editor-UI exemption.
 *
 * Spec: live-page-editor — task 5.3
 *
 * Feature: live-page-editor, Property 3: Editor-UI is exempt from neutralization
 *
 * For any element within a subtree marked `data-inline-editor-ui`, activating it
 * — via pointer click, modified pointer click (Cmd/Ctrl/Shift/Alt), keyboard
 * activation (Enter/Space), or form submission — does NOT have its default
 * action prevented (`event.defaultPrevented` stays false) and does NOT change
 * the current Selected_Block (`onSelectBlock` is never called). The exemption
 * holds even when the `data-inline-editor-ui` subtree is nested inside a
 * `data-puck-id` block, proving the exemption wins over block selection.
 *
 * **Validates: Requirements 4.7**
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import React, { useRef } from "react";
import { render } from "@testing-library/react";

import { useNavigationNeutralizer } from "./useNavigationNeutralizer";
import { PUCK_ID_ATTR } from "@/lib/cms/inline-editor/useInlineSelection";

// Mirror the hook's notion of "button-like" so the test computes the exact same
// set of activations the hook would (in the non-exempt case) neutralize.
const BUTTON_LIKE_SELECTOR =
  'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
const FORM_FIELD_SELECTOR = "input, select, textarea";

// ── Test harness (mirrors task 5.2) ──────────────────────────────────────────

/**
 * Mounts the hook with a real root element. The generated DOM tree is appended
 * into the root *after* mount; capture-phase listeners are bound on the root
 * itself, so they intercept descendant events regardless of when those
 * descendants were added.
 */
function Harness({
  onSelect,
}: {
  onSelect: (id: string | null, el: HTMLElement | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useNavigationNeutralizer({ rootRef, onSelectBlock: onSelect });
  return React.createElement("div", {
    ref: rootRef,
    "data-testid": "neutralizer-root",
  });
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

type WrapperKind = "a" | "button" | "role-button" | "tabindex";
type LeafKind = "span" | WrapperKind;

interface EditorUiSpec {
  /** Interactive ancestor chain (outer → inner) inside the editor-UI subtree. */
  wrappers: WrapperKind[];
  /** The activated leaf element. */
  leaf: LeafKind;
  /** Whether to also include a form (so submit/Enter activations are exercised). */
  hasForm: boolean;
}

interface Scenario {
  /** Optional block id wrapping the editor-UI subtree (exemption-wins case). */
  blockId: string | undefined;
  /**
   * Whether the `data-inline-editor-ui` marker sits on the outermost editor-UI
   * element or on an extra intermediate wrapper (the target is nested deeper
   * either way — `.closest()` must still find the marker).
   */
  markerDepth: number;
  ui: EditorUiSpec;
  targetSeed: number;
  activationSeed: number;
  mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
}

const wrapperKindArb = fc.constantFrom<WrapperKind>(
  "a",
  "button",
  "role-button",
  "tabindex",
);
const leafKindArb = fc.constantFrom<LeafKind>(
  "span",
  "a",
  "button",
  "role-button",
  "tabindex",
);

const uiArb: fc.Arbitrary<EditorUiSpec> = fc.record({
  wrappers: fc.array(wrapperKindArb, { maxLength: 3 }),
  leaf: leafKindArb,
  hasForm: fc.boolean(),
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  // Sometimes wrap the editor UI inside a data-puck-id block to prove the
  // exemption wins over selection; sometimes leave it free-floating.
  blockId: fc.option(fc.uuid(), { nil: undefined }),
  markerDepth: fc.nat({ max: 2 }),
  ui: uiArb,
  targetSeed: fc.nat(),
  activationSeed: fc.nat(),
  mods: fc.record({
    ctrlKey: fc.boolean(),
    metaKey: fc.boolean(),
    shiftKey: fc.boolean(),
    altKey: fc.boolean(),
  }),
});

// ── DOM construction ─────────────────────────────────────────────────────────

function createWrapper(kind: WrapperKind, doc: Document): HTMLElement {
  switch (kind) {
    case "a": {
      const a = doc.createElement("a");
      a.setAttribute("href", "https://example.com/landing");
      a.setAttribute("target", "_blank");
      a.textContent = "link";
      return a;
    }
    case "button": {
      const b = doc.createElement("button");
      b.textContent = "btn";
      return b;
    }
    case "role-button": {
      const d = doc.createElement("div");
      d.setAttribute("role", "button");
      d.setAttribute("tabindex", "0");
      return d;
    }
    case "tabindex": {
      const d = doc.createElement("div");
      d.setAttribute("tabindex", "0");
      return d;
    }
  }
}

function createLeaf(kind: LeafKind, doc: Document): HTMLElement {
  if (kind === "span") {
    const s = doc.createElement("span");
    s.textContent = "text";
    return s;
  }
  return createWrapper(kind, doc);
}

/**
 * Build a `data-inline-editor-ui` subtree, optionally wrapped in a
 * `data-puck-id` block. Returns the root to attach plus the list of activatable
 * elements inside the editor-UI subtree.
 */
function buildEditorUiTree(
  scenario: Scenario,
  doc: Document,
): { root: HTMLElement; candidates: HTMLElement[] } {
  const candidates: HTMLElement[] = [];

  // Optional intermediate wrappers ABOVE the marker so the marker may be placed
  // on a nested element (markerDepth>0) while the activated target is deeper.
  const outer = doc.createElement("div");
  let cursor: HTMLElement = outer;
  for (let i = 0; i < scenario.markerDepth; i++) {
    const w = doc.createElement("div");
    cursor.appendChild(w);
    cursor = w;
  }

  // The marked editor-UI container.
  const uiContainer = doc.createElement("div");
  uiContainer.setAttribute("data-inline-editor-ui", "");
  cursor.appendChild(uiContainer);

  // Interactive ancestor chain inside the editor UI.
  let parent: HTMLElement = uiContainer;
  for (const w of scenario.ui.wrappers) {
    const el = createWrapper(w, doc);
    parent.appendChild(el);
    candidates.push(el);
    parent = el;
  }

  const leaf = createLeaf(scenario.ui.leaf, doc);
  parent.appendChild(leaf);
  candidates.push(leaf);

  if (scenario.ui.hasForm) {
    const form = doc.createElement("form");
    const input = doc.createElement("input");
    input.setAttribute("type", "text");
    const submit = doc.createElement("button");
    submit.setAttribute("type", "submit");
    submit.textContent = "submit";
    form.appendChild(input);
    form.appendChild(submit);
    uiContainer.appendChild(form);
    candidates.push(form, input, submit);
  }

  // Optionally wrap everything in a data-puck-id block (exemption-wins case).
  if (scenario.blockId !== undefined) {
    const block = doc.createElement("div");
    block.setAttribute(PUCK_ID_ATTR, scenario.blockId);
    block.appendChild(outer);
    return { root: block, candidates };
  }

  return { root: outer, candidates };
}

// ── Activation resolution (mirrors the hook so generation stays consistent) ───

type ActivationKind = "click" | "enter" | "space" | "submit";

function validActivations(el: Element): ActivationKind[] {
  const acts: ActivationKind[] = ["click"]; // every click would be neutralized
  const buttonLike = el.closest(BUTTON_LIKE_SELECTOR);
  const anchor = el.closest("a");
  const formField = el.closest(FORM_FIELD_SELECTOR);
  const form = el.closest("form");

  if (buttonLike) {
    acts.push("enter", "space");
  } else if (anchor) {
    acts.push("enter");
  } else if (form && formField) {
    acts.push("enter");
  }

  if (el.tagName === "FORM") {
    acts.push("submit");
  }
  return acts;
}

function dispatchActivation(
  el: HTMLElement,
  kind: ActivationKind,
  mods: Scenario["mods"],
): Event {
  let event: Event;
  switch (kind) {
    case "click":
      event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...mods,
      });
      break;
    case "enter":
      event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      break;
    case "space":
      event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      break;
    case "submit":
      event = new Event("submit", { bubbles: true, cancelable: true });
      break;
  }
  el.dispatchEvent(event);
  return event;
}

// ── Property ─────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feature: live-page-editor, Property 3: Editor-UI is exempt from neutralization", () => {
  it("keeps default behavior and does not change selection for any activation inside a data-inline-editor-ui subtree", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const onSelect =
          vi.fn<(id: string | null, el: HTMLElement | null) => void>();

        const { container, unmount } = render(
          React.createElement(Harness, { onSelect }),
        );
        try {
          const root = container.querySelector(
            '[data-testid="neutralizer-root"]',
          ) as HTMLElement;
          expect(root).not.toBeNull();

          // Build the editor-UI subtree (optionally inside a puck block) and
          // attach it under the root.
          const { root: tree, candidates } = buildEditorUiTree(
            scenario,
            document,
          );
          root.appendChild(tree);
          expect(candidates.length).toBeGreaterThan(0);

          // Sanity: every candidate really is inside the editor-UI subtree.
          const target = candidates[scenario.targetSeed % candidates.length];
          expect(target.closest("[data-inline-editor-ui]")).not.toBeNull();

          const acts = validActivations(target);
          const kind = acts[scenario.activationSeed % acts.length];

          const event = dispatchActivation(target, kind, scenario.mods);

          // (a) The exemption allows default behavior: defaultPrevented stays
          //     false (the hook returned early without calling preventDefault).
          expect(event.defaultPrevented).toBe(false);

          // (b) The Selected_Block is unchanged: onSelectBlock is never called,
          //     even when the editor UI sits inside a data-puck-id block.
          expect(onSelect).not.toHaveBeenCalled();
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
