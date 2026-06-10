/**
 * Tests for ora-project-page template factory.
 *
 * Validates: Requirements 3.1, 3.2, 3.5, 3.6, 3.7, 7.4, 9.3, 9.5
 */

import { describe, it, expect } from "vitest";
import { oraProjectPageTemplate } from "./ora-project-page";
import type { ComponentInstance } from "../../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all props.id values from the template's content and zones. */
function collectAllIds(template: ReturnType<typeof oraProjectPageTemplate>): string[] {
  const ids: string[] = [];
  for (const block of template.data.content) {
    ids.push(block.props.id);
  }
  if (template.data.zones) {
    for (const children of Object.values(template.data.zones)) {
      for (const block of children) {
        ids.push(block.props.id);
      }
    }
  }
  return ids;
}

/** Get all text content from Heading, Text, Quote, and Button blocks. */
function collectCopyStrings(template: ReturnType<typeof oraProjectPageTemplate>): string[] {
  const texts: string[] = [];
  const allBlocks: ComponentInstance[] = [
    ...template.data.content,
    ...(template.data.zones ? Object.values(template.data.zones).flat() : []),
  ];

  for (const block of allBlocks) {
    if (block.type === "Heading" || block.type === "Button") {
      const text = block.props.text as string | undefined;
      if (text) texts.push(text);
    } else if (block.type === "Text") {
      const content = block.props.content as string | undefined;
      if (content) texts.push(content);
    } else if (block.type === "Quote") {
      const text = block.props.text as string | undefined;
      if (text) texts.push(text);
    }
  }

  return texts;
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

describe("oraProjectPageTemplate", () => {
  it("returns id 'ora-project-page'", () => {
    const template = oraProjectPageTemplate();
    expect(template.id).toBe("ora-project-page");
  });

  it("sequence length is between 4 and 8 (Req 3.1)", () => {
    const template = oraProjectPageTemplate();
    const sectionCount = template.data.content.length;
    expect(sectionCount).toBeGreaterThanOrEqual(4);
    expect(sectionCount).toBeLessThanOrEqual(8);
  });

  describe("first Section is hero with image-hero variant (Req 3.3, 7.4)", () => {
    it("first Section _archetype is 'hero'", () => {
      const template = oraProjectPageTemplate();
      const firstSection = template.data.content[0];
      expect(firstSection.props._archetype).toBe("hero");
    });

    it("first Section uses image-hero variant (bgMode='solid', bgMediaType='image', non-empty bgImage)", () => {
      const template = oraProjectPageTemplate();
      const firstSection = template.data.content[0];
      expect(firstSection.props.bgMode).toBe("solid");
      expect(firstSection.props.bgMediaType).toBe("image");
      expect(firstSection.props.bgImage).toBeTruthy();
      expect((firstSection.props.bgImage as string).trim().length).toBeGreaterThan(0);
    });
  });

  it("last Section _archetype is 'cta' (Req 3.5)", () => {
    const template = oraProjectPageTemplate();
    const lastSection = template.data.content[template.data.content.length - 1];
    expect(lastSection.props._archetype).toBe("cta");
  });

  describe("every required archetype is present per Req 3.2", () => {
    it("includes at least one split-content Section", () => {
      const template = oraProjectPageTemplate();
      const archetypes = template.data.content.map((s) => s.props._archetype);
      expect(archetypes).toContain("split-content");
    });

    it("includes at least one quote-feature Section", () => {
      const template = oraProjectPageTemplate();
      const archetypes = template.data.content.map((s) => s.props._archetype);
      expect(archetypes).toContain("quote-feature");
    });

    it("includes at least one image+text/text+image/heading+full-width-image/heading+accordions Section", () => {
      const template = oraProjectPageTemplate();
      const archetypes = template.data.content.map((s) => s.props._archetype);
      const hasBodySection = archetypes.some(
        (a) =>
          a === "image+text" ||
          a === "text+image" ||
          a === "heading+full-width-image" ||
          a === "heading+accordions"
      );
      expect(hasBodySection).toBe(true);
    });

    it("includes at least one cta Section with a Button block", () => {
      const template = oraProjectPageTemplate();
      const ctaSections = template.data.content.filter(
        (s) => s.props._archetype === "cta"
      );
      expect(ctaSections.length).toBeGreaterThanOrEqual(1);

      // Verify the CTA section has a Button block in its zones
      const ctaSection = ctaSections[0];
      const ctaId = ctaSection.props.id;
      const zones = template.data.zones ?? {};
      const allZoneBlocks = Object.entries(zones)
        .filter(([key]) => key.startsWith(`${ctaId}:`))
        .flatMap(([, blocks]) => blocks);

      // Walk deeper into nested zones (Container content)
      const containerBlock = allZoneBlocks.find((b) => b.type === "Container");
      if (containerBlock) {
        const containerContent = zones[`${containerBlock.props.id}:container-content`] ?? [];
        const hasButton = containerContent.some((b) => b.type === "Button");
        expect(hasButton).toBe(true);
      }
    });
  });

  describe("disjoint id sets across two consecutive invocations (Req 9.3, 9.5)", () => {
    it("two factory calls produce completely disjoint id sets", () => {
      const template1 = oraProjectPageTemplate();
      const template2 = oraProjectPageTemplate();

      const ids1 = new Set(collectAllIds(template1));
      const ids2 = new Set(collectAllIds(template2));

      // Verify no overlap
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });
  });

  describe("copy keyword-and-length checks (Req 3.6, 3.7)", () => {
    it("at least one copy string contains 'project' (case-insensitive)", () => {
      const template = oraProjectPageTemplate();
      const texts = collectCopyStrings(template);
      const hasProject = texts.some((t) => t.toLowerCase().includes("project"));
      expect(hasProject).toBe(true);
    });

    it("no copy string contains 'lorem' or 'ipsum' (case-insensitive)", () => {
      const template = oraProjectPageTemplate();
      const texts = collectCopyStrings(template);
      for (const text of texts) {
        expect(text.toLowerCase()).not.toContain("lorem");
        expect(text.toLowerCase()).not.toContain("ipsum");
      }
    });

    it("every copy string has trimmed length between 1 and 240", () => {
      const template = oraProjectPageTemplate();
      const texts = collectCopyStrings(template);
      expect(texts.length).toBeGreaterThan(0);
      for (const text of texts) {
        const trimmed = text.trim();
        expect(trimmed.length).toBeGreaterThanOrEqual(1);
        expect(trimmed.length).toBeLessThanOrEqual(240);
      }
    });
  });

  describe("snapshot stability", () => {
    it("materialised template (with ids stripped) matches snapshot", () => {
      const template = oraProjectPageTemplate();
      const stripped = stripIds(template.data);
      expect(stripped).toMatchSnapshot();
    });
  });
});
