import { describe, it, expect } from "vitest";
import {
  regenerateIds,
  generateId,
  instantiate,
  starterHeroTemplate,
  contentImageTemplate,
  contentImageQuoteLeftTemplate,
  contentImageQuoteRightTemplate,
  contentImageAccordionLeftTemplate,
  contentImageAccordionRightTemplate,
  contentImageIconListLeftTemplate,
  contentImageIconListRightTemplate,
  componentTemplates,
} from "./component-templates";
import type { ComponentInstance } from "../types";

describe("regenerateIds", () => {
  it("generates fresh IDs for all content items", () => {
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: "sec-1", bgColor: "#fff" } },
      { type: "Heading", props: { id: "h-1", text: "Hello" } },
    ];

    const result = regenerateIds({ content, zones: {} });

    // All IDs should be different from originals
    expect(result.content[0].props.id).not.toBe("sec-1");
    expect(result.content[1].props.id).not.toBe("h-1");
    // IDs should be unique from each other
    expect(result.content[0].props.id).not.toBe(result.content[1].props.id);
  });

  it("generates fresh IDs for all zone items", () => {
    const sectionId = "sec-1";
    const containerId = "con-1";
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: sectionId } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      [`${sectionId}:section-content`]: [
        { type: "Container", props: { id: containerId, maxWidth: "1200" } },
      ],
    };

    const result = regenerateIds({ content, zones });

    const newSectionId = result.content[0].props.id;
    const zoneKey = `${newSectionId}:section-content`;
    expect(result.zones[zoneKey]).toBeDefined();
    expect(result.zones[zoneKey][0].props.id).not.toBe(containerId);
  });

  it("remaps zone keys to use new owner IDs", () => {
    const sectionId = "sec-original";
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: sectionId } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      [`${sectionId}:section-content`]: [
        { type: "Text", props: { id: "txt-1", content: "Hello" } },
      ],
    };

    const result = regenerateIds({ content, zones });

    // Old zone key should not exist
    expect(result.zones[`${sectionId}:section-content`]).toBeUndefined();
    // New zone key should use the new section ID
    const newSectionId = result.content[0].props.id;
    expect(result.zones[`${newSectionId}:section-content`]).toBeDefined();
    expect(result.zones[`${newSectionId}:section-content`]).toHaveLength(1);
  });

  it("handles deeply nested zones (multi-level)", () => {
    const sectionId = "sec-1";
    const containerId = "con-1";
    const columnsId = "cols-1";

    const content: ComponentInstance[] = [
      { type: "Section", props: { id: sectionId } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      [`${sectionId}:section-content`]: [
        { type: "Container", props: { id: containerId } },
      ],
      [`${containerId}:container-content`]: [
        { type: "Columns", props: { id: columnsId } },
      ],
      [`${columnsId}:column-0`]: [
        { type: "Text", props: { id: "txt-1", content: "Left" } },
      ],
      [`${columnsId}:column-1`]: [
        { type: "Image", props: { id: "img-1", src: "test.jpg" } },
      ],
    };

    const result = regenerateIds({ content, zones });

    // Verify all zone keys are remapped correctly
    const newSectionId = result.content[0].props.id;
    const sectionZone = result.zones[`${newSectionId}:section-content`];
    expect(sectionZone).toBeDefined();
    expect(sectionZone).toHaveLength(1);

    const newContainerId = sectionZone[0].props.id;
    const containerZone = result.zones[`${newContainerId}:container-content`];
    expect(containerZone).toBeDefined();
    expect(containerZone).toHaveLength(1);

    const newColumnsId = containerZone[0].props.id;
    const col0Zone = result.zones[`${newColumnsId}:column-0`];
    const col1Zone = result.zones[`${newColumnsId}:column-1`];
    expect(col0Zone).toBeDefined();
    expect(col0Zone).toHaveLength(1);
    expect(col1Zone).toBeDefined();
    expect(col1Zone).toHaveLength(1);

    // Verify all IDs are fresh
    expect(newSectionId).not.toBe(sectionId);
    expect(newContainerId).not.toBe(containerId);
    expect(newColumnsId).not.toBe(columnsId);
    expect(col0Zone[0].props.id).not.toBe("txt-1");
    expect(col1Zone[0].props.id).not.toBe("img-1");
  });

  it("deep-clones props (no shared references with original)", () => {
    const originalPadding = { paddingTop: "10", paddingBottom: "20", paddingLeft: "0", paddingRight: "0" };
    const originalItems = [{ title: "Item 1", body: "Body 1" }];
    const content: ComponentInstance[] = [
      {
        type: "Section",
        props: {
          id: "sec-1",
          _padding: originalPadding,
          items: originalItems,
        },
      },
    ];

    const result = regenerateIds({ content, zones: {} });

    // Mutating the result should NOT affect the original
    (result.content[0].props._padding as Record<string, string>).paddingTop = "999";
    expect(originalPadding.paddingTop).toBe("10");

    (result.content[0].props.items as Array<{ title: string }>)[0].title = "MUTATED";
    expect(originalItems[0].title).toBe("Item 1");
  });

  it("deep-clones zone item props (no shared references)", () => {
    const originalMargin = { marginTop: "5", marginBottom: "10" };
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: "sec-1" } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      "sec-1:section-content": [
        { type: "Text", props: { id: "txt-1", _margin: originalMargin, content: "Hello" } },
      ],
    };

    const result = regenerateIds({ content, zones });

    const newSectionId = result.content[0].props.id;
    const zoneItems = result.zones[`${newSectionId}:section-content`];
    (zoneItems[0].props._margin as Record<string, string>).marginTop = "999";
    expect(originalMargin.marginTop).toBe("5");
  });

  it("does not mutate the original input tree", () => {
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: "sec-1", nested: { a: 1 } } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      "sec-1:section-content": [
        { type: "Text", props: { id: "txt-1", content: "Hello" } },
      ],
    };

    // Freeze originals to detect mutation
    const contentCopy = JSON.parse(JSON.stringify(content));
    const zonesCopy = JSON.parse(JSON.stringify(zones));

    regenerateIds({ content, zones });

    expect(content).toEqual(contentCopy);
    expect(zones).toEqual(zonesCopy);
  });

  it("produces unique IDs across all items (no collisions)", () => {
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: "sec-1" } },
      { type: "Section", props: { id: "sec-2" } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      "sec-1:section-content": [
        { type: "Text", props: { id: "txt-1" } },
        { type: "Text", props: { id: "txt-2" } },
      ],
      "sec-2:section-content": [
        { type: "Image", props: { id: "img-1" } },
      ],
    };

    const result = regenerateIds({ content, zones });

    // Collect all IDs
    const allIds = new Set<string>();
    for (const item of result.content) {
      allIds.add(item.props.id);
    }
    for (const items of Object.values(result.zones)) {
      for (const item of items) {
        allIds.add(item.props.id);
      }
    }

    // Total items: 2 content + 3 zone items = 5
    expect(allIds.size).toBe(5);
  });

  it("handles empty content and zones", () => {
    const result = regenerateIds({ content: [], zones: {} });
    expect(result.content).toEqual([]);
    expect(result.zones).toEqual({});
  });

  it("handles null zones", () => {
    const content: ComponentInstance[] = [
      { type: "Text", props: { id: "txt-1", content: "Hello" } },
    ];
    const result = regenerateIds({ content, zones: null });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].props.id).not.toBe("txt-1");
    expect(result.zones).toEqual({});
  });

  it("preserves all non-id props after cloning", () => {
    const content: ComponentInstance[] = [
      {
        type: "Button",
        props: {
          id: "btn-1",
          text: "Click me",
          url: "/page",
          bgColor: "#000",
          _typography: { fontFamily: "Arial", fontSize: "14px" },
          btnPadding: { top: 12, right: 24, bottom: 12, left: 24 },
        },
      },
    ];

    const result = regenerateIds({ content, zones: {} });

    expect(result.content[0].type).toBe("Button");
    expect(result.content[0].props.text).toBe("Click me");
    expect(result.content[0].props.url).toBe("/page");
    expect(result.content[0].props.bgColor).toBe("#000");
    expect(result.content[0].props._typography).toEqual({ fontFamily: "Arial", fontSize: "14px" });
    expect(result.content[0].props.btnPadding).toEqual({ top: 12, right: 24, bottom: 12, left: 24 });
  });

  it("two calls produce completely different ID sets (independent copies)", () => {
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: "sec-1" } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      "sec-1:section-content": [
        { type: "Text", props: { id: "txt-1" } },
      ],
    };

    const result1 = regenerateIds({ content, zones });
    const result2 = regenerateIds({ content, zones });

    // The two results should have different IDs from each other
    expect(result1.content[0].props.id).not.toBe(result2.content[0].props.id);

    const zone1Key = Object.keys(result1.zones)[0];
    const zone2Key = Object.keys(result2.zones)[0];
    expect(zone1Key).not.toBe(zone2Key);

    const zone1Items = result1.zones[zone1Key];
    const zone2Items = result2.zones[zone2Key];
    expect(zone1Items[0].props.id).not.toBe(zone2Items[0].props.id);
  });

  it("handles zone keys with colons in zone name", () => {
    // Edge case: zone name itself might contain a colon (unlikely but defensive)
    const content: ComponentInstance[] = [
      { type: "Section", props: { id: "sec-1" } },
    ];
    const zones: Record<string, ComponentInstance[]> = {
      "sec-1:zone:with:colons": [
        { type: "Text", props: { id: "txt-1" } },
      ],
    };

    const result = regenerateIds({ content, zones });

    const newSectionId = result.content[0].props.id;
    // The zone name "zone:with:colons" should be preserved
    expect(result.zones[`${newSectionId}:zone:with:colons`]).toBeDefined();
    expect(result.zones[`${newSectionId}:zone:with:colons`]).toHaveLength(1);
  });
});


// ─── Task 4.2: Templates produce no fontFamily in built output ───────────────

describe("templates produce no fontFamily in built output", () => {
  /**
   * Recursively walk an object/array tree and assert no key named "fontFamily"
   * exists at any depth.
   */
  function assertNoFontFamily(value: unknown, path: string = "root"): void {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => assertNoFontFamily(item, `${path}[${i}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (key === "fontFamily") {
          throw new Error(
            `Found "fontFamily" key at ${path}.${key} with value: ${JSON.stringify(val)}`,
          );
        }
        assertNoFontFamily(val, `${path}.${key}`);
      }
    }
  }

  const allTemplates = [
    starterHeroTemplate,
    contentImageTemplate,
    contentImageQuoteLeftTemplate,
    contentImageQuoteRightTemplate,
    contentImageAccordionLeftTemplate,
    contentImageAccordionRightTemplate,
    contentImageIconListLeftTemplate,
    contentImageIconListRightTemplate,
  ];

  it.each(allTemplates.map((t) => [t.name, t] as const))(
    "template '%s' contains no fontFamily in any nested prop",
    (_name, template) => {
      const { content, zones } = instantiate(template);

      // Walk all content items
      for (const item of content) {
        assertNoFontFamily(item.props, `${template.id}:content.props`);
      }

      // Walk all zone items
      for (const [zoneKey, items] of Object.entries(zones)) {
        for (const item of items) {
          assertNoFontFamily(item.props, `${template.id}:${zoneKey}.props`);
        }
      }
    },
  );

  it("componentTemplates array contains no fontFamily in any template output", () => {
    for (const template of componentTemplates) {
      const { content, zones } = instantiate(template);

      for (const item of content) {
        assertNoFontFamily(item.props, `${template.id}:content.props`);
      }

      for (const [zoneKey, items] of Object.entries(zones)) {
        for (const item of items) {
          assertNoFontFamily(item.props, `${template.id}:${zoneKey}.props`);
        }
      }
    }
  });
});
