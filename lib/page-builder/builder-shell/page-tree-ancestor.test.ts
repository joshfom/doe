/**
 * Unit tests for buildAncestorPath.
 *
 * Validates the ancestor path derivation: walking parentOf from selectedId
 * back to root, prepending the synthetic "Page" segment, and returning
 * segments in root → parent order.
 */

import { describe, it, expect } from "vitest";
import { buildPageTree, buildAncestorPath } from "./page-tree";
import type { Config, Data } from "@puckeditor/core";

// Minimal config factory
function makeConfig(
  components: Record<string, { label?: string }> = {},
): Config {
  return { components } as unknown as Config;
}

// Minimal data factory
function makeData(
  content: Array<{ type: string; props: Record<string, unknown> }> = [],
  zones: Record<
    string,
    Array<{ type: string; props: Record<string, unknown> }>
  > = {},
): Data {
  return { content, zones } as unknown as Data;
}

describe("buildAncestorPath", () => {
  it("returns empty array when selectedId is null", () => {
    const tree = buildPageTree(makeData(), makeConfig());
    expect(buildAncestorPath(tree, null)).toEqual([]);
  });

  it("returns empty array when selectedId is not in the tree", () => {
    const data = makeData([{ type: "Section", props: { id: "s1" } }]);
    const tree = buildPageTree(data, makeConfig());
    expect(buildAncestorPath(tree, "nonexistent")).toEqual([]);
  });

  it("returns only the Page segment for a root-zone node", () => {
    const data = makeData([{ type: "Section", props: { id: "s1" } }]);
    const config = makeConfig({ Section: { label: "Section" } });
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "s1");
    expect(path).toEqual([
      { id: null, label: "Page", selector: null },
    ]);
  });

  it("returns [Page, parent] for a direct child of a root node", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [{ type: "Text", props: { id: "t1" } }],
      },
    );
    const config = makeConfig({
      Section: { label: "Section" },
      Text: { label: "Text" },
    });
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "t1");
    expect(path).toEqual([
      { id: null, label: "Page", selector: null },
      { id: "s1", label: "Section", selector: { zone: "root:default-zone", index: 0 } },
    ]);
  });

  it("returns [Page, grandparent, parent] for a deeply nested node", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [{ type: "Columns", props: { id: "c1" } }],
        "c1:left": [{ type: "Text", props: { id: "t1" } }],
      },
    );
    const config = makeConfig({
      Section: { label: "Section" },
      Columns: { label: "Columns" },
      Text: { label: "Text" },
    });
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "t1");
    expect(path).toEqual([
      { id: null, label: "Page", selector: null },
      { id: "s1", label: "Section", selector: { zone: "root:default-zone", index: 0 } },
      { id: "c1", label: "Columns", selector: { zone: "s1:content", index: 0 } },
    ]);
  });

  it("does not include the selected node itself in the path", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [{ type: "Text", props: { id: "t1" } }],
      },
    );
    const config = makeConfig({});
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "t1");
    const ids = path.map((s) => s.id);
    expect(ids).not.toContain("t1");
  });

  it("uses correct labels from config and _label overrides", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1", _label: "Hero" } }],
      {
        "s1:content": [{ type: "Text", props: { id: "t1" } }],
      },
    );
    const config = makeConfig({ Section: { label: "Section" } });
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "t1");
    expect(path[1].label).toBe("Hero");
  });

  it("handles multiple root nodes — selects correct ancestor chain", () => {
    const data = makeData(
      [
        { type: "Section", props: { id: "s1" } },
        { type: "Section", props: { id: "s2" } },
      ],
      {
        "s2:content": [{ type: "Text", props: { id: "t1" } }],
      },
    );
    const config = makeConfig({ Section: { label: "Section" } });
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "t1");
    expect(path).toEqual([
      { id: null, label: "Page", selector: null },
      { id: "s2", label: "Section", selector: { zone: "root:default-zone", index: 1 } },
    ]);
  });

  it("handles 4 levels of nesting correctly", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [{ type: "Columns", props: { id: "c1" } }],
        "c1:left": [{ type: "Card", props: { id: "card1" } }],
        "card1:body": [{ type: "Text", props: { id: "t1" } }],
      },
    );
    const config = makeConfig({
      Section: { label: "Section" },
      Columns: { label: "Columns" },
      Card: { label: "Card" },
      Text: { label: "Text" },
    });
    const tree = buildPageTree(data, config);

    const path = buildAncestorPath(tree, "t1");
    expect(path).toHaveLength(4); // Page + Section + Columns + Card
    expect(path[0]).toEqual({ id: null, label: "Page", selector: null });
    expect(path[1].id).toBe("s1");
    expect(path[2].id).toBe("c1");
    expect(path[3].id).toBe("card1");
  });
});
