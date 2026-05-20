// @vitest-environment jsdom

/**
 * AncestorBreadcrumb — accessibility tests.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 4.5
 *
 * Verifies:
 * 1. Has a `<nav>` landmark with proper aria-label
 * 2. Each segment is a semantic `<button>` element
 * 3. Buttons have accessible names equal to segment labels
 * 4. Active segment has `aria-current="true"`
 * 5. Separator `›` is hidden from assistive technology (`aria-hidden="true"`)
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AncestorBreadcrumb } from "./AncestorBreadcrumb";
import type { AncestorSegment } from "./page-tree";

// ─── Test Data ───────────────────────────────────────────────────────────────

const mockSegments: AncestorSegment[] = [
  { id: null, label: "Page", selector: null },
  { id: "section-1", label: "Hero Section", selector: { zone: "root:default-zone", index: 0 } },
  { id: "text-1", label: "Text Block", selector: { zone: "section-1:content", index: 0 } },
];

// ─── Accessibility Tests ─────────────────────────────────────────────────────

describe("AncestorBreadcrumb — accessibility", () => {
  it("has a <nav> landmark with proper aria-label", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });
    expect(nav).toBeDefined();
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Ancestor breadcrumb");
  });

  it("each segment is a semantic <button> element", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(mockSegments.length);

    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("buttons have accessible names equal to segment labels", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    for (const segment of mockSegments) {
      const button = screen.getByRole("button", { name: segment.label });
      expect(button).toBeDefined();
      expect(button.textContent).toBe(segment.label);
    }
  });

  it("active segment has aria-current='true'", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    // The last segment ("Text Block") should be the active one
    const activeButton = screen.getByRole("button", { name: "Text Block" });
    expect(activeButton.getAttribute("aria-current")).toBe("true");

    // Other segments should NOT have aria-current
    const pageButton = screen.getByRole("button", { name: "Page" });
    const sectionButton = screen.getByRole("button", { name: "Hero Section" });
    expect(pageButton.getAttribute("aria-current")).toBeNull();
    expect(sectionButton.getAttribute("aria-current")).toBeNull();
  });

  it("separator › is hidden from assistive technology (aria-hidden='true')", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });

    // Find all elements containing the › separator
    const allElements = nav.querySelectorAll("*");
    const separatorElements: Element[] = [];

    allElements.forEach((el) => {
      if (el.textContent === "›" && el.children.length === 0) {
        separatorElements.push(el);
      }
    });

    expect(separatorElements.length).toBeGreaterThan(0);

    // Each separator or its parent li should have aria-hidden="true"
    for (const sep of separatorElements) {
      const hasAriaHidden =
        sep.getAttribute("aria-hidden") === "true" ||
        sep.closest('[aria-hidden="true"]') !== null;
      expect(
        hasAriaHidden,
        `Separator element should be hidden from assistive technology: ${sep.outerHTML}`,
      ).toBe(true);
    }
  });

  it("separator elements are not exposed as list items to assistive technology", () => {
    render(<AncestorBreadcrumb segments={mockSegments} onSelect={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Ancestor breadcrumb" });

    // The separator <li> elements should have aria-hidden="true"
    // so they are not counted as list items by screen readers
    const listItems = nav.querySelectorAll("li");
    const hiddenListItems = nav.querySelectorAll('li[aria-hidden="true"]');

    // With 3 segments, there should be 2 separator <li> elements that are hidden
    // and 3 visible <li> elements containing the buttons
    expect(hiddenListItems.length).toBe(mockSegments.length - 1);
  });
});
