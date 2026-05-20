/**
 * Section archetype builders — shared shell helpers and type definitions.
 *
 * This module provides the foundational types and private helpers used by
 * the eight archetype builder functions (buildHero, buildImageText, etc.)
 * that compose the four ORA page templates.
 *
 * Design reference: `.kiro/specs/ora-page-templates/design.md`
 * Validates: Requirements 1.1–1.11, 8.1, 8.2, 9.5
 */

import type { ComponentInstance } from "../../types";
import type { BreakpointValue } from "../../breakpoints";
import {
  type PaddingBP,
  type ScalarBP,
  type GradientPair,
  ARCHETYPE_DEFAULT_SECTION_PADDING,
  ARCHETYPE_DEFAULT_HEADING_H1_FONT_SIZE,
  ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE,
  ARCHETYPE_DEFAULT_HEADING_H3_FONT_SIZE,
  ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
  ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO,
  ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO_FULL_WIDTH,
} from "./archetype-defaults";

// ─── Re-exports for downstream consumers ───────────────────────────────────

export type { PaddingBP, ScalarBP, GradientPair };

// ─── Core types ─────────────────────────────────────────────────────────────

/** Return shape of every archetype builder function. */
export interface SectionTree {
  /** Root-level component instances — always exactly one Section per archetype call. */
  content: ComponentInstance[];
  /** Zone keys ("<componentId>:<zoneName>") → child component arrays. */
  zones: Record<string, ComponentInstance[]>;
}

/** The eight named section archetypes. */
export type Archetype =
  | "hero"
  | "image+text"
  | "text+image"
  | "heading+full-width-image"
  | "heading+accordions"
  | "split-content"
  | "cta"
  | "quote-feature";


// ─── Background variant types ───────────────────────────────────────────────

export interface GradientFill {
  kind: "gradient";
  pair: GradientPair;
}

export interface GradientHero {
  kind: "gradient-hero";
  pair: GradientPair;
}

export interface ImageHero {
  kind: "image-hero";
  src: string;
  position?: string;
  opacity?: string;
}

// ─── Section shell options ──────────────────────────────────────────────────

export interface SectionShellOpts {
  sectionId: string;
  background: GradientHero | ImageHero | GradientFill;
  padding?: PaddingBP;
  textColor?: string;
  minHeight?: string;
  maxHeight?: string;
  contentAlign?: "flex-start" | "center" | "flex-end";
}

// ─── Per-archetype builder option types ─────────────────────────────────────

export interface HeroOpts extends SectionShellOpts {
  heading: { text: string; level?: "h1" | "h2"; fontSize?: ScalarBP<number>; color?: string };
  subtitle?: { text: string; fontSize?: ScalarBP<number>; color?: string };
  cta?: { text: string; url: string };
}

export interface ImageTextOpts extends SectionShellOpts {
  imageSide: "left" | "right";
  image: { src: string; alt: string; aspectRatio?: ScalarBP<string> };
  heading: { text: string; level: "h2" | "h3"; fontSize?: ScalarBP<number> };
  text: { content: string; fontSize?: ScalarBP<number> };
  cta?: { text: string; url: string };
}

export interface HeadingFullWidthImageOpts extends SectionShellOpts {
  heading: { text: string; level: "h2" | "h3"; fontSize?: ScalarBP<number> };
  text: { content: string; fontSize?: ScalarBP<number> };
  image: { src: string; alt: string; aspectRatio?: ScalarBP<string> };
}

export interface HeadingAccordionsOpts extends SectionShellOpts {
  heading: { text: string; level: "h2" | "h3"; fontSize?: ScalarBP<number> };
  text: { content: string; fontSize?: ScalarBP<number> };
  accordions: { items: { title: string; body: string }[] };
}

export interface SplitContentOpts extends SectionShellOpts {
  imageSide: "left" | "right";
  image: { src: string; alt: string; aspectRatio?: ScalarBP<string> };
  quote: { text: string; fontSize?: ScalarBP<number>; accentColor?: string };
  body: { content: string; fontSize?: ScalarBP<number> };
  cta: { text: string; url: string };
}

export interface CtaOpts extends SectionShellOpts {
  heading: { text: string; level: "h2"; fontSize?: ScalarBP<number> };
  body: { content: string; fontSize?: ScalarBP<number> };
  cta: { text: string; url: string; variant?: "gold" | "outline" | "default" };
}

export interface QuoteFeatureOpts extends SectionShellOpts {
  quote: { text: string; fontSize?: ScalarBP<number>; accentColor?: string };
}


// ─── Shared block defaults ──────────────────────────────────────────────────

const ZERO_MARGIN: BreakpointValue<{ marginTop: string; marginBottom: string }> = {
  desktop: { marginTop: "0", marginBottom: "0" },
  mobile: { marginTop: "0", marginBottom: "0" },
};

const ZERO_BORDER: BreakpointValue<{ borderWidth: string; borderColor: string; borderRadius: string }> = {
  desktop: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
  mobile: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
};

const ZERO_PADDING: BreakpointValue<{ paddingTop: string; paddingBottom: string; paddingLeft: string; paddingRight: string }> = {
  desktop: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
  mobile: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
};

const DEFAULT_BTN_PADDING: BreakpointValue<{ top: number; right: number; bottom: number; left: number }> = {
  desktop: { top: 12, right: 24, bottom: 12, left: 24 },
  mobile: { top: 12, right: 24, bottom: 12, left: 24 },
};

const DEFAULT_COLUMN_GAP: BreakpointValue<string> = { desktop: "32px", mobile: "0px" };
const DEFAULT_ROW_GAP: BreakpointValue<string> = { desktop: "32px", mobile: "24px" };
const DEFAULT_IMG_WIDTH: BreakpointValue<string> = { desktop: "100%", mobile: "100%" };
const DEFAULT_IMG_HEIGHT: BreakpointValue<string> = { desktop: "auto", mobile: "auto" };

// ─── Private helpers ────────────────────────────────────────────────────────

/**
 * Constructs a Section block instance with background, padding, and the
 * hidden `_archetype` tag.
 */
export function sectionShell(opts: SectionShellOpts & { _archetype: Archetype }): ComponentInstance {
  const id = crypto.randomUUID();
  const padding: PaddingBP = opts.padding ?? ARCHETYPE_DEFAULT_SECTION_PADDING;

  let bgMode: string;
  let bgMediaType: string;
  let bgImage: string;
  let gradientFrom: string;
  let gradientTo: string;
  let gradientDirection: string;

  switch (opts.background.kind) {
    case "image-hero":
      bgMode = "solid";
      bgMediaType = "image";
      bgImage = opts.background.src;
      gradientFrom = "#1A1A1A";
      gradientTo = "#2C2C2C";
      gradientDirection = "to bottom";
      break;
    case "gradient-hero":
      bgMode = "gradient";
      bgMediaType = "none";
      bgImage = "";
      gradientFrom = opts.background.pair.from;
      gradientTo = opts.background.pair.to;
      gradientDirection = opts.background.pair.direction;
      break;
    case "gradient":
      bgMode = "gradient";
      bgMediaType = "none";
      bgImage = "";
      gradientFrom = opts.background.pair.from;
      gradientTo = opts.background.pair.to;
      gradientDirection = opts.background.pair.direction;
      break;
  }

  return {
    type: "Section",
    props: {
      id,
      "section-content": [],
      sectionId: opts.sectionId,
      bgMode,
      bgMediaType,
      bgColor: "transparent",
      bgImage,
      bgPosition: opts.background.kind === "image-hero" ? (opts.background.position ?? "center center") : "center center",
      bgOpacity: opts.background.kind === "image-hero" ? (opts.background.opacity ?? "1") : "1",
      bgVideoUrl: "",
      bgVideoPosition: "center center",
      bgVideoAutoplay: "yes",
      bgVideoLoop: "yes",
      bgVideoSound: "off",
      bgVideoControls: "no",
      bgVideoFit: "cover",
      bgVideoPoster: "",
      gradientFrom,
      gradientTo,
      gradientDirection,
      textColor: opts.textColor ?? "auto",
      minHeight: opts.minHeight ?? "auto",
      maxHeight: opts.maxHeight ?? "auto",
      contentAlign: opts.contentAlign ?? "flex-start",
      _padding: padding,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
      _animation: { entrance: "none", duration: "0.5", delay: "0", hover: "none" },
      _archetype: opts._archetype,
    },
  };
}

/**
 * Constructs a default Container block instance.
 */
export function containerShell(contentAlign?: string): ComponentInstance {
  const id = crypto.randomUUID();

  return {
    type: "Container",
    props: {
      id,
      "container-content": [],
      maxWidth: "1200",
      bgMode: "solid",
      bgColor: "transparent",
      gradientFrom: "#F9F7F5",
      gradientTo: "#EBE7E2",
      gradientDirection: "to bottom",
      textColor: "auto",
      contentAlign: contentAlign ?? "center",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}


// ─── Block factory helpers ──────────────────────────────────────────────────

function makeHeading(opts: {
  text: string;
  level: string;
  fontSize: ScalarBP<number>;
  color?: string;
}): ComponentInstance {
  return {
    type: "Heading",
    props: {
      id: crypto.randomUUID(),
      text: opts.text,
      level: opts.level,
      fontWeight: "700",
      fontSize: opts.fontSize,
      textAlign: "left",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { desktop: "auto", mobile: "auto" },
      letterSpacing: { desktop: "normal", mobile: "normal" },
      color: opts.color ?? "#1A1A1A",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeText(opts: {
  content: string;
  fontSize: ScalarBP<number>;
  color?: string;
}): ComponentInstance {
  return {
    type: "Text",
    props: {
      id: crypto.randomUUID(),
      content: opts.content,
      fontWeight: "400",
      fontSize: opts.fontSize,
      textAlign: "left",
      fontStyle: "normal",
      textDecoration: "none",
      textTransform: "none",
      lineHeight: { desktop: "auto", mobile: "auto" },
      letterSpacing: { desktop: "normal", mobile: "normal" },
      color: opts.color ?? "#4A4A4A",
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeButton(opts: {
  text: string;
  url: string;
  variant?: "gold" | "outline" | "default";
}): ComponentInstance {
  let bgColor = "#2C2C2C";
  let bgColorHover = "#4A4A4A";
  let textColor = "#FFFFFF";
  let borderSize = "0";
  let borderColor = "#2C2C2C";

  if (opts.variant === "gold") {
    bgColor = "#B8956B";
    bgColorHover = "#A07D5A";
    textColor = "#FFFFFF";
  } else if (opts.variant === "outline") {
    bgColor = "transparent";
    bgColorHover = "#2C2C2C";
    textColor = "#2C2C2C";
    borderSize = "1";
    borderColor = "#2C2C2C";
  }

  return {
    type: "Button",
    props: {
      id: crypto.randomUUID(),
      text: opts.text,
      url: opts.url,
      _icon: { name: "", position: "right", size: "16", gap: "8px" },
      _typography: {
        fontWeight: "600",
        fontSize: "14px",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      },
      textColor,
      textColorHover: textColor,
      bgColor,
      bgColorHover,
      borderColor,
      borderColorHover: borderColor,
      borderSize,
      borderRadius: "0",
      btnPadding: DEFAULT_BTN_PADDING,
      _margin: ZERO_MARGIN,
      fullWidth: "no",
      alignment: "left",
    },
  };
}


function makeImage(opts: {
  src: string;
  alt: string;
  aspectRatio: ScalarBP<string>;
  imgWidth?: ScalarBP<string>;
}): ComponentInstance {
  return {
    type: "Image",
    props: {
      id: crypto.randomUUID(),
      src: opts.src,
      alt: opts.alt,
      objectFit: "cover",
      xAlign: "50%",
      yAlign: "50%",
      imgWidth: opts.imgWidth ?? DEFAULT_IMG_WIDTH,
      maxWidth: "100%",
      imgHeight: DEFAULT_IMG_HEIGHT,
      aspectRatio: opts.aspectRatio,
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

function makeQuote(opts: {
  text: string;
  fontSize: ScalarBP<number>;
  accentColor?: string;
}): ComponentInstance {
  return {
    type: "Quote",
    props: {
      id: crypto.randomUUID(),
      text: opts.text,
      accentColor: opts.accentColor ?? "#8CC9E8",
      accentWidth: "2",
      fontWeight: "400",
      fontSize: opts.fontSize,
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

function makeColumns(): ComponentInstance {
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
      gap: "md",
      columnList: [
        { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
        { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
      ],
      columnGap: DEFAULT_COLUMN_GAP,
      rowGap: DEFAULT_ROW_GAP,
      _padding: ZERO_PADDING,
      _margin: ZERO_MARGIN,
      _border: ZERO_BORDER,
    },
  };
}

function makeAccordionGroup(opts: {
  items: { title: string; body: string }[];
}): ComponentInstance {
  return {
    type: "AccordionGroup",
    props: {
      id: crypto.randomUUID(),
      heading: "",
      items: opts.items.map((item) => ({ title: item.title, body: item.body })),
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
      activeLineColor: "#8CC9E8",
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


// ─── Archetype builder functions ────────────────────────────────────────────

/**
 * buildHero — Section > Container > Heading + Text + optional Button
 * _archetype = "hero", Container.contentAlign = "center"
 */
export function buildHero(opts: HeroOpts): SectionTree {
  const section = sectionShell({ ...opts, contentAlign: opts.contentAlign ?? "center", _archetype: "hero" });
  const container = containerShell("center");

  const headingLevel = opts.heading.level ?? "h1";
  const headingFontSize = opts.heading.fontSize ?? ARCHETYPE_DEFAULT_HEADING_H1_FONT_SIZE;

  const heading = makeHeading({
    text: opts.heading.text,
    level: headingLevel,
    fontSize: headingFontSize,
    color: opts.heading.color,
  });

  const containerChildren: ComponentInstance[] = [heading];

  if (opts.subtitle) {
    const subtitle = makeText({
      content: opts.subtitle.text,
      fontSize: opts.subtitle.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
      color: opts.subtitle.color,
    });
    containerChildren.push(subtitle);
  }

  if (opts.cta) {
    const button = makeButton({ text: opts.cta.text, url: opts.cta.url });
    containerChildren.push(button);
  }

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: containerChildren,
    },
  };
}

/**
 * buildImageText — Section > Container > Columns(2) where col0=Image, col1=Heading+Text+optional Button
 * _archetype = "image+text"
 */
export function buildImageText(opts: ImageTextOpts): SectionTree {
  const section = sectionShell({ ...opts, _archetype: "image+text" });
  const container = containerShell();
  const columns = makeColumns();

  const image = makeImage({
    src: opts.image.src,
    alt: opts.image.alt,
    aspectRatio: opts.image.aspectRatio ?? ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO,
  });

  const headingFontSize = opts.heading.fontSize ??
    (opts.heading.level === "h2" ? ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE : ARCHETYPE_DEFAULT_HEADING_H3_FONT_SIZE);

  const heading = makeHeading({
    text: opts.heading.text,
    level: opts.heading.level,
    fontSize: headingFontSize,
  });

  const text = makeText({
    content: opts.text.content,
    fontSize: opts.text.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  });

  const textColumnChildren: ComponentInstance[] = [heading, text];
  if (opts.cta) {
    textColumnChildren.push(makeButton({ text: opts.cta.text, url: opts.cta.url }));
  }

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;
  const columnsId = columns.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [columns],
      [`${columnsId}:column-0`]: [image],
      [`${columnsId}:column-1`]: textColumnChildren,
    },
  };
}

/**
 * buildTextImage — Section > Container > Columns(2) where col0=Heading+Text+optional Button, col1=Image
 * _archetype = "text+image" (column ordering swapped vs buildImageText)
 */
export function buildTextImage(opts: ImageTextOpts): SectionTree {
  const section = sectionShell({ ...opts, _archetype: "text+image" });
  const container = containerShell();
  const columns = makeColumns();

  const image = makeImage({
    src: opts.image.src,
    alt: opts.image.alt,
    aspectRatio: opts.image.aspectRatio ?? ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO,
  });

  const headingFontSize = opts.heading.fontSize ??
    (opts.heading.level === "h2" ? ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE : ARCHETYPE_DEFAULT_HEADING_H3_FONT_SIZE);

  const heading = makeHeading({
    text: opts.heading.text,
    level: opts.heading.level,
    fontSize: headingFontSize,
  });

  const text = makeText({
    content: opts.text.content,
    fontSize: opts.text.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  });

  const textColumnChildren: ComponentInstance[] = [heading, text];
  if (opts.cta) {
    textColumnChildren.push(makeButton({ text: opts.cta.text, url: opts.cta.url }));
  }

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;
  const columnsId = columns.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [columns],
      [`${columnsId}:column-0`]: textColumnChildren,
      [`${columnsId}:column-1`]: [image],
    },
  };
}


/**
 * buildHeadingFullWidthImage — Section > Container > Heading + Text + Image(imgWidth=100%)
 * _archetype = "heading+full-width-image"
 */
export function buildHeadingFullWidthImage(opts: HeadingFullWidthImageOpts): SectionTree {
  const section = sectionShell({ ...opts, _archetype: "heading+full-width-image" });
  const container = containerShell();

  const headingFontSize = opts.heading.fontSize ??
    (opts.heading.level === "h2" ? ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE : ARCHETYPE_DEFAULT_HEADING_H3_FONT_SIZE);

  const heading = makeHeading({
    text: opts.heading.text,
    level: opts.heading.level,
    fontSize: headingFontSize,
  });

  const text = makeText({
    content: opts.text.content,
    fontSize: opts.text.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  });

  const image = makeImage({
    src: opts.image.src,
    alt: opts.image.alt,
    aspectRatio: opts.image.aspectRatio ?? ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO_FULL_WIDTH,
    imgWidth: { desktop: "100%", mobile: "100%" },
  });

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [heading, text, image],
    },
  };
}

/**
 * buildHeadingAccordions — Section > Container > Heading + Text + AccordionGroup
 * _archetype = "heading+accordions"
 * Uses AccordionGroup (the canonical multi-item accordion component).
 */
export function buildHeadingAccordions(opts: HeadingAccordionsOpts): SectionTree {
  const section = sectionShell({ ...opts, _archetype: "heading+accordions" });
  const container = containerShell();

  const headingFontSize = opts.heading.fontSize ??
    (opts.heading.level === "h2" ? ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE : ARCHETYPE_DEFAULT_HEADING_H3_FONT_SIZE);

  const heading = makeHeading({
    text: opts.heading.text,
    level: opts.heading.level,
    fontSize: headingFontSize,
  });

  const text = makeText({
    content: opts.text.content,
    fontSize: opts.text.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  });

  const accordionGroup = makeAccordionGroup({ items: opts.accordions.items });

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [heading, text, accordionGroup],
    },
  };
}

/**
 * buildSplitContent — Section > Container > Columns(2) where one col=Image, other col=Quote+Text+Button
 * _archetype = "split-content". Column ordering driven by opts.imageSide.
 */
export function buildSplitContent(opts: SplitContentOpts): SectionTree {
  const section = sectionShell({ ...opts, _archetype: "split-content" });
  const container = containerShell();
  const columns = makeColumns();

  const image = makeImage({
    src: opts.image.src,
    alt: opts.image.alt,
    aspectRatio: opts.image.aspectRatio ?? ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO,
  });

  const quote = makeQuote({
    text: opts.quote.text,
    fontSize: opts.quote.fontSize ?? ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
    accentColor: opts.quote.accentColor,
  });

  const text = makeText({
    content: opts.body.content,
    fontSize: opts.body.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  });

  const button = makeButton({ text: opts.cta.text, url: opts.cta.url });

  const contentColumn: ComponentInstance[] = [quote, text, button];

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;
  const columnsId = columns.props.id as string;

  const col0 = opts.imageSide === "left" ? [image] : contentColumn;
  const col1 = opts.imageSide === "left" ? contentColumn : [image];

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [columns],
      [`${columnsId}:column-0`]: col0,
      [`${columnsId}:column-1`]: col1,
    },
  };
}


/**
 * buildCta — Section > Container(contentAlign=center) > Heading + Text + Button
 * _archetype = "cta"
 */
export function buildCta(opts: CtaOpts): SectionTree {
  const section = sectionShell({ ...opts, contentAlign: opts.contentAlign ?? "center", _archetype: "cta" });
  const container = containerShell("center");

  const headingFontSize = opts.heading.fontSize ?? ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE;

  const heading = makeHeading({
    text: opts.heading.text,
    level: opts.heading.level,
    fontSize: headingFontSize,
  });

  const text = makeText({
    content: opts.body.content,
    fontSize: opts.body.fontSize ?? ARCHETYPE_DEFAULT_BODY_FONT_SIZE,
  });

  const button = makeButton({
    text: opts.cta.text,
    url: opts.cta.url,
    variant: opts.cta.variant,
  });

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [heading, text, button],
    },
  };
}

/**
 * buildQuoteFeature — Section > Container > Quote
 * _archetype = "quote-feature"
 */
export function buildQuoteFeature(opts: QuoteFeatureOpts): SectionTree {
  const section = sectionShell({ ...opts, _archetype: "quote-feature" });
  const container = containerShell();

  const quote = makeQuote({
    text: opts.quote.text,
    fontSize: opts.quote.fontSize ?? ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE,
    accentColor: opts.quote.accentColor,
  });

  const sectionId = section.props.id as string;
  const containerId = container.props.id as string;

  return {
    content: [section],
    zones: {
      [`${sectionId}:section-content`]: [container],
      [`${containerId}:container-content`]: [quote],
    },
  };
}
