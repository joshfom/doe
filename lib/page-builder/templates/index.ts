import type { PageData } from "../types";
import { validatePageData } from "../schema";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  thumbnailId: string;
  data: PageData;
}

export interface TemplateRegistry {
  list(): PageTemplate[];
  getById(id: string): PageTemplate | null;
  register(template: PageTemplate): void;
}

// ─── Built-in Templates ──────────────────────────────────────────────────────

const baynLandingTemplate: PageTemplate = {
  id: "bayn-landing",
  name: "Bayn Landing Page",
  description: "A luxury beachfront community landing page with hero, stats, content block, and properties.",
  thumbnailId: "tpl-bayn",
  data: {
    root: { props: { title: "Bayn — First Home Beach Community" } },
    content: [
      {
        type: "HeroBanner",
        props: {
          id: "hero-1",
          bgImage: "https://placehold.co/1920x1080/2C2C2C/FFFFFF?text=Bayn+Hero",
          title: "First Home Beach Community",
          subtitle: "A seamless balance between community dynamism and beachside retreat.",
          scrollText: "Explore More",
          scrollLink: "#stats",
          overlayOpacity: "0.3",
          height: "100",
        },
      },
      {
        type: "StatRow",
        props: {
          id: "stats-1",
          stats: [
            { value: "4.8M²", label: "Total Land Area" },
            { value: "55%", label: "Open Spaces" },
            { value: "32K", label: "Residents" },
            { value: "9K", label: "Units" },
            { value: "1.2KM", label: "Beach Front" },
          ],
          alignment: "center",
        },
      },
      {
        type: "Section",
        props: { id: "section-content-1", bgColor: "transparent", bgImage: "", bgOpacity: "1", textColor: "auto" },
      },
      {
        type: "Footer",
        props: {
          id: "footer-1",
          copyright: "© ORA 2025. All rights reserved.",
          links: [
            { label: "Privacy Policy", url: "#" },
            { label: "Terms & Conditions", url: "#" },
            { label: "Cookie Policy", url: "#" },
          ],
        },
      },
    ],
    zones: {
      "section-content-1:section-content": [
        { type: "Container", props: { id: "container-content-1", maxWidth: "1200" } },
      ],
      "container-content-1:container-content": [
        { type: "Columns", props: { id: "columns-content-1", columns: "2", gap: "md" } },
      ],
      "columns-content-1:column-0": [
        {
          type: "Image",
          props: {
            id: "img-content-1",
            src: "https://placehold.co/600x400/EBE7E2/2C2C2C?text=Bayn+Living",
            alt: "Bayn Living",
          },
        },
      ],
      "columns-content-1:column-1": [
        {
          type: "Quote",
          props: {
            id: "quote-content-1",
            text: "Why choose between vibrancy and tranquility? At Bayn, you don't have to.",
            accentColor: "#B8956B",
            fontStyle: "normal",
          },
        },
        {
          type: "Text",
          props: {
            id: "text-content-1",
            content: "Designed for those who want it all, this beachfront community in Ghantoot is where seamless accessibility meets uninterrupted sea views.\n\nWith a walkable, self-contained layout, every necessity and indulgence is within reach.",
          },
        },
        {
          type: "Button",
          props: {
            id: "btn-content-1",
            text: "DOWNLOAD BROCHURE",
            link: "#",
            variant: "outline",
            size: "md",
            fullWidth: "no",
            alignment: "left",
            borderRadius: "0",
          },
        },
      ],
    },
  },
};

const propertyShowcaseTemplate: PageTemplate = {
  id: "property-showcase",
  name: "Property Showcase",
  description: "Showcase properties with filter tabs and property cards in a grid layout.",
  thumbnailId: "tpl-properties",
  data: {
    root: { props: { title: "Our Properties" } },
    content: [
      {
        type: "Heading",
        props: { id: "h-1", text: "Explore Our Properties", level: "h1", alignment: "center", color: "#1A1A1A" },
      },
      {
        type: "Spacer",
        props: { id: "sp-1", height: "32" },
      },
      {
        type: "FilterTabs",
        props: {
          id: "tabs-1",
          tabs: [
            { label: "All", count: "10", link: "#" },
            { label: "Villas", count: "6", link: "#" },
            { label: "Townhouses", count: "4", link: "#" },
          ],
          activeIndex: 0,
        },
      },
      {
        type: "Spacer",
        props: { id: "sp-2", height: "32" },
      },
      {
        type: "Columns",
        props: { id: "cols-1", columns: "3", gap: "md" },
      },
      {
        type: "Footer",
        props: {
          id: "footer-1",
          copyright: "© ORA 2025. All rights reserved.",
          links: [{ label: "Privacy", url: "#" }, { label: "Terms", url: "#" }],
        },
      },
    ],
  },
};

const specsTemplate: PageTemplate = {
  id: "specs-page",
  name: "Specifications Page",
  description: "Accordion-based specifications page for materials, palettes, and finishes.",
  thumbnailId: "tpl-specs",
  data: {
    root: { props: { title: "Specifications" } },
    content: [
      {
        type: "Heading",
        props: { id: "h-1", text: "Specifications & Finishes", level: "h1", alignment: "left", color: "#1A1A1A" },
      },
      {
        type: "Text",
        props: { id: "t-1", content: "Explore the carefully curated materials and finishes that define every ORA property.", fontSize: "base", alignment: "left", color: "#4A4A4A" },
      },
      {
        type: "Spacer",
        props: { id: "sp-1", height: "24" },
      },
      {
        type: "Accordion",
        props: { id: "acc-1", title: "Light Palette", defaultOpen: "yes" },
      },
      {
        type: "Accordion",
        props: { id: "acc-2", title: "Dark Palette", defaultOpen: "no" },
      },
      {
        type: "Accordion",
        props: { id: "acc-3", title: "Kitchen Finishes", defaultOpen: "no" },
      },
      {
        type: "Footer",
        props: {
          id: "footer-1",
          copyright: "© ORA 2025. All rights reserved.",
          links: [{ label: "Privacy", url: "#" }, { label: "Terms", url: "#" }],
        },
      },
    ],
  },
};

const blankTemplate: PageTemplate = {
  id: "blank-page",
  name: "Blank Page",
  description: "Start from scratch with an empty page.",
  thumbnailId: "tpl-blank",
  data: {
    root: { props: { title: "New Page" } },
    content: [],
  },
};

// ─── Factory ─────────────────────────────────────────────────────────────────

const builtInTemplates: PageTemplate[] = [
  baynLandingTemplate,
  propertyShowcaseTemplate,
  specsTemplate,
  blankTemplate,
];

export function createTemplateRegistry(): TemplateRegistry {
  const templates: PageTemplate[] = [];

  function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  function register(template: PageTemplate): void {
    const validation = validatePageData(template.data);
    if (!validation.success) {
      const msgs = (validation.errors ?? []).map((e) => `${e.path}: ${e.message}`).join("; ");
      throw new Error(`Invalid template data for "${template.name}": ${msgs}`);
    }
    templates.push(deepClone(template));
  }

  for (const tpl of builtInTemplates) {
    register(tpl);
  }

  return {
    list(): PageTemplate[] { return templates.map(deepClone); },
    getById(id: string): PageTemplate | null { const found = templates.find((t) => t.id === id); return found ? deepClone(found) : null; },
    register,
  };
}
