/**
 * Tests for ORA page template validator.
 *
 * Each rule is tested with at least one passing input and one failing input.
 * Uses small synthetic templates rather than the real four templates so each
 * rule's failure path is isolated.
 *
 * Validates: Requirements 1.11, 2.3, 3.5, 3.6, 3.7, 6.2, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 8.1–8.4
 */

import { describe, it, expect } from "vitest";
import { validateOraPageTemplate } from "./validate";
import type { PageTemplate } from "../index";
import type { ComponentInstance, PageData } from "../../types";
import { ORA_PAGE_TEMPLATE_PALETTE } from "./archetype-defaults";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let idCounter = 0;
function uid(): string {
  return `test-id-${++idCounter}`;
}

/**
 * Creates a minimal valid Section with gradient background and a hero archetype.
 * This is the base building block for synthetic templates.
 */
function makeGradientSection(
  archetype: string,
  children: ComponentInstance[] = [],
  overrides: Record<string, unknown> = {}
): { section: ComponentInstance; zones: Record<string, ComponentInstance[]> } {
  const sectionId = uid();
  const containerId = uid();

  const section: ComponentInstance = {
    type: "Section",
    props: {
      id: sectionId,
      _archetype: archetype,
      bgMode: "gradient",
      bgMediaType: "none",
      bgImage: "",
      gradientFrom: "#F9F7F5",
      gradientTo: "#EBE7E2",
      _padding: {
        desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
        mobile: { paddingTop: "64", paddingBottom: "64", paddingLeft: "16", paddingRight: "16" },
      },
      ...overrides,
    },
  };

  const container: ComponentInstance = {
    type: "Container",
    props: {
      id: containerId,
      maxWidth: "1200",
      contentAlign: "center",
      _padding: {
        desktop: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
        mobile: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
      },
    },
  };

  // Default children based on archetype
  let defaultChildren = children;
  if (children.length === 0) {
    defaultChildren = getDefaultChildrenForArchetype(archetype);
  }

  const zones: Record<string, ComponentInstance[]> = {
    [`${sectionId}:section-content`]: [container],
    [`${containerId}:container-content`]: defaultChildren,
  };

  return { section, zones };
}

function getDefaultChildrenForArchetype(archetype: string): ComponentInstance[] {
  switch (archetype) {
    case "hero":
      return [makeHeading("Hero Title", "h1")];
    case "image+text":
    case "text+image":
      return [makeColumns()];
    case "heading+full-width-image":
      return [makeHeading("Title", "h2"), makeImage()];
    case "heading+accordions":
      return [makeHeading("Title", "h2"), makeAccordionGroup()];
    case "split-content":
      return [makeColumns()];
    case "cta":
      return [makeHeading("Call to action", "h2"), makeButton("Click here")];
    case "quote-feature":
      return [makeQuote("A meaningful quote")];
    default:
      return [makeHeading("Default", "h2")];
  }
}

function makeHeading(text: string, level: string = "h1"): ComponentInstance {
  return {
    type: "Heading",
    props: {
      id: uid(),
      text,
      level,
      fontSize: { desktop: 64, mobile: 40 },
    },
  };
}

function makeText(content: string): ComponentInstance {
  return {
    type: "Text",
    props: {
      id: uid(),
      content,
      fontSize: { desktop: 18, mobile: 16 },
    },
  };
}

function makeButton(text: string): ComponentInstance {
  return {
    type: "Button",
    props: {
      id: uid(),
      text,
    },
  };
}

function makeQuote(text: string): ComponentInstance {
  return {
    type: "Quote",
    props: {
      id: uid(),
      text,
      fontSize: { desktop: 16, mobile: 16 },
    },
  };
}

function makeImage(): ComponentInstance {
  return {
    type: "Image",
    props: {
      id: uid(),
      src: "https://example.com/image.jpg",
      alt: "Test image",
      imgWidth: { desktop: "100%", mobile: "100%" },
    },
  };
}

function makeColumns(): ComponentInstance {
  return {
    type: "Columns",
    props: {
      id: uid(),
      columnGap: { desktop: "32px", mobile: "0px" },
      rowGap: { desktop: "32px", mobile: "24px" },
    },
  };
}

function makeAccordionGroup(): ComponentInstance {
  return {
    type: "AccordionGroup",
    props: {
      id: uid(),
      items: [
        { title: "Question one", body: "Answer one" },
        { title: "Question two", body: "Answer two" },
        { title: "Question three", body: "Answer three" },
      ],
    },
  };
}

/**
 * Creates a minimal valid image-hero Section (bgMode: "solid", bgMediaType: "image", non-empty bgImage).
 */
function makeImageHeroSection(
  archetype: string = "hero",
  children: ComponentInstance[] = [],
  overrides: Record<string, unknown> = {}
): { section: ComponentInstance; zones: Record<string, ComponentInstance[]> } {
  return makeGradientSection(archetype, children.length > 0 ? children : undefined!, {
    bgMode: "solid",
    bgMediaType: "image",
    bgImage: "https://example.com/hero.jpg",
    gradientFrom: undefined,
    gradientTo: undefined,
    ...overrides,
  });
}

/**
 * Builds a complete synthetic PageTemplate from section descriptors.
 */
function buildTemplate(
  id: string,
  sections: { section: ComponentInstance; zones: Record<string, ComponentInstance[]> }[]
): PageTemplate {
  const content: ComponentInstance[] = [];
  const zones: Record<string, ComponentInstance[]> = {};

  for (const s of sections) {
    content.push(s.section);
    Object.assign(zones, s.zones);
  }

  return {
    id,
    name: "Test Template",
    description: "A synthetic test template",
    thumbnailId: "",
    data: {
      root: { props: { title: "Test" } },
      content,
      zones,
    },
  };
}

/**
 * Builds a minimal valid ora-project-page template that passes all rules.
 * Uses the real factory structure but with minimal content.
 */
function makeValidOraProjectPage(): PageTemplate {
  const hero = makeImageHeroSection("hero", [makeHeading("Project showcase", "h1")]);
  const body = makeGradientSection("image+text", [makeColumns()]);
  const cta = makeGradientSection("cta", [makeHeading("Reserve your project", "h2"), makeButton("Reserve now")]);

  return buildTemplate("ora-project-page", [hero, body, cta]);
}

/**
 * Builds a minimal valid about-ora template with exactly 7 sections in fixed order.
 */
function makeValidAboutOra(): PageTemplate {
  const hero = makeGradientSection("hero", [makeHeading("About ORA", "h1")]);
  const textImage = makeGradientSection("text+image", [makeColumns()]);
  const imageText = makeGradientSection("image+text", [makeColumns()]);
  const headingImage = makeGradientSection("heading+full-width-image", [makeHeading("Where we build", "h2"), makeImage()]);
  const headingAccordions = makeGradientSection("heading+accordions", [makeHeading("FAQ", "h2"), makeAccordionGroup()]);
  const pos6 = makeGradientSection("image+text", [makeColumns()]);
  const pos7 = makeGradientSection("text+image", [makeColumns()]);

  return buildTemplate("about-ora", [hero, textImage, imageText, headingImage, headingAccordions, pos6, pos7]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("validateOraPageTemplate", () => {
  // ─── Rule: schema.page-data ─────────────────────────────────────────────

  describe("rule: schema.page-data", () => {
    it("passes with valid page data structure", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hello", "h1")])]);
      const result = validateOraPageTemplate(template);
      const schemaErrors = result.errors.filter((e) => e.rule === "schema.page-data");
      expect(schemaErrors).toHaveLength(0);
    });

    it("fails when content item has empty type", () => {
      const template: PageTemplate = {
        id: "test",
        name: "Test",
        description: "Test",
        thumbnailId: "",
        data: {
          root: { props: { title: "Test" } },
          content: [{ type: "", props: { id: "abc" } }],
        },
      };
      const result = validateOraPageTemplate(template);
      const schemaErrors = result.errors.filter((e) => e.rule === "schema.page-data");
      expect(schemaErrors.length).toBeGreaterThan(0);
      expect(schemaErrors[0].blockId).toBeNull();
    });
  });

  // ─── Rule: archetype.tag-present ────────────────────────────────────────

  describe("rule: archetype.tag-present", () => {
    it("passes when all Sections have valid _archetype tags", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hi", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.tag-present");
      expect(errors).toHaveLength(0);
    });

    it("fails when a Section has no _archetype tag", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      delete (section.props as Record<string, unknown>)._archetype;
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.tag-present");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("_archetype");
    });

    it("fails when a Section has an invalid _archetype value", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props._archetype = "invalid-archetype";
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.tag-present");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
    });
  });

  // ─── Rule: archetype.composition-match ──────────────────────────────────

  describe("rule: archetype.composition-match", () => {
    it("passes when hero Section contains a Heading", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Title", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.composition-match");
      expect(errors).toHaveLength(0);
    });

    it("fails when hero Section is missing a Heading", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeText("No heading here")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.composition-match");
      expect(errors).toHaveLength(1);
      expect(errors[0].fieldPath).toContain("container-content");
    });

    it("fails when cta Section is missing a Button", () => {
      const template = buildTemplate("test", [makeGradientSection("cta", [makeHeading("CTA", "h2")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.composition-match");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(template.data.content[0].props.id);
    });

    it("fails when image+text Section is missing Columns", () => {
      const template = buildTemplate("test", [makeGradientSection("image+text", [makeHeading("Title", "h2")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "archetype.composition-match");
      expect(errors).toHaveLength(1);
    });
  });

  // ─── Rule: bgMode.allowed ──────────────────────────────────────────────

  describe("rule: bgMode.allowed", () => {
    it("passes with gradient bgMode", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hi", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "bgMode.allowed");
      expect(errors).toHaveLength(0);
    });

    it("passes with solid bgMode + image bgMediaType + non-empty bgImage", () => {
      const template = buildTemplate("test", [
        makeImageHeroSection("hero", [makeHeading("Hi", "h1")]),
      ]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "bgMode.allowed");
      expect(errors).toHaveLength(0);
    });

    it("fails with solid bgMode but no bgImage", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props.bgMode = "solid";
      section.props.bgMediaType = "image";
      section.props.bgImage = "";
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "bgMode.allowed");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("bgMode");
      expect(errors[0].rule).toBe("bgMode.allowed");
    });
  });

  // ─── Rule: gradient.palette ─────────────────────────────────────────────

  describe("rule: gradient.palette", () => {
    it("passes when gradientFrom and gradientTo are in the palette", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hi", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "gradient.palette");
      expect(errors).toHaveLength(0);
    });

    it("fails when gradientFrom is not in the palette", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props.gradientFrom = "#FF0000";
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "gradient.palette");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("gradientFrom");
    });

    it("fails when gradientTo is not in the palette", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props.gradientTo = "#00FF00";
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "gradient.palette");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("gradientTo");
    });
  });

  // ─── Rule: image-hero.source-non-empty ──────────────────────────────────

  describe("rule: image-hero.source-non-empty", () => {
    it("passes when image-hero has a non-empty bgImage", () => {
      const template = buildTemplate("test", [
        makeImageHeroSection("hero", [makeHeading("Hi", "h1")]),
      ]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "image-hero.source-non-empty");
      expect(errors).toHaveLength(0);
    });

    it("fails when image-hero has an empty bgImage", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props.bgMode = "solid";
      section.props.bgMediaType = "image";
      section.props.bgImage = "   ";
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "image-hero.source-non-empty");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("bgImage");
    });
  });

  // ─── Rule: hero-variant.template-assignment ──────────────────────────────

  describe("rule: hero-variant.template-assignment", () => {
    it("passes when ora-project-page has image-hero as first Section", () => {
      const template = makeValidOraProjectPage();
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "hero-variant.template-assignment");
      expect(errors).toHaveLength(0);
    });

    it("fails when ora-project-page has gradient-hero instead of image-hero", () => {
      const hero = makeGradientSection("hero", [makeHeading("Project showcase", "h1")]);
      const body = makeGradientSection("image+text", [makeColumns()]);
      const cta = makeGradientSection("cta", [makeHeading("Reserve your project", "h2"), makeButton("Reserve")]);
      const template = buildTemplate("ora-project-page", [hero, body, cta]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "hero-variant.template-assignment");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(hero.section.props.id);
      expect(errors[0].fieldPath).toContain("bgMode");
    });

    it("passes when about-ora has gradient-hero as first Section", () => {
      const template = makeValidAboutOra();
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "hero-variant.template-assignment");
      expect(errors).toHaveLength(0);
    });

    it("fails when about-ora has image-hero instead of gradient-hero", () => {
      const hero = makeImageHeroSection("hero", [makeHeading("About ORA", "h1")]);
      const textImage = makeGradientSection("text+image", [makeColumns()]);
      const imageText = makeGradientSection("image+text", [makeColumns()]);
      const headingImage = makeGradientSection("heading+full-width-image", [makeHeading("Where", "h2"), makeImage()]);
      const headingAccordions = makeGradientSection("heading+accordions", [makeHeading("FAQ", "h2"), makeAccordionGroup()]);
      const pos6 = makeGradientSection("image+text", [makeColumns()]);
      const pos7 = makeGradientSection("text+image", [makeColumns()]);
      const template = buildTemplate("about-ora", [hero, textImage, imageText, headingImage, headingAccordions, pos6, pos7]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "hero-variant.template-assignment");
      expect(errors).toHaveLength(1);
      expect(errors[0].fieldPath).toContain("bgMode");
    });
  });

  // ─── Rule: breakpoint.completeness ──────────────────────────────────────

  describe("rule: breakpoint.completeness", () => {
    it("passes when all breakpoint-aware fields have desktop and mobile", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hi", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.completeness");
      expect(errors).toHaveLength(0);
    });

    it("fails when a breakpoint-aware field has null mobile value", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props._padding = { desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" }, mobile: null };
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.completeness");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("_padding.mobile");
    });
  });

  // ─── Rule: breakpoint.h1-mobile-bound ───────────────────────────────────

  describe("rule: breakpoint.h1-mobile-bound", () => {
    it("passes when h1 mobile fontSize is within 28-48", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 64, mobile: 40 };
      const template = buildTemplate("test", [makeGradientSection("hero", [heading])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-mobile-bound");
      expect(errors).toHaveLength(0);
    });

    it("fails when h1 mobile fontSize is below 28", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 64, mobile: 20 };
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-mobile-bound");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toBe("props.fontSize.mobile");
    });

    it("fails when h1 mobile fontSize is above 48", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 64, mobile: 52 };
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-mobile-bound");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toBe("props.fontSize.mobile");
    });
  });

  // ─── Rule: breakpoint.h1-desktop-bound ──────────────────────────────────

  describe("rule: breakpoint.h1-desktop-bound", () => {
    it("passes when h1 desktop fontSize is within 36-84", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 64, mobile: 40 };
      const template = buildTemplate("test", [makeGradientSection("hero", [heading])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-desktop-bound");
      expect(errors).toHaveLength(0);
    });

    it("fails when h1 desktop fontSize is below 36", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 30, mobile: 28 };
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-desktop-bound");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toBe("props.fontSize.desktop");
    });

    it("fails when h1 desktop fontSize is above 84", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 90, mobile: 40 };
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-desktop-bound");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toBe("props.fontSize.desktop");
    });
  });

  // ─── Rule: breakpoint.h1-monotone ─────────────────────────────────────────

  describe("rule: breakpoint.h1-monotone", () => {
    it("passes when h1 desktop fontSize >= mobile fontSize", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 64, mobile: 40 };
      const template = buildTemplate("test", [makeGradientSection("hero", [heading])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-monotone");
      expect(errors).toHaveLength(0);
    });

    it("fails when h1 desktop fontSize < mobile fontSize", () => {
      const heading = makeHeading("Title", "h1");
      heading.props.fontSize = { desktop: 36, mobile: 48 };
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.h1-monotone");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toBe("props.fontSize");
    });
  });

  // ─── Rule: breakpoint.section-padding-h ───────────────────────────────────

  describe("rule: breakpoint.section-padding-h", () => {
    it("passes when mobile horizontal padding is within 12-24", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hi", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.section-padding-h");
      expect(errors).toHaveLength(0);
    });

    it("fails when mobile paddingLeft is below 12", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props._padding = {
        desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
        mobile: { paddingTop: "64", paddingBottom: "64", paddingLeft: "8", paddingRight: "16" },
      };
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.section-padding-h");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("paddingLeft");
    });

    it("fails when mobile paddingRight is above 24", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props._padding = {
        desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
        mobile: { paddingTop: "64", paddingBottom: "64", paddingLeft: "16", paddingRight: "32" },
      };
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.section-padding-h");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("paddingRight");
    });
  });

  // ─── Rule: breakpoint.section-padding-v ───────────────────────────────────

  describe("rule: breakpoint.section-padding-v", () => {
    it("passes when mobile vertical padding is within 24-96", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Hi", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.section-padding-v");
      expect(errors).toHaveLength(0);
    });

    it("fails when mobile paddingTop is below 24", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props._padding = {
        desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
        mobile: { paddingTop: "16", paddingBottom: "64", paddingLeft: "16", paddingRight: "16" },
      };
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.section-padding-v");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("paddingTop");
    });

    it("fails when mobile paddingBottom is above 96", () => {
      const { section, zones } = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      section.props._padding = {
        desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
        mobile: { paddingTop: "64", paddingBottom: "120", paddingLeft: "16", paddingRight: "16" },
      };
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "breakpoint.section-padding-v");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(section.props.id);
      expect(errors[0].fieldPath).toContain("paddingBottom");
    });
  });

  // ─── Rule: copy.no-lorem-ipsum ─────────────────────────────────────────

  describe("rule: copy.no-lorem-ipsum", () => {
    it("passes when no text contains lorem or ipsum", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Real content", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.no-lorem-ipsum");
      expect(errors).toHaveLength(0);
    });

    it("fails when a Heading contains lorem", () => {
      const heading = makeHeading("Lorem ipsum dolor sit amet", "h1");
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.no-lorem-ipsum");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toContain("text");
    });

    it("fails when a Text block contains ipsum (case-insensitive)", () => {
      const text = makeText("This has IPSUM in it");
      const { section, zones } = makeGradientSection("hero", [makeHeading("Valid", "h1"), text]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.no-lorem-ipsum");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(text.props.id);
      expect(errors[0].fieldPath).toContain("content");
    });
  });

  // ─── Rule: copy.length-bounds ─────────────────────────────────────────────

  describe("rule: copy.length-bounds", () => {
    it("passes when text lengths are within bounds", () => {
      const template = buildTemplate("test", [makeGradientSection("hero", [makeHeading("Valid title", "h1")])]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.length-bounds");
      expect(errors).toHaveLength(0);
    });

    it("fails when a Heading text exceeds 240 characters", () => {
      const longText = "A".repeat(241);
      const heading = makeHeading(longText, "h1");
      const { section, zones } = makeGradientSection("hero", [heading]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.length-bounds");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(heading.props.id);
      expect(errors[0].fieldPath).toBe("props.text");
    });

    it("fails when a Text block content is empty", () => {
      const text = makeText("");
      const { section, zones } = makeGradientSection("hero", [makeHeading("Valid", "h1"), text]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.length-bounds");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(text.props.id);
      expect(errors[0].fieldPath).toBe("props.content");
    });

    it("fails when accordion item title exceeds 120 characters", () => {
      const accordion: ComponentInstance = {
        type: "AccordionGroup",
        props: {
          id: uid(),
          items: [
            { title: "B".repeat(121), body: "Valid body" },
          ],
        },
      };
      const { section, zones } = makeGradientSection("heading+accordions", [makeHeading("FAQ", "h2"), accordion]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.length-bounds");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(accordion.props.id);
      expect(errors[0].fieldPath).toContain("items[0].title");
    });

    it("fails when accordion item body exceeds 600 characters", () => {
      const accordion: ComponentInstance = {
        type: "AccordionGroup",
        props: {
          id: uid(),
          items: [
            { title: "Valid title", body: "C".repeat(601) },
          ],
        },
      };
      const { section, zones } = makeGradientSection("heading+accordions", [makeHeading("FAQ", "h2"), accordion]);
      const template = buildTemplate("test", [{ section, zones }]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.length-bounds");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(accordion.props.id);
      expect(errors[0].fieldPath).toContain("items[0].body");
    });
  });

  // ─── Rule: copy.archetype-keyword ─────────────────────────────────────────

  describe("rule: copy.archetype-keyword", () => {
    it("passes when ora-project-page copy contains 'project'", () => {
      const template = makeValidOraProjectPage();
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.archetype-keyword");
      expect(errors).toHaveLength(0);
    });

    it("fails when ora-project-page copy does not contain 'project'", () => {
      const hero = makeImageHeroSection("hero", [makeHeading("Welcome to our site", "h1")]);
      const body = makeGradientSection("image+text", [makeColumns()]);
      const cta = makeGradientSection("cta", [makeHeading("Get started", "h2"), makeButton("Go")]);
      const template = buildTemplate("ora-project-page", [hero, body, cta]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.archetype-keyword");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBeNull();
      expect(errors[0].fieldPath).toBe("data.content");
    });

    it("passes when about-ora has a Heading containing 'About ORA'", () => {
      const template = makeValidAboutOra();
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.archetype-keyword");
      expect(errors).toHaveLength(0);
    });

    it("fails when about-ora has no Heading containing 'About ORA'", () => {
      const hero = makeGradientSection("hero", [makeHeading("Welcome", "h1")]);
      const textImage = makeGradientSection("text+image", [makeColumns()]);
      const imageText = makeGradientSection("image+text", [makeColumns()]);
      const headingImage = makeGradientSection("heading+full-width-image", [makeHeading("Where", "h2"), makeImage()]);
      const headingAccordions = makeGradientSection("heading+accordions", [makeHeading("FAQ", "h2"), makeAccordionGroup()]);
      const pos6 = makeGradientSection("image+text", [makeColumns()]);
      const pos7 = makeGradientSection("text+image", [makeColumns()]);
      const template = buildTemplate("about-ora", [hero, textImage, imageText, headingImage, headingAccordions, pos6, pos7]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "copy.archetype-keyword");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBeNull();
      expect(errors[0].fieldPath).toBe("data.content");
    });
  });

  // ─── Rule: composition.cta-final ───────────────────────────────────────

  describe("rule: composition.cta-final", () => {
    it("passes when ora-project-page last Section has _archetype cta", () => {
      const template = makeValidOraProjectPage();
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.cta-final");
      expect(errors).toHaveLength(0);
    });

    it("fails when ora-project-page last Section is not cta", () => {
      const hero = makeImageHeroSection("hero", [makeHeading("Project showcase", "h1")]);
      const body = makeGradientSection("image+text", [makeColumns()]);
      // Last section is NOT cta
      const notCta = makeGradientSection("quote-feature", [makeQuote("A quote about the project")]);
      const template = buildTemplate("ora-project-page", [hero, body, notCta]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.cta-final");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBe(notCta.section.props.id);
      expect(errors[0].fieldPath).toContain("_archetype");
    });

    it("does not apply to non-ora-project-page templates", () => {
      // A template with id "test" should not trigger this rule
      const section = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      const template = buildTemplate("test", [section]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.cta-final");
      expect(errors).toHaveLength(0);
    });
  });

  // ─── Rule: composition.fixed-order ────────────────────────────────────────

  describe("rule: composition.fixed-order", () => {
    it("passes when about-ora has exactly 7 Sections in the correct order", () => {
      const template = makeValidAboutOra();
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.fixed-order");
      expect(errors).toHaveLength(0);
    });

    it("fails when about-ora has wrong number of Sections", () => {
      const hero = makeGradientSection("hero", [makeHeading("About ORA", "h1")]);
      const textImage = makeGradientSection("text+image", [makeColumns()]);
      // Only 2 sections instead of 7
      const template = buildTemplate("about-ora", [hero, textImage]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.fixed-order");
      expect(errors).toHaveLength(1);
      expect(errors[0].blockId).toBeNull();
      expect(errors[0].fieldPath).toBe("data.content");
    });

    it("fails when about-ora has wrong archetype at a position", () => {
      const hero = makeGradientSection("hero", [makeHeading("About ORA", "h1")]);
      // Position 1 should be text+image, but we put image+text
      const wrongPos1 = makeGradientSection("image+text", [makeColumns()]);
      const imageText = makeGradientSection("image+text", [makeColumns()]);
      const headingImage = makeGradientSection("heading+full-width-image", [makeHeading("Where", "h2"), makeImage()]);
      const headingAccordions = makeGradientSection("heading+accordions", [makeHeading("FAQ", "h2"), makeAccordionGroup()]);
      const pos6 = makeGradientSection("image+text", [makeColumns()]);
      const pos7 = makeGradientSection("text+image", [makeColumns()]);
      const template = buildTemplate("about-ora", [hero, wrongPos1, imageText, headingImage, headingAccordions, pos6, pos7]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.fixed-order");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].blockId).toBe(wrongPos1.section.props.id);
      expect(errors[0].fieldPath).toContain("_archetype");
    });

    it("does not apply to non-about-ora templates", () => {
      const section = makeGradientSection("hero", [makeHeading("Hi", "h1")]);
      const template = buildTemplate("test", [section]);
      const result = validateOraPageTemplate(template);
      const errors = result.errors.filter((e) => e.rule === "composition.fixed-order");
      expect(errors).toHaveLength(0);
    });
  });

  // ─── Integration: real factory template passes all rules ──────────────────

  describe("integration", () => {
    it("a well-formed synthetic ora-project-page passes all rules", () => {
      const template = makeValidOraProjectPage();
      const result = validateOraPageTemplate(template);
      // Filter out rules that only apply to specific template ids
      const relevantErrors = result.errors.filter(
        (e) => e.rule !== "composition.fixed-order" && e.rule !== "copy.archetype-keyword"
      );
      // The template should pass schema, archetype, bgMode, gradient, breakpoint, and copy rules
      const passingRules = [
        "schema.page-data",
        "archetype.tag-present",
        "bgMode.allowed",
        "breakpoint.completeness",
        "breakpoint.h1-mobile-bound",
        "breakpoint.h1-desktop-bound",
        "breakpoint.h1-monotone",
        "breakpoint.section-padding-h",
        "breakpoint.section-padding-v",
        "copy.no-lorem-ipsum",
      ];
      for (const rule of passingRules) {
        const ruleErrors = result.errors.filter((e) => e.rule === rule);
        expect(ruleErrors, `Expected no errors for rule "${rule}"`).toHaveLength(0);
      }
    });
  });
});
