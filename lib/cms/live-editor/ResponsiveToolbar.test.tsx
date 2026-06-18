// @vitest-environment jsdom
/**
 * ResponsiveToolbar — example/edge tests (Task 6.2).
 *
 * Spec: live-page-editor.
 * _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7_
 *
 * These are example / edge-case tests (NOT property-based) covering the
 * floating responsive-size toolbar:
 *   - Floating-on-scroll: the root is `position: fixed` (Req 5.1).
 *   - Exactly three mutually-exclusive controls with accessible names (Req 5.2).
 *   - Default desktop active + `aria-pressed` indication on first load (Req 5.5).
 *   - Selecting an option invokes `setActiveBreakpoint` and moves `aria-pressed`
 *     to the chosen control; active/inactive states correct (Req 5.3, 5.6).
 *   - Unavailable breakpoint (no virtual width): the size is retained
 *     (`setActiveBreakpoint` NOT called), an error indication names the
 *     breakpoint, and `onUnavailableBreakpoint` fires (Req 5.7).
 *
 * Approach for the breakpoint context:
 *   `ResponsiveToolbar` reads `useBreakpoint()` from
 *   `@/lib/page-builder/breakpoint-context`. To assert the *exact*
 *   `setActiveBreakpoint` call (and its absence on the unavailable edge) we
 *   mock the hook with a spy whose implementation also updates a module-level
 *   active breakpoint, so a `rerender()` reflects the new pressed state — this
 *   mirrors how the real `useState`-backed `BreakpointProvider` would behave.
 *   The unavailable-breakpoint edge mocks `PREVIEW_VIRTUAL_WIDTHS` from
 *   `@/lib/cms/live-editor/PreviewStage` so one breakpoint has no numeric width.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Breakpoint } from "@/lib/page-builder/breakpoint-context";

// ── Hoisted mock state ───────────────────────────────────────────────────────
// `vi.mock` factories are hoisted above module-scope variables, so the mutable
// state they reference must be created via `vi.hoisted`.
const mocks = vi.hoisted(() => ({
  // A spy setter that also drives the active breakpoint so a manual rerender
  // re-reads the updated pressed state (matching the real provider).
  setActiveBreakpoint: vi.fn<(bp: string) => void>(),
  activeBreakpoint: "desktop" as string,
  // Mutable so the unavailable-breakpoint test can omit a breakpoint's width.
  virtualWidths: { desktop: 1440, tablet: 834, mobile: 390 } as Record<
    string,
    number | undefined
  >,
}));

// ── Mocked breakpoint context ────────────────────────────────────────────────
vi.mock("@/lib/page-builder/breakpoint-context", () => ({
  useBreakpoint: () => ({
    activeBreakpoint: mocks.activeBreakpoint,
    setActiveBreakpoint: mocks.setActiveBreakpoint,
  }),
}));

// ── Mocked preview virtual widths ────────────────────────────────────────────
vi.mock("@/lib/cms/live-editor/PreviewStage", () => ({
  PREVIEW_VIRTUAL_WIDTHS: mocks.virtualWidths,
}));

// Import AFTER the mocks are registered.
import { ResponsiveToolbar } from "./ResponsiveToolbar";

const BREAKPOINTS: Breakpoint[] = ["desktop", "tablet", "mobile"];

function getControl(name: RegExp) {
  return screen.getByRole("button", { name });
}

function pressedState(): Record<Breakpoint, boolean> {
  const group = screen.getByRole("group", { name: /preview size/i });
  const buttons = within(group).getAllByRole("button");
  const result = {} as Record<Breakpoint, boolean>;
  for (const bp of BREAKPOINTS) {
    const btn = buttons.find((b) =>
      new RegExp(bp, "i").test(b.getAttribute("aria-label") ?? ""),
    )!;
    result[bp] = btn.getAttribute("aria-pressed") === "true";
  }
  return result;
}

beforeEach(() => {
  // Reset active breakpoint, spy, and virtual widths between tests.
  mocks.activeBreakpoint = "desktop";
  mocks.setActiveBreakpoint.mockReset();
  // Default behavior: a successful set updates the active breakpoint.
  mocks.setActiveBreakpoint.mockImplementation((bp: string) => {
    mocks.activeBreakpoint = bp;
  });
  mocks.virtualWidths.desktop = 1440;
  mocks.virtualWidths.tablet = 834;
  mocks.virtualWidths.mobile = 390;
});

describe("ResponsiveToolbar", () => {
  it("renders as a floating (position: fixed) control that stays visible on scroll (Req 5.1)", () => {
    render(<ResponsiveToolbar />);

    const root = screen.getByTestId("live-responsive-toolbar");
    expect(root.style.position).toBe("fixed");
  });

  it("provides exactly three mutually-exclusive controls with accessible names (Req 5.2)", () => {
    render(<ResponsiveToolbar />);

    const group = screen.getByRole("group", { name: /preview size/i });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(3);

    // Each control exposes a non-empty accessible name for its breakpoint.
    expect(getControl(/desktop/i)).toBeTruthy();
    expect(getControl(/tablet/i)).toBeTruthy();
    expect(getControl(/mobile/i)).toBeTruthy();

    // Mutually exclusive: exactly one control is pressed at any time.
    const pressed = pressedState();
    const activeCount = BREAKPOINTS.filter((bp) => pressed[bp]).length;
    expect(activeCount).toBe(1);
  });

  it("defaults to desktop active with aria-pressed indication on first load (Req 5.5)", () => {
    render(<ResponsiveToolbar />);

    const pressed = pressedState();
    expect(pressed.desktop).toBe(true);
    expect(pressed.tablet).toBe(false);
    expect(pressed.mobile).toBe(false);
  });

  it("selecting an option invokes setActiveBreakpoint and moves the active indication (Req 5.3, 5.6)", () => {
    const { rerender } = render(<ResponsiveToolbar />);

    fireEvent.click(getControl(/tablet/i));

    // The selection drives setActiveBreakpoint with the chosen breakpoint.
    expect(mocks.setActiveBreakpoint).toHaveBeenCalledTimes(1);
    expect(mocks.setActiveBreakpoint).toHaveBeenCalledWith("tablet");

    // Re-render reflects the updated active breakpoint (as the real provider would).
    rerender(<ResponsiveToolbar />);

    const pressed = pressedState();
    expect(pressed.tablet).toBe(true);
    expect(pressed.desktop).toBe(false);
    expect(pressed.mobile).toBe(false);

    // Still mutually exclusive after the change.
    const activeCount = BREAKPOINTS.filter((bp) => pressed[bp]).length;
    expect(activeCount).toBe(1);
  });

  it("does not re-fire setActiveBreakpoint when selecting the already-active control (Req 5.6)", () => {
    render(<ResponsiveToolbar />);

    fireEvent.click(getControl(/desktop/i));
    expect(mocks.setActiveBreakpoint).not.toHaveBeenCalled();
  });

  it("retains the current size and surfaces a named error when the breakpoint has no virtual width (Req 5.7)", () => {
    // Tablet has no defined virtual width → it cannot be previewed.
    mocks.virtualWidths.tablet = undefined;
    const onUnavailableBreakpoint = vi.fn();

    const { rerender } = render(
      <ResponsiveToolbar onUnavailableBreakpoint={onUnavailableBreakpoint} />,
    );

    fireEvent.click(getControl(/tablet/i));

    // Size is retained: setActiveBreakpoint is NOT called for the unavailable bp.
    expect(mocks.setActiveBreakpoint).not.toHaveBeenCalled();

    // The unavailable-breakpoint callback fires identifying the breakpoint.
    expect(onUnavailableBreakpoint).toHaveBeenCalledTimes(1);
    expect(onUnavailableBreakpoint).toHaveBeenCalledWith("tablet");

    rerender(
      <ResponsiveToolbar onUnavailableBreakpoint={onUnavailableBreakpoint} />,
    );

    // An error indication is shown and names the unavailable breakpoint.
    const error = screen.getByRole("alert");
    expect(error).toBeTruthy();
    expect(error.textContent).toMatch(/tablet/i);

    // The active selection is retained on desktop (size not changed).
    const pressed = pressedState();
    expect(pressed.desktop).toBe(true);
    expect(pressed.tablet).toBe(false);
  });

  it("recovers to a normal selection after an unavailable-breakpoint error (Req 5.3, 5.7)", () => {
    mocks.virtualWidths.tablet = undefined;

    const { rerender } = render(<ResponsiveToolbar />);

    // First, an unavailable selection surfaces the error.
    fireEvent.click(getControl(/tablet/i));
    rerender(<ResponsiveToolbar />);
    expect(screen.queryByRole("alert")).not.toBeNull();

    // Selecting an available breakpoint clears the error and updates the size.
    fireEvent.click(getControl(/mobile/i));
    expect(mocks.setActiveBreakpoint).toHaveBeenCalledWith("mobile");

    rerender(<ResponsiveToolbar />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(pressedState().mobile).toBe(true);
  });
});
