import type { BreakpointValue } from "../../breakpoints";

// ─── Shared type aliases ────────────────────────────────────────────────────

/** Padding per side, breakpoint-aware. */
export type PaddingBP = BreakpointValue<{
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
}>;

/** Single breakpoint-aware scalar. */
export type ScalarBP<T = string> = BreakpointValue<T>;

// ─── Mobile Breakpoint Defaults ─────────────────────────────────────────────

export const ARCHETYPE_DEFAULT_SECTION_PADDING: PaddingBP = {
  desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
  mobile: { paddingTop: "64", paddingBottom: "64", paddingLeft: "16", paddingRight: "16" },
};

export const ARCHETYPE_DEFAULT_HEADING_H1_FONT_SIZE: ScalarBP<number> = { desktop: 64, mobile: 40 };
export const ARCHETYPE_DEFAULT_HEADING_H2_FONT_SIZE: ScalarBP<number> = { desktop: 40, mobile: 28 };
export const ARCHETYPE_DEFAULT_HEADING_H3_FONT_SIZE: ScalarBP<number> = { desktop: 28, mobile: 22 };
export const ARCHETYPE_DEFAULT_BODY_FONT_SIZE: ScalarBP<number> = { desktop: 18, mobile: 16 };
export const ARCHETYPE_DEFAULT_QUOTE_FONT_SIZE: ScalarBP<number> = { desktop: 16, mobile: 16 };

export const ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO: ScalarBP<string> = { desktop: "4 / 5", mobile: "16 / 9" };
export const ARCHETYPE_DEFAULT_IMAGE_ASPECT_RATIO_FULL_WIDTH: ScalarBP<string> = { desktop: "21 / 9", mobile: "16 / 9" };

// ─── Curated Palette ────────────────────────────────────────────────────────

export const ORA_PAGE_TEMPLATE_PALETTE = [
  "#FFFFFF",  // White
  "#F8F6F2",  // ORA Ivory
  "#F2EDE3",  // ORA Sand
  "#F9F7F5",  // Cream Light
  "#F5F3F0",  // Cream
  "#EBE7E2",  // Cream Dark
  "#E8E4DF",  // Sand
  "#B8956B",  // Gold
  "#8CC9E8",  // Sky Accent
  "#01A7C7",  // ORA Cyan
  "#2C2C2C",  // Charcoal
  "#1A1A1A",  // Charcoal Dark
  "#111432",  // ORA Navy
  "#000000",  // Black
] as const;

// ─── Canonical Gradient Pairs ───────────────────────────────────────────────

export interface GradientPair {
  from: string;
  to: string;
  direction: string;
}

export const ORA_PAGE_TEMPLATE_GRADIENTS = {
  "cream-warm": { from: "#F9F7F5", to: "#EBE7E2", direction: "to bottom" },
  "ivory-sand": { from: "#F8F6F2", to: "#F2EDE3", direction: "to bottom" },
  "sand-stone": { from: "#F2EDE3", to: "#E8E4DF", direction: "to bottom" },
  "charcoal-deep": { from: "#2C2C2C", to: "#1A1A1A", direction: "to bottom" },
  "navy-cyan": { from: "#111432", to: "#01A7C7", direction: "to bottom" },
} as const satisfies Record<string, GradientPair>;

// ─── Image Asset Strategy ───────────────────────────────────────────────────

export const ORA_TEMPLATE_IMAGES: Record<string, string> = {
  projectHero: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=2200&q=80",
  projectFloorplan: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1400&q=80",
  projectLifestyle: "https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1400&q=80",
  bayanMasterplan: "https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1400&q=80",
  bayanCommunity: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1400&q=80",
  bayanBeachfront: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1400&q=80",
  bayanGreenSpaces: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=80",
  lifeBeach: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=2200&q=80",
  lifeRetail: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=80",
  oraTeam: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1400&q=80",
  oraArchitecture: "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1400&q=80",
  oraPortfolio: "https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=2200&q=80",
} as const;
