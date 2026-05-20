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
};

export const FALLBACK_META: PaletteMeta = {
  description: "Draggable block.",
  Icon: Box,
};

// ─── Fixed category order ────────────────────────────────────────────────────
// Ensures deterministic rendering: Layout → Blocks → Components → Other.
// Any categories not listed here render after these three but before "Other".

export const CATEGORY_ORDER = ["layout", "blocks", "components"] as const;

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
