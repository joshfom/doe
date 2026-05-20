import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ElementHeader } from "./ElementHeader";

/**
 * Unit tests for ElementHeader toolbar positioning logic.
 *
 * Validates: Requirements 2.3
 *
 * The toolbar position is computed as:
 *   top = Math.max(MIN_TOP, rect.top - OFFSET_ABOVE_ANCHOR)
 * where MIN_TOP = 60 and OFFSET_ABOVE_ANCHOR = 32.
 *
 * Test case 1: block flush with viewport top (rect.top = 0) → clamped to 60
 * Test case 2: block below the fold (rect.top = 200) → 200 - 32 = 168
 */

function createAnchorEl(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-puck-component", "test-block");
  el.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    right: 800,
    bottom: 100,
    width: 800,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  });
  document.body.appendChild(el);
  return el;
}

const defaultProps = {
  itemId: "test-block-1",
  label: "Heading",
  canMoveUp: true,
  canMoveDown: true,
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
};

describe("ElementHeader toolbar positioning", () => {
  beforeEach(() => {
    // Ensure clean DOM for portal rendering
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("renders toolbar at top: 60 when block is flush with viewport top (rect.top = 0)", () => {
    const anchorEl = createAnchorEl({ top: 0, left: 50, width: 800 });

    render(<ElementHeader {...defaultProps} anchorEl={anchorEl} />);

    const toolbar = document.querySelector("[data-element-header]") as HTMLElement;
    expect(toolbar).not.toBeNull();
    // Math.max(60, 0 - 32) = Math.max(60, -32) = 60
    expect(toolbar.style.top).toBe("60px");
  });

  it("renders toolbar at correct position when block is below the fold (rect.top = 200)", () => {
    const anchorEl = createAnchorEl({ top: 200, left: 100, width: 600 });

    render(<ElementHeader {...defaultProps} anchorEl={anchorEl} />);

    const toolbar = document.querySelector("[data-element-header]") as HTMLElement;
    expect(toolbar).not.toBeNull();
    // Math.max(60, 200 - 32) = Math.max(60, 168) = 168
    expect(toolbar.style.top).toBe("168px");
  });
});
