/**
 * ORA Page Template Validator
 *
 * Validates ORA page templates against the full set of brand and structural rules.
 *
 * Design reference: `.kiro/specs/ora-page-templates/design.md` Section "Error Handling"
 * Validates: Requirements 1.11, 2.3, 3.5, 3.6, 3.7, 6.2, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 8.1–8.4
 */

import type { PageTemplate } from "../index";
import type { ComponentInstance, PageData } from "../../types";
import { validatePageData } from "../../schema";
import { BREAKPOINT_AWARE_FIELDS } from "../../breakpoint-fields";
import { ORA_PAGE_TEMPLATE_PALETTE } from "./archetype-defaults";
import type { Archetype } from "./section-archetypes";

// ─── Public types ───────────────────────────────────────────────────────────

export interface OraValidationError {
  templateId: string;
  blockId: string | null;
  fieldPath: string;
  rule: string;
  message: string;
}

export interface OraValidationResult {
  success: boolean;
  errors: OraValidationError[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_ARCHETYPES: readonly Archetype[] = [
  "hero",
  "image+text",
  "text+image",
  "heading+full-width-image",
  "heading+accordions",
  "split-content",
  "cta",
  "quote-feature",
];

/** Hero variant assignments per Req 7.4 */
const HERO_VARIANT_MAP: Record<string, "image-hero" | "gradient-hero"> = {
  "ora-project-page": "image-hero",
  "why-bayn": "gradient-hero",
  "life-at-bayn": "image-hero",
  "about-ora": "gradient-hero",
};

/** About-ora fixed archetype order per Req 6.2 */
const ABOUT_ORA_ORDER: readonly (Archetype | Archetype[])[] = [
  "hero",
  "text+image",
  "image+text",
  "heading+full-width-image",
  "heading+accordions",
  ["image+text", "text+image"],
  ["image+text", "text+image"],
];


// ─── Helper utilities ───────────────────────────────────────────────────────

/** Collect all blocks from the page data tree (content + zones). */
function collectAllBlocks(data: PageData): ComponentInstance[] {
  const blocks: ComponentInstance[] = [...data.content];
  if (data.zones) {
    for (const zoneBlocks of Object.values(data.zones)) {
      blocks.push(...zoneBlocks);
    }
  }
  return blocks;
}

/** Get all blocks of a specific type from the tree. */
function getBlocksByType(data: PageData, type: string): ComponentInstance[] {
  return collectAllBlocks(data).filter((b) => b.type === type);
}

/** Get the zone children for a given block and zone name. */
function getZoneChildren(data: PageData, blockId: string, zoneName: string): ComponentInstance[] {
  const key = `${blockId}:${zoneName}`;
  return data.zones?.[key] ?? [];
}

/** Check if a value looks like a breakpoint-aware value (has desktop and mobile keys). */
function isBreakpointValue(val: unknown): val is { desktop: unknown; mobile: unknown } {
  return (
    val !== null &&
    val !== undefined &&
    typeof val === "object" &&
    "desktop" in val &&
    "mobile" in val
  );
}

/** Extract text content from a block based on its type. */
function getBlockTextContent(block: ComponentInstance): string[] {
  const texts: string[] = [];
  switch (block.type) {
    case "Heading":
      if (typeof block.props.text === "string") texts.push(block.props.text);
      break;
    case "Text":
      if (typeof block.props.content === "string") texts.push(block.props.content);
      break;
    case "Quote":
      if (typeof block.props.text === "string") texts.push(block.props.text);
      break;
    case "Button":
      if (typeof block.props.text === "string") texts.push(block.props.text);
      break;
    case "AccordionGroup":
      if (Array.isArray(block.props.items)) {
        for (const item of block.props.items as { title?: string; body?: string }[]) {
          if (typeof item.title === "string") texts.push(item.title);
          if (typeof item.body === "string") texts.push(item.body);
        }
      }
      break;
  }
  return texts;
}


// ─── Rule implementations ───────────────────────────────────────────────────

/** 8.2: Rule schema.page-data */
function ruleSchemaPageData(template: PageTemplate, errors: OraValidationError[]): void {
  const result = validatePageData(template.data);
  if (!result.success && result.errors) {
    for (const err of result.errors) {
      errors.push({
        templateId: template.id,
        blockId: null,
        fieldPath: err.path,
        rule: "schema.page-data",
        message: err.message,
      });
    }
  }
}

/** 8.3: Rule archetype.tag-present */
function ruleArchetypeTagPresent(template: PageTemplate, errors: OraValidationError[]): void {
  for (let i = 0; i < template.data.content.length; i++) {
    const section = template.data.content[i];
    if (section.type !== "Section") continue;
    const archetype = section.props._archetype;
    if (!archetype || !VALID_ARCHETYPES.includes(archetype as Archetype)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props._archetype`,
        rule: "archetype.tag-present",
        message: `Section must carry a valid _archetype tag. Got "${archetype ?? "undefined"}". Valid values: ${VALID_ARCHETYPES.join(", ")}`,
      });
    }
  }
}

/** 8.4: Rule archetype.composition-match */
function ruleArchetypeCompositionMatch(template: PageTemplate, errors: OraValidationError[]): void {
  const data = template.data;
  for (let i = 0; i < data.content.length; i++) {
    const section = data.content[i];
    if (section.type !== "Section") continue;
    const archetype = section.props._archetype as Archetype;
    if (!archetype || !VALID_ARCHETYPES.includes(archetype)) continue;

    const sectionId = section.props.id;
    const sectionChildren = getZoneChildren(data, sectionId, "section-content");

    // Every archetype expects Section > Container > ...
    const container = sectionChildren.find((c) => c.type === "Container");
    if (!container) {
      errors.push({
        templateId: template.id,
        blockId: sectionId,
        fieldPath: `zones['${sectionId}:section-content']`,
        rule: "archetype.composition-match",
        message: `Archetype "${archetype}" expects a Container as direct child of Section.`,
      });
      continue;
    }

    const containerId = container.props.id;
    const containerChildren = getZoneChildren(data, containerId, "container-content");
    const childTypes = containerChildren.map((c) => c.type);

    const compositionError = validateArchetypeComposition(archetype, childTypes, data, containerChildren);
    if (compositionError) {
      errors.push({
        templateId: template.id,
        blockId: sectionId,
        fieldPath: `zones['${containerId}:container-content']`,
        rule: "archetype.composition-match",
        message: compositionError,
      });
    }
  }
}

/** Validate the block-tree composition for a given archetype. */
function validateArchetypeComposition(
  archetype: Archetype,
  childTypes: string[],
  data: PageData,
  containerChildren: ComponentInstance[]
): string | null {
  switch (archetype) {
    case "hero": {
      // Heading required, optional Text, optional Button
      if (!childTypes.includes("Heading")) {
        return `Archetype "hero" requires at least a Heading block.`;
      }
      for (const t of childTypes) {
        if (t !== "Heading" && t !== "Text" && t !== "Button") {
          return `Archetype "hero" only allows Heading, Text, and Button blocks. Found "${t}".`;
        }
      }
      return null;
    }
    case "image+text":
    case "text+image": {
      // Columns block required
      if (!childTypes.includes("Columns")) {
        return `Archetype "${archetype}" requires a Columns block.`;
      }
      return null;
    }
    case "heading+full-width-image": {
      // Heading + Text + Image
      if (!childTypes.includes("Heading") || !childTypes.includes("Image")) {
        return `Archetype "heading+full-width-image" requires Heading and Image blocks.`;
      }
      return null;
    }
    case "heading+accordions": {
      // Heading + Text + AccordionGroup
      if (!childTypes.includes("Heading") || !childTypes.includes("AccordionGroup")) {
        return `Archetype "heading+accordions" requires Heading and AccordionGroup blocks.`;
      }
      return null;
    }
    case "split-content": {
      // Columns with Image in one col, Quote+Text+Button in the other
      if (!childTypes.includes("Columns")) {
        return `Archetype "split-content" requires a Columns block.`;
      }
      return null;
    }
    case "cta": {
      // Heading + Text + Button
      if (!childTypes.includes("Heading") || !childTypes.includes("Button")) {
        return `Archetype "cta" requires Heading and Button blocks.`;
      }
      return null;
    }
    case "quote-feature": {
      // Quote only
      if (!childTypes.includes("Quote")) {
        return `Archetype "quote-feature" requires a Quote block.`;
      }
      return null;
    }
    default:
      return null;
  }
}


/** 8.5: Rule bgMode.allowed */
function ruleBgModeAllowed(template: PageTemplate, errors: OraValidationError[]): void {
  for (let i = 0; i < template.data.content.length; i++) {
    const section = template.data.content[i];
    if (section.type !== "Section") continue;

    const bgMode = section.props.bgMode as string;
    const bgMediaType = section.props.bgMediaType as string;
    const bgImage = section.props.bgImage as string;

    if (bgMode === "gradient") {
      // Valid
      continue;
    }

    if (bgMode === "solid" && bgMediaType === "image" && typeof bgImage === "string" && bgImage.trim().length > 0) {
      // Valid image-hero
      continue;
    }

    errors.push({
      templateId: template.id,
      blockId: section.props.id,
      fieldPath: `content[${i}].props.bgMode`,
      rule: "bgMode.allowed",
      message: `Section bgMode must be "gradient" or ("solid" with bgMediaType="image" and non-empty bgImage). Got bgMode="${bgMode}", bgMediaType="${bgMediaType}", bgImage="${bgImage}".`,
    });
  }
}

/** 8.6: Rule gradient.palette */
function ruleGradientPalette(template: PageTemplate, errors: OraValidationError[]): void {
  const palette = ORA_PAGE_TEMPLATE_PALETTE as readonly string[];

  for (let i = 0; i < template.data.content.length; i++) {
    const section = template.data.content[i];
    if (section.type !== "Section") continue;
    if (section.props.bgMode !== "gradient") continue;

    const gradientFrom = section.props.gradientFrom as string;
    const gradientTo = section.props.gradientTo as string;

    if (!palette.includes(gradientFrom)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props.gradientFrom`,
        rule: "gradient.palette",
        message: `gradientFrom "${gradientFrom}" is not a member of ORA_PAGE_TEMPLATE_PALETTE.`,
      });
    }

    if (!palette.includes(gradientTo)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props.gradientTo`,
        rule: "gradient.palette",
        message: `gradientTo "${gradientTo}" is not a member of ORA_PAGE_TEMPLATE_PALETTE.`,
      });
    }
  }
}

/** 8.7: Rule image-hero.source-non-empty */
function ruleImageHeroSourceNonEmpty(template: PageTemplate, errors: OraValidationError[]): void {
  for (let i = 0; i < template.data.content.length; i++) {
    const section = template.data.content[i];
    if (section.type !== "Section") continue;

    const bgMode = section.props.bgMode as string;
    const bgMediaType = section.props.bgMediaType as string;

    // Only check image-hero sections
    if (bgMode !== "solid" || bgMediaType !== "image") continue;

    const bgImage = section.props.bgImage;
    if (typeof bgImage !== "string" || bgImage.trim().length === 0) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props.bgImage`,
        rule: "image-hero.source-non-empty",
        message: `Image-hero Section must have a non-empty bgImage. Got "${bgImage}".`,
      });
    }
  }
}


/** 8.8: Rule hero-variant.template-assignment */
function ruleHeroVariantTemplateAssignment(template: PageTemplate, errors: OraValidationError[]): void {
  const expectedVariant = HERO_VARIANT_MAP[template.id];
  if (!expectedVariant) return; // Not an ORA template we know about

  const firstSection = template.data.content[0];
  if (!firstSection || firstSection.type !== "Section") {
    errors.push({
      templateId: template.id,
      blockId: null,
      fieldPath: "content[0]",
      rule: "hero-variant.template-assignment",
      message: `Template "${template.id}" must have a Section as its first content item.`,
    });
    return;
  }

  const bgMode = firstSection.props.bgMode as string;
  const bgMediaType = firstSection.props.bgMediaType as string;
  const bgImage = firstSection.props.bgImage as string;

  let actualVariant: "image-hero" | "gradient-hero" | "unknown" = "unknown";
  if (bgMode === "solid" && bgMediaType === "image" && typeof bgImage === "string" && bgImage.trim().length > 0) {
    actualVariant = "image-hero";
  } else if (bgMode === "gradient") {
    actualVariant = "gradient-hero";
  }

  if (actualVariant !== expectedVariant) {
    errors.push({
      templateId: template.id,
      blockId: firstSection.props.id,
      fieldPath: "content[0].props.bgMode",
      rule: "hero-variant.template-assignment",
      message: `Template "${template.id}" hero variant must be "${expectedVariant}" but got "${actualVariant}".`,
    });
  }
}

/** 8.9: Rule breakpoint.completeness */
function ruleBreakpointCompleteness(template: PageTemplate, errors: OraValidationError[]): void {
  const allBlocks = collectAllBlocks(template.data);

  for (const block of allBlocks) {
    const blockId = block.props.id;

    for (const [propName, propValue] of Object.entries(block.props)) {
      if (propName === "id") continue;
      if (!BREAKPOINT_AWARE_FIELDS.has(propName)) continue;

      // Skip zone arrays (they are arrays of ComponentInstance, not breakpoint values)
      if (Array.isArray(propValue)) continue;

      // Only validate fields that are already structured as breakpoint-aware values.
      // Scalar values (e.g., minHeight: "auto") are allowed — the rule checks that
      // fields which ARE breakpoint-aware have complete desktop+mobile values.
      if (!isBreakpointValue(propValue)) continue;

      if (propValue.desktop === null || propValue.desktop === undefined) {
        errors.push({
          templateId: template.id,
          blockId,
          fieldPath: `props.${propName}.desktop`,
          rule: "breakpoint.completeness",
          message: `Block "${block.type}" (${blockId}) prop "${propName}" has null/undefined desktop value.`,
        });
      }

      if (propValue.mobile === null || propValue.mobile === undefined) {
        errors.push({
          templateId: template.id,
          blockId,
          fieldPath: `props.${propName}.mobile`,
          rule: "breakpoint.completeness",
          message: `Block "${block.type}" (${blockId}) prop "${propName}" has null/undefined mobile value.`,
        });
      }
    }
  }
}


/** 8.10: Rule breakpoint.h1-mobile-bound */
function ruleH1MobileBound(template: PageTemplate, errors: OraValidationError[]): void {
  const headings = getBlocksByType(template.data, "Heading");

  for (const heading of headings) {
    if (heading.props.level !== "h1") continue;

    const fontSize = heading.props.fontSize;
    if (!isBreakpointValue(fontSize)) continue;

    const mobileFontSize = typeof fontSize.mobile === "number" ? fontSize.mobile : Number(fontSize.mobile);
    if (isNaN(mobileFontSize) || mobileFontSize < 28 || mobileFontSize > 48) {
      errors.push({
        templateId: template.id,
        blockId: heading.props.id,
        fieldPath: `props.fontSize.mobile`,
        rule: "breakpoint.h1-mobile-bound",
        message: `h1 mobile fontSize must be between 28 and 48 inclusive. Got ${mobileFontSize}.`,
      });
    }
  }
}

/** 8.11: Rule breakpoint.h1-desktop-bound */
function ruleH1DesktopBound(template: PageTemplate, errors: OraValidationError[]): void {
  const headings = getBlocksByType(template.data, "Heading");

  for (const heading of headings) {
    if (heading.props.level !== "h1") continue;

    const fontSize = heading.props.fontSize;
    if (!isBreakpointValue(fontSize)) continue;

    const desktopFontSize = typeof fontSize.desktop === "number" ? fontSize.desktop : Number(fontSize.desktop);
    if (isNaN(desktopFontSize) || desktopFontSize < 36 || desktopFontSize > 84) {
      errors.push({
        templateId: template.id,
        blockId: heading.props.id,
        fieldPath: `props.fontSize.desktop`,
        rule: "breakpoint.h1-desktop-bound",
        message: `h1 desktop fontSize must be between 36 and 84 inclusive. Got ${desktopFontSize}.`,
      });
    }
  }
}

/** 8.12: Rule breakpoint.h1-monotone */
function ruleH1Monotone(template: PageTemplate, errors: OraValidationError[]): void {
  const headings = getBlocksByType(template.data, "Heading");

  for (const heading of headings) {
    if (heading.props.level !== "h1") continue;

    const fontSize = heading.props.fontSize;
    if (!isBreakpointValue(fontSize)) continue;

    const desktopFontSize = typeof fontSize.desktop === "number" ? fontSize.desktop : Number(fontSize.desktop);
    const mobileFontSize = typeof fontSize.mobile === "number" ? fontSize.mobile : Number(fontSize.mobile);

    if (!isNaN(desktopFontSize) && !isNaN(mobileFontSize) && desktopFontSize < mobileFontSize) {
      errors.push({
        templateId: template.id,
        blockId: heading.props.id,
        fieldPath: `props.fontSize`,
        rule: "breakpoint.h1-monotone",
        message: `h1 desktop fontSize (${desktopFontSize}) must be >= mobile fontSize (${mobileFontSize}).`,
      });
    }
  }
}


/** 8.13: Rule breakpoint.section-padding-h */
function ruleSectionPaddingH(template: PageTemplate, errors: OraValidationError[]): void {
  for (let i = 0; i < template.data.content.length; i++) {
    const section = template.data.content[i];
    if (section.type !== "Section") continue;

    const padding = section.props._padding;
    if (!isBreakpointValue(padding)) continue;

    const mobile = padding.mobile as { paddingLeft?: string; paddingRight?: string } | undefined;
    if (!mobile) continue;

    const paddingLeft = Number(mobile.paddingLeft);
    const paddingRight = Number(mobile.paddingRight);

    if (!isNaN(paddingLeft) && (paddingLeft < 12 || paddingLeft > 24)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props._padding.mobile.paddingLeft`,
        rule: "breakpoint.section-padding-h",
        message: `Section mobile paddingLeft must be between 12 and 24 inclusive. Got ${paddingLeft}.`,
      });
    }

    if (!isNaN(paddingRight) && (paddingRight < 12 || paddingRight > 24)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props._padding.mobile.paddingRight`,
        rule: "breakpoint.section-padding-h",
        message: `Section mobile paddingRight must be between 12 and 24 inclusive. Got ${paddingRight}.`,
      });
    }
  }
}

/** 8.14: Rule breakpoint.section-padding-v */
function ruleSectionPaddingV(template: PageTemplate, errors: OraValidationError[]): void {
  for (let i = 0; i < template.data.content.length; i++) {
    const section = template.data.content[i];
    if (section.type !== "Section") continue;

    const padding = section.props._padding;
    if (!isBreakpointValue(padding)) continue;

    const mobile = padding.mobile as { paddingTop?: string; paddingBottom?: string } | undefined;
    if (!mobile) continue;

    const paddingTop = Number(mobile.paddingTop);
    const paddingBottom = Number(mobile.paddingBottom);

    if (!isNaN(paddingTop) && (paddingTop < 24 || paddingTop > 96)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props._padding.mobile.paddingTop`,
        rule: "breakpoint.section-padding-v",
        message: `Section mobile paddingTop must be between 24 and 96 inclusive. Got ${paddingTop}.`,
      });
    }

    if (!isNaN(paddingBottom) && (paddingBottom < 24 || paddingBottom > 96)) {
      errors.push({
        templateId: template.id,
        blockId: section.props.id,
        fieldPath: `content[${i}].props._padding.mobile.paddingBottom`,
        rule: "breakpoint.section-padding-v",
        message: `Section mobile paddingBottom must be between 24 and 96 inclusive. Got ${paddingBottom}.`,
      });
    }
  }
}


/** 8.15: Rule copy.no-lorem-ipsum */
function ruleCopyNoLoremIpsum(template: PageTemplate, errors: OraValidationError[]): void {
  const allBlocks = collectAllBlocks(template.data);
  const textBlockTypes = ["Heading", "Text", "Quote", "Button", "AccordionGroup"];

  for (const block of allBlocks) {
    if (!textBlockTypes.includes(block.type)) continue;

    const texts = getBlockTextContent(block);
    for (const text of texts) {
      const lower = text.toLowerCase();
      if (lower.includes("lorem") || lower.includes("ipsum")) {
        errors.push({
          templateId: template.id,
          blockId: block.props.id,
          fieldPath: `props.${block.type === "Text" ? "content" : "text"}`,
          rule: "copy.no-lorem-ipsum",
          message: `Block "${block.type}" (${block.props.id}) contains "lorem" or "ipsum" placeholder text.`,
        });
      }
    }
  }
}

/** 8.16: Rule copy.length-bounds */
function ruleCopyLengthBounds(template: PageTemplate, errors: OraValidationError[]): void {
  const allBlocks = collectAllBlocks(template.data);

  for (const block of allBlocks) {
    switch (block.type) {
      case "Heading":
      case "Text":
      case "Quote":
      case "Button": {
        const propName = block.type === "Text" ? "content" : "text";
        const text = block.props[propName];
        if (typeof text !== "string") break;
        const trimmed = text.trim();
        if (trimmed.length < 1 || trimmed.length > 240) {
          errors.push({
            templateId: template.id,
            blockId: block.props.id,
            fieldPath: `props.${propName}`,
            rule: "copy.length-bounds",
            message: `Block "${block.type}" (${block.props.id}) text length must be 1-240. Got ${trimmed.length}.`,
          });
        }
        break;
      }
      case "AccordionGroup": {
        const items = block.props.items;
        if (!Array.isArray(items)) break;
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx] as { title?: string; body?: string };
          if (typeof item.title === "string") {
            const trimmedTitle = item.title.trim();
            if (trimmedTitle.length < 1 || trimmedTitle.length > 120) {
              errors.push({
                templateId: template.id,
                blockId: block.props.id,
                fieldPath: `props.items[${idx}].title`,
                rule: "copy.length-bounds",
                message: `AccordionGroup item[${idx}] title length must be 1-120. Got ${trimmedTitle.length}.`,
              });
            }
          }
          if (typeof item.body === "string") {
            const trimmedBody = item.body.trim();
            if (trimmedBody.length < 1 || trimmedBody.length > 600) {
              errors.push({
                templateId: template.id,
                blockId: block.props.id,
                fieldPath: `props.items[${idx}].body`,
                rule: "copy.length-bounds",
                message: `AccordionGroup item[${idx}] body length must be 1-600. Got ${trimmedBody.length}.`,
              });
            }
          }
        }
        break;
      }
    }
  }
}


/** 8.17: Rule copy.archetype-keyword */
function ruleCopyArchetypeKeyword(template: PageTemplate, errors: OraValidationError[]): void {
  if (template.id === "ora-project-page") {
    // Concatenation of all text content must contain "project" (case-insensitive)
    const allBlocks = collectAllBlocks(template.data);
    const textBlockTypes = ["Heading", "Text", "Quote", "Button"];
    let allText = "";
    for (const block of allBlocks) {
      if (!textBlockTypes.includes(block.type)) continue;
      const texts = getBlockTextContent(block);
      allText += texts.join(" ") + " ";
    }
    if (!allText.toLowerCase().includes("project")) {
      errors.push({
        templateId: template.id,
        blockId: null,
        fieldPath: "data.content",
        rule: "copy.archetype-keyword",
        message: `Template "ora-project-page" must contain the keyword "project" in its copy.`,
      });
    }
  }

  if (template.id === "about-ora") {
    // At least one Heading must contain "About ORA" (case-insensitive)
    const headings = getBlocksByType(template.data, "Heading");
    const hasAboutOra = headings.some((h) => {
      const text = h.props.text;
      return typeof text === "string" && text.toLowerCase().includes("about ora");
    });
    if (!hasAboutOra) {
      errors.push({
        templateId: template.id,
        blockId: null,
        fieldPath: "data.content",
        rule: "copy.archetype-keyword",
        message: `Template "about-ora" must have at least one Heading containing "About ORA".`,
      });
    }
  }
}

/** 8.18: Rule composition.cta-final */
function ruleCompositionCtaFinal(template: PageTemplate, errors: OraValidationError[]): void {
  if (template.id !== "ora-project-page") return;

  const content = template.data.content;
  if (content.length === 0) return;

  const lastSection = content[content.length - 1];
  if (lastSection.props._archetype !== "cta") {
    errors.push({
      templateId: template.id,
      blockId: lastSection.props.id,
      fieldPath: `content[${content.length - 1}].props._archetype`,
      rule: "composition.cta-final",
      message: `Template "ora-project-page" must have its last Section with _archetype "cta". Got "${lastSection.props._archetype}".`,
    });
  }
}

/** 8.19: Rule composition.fixed-order */
function ruleCompositionFixedOrder(template: PageTemplate, errors: OraValidationError[]): void {
  if (template.id !== "about-ora") return;

  const content = template.data.content;
  if (content.length !== 7) {
    errors.push({
      templateId: template.id,
      blockId: null,
      fieldPath: "data.content",
      rule: "composition.fixed-order",
      message: `Template "about-ora" must have exactly 7 Sections. Got ${content.length}.`,
    });
    return;
  }

  for (let i = 0; i < ABOUT_ORA_ORDER.length; i++) {
    const expected = ABOUT_ORA_ORDER[i];
    const actual = content[i].props._archetype as string;

    if (Array.isArray(expected)) {
      // Position allows multiple valid archetypes
      if (!expected.includes(actual as Archetype)) {
        errors.push({
          templateId: template.id,
          blockId: content[i].props.id,
          fieldPath: `content[${i}].props._archetype`,
          rule: "composition.fixed-order",
          message: `Template "about-ora" Section at position ${i} must be one of [${expected.join(", ")}]. Got "${actual}".`,
        });
      }
    } else {
      if (actual !== expected) {
        errors.push({
          templateId: template.id,
          blockId: content[i].props.id,
          fieldPath: `content[${i}].props._archetype`,
          rule: "composition.fixed-order",
          message: `Template "about-ora" Section at position ${i} must be "${expected}". Got "${actual}".`,
        });
      }
    }
  }
}


// ─── Main validator ─────────────────────────────────────────────────────────

/**
 * Validates an ORA page template against all brand and structural rules.
 *
 * Rules are executed in the order defined in design.md Section "Error Handling".
 * All rules run regardless of earlier failures — the full error set is returned.
 */
export function validateOraPageTemplate(template: PageTemplate): OraValidationResult {
  const errors: OraValidationError[] = [];

  // 8.2: schema.page-data
  ruleSchemaPageData(template, errors);

  // 8.3: archetype.tag-present
  ruleArchetypeTagPresent(template, errors);

  // 8.4: archetype.composition-match
  ruleArchetypeCompositionMatch(template, errors);

  // 8.5: bgMode.allowed
  ruleBgModeAllowed(template, errors);

  // 8.6: gradient.palette
  ruleGradientPalette(template, errors);

  // 8.7: image-hero.source-non-empty
  ruleImageHeroSourceNonEmpty(template, errors);

  // 8.8: hero-variant.template-assignment
  ruleHeroVariantTemplateAssignment(template, errors);

  // 8.9: breakpoint.completeness
  ruleBreakpointCompleteness(template, errors);

  // 8.10: breakpoint.h1-mobile-bound
  ruleH1MobileBound(template, errors);

  // 8.11: breakpoint.h1-desktop-bound
  ruleH1DesktopBound(template, errors);

  // 8.12: breakpoint.h1-monotone
  ruleH1Monotone(template, errors);

  // 8.13: breakpoint.section-padding-h
  ruleSectionPaddingH(template, errors);

  // 8.14: breakpoint.section-padding-v
  ruleSectionPaddingV(template, errors);

  // 8.15: copy.no-lorem-ipsum
  ruleCopyNoLoremIpsum(template, errors);

  // 8.16: copy.length-bounds
  ruleCopyLengthBounds(template, errors);

  // 8.17: copy.archetype-keyword
  ruleCopyArchetypeKeyword(template, errors);

  // 8.18: composition.cta-final
  ruleCompositionCtaFinal(template, errors);

  // 8.19: composition.fixed-order
  ruleCompositionFixedOrder(template, errors);

  return {
    success: errors.length === 0,
    errors,
  };
}
