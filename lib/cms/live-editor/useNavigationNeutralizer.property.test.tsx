// @vitest-environment jsdom

/**
 * Property-based test for the navigation neutralizer.
 *
 * Spec: live-page-editor — task 5.2
 *
 * Feature: live-page-editor, Property 2: Activation is neutralized and selects
 * exactly one block
 *
 * For any element inside the editable page region that is NOT within
 * `data-inline-editor-ui`, activating it — via pointer click, modified pointer
 * click (Cmd/Ctrl/Shift/Alt), or keyboard activation (Enter/Space), including
 * form submission via a submit control or Enter — prevents the default action of
 * the element AND of every interactive ancestor (no navigation, new tab, button
 * default, or form submission occurs) and sets exactly one block (the nearest
 * `data-puck-id` ancestor) as the Selected_Block.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import React, { useRef } from "react";
import { render } from "@testing-library/react";

import { useNavigationNeutralizer } from "./useNavigationNeutralizer";
import { PUCK_ID_ATTR } from "@/lib/cms/inline-editor/useInlineSelection";

const PUCK_SELECTOR = `[${PUCK_ID_ATTR}]`;
// Mirror the hook's notion of "button-like" so the test computes the exact same
// set of activations the hook will neutralize.
const BUTTON_LIKE_SELECTOR =
  'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
const FORM_FIELD_SELECTOR = "input, select, textarea";

// ── Test harness ─────────────────────────────────────────────────────────────

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

interface BlockSpec {
  id: string;
  wrappers: WrapperKind[];
  leaf: LeafKind;
  hasForm: boolean;
  child?: BlockSpec;
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

// A leaf block (no further nesting) used as an optional nested child so the
// "nearest data-puck-id" resolution is exercised across block boundaries.
const leafBlockArb: fc.Arbitrary<BlockSpec> = fc.record({
  id: fc.uuid(),
  wrappers: fc.array(wrapperKindArb, { maxLength: 3 }),
  leaf: leafKindArb,
  hasForm: fc.boolean(),
});

const blockArb: fc.Arbitrary<BlockSpec> = fc.record({
  id: fc.uuid(),
  wrappers: fc.array(wrapperKindArb, { maxLength: 3 }),
  leaf: leafKindArb,
  hasForm: fc.boolean(),
  child: fc.option(leafBlockArb, { nil: undefined }),
});

const treeArb = fc.array(blockArb, { minLength: 1, maxLength: 3 });

interface Scenario {
  tree: BlockSpec[];
  targetSeed: number;
  activationSeed: number;
  mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  tree: treeArb,
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

function buildBlock(
  spec: BlockSpec,
  doc: Document,
  candidates: HTMLElement[],
): HTMLElement {
  const block = doc.createElement("div");
  block.setAttribute(PUCK_ID_ATTR, spec.id);

  // Nested interactive ancestor chain (outer → inner).
  let parent: HTMLElement = block;
  for (const w of spec.wrappers) {
    const el = createWrapper(w, doc);
    parent.appendChild(el);
    candidates.push(el);
    parent = el;
  }

  const leaf = createLeaf(spec.leaf, doc);
  parent.appendChild(leaf);
  candidates.push(leaf);

  if (spec.hasForm) {
    const form = doc.createElement("form");
    const input = doc.createElement("input");
    input.setAttribute("type", "text");
    const submit = doc.createElement("button");
    submit.setAttribute("type", "submit");
    submit.textContent = "submit";
    form.appendChild(input);
    form.appendChild(submit);
    block.appendChild(form);
    candidates.push(form, input, submit);
  }

  if (spec.child) {
    block.appendChild(buildBlock(spec.child, doc, candidates));
  }

  return block;
}

// ── Activation resolution (mirrors the hook so generation stays consistent) ───

type ActivationKind = "click" | "enter" | "space" | "submit";

function validActivations(el: Element): ActivationKind[] {
  const acts: ActivationKind[] = ["click"]; // every click is neutralized
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

describe("Feature: live-page-editor, Property 2: Activation is neutralized and selects exactly one block", () => {
  it("prevents default on any non-editor-UI activation and selects exactly the nearest data-puck-id block", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const onSelect = vi.fn<(id: string | null, el: HTMLElement | null) => void>();
        const openSpy = vi
          .spyOn(window, "open")
          .mockImplementation(() => null);

        const { container, unmount } = render(
          React.createElement(Harness, { onSelect }),
        );
        try {
          const root = container.querySelector(
            '[data-testid="neutralizer-root"]',
          ) as HTMLElement;
          expect(root).not.toBeNull();

          // Build the generated DOM tree and attach it under the root.
          const candidates: HTMLElement[] = [];
          for (const blockSpec of scenario.tree) {
            root.appendChild(buildBlock(blockSpec, document, candidates));
          }
          expect(candidates.length).toBeGreaterThan(0);

          // Pick a target element and a valid activation for it.
          const target =
            candidates[scenario.targetSeed % candidates.length];
          const acts = validActivations(target);
          const kind = acts[scenario.activationSeed % acts.length];

          // The nearest data-puck-id block is the source of truth (matches the
          // hook's findPuckIdFromTarget resolution).
          const expectedEl = target.closest(PUCK_SELECTOR) as HTMLElement | null;
          const expectedId = expectedEl?.getAttribute(PUCK_ID_ATTR) ?? null;
          expect(expectedId).not.toBeNull();

          const event = dispatchActivation(target, kind, scenario.mods);

          // (a) default of the element and every interactive ancestor is
          //     prevented — a single capture-phase preventDefault cancels the
          //     activation for the whole path (no navigation/new-tab/submit).
          expect(event.defaultPrevented).toBe(true);
          expect(openSpy).not.toHaveBeenCalled();

          // (b) exactly one block is selected: the nearest data-puck-id ancestor.
          expect(onSelect).toHaveBeenCalledTimes(1);
          expect(onSelect).toHaveBeenCalledWith(expectedId, expectedEl);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
