/**
 * about-ora template — "About ORA" page template.
 *
 * Composes exactly 7 Sections in fixed order per Requirement 6:
 *   1. hero (gradient-hero, ivory-sand)
 *   2. text+image ("Our story")
 *   3. image+text ("Our vision")
 *   4. heading+full-width-image ("Where we build")
 *   5. heading+accordions ("Frequently asked questions")
 *   6. image+text ("Our leadership")
 *   7. text+image ("Join our team")
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.4, 9.3, 9.5
 */

import type { PageTemplate } from "../index";
import {
  ORA_PAGE_TEMPLATE_GRADIENTS,
  ORA_TEMPLATE_IMAGES,
} from "./archetype-defaults";
import {
  buildHero,
  buildTextImage,
  buildImageText,
  buildHeadingFullWidthImage,
  buildHeadingAccordions,
} from "./section-archetypes";
import type { SectionTree } from "./section-archetypes";

// ─── Copy constant (Req 6.5) ────────────────────────────────────────────────

export const ABOUT_ORA_COPY = {
  heroHeading: "About ORA",
  heroSubtitle: "Shaping communities that inspire generations",

  storyHeading: "Our story",
  storyBody:
    "Founded with a vision to redefine real estate development in the region, ORA brings together decades of expertise in architecture, urban planning, and community design to create places people are proud to call home.",

  visionHeading: "Our vision",
  visionBody:
    "We believe that thoughtful design and meticulous craftsmanship can transform how people live, work, and connect. Every project we undertake is guided by a commitment to quality and long-term value.",

  buildHeading: "Where we build",
  buildBody:
    "Our portfolio spans landmark residential communities, mixed-use developments, and waterfront destinations across the region, each reflecting our dedication to excellence.",

  faqHeading: "Frequently asked questions",
  faqIntro:
    "Find answers to common questions about our developments, purchasing process, and community features.",

  leadershipHeading: "Our leadership",
  leadershipBody:
    "Our executive team combines deep industry knowledge with a passion for innovation, guiding every project from concept through delivery with hands-on expertise.",

  careersHeading: "Join our team",
  careersBody:
    "We are always looking for talented individuals who share our commitment to design excellence and community building. Explore opportunities to grow with us.",

  faqItems: [
    {
      title: "What types of properties does ORA develop?",
      body: "ORA develops residential communities, mixed-use destinations, and waterfront properties designed for modern living with lasting value.",
    },
    {
      title: "Where are ORA developments located?",
      body: "Our projects are strategically located across prime coastal and urban areas, chosen for connectivity, natural beauty, and long-term growth potential.",
    },
    {
      title: "How can I purchase a property in an ORA community?",
      body: "You can register your interest through our website or visit our sales gallery. Our team will guide you through available units, pricing, and the reservation process.",
    },
    {
      title: "What amenities are included in ORA communities?",
      body: "Each community features curated amenities including landscaped parks, fitness centres, swimming pools, retail areas, and dedicated family spaces tailored to residents.",
    },
  ],
} as const;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates the "About ORA" page template with exactly 7 sections in fixed order.
 * Each invocation generates fresh UUIDs so consecutive calls produce disjoint id sets.
 */
export function aboutOraTemplate(): PageTemplate {
  const defaultGradient = ORA_PAGE_TEMPLATE_GRADIENTS["ivory-sand"];
  const accentGradient = ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"];

  // Section 1: Hero (gradient-hero, ivory-sand)
  const hero: SectionTree = buildHero({
    sectionId: "hero",
    background: { kind: "gradient-hero", pair: ORA_PAGE_TEMPLATE_GRADIENTS["ivory-sand"] },
    heading: { text: ABOUT_ORA_COPY.heroHeading, level: "h1" },
    subtitle: { text: ABOUT_ORA_COPY.heroSubtitle },
  });

  // Section 2: text+image — "Our story"
  const story: SectionTree = buildTextImage({
    sectionId: "our-story",
    background: { kind: "gradient", pair: defaultGradient },
    imageSide: "right",
    image: { src: ORA_TEMPLATE_IMAGES.oraTeam, alt: "ORA founders and team" },
    heading: { text: ABOUT_ORA_COPY.storyHeading, level: "h2" },
    text: { content: ABOUT_ORA_COPY.storyBody },
  });

  // Section 3: image+text — "Our vision"
  const vision: SectionTree = buildImageText({
    sectionId: "our-vision",
    background: { kind: "gradient", pair: accentGradient },
    imageSide: "left",
    image: { src: ORA_TEMPLATE_IMAGES.oraArchitecture, alt: "ORA architecture" },
    heading: { text: ABOUT_ORA_COPY.visionHeading, level: "h2" },
    text: { content: ABOUT_ORA_COPY.visionBody },
  });

  // Section 4: heading+full-width-image — "Where we build"
  const build: SectionTree = buildHeadingFullWidthImage({
    sectionId: "where-we-build",
    background: { kind: "gradient", pair: defaultGradient },
    heading: { text: ABOUT_ORA_COPY.buildHeading, level: "h2" },
    text: { content: ABOUT_ORA_COPY.buildBody },
    image: { src: ORA_TEMPLATE_IMAGES.oraPortfolio, alt: "ORA portfolio of developments" },
  });

  // Section 5: heading+accordions — "Frequently asked questions"
  const faq: SectionTree = buildHeadingAccordions({
    sectionId: "faq",
    background: { kind: "gradient", pair: accentGradient },
    heading: { text: ABOUT_ORA_COPY.faqHeading, level: "h2" },
    text: { content: ABOUT_ORA_COPY.faqIntro },
    accordions: { items: [...ABOUT_ORA_COPY.faqItems] },
  });

  // Section 6: image+text — "Our leadership"
  const leadership: SectionTree = buildImageText({
    sectionId: "leadership",
    background: { kind: "gradient", pair: defaultGradient },
    imageSide: "left",
    image: { src: ORA_TEMPLATE_IMAGES.oraTeam, alt: "ORA leadership team" },
    heading: { text: ABOUT_ORA_COPY.leadershipHeading, level: "h2" },
    text: { content: ABOUT_ORA_COPY.leadershipBody },
  });

  // Section 7: text+image — "Join our team"
  const careers: SectionTree = buildTextImage({
    sectionId: "careers",
    background: { kind: "gradient", pair: accentGradient },
    imageSide: "right",
    image: { src: ORA_TEMPLATE_IMAGES.oraArchitecture, alt: "ORA office and workspace" },
    heading: { text: ABOUT_ORA_COPY.careersHeading, level: "h2" },
    text: { content: ABOUT_ORA_COPY.careersBody },
  });

  // Merge all section trees into a single PageData
  const sections: SectionTree[] = [hero, story, vision, build, faq, leadership, careers];

  const content = sections.flatMap((s) => s.content);
  const zones: Record<string, unknown[]> = {};
  for (const s of sections) {
    Object.assign(zones, s.zones);
  }

  return {
    id: "about-ora",
    name: "About ORA",
    description: "A seven-section About page showcasing the ORA brand story, vision, portfolio, FAQ, leadership, and careers.",
    thumbnailId: "",
    data: {
      root: { props: { title: "About ORA" } },
      content,
      zones: zones as Record<string, import("../../types").ComponentInstance[]>,
    },
  };
}
