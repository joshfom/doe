import { describe, it, expect } from "vitest";
import { whyBaynTemplate, WHY_BAYN_COPY } from "./why-bayn";
import type { ComponentInstance } from "../../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all props.id values from a template's data tree. */
function collectAllIds(data: {
  content: ComponentInstance[];
  zones: Record<string, ComponentInstance[]>;
}): string[] {
  const ids: string[] = [];
  for (const block of data.content) {
    ids.push(block.props.id as string);
  }
  for (const children of Object.values(data.zones)) {
    for (const block of children) {
      ids.push(block.props.id as string);
    }
  }
  return ids;
}

/** Collect all copy strings (Heading text, Text content, Button text) from the template tree. */
function collectCopyStrings(data: {
  content: ComponentInstance[];
  zones: Record<string, ComponentInstance[]>;
}): string[] {
  const strings: string[] = [];
  const allBlocks: ComponentInstance[] = [
    ...data.content,
    ...Object.values(data.zones).flat(),
  ];
  for (const block of allBlocks) {
    if (block.type === "Heading" && typeof block.props.text === "string") {
      strings.push(block.props.text);
    }
    if (block.type === "Text" && typeof block.props.content === "string") {
      strings.push(block.props.content);
    }
    if (block.type === "Button" && typeof block.props.text === "string") {
      strings.push(block.props.text);
    }
    if (block.type === "Quote" && typeof block.props.text === "string") {
      strings.push(block.props.text);
    }
    if (block.type === "AccordionGroup" && Array.isArray(block.props.items)) {
      for (const item of block.props.items as { title?: string; body?: string }[]) {
        if (typeof item.title === "string") strings.push(item.title);
        if (typeof item.body === "string") strings.push(item.body);
      }
    }
    if (block.type === "Accordion") {
      if (typeof block.props.title === "string") strings.push(block.props.title);
      if (typeof block.props.body === "string") strings.push(block.props.body);
    }
  }
  return strings;
}

/** UUID regex for normalizing zone keys and id values. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Deep-walk an object tree, replacing every `id` string value and UUID in zone keys with `"<uuid>"`. */
function stripIds(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripIds);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const normalizedKey = key.replace(UUID_RE, "<uuid>");
      if (key === "id" && typeof value === "string") {
        result[normalizedKey] = "<uuid>";
      } else {
        result[normalizedKey] = stripIds(value);
      }
    }
    return result;
  }
  return obj;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("whyBaynTemplate", () => {
  it('returns a template with id "why-bayn"', () => {
    const template = whyBaynTemplate();
    expect(template.id).toBe("why-bayn");
  });

  it("has a non-empty name and description", () => {
    const template = whyBaynTemplate();
    expect(template.name.trim().length).toBeGreaterThan(0);
    expect(template.description.trim().length).toBeGreaterThan(0);
    expect(template.description.length).toBeLessThanOrEqual(120);
  });

  describe("sequence bounds (Req 4.1)", () => {
    it("has between 4 and 8 sections", () => {
      const template = whyBaynTemplate();
      const sectionCount = template.data.content.length;
      expect(sectionCount).toBeGreaterThanOrEqual(4);
      expect(sectionCount).toBeLessThanOrEqual(8);
    });
  });

  describe("first Section is gradient-hero (Req 4.2)", () => {
    it("first section has _archetype = 'hero'", () => {
      const template = whyBaynTemplate();
      const firstSection = template.data.content[0];
      expect(firstSection.props._archetype).toBe("hero");
    });

    it("first section has bgMode = 'gradient'", () => {
      const template = whyBaynTemplate();
      const firstSection = template.data.content[0];
      expect(firstSection.props.bgMode).toBe("gradient");
    });

    it("first section does not have a non-empty bgImage", () => {
      const template = whyBaynTemplate();
      const firstSection = template.data.content[0];
      const bgImage = firstSection.props.bgImage;
      // bgImage should be empty string, undefined, or null
      expect(!bgImage || (typeof bgImage === "string" && bgImage.trim() === "")).toBe(true);
    });
  });

  describe("required archetypes (Req 4.3)", () => {
    it("includes at least one image+text section", () => {
      const template = whyBaynTemplate();
      const archetypes = template.data.content.map((s) => s.props._archetype);
      expect(archetypes).toContain("image+text");
    });

    it("includes at least one text+image section", () => {
      const template = whyBaynTemplate();
      const archetypes = template.data.content.map((s) => s.props._archetype);
      expect(archetypes).toContain("text+image");
    });
  });

  describe("required heading+text archetype (Req 4.4)", () => {
    it("includes at least one heading+full-width-image or heading+accordions section with Heading + Text", () => {
      const template = whyBaynTemplate();
      const qualifyingArchetypes = ["heading+full-width-image", "heading+accordions"];
      const qualifyingSections = template.data.content.filter((s) =>
        qualifyingArchetypes.includes(s.props._archetype as string)
      );
      expect(qualifyingSections.length).toBeGreaterThanOrEqual(1);

      // Verify at least one of them contains both a Heading and a Text block
      let hasHeadingAndText = false;
      for (const section of qualifyingSections) {
        const sectionId = section.props.id as string;
        const containerZone = template.data.zones[`${sectionId}:section-content`];
        if (!containerZone || containerZone.length === 0) continue;
        const containerId = containerZone[0].props.id as string;
        const containerContent = template.data.zones[`${containerId}:container-content`];
        if (!containerContent) continue;

        const types = containerContent.map((b) => b.type);
        if (types.includes("Heading") && types.includes("Text")) {
          hasHeadingAndText = true;
          break;
        }
      }
      expect(hasHeadingAndText).toBe(true);
    });
  });

  describe("copy assertions", () => {
    it("no copy string contains lorem or ipsum (case-insensitive)", () => {
      const template = whyBaynTemplate();
      const strings = collectCopyStrings(template.data);
      for (const s of strings) {
        expect(s.toLowerCase()).not.toContain("lorem");
        expect(s.toLowerCase()).not.toContain("ipsum");
      }
    });

    it("every copy string has trimmed length between 1 and 240", () => {
      const template = whyBaynTemplate();
      const strings = collectCopyStrings(template.data);
      expect(strings.length).toBeGreaterThan(0);
      for (const s of strings) {
        const trimmed = s.trim();
        expect(trimmed.length).toBeGreaterThanOrEqual(1);
        expect(trimmed.length).toBeLessThanOrEqual(240);
      }
    });
  });

  describe("disjoint id sets across two factory invocations (Req 9.3, 9.5)", () => {
    it("two consecutive calls produce disjoint id sets", () => {
      const template1 = whyBaynTemplate();
      const template2 = whyBaynTemplate();

      const ids1 = new Set(collectAllIds(template1.data));
      const ids2 = new Set(collectAllIds(template2.data));

      // Ensure both sets are non-empty
      expect(ids1.size).toBeGreaterThan(0);
      expect(ids2.size).toBeGreaterThan(0);

      // Ensure no overlap
      const intersection = [...ids1].filter((id) => ids2.has(id));
      expect(intersection).toHaveLength(0);
    });
  });

  describe("snapshot stability", () => {
    it("materialised template (with ids stripped) matches snapshot", () => {
      const template = whyBaynTemplate();
      const stripped = stripIds(template.data);
      expect(stripped).toMatchSnapshot();
    });
  });
});
