import { describe, it, expect } from "vitest";
import type { ComponentInstance } from "../../types";
import type { SectionTree } from "./section-archetypes";
import {
  buildHero,
  buildImageText,
  buildTextImage,
  buildHeadingFullWidthImage,
  buildHeadingAccordions,
  buildSplitContent,
  buildCta,
  buildQuoteFeature,
} from "./section-archetypes";
import { ORA_PAGE_TEMPLATE_GRADIENTS } from "./archetype-defaults";

// ─── Shared test fixtures ───────────────────────────────────────────────────

const gradientBg = { kind: "gradient" as const, pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] };
const gradientHeroBg = { kind: "gradient-hero" as const, pair: ORA_PAGE_TEMPLATE_GRADIENTS["navy-cyan"] };
const imageHeroBg = { kind: "image-hero" as const, src: "https://example.com/hero.jpg" };

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all props.id values from a SectionTree. */
function collectIds(tree: SectionTree): string[] {
  const ids: string[] = [];
  for (const block of tree.content) {
    ids.push(block.props.id as string);
  }
  for (const children of Object.values(tree.zones)) {
    for (const block of children) {
      ids.push(block.props.id as string);
    }
  }
  return ids;
}

/** Collect all block types from a SectionTree (flat). */
function collectTypes(tree: SectionTree): string[] {
  const types: string[] = [];
  for (const block of tree.content) {
    types.push(block.type);
  }
  for (const children of Object.values(tree.zones)) {
    for (const block of children) {
      types.push(block.type);
    }
  }
  return types;
}

/** Check that a value has both desktop and mobile keys. */
function hasBreakpointKeys(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "desktop" in obj && "mobile" in obj;
}

/** Known breakpoint-aware field names that appear on blocks in this module. */
const BREAKPOINT_AWARE_FIELDS = new Set([
  "_padding",
  "_margin",
  "_border",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "aspectRatio",
  "imgWidth",
  "imgHeight",
  "columnGap",
  "rowGap",
  "btnPadding",
]);

/** Check all breakpoint-aware fields on all blocks in a SectionTree. */
function assertBreakpointFieldsPopulated(tree: SectionTree) {
  const allBlocks: ComponentInstance[] = [
    ...tree.content,
    ...Object.values(tree.zones).flat(),
  ];

  for (const block of allBlocks) {
    for (const [key, value] of Object.entries(block.props)) {
      if (key === "id") continue;
      if (BREAKPOINT_AWARE_FIELDS.has(key) && value !== undefined && value !== null) {
        expect(
          hasBreakpointKeys(value),
          `Block ${block.type} (${block.props.id}): field "${key}" should have desktop and mobile keys, got: ${JSON.stringify(value)}`
        ).toBe(true);
      }
    }
  }
}

// ─── buildHero ──────────────────────────────────────────────────────────────

describe("buildHero", () => {
  const opts = {
    sectionId: "hero",
    background: imageHeroBg,
    heading: { text: "Welcome" },
    subtitle: { text: "Subtitle text" },
    cta: { text: "Learn More", url: "/learn" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildHero(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'hero'", () => {
    const tree = buildHero(opts);
    expect(tree.content[0].props._archetype).toBe("hero");
  });

  it("block tree composition: Section > Container > Heading + Text + Button", () => {
    const tree = buildHero(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent[0].type).toBe("Heading");
    expect(containerContent[1].type).toBe("Text");
    expect(containerContent[2].type).toBe("Button");
  });

  it("block tree without optional Button when cta is omitted", () => {
    const tree = buildHero({ ...opts, cta: undefined });
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(2);
    expect(containerContent[0].type).toBe("Heading");
    expect(containerContent[1].type).toBe("Text");
  });

  it("contains no block types other than Section, Container, Heading, Text, Button", () => {
    const tree = buildHero(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Heading", "Text", "Button"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildHero(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildHero(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildImageText ─────────────────────────────────────────────────────────

describe("buildImageText", () => {
  const opts = {
    sectionId: "img-text",
    background: gradientBg,
    imageSide: "left" as const,
    image: { src: "https://example.com/img.jpg", alt: "Test image" },
    heading: { text: "Heading", level: "h2" as const },
    text: { content: "Body text" },
    cta: { text: "Click", url: "/click" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildImageText(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'image+text'", () => {
    const tree = buildImageText(opts);
    expect(tree.content[0].props._archetype).toBe("image+text");
  });

  it("block tree: Section > Container > Columns(2) with col0=Image, col1=Heading+Text+Button", () => {
    const tree = buildImageText(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(1);
    expect(containerContent[0].type).toBe("Columns");

    const columnsId = containerContent[0].props.id as string;
    const col0 = tree.zones[`${columnsId}:column-0`];
    const col1 = tree.zones[`${columnsId}:column-1`];

    expect(col0).toHaveLength(1);
    expect(col0[0].type).toBe("Image");

    expect(col1[0].type).toBe("Heading");
    expect(col1[1].type).toBe("Text");
    expect(col1[2].type).toBe("Button");
  });

  it("without optional Button when cta is omitted", () => {
    const tree = buildImageText({ ...opts, cta: undefined });
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    const columnsId = containerContent[0].props.id as string;
    const col1 = tree.zones[`${columnsId}:column-1`];
    expect(col1).toHaveLength(2);
    expect(col1[0].type).toBe("Heading");
    expect(col1[1].type).toBe("Text");
  });

  it("contains no block types other than Section, Container, Columns, Image, Heading, Text, Button", () => {
    const tree = buildImageText(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Columns", "Image", "Heading", "Text", "Button"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildImageText(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildImageText(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildTextImage ─────────────────────────────────────────────────────────

describe("buildTextImage", () => {
  const opts = {
    sectionId: "text-img",
    background: gradientBg,
    imageSide: "right" as const,
    image: { src: "https://example.com/img.jpg", alt: "Test image" },
    heading: { text: "Heading", level: "h3" as const },
    text: { content: "Body text" },
    cta: { text: "Click", url: "/click" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildTextImage(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'text+image'", () => {
    const tree = buildTextImage(opts);
    expect(tree.content[0].props._archetype).toBe("text+image");
  });

  it("block tree: Section > Container > Columns(2) with col0=Heading+Text+Button, col1=Image", () => {
    const tree = buildTextImage(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(1);
    expect(containerContent[0].type).toBe("Columns");

    const columnsId = containerContent[0].props.id as string;
    const col0 = tree.zones[`${columnsId}:column-0`];
    const col1 = tree.zones[`${columnsId}:column-1`];

    expect(col0[0].type).toBe("Heading");
    expect(col0[1].type).toBe("Text");
    expect(col0[2].type).toBe("Button");

    expect(col1).toHaveLength(1);
    expect(col1[0].type).toBe("Image");
  });

  it("without optional Button when cta is omitted", () => {
    const tree = buildTextImage({ ...opts, cta: undefined });
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    const columnsId = containerContent[0].props.id as string;
    const col0 = tree.zones[`${columnsId}:column-0`];
    expect(col0).toHaveLength(2);
    expect(col0[0].type).toBe("Heading");
    expect(col0[1].type).toBe("Text");
  });

  it("contains no block types other than Section, Container, Columns, Image, Heading, Text, Button", () => {
    const tree = buildTextImage(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Columns", "Image", "Heading", "Text", "Button"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildTextImage(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildTextImage(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildHeadingFullWidthImage ─────────────────────────────────────────────

describe("buildHeadingFullWidthImage", () => {
  const opts = {
    sectionId: "full-img",
    background: gradientBg,
    heading: { text: "Full Width", level: "h2" as const },
    text: { content: "Description" },
    image: { src: "https://example.com/wide.jpg", alt: "Wide image" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildHeadingFullWidthImage(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'heading+full-width-image'", () => {
    const tree = buildHeadingFullWidthImage(opts);
    expect(tree.content[0].props._archetype).toBe("heading+full-width-image");
  });

  it("block tree: Section > Container > Heading + Text + Image", () => {
    const tree = buildHeadingFullWidthImage(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(3);
    expect(containerContent[0].type).toBe("Heading");
    expect(containerContent[1].type).toBe("Text");
    expect(containerContent[2].type).toBe("Image");
  });

  it("Image block has imgWidth=100% for both breakpoints", () => {
    const tree = buildHeadingFullWidthImage(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    const image = containerContent[2];
    expect(image.props.imgWidth).toEqual({ desktop: "100%", mobile: "100%" });
  });

  it("contains no block types other than Section, Container, Heading, Text, Image", () => {
    const tree = buildHeadingFullWidthImage(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Heading", "Text", "Image"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildHeadingFullWidthImage(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildHeadingFullWidthImage(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildHeadingAccordions ─────────────────────────────────────────────────

describe("buildHeadingAccordions", () => {
  const opts = {
    sectionId: "accordions",
    background: gradientBg,
    heading: { text: "FAQ", level: "h2" as const },
    text: { content: "Common questions" },
    accordions: {
      items: [
        { title: "Question 1", body: "Answer 1" },
        { title: "Question 2", body: "Answer 2" },
        { title: "Question 3", body: "Answer 3" },
      ],
    },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildHeadingAccordions(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'heading+accordions'", () => {
    const tree = buildHeadingAccordions(opts);
    expect(tree.content[0].props._archetype).toBe("heading+accordions");
  });

  it("block tree: Section > Container > Heading + Text + AccordionGroup", () => {
    const tree = buildHeadingAccordions(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(3);
    expect(containerContent[0].type).toBe("Heading");
    expect(containerContent[1].type).toBe("Text");
    expect(containerContent[2].type).toBe("AccordionGroup");
  });

  it("contains no block types other than Section, Container, Heading, Text, AccordionGroup", () => {
    const tree = buildHeadingAccordions(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Heading", "Text", "AccordionGroup"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildHeadingAccordions(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildHeadingAccordions(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildSplitContent ──────────────────────────────────────────────────────

describe("buildSplitContent", () => {
  const opts = {
    sectionId: "split",
    background: gradientBg,
    imageSide: "left" as const,
    image: { src: "https://example.com/split.jpg", alt: "Split image" },
    quote: { text: "A great quote" },
    body: { content: "Body content" },
    cta: { text: "Download", url: "/download" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildSplitContent(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'split-content'", () => {
    const tree = buildSplitContent(opts);
    expect(tree.content[0].props._archetype).toBe("split-content");
  });

  it("block tree with imageSide=left: col0=Image, col1=Quote+Text+Button", () => {
    const tree = buildSplitContent(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(1);
    expect(containerContent[0].type).toBe("Columns");

    const columnsId = containerContent[0].props.id as string;
    const col0 = tree.zones[`${columnsId}:column-0`];
    const col1 = tree.zones[`${columnsId}:column-1`];

    expect(col0).toHaveLength(1);
    expect(col0[0].type).toBe("Image");

    expect(col1).toHaveLength(3);
    expect(col1[0].type).toBe("Quote");
    expect(col1[1].type).toBe("Text");
    expect(col1[2].type).toBe("Button");
  });

  it("block tree with imageSide=right: col0=Quote+Text+Button, col1=Image", () => {
    const tree = buildSplitContent({ ...opts, imageSide: "right" });
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    const columnsId = containerContent[0].props.id as string;
    const col0 = tree.zones[`${columnsId}:column-0`];
    const col1 = tree.zones[`${columnsId}:column-1`];

    expect(col0).toHaveLength(3);
    expect(col0[0].type).toBe("Quote");
    expect(col0[1].type).toBe("Text");
    expect(col0[2].type).toBe("Button");

    expect(col1).toHaveLength(1);
    expect(col1[0].type).toBe("Image");
  });

  it("contains no block types other than Section, Container, Columns, Image, Quote, Text, Button", () => {
    const tree = buildSplitContent(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Columns", "Image", "Quote", "Text", "Button"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildSplitContent(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildSplitContent(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildCta ───────────────────────────────────────────────────────────────

describe("buildCta", () => {
  const opts = {
    sectionId: "cta",
    background: gradientBg,
    heading: { text: "Ready?", level: "h2" as const },
    body: { content: "Take the next step" },
    cta: { text: "Get Started", url: "/start" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildCta(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'cta'", () => {
    const tree = buildCta(opts);
    expect(tree.content[0].props._archetype).toBe("cta");
  });

  it("block tree: Section > Container(contentAlign=center) > Heading + Text + Button", () => {
    const tree = buildCta(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");
    expect(containerZone[0].props.contentAlign).toBe("center");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(3);
    expect(containerContent[0].type).toBe("Heading");
    expect(containerContent[1].type).toBe("Text");
    expect(containerContent[2].type).toBe("Button");
  });

  it("contains no block types other than Section, Container, Heading, Text, Button", () => {
    const tree = buildCta(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Heading", "Text", "Button"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildCta(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildCta(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── buildQuoteFeature ──────────────────────────────────────────────────────

describe("buildQuoteFeature", () => {
  const opts = {
    sectionId: "quote",
    background: gradientBg,
    quote: { text: "An inspiring quote" },
  };

  it("returns exactly one top-level Section in content", () => {
    const tree = buildQuoteFeature(opts);
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0].type).toBe("Section");
  });

  it("_archetype tag matches 'quote-feature'", () => {
    const tree = buildQuoteFeature(opts);
    expect(tree.content[0].props._archetype).toBe("quote-feature");
  });

  it("block tree: Section > Container > Quote (only)", () => {
    const tree = buildQuoteFeature(opts);
    const sectionId = tree.content[0].props.id as string;
    const containerZone = tree.zones[`${sectionId}:section-content`];
    expect(containerZone).toHaveLength(1);
    expect(containerZone[0].type).toBe("Container");

    const containerId = containerZone[0].props.id as string;
    const containerContent = tree.zones[`${containerId}:container-content`];
    expect(containerContent).toHaveLength(1);
    expect(containerContent[0].type).toBe("Quote");
  });

  it("contains no block types other than Section, Container, Quote", () => {
    const tree = buildQuoteFeature(opts);
    const types = collectTypes(tree);
    const allowed = new Set(["Section", "Container", "Quote"]);
    for (const t of types) {
      expect(allowed.has(t), `Unexpected type: ${t}`).toBe(true);
    }
  });

  it("all breakpoint-aware fields populated for both breakpoints", () => {
    const tree = buildQuoteFeature(opts);
    assertBreakpointFieldsPopulated(tree);
  });

  it("all ids are unique within the returned tree", () => {
    const tree = buildQuoteFeature(opts);
    const ids = collectIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
