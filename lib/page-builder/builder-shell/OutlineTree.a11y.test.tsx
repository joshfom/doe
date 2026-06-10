// @vitest-environment jsdom

/**
 * OutlineTree — accessibility tests (WAI-ARIA tree roles).
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 5.7
 *
 * Verifies WAI-ARIA tree pattern compliance (Requirement 10.1):
 * 1. Root element has role="tree"
 * 2. Each node has role="treeitem"
 * 3. Each treeitem has aria-level, aria-posinset, aria-setsize
 * 4. Expanded nodes have aria-expanded="true"
 * 5. Collapsed nodes have aria-expanded="false"
 * 6. Selected node has aria-selected="true"
 * 7. Non-selected nodes have aria-selected="false"
 * 8. Tree has an aria-label
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutlineTree } from "./OutlineTree";
import type { PageTree, PageTreeNode } from "./page-tree";

// ─── Mock scrollIntoView ─────────────────────────────────────────────────────

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ─── Test Data ───────────────────────────────────────────────────────────────

function buildMockTree(): PageTree {
  const childNode1: PageTreeNode = {
    id: "text-1",
    type: "Text",
    label: "Heading Text",
    zone: "section-1:content",
    index: 0,
    parentId: "section-1",
    childrenByZone: {},
  };

  const childNode2: PageTreeNode = {
    id: "text-2",
    type: "Text",
    label: "Body Text",
    zone: "section-1:content",
    index: 1,
    parentId: "section-1",
    childrenByZone: {},
  };

  const sectionNode: PageTreeNode = {
    id: "section-1",
    type: "Section",
    label: "Hero Section",
    zone: "root:default-zone",
    index: 0,
    parentId: null,
    childrenByZone: {
      content: [childNode1, childNode2],
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

  const byId = new Map<string, PageTreeNode>([
    ["section-1", sectionNode],
    ["image-1", imageNode],
    ["text-1", childNode1],
    ["text-2", childNode2],
  ]);

  const parentOf = new Map<string, string | null>([
    ["section-1", null],
    ["image-1", null],
    ["text-1", "section-1"],
    ["text-2", "section-1"],
  ]);

  return {
    roots: [sectionNode, imageNode],
    byId,
    parentOf,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OutlineTree — WAI-ARIA tree roles (Req 10.1)", () => {
  it("root element has role='tree'", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const treeEl = screen.getByRole("tree");
    expect(treeEl).toBeDefined();
    expect(treeEl.tagName).toBe("UL");
  });

  it("each node has role='treeitem'", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const items = screen.getAllByRole("treeitem");
    // All expanded by default: section-1, text-1, text-2, image-1
    expect(items.length).toBe(4);

    for (const item of items) {
      expect(item.getAttribute("role")).toBe("treeitem");
    }
  });

  it("each treeitem has aria-level, aria-posinset, aria-setsize", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const items = screen.getAllByRole("treeitem");

    for (const item of items) {
      const level = item.getAttribute("aria-level");
      const posInSet = item.getAttribute("aria-posinset");
      const setSize = item.getAttribute("aria-setsize");

      expect(level).not.toBeNull();
      expect(posInSet).not.toBeNull();
      expect(setSize).not.toBeNull();

      // Values should be positive integers
      expect(Number(level)).toBeGreaterThan(0);
      expect(Number(posInSet)).toBeGreaterThan(0);
      expect(Number(setSize)).toBeGreaterThan(0);
    }

    // Verify specific values for root nodes
    const sectionItem = items.find((item) => item.textContent?.includes("Hero Section"))!;
    expect(sectionItem.getAttribute("aria-level")).toBe("1");
    expect(sectionItem.getAttribute("aria-posinset")).toBe("1");
    expect(sectionItem.getAttribute("aria-setsize")).toBe("2");

    const imageItem = items.find((item) => item.textContent?.includes("Banner Image"))!;
    expect(imageItem.getAttribute("aria-level")).toBe("1");
    expect(imageItem.getAttribute("aria-posinset")).toBe("2");
    expect(imageItem.getAttribute("aria-setsize")).toBe("2");

    // Verify specific values for nested nodes
    const textItem1 = items.find((item) => item.textContent?.includes("Heading Text"))!;
    expect(textItem1.getAttribute("aria-level")).toBe("2");
    expect(textItem1.getAttribute("aria-posinset")).toBe("1");
    expect(textItem1.getAttribute("aria-setsize")).toBe("2");

    const textItem2 = items.find((item) => item.textContent?.includes("Body Text"))!;
    expect(textItem2.getAttribute("aria-level")).toBe("2");
    expect(textItem2.getAttribute("aria-posinset")).toBe("2");
    expect(textItem2.getAttribute("aria-setsize")).toBe("2");
  });

  it("expanded nodes have aria-expanded='true'", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    // Section node has children and is expanded by default
    const items = screen.getAllByRole("treeitem");
    const sectionItem = items.find((item) => item.textContent?.includes("Hero Section"))!;
    expect(sectionItem.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapsed nodes have aria-expanded='false'", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    // Collapse the section node
    const sectionItem = screen.getAllByRole("treeitem").find(
      (item) => item.textContent?.includes("Hero Section"),
    )!;
    const chevron = sectionItem.querySelector("span[aria-hidden='true']")!;
    fireEvent.click(chevron);

    // After collapse, section should have aria-expanded="false"
    const updatedItems = screen.getAllByRole("treeitem");
    const updatedSection = updatedItems.find(
      (item) => item.textContent?.includes("Hero Section"),
    )!;
    expect(updatedSection.getAttribute("aria-expanded")).toBe("false");
  });

  it("nodes without children do not have aria-expanded attribute", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    // Image node has no children — should not have aria-expanded
    const items = screen.getAllByRole("treeitem");
    const imageItem = items.find((item) => item.textContent?.includes("Banner Image"))!;
    expect(imageItem.hasAttribute("aria-expanded")).toBe(false);

    // Text nodes have no children — should not have aria-expanded
    const textItem = items.find((item) => item.textContent?.includes("Heading Text"))!;
    expect(textItem.hasAttribute("aria-expanded")).toBe(false);
  });

  it("selected node has aria-selected='true'", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId="text-1" onSelect={vi.fn()} />);

    const items = screen.getAllByRole("treeitem");
    const selectedItem = items.find((item) => item.textContent?.includes("Heading Text"))!;
    expect(selectedItem.getAttribute("aria-selected")).toBe("true");
  });

  it("non-selected nodes have aria-selected='false'", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId="text-1" onSelect={vi.fn()} />);

    const items = screen.getAllByRole("treeitem");
    const nonSelectedItems = items.filter(
      (item) => !item.textContent?.includes("Heading Text"),
    );

    for (const item of nonSelectedItems) {
      expect(item.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("tree has an aria-label", () => {
    const tree = buildMockTree();
    render(<OutlineTree tree={tree} selectedId={null} onSelect={vi.fn()} />);

    const treeEl = screen.getByRole("tree");
    const ariaLabel = treeEl.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toBe("Page outline");
  });
});
