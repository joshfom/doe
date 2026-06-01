/**
 * Unit tests for buildPageTree.
 *
 * Validates the core tree-building logic: root zone processing, nested zones,
 * label derivation (props._label → config label → type fallback), orphan zone
 * handling, and the byId/parentOf maps.
 */

import { describe, it, expect, vi } from "vitest";
import { buildPageTree } from "./page-tree";
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

describe("buildPageTree", () => {
  it("returns empty tree for empty data", () => {
    const tree = buildPageTree(makeData(), makeConfig());
    expect(tree.roots).toEqual([]);
    expect(tree.byId.size).toBe(0);
    expect(tree.parentOf.size).toBe(0);
  });

  it("processes root zone content into roots", () => {
    const data = makeData([
      { type: "Section", props: { id: "s1" } },
      { type: "Text", props: { id: "t1" } },
    ]);
    const config = makeConfig({ Section: { label: "Section" }, Text: { label: "Text Block" } });
    const tree = buildPageTree(data, config);

    expect(tree.roots).toHaveLength(2);
    expect(tree.roots[0].id).toBe("s1");
    expect(tree.roots[0].type).toBe("Section");
    expect(tree.roots[0].label).toBe("Section");
    expect(tree.roots[0].zone).toBe("root:default-zone");
    expect(tree.roots[0].index).toBe(0);
    expect(tree.roots[0].parentId).toBeNull();

    expect(tree.roots[1].id).toBe("t1");
    expect(tree.roots[1].label).toBe("Text Block");
    expect(tree.roots[1].index).toBe(1);
  });

  it("builds byId and parentOf maps correctly", () => {
    const data = makeData([
      { type: "Section", props: { id: "s1" } },
    ]);
    const config = makeConfig({ Section: {} });
    const tree = buildPageTree(data, config);

    expect(tree.byId.get("s1")).toBeDefined();
    expect(tree.byId.get("s1")!.id).toBe("s1");
    expect(tree.parentOf.get("s1")).toBeNull();
  });

  it("processes nested zones and links children to parents", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [
          { type: "Text", props: { id: "t1" } },
          { type: "Image", props: { id: "i1" } },
        ],
      },
    );
    const config = makeConfig({
      Section: { label: "Section" },
      Text: { label: "Text" },
      Image: { label: "Image" },
    });
    const tree = buildPageTree(data, config);

    // Parent node has children
    const section = tree.byId.get("s1")!;
    expect(section.childrenByZone["content"]).toHaveLength(2);
    expect(section.childrenByZone["content"][0].id).toBe("t1");
    expect(section.childrenByZone["content"][1].id).toBe("i1");

    // Children have correct parentId
    expect(tree.parentOf.get("t1")).toBe("s1");
    expect(tree.parentOf.get("i1")).toBe("s1");

    // Children have correct zone and index
    const text = tree.byId.get("t1")!;
    expect(text.zone).toBe("s1:content");
    expect(text.index).toBe(0);
    expect(text.parentId).toBe("s1");
  });

  it("derives label from props._label (highest priority)", () => {
    const data = makeData([
      { type: "Section", props: { id: "s1", _label: "Hero Section" } },
    ]);
    const config = makeConfig({ Section: { label: "Section" } });
    const tree = buildPageTree(data, config);

    expect(tree.roots[0].label).toBe("Hero Section");
  });

  it("derives label from config.components[type].label (second priority)", () => {
    const data = makeData([
      { type: "Section", props: { id: "s1" } },
    ]);
    const config = makeConfig({ Section: { label: "Content Section" } });
    const tree = buildPageTree(data, config);

    expect(tree.roots[0].label).toBe("Content Section");
  });

  it("falls back to type string when no label is configured", () => {
    const data = makeData([
      { type: "CustomWidget", props: { id: "w1" } },
    ]);
    const config = makeConfig({});
    const tree = buildPageTree(data, config);

    expect(tree.roots[0].label).toBe("CustomWidget");
  });

  it("ignores empty string _label and falls through to config label", () => {
    const data = makeData([
      { type: "Section", props: { id: "s1", _label: "" } },
    ]);
    const config = makeConfig({ Section: { label: "Section" } });
    const tree = buildPageTree(data, config);

    expect(tree.roots[0].label).toBe("Section");
  });

  it("skips orphan zone keys and logs a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "nonexistent:content": [
          { type: "Text", props: { id: "t1" } },
        ],
      },
    );
    const config = makeConfig({});
    const tree = buildPageTree(data, config);

    // Orphan zone items are not in the tree
    expect(tree.byId.has("t1")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Orphan zone key"),
    );
    warnSpy.mockRestore();
  });

  it("handles deeply nested zones (grandchildren)", () => {
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [{ type: "Columns", props: { id: "c1" } }],
        "c1:left": [{ type: "Text", props: { id: "t1" } }],
        "c1:right": [{ type: "Image", props: { id: "i1" } }],
      },
    );
    const config = makeConfig({});
    const tree = buildPageTree(data, config);

    const columns = tree.byId.get("c1")!;
    expect(columns.childrenByZone["left"]).toHaveLength(1);
    expect(columns.childrenByZone["left"][0].id).toBe("t1");
    expect(columns.childrenByZone["right"]).toHaveLength(1);
    expect(columns.childrenByZone["right"][0].id).toBe("i1");

    expect(tree.parentOf.get("c1")).toBe("s1");
    expect(tree.parentOf.get("t1")).toBe("c1");
    expect(tree.parentOf.get("i1")).toBe("c1");
  });

  it("handles zones listed before their owner's zone (out-of-order)", () => {
    // Zone "c1:left" references owner "c1" which is defined in "s1:content",
    // but "c1:left" appears before "s1:content" in the zones object.
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "c1:left": [{ type: "Text", props: { id: "t1" } }],
        "s1:content": [{ type: "Columns", props: { id: "c1" } }],
      },
    );
    const config = makeConfig({});
    const tree = buildPageTree(data, config);

    expect(tree.byId.has("c1")).toBe(true);
    expect(tree.byId.has("t1")).toBe(true);
    expect(tree.parentOf.get("t1")).toBe("c1");
    expect(tree.parentOf.get("c1")).toBe("s1");

    const columns = tree.byId.get("c1")!;
    expect(columns.childrenByZone["left"]).toHaveLength(1);
  });

  it("total node count equals all blocks across content + zones", () => {
    const data = makeData(
      [
        { type: "Section", props: { id: "s1" } },
        { type: "Section", props: { id: "s2" } },
      ],
      {
        "s1:content": [
          { type: "Text", props: { id: "t1" } },
          { type: "Text", props: { id: "t2" } },
        ],
        "s2:content": [{ type: "Image", props: { id: "i1" } }],
      },
    );
    const config = makeConfig({});
    const tree = buildPageTree(data, config);

    // 2 root + 2 in s1:content + 1 in s2:content = 5
    expect(tree.byId.size).toBe(5);
    expect(tree.parentOf.size).toBe(5);
  });

  // ─── Inline slot model (Puck 0.21+) ───────────────────────────────────────

  it("traverses inline slot children stored in component props", () => {
    // Puck 0.21+ stores children in props under the slot field name
    const data = {
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            "section-content": [
              { type: "Heading", props: { id: "h1", text: "Hello" } },
              { type: "Text", props: { id: "t1" } },
            ],
          },
        },
      ],
    } as unknown as Data;

    const config = {
      components: {
        Section: {
          label: "Section",
          fields: { "section-content": { type: "slot" } },
        },
        Heading: { label: "Heading" },
        Text: { label: "Text" },
      },
    } as unknown as Config;

    const tree = buildPageTree(data, config);

    expect(tree.roots).toHaveLength(1);
    expect(tree.byId.size).toBe(3); // Section + Heading + Text

    const section = tree.byId.get("s1")!;
    expect(section.childrenByZone["section-content"]).toHaveLength(2);
    expect(section.childrenByZone["section-content"][0].id).toBe("h1");
    expect(section.childrenByZone["section-content"][0].label).toBe("Heading");
    expect(section.childrenByZone["section-content"][1].id).toBe("t1");

    expect(tree.parentOf.get("h1")).toBe("s1");
    expect(tree.parentOf.get("t1")).toBe("s1");
  });

  it("traverses deeply nested slots (Columns with slot children)", () => {
    const data = {
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            "section-content": [
              {
                type: "Columns",
                props: {
                  id: "col1",
                  "column-0": [
                    { type: "Heading", props: { id: "h1", text: "Left" } },
                  ],
                  "column-1": [
                    { type: "Image", props: { id: "img1" } },
                    { type: "Text", props: { id: "t1" } },
                  ],
                },
              },
            ],
          },
        },
      ],
    } as unknown as Data;

    const config = {
      components: {
        Section: {
          label: "Section",
          fields: { "section-content": { type: "slot" } },
        },
        Columns: {
          label: "Columns",
          fields: {
            "column-0": { type: "slot" },
            "column-1": { type: "slot" },
          },
        },
        Heading: { label: "Heading" },
        Image: { label: "Image" },
        Text: { label: "Text" },
      },
    } as unknown as Config;

    const tree = buildPageTree(data, config);

    // Section + Columns + Heading + Image + Text = 5
    expect(tree.byId.size).toBe(5);

    const section = tree.byId.get("s1")!;
    expect(section.childrenByZone["section-content"]).toHaveLength(1);

    const columns = tree.byId.get("col1")!;
    expect(columns.childrenByZone["column-0"]).toHaveLength(1);
    expect(columns.childrenByZone["column-0"][0].id).toBe("h1");
    expect(columns.childrenByZone["column-1"]).toHaveLength(2);
    expect(columns.childrenByZone["column-1"][0].id).toBe("img1");
    expect(columns.childrenByZone["column-1"][1].id).toBe("t1");

    // Verify parent chain
    expect(tree.parentOf.get("col1")).toBe("s1");
    expect(tree.parentOf.get("h1")).toBe("col1");
    expect(tree.parentOf.get("img1")).toBe("col1");
    expect(tree.parentOf.get("t1")).toBe("col1");
  });

  it("handles mixed slot and legacy zone data", () => {
    // Some items in slots, some in zones (migration mid-state)
    const data = {
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            "section-content": [
              { type: "Heading", props: { id: "h1" } },
            ],
          },
        },
        { type: "Section", props: { id: "s2" } },
      ],
      zones: {
        "s2:section-content": [
          { type: "Text", props: { id: "t1" } },
        ],
      },
    } as unknown as Data;

    const config = {
      components: {
        Section: {
          label: "Section",
          fields: { "section-content": { type: "slot" } },
        },
        Heading: { label: "Heading" },
        Text: { label: "Text" },
      },
    } as unknown as Config;

    const tree = buildPageTree(data, config);

    // s1 + h1 (from slot) + s2 + t1 (from zone) = 4
    expect(tree.byId.size).toBe(4);

    const s1 = tree.byId.get("s1")!;
    expect(s1.childrenByZone["section-content"]).toHaveLength(1);
    expect(s1.childrenByZone["section-content"][0].id).toBe("h1");

    const s2 = tree.byId.get("s2")!;
    expect(s2.childrenByZone["section-content"]).toHaveLength(1);
    expect(s2.childrenByZone["section-content"][0].id).toBe("t1");
  });
});
