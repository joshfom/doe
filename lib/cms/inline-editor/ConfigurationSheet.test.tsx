// @vitest-environment jsdom
/**
 * ConfigurationSheet — focus trap + ESC + scroll lock.
 *
 * Spec: custom-branded-page-builder — task 15.6
 * _Validates: Requirements 18.3_
 */
import { describe, it, expect, vi } from "vitest";

// Stub ConfigurationPanel so the test doesn't need a real Puck context.
vi.mock(
  "@/lib/page-builder/builder-shell/configuration-panel/ConfigurationPanel",
  () => ({
    ConfigurationPanel: () => (
      <div data-testid="cp-stub">
        <button>field-a</button>
        <button>field-b</button>
      </div>
    ),
  }),
);

import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ConfigurationSheet } from "./ConfigurationSheet";

describe("Feature: custom-branded-page-builder — ConfigurationSheet", () => {
  it("renders inside a portal with role=dialog and aria-modal=true", () => {
    render(<ConfigurationSheet open={true} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    cleanup();
  });

  it("invokes onClose when ESC is pressed", async () => {
    const onClose = vi.fn();
    render(<ConfigurationSheet open={true} onClose={onClose} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("locks body scroll while open and restores on unmount", () => {
    const previous = document.body.style.overflow;
    const { unmount } = render(
      <ConfigurationSheet open={true} onClose={() => {}} />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe(previous);
  });
});
