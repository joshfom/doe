/**
 * why-bayn template — "Why Bayn" value-proposition narrative page.
 *
 * Layout based on the reference design (uat-web.ora-uae.com/why-bayn):
 *   1. Hero — full-screen image background, centered title + subtitle
 *   2. "Why the UAE" — centered heading, then 2-column (image left, quote + text right)
 *   3. "Why ORA" — 2-column (accordion left, large image right), flat background
 *   4. "Why BAYN" — 2-column (large image left, accordion right), flat background (flipped)
 *
 * Validates: Requirements 4.1–4.6, 7.4, 9.3, 9.5
 */

import type { PageTemplate } from "../index";
import type { ComponentInstance } from "../../types";
import type { SectionTree } from "./section-archetypes";
import {
  sectionShell,
  containerShell,
} from "./section-archetypes";
import {
  ORA_PAGE_TEMPLATE_GRADIENTS,
  ORA_TEMPLATE_IMAGES,
  ARCHETYPE_DEFAULT_HEADING_H1_FONT_SIZE,
  ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
  ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
} from "./archetype-defaults";
import type { BreakpointValue } from "../../breakpoints";

// ─── Copy constants ─────────────────────────────────────────────────────────

export const WHY_BAYN_COPY = {
  heroHeading: "Why BAYN",
  heroSubtitle:
    "The UAE is one of the fastest-growing economies in the world",
  whyUaeHeading: "Why the UAE",
  whyUaeQuote:
    "The UAE has diverse visa types to facilitate entry and residence to foster a positive environment for investment.",
  whyUaeBody:
    "This, coupled with the fact that USD 1 million can secure prime residential space 3x bigger than London or Singapore, plus with major developments such as Etihad Rail, the world's largest airport and free zones, make the UAE very attractive.",
  whyOraHeading: "Why ORA",
  whyOraAccordionItems: [
    {
      title: "Wide Audience Appeal & Inclusivity",
      body: "ORA develops inclusive communities that cater to practically every audience and their discerning needs.",
    },
    {
      title: "ORA's Expertise",
      body: "With decades of experience in master-planned communities, ORA brings world-class design and execution to every project.",
    },
    {
      title: "ORA's Global Portfolio",
      body: "A proven track record spanning multiple countries and continents, delivering landmark developments that stand the test of time.",
    },
    {
      title: "Local Heritage, Global Sophistication",
      body: "Blending regional cultural values with international design standards to create communities that feel both familiar and aspirational.",
    },
    {
      title: "Spectrum of Amenities & Services",
      body: "From wellness centres and retail to education and recreation, every community is designed as a self-contained lifestyle destination.",
    },
  ],
  whyBaynHeading: "Why BAYN",
  whyBaynAccordionItems: [
    {
      title: "Strategic Location",
      body: "Positioned 'in between' Dubai and Abu Dhabi.",
    },
    {
      title: "Close Proximity",
      body: "Minutes from major transport links, cultural landmarks, and the vibrant heart of both emirates.",
    },
    {
      title: "A Masterfully Planned Community",
      body: "Every boulevard, park, and waterfront promenade has been designed to foster connection and well-being.",
    },
    {
      title: "55% Open Spaces",
      body: "Over half the masterplan is dedicated to lush parkland, jogging trails, and shaded gathering areas.",
    },
    {
      title: "Waterfront Living for All",
      body: "Direct access to pristine sandy shores and landscaped waterfront walkways designed for leisure and recreation.",
    },
  ],
} as const;

// ─── Shared helpers ─────────────────────────────────────────────────────────

const ZERO_PADDING: BreakpointValue<{ paddingTop: string; paddingBottom: string; paddingLeft: string; paddingRight: string }> = {
  desktop: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
  mobile: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
};

const ZERO_MARGIN: BreakpointValue<{ marginTop: string; marginBottom: string }> = {
  desktop: { marginTop: "0", marginBottom: "0" },
  mobile: { marginTop: "0", marginBottom: "0" },
};

const ZERO_BORDER: BreakpointValue<{ borderWidth: string; borderColor: string; borderRadius: string }> = {
  desktop: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
  mobile: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
};

function makeHeading(text: string, level: string, fontSize: BreakpointValue<number>, opts?: { color?: string; textAlign?: string }): ComponentInstance {
  return {
    type: "Heading",
    props: {
      id: crypto.randomUUID(),
      text,
      level,
      fontWeight: "700",
      fontSize,
      textAlign: opts?.textAlign ?? "left",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { desktop: "auto", mobile: "auto" },
      letterSpacing: { desktop: "normal", mobile: "normal" },
      color: opts?.color ?? "#1A1A1A",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeText(content: string, fontSize: BreakpointValue<number>, opts?: { color?: string; textAlign?: string }): ComponentInstance {
  return {
    type: "Text",
    props: {
      id: crypto.randomUUID(),
      content,
      fontWeight: "400",
      fontSize,
      textAlign: opts?.textAlign ?? "left",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { desktop: "auto", mobile: "auto" },
      letterSpacing: { desktop: "normal", mobile: "normal" },
      color: opts?.color ?? "#4A4A4A",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeQuote(text: string, fontSize: BreakpointValue<number>): ComponentInstance {
  return {
    type: "Quote",
    props: {
      id: crypto.randomUUID(),
      text,
      accentColor: "#01A7C7",
      accentWidth: "3",
      fontWeight: "400",
      fontSize,
      textAlign: "left",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { desktop: "auto", mobile: "auto" },
      letterSpacing: { desktop: "normal", mobile: "normal" },
      color: "#2C2C2C",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeImage(src: string, alt: string, aspectRatio: BreakpointValue<string>): ComponentInstance {
  return {
    type: "Image",
    props: {
      id: crypto.randomUUID(),
      src,
      alt,
      objectFit: "cover",
      xAlign: "50%",
      yAlign: "50%",
      imgWidth: { desktop: "100%", mobile: "100%" },
      maxWidth: "100%",
      imgHeight: { desktop: "auto", mobile: "auto" },
      aspectRatio,
      alignment: "center",
      imgBorderRadius: "0",
      shadow: "none",
      opacity: "1",
      filter: "none",
      hoverEffect: "none",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
      _animation: { entrance: "none", duration: "0.5", delay: "0", hover: "none" },
    },
  };
}

function makeColumns(opts?: { gap?: string; columnWidths?: string[] }): ComponentInstance {
  const widths = opts?.columnWidths ?? ["1fr", "1fr"];
  return {
    type: "Columns",
    props: {
      id: crypto.randomUUID(),
      "column-0": [],
      "column-1": [],
      "column-2": [],
      "column-3": [],
      "column-4": [],
      "column-5": [],
      gap: opts?.gap ?? "lg",
      columnList: widths.map((width) => ({
        width,
        paddingY: "0",
        paddingX: "0",
        marginY: "0",
        align: "flex-start",
        justify: "stretch",
      })),
      columnGap: { desktop: "48px", mobile: "0px" },
      rowGap: { desktop: "32px", mobile: "24px" },
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeAccordionGroup(items: { title: string; body: string }[]): ComponentInstance {
  return {
    type: "AccordionGroup",
    props: {
      id: crypto.randomUUID(),
      heading: "",
      items: items.map((item) => ({ title: item.title, body: item.body })),
      defaultOpenIndex: 0,
      headingColor: "#2C2C2C",
      headingSize: "60px",
      titleColor: "#2C2C2C",
      titleSize: "50px",
      bodyColor: "#2C2C2C",
      bodySize: "20px",
      bodyIndent: "12px",
      dividerColor: "#D9D6D1",
      dividerWidth: "1",
      activeLineColor: "#01A7C7",
      activeLineWidth: "3",
      iconColor: "#2C2C2C",
      iconSize: "26",
      iconStroke: "1.75",
      itemPaddingY: "8px",
      fontWeight: "400",
      fontSize: ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
      textAlign: "left",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { desktop: "auto", mobile: "auto" },
      letterSpacing: { desktop: "normal", mobile: "normal" },
      color: "#4A4A4A",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeScrollIndicator(): ComponentInstance {
  return {
    type: "ScrollIndicator",
    props: {
      id: crypto.randomUUID(),
      label: "SCROLL TO EXPLORE",
      labelPosition: "above",
      vPosition: "bottom",
      hPosition: "center",
      vOffset: "32px",
      hOffset: "0px",
      indicatorStyle: "outline",
      size: "md",
      indicatorColor: "#FFFFFF",
      arrowColor: "#FFFFFF",
      textColor: "#FFFFFF",
      _typography: {
        fontFamily: "inherit",
        fontWeight: "400",
        fontSize: "11px",
        letterSpacing: "0.15em",
        textTransform: "uppercase",
      },
      animation: "bounce",
      href: "#why-the-uae",
    },
  };
}

// ─── Template factory ───────────────────────────────────────────────────────

export function whyBaynTemplate(): PageTemplate {
  // ─── Section 1: Hero (full-screen image, centered text, no padding) ─────
  const heroSection = sectionShell({
    sectionId: "hero",
    background: { kind: "image-hero", src: ORA_TEMPLATE_IMAGES.bayanBeachfront },
    minHeight: "100vh",
    maxHeight: "100vh",
    contentAlign: "center",
    textColor: "#FFFFFF",
    padding: {
      desktop: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
      mobile: { paddingTop: "0", paddingBottom: "0", paddingLeft: "16", paddingRight: "16" },
    },
    _archetype: "hero",
  });
  const heroContainer = containerShell("center");
  const heroHeading = makeHeading(
    WHY_BAYN_COPY.heroHeading, "h1",
    { desktop: 72, mobile: 44 },
    { color: "#FFFFFF", textAlign: "center" }
  );
  const heroSubtitle = makeText(
    WHY_BAYN_COPY.heroSubtitle,
    ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
    { color: "#FFFFFF", textAlign: "center" }
  );

  const heroSectionId = heroSection.props.id as string;
  const heroContainerId = heroContainer.props.id as string;

  // Add scroll indicator at the bottom of the hero
  const scrollIndicator = makeScrollIndicator();

  const hero: SectionTree = {
    content: [heroSection],
    zones: {
      [`${heroSectionId}:section-content`]: [heroContainer],
      [`${heroContainerId}:container-content`]: [heroHeading, heroSubtitle, scrollIndicator],
    },
  };

  // ─── Section 2: "Why the UAE" — heading centered, then image+quote columns ─
  // Section fills screen height, image is tall portrait, content vertically centered
  const uaeSection = sectionShell({
    sectionId: "why-the-uae",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["ivory-sand"] },
    padding: {
      desktop: { paddingTop: "80", paddingBottom: "80", paddingLeft: "64", paddingRight: "64" },
      mobile: { paddingTop: "64", paddingBottom: "64", paddingLeft: "16", paddingRight: "16" },
    },
    minHeight: "100vh",
    contentAlign: "center",
    _archetype: "image+text",
  });
  const uaeContainer = containerShell("center");
  const uaeHeading = makeHeading(
    WHY_BAYN_COPY.whyUaeHeading, "h2",
    ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
    { textAlign: "center" }
  );
  // Add bottom margin to heading to space it from columns
  (uaeHeading.props as Record<string, unknown>)._margin = {
    desktop: { marginTop: "0", marginBottom: "64" },
    mobile: { marginTop: "0", marginBottom: "32" },
  };
  const uaeColumns = makeColumns({ gap: "lg" });
  // Set right column to vertically center the quote/text
  (uaeColumns.props.columnList as Array<Record<string, string>>)[1].align = "center";
  // Taller portrait image to fill the section height
  const uaeImage = makeImage(
    ORA_TEMPLATE_IMAGES.bayanMasterplan,
    "UAE skyline at sunset",
    { desktop: "3 / 4", mobile: "16 / 9" }
  );
  const uaeQuote = makeQuote(WHY_BAYN_COPY.whyUaeQuote, { desktop: 18, mobile: 16 });
  // Add spacing between quote and body text
  (uaeQuote.props as Record<string, unknown>)._margin = {
    desktop: { marginTop: "0", marginBottom: "32" },
    mobile: { marginTop: "0", marginBottom: "16" },
  };
  const uaeBody = makeText(WHY_BAYN_COPY.whyUaeBody, ARCHETYPE_DEFAULT_BODY_FONT_SIZE);

  const uaeSectionId = uaeSection.props.id as string;
  const uaeContainerId = uaeContainer.props.id as string;
  const uaeColumnsId = uaeColumns.props.id as string;

  const uae: SectionTree = {
    content: [uaeSection],
    zones: {
      [`${uaeSectionId}:section-content`]: [uaeContainer],
      [`${uaeContainerId}:container-content`]: [uaeHeading, uaeColumns],
      [`${uaeColumnsId}:column-0`]: [uaeImage],
      [`${uaeColumnsId}:column-1`]: [uaeQuote, uaeBody],
    },
  };

  // ─── Section 3: "Why ORA" — accordion left, large image right ─────────────
  // Image touches right edge, content has internal padding for breathing room
  const oraSection = sectionShell({
    sectionId: "why-ora",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] },
    padding: {
      desktop: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
      mobile: { paddingTop: "48", paddingBottom: "48", paddingLeft: "16", paddingRight: "16" },
    },
    _archetype: "text+image",
  });
  const oraContainer = containerShell();
  (oraContainer.props as Record<string, unknown>).maxWidth = "full";
  (oraContainer.props as Record<string, unknown>)._padding = ZERO_PADDING;
  const oraColumns = makeColumns({ columnWidths: ["1fr", "1fr"], gap: "0" });
  // Remove gap between columns for edge-to-edge image
  (oraColumns.props as Record<string, unknown>).columnGap = { desktop: "0px", mobile: "0px" };
  // Left column: center content vertically, add generous internal padding
  (oraColumns.props.columnList as Array<Record<string, string>>)[0].align = "center";
  (oraColumns.props.columnList as Array<Record<string, string>>)[0].paddingX = "64px";
  (oraColumns.props.columnList as Array<Record<string, string>>)[0].paddingY = "80px";

  const oraHeading = makeHeading(
    WHY_BAYN_COPY.whyOraHeading, "h2",
    ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE
  );
  // Add bottom margin to heading
  (oraHeading.props as Record<string, unknown>)._margin = {
    desktop: { marginTop: "0", marginBottom: "32" },
    mobile: { marginTop: "0", marginBottom: "24" },
  };
  const oraAccordion = makeAccordionGroup([...WHY_BAYN_COPY.whyOraAccordionItems]);
  // Image fills the entire right column height
  const oraImage = makeImage(
    ORA_TEMPLATE_IMAGES.bayanCommunity,
    "ORA global portfolio map",
    { desktop: "auto", mobile: "16 / 9" }
  );
  // Make image fill the column height
  (oraImage.props as Record<string, unknown>).imgHeight = { desktop: "100%", mobile: "auto" };
  (oraImage.props as Record<string, unknown>).aspectRatio = { desktop: "auto", mobile: "16 / 9" };

  const oraSectionId = oraSection.props.id as string;
  const oraContainerId = oraContainer.props.id as string;
  const oraColumnsId = oraColumns.props.id as string;

  const ora: SectionTree = {
    content: [oraSection],
    zones: {
      [`${oraSectionId}:section-content`]: [oraContainer],
      [`${oraContainerId}:container-content`]: [oraColumns],
      [`${oraColumnsId}:column-0`]: [oraHeading, oraAccordion],
      [`${oraColumnsId}:column-1`]: [oraImage],
    },
  };

  // ─── Section 4: "Why BAYN" — large image left, accordion right (flipped) ──
  // Image touches left edge, content has internal padding, section fills screen height
  const baynSection = sectionShell({
    sectionId: "why-bayn",
    background: { kind: "gradient", pair: ORA_PAGE_TEMPLATE_GRADIENTS["cream-warm"] },
    padding: {
      desktop: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
      mobile: { paddingTop: "48", paddingBottom: "48", paddingLeft: "16", paddingRight: "16" },
    },
    minHeight: "100vh",
    _archetype: "image+text",
  });
  const baynContainer = containerShell();
  (baynContainer.props as Record<string, unknown>).maxWidth = "full";
  (baynContainer.props as Record<string, unknown>)._padding = ZERO_PADDING;
  const baynColumns = makeColumns({ columnWidths: ["1fr", "1fr"], gap: "0" });
  // Remove gap between columns
  (baynColumns.props as Record<string, unknown>).columnGap = { desktop: "0px", mobile: "0px" };
  // Right column: center content vertically, add generous internal padding
  (baynColumns.props.columnList as Array<Record<string, string>>)[1].align = "center";
  (baynColumns.props.columnList as Array<Record<string, string>>)[1].paddingX = "64px";
  (baynColumns.props.columnList as Array<Record<string, string>>)[1].paddingY = "80px";

  // Image fills the entire left column height
  const baynImage = makeImage(
    ORA_TEMPLATE_IMAGES.bayanBeachfront,
    "Bayn beachfront aerial view",
    { desktop: "auto", mobile: "16 / 9" }
  );
  (baynImage.props as Record<string, unknown>).imgHeight = { desktop: "100%", mobile: "auto" };
  (baynImage.props as Record<string, unknown>).aspectRatio = { desktop: "auto", mobile: "16 / 9" };

  const baynHeading = makeHeading(
    WHY_BAYN_COPY.whyBaynHeading, "h2",
    ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE
  );
  // Add bottom margin to heading
  (baynHeading.props as Record<string, unknown>)._margin = {
    desktop: { marginTop: "0", marginBottom: "32" },
    mobile: { marginTop: "0", marginBottom: "24" },
  };
  const baynAccordion = makeAccordionGroup([...WHY_BAYN_COPY.whyBaynAccordionItems]);

  const baynSectionId = baynSection.props.id as string;
  const baynContainerId = baynContainer.props.id as string;
  const baynColumnsId = baynColumns.props.id as string;

  const bayn: SectionTree = {
    content: [baynSection],
    zones: {
      [`${baynSectionId}:section-content`]: [baynContainer],
      [`${baynContainerId}:container-content`]: [baynColumns],
      [`${baynColumnsId}:column-0`]: [baynImage],
      [`${baynColumnsId}:column-1`]: [baynHeading, baynAccordion],
    },
  };

  // ─── Assemble page data ─────────────────────────────────────────────────────
  const sections: SectionTree[] = [hero, uae, ora, bayn];

  const content: ComponentInstance[] = [];
  const zones: Record<string, ComponentInstance[]> = {};

  for (const section of sections) {
    content.push(...section.content);
    Object.assign(zones, section.zones);
  }

  return {
    id: "why-bayn",
    name: "Why Bayn",
    description: "Value-proposition narrative showcasing why the UAE, ORA, and Bayn are the ideal investment.",
    thumbnailId: "",
    data: {
      root: { props: { title: "Why Bayn" } },
      content,
      zones,
    },
  };
}
