/**
 * life-at-bayn template — lifestyle-experience narrative page.
 *
 * Composition (5 sections):
 *   1. hero         — image-hero, h1 = "Life at Bayn", subtitle
 *   2. image+text   — beach image left, "Beachfront living" heading + body right
 *   3. heading+full-width-image — "Designed for well-being" heading + body + full-width lifestyle image
 *   4. text+image   — "Recreation & retail" heading + body left, retail image right
 *   5. image+text   — green-spaces image left, "Connect with nature" heading + body right
 *
 * Validates: Requirements 5.1–5.6, 7.4, 9.3, 9.5
 */

import type { PageTemplate } from "../index";
import type { SectionTree } from "./section-archetypes";
import {
  buildHero,
  buildImageText,
  buildTextImage,
  buildHeadingFullWidthImage,
} from "./section-archetypes";
import {
  ORA_PAGE_TEMPLATE_GRADIENTS,
  ORA_TEMPLATE_IMAGES,
} from "./archetype-defaults";

// ─── Copy constants ─────────────────────────────────────────────────────────

export const LIFE_AT_BAYN_COPY = {
  heroHeading: "Life at Bayn",
  heroSubtitle: "A coastal lifestyle where relaxation, recreation, and community come together in harmony",
  beachfrontHeading: "Beachfront living",
  beachfrontBody: "Wake up to the sound of waves and step onto pristine sandy shores just moments from your door. Every day feels like a retreat at Bayn.",
  wellbeingHeading: "Designed for well-being",
  wellbeingBody: "Thoughtfully planned open spaces, walking trails, and wellness amenities create an environment that nurtures body and mind.",
  recreationHeading: "Recreation & retail",
  recreationBody: "From boutique shopping and dining to sports courts and family parks, everyday conveniences and leisure are woven into the community fabric.",
  natureHeading: "Connect with nature",
  natureBody: "Lush green spaces, landscaped gardens, and waterfront promenades invite you to slow down and enjoy the natural beauty surrounding Bayn.",
} as const;

// ─── Template factory ───────────────────────────────────────────────────────

/**
 * Builds the Life at Bayn page template.
 * Each invocation generates fresh UUIDs so consecutive calls produce disjoint id sets.
 */
export function lifeAtBaynTemplate(): PageTemplate {
  const defaultGradient = ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"];
  const accentGradient = ORA_PAGE_TEMPLATE_GRADIENTS["sand-stone"];

  // Section 1: Hero (image-hero)
  const hero: SectionTree = buildHero({
    sectionId: "hero",
    background: { kind: "image-hero", src: ORA_TEMPLATE_IMAGES.lifeBeach },
    heading: { text: LIFE_AT_BAYN_COPY.heroHeading, level: "h1", color: "#FFFFFF" },
    subtitle: { text: LIFE_AT_BAYN_COPY.heroSubtitle, color: "#FFFFFF" },
    textColor: "#FFFFFF",
    minHeight: "80vh",
    contentAlign: "center",
  });

  // Section 2: image+text — beach image left, "Beachfront living" right
  const beachfront: SectionTree = buildImageText({
    sectionId: "beachfront",
    background: { kind: "gradient", pair: defaultGradient },
    imageSide: "left",
    image: { src: ORA_TEMPLATE_IMAGES.lifeBeach, alt: "Beachfront living at Bayn" },
    heading: { text: LIFE_AT_BAYN_COPY.beachfrontHeading, level: "h2" },
    text: { content: LIFE_AT_BAYN_COPY.beachfrontBody },
  });

  // Section 3: heading+full-width-image — "Designed for well-being"
  const wellbeing: SectionTree = buildHeadingFullWidthImage({
    sectionId: "wellbeing",
    background: { kind: "gradient", pair: accentGradient },
    heading: { text: LIFE_AT_BAYN_COPY.wellbeingHeading, level: "h2" },
    text: { content: LIFE_AT_BAYN_COPY.wellbeingBody },
    image: { src: ORA_TEMPLATE_IMAGES.bayanGreenSpaces, alt: "Wellness and open spaces at Bayn" },
  });

  // Section 4: text+image — "Recreation & retail" left, retail image right
  const recreation: SectionTree = buildTextImage({
    sectionId: "recreation",
    background: { kind: "gradient", pair: defaultGradient },
    imageSide: "right",
    image: { src: ORA_TEMPLATE_IMAGES.lifeRetail, alt: "Recreation and retail at Bayn" },
    heading: { text: LIFE_AT_BAYN_COPY.recreationHeading, level: "h2" },
    text: { content: LIFE_AT_BAYN_COPY.recreationBody },
  });

  // Section 5: image+text — green-spaces image left, "Connect with nature" right
  const nature: SectionTree = buildImageText({
    sectionId: "nature",
    background: { kind: "gradient", pair: defaultGradient },
    imageSide: "left",
    image: { src: ORA_TEMPLATE_IMAGES.bayanGreenSpaces, alt: "Green spaces at Bayn" },
    heading: { text: LIFE_AT_BAYN_COPY.natureHeading, level: "h2" },
    text: { content: LIFE_AT_BAYN_COPY.natureBody },
  });

  // Merge all section trees into a single PageData
  const sections: SectionTree[] = [hero, beachfront, wellbeing, recreation, nature];

  const content = sections.flatMap((s) => s.content);
  const zones: Record<string, unknown[]> = {};
  for (const s of sections) {
    Object.assign(zones, s.zones);
  }

  return {
    id: "life-at-bayn",
    name: "Life at Bayn",
    description: "A lifestyle-experience narrative showcasing beachfront living, wellness, and community at Bayn",
    thumbnailId: "",
    data: {
      root: { props: { title: "Life at Bayn" } },
      content,
      zones: zones as Record<string, import("../../types").ComponentInstance[]>,
    },
  };
}
