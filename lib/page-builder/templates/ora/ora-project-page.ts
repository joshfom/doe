/**
 * ora-project-page template — Project marketing page.
 *
 * Composition (per design.md):
 *   1. hero (image-hero)
 *   2. split-content (image left, quote + body + button right)
 *   3. quote-feature (full-width brand quote)
 *   4. image+text (floor plan image left, heading + body right)
 *   5. text+image (heading + body left, lifestyle image right)
 *   6. cta (heading + CTA button, gold variant)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.4, 9.3, 9.5
 */

import type { PageTemplate } from "../index";
import type { SectionTree } from "./section-archetypes";
import {
  buildHero,
  buildSplitContent,
  buildQuoteFeature,
  buildImageText,
  buildTextImage,
  buildCta,
} from "./section-archetypes";
import {
  ORA_TEMPLATE_IMAGES,
  ORA_PAGE_TEMPLATE_GRADIENTS,
  ARCHETYPE_DEFAULT_HEADING_H1_FONT_SIZE,
  ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
  ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
} from "./archetype-defaults";
import type { ComponentInstance } from "../../types";

// ─── Copy constant (Task 4.5) ───────────────────────────────────────────────
// Every Heading, Text, Quote, and Button text used by the template.
// At least one entry contains "project" (case-insensitive) per Req 3.7.
// No entry contains "lorem" or "ipsum". Every entry's trimmed length is 1–240.

const ORA_PROJECT_PAGE_COPY = {
  heroHeading: "Project showcase",
  heroSubtitle: "Discover a new standard of living crafted with precision and purpose",
  splitQuote: "Every detail is designed to elevate your everyday experience",
  splitBody: "Our project brings together world-class architecture, lush landscapes, and thoughtful amenities to create a community that inspires.",
  splitButton: "Download brochure",
  quoteFeature: "Where vision meets craftsmanship — a landmark project redefining modern living",
  imageTextHeading: "Project overview",
  imageTextBody: "Explore the floor plans and spatial design that define each residence, from open-plan living areas to private terraces with panoramic views.",
  textImageHeading: "Sustainability",
  textImageBody: "Built with responsible materials and energy-efficient systems, every home is designed to minimise environmental impact while maximising comfort.",
  ctaHeading: "Reserve your project",
  ctaBody: "Secure your place in a community designed for those who value quality, space, and connection.",
  ctaButton: "Reserve now",
} as const;

// ─── Factory function (Tasks 4.1–4.6) ──────────────────────────────────────

/**
 * Returns a fresh `PageTemplate` record for the ora-project-page template.
 * Every invocation calls archetype builders fresh, producing disjoint id sets
 * across consecutive calls (Req 9.3, 9.5).
 */
export function oraProjectPageTemplate(): PageTemplate {
  // Task 4.2: Hero section with image-hero background
  const hero = buildHero({
    sectionId: "hero",
    background: { kind: "image-hero", src: ORA_TEMPLATE_IMAGES.projectHero },
    heading: {
      text: ORA_PROJECT_PAGE_COPY.heroHeading,
      level: "h1",
      fontSize: ARCHETYPE_DEFAULT_HEADING_H1_FONT_SIZE,
      color: "#FFFFFF",
    },
    subtitle: {
      text: ORA_PROJECT_PAGE_COPY.heroSubtitle,
      fontSize: ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
      color: "#FFFFFF",
    },
    textColor: "#FFFFFF",
  });

  // Task 4.3/4.4: Split-content section (cream-warm gradient)
  const splitContent = buildSplitContent({
    sectionId: "split-content",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] },
    imageSide: "left",
    image: {
      src: ORA_TEMPLATE_IMAGES.projectLifestyle,
      alt: "Project lifestyle interior",
    },
    quote: {
      text: ORA_PROJECT_PAGE_COPY.splitQuote,
      fontSize: ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
    },
    body: {
      content: ORA_PROJECT_PAGE_COPY.splitBody,
      fontSize: ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
    },
    cta: {
      text: ORA_PROJECT_PAGE_COPY.splitButton,
      url: "#brochure",
    },
  });

  // Task 4.3/4.4: Quote-feature section (cream-warm gradient)
  const quoteFeature = buildQuoteFeature({
    sectionId: "quote-feature",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] },
    quote: {
      text: ORA_PROJECT_PAGE_COPY.quoteFeature,
      fontSize: ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
    },
  });

  // Task 4.3/4.4: Image+text section (cream-warm gradient)
  const imageText = buildImageText({
    sectionId: "project-overview",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] },
    imageSide: "left",
    image: {
      src: ORA_TEMPLATE_IMAGES.projectFloorplan,
      alt: "Project floor plan",
    },
    heading: {
      text: ORA_PROJECT_PAGE_COPY.imageTextHeading,
      level: "h2",
      fontSize: ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
    },
    text: {
      content: ORA_PROJECT_PAGE_COPY.imageTextBody,
      fontSize: ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
    },
  });

  // Task 4.3/4.4: Text+image section (cream-warm gradient)
  const textImage = buildTextImage({
    sectionId: "sustainability",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] },
    imageSide: "right",
    image: {
      src: ORA_TEMPLATE_IMAGES.projectLifestyle,
      alt: "Sustainable living",
    },
    heading: {
      text: ORA_PROJECT_PAGE_COPY.textImageHeading,
      level: "h2",
      fontSize: ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
    },
    text: {
      content: ORA_PROJECT_PAGE_COPY.textImageBody,
      fontSize: ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
    },
  });

  // Task 4.3/4.4: CTA section (charcoal-deep gradient)
  const cta = buildCta({
    sectionId: "cta",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["charcoal-deep"] },
    textColor: "#FFFFFF",
    heading: {
      text: ORA_PROJECT_PAGE_COPY.ctaHeading,
      level: "h2",
      fontSize: ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
    },
    body: {
      content: ORA_PROJECT_PAGE_COPY.ctaBody,
      fontSize: ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
    },
    cta: {
      text: ORA_PROJECT_PAGE_COPY.ctaButton,
      url: "#reserve",
      variant: "gold",
    },
  });

  // Merge all section trees into a single PageData
  const sections: SectionTree[] = [hero, splitContent, quoteFeature, imageText, textImage, cta];

  const content: ComponentInstance[] = [];
  const zones: Record<string, ComponentInstance[]> = {};

  for (const section of sections) {
    content.push(...section.content);
    Object.assign(zones, section.zones);
  }

  return {
    id: "ora-project-page",
    name: "ORA Project Page",
    description: "A project marketing page with hero, split-content, quote, image layouts, and a call-to-action.",
    thumbnailId: "",
    data: {
      root: { props: { title: "Project showcase" } },
      content,
      zones,
    },
  };
}
