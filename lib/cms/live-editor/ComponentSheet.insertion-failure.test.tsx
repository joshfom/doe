// @vitest-environment jsdom
/**
 * Component-sheet insertion failure — edge / example test.
 *
 * Spec: live-page-editor — task 7.7
 * _Requirements: 6.10_
 *
 * Req 6.10: IF insertion of the selected component fails, THEN THE Live_Editor
 * SHALL leave the page content unchanged and display an error indication to the
 * user.
 *
 * The Component_Sheet delegates the actual Puck `insert` dispatch to the
 * shell-provided `onInsert(type)` (which owns the headless Puck store and, on a
 * throw, leaves `appState.data` unchanged and returns `false`). So from the
 * sheet's perspective, a "failed insertion" is `onInsert` resolving `false` OR
 * throwing. In both cases the sheet must surface the inline error indication
 * (`role="alert"`, `data-testid="live-component-sheet-error"`), and — because
 * the sheet never mutates the page content itself — the content owned by
 * `onInsert` must be left untouched.
 *
 * These edge tests model that contract directly: the test owns a `pageContent`
 * array and supplies an `onInsert` whose failure variants (resolve-`false` and
 * throw) leave that array unchanged. We then drive the real sheet — expand it,
 * click a palette item — and assert (1) the error indication appears, (2)
 * `onInsert` was invoked with the chosen type, and (3) the modelled page
 * content is unchanged. A success variant is included as a control to confirm
 * the error indication is NOT shown when insertion succeeds.
 *
 * `usePuckStore` is mocked to supply a minimal Puck config with a single
 * palette component (`Heading`), exactly as the search/coupling tests do. The
 * mock also sidesteps the transitive `@dnd-kit` module-scope access that
 * `use-puck-store` would otherwise pull in under jsdom.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock — a stable headless-Puck store double exposing only `config`, which is
// all ComponentSheet reads (`usePuckStore((s) => s.config)`). One registered
// palette component ("Heading") under a "blocks" category is enough to render a
// selectable palette item. Mocking this module also avoids the real
// use-puck-store → @puckeditor/core → @dnd-kit module-scope access in jsdom.
// ---------------------------------------------------------------------------
const puckMock = vi.hoisted(() => ({
  config: {
    categories: {
      blocks: { title: "Blocks", components: ["Heading"] },
    },
    components: {
      Heading: { label: "Heading" },
    },
  },
}));

vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: { config: unknown }) => unknown) =>
    selector({ config: puckMock.config }),
}));

import { ComponentSheet } from "./ComponentSheet";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Harness — render the sheet, expand it via the keyboard-accessible handle, and
// click a palette item, returning the test-owned page-content model so callers
// can assert it stays unchanged.
// ---------------------------------------------------------------------------

/**
 * Expand the collapsed sheet by activating its drag handle with the keyboard
 * (the handle toggles on Enter/Space; pointer events are reserved for dragging).
 */
function expandSheet(): void {
  const handle = screen.getByTestId("live-component-sheet-handle");
  fireEvent.keyDown(handle, { key: "Enter" });
}

describe("Feature: live-page-editor — ComponentSheet insertion failure (Req 6.10)", () => {
  it("surfaces the error indication and leaves page content unchanged when onInsert resolves false", async () => {
    // Modelled page content owned by `onInsert` (stands in for appState.data
    // .content). The failure path must NOT mutate it.
    const pageContent = [{ type: "Heading", props: { id: "block-1" } }];
    const snapshot = JSON.parse(JSON.stringify(pageContent));

    const onInsert = vi.fn((_type: string): boolean => {
      // Failed dispatch: leave the page content unchanged, report failure.
      return false;
    });

    render(<ComponentSheet selectedId="block-1" onInsert={onInsert} />);

    // No error indication before any insertion attempt.
    expect(screen.queryByTestId("live-component-sheet-error")).toBeNull();

    expandSheet();
    fireEvent.click(screen.getByTestId("live-component-sheet-item-Heading"));

    // (1) The inline error indication appears (role=alert).
    const error = await screen.findByTestId("live-component-sheet-error");
    expect(error.getAttribute("role")).toBe("alert");

    // (2) onInsert was invoked with the chosen component type.
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith("Heading");

    // (3) The page content is left unchanged (Req 6.10).
    expect(pageContent).toEqual(snapshot);
  });

  it("surfaces the error indication and leaves page content unchanged when onInsert throws", async () => {
    const pageContent = [{ type: "Heading", props: { id: "block-1" } }];
    const snapshot = JSON.parse(JSON.stringify(pageContent));

    const onInsert = vi.fn((_type: string): boolean => {
      // A throwing dispatch must not have mutated the content; the shell's
      // try/catch swallows it and the sheet surfaces the error indication.
      throw new Error("insert dispatch failed");
    });

    render(<ComponentSheet selectedId="block-1" onInsert={onInsert} />);

    expandSheet();
    fireEvent.click(screen.getByTestId("live-component-sheet-item-Heading"));

    const error = await screen.findByTestId("live-component-sheet-error");
    expect(error.getAttribute("role")).toBe("alert");

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith("Heading");

    // Page content untouched by the failed insertion (Req 6.10).
    expect(pageContent).toEqual(snapshot);
  });

  it("does NOT show the error indication when onInsert succeeds (control)", async () => {
    // Control: a successful insertion appends to the content and returns true,
    // so no error indication is shown — confirming the indicator is specific to
    // failure (Req 6.10) and not always present.
    const pageContent: Array<{ type: string; props: { id: string } }> = [
      { type: "Heading", props: { id: "block-1" } },
    ];

    const onInsert = vi.fn((type: string): boolean => {
      pageContent.push({ type, props: { id: "block-2" } });
      return true;
    });

    render(<ComponentSheet selectedId="block-1" onInsert={onInsert} />);

    expandSheet();
    fireEvent.click(screen.getByTestId("live-component-sheet-item-Heading"));

    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));

    // The content grew by one (the success path mutated the model)...
    expect(pageContent).toHaveLength(2);
    // ...and no error indication is present.
    expect(screen.queryByTestId("live-component-sheet-error")).toBeNull();
  });
});
