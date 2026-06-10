import type { LibraryComponent } from "./types";
import {
  starterHeroTemplate,
  contentImageTemplate,
  contentImageQuoteLeftTemplate,
  contentImageQuoteRightTemplate,
  contentImageAccordionLeftTemplate,
  contentImageAccordionRightTemplate,
  contentImageIconListLeftTemplate,
  contentImageIconListRightTemplate,
} from "../templates/component-templates";

/**
 * Fixed timestamp for all builtin components — they ship with the application
 * and don't change at runtime.
 */
const BUILTIN_TIMESTAMP = "2025-01-01T00:00:00.000Z";

/**
 * Convert a block-scope ComponentTemplate (with a `build()` factory) into a
 * static LibraryComponent snapshot. We call `build()` once to materialise the
 * tree and store the result as the canonical content/zones.
 */
function buildLibraryComponent(opts: {
  id: string;
  name: string;
  description: string;
  category: "global" | "content";
  build: () => { content: import("../types").ComponentInstance[]; zones: Record<string, import("../types").ComponentInstance[]> };
}): LibraryComponent {
  const { content, zones } = opts.build();
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    category: opts.category,
    scope: "builtin",
    thumbnail: null,
    content,
    zones,
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  };
}

/**
 * All built-in library components shipped with the application.
 * These are converted from the existing block-scope ComponentTemplates.
 */
export const builtinComponents: LibraryComponent[] = [
  buildLibraryComponent({
    id: "builtin-starter-hero",
    name: starterHeroTemplate.name,
    description: starterHeroTemplate.description,
    category: "global",
    build: starterHeroTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image",
    name: contentImageTemplate.name,
    description: contentImageTemplate.description,
    category: "content",
    build: contentImageTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image-quote-left",
    name: contentImageQuoteLeftTemplate.name,
    description: contentImageQuoteLeftTemplate.description,
    category: "content",
    build: contentImageQuoteLeftTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image-quote-right",
    name: contentImageQuoteRightTemplate.name,
    description: contentImageQuoteRightTemplate.description,
    category: "content",
    build: contentImageQuoteRightTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image-accordion-left",
    name: contentImageAccordionLeftTemplate.name,
    description: contentImageAccordionLeftTemplate.description,
    category: "content",
    build: contentImageAccordionLeftTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image-accordion-right",
    name: contentImageAccordionRightTemplate.name,
    description: contentImageAccordionRightTemplate.description,
    category: "content",
    build: contentImageAccordionRightTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image-icons-left",
    name: contentImageIconListLeftTemplate.name,
    description: contentImageIconListLeftTemplate.description,
    category: "content",
    build: contentImageIconListLeftTemplate.build!,
  }),
  buildLibraryComponent({
    id: "builtin-content-image-icons-right",
    name: contentImageIconListRightTemplate.name,
    description: contentImageIconListRightTemplate.description,
    category: "content",
    build: contentImageIconListRightTemplate.build!,
  }),
];
