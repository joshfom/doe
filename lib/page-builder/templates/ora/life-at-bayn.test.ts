import { describe, it, expect } from "vitest";
import { lifeAtBaynTemplate, LIFE_AT_BAYN_COPY } from "./life-at-bayn";
import type { ComponentInstance } from "../../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all props.id values from the template's content and zones. */
function collectAllIds(template: ReturnType<typeof lifeAtBaynTemplate>): string[] {
  const ids: string[] = [];
  for (const block of template.data.content) {
    ids.push(block.props.id as string);
  }
  for (const children of Object.values(template.data.zones)) {
    for (const block of children) {
      ids.push(block.props.id as string);
    }
  }
  return ids;
}

/** Collect all text content strings from Heading, Text, and Button blocks. */
function collectCopyStrings(template: ReturnType<typeof lifeAtBaynTemplate>): string[] {
  const strings: string[] = [];
  const allBlocks: ComponentInstance[] = [
    ...template.data.content,
    ...Object.values(template.data.zones).flat(),
  ];
  for (const block of allBlocks) {
    if (block.type === "Heading" || block.type === "Text" || block.type === "Button") {
      const text = block.props.text as string | undefined;
      if (text) strings.push(text);
      const content = block.props.content as string | undefined;
      if (content) strings.push(content);
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

describe("lifeAtBaynTemplate", () => {
  it('returns a template with id "life-at-bayn"', () => {
    const template = lifeAtBaynTemplate();
    expect(template.id).toBe("life-at-bayn");
  });

  it("sequence length is between 4 and 8 sections", () => {
    const template = lifeAtBaynTemplate();
    const sectionCount = template.data.content.length;
    expect(sectionCount).toBeGreaterThanOrEqual(4);
    expect(sectionCount).toBeLessThanOrEqual(8);
  });

  it("first Section is image-hero with non-empty bgImage (bgMode='solid', bgMediaType='image')", () => {
    const template = lifeAtBaynTemplate();
    const firstSection = template.data.content[0];
    expect(firstSection.type).toBe("Section");
    expect(firstSection.props._archetype).toBe("hero");
    expect(firstSection.props.bgMode).toBe("solid");
    expect(firstSection.props.bgMediaType).toBe("image");
    expect(typeof firstSection.props.bgImage).toBe("string");
    expect((firstSection.props.bgImage as string).trim().length).toBeGreaterThan(0);
  });

  it("includes at least one image+text OR text+image Section (Req 5.3)", () => {
    const template = lifeAtBaynTemplate();
    const archetypes = template.data.content.map(
      (s) => s.props._archetype as string
    );
    const hasImageText = archetypes.includes("image+text");
    const hasTextImage = archetypes.includes("text+image");
    expect(hasImageText || hasTextImage).toBe(true);
  });

  it("includes at least one heading+full-width-image Section (Req 5.4)", () => {
    const template = lifeAtBaynTemplate();
    const archetypes = template.data.content.map(
      (s) => s.props._archetype as string
    );
    expect(archetypes).toContain("heading+full-width-image");
  });

  describe("copy assertions", () => {
    it("no copy string contains lorem or ipsum", () => {
      const template = lifeAtBaynTemplate();
      const strings = collectCopyStrings(template);
      for (const s of strings) {
        expect(s.toLowerCase()).not.toContain("lorem");
        expect(s.toLowerCase()).not.toContain("ipsum");
      }
    });

    it("every copy string has trimmed length between 1 and 240", () => {
      const template = lifeAtBaynTemplate();
      const strings = collectCopyStrings(template);
      expect(strings.length).toBeGreaterThan(0);
      for (const s of strings) {
        const trimmed = s.trim();
        expect(trimmed.length).toBeGreaterThanOrEqual(1);
        expect(trimmed.length).toBeLessThanOrEqual(240);
      }
    });

    it("LIFE_AT_BAYN_COPY values have no lorem/ipsum and length 1-240", () => {
      const values = Object.values(LIFE_AT_BAYN_COPY);
      for (const v of values) {
        const trimmed = v.trim();
        expect(trimmed.length).toBeGreaterThanOrEqual(1);
        expect(trimmed.length).toBeLessThanOrEqual(240);
        expect(trimmed.toLowerCase()).not.toContain("lorem");
        expect(trimmed.toLowerCase()).not.toContain("ipsum");
      }
    });
  });

  describe("disjoint id sets across two factory invocations", () => {
    it("two consecutive calls produce completely disjoint id sets", () => {
      const template1 = lifeAtBaynTemplate();
      const template2 = lifeAtBaynTemplate();

      const ids1 = new Set(collectAllIds(template1));
      const ids2 = new Set(collectAllIds(template2));

      // Both sets should be non-empty
      expect(ids1.size).toBeGreaterThan(0);
      expect(ids2.size).toBeGreaterThan(0);

      // Intersection should be empty
      const intersection = [...ids1].filter((id) => ids2.has(id));
      expect(intersection).toHaveLength(0);
    });
  });

  describe("snapshot stability", () => {
    it("materialised template (with ids stripped) matches snapshot", () => {
      const template = lifeAtBaynTemplate();
      const stripped = stripIds(template.data);
      expect(stripped).toMatchSnapshot();
    });
  });
});
