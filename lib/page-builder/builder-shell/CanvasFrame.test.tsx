// @vitest-environment jsdom

/**
 * CanvasFrame — presentational wrapper unit tests.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 3.4
 *
 * Verifies:
 * 1. Outer div has cream background from ORA_THEME.cream (#F5F3F0)
 * 2. Outer div has responsive padding CSS (contains `clamp(16px`)
 * 3. Inner div has 1px solid border using ORA_THEME.border
 * 4. Inner div has the subtle box shadow
 * 5. Inner div has white background from ORA_THEME.white
 * 6. Children are rendered inside the inner panel
 * 7. Outer div has overflow: auto (no horizontal scrollbar at wide widths)
 *
 * Since JSDOM doesn't compute CSS clamp() and normalizes hex to rgb(),
 * we use renderToStaticMarkup to verify raw style string values for
 * color tokens and the clamp expression. DOM-based tests via
 * @testing-library/react cover structural and overflow assertions.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasFrame } from "./CanvasFrame";
import { ORA_THEME } from "./inspector/tokens";

describe("CanvasFrame", () => {
  /** Static HTML output for raw style-string assertions. */
  const html = renderToStaticMarkup(
    <CanvasFrame>
      <span data-testid="child">Hello</span>
    </CanvasFrame>
  );

  it("renders children inside the inner panel", () => {
    render(
      <CanvasFrame>
        <p data-testid="child">Hello canvas</p>
      </CanvasFrame>
    );

    const child = screen.getByTestId("child");
    expect(child).toBeDefined();
    expect(child.textContent).toBe("Hello canvas");
  });

  describe("outer div (backdrop)", () => {
    it("has cream background color sourced from ORA_THEME.cream (#F5F3F0)", () => {
      // Verify the token value is correct
      expect(ORA_THEME.cream).toBe("#F5F3F0");
      // Verify the rendered style contains the token value
      expect(html).toContain(`background:${ORA_THEME.cream}`);
    });

    it("has responsive padding CSS containing clamp(16px", () => {
      // JSDOM drops clamp() entirely, so we verify via static markup
      expect(html).toContain("clamp(16px");
    });

    it("has overflow: auto to prevent horizontal scrollbar at wide widths", () => {
      const { container } = render(
        <CanvasFrame>
          <span>content</span>
        </CanvasFrame>
      );

      const outer = container.firstElementChild as HTMLElement;
      expect(outer.style.overflow).toBe("auto");
    });
  });

  describe("inner div (panel)", () => {
    it("has a 1px solid border using ORA_THEME.border", () => {
      expect(ORA_THEME.border).toBe("#E5E1DA");
      expect(html).toContain(`border:1px solid ${ORA_THEME.border}`);
    });

    it("has the subtle box shadow", () => {
      expect(html).toContain("box-shadow:0 2px 8px rgba(0,0,0,0.04)");
    });

    it("has white background from ORA_THEME.white", () => {
      expect(ORA_THEME.white).toBe("#FFFFFF");
      expect(html).toContain(`background:${ORA_THEME.white}`);
    });

    it("contains the rendered children", () => {
      const { container } = render(
        <CanvasFrame>
          <div data-testid="nested">Nested content</div>
        </CanvasFrame>
      );

      const outer = container.firstElementChild as HTMLElement;
      const inner = outer.firstElementChild as HTMLElement;
      expect(inner.querySelector('[data-testid="nested"]')).not.toBeNull();
    });
  });
});
