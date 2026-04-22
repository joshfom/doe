import type { ComponentInstance } from "../types";
import { typographyDefaultsHeading, typographyDefaultsText } from "../typography-fields";
import { imageDefaults } from "../image-fields";
import { animationDefaults } from "../animation-fields";

/**
 * A pre-composed template that expands into atomic + layout components.
 * Each call to `build()` generates fresh unique IDs.
 */
export interface ComponentTemplate {
  id: string;
  name: string;
  description: string;
  build: () => {
    content: ComponentInstance[];
    zones: Record<string, ComponentInstance[]>;
  };
}

/** Generate a unique component instance ID using crypto.randomUUID(). */
export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Shared Defaults (mirrors config.ts spacingBorderDefaults) ───────────────

const spacingBorderDefaults = {
  _padding: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
  _margin: { marginTop: "0", marginBottom: "0" },
  _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
};

// ─── ORA Design System Colors ────────────────────────────────────────────────
// Gold: #B8956B | Charcoal: #2C2C2C | Charcoal Dark: #1A1A1A
// Cream: #F5F3F0 | White: #FFFFFF


// ═══════════════════════════════════════════════════════════════════════════════
// 1. Content Block
//    Section > Container > Columns(2) > [Image, [Quote + Text + Button]]
// ═══════════════════════════════════════════════════════════════════════════════

export const contentBlockTemplate: ComponentTemplate = {
  id: "tpl-content-block",
  name: "Content Block",
  description: "Image + quote + text + button in a two-column layout",
  build: () => {
    const sectionId = generateId();
    const containerId = generateId();
    const columnsId = generateId();

    return {
      content: [
        {
          type: "Section",
          props: {
            id: sectionId,
            bgColor: "transparent",
            bgImage: "",
            bgOpacity: "1",
            textColor: "auto",
            ...spacingBorderDefaults,
            ...animationDefaults,
          },
        },
      ],
      zones: {
        [`${sectionId}:section-content`]: [
          {
            type: "Container",
            props: {
              id: containerId,
              maxWidth: "1200",
              ...spacingBorderDefaults,
            },
          },
        ],
        [`${containerId}:container-content`]: [
          {
            type: "Columns",
            props: {
              id: columnsId,
              columns: "2",
              gap: "md",
              ...spacingBorderDefaults,
            },
          },
        ],
        [`${columnsId}:column-0`]: [
          {
            type: "Image",
            props: {
              id: generateId(),
              src: "https://placehold.co/600x400/EBE7E2/2C2C2C?text=Image",
              alt: "Content image",
              ...imageDefaults,
              ...spacingBorderDefaults,
              ...animationDefaults,
            },
          },
        ],
        [`${columnsId}:column-1`]: [
          {
            type: "Quote",
            props: {
              id: generateId(),
              text: "Exceptional living begins with thoughtful design and attention to every detail.",
              accentColor: "#B8956B",
              fontStyle: "normal",
              ...typographyDefaultsText,
              ...spacingBorderDefaults,
            },
          },
          {
            type: "Text",
            props: {
              id: generateId(),
              content: "Discover a curated collection of residences where modern architecture meets timeless elegance. Every space is crafted to inspire comfort and sophistication.",
              ...typographyDefaultsText,
              ...spacingBorderDefaults,
            },
          },
          {
            type: "Button",
            props: {
              id: generateId(),
              text: "LEARN MORE",
              link: "#",
              variant: "outline",
              size: "md",
              fullWidth: "no",
              alignment: "left",
              borderRadius: "0",
              ...spacingBorderDefaults,
            },
          },
        ],
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Hero Section
//    Section(bg image, dark overlay) > Container > [Heading + Text + Button]
// ═══════════════════════════════════════════════════════════════════════════════

export const heroSectionTemplate: ComponentTemplate = {
  id: "tpl-hero-section",
  name: "Hero Section",
  description: "Full-width hero with background image, heading, text, and CTA button",
  build: () => {
    const sectionId = generateId();
    const containerId = generateId();

    return {
      content: [
        {
          type: "Section",
          props: {
            id: sectionId,
            bgColor: "#1A1A1A",
            bgImage: "https://placehold.co/1920x800/2C2C2C/F5F3F0?text=Hero+Background",
            bgOpacity: "0.5",
            textColor: "#FFFFFF",
            ...spacingBorderDefaults,
            ...animationDefaults,
          },
        },
      ],
      zones: {
        [`${sectionId}:section-content`]: [
          {
            type: "Container",
            props: {
              id: containerId,
              maxWidth: "960",
              _padding: { paddingTop: "80", paddingBottom: "80", paddingLeft: "0", paddingRight: "0" },
              _margin: { marginTop: "0", marginBottom: "0" },
              _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
            },
          },
        ],
        [`${containerId}:container-content`]: [
          {
            type: "Heading",
            props: {
              id: generateId(),
              text: "Experience Luxury Living",
              level: "h1",
              ...typographyDefaultsHeading,
              fontSize: "48",
              fontWeight: "300",
              color: "#FFFFFF",
              textAlign: "center",
              letterSpacing: "2",
              textTransform: "uppercase",
              ...spacingBorderDefaults,
              ...animationDefaults,
            },
          },
          {
            type: "Text",
            props: {
              id: generateId(),
              content: "Discover an exclusive collection of residences designed for those who appreciate the finer things in life.",
              ...typographyDefaultsText,
              fontSize: "18",
              color: "#F5F3F0",
              textAlign: "center",
              lineHeight: "28",
              ...spacingBorderDefaults,
            },
          },
          {
            type: "Button",
            props: {
              id: generateId(),
              text: "EXPLORE NOW",
              link: "#",
              variant: "gold",
              size: "lg",
              fullWidth: "no",
              alignment: "center",
              borderRadius: "0",
              ...spacingBorderDefaults,
            },
          },
        ],
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Feature Section
//    Section > Container > [Heading + FeatureGrid]
// ═══════════════════════════════════════════════════════════════════════════════

export const featureSectionTemplate: ComponentTemplate = {
  id: "tpl-feature-section",
  name: "Feature Section",
  description: "Section heading followed by a feature grid showcasing key highlights",
  build: () => {
    const sectionId = generateId();
    const containerId = generateId();

    return {
      content: [
        {
          type: "Section",
          props: {
            id: sectionId,
            bgColor: "#F5F3F0",
            bgImage: "",
            bgOpacity: "1",
            textColor: "auto",
            ...spacingBorderDefaults,
            ...animationDefaults,
          },
        },
      ],
      zones: {
        [`${sectionId}:section-content`]: [
          {
            type: "Container",
            props: {
              id: containerId,
              maxWidth: "1200",
              _padding: { paddingTop: "60", paddingBottom: "60", paddingLeft: "0", paddingRight: "0" },
              _margin: { marginTop: "0", marginBottom: "0" },
              _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
            },
          },
        ],
        [`${containerId}:container-content`]: [
          {
            type: "Heading",
            props: {
              id: generateId(),
              text: "Why Choose ORA",
              level: "h2",
              ...typographyDefaultsHeading,
              fontSize: "36",
              fontWeight: "300",
              color: "#1A1A1A",
              textAlign: "center",
              letterSpacing: "1",
              textTransform: "uppercase",
              _padding: { paddingTop: "0", paddingBottom: "32", paddingLeft: "0", paddingRight: "0" },
              _margin: { marginTop: "0", marginBottom: "0" },
              _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
              ...animationDefaults,
            },
          },
          {
            type: "FeatureGrid",
            props: {
              id: generateId(),
              title: "Unit Features",
              features: [
                { icon: "🛡️", label: "Premium Quality" },
                { icon: "☀️", label: "Natural Light" },
                { icon: "🌊", label: "Waterfront Living" },
                { icon: "🏊", label: "Resort Amenities" },
              ],
              columns: "4",
              ...spacingBorderDefaults,
            },
          },
        ],
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CTA Section
//    Section(charcoal bg) > Container > [Heading + Text + Button(gold)]
// ═══════════════════════════════════════════════════════════════════════════════

export const ctaSectionTemplate: ComponentTemplate = {
  id: "tpl-cta-section",
  name: "CTA Section",
  description: "Dark charcoal call-to-action with heading, text, and gold button",
  build: () => {
    const sectionId = generateId();
    const containerId = generateId();

    return {
      content: [
        {
          type: "Section",
          props: {
            id: sectionId,
            bgColor: "#2C2C2C",
            bgImage: "",
            bgOpacity: "1",
            textColor: "#FFFFFF",
            ...spacingBorderDefaults,
            ...animationDefaults,
          },
        },
      ],
      zones: {
        [`${sectionId}:section-content`]: [
          {
            type: "Container",
            props: {
              id: containerId,
              maxWidth: "960",
              _padding: { paddingTop: "60", paddingBottom: "60", paddingLeft: "0", paddingRight: "0" },
              _margin: { marginTop: "0", marginBottom: "0" },
              _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
            },
          },
        ],
        [`${containerId}:container-content`]: [
          {
            type: "Heading",
            props: {
              id: generateId(),
              text: "Ready to Find Your Dream Home?",
              level: "h2",
              ...typographyDefaultsHeading,
              fontSize: "36",
              fontWeight: "300",
              color: "#FFFFFF",
              textAlign: "center",
              letterSpacing: "1",
              textTransform: "uppercase",
              ...spacingBorderDefaults,
              ...animationDefaults,
            },
          },
          {
            type: "Text",
            props: {
              id: generateId(),
              content: "Schedule a private viewing and experience the ORA lifestyle firsthand. Our team is ready to guide you through every step.",
              ...typographyDefaultsText,
              fontSize: "18",
              color: "#F5F3F0",
              textAlign: "center",
              lineHeight: "28",
              ...spacingBorderDefaults,
            },
          },
          {
            type: "Button",
            props: {
              id: generateId(),
              text: "SCHEDULE A VIEWING",
              link: "#",
              variant: "gold",
              size: "lg",
              fullWidth: "no",
              alignment: "center",
              borderRadius: "0",
              ...spacingBorderDefaults,
            },
          },
        ],
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Testimonial Section
//    Section > Container > [Heading + Columns(3) > [Quote, Quote, Quote]]
// ═══════════════════════════════════════════════════════════════════════════════

export const testimonialSectionTemplate: ComponentTemplate = {
  id: "tpl-testimonial-section",
  name: "Testimonial Section",
  description: "Three testimonial quotes in a three-column layout with a section heading",
  build: () => {
    const sectionId = generateId();
    const containerId = generateId();
    const columnsId = generateId();

    return {
      content: [
        {
          type: "Section",
          props: {
            id: sectionId,
            bgColor: "#F5F3F0",
            bgImage: "",
            bgOpacity: "1",
            textColor: "auto",
            ...spacingBorderDefaults,
            ...animationDefaults,
          },
        },
      ],
      zones: {
        [`${sectionId}:section-content`]: [
          {
            type: "Container",
            props: {
              id: containerId,
              maxWidth: "1200",
              _padding: { paddingTop: "60", paddingBottom: "60", paddingLeft: "0", paddingRight: "0" },
              _margin: { marginTop: "0", marginBottom: "0" },
              _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
            },
          },
        ],
        [`${containerId}:container-content`]: [
          {
            type: "Heading",
            props: {
              id: generateId(),
              text: "What Our Residents Say",
              level: "h2",
              ...typographyDefaultsHeading,
              fontSize: "36",
              fontWeight: "300",
              color: "#1A1A1A",
              textAlign: "center",
              letterSpacing: "1",
              textTransform: "uppercase",
              _padding: { paddingTop: "0", paddingBottom: "32", paddingLeft: "0", paddingRight: "0" },
              _margin: { marginTop: "0", marginBottom: "0" },
              _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
              ...animationDefaults,
            },
          },
          {
            type: "Columns",
            props: {
              id: columnsId,
              columns: "3",
              gap: "md",
              ...spacingBorderDefaults,
            },
          },
        ],
        [`${columnsId}:column-0`]: [
          {
            type: "Quote",
            props: {
              id: generateId(),
              text: "The attention to detail in every corner of our home is remarkable. ORA truly understands luxury living.",
              accentColor: "#B8956B",
              fontStyle: "italic",
              ...typographyDefaultsText,
              ...spacingBorderDefaults,
            },
          },
        ],
        [`${columnsId}:column-1`]: [
          {
            type: "Quote",
            props: {
              id: generateId(),
              text: "From the concierge service to the stunning views, every day feels like a retreat. We could not be happier.",
              accentColor: "#B8956B",
              fontStyle: "italic",
              ...typographyDefaultsText,
              ...spacingBorderDefaults,
            },
          },
        ],
        [`${columnsId}:column-2`]: [
          {
            type: "Quote",
            props: {
              id: generateId(),
              text: "The community here is wonderful and the amenities are world-class. It is everything we dreamed of and more.",
              accentColor: "#B8956B",
              fontStyle: "italic",
              ...typographyDefaultsText,
              ...spacingBorderDefaults,
            },
          },
        ],
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Aggregated Exports
// ═══════════════════════════════════════════════════════════════════════════════

/** All component templates in a single array. */
export const componentTemplates: ComponentTemplate[] = [
  contentBlockTemplate,
  heroSectionTemplate,
  featureSectionTemplate,
  ctaSectionTemplate,
  testimonialSectionTemplate,
];
