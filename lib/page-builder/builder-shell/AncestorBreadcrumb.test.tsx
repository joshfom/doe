// @vitest-environment jsdom

/**
 * AncestorBreadcrumb — unit tests.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 4.5
 *
 * Verifies:
 * 1. Renders a `<nav>` with `aria-label="Ancestor breadcrumb"`
 * 2. Renders an `<ol>` inside the nav
 * 3. Each segment renders as a `<button type="button">` with the segment's label
 * 4. Segments are separated by `›` characters
 * 5. The rightmost segment has `aria-current="true"`
 * 6. The rightmost segment does NOT call `onSelect` when clicked
 * 7. Non-rightmost segments call `onSelect(segment.selector)` when clicked
 * 8. Returns null when segments array is empty
 * 9. Truncation: when more than 3 segments and container is narrow, middle segments collapse to `…`
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AncestorBreadcrumb } from "./AncestorBreadcrumb";
import type { AncestorSegment } from "./page-tree";

// ─── Test Data ───────────────────────────────────────────────────────────────

const mockSegments: AncestorSegment[] = [
  { id: null, label: "Page", selector: null },
  { id: "section-1", label: "Hero Section", selector: { zone: "root:default-zone", index: 0 } },
  { id: "columns-1", label: "Columns", selector: { zone: "section-1:content", index: 0 } },
];

const singleSegment: AncestorSegment[] = [
  { id: null, label: "Page", selector: null },
];

const fiveSegments: AncestorSegment[] = [
  { id: null, label: "Page", selector: null },
  { id: "section-1", label: "Hero Section", selector: { zone: "root:default-zone", index: 0 } },
  { id: "columns-1", label: "Columns", selector: { zone: "section-1:content", index: 0 } },
  { id: "col-1", label: "Column 1", selector: { zone: "columns-1:items", index: 0 } },
  { id: "text-1", label: "Text Block", selector: { zone: "col-1:content", index: 0 } },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AncestorBreadcrumb", () => {
  it("renders a <nav> with aria-label='Ancestor breadcrumb'", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });
    expect(nav).toBeDefined();
    expect(nav.tagName).toBe("NAV");
  });

  it("renders an <ol> inside the nav", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });
    const ol = nav.querySelector("ol");
    expect(ol).not.toBeNull();
  });

  it("each segment renders as a <button type='button'> with the segment's label as text", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe("Page");
    expect(buttons[1].textContent).toBe("Hero Section");
    expect(buttons[2].textContent).toBe("Columns");

    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("segments are separated by › characters", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });
    const separators = nav.querySelectorAll('[aria-hidden="true"]');

    // Each separator pair (li + span) contributes one ›. With 3 segments, there are 2 separators.
    const separatorTexts = Array.from(separators)
      .map((el) => el.textContent)
      .filter((text) => text?.includes("›"));
    expect(separatorTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("the rightmost segment has aria-current='true'", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    const lastButton = buttons[buttons.length - 1];
    expect(lastButton.getAttribute("aria-current")).toBe("true");

    // Other buttons should NOT have aria-current
    for (let i = 0; i < buttons.length - 1; i++) {
      expect(buttons[i].getAttribute("aria-current")).toBeNull();
    }
  });

  it("the rightmost segment does NOT call onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={onSelect} />);

    const buttons = screen.getAllByRole("button");
    const lastButton = buttons[buttons.length - 1];
    fireEvent.click(lastButton);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("non-rightmost segments call onSelect(segment.selector) when clicked", () => {
    const onSelect = vi.fn();
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={onSelect} />);

    const buttons = screen.getAllByRole("button");

    // Click "Page" (selector: null, id: null)
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith(null, null);

    // Click "Hero Section" (selector: { zone: "root:default-zone", index: 0 }, id: "section-1")
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith({ zone: "root:default-zone", index: 0 }, "section-1");

    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("returns null when segments array is empty", () => {
    const { container } = render(
      <AncestorBreadcrumb segments={[]} onSelect={vi.fn()} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders a single segment correctly with aria-current", () => {
    render(<AncestorBreadcrumb segments={singleSegment} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Page");
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
  });

  describe("truncation", () => {
    it("when more than 3 segments and container is narrow, middle segments collapse to …", () => {
      // We can't easily trigger ResizeObserver in JSDOM, but we can verify
      // the truncation logic by testing the component with a mocked narrow state.
      // The truncateSegments function collapses middle segments when > 3 segments.
      // We'll render with 5 segments and manually trigger the ResizeObserver callback.

      // Mock ResizeObserver to immediately report a narrow width
      const originalResizeObserver = globalThis.ResizeObserver;
      let observeCallback: ResizeObserverCallback | null = null;

      globalThis.ResizeObserver = class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          observeCallback = cb;
        }
        observe(target: Element) {
          // Simulate a narrow container width
          if (observeCallback) {
            observeCallback(
              [{ contentRect: { width: 200 } } as unknown as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            );
          }
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;

      render(
        <AncestorBreadcrumb
          segments={fiveSegments}
          truncateBelowWidthPx={480}
          onSelect={vi.fn()}
        />,
      );

      // With truncation active, we should see: Page, …, Column 1, Text Block
      // (first + ellipsis + last two)
      const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });
      const textContent = nav.textContent ?? "";
      expect(textContent).toContain("…");
      expect(textContent).toContain("Page");
      expect(textContent).toContain("Text Block");
      expect(textContent).toContain("Column 1");

      // Middle segments should be collapsed
      expect(textContent).not.toContain("Hero Section");
      expect(textContent).not.toContain("Columns");

      // Restore
      globalThis.ResizeObserver = originalResizeObserver;
    });

    it("does not truncate when container is wide enough", () => {
      const originalResizeObserver = globalThis.ResizeObserver;
      let observeCallback: ResizeObserverCallback | null = null;

      globalThis.ResizeObserver = class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          observeCallback = cb;
        }
        observe(target: Element) {
          // Simulate a wide container
          if (observeCallback) {
            observeCallback(
              [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            );
          }
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;

      render(
        <AncestorBreadcrumb
          segments={fiveSegments}
          truncateBelowWidthPx={480}
          onSelect={vi.fn()}
        />,
      );

      // All segments should be visible
      const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });
      const textContent = nav.textContent ?? "";
      expect(textContent).toContain("Page");
      expect(textContent).toContain("Hero Section");
      expect(textContent).toContain("Columns");
      expect(textContent).toContain("Column 1");
      expect(textContent).toContain("Text Block");
      expect(textContent).not.toContain("…");

      // Restore
      globalThis.ResizeObserver = originalResizeObserver;
    });

    it("does not truncate when 3 or fewer segments regardless of width", () => {
      const originalResizeObserver = globalThis.ResizeObserver;

      globalThis.ResizeObserver = class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          // Immediately report narrow width
          setTimeout(() => {
            cb(
              [{ contentRect: { width: 100 } } as unknown as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            );
          }, 0);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;

      render(
        <AncestorBreadcrumb
          segments={mockSegments}
          truncateBelowWidthPx={480}
          onSelect={vi.fn()}
        />,
      );

      // With only 3 segments, truncation should not apply even if narrow
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(3);

      // Restore
      globalThis.ResizeObserver = originalResizeObserver;
    });
  });
});
