// @vitest-environment jsdom
/**
 * BreakpointSwitcher — task 10.5.
 * Validates: Property 6, Requirements 12.4 (default to desktop).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { BreakpointSwitcher } from "./BreakpointSwitcher";
import { BreakpointProvider, useBreakpoint } from "../breakpoint-context";

function Probe() {
  const { activeBreakpoint } = useBreakpoint();
  return <span data-testid="probe">{activeBreakpoint}</span>;
}

describe("BreakpointSwitcher", () => {
  it("defaults to desktop on a fresh session", () => {
    render(
      <BreakpointProvider>
        <BreakpointSwitcher />
        <Probe />
      </BreakpointProvider>,
    );

    expect(screen.getByTestId("probe").textContent).toBe("desktop");
    const desktopBtn = screen.getByRole("button", { name: /desktop/i });
    expect(desktopBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the active breakpoint on click", () => {
    render(
      <BreakpointProvider>
        <BreakpointSwitcher />
        <Probe />
      </BreakpointProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /mobile/i }));
    expect(screen.getByTestId("probe").textContent).toBe("mobile");

    fireEvent.click(screen.getByRole("button", { name: /tablet/i }));
    expect(screen.getByTestId("probe").textContent).toBe("tablet");
  });

  it("invokes onChange callback when the breakpoint changes", () => {
    const onChange = vi.fn();
    render(
      <BreakpointProvider>
        <BreakpointSwitcher onChange={onChange} />
      </BreakpointProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /tablet/i }));
    expect(onChange).toHaveBeenCalledWith("tablet");

    // Clicking the already-active option must not re-fire onChange.
    fireEvent.click(screen.getByRole("button", { name: /tablet/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
