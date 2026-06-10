import { describe, it, expect } from "vitest";
import { aboutOraTemplate, ABOUT_ORA_COPY } from "./about-ora";
import type { ComponentInstance } from "../../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all props.id values from a template's data. */
function collectAllIds(data: {
  content: ComponentInstance[];
  zones: Record<string, ComponentInstance[]>;
}): string[] {
  const ids: string[] = [];
  for (const block of data.content) {
    ids.push(block.props.id);
  }
  for (const children of Object.values(data.zones)) {
    for (const block of children) {
      ids.push(block.props.id);
    }
  }
  return ids;
}

/** Get the archetype tag from a Section block. */
function getArchetype(section: ComponentInstance): string {
  return section.props._archetype as string;
}

/** Get all blocks of a given type from the template zones. */
function getBlocksByType(
  zones: Record<string, ComponentInstance[]>,
  type: string
): ComponentInstance[] {
  const blocks: ComponentInstance[] = [];
  for (const children of Object.values(zones)) {
    for (const block of children) {
      if (block.type === type) blocks.push(block);
    }
  }
  return blocks;
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

describe("about-ora template", () => {
  it('factory returns id "about-ora"', () => {
    const template = aboutOraTemplate();
    expect(template.id).toBe("about-ora");
  });

  it("sequence length is exactly 7", () => {
    const template = aboutOraTemplate();
    expect(template.data.content).toHaveLength(7);
  });

  describe("archetype sequence matches Req 6.2 position-by-position", () => {
    it("position 1 is hero", () => {
      const template = aboutOraTemplate();
      expect(getArchetype(template.data.content[0])).toBe("hero");
    });

    it("position 2 is text+image", () => {
      const template = aboutOraTemplate();
      expect(getArchetype(template.data.content[1])).toBe("text+image");
    });

    it("position 3 is image+text", () => {
      const template = aboutOraTemplate();
      expect(getArchetype(template.data.content[2])).toBe("image+text");
    });

    it("position 4 is heading+full-width-image", () => {
      const template = aboutOraTemplate();
      expect(getArchetype(template.data.content[3])).toBe("heading+full-width-image");
    });

    it("position 5 is heading+accordions", () => {
      const template = aboutOraTemplate();
      expect(getArchetype(template.data.content[4])).toBe("heading+accordions");
    });

    it("position 6 is image+text or text+image", () => {
      const template = aboutOraTemplate();
      const archetype = getArchetype(template.data.content[5]);
      expect(["image+text", "text+image"]).toContain(archetype);
    });

    it("position 7 is image+text or text+image", () => {
      const template = aboutOraTemplate();
      const archetype = getArchetype(template.data.content[6]);
      expect(["image+text", "text+image"]).toContain(archetype);
    });
  });

  describe("first Section is gradient-hero", () => {
    it('bgMode is "gradient"', () => {
      const template = aboutOraTemplate();
      const hero = template.data.content[0];
      expect(hero.props.bgMode).toBe("gradient");
    });

    it("bgImage is empty or not set", () => {
      const template = aboutOraTemplate();
      const hero = template.data.content[0];
      const bgImage = hero.props.bgImage as string | undefined;
      expect(!bgImage || bgImage.trim() === "").toBe(true);
    });
  });

  describe("position-5 heading+accordions section", () => {
    it("has between 3 and 10 accordion items", () => {
      const template = aboutOraTemplate();
      const faqSection = template.data.content[4];
      const sectionId = faqSection.props.id;
      const containerZone = template.data.zones[`${sectionId}:section-content`];
      const containerId = containerZone[0].props.id;
      const containerContent = template.data.zones[`${containerId}:container-content`];

      // Find the AccordionGroup block
      const accordionGroup = containerContent.find(
        (b) => b.type === "AccordionGroup"
      );
      expect(accordionGroup).toBeDefined();

      const items = accordionGroup!.props.items as { title: string; body: string }[];
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(10);
    });

    it("each item has title 1-120 chars and body 1-600 chars", () => {
      const template = aboutOraTemplate();
      const faqSection = template.data.content[4];
      const sectionId = faqSection.props.id;
      const containerZone = template.data.zones[`${sectionId}:section-content`];
      const containerId = containerZone[0].props.id;
      const containerContent = template.data.zones[`${containerId}:container-content`];

      const accordionGroup = containerContent.find(
        (b) => b.type === "AccordionGroup"
      );
      const items = accordionGroup!.props.items as { title: string; body: string }[];

      for (const item of items) {
        const titleLen = item.title.trim().length;
        const bodyLen = item.body.trim().length;
        expect(titleLen).toBeGreaterThanOrEqual(1);
        expect(titleLen).toBeLessThanOrEqual(120);
        expect(bodyLen).toBeGreaterThanOrEqual(1);
        expect(bodyLen).toBeLessThanOrEqual(600);
      }
    });

    it("no accordion item contains lorem/ipsum", () => {
      const template = aboutOraTemplate();
      const faqSection = template.data.content[4];
      const sectionId = faqSection.props.id;
      const containerZone = template.data.zones[`${sectionId}:section-content`];
      const containerId = containerZone[0].props.id;
      const containerContent = template.data.zones[`${containerId}:container-content`];

      const accordionGroup = containerContent.find(
        (b) => b.type === "AccordionGroup"
      );
      const items = accordionGroup!.props.items as { title: string; body: string }[];

      for (const item of items) {
        expect(item.title.toLowerCase()).not.toContain("lorem");
        expect(item.title.toLowerCase()).not.toContain("ipsum");
        expect(item.body.toLowerCase()).not.toContain("lorem");
        expect(item.body.toLowerCase()).not.toContain("ipsum");
      }
    });
  });

  describe("copy assertions", () => {
    it('at least one Heading contains "About ORA" (case-insensitive)', () => {
      const template = aboutOraTemplate();
      const headings = getBlocksByType(template.data.zones, "Heading");
      // Also check content-level headings (unlikely but be thorough)
      const allHeadings = [
        ...template.data.content.filter((b) => b.type === "Heading"),
        ...headings,
      ];
      const hasAboutOra = allHeadings.some((h) => {
        const text = (h.props.text as string) || "";
        return text.toLowerCase().includes("about ora");
      });
      expect(hasAboutOra).toBe(true);
    });

    it("no Heading/Text/Button copy contains lorem/ipsum", () => {
      const template = aboutOraTemplate();
      const allBlocks: ComponentInstance[] = [
        ...template.data.content,
        ...Object.values(template.data.zones).flat(),
      ];

      for (const block of allBlocks) {
        if (["Heading", "Text", "Button"].includes(block.type)) {
          const text =
            (block.props.text as string) ||
            (block.props.content as string) ||
            "";
          expect(text.toLowerCase()).not.toContain("lorem");
          expect(text.toLowerCase()).not.toContain("ipsum");
        }
      }
    });

    it("every Heading/Text/Button copy has trimmed length 1-240", () => {
      const template = aboutOraTemplate();
      const allBlocks: ComponentInstance[] = [
        ...template.data.content,
        ...Object.values(template.data.zones).flat(),
      ];

      for (const block of allBlocks) {
        if (["Heading", "Text", "Button"].includes(block.type)) {
          const text =
            (block.props.text as string) ||
            (block.props.content as string) ||
            "";
          const trimmed = text.trim();
          expect(
            trimmed.length,
            `${block.type} (${block.props.id}) copy length should be 1-240, got ${trimmed.length}`
          ).toBeGreaterThanOrEqual(1);
          expect(
            trimmed.length,
            `${block.type} (${block.props.id}) copy length should be 1-240, got ${trimmed.length}`
          ).toBeLessThanOrEqual(240);
        }
      }
    });
  });

  describe("disjoint id sets across two factory invocations", () => {
    it("two consecutive calls produce completely disjoint id sets", () => {
      const template1 = aboutOraTemplate();
      const template2 = aboutOraTemplate();

      const ids1 = new Set(collectAllIds(template1.data));
      const ids2 = new Set(collectAllIds(template2.data));

      // Verify both sets are non-empty
      expect(ids1.size).toBeGreaterThan(0);
      expect(ids2.size).toBeGreaterThan(0);

      // Verify no intersection
      for (const id of ids1) {
        expect(ids2.has(id), `id "${id}" appears in both invocations`).toBe(false);
      }
    });
  });

  describe("snapshot stability", () => {
    it("materialised template (with ids stripped) matches snapshot", () => {
      const template = aboutOraTemplate();
      const stripped = stripIds(template.data);
      expect(stripped).toMatchSnapshot();
    });
  });
});
