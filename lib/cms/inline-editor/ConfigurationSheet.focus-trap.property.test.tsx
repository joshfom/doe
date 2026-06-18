// @vitest-environment jsdom
/**
 * Configuration-sheet focus trap cycles — Property 11.
 *
 * Spec: live-page-editor — task 13.2
 * _Validates: Requirements 10.5_
 *
 * The open Configuration_Sheet traps keyboard focus among its focusable
 * descendants so Tab/Shift+Tab cycle without ever escaping the sheet:
 *   - With focus on the LAST focusable control, a Tab keydown wraps focus to
 *     the FIRST focusable control.
 *   - With focus on the FIRST focusable control, a Shift+Tab keydown wraps focus
 *     to the LAST focusable control.
 *   - After either wrap, focus remains inside the open sheet (it never leaves).
 *
 * This drives the *actual* `ConfigurationSheet` focus-trap keydown handler. The
 * heavy admin `ConfigurationPanel` is replaced with a double that renders a
 * generated, varying sequence of focusable controls (button / input / textarea
 * / select / [tabindex]) so the property genuinely exercises differing control
 * counts and types. framer-motion is stubbed so the portal sheet mounts
 * synchronously while preserving refs, roles, aria, data-* and handlers.
 *
 * Note: the sheet's own header close button is always the first focusable in DOM
 * order, followed by the generated controls — so "first focusable" is the close
 * button and "last focusable" is the final generated control. The trap cycles
 * over the full set, which is exactly what Req 10.5 requires.
 *
 * Tag: Feature: live-page-editor, Property 11: Configuration-sheet focus trap
 * cycles — Tab on last control moves to first, Shift+Tab on first moves to last;
 * focus never leaves the open sheet.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type ControlType = "button" | "input" | "textarea" | "select" | "tabindex";

// Hoisted holder the ConfigurationPanel double reads from. The test sets the
// generated control sequence here before each render so the (module-static)
// mock can render a varying set of focusable controls per fast-check iteration.
const panel = vi.hoisted(() => ({ controls: [] as ControlType[] }));

vi.mock(
  "@/lib/page-builder/builder-shell/configuration-panel/ConfigurationPanel",
  () => ({
    ConfigurationPanel: () => {
      const render = (type: ControlType, i: number) => {
        switch (type) {
          case "button":
            return (
              <button key={i} type="button" data-ctrl={i}>
                btn {i}
              </button>
            );
          case "input":
            return <input key={i} data-ctrl={i} defaultValue={`in-${i}`} />;
          case "textarea":
            return <textarea key={i} data-ctrl={i} defaultValue={`ta-${i}`} />;
          case "select":
            return (
              <select key={i} data-ctrl={i} defaultValue="a">
                <option value="a">a</option>
                <option value="b">b</option>
              </select>
            );
          case "tabindex":
            return (
              <span key={i} tabIndex={0} data-ctrl={i}>
                span {i}
              </span>
            );
        }
      };
      return (
        <div data-testid="cp-stub">
          {panel.controls.map((type, i) => render(type, i))}
        </div>
      );
    },
  }),
);

// Stub framer-motion so the portal sheet mounts/unmounts synchronously (no exit
// animation to await) while preserving refs, roles, aria, data-* and handlers.
vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const R =
    (ReactMod as unknown as { default?: typeof React }).default ?? ReactMod;
  const FRAMER_ONLY = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
    "whileFocus",
    "layout",
    "layoutId",
  ]);
  const make = (tag: string) =>
    R.forwardRef(function MotionMock(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        if (key === "children" || FRAMER_ONLY.has(key)) continue;
        clean[key] = props[key];
      }
      return R.createElement(
        tag,
        { ...clean, ref },
        props.children as React.ReactNode,
      );
    });
  const motion = new Proxy(
    {},
    { get: (_t, tag: string) => make(typeof tag === "string" ? tag : "div") },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
  };
});

import { ConfigurationSheet } from "./ConfigurationSheet";

// Same selector the sheet uses internally to enumerate focusable descendants.
const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

afterEach(() => {
  cleanup();
  panel.controls = [];
});

// ---------------------------------------------------------------------------
// Generators — non-empty sequences of varied focusable controls.
// ---------------------------------------------------------------------------

const controlArb = fc.constantFrom<ControlType>(
  "button",
  "input",
  "textarea",
  "select",
  "tabindex",
);
const controlsArb = fc.array(controlArb, { minLength: 1, maxLength: 8 });

describe("Feature: live-page-editor — Property 11: Configuration-sheet focus trap cycles", () => {
  it("Tab on last focusable wraps to first, Shift+Tab on first wraps to last, and focus never leaves the open sheet", () => {
    fc.assert(
      fc.property(controlsArb, (controls) => {
        panel.controls = controls;

        const view = render(
          <ConfigurationSheet open={true} onClose={() => {}} />,
        );

        try {
          const sheet = document.querySelector<HTMLElement>(
            '[data-testid="inline-config-sheet"]',
          );
          expect(sheet).not.toBeNull();

          const focusables = Array.from(
            sheet!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
          );

          // The header close button + the generated controls → always ≥ 2, so
          // first and last are distinct and wrapping is observable.
          expect(focusables.length).toBeGreaterThanOrEqual(2);

          const first = focusables[0];
          const last = focusables[focusables.length - 1];

          // --- Tab on the last control wraps focus to the first ------------
          act(() => {
            last.focus();
          });
          expect(document.activeElement).toBe(last);

          act(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Tab",
                shiftKey: false,
                bubbles: true,
              }),
            );
          });
          expect(document.activeElement).toBe(first);
          // Focus never leaves the open sheet.
          expect(sheet!.contains(document.activeElement)).toBe(true);

          // --- Shift+Tab on the first control wraps focus to the last ------
          act(() => {
            first.focus();
          });
          expect(document.activeElement).toBe(first);

          act(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Tab",
                shiftKey: true,
                bubbles: true,
              }),
            );
          });
          expect(document.activeElement).toBe(last);
          // Focus never leaves the open sheet.
          expect(sheet!.contains(document.activeElement)).toBe(true);
        } finally {
          view.unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
