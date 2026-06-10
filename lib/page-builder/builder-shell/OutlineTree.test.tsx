// @vitest-environment jsdom

/**
 * OutlineTree — unit tests.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 5.7
 *
 * Verifies:
 * 1. Renders all root nodes as treeitems
 * 2. Renders nested children when expanded
 * 3. Hides nested children when collapsed
 * 4. ArrowDown moves focus to next visible item
 * 5. ArrowUp moves focus to previous visible item
 * 6. ArrowRight expands a collapsed node with children
 * 7. ArrowLeft collapses an expanded node with children
 * 8. Enter activates selection (calls onSelect with the node's selector)
 * 9. Clicking a node calls onSelect
 * 10. Clicking the chevron toggles expand/collapse without selecting
 * 11. When selectedId changes, the matching node gets aria-selected="true"
 * 12. scrollIntoView is called when selectedId changes
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutlineTree } from "./OutlineTree";
import type { PageTree, PageTreeNode } from "./page-tree";

// ─── Mock scrollIntoView ─────────────────────────────────────────────────────

const scrollIntoViewMock = vi.fn();

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

// ─── Test Data ───────────────────────────────────────────────────────────────

function buildMockTree(): PageTree {
  const sectionNode: PageTreeNode = {
    id: "section-1",
    type: "Section",
    label: "Hero Section",
    zone: "root:default-zone",
    index: 0,
    parentId: null,
    childrenByZone: {
      content: [
        {
          id: "text-1",
          type: "Text",
          label: "Heading Text",
          zone: "section-1:content",
          index: 0,
          parentId: "section-1",
          childrenByZone: {},
        },
        {
          id: "text-2",
          type: "Text",
          label: "Body Text",
          zone: "section-1:content",
          index: 1,
          parentId: "section-1",
          childrenByZone: {},
        },
      ],
    },
  };

  const imageNode: PageTreeNode = {
    id: "image-1",
    type: "Image",
    label: "Banner Image",
    zone: "root:default-zone",
    index: 1,
    parentId: null,
    childrenByZone: {},
  };

  const footerNode: PageTreeNode = {
    id: "footer-1",
    type: "Footer",
    label: "Page Footer",
    zone: "root:default-zone",
    index: 2,
    parentId: null,
    childrenByZone: {},
  };

  const textNode1 = sectionNode.childrenByZone.content[0];
  const textNode2 = sectionNode.childrenByZone.content[1];

  const byId = new Map<string, PageTreeNode>([
    ["section-1", sectionNode],
    ["image-1", imageNode],
    ["footer-1", footerNode],
    ["text-1", textNode1],
    ["text-2", textNode2],
  ]);

  const parentOf = new Map<string, string | null>([
    ["section-1", null],
    ["image-1", null],
    ["footer-1", null],
    ["text-1", "section-1"],
    ["text-2", "section-1"],
  ]);

  return {
    roots: [sectionNode, imageNode, footerNode],
    byId,
    parentOf,
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function getTreeItems() {
  return screen.getAllByRole("treeitem");
}

function getTree() {
  return screen.getByRole("tree");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OutlineTree", () => {
  it("renders all root nodes as treeitems", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const items = getTreeItems();
    // All expanded by default: section-1, text-1, text-2, image-1, footer-1
    const labels = items.map((item) => item.textContent);
    expect(labels).toContain("Hero Section");
    expect(labels).toContain("Banner Image");
    expect(labels).toContain("Page Footer");
  });

  it("renders nested children when expanded (default state)", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const items = getTreeItems();
    const labels = items.map((item) => item.textContent);
    expect(labels).toContain("Heading Text");
    expect(labels).toContain("Body Text");
  });

  it("hides nested children when collapsed", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    // Find the section node's chevron and click it to collapse
    const sectionItem = getTreeItems().find((item) => item.textContent?.includes("Hero Section"))!;
    const chevron = sectionItem.querySelector("span[aria-hidden='true']")!;
    fireEvent.click(chevron);

    // Children should no longer be visible
    const items = getTreeItems();
    const labels = items.map((item) => item.textContent);
    expect(labels).not.toContain("Heading Text");
    expect(labels).not.toContain("Body Text");
    // Root nodes still visible
    expect(labels).toContain("Hero Section");
    expect(labels).toContain("Banner Image");
    expect(labels).toContain("Page Footer");
  });

  it("ArrowDown moves focus to next visible item", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const treeEl = getTree();

    // First item should have focus initially (roving tabindex)
    const items = getTreeItems();
    expect(items[0].getAttribute("tabindex")).toBe("0");

    // Press ArrowDown
    fireEvent.keyDown(treeEl, { key: "ArrowDown" });

    // Second item should now have tabindex=0
    const updatedItems = getTreeItems();
    const focusedItem = updatedItems.find((item) => item.getAttribute("tabindex") === "0");
    expect(focusedItem?.textContent).toContain("Heading Text");
  });

  it("ArrowUp moves focus to previous visible item", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const treeEl = getTree();

    // Move down first, then up
    fireEvent.keyDown(treeEl, { key: "ArrowDown" });
    fireEvent.keyDown(treeEl, { key: "ArrowDown" });

    // Now on "Body Text" (index 2), press ArrowUp
    fireEvent.keyDown(treeEl, { key: "ArrowUp" });

    const items = getTreeItems();
    const focusedItem = items.find((item) => item.getAttribute("tabindex") === "0");
    expect(focusedItem?.textContent).toContain("Heading Text");
  });

  it("ArrowRight expands a collapsed node with children", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const treeEl = getTree();

    // First collapse the section node via chevron click
    const sectionItem = getTreeItems().find((item) => item.textContent?.includes("Hero Section"))!;
    const chevron = sectionItem.querySelector("span[aria-hidden='true']")!;
    fireEvent.click(chevron);

    // Verify collapsed
    let items = getTreeItems();
    let labels = items.map((item) => item.textContent);
    expect(labels).not.toContain("Heading Text");

    // Now press ArrowRight on the section node (which should have focus since it's first)
    fireEvent.keyDown(treeEl, { key: "ArrowRight" });

    // Children should now be visible
    items = getTreeItems();
    labels = items.map((item) => item.textContent);
    expect(labels).toContain("Heading Text");
    expect(labels).toContain("Body Text");
  });

  it("ArrowLeft collapses an expanded node with children", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const treeEl = getTree();

    // Section is expanded by default, focus is on it
    // Press ArrowLeft to collapse
    fireEvent.keyDown(treeEl, { key: "ArrowLeft" });

    // Children should be hidden
    const items = getTreeItems();
    const labels = items.map((item) => item.textContent);
    expect(labels).not.toContain("Heading Text");
    expect(labels).not.toContain("Body Text");
    expect(labels).toContain("Hero Section");
  });

  it("Enter activates selection (calls onSelect with the node's selector)", () => {
    const tree = buildMockTree();
    const onSelect = vi.fn();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={onSelect} />);

    const treeEl = getTree();

    // Focus is on first item (Hero Section at zone "root:default-zone", index 0)
    fireEvent.keyDown(treeEl, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({ zone: "root:default-zone", index: 0 }, "section-1");
  });

  it("clicking a node calls onSelect", () => {
    const tree = buildMockTree();
    const onSelect = vi.fn();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={onSelect} />);

    const items = getTreeItems();
    const imageItem = items.find((item) => item.textContent?.includes("Banner Image"))!;
    fireEvent.click(imageItem);

    expect(onSelect).toHaveBeenCalledWith({ zone: "root:default-zone", index: 1 }, "image-1");
  });

  it("clicking the chevron toggles expand/collapse without selecting", () => {
    const tree = buildMockTree();
    const onSelect = vi.fn();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={onSelect} />);

    // Find the section node's chevron
    const sectionItem = getTreeItems().find((item) => item.textContent?.includes("Hero Section"))!;
    const chevron = sectionItem.querySelector("span[aria-hidden='true']")!;

    // Click the chevron — should collapse without calling onSelect
    fireEvent.click(chevron);

    expect(onSelect).not.toHaveBeenCalled();

    // Verify collapsed
    let items = getTreeItems();
    let labels = items.map((item) => item.textContent);
    expect(labels).not.toContain("Heading Text");

    // Click again — should expand without calling onSelect
    const sectionItemAgain = getTreeItems().find((item) => item.textContent?.includes("Hero Section"))!;
    const chevronAgain = sectionItemAgain.querySelector("span[aria-hidden='true']")!;
    fireEvent.click(chevronAgain);

    expect(onSelect).not.toHaveBeenCalled();

    // Verify expanded
    items = getTreeItems();
    labels = items.map((item) => item.textContent);
    expect(labels).toContain("Heading Text");
  });

  it("when selectedId changes, the matching node gets aria-selected='true'", () => {
    const tree = buildMockTree();
    const { rerender } = render(
      <OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />,
    );

    // Initially no node is selected
    const items = getTreeItems();
    for (const item of items) {
      expect(item.getAttribute("aria-selected")).toBe("false");
    }

    // Rerender with a selectedId
    rerender(<OutlineTree tree={tree} selectedId="text-1" onSelect={vi.fn()} />);

    const updatedItems = getTreeItems();
    const selectedItem = updatedItems.find((item) => item.textContent?.includes("Heading Text"))!;
    expect(selectedItem.getAttribute("aria-selected")).toBe("true");

    // Other items should be false
    const otherItems = updatedItems.filter((item) => !item.textContent?.includes("Heading Text"));
    for (const item of otherItems) {
      expect(item.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("scrollIntoView is called when selectedId changes", () => {
    const tree = buildMockTree();
    const { rerender } = render(
      <OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />,
    );

    scrollIntoViewMock.mockClear();

    // Change selectedId
    rerender(<OutlineTree tree={tree} selectedId="text-2" onSelect={vi.fn()} />);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
  });
});
