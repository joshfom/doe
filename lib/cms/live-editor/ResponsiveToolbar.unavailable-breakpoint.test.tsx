// @vitest-environment jsdom
/**
 * ResponsiveToolbar — unavailable-breakpoint edge case.
 *
 * Spec: live-page-editor — task 6.2
 * _Requirements: 5.7_
 *
 * Req 5.7: IF the selected breakpoint has no virtual width defined in the
 * Breakpoint_System, THEN the Live_Editor SHALL retain the current preview
 * size and display an error indication identifying the unavailable breakpoint.
 *
 * In the real Breakpoint_System all three tiers always have a virtual width, so
 * the only way to exercise this defensive guard is to simulate an unavailable
 * breakpoint. The toolbar reads `VIRTUAL_WIDTHS` from `./PreviewStage`
 * (a single shared source of truth), so we mock that module to omit one tier
 * (`mobile`) and assert the guard behavior, following the repo's
 * `vi.mock(..., importOriginal)` pattern.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// Mock the shared virtual-width map to omit `mobile`, making that breakpoint
// "unavailable" from the toolbar's point of view while keeping desktop/tablet.
vi.mock("./PreviewStage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    VIRTUAL_WIDTHS: { desktop: 1440, tablet: 834 },
  };
});

import { BreakpointProvider } from "@/lib/page-builder/breakpoint-context";

import { ResponsiveToolbar } from "./ResponsiveToolbar";

afterEach(() => {
  cleanup();
});

function renderToolbar(props: Parameters<typeof ResponsiveToolbar>[0] = {}) {
  return render(
    <BreakpointProvider initial="desktop">
      <ResponsiveToolbar {...props} />
    </BreakpointProvider>,
  );
}

function controlByName(name: string): HTMLButtonElement {
  const group = screen.getByRole("group", { name: "Preview size" });
  return within(group).getByRole("button", { name }) as HTMLButtonElement;
}

describe("ResponsiveToolbar — unavailable breakpoint (Req 5.7)", () => {
  it("retains the current size when selecting a breakpoint with no virtual width", () => {
    renderToolbar();

    // Desktop is active. Selecting the unavailable mobile tier must NOT switch.
    expect(controlByName("Desktop").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(controlByName("Mobile"));

    // Size retained: desktop is still the active selection, mobile is not.
    expect(controlByName("Desktop").getAttribute("aria-pressed")).toBe("true");
    expect(controlByName("Mobile").getAttribute("aria-pressed")).toBe("false");
  });

  it("displays an error indication that names the unavailable breakpoint", () => {
    renderToolbar();

    expect(screen.queryByTestId("live-responsive-toolbar-error")).toBeNull();

    fireEvent.click(controlByName("Mobile"));

    const error = screen.getByTestId("live-responsive-toolbar-error");
    expect(error.getAttribute("role")).toBe("alert");
    // The indication identifies which breakpoint was unavailable.
    expect(error.textContent).toContain("Mobile");
  });

  it("reports the unavailable breakpoint via onUnavailableBreakpoint", () => {
    const onUnavailableBreakpoint = vi.fn();
    renderToolbar({ onUnavailableBreakpoint });

    fireEvent.click(controlByName("Mobile"));

    expect(onUnavailableBreakpoint).toHaveBeenCalledTimes(1);
    expect(onUnavailableBreakpoint).toHaveBeenCalledWith("mobile");
  });

  it("still switches to an available breakpoint and clears a prior error", () => {
    renderToolbar();

    // Trigger the unavailable error first.
    fireEvent.click(controlByName("Mobile"));
    expect(screen.getByTestId("live-responsive-toolbar-error")).toBeTruthy();

    // Tablet is available (still in the mocked map) — switching succeeds and
    // clears the error indication.
    fireEvent.click(controlByName("Tablet"));

    expect(controlByName("Tablet").getAttribute("aria-pressed")).toBe("true");
    expect(controlByName("Desktop").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("live-responsive-toolbar-error")).toBeNull();
  });
});
