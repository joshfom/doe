import type { ComponentInstance } from "../types";
import { typographyDefaultsHeading, typographyDefaultsText } from "../typography-fields";
import { imageDefaults } from "../image-fields";
import { animationDefaults } from "../animation-fields";

/**
 * A re-usable group of nested blocks that the user can drop into a page.
 *
 * Two flavours are supported:
 *   1. **Built-in** templates (defined in this file) provide a `build()` factory
 *      that generates fresh component IDs every call.
 *   2. **User-saved** templates loaded from the API supply pre-built `content`
 *      and `zones` with placeholder IDs; `instantiate()` regenerates them.
 *
 * In either case `instantiate(template)` returns `{ content, zones }` ready
 * to be merged into a `PageData` tree at the drop point.
 */
export interface ComponentTemplate {
  id: string;
  name: string;
  description: string;
  /** "block" inserts inline into the current zone; "page" replaces the page. */
  scope?: "block" | "page";
  thumbnail?: string | null;
  /** Built-in templates only — produces a fresh tree on every call. */
  build?: () => {
    content: ComponentInstance[];
    zones: Record<string, ComponentInstance[]>;
  };
  /** User-saved templates only — pre-built tree with placeholder IDs. */
  content?: ComponentInstance[];
  zones?: Record<string, ComponentInstance[]>;
}

/** Generate a unique component instance ID. */
export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Shared Defaults ─────────────────────────────────────────────────────────

const spacingBorderDefaults = {
  _padding: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
  _margin: { marginTop: "0", marginBottom: "0" },
  _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
} as const;

// ─── ID-regeneration helpers ─────────────────────────────────────────────────

/**
 * Walk a {content, zones} tree, replace every `props.id` with a fresh UUID,
 * and rewrite the keys of `zones` so they continue to point at the new IDs.
 *
 * Zone keys follow Puck's convention `<componentId>:<zoneName>`.
 */
export function regenerateIds(tree: {
  content: ComponentInstance[];
  zones?: Record<string, ComponentInstance[]> | null;
}): {
  content: ComponentInstance[];
  zones: Record<string, ComponentInstance[]>;
} {
  const idMap = new Map<string, string>();

  const cloneItems = (items: ComponentInstance[]): ComponentInstance[] =>
    items.map((item) => {
      const oldId = item.props.id;
      const newId = generateId();
      if (oldId) idMap.set(oldId, newId);
      return {
        type: item.type,
        props: { ...item.props, id: newId },
      };
    });

  const newContent = cloneItems(tree.content);

  const newZones: Record<string, ComponentInstance[]> = {};
  if (tree.zones) {
    for (const [zoneKey, items] of Object.entries(tree.zones)) {
      const [oldOwnerId, zoneName] = zoneKey.split(":");
      const newOwnerId = idMap.get(oldOwnerId) ?? oldOwnerId;
      newZones[`${newOwnerId}:${zoneName}`] = cloneItems(items);
    }
  }

  return { content: newContent, zones: newZones };
}

/**
 * Materialise a template into a fresh `{content, zones}` tree with new IDs.
 * Works for both built-in templates (with `build()`) and stored ones.
 */
export function instantiate(template: ComponentTemplate): {
  content: ComponentInstance[];
  zones: Record<string, ComponentInstance[]>;
} {
  if (template.build) {
    // build() already generates fresh IDs internally.
    const built = template.build();
    return { content: built.content, zones: built.zones ?? {} };
  }
  return regenerateIds({
    content: template.content ?? [],
    zones: template.zones ?? {},
  });
}

// ─── Atomic-block factory helpers ────────────────────────────────────────────

interface SectionOpts {
  sectionId?: string;
  bgMode?: string;
  bgMediaType?: string;
  bgColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientDirection?: string;
  bgImage?: string;
  bgVideoUrl?: string;
  bgVideoAutoplay?: string;
  bgVideoLoop?: string;
  bgVideoSound?: string;
  bgVideoControls?: string;
  bgVideoFit?: string;
  bgOpacity?: string;
  textColor?: string;
  minHeight?: string;
  maxHeight?: string;
  contentAlign?: string;
}

function sectionBlock(opts: SectionOpts = {}): ComponentInstance {
  return {
    type: "Section",
    props: {
      id: generateId(),
      sectionId: opts.sectionId ?? "",
      bgMode: opts.bgMode ?? "solid",
      bgMediaType: opts.bgMediaType ?? "image",
      bgColor: opts.bgColor ?? "transparent",
      gradientFrom: opts.gradientFrom ?? "#1A1A1A",
      gradientTo: opts.gradientTo ?? "#2C2C2C",
      gradientDirection: opts.gradientDirection ?? "to bottom",
      bgImage: opts.bgImage ?? "",
      bgVideoUrl: opts.bgVideoUrl ?? "",
      bgVideoAutoplay: opts.bgVideoAutoplay ?? "yes",
      bgVideoLoop: opts.bgVideoLoop ?? "yes",
      bgVideoSound: opts.bgVideoSound ?? "off",
      bgVideoControls: opts.bgVideoControls ?? "no",
      bgVideoFit: opts.bgVideoFit ?? "cover",
      bgOpacity: opts.bgOpacity ?? "1",
      textColor: opts.textColor ?? "auto",
      minHeight: opts.minHeight ?? "auto",
      maxHeight: opts.maxHeight ?? "auto",
      contentAlign: opts.contentAlign ?? "flex-start",
      ...spacingBorderDefaults,
      ...animationDefaults,
    },
  };
}

function containerBlock(maxWidth: string = "1200", paddingY: string = "0", contentAlign: string = "flex-start"): ComponentInstance {
  return {
    type: "Container",
    props: {
      id: generateId(),
      maxWidth,
      contentAlign,
      _padding: {
        paddingTop: paddingY,
        paddingBottom: paddingY,
        paddingLeft: "0",
        paddingRight: "0",
      },
      _margin: { marginTop: "0", marginBottom: "0" },
      _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
    },
  };
}

function columnsBlock(columns: string, gap: string = "md"): ComponentInstance {
  const count = Math.max(1, Number(columns) || 2);
  const columnList = Array.from({ length: count }, () => ({
    width: "1fr",
    paddingY: "0",
    paddingX: "0",
    marginY: "0",
    align: "flex-start",
    justify: "stretch",
  }));
  return {
    type: "Columns",
    props: {
      id: generateId(),
      gap,
      columnList,
      ...spacingBorderDefaults,
    },
  };
}

function headingBlock(
  text: string,
  overrides: Record<string, unknown> = {},
): ComponentInstance {
  return {
    type: "Heading",
    props: {
      id: generateId(),
      text,
      level: "h2",
      ...typographyDefaultsHeading,
      ...spacingBorderDefaults,
      ...animationDefaults,
      ...overrides,
    },
  };
}

function textBlock(
  content: string,
  overrides: Record<string, unknown> = {},
): ComponentInstance {
  return {
    type: "Text",
    props: {
      id: generateId(),
      content,
      ...typographyDefaultsText,
      ...spacingBorderDefaults,
      ...overrides,
    },
  };
}

function buttonBlock(
  text: string,
  link: string,
  overrides: Record<string, unknown> = {},
): ComponentInstance {
  // Map legacy variant/size overrides into new schema if present
  const legacyVariant = (overrides.variant as string) ?? "";
  const variantColorMap: Record<string, { bgColor: string; textColor: string; borderColor?: string; borderSize?: string }> = {
    gold:    { bgColor: "#B8956B", textColor: "#FFFFFF", borderColor: "#B8956B" },
    outline: { bgColor: "transparent", textColor: "#2C2C2C", borderColor: "#2C2C2C", borderSize: "1" },
    ghost:   { bgColor: "transparent", textColor: "#2C2C2C", borderColor: "transparent" },
    secondary: { bgColor: "#F5F3F0", textColor: "#2C2C2C", borderColor: "#E8E4DF", borderSize: "1" },
    default: { bgColor: "#2C2C2C", textColor: "#FFFFFF", borderColor: "#2C2C2C" },
    primary: { bgColor: "#2C2C2C", textColor: "#FFFFFF", borderColor: "#2C2C2C" },
  };
  const variantColors = variantColorMap[legacyVariant] ?? variantColorMap.default;
  // Strip legacy keys before applying
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { variant: _v, size: _s, link: _l, borderRadius: _br, ...rest } = overrides as Record<string, unknown>;

  return {
    type: "Button",
    props: {
      id: generateId(),
      text,
      url: link,
      _icon: { name: "", position: "right", size: "16", gap: "8px" },
      _typography: {
        fontFamily: "inherit",
        fontWeight: "600",
        fontSize: "14px",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      },
      ...variantColors,
      bgColorHover: "#4A4A4A",
      borderSize: (variantColors.borderSize ?? "0"),
      borderRadius: "0",
      btnPadding: { top: 12, right: 24, bottom: 12, left: 24 },
      _margin: { marginTop: "0", marginBottom: "0" },
      fullWidth: "no",
      alignment: "left",
      ...rest,
    },
  };
}

function imageBlock(
  src: string,
  alt: string,
  overrides: Record<string, unknown> = {},
): ComponentInstance {
  return {
    type: "Image",
    props: {
      id: generateId(),
      src,
      alt,
      ...imageDefaults,
      ...spacingBorderDefaults,
      ...animationDefaults,
      ...overrides,
    },
  };
}

function inlineLinkBlock(
  text: string,
  url: string,
  overrides: Record<string, unknown> = {},
): ComponentInstance {
  return {
    type: "InlineLink",
    props: {
      id: generateId(),
      text,
      url,
      underline: "none",
      ...typographyDefaultsText,
      color: "#B8956B",
      ...spacingBorderDefaults,
      ...overrides,
    },
  };
}

function iconBlock(
  icon: string,
  overrides: Record<string, unknown> = {},
): ComponentInstance {
  return {
    type: "Icon",
    props: {
      id: generateId(),
      icon,
      size: "32",
      color: "#2C2C2C",
      alignment: "center",
      strokeWidth: "1.5",
      ...spacingBorderDefaults,
      ...animationDefaults,
      ...overrides,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Starter Template Set (v1 reset)
// ═══════════════════════════════════════════════════════════════════════════════

function splitSectionFrame(sectionId: string) {
  const section = sectionBlock({
    sectionId,
    bgMode: "solid",
    bgMediaType: "none",
    bgColor: "#F4F2EE",
    textColor: "#2C2C2C",
    contentAlign: "center",
  });

  const container = containerBlock("1200", "70", "center");
  const columns = columnsBlock("2", "lg");

  columns.props.columnList = [
    { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "center", justify: "stretch" },
    { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "center", justify: "stretch" },
  ];

  return { section, container, columns };
}

function quoteContentPanel(): ComponentInstance[] {
  const quote: ComponentInstance = {
    type: "Quote",
    props: {
      id: generateId(),
      text: "Reimagining time, our projects are like luxury timepieces, blending intricate detail for flawless, breathtaking moments of serene luxury living.",
      accentColor: "#8CC9E8",
      accentWidth: "3",
      fontStyle: "normal",
      fontSize: "42",
      lineHeight: "1.45",
      color: "#2C2C2C",
      ...spacingBorderDefaults,
    },
  };

  const para1 = textBlock(
    "We master beautiful environments, balancing innovation with sensitive design, promising lasting memories.",
    {
      fontSize: "30",
      lineHeight: "1.55",
      color: "#3D3D3D",
      _padding: { paddingTop: "34", paddingBottom: "20", paddingLeft: "0", paddingRight: "0" },
    },
  );

  const para2 = textBlock(
    "We embrace natural locations, designing high-quality, sustainable projects that harmonize with surroundings. Our lifestyle destinations create perfect moments where life and luxury meet, for a timeless experience.",
    {
      fontSize: "30",
      lineHeight: "1.55",
      color: "#3D3D3D",
      _padding: { paddingTop: "0", paddingBottom: "28", paddingLeft: "0", paddingRight: "0" },
    },
  );

  const cta = buttonBlock("DOWNLOAD BROCHURE", "#", {
    variant: "outline",
    borderRadius: "999",
    _icon: { name: "download", position: "right", size: "16", gap: "10px" },
    _typography: {
      fontFamily: "'Montserrat', sans-serif",
      fontWeight: "500",
      fontSize: "14px",
      letterSpacing: "0",
      textTransform: "none",
    },
    btnPadding: { top: 12, right: 28, bottom: 12, left: 28 },
    alignment: "left",
  });

  return [quote, para1, para2, cta];
}

function accordionPanel(): ComponentInstance[] {
  const accordion: ComponentInstance = {
    type: "AccordionGroup",
    props: {
      id: generateId(),
      heading: "Why Bayn",
      items: [
        { title: "Strategic Location", body: "Positioned in between Dubai and Abu Dhabi." },
        { title: "Close Proximity", body: "Minutes from major roads, business districts, and daily essentials." },
        { title: "A Masterfully Planned Community", body: "A thoughtful masterplan balancing lifestyle, comfort, and connectivity." },
        { title: "55% Open Spaces", body: "A nature-forward environment designed for well-being and walkability." },
        { title: "Waterfront Living for All", body: "Coastal experiences integrated into daily life for residents and visitors." },
      ],
      defaultOpenIndex: 0,
      headingColor: "#2C2C2C",
      titleColor: "#2C2C2C",
      bodyColor: "#3D3D3D",
      dividerColor: "#D8D5D1",
      activeLineColor: "#8CC9E8",
      ...spacingBorderDefaults,
    },
  };

  return [accordion];
}

function iconListPanel(items: Array<{ icon: string; label: string }>): ComponentInstance[] {
  const list: ComponentInstance = {
    type: "IconFeatureList",
    props: {
      id: generateId(),
      items,
      iconColor: "#2C2C2C",
      textColor: "#2C2C2C",
      dividerColor: "#D8D5D1",
      iconSize: "28",
      strokeWidth: "1.5",
      fontSize: "44",
      lineHeight: "1.35",
      ...spacingBorderDefaults,
    },
  };

  return [list];
}

function buildSplitTemplate(args: {
  sectionId: string;
  imageSrc: string;
  imageAlt: string;
  mediaSide: "left" | "right";
  panel: ComponentInstance[];
}): { content: ComponentInstance[]; zones: Record<string, ComponentInstance[]> } {
  const { section, container, columns } = splitSectionFrame(args.sectionId);

  const media = imageBlock(args.imageSrc, args.imageAlt, {
    aspectRatio: "4 / 4",
    fit: "cover",
  });

  const left = args.mediaSide === "left" ? [media] : args.panel;
  const right = args.mediaSide === "left" ? args.panel : [media];

  return {
    content: [section],
    zones: {
      [`${section.props.id}:section-content`]: [container],
      [`${container.props.id}:container-content`]: [columns],
      [`${columns.props.id}:column-0`]: left,
      [`${columns.props.id}:column-1`]: right,
    },
  };
}

export const starterHeroTemplate: ComponentTemplate = {
  id: "tpl-starter-hero",
  name: "Starter Hero",
  description: "Full-screen hero with centered title, subtitle, and scroll indicator",
  scope: "block",
  build: () => {
    const section = sectionBlock({
      sectionId: "hero",
      bgMode: "solid",
      bgMediaType: "image",
      bgColor: "#1A1A1A",
      bgImage: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=2200&q=80",
      bgOpacity: "0.7",
      textColor: "#FFFFFF",
      minHeight: "100vh",
      maxHeight: "100vh",
      contentAlign: "center",
    });
    const container = containerBlock("1200", "0", "center");

    const heading = headingBlock("Why Bayn", {
      level: "h1",
      textAlign: "center",
      fontFamily: "'Montserrat', sans-serif",
      fontWeight: "300",
      fontSize: "84",
      lineHeight: "1.05",
      letterSpacing: "0",
      textTransform: "none",
      color: "#FFFFFF",
      _padding: { paddingTop: "0", paddingBottom: "18", paddingLeft: "0", paddingRight: "0" },
    });

    const subtitle = textBlock(
      "The UAE is one of the fastest-growing economies in the world",
      {
        textAlign: "center",
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: "300",
        fontSize: "34",
        lineHeight: "1.35",
        letterSpacing: "0",
        color: "#FFFFFF",
        _padding: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
      },
    );

    const scrollIndicator: ComponentInstance = {
      type: "ScrollIndicator",
      props: {
        id: generateId(),
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
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: "400",
          fontSize: "11px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        },
        animation: "bounce",
        href: "#next-section",
      },
    };

    return {
      content: [section],
      zones: {
        [`${section.props.id}:section-content`]: [container, scrollIndicator],
        [`${container.props.id}:container-content`]: [heading, subtitle],
      },
    };
  },
};

export const contentImageTemplate: ComponentTemplate = {
  id: "tpl-content-image",
  name: "Content + Image",
  description: "Starter group: image + quote + text + button as independent editable blocks",
  scope: "block",
  build: () => {
    const cols = columnsBlock("2", "lg");
    cols.props.columnList = [
      { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "center", justify: "stretch" },
      { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "center", justify: "stretch" },
    ];

    const image = imageBlock(
      "https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1400&q=80",
      "Interior image",
      { aspectRatio: "4 / 4", fit: "cover" },
    );

    const quote: ComponentInstance = {
      type: "Quote",
      props: {
        id: generateId(),
        text: "Reimagining time, our projects are like luxury timepieces, blending intricate detail for flawless, breathtaking moments of serene luxury living.",
        accentColor: "#8CC9E8",
        accentWidth: "3",
        fontStyle: "normal",
        fontSize: "42",
        lineHeight: "1.45",
        color: "#2C2C2C",
        ...spacingBorderDefaults,
      },
    };

    const para1 = textBlock(
      "We master beautiful environments, balancing innovation with sensitive design, promising lasting memories.",
      {
        fontSize: "30",
        lineHeight: "1.55",
        color: "#3D3D3D",
        _padding: { paddingTop: "24", paddingBottom: "16", paddingLeft: "0", paddingRight: "0" },
      },
    );

    const para2 = textBlock(
      "We embrace natural locations, designing high-quality, sustainable projects that harmonize with surroundings. Our lifestyle destinations create perfect moments where life and luxury meet, for a timeless experience.",
      {
        fontSize: "30",
        lineHeight: "1.55",
        color: "#3D3D3D",
        _padding: { paddingTop: "0", paddingBottom: "20", paddingLeft: "0", paddingRight: "0" },
      },
    );

    const cta = buttonBlock("DOWNLOAD BROCHURE", "#", {
      variant: "outline",
      _icon: { name: "download", position: "right", size: "16", gap: "10px" },
      borderRadius: "999",
      _typography: {
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: "500",
        fontSize: "14px",
        letterSpacing: "0",
        textTransform: "none",
      },
      btnPadding: { top: 12, right: 24, bottom: 12, left: 24 },
      alignment: "left",
    });

    return {
      content: [cols],
      zones: {
        [`${cols.props.id}:column-0`]: [image],
        [`${cols.props.id}:column-1`]: [quote, para1, para2, cta],
      },
    };
  },
};

export const contentImageQuoteLeftTemplate: ComponentTemplate = {
  id: "tpl-content-image-quote-left",
  name: "Content + Image (Quote) Left",
  description: "Image left with quote, body text, and CTA on the right",
  scope: "block",
  build: () => buildSplitTemplate({
    sectionId: "content-quote-left",
    imageSrc: "https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Architectural detail",
    mediaSide: "left",
    panel: quoteContentPanel(),
  }),
};

export const contentImageQuoteRightTemplate: ComponentTemplate = {
  id: "tpl-content-image-quote-right",
  name: "Content + Image (Quote) Right",
  description: "Image right with quote, body text, and CTA on the left",
  scope: "block",
  build: () => buildSplitTemplate({
    sectionId: "content-quote-right",
    imageSrc: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Modern residence",
    mediaSide: "right",
    panel: quoteContentPanel(),
  }),
};

export const contentImageAccordionLeftTemplate: ComponentTemplate = {
  id: "tpl-content-image-accordion-left",
  name: "Image + Accordion Left",
  description: "Image left with accordion group on the right",
  scope: "block",
  build: () => buildSplitTemplate({
    sectionId: "content-accordion-left",
    imageSrc: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Beachfront aerial",
    mediaSide: "left",
    panel: accordionPanel(),
  }),
};

export const contentImageAccordionRightTemplate: ComponentTemplate = {
  id: "tpl-content-image-accordion-right",
  name: "Image + Accordion Right",
  description: "Image right with accordion group on the left",
  scope: "block",
  build: () => buildSplitTemplate({
    sectionId: "content-accordion-right",
    imageSrc: "https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Waterfront property",
    mediaSide: "right",
    panel: accordionPanel(),
  }),
};

export const contentImageIconListLeftTemplate: ComponentTemplate = {
  id: "tpl-content-image-icons-left",
  name: "Image + Icon List Left",
  description: "Image left with icon feature list on the right",
  scope: "block",
  build: () => buildSplitTemplate({
    sectionId: "content-icons-left",
    imageSrc: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Beach pool view",
    mediaSide: "left",
    panel: iconListPanel([
      { icon: "palmtree", label: "1.2 km of Pristine Beaches" },
      { icon: "sun", label: "Beachfront Promenade" },
      { icon: "building", label: "55% Green Spaces" },
      { icon: "waves", label: "Natural Lagoons & Canals" },
    ]),
  }),
};

export const contentImageIconListRightTemplate: ComponentTemplate = {
  id: "tpl-content-image-icons-right",
  name: "Image + Icon List Right",
  description: "Image right with icon feature list on the left",
  scope: "block",
  build: () => buildSplitTemplate({
    sectionId: "content-icons-right",
    imageSrc: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1400&q=80",
    imageAlt: "Luxury villa exterior",
    mediaSide: "right",
    panel: iconListPanel([
      { icon: "home", label: "Beachfront Residences" },
      { icon: "building", label: "Architectural Masterpieces" },
      { icon: "car", label: "Seamless Indoor-Outdoor Living" },
      { icon: "eye", label: "Expansive Views" },
    ]),
  }),
};

/** All built-in component templates. */
export const componentTemplates: ComponentTemplate[] = [
  starterHeroTemplate,
  contentImageTemplate,
];
