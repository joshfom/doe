/**
 * palette-meta — Shared metadata for the ORA component palette and picker.
 *
 * Single source of truth for component icons, descriptions, category ordering,
 * and the search-matching helper. Extracted from `ComponentPalette.tsx` so both
 * the palette (left rail) and the component picker popover (canvas insertion
 * flow) can import the same metadata without duplication.
 *
 * Block definitions in `lib/page-builder/config.ts` remain untouched — this
 * module is purely a builder-shell concern (Req 7.4).
 *
 * _Requirements: 5.1, 5.2_
 */

import type { LucideIcon } from "lucide-react";
import {
  Box,
  Columns as ColumnsIcon,
  StretchHorizontal,
  ChevronDown,
  Minus,
  ArrowUpDown,
  Type,
  Heading as HeadingIcon,
  MousePointerClick,
  Link as LinkIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  Quote as QuoteIcon,
  Star,
  Images,
  LayoutList,
  ChevronsDown,
  ListChecks,
  BarChart3,
  MapPin,
  Building2,
  Layers,
  Home,
  Sparkles,
  Square,
  LayoutGrid,
  Grid3x3,
  Megaphone,
  MessageSquareQuote,
  PanelsTopLeft,
  Boxes,
  BadgeDollarSign,
  CreditCard,
  Share2,
  Timer,
  ChevronsRight,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaletteMeta = {
  description: string;
  Icon: LucideIcon;
};

// ─── Per-component metadata ──────────────────────────────────────────────────
// If a block is added to the Puck config without an entry here, callers should
// fall back to `FALLBACK_META`.

export const PALETTE_META: Record<string, PaletteMeta> = {
  // Layout
  Section: {
    description: "Full-width wrapper with background, padding, and a drop zone.",
    Icon: Square,
  },
  Container: {
    description: "Constrained-width inner block for stacking content.",
    Icon: Box,
  },
  Columns: {
    description: "Side-by-side columns with adjustable ratios.",
    Icon: ColumnsIcon,
  },
  Flex: {
    description: "Flexbox wrapper — arrange blocks in a row or column (e.g. icon beside text), responsive per device.",
    Icon: StretchHorizontal,
  },
  Accordion: {
    description: "Expandable region with its own drop zone.",
    Icon: ChevronDown,
  },
  Spacer: {
    description: "Vertical breathing room between blocks.",
    Icon: ArrowUpDown,
  },
  Divider: {
    description: "Horizontal rule separating sections.",
    Icon: Minus,
  },
  CardGrid: {
    description: "Responsive grid that lays out nested Card blocks in columns.",
    Icon: Grid3x3,
  },

  // Blocks
  Heading: {
    description: "Titles from H1 to H6 with ORA typography presets.",
    Icon: HeadingIcon,
  },
  Text: {
    description: "Rich paragraph with inline formatting.",
    Icon: Type,
  },
  Button: {
    description: "Call-to-action with link, variant, and icon.",
    Icon: MousePointerClick,
  },
  InlineLink: {
    description: "Inline anchor styled with ORA link tokens.",
    Icon: LinkIcon,
  },
  Image: {
    description: "Responsive image with alt text and aspect control.",
    Icon: ImageIcon,
  },
  Video: {
    description: "Embedded video with poster, autoplay, and controls.",
    Icon: VideoIcon,
  },
  Quote: {
    description: "Styled blockquote with accent border.",
    Icon: QuoteIcon,
  },
  Icon: {
    description: "Single lucide icon at any ORA color.",
    Icon: Star,
  },
  ImageCarousel: {
    description: "Swipeable image slider for hero sections.",
    Icon: Images,
  },
  Gallery: {
    description: "Multi-image gallery with grid or carousel mode and lightbox.",
    Icon: LayoutGrid,
  },
  Card: {
    description: "Content card with image, title, body, and optional CTA link.",
    Icon: CreditCard,
  },

  // Components
  FilterTabs: {
    description: "Horizontal tabs with superscript counts.",
    Icon: LayoutList,
  },
  ScrollIndicator: {
    description: "Floating hint that encourages scroll.",
    Icon: ChevronsDown,
  },
  IconFeatureList: {
    description: "Feature bullets each led by an icon.",
    Icon: ListChecks,
  },
  AccordionGroup: {
    description: "Stack of accordions sharing a single source of truth.",
    Icon: Layers,
  },
  StatsGrid: {
    description: "Grid of headline stats with labels.",
    Icon: BarChart3,
  },
  LocationMap: {
    description: "Pinned map with cards and pin picker.",
    Icon: MapPin,
  },
  ContactLocationsMap: {
    description: "Multi-location contact map for the Contact page.",
    Icon: MapPin,
  },

  FeaturedProjects: {
    description: "Showcase of curated projects with hero images.",
    Icon: Building2,
  },
  FeaturedCommunities: {
    description: "Showcase of curated communities.",
    Icon: Home,
  },
  ProjectSection: {
    description: "Reusable section pulled from a single project.",
    Icon: Layers,
  },
  ExperienceLauncher: {
    description: "Launches the 3D experience overlay for a project.",
    Icon: Sparkles,
  },
  CTA: {
    description: "Conversion band with heading, subtext, and buttons over a styled background.",
    Icon: Megaphone,
  },
  Testimonial: {
    description: "Social proof with quotes, authors, avatars, and star ratings.",
    Icon: MessageSquareQuote,
  },
  TabGroup: {
    description: "Switchable content panels, each holding its own nested blocks.",
    Icon: PanelsTopLeft,
  },
  LogoCloud: {
    description: "Responsive strip of partner logos with optional links and grayscale.",
    Icon: Boxes,
  },
  PricingTable: {
    description: "Side-by-side plan cards with prices, feature lists, and CTAs.",
    Icon: BadgeDollarSign,
  },
  SocialLinks: {
    description: "Row of icon links to social profiles with size, color, and alignment.",
    Icon: Share2,
  },
  Countdown: {
    description: "Live countdown timer to a date and time, with a custom expiry message.",
    Icon: Timer,
  },
  Breadcrumbs: {
    description: "Semantic breadcrumb trail with separators and JSON-LD structured data.",
    Icon: ChevronsRight,
  },
};

export const FALLBACK_META: PaletteMeta = {
  description: "Draggable block.",
  Icon: Box,
};

// ─── Fixed category order ────────────────────────────────────────────────────
// Ensures deterministic rendering: Layout → Blocks → Components → Other.
// Any categories not listed here render after these three but before "Other".

export const CATEGORY_ORDER = ["layout", "blocks", "components"] as const;

// ─── Palette grouping ────────────────────────────────────────────────────────
// Single source of truth for deriving the grouped, ordered palette listing from
// a Puck config's `categories` + `components`. Both the builder's
// `ComponentPalette` (left rail) and the Live_Editor's `ComponentSheet` consume
// this so the two surfaces stay in sync (grouping + ordering + "Other" bucket)
// rather than re-implementing the derivation.

/** Narrow subset of a Puck category definition the palette reads. */
export type PaletteCategory = {
  title?: string;
  components?: string[];
};

/** Narrow subset of a Puck component definition the palette reads. */
export type PaletteComponentDef = {
  label?: string;
};

/** A resolved palette group: a titled bucket of component type names. */
export type PaletteGroup = {
  key: string;
  title: string;
  items: string[];
};

/**
 * buildPaletteGroups — pure derivation of the ordered, grouped palette listing.
 *
 * Ordering rules (deterministic):
 *   1. Categories named in `CATEGORY_ORDER` first, in that fixed order.
 *   2. Any remaining categories in object-key order.
 *   3. An "Other" bucket for every registered component not referenced by any
 *      category, so no registered block is ever dropped from the listing.
 *
 * Only components that are actually registered in `components` are listed (a
 * category may reference a component that isn't registered). Empty groups are
 * omitted. Pure: no I/O, no DOM, no React.
 */
export function buildPaletteGroups(
  categories: Record<string, PaletteCategory>,
  components: Record<string, PaletteComponentDef>,
): PaletteGroup[] {
  const allComponents = Object.keys(components);
  const result: PaletteGroup[] = [];
  const used = new Set<string>();

  // 1. Fixed-order categories first.
  for (const key of CATEGORY_ORDER) {
    const cat = categories[key];
    if (!cat) continue;
    const items = (cat.components ?? []).filter((name) =>
      allComponents.includes(name),
    );
    items.forEach((name) => used.add(name));
    if (items.length > 0) {
      result.push({ key, title: cat.title ?? key, items });
    }
  }

  // 2. Additional categories not in the fixed order.
  for (const [key, cat] of Object.entries(categories)) {
    if ((CATEGORY_ORDER as readonly string[]).includes(key)) continue;
    const items = (cat.components ?? []).filter((name) =>
      allComponents.includes(name),
    );
    items.forEach((name) => used.add(name));
    if (items.length > 0) {
      result.push({ key, title: cat.title ?? key, items });
    }
  }

  // 3. "Other" fallback for unregistered-by-category components.
  const leftover = allComponents.filter((name) => !used.has(name));
  if (leftover.length > 0) {
    result.push({ key: "other", title: "Other", items: leftover });
  }

  return result;
}

// ─── Search helpers ──────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match across a component's label and description.
 * An empty query matches everything.
 */
export function matchesQuery(
  label: string,
  description: string,
  query: string,
): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    label.toLowerCase().includes(needle) ||
    description.toLowerCase().includes(needle)
  );
}
