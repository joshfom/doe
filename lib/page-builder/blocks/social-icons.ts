/**
 * Inline-SVG brand-icon registry for the page-builder SocialLinks block.
 *
 * lucide-react (the source of `ICON_MAP` in `config.ts`) ships only a limited
 * set of social brand marks, so this module supplies a small, self-contained
 * set of brand SVGs for the common platforms an Author links to: Facebook,
 * Instagram, X, LinkedIn, YouTube, TikTok, and WhatsApp. The components are
 * merged into `ICON_MAP` at module load (see `config.ts`) so each `SocialItem`
 * can resolve its `icon` key the same way every other block does — keeping the
 * `ICON_MAP` contract intact and avoiding a new icon dependency.
 *
 * Each component matches the shared icon contract used throughout the builder:
 *
 *   React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
 *
 * Brand marks are solid (filled) glyphs rather than stroked line icons, so:
 *   - `size`  → the SVG `width`/`height` (defaults to 24, matching lucide).
 *   - `color` → `fill` (defaults to `"currentColor"` so the icon follows the
 *               inherited text color or the block's `iconColor` prop).
 *   - `strokeWidth` is accepted for contract compatibility with the lucide
 *     line icons but is intentionally unused — these are fill-based glyphs.
 *
 * Like the other `blocks/` helpers, this file builds its output with
 * `React.createElement` (not JSX) so it composes cleanly inside the
 * `React.createElement`-based `config.ts` render path and stays a `.ts` file.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 8 — SocialLinks" → "ICON_MAP additions"
 * Validates: Requirements 7.3
 */

import React from "react";

/** The shared icon-component contract (mirrors lucide-react icons in ICON_MAP). */
export type BrandIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

/** A brand-icon component compatible with the `ICON_MAP` value type. */
export type BrandIcon = React.ComponentType<BrandIconProps>;

/** Default rendered size in pixels (matches lucide-react's default). */
const DEFAULT_SIZE = 24;

/**
 * Build a filled brand-icon component from one or more SVG path `d` strings.
 *
 * The returned component resolves `size` → width/height and `color` → `fill`,
 * defaulting to `"currentColor"` so the glyph inherits the surrounding color.
 * `strokeWidth` is part of the shared contract but unused for these solid
 * marks. Output is deterministic for stable, byte-comparable markup.
 *
 * @param title  Accessible/debug title (also used as the React displayName).
 * @param paths  One or more SVG path `d` definitions drawn with the fill color.
 */
function createBrandIcon(title: string, paths: string[]): BrandIcon {
  const BrandIconComponent: BrandIcon = ({ size, color }) => {
    const dimension = size ?? DEFAULT_SIZE;
    const fill = color ?? "currentColor";
    return React.createElement(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: dimension,
        height: dimension,
        viewBox: "0 0 24 24",
        fill,
        "aria-hidden": true,
        focusable: false,
      },
      ...paths.map((d, i) => React.createElement("path", { key: i, d })),
    );
  };
  BrandIconComponent.displayName = `${title}Icon`;
  return BrandIconComponent;
}

// ─── Brand icon components ───────────────────────────────────────────────────
// Path data is drawn on a 24×24 viewBox with the resolved fill color.

/** Facebook "f" mark. */
export const Facebook = createBrandIcon("Facebook", [
  "M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z",
]);

/** Instagram camera + lens mark. */
export const Instagram = createBrandIcon("Instagram", [
  "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0z",
  "M12 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8z",
  "M18.406 4.155a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
]);

/** X (formerly Twitter) mark. */
export const X = createBrandIcon("X", [
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
]);

/** LinkedIn "in" mark. */
export const LinkedIn = createBrandIcon("LinkedIn", [
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
]);

/** YouTube play-button mark. */
export const YouTube = createBrandIcon("YouTube", [
  "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
]);

/** TikTok musical-note mark. */
export const TikTok = createBrandIcon("TikTok", [
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
]);

/** WhatsApp speech-bubble + handset mark. */
export const WhatsApp = createBrandIcon("WhatsApp", [
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413",
]);

/**
 * Brand icons keyed by their social `icon` key (matching the SocialLinks
 * select options). Spread into `ICON_MAP` in `config.ts` so a `SocialItem`'s
 * `icon` resolves through the same map as every other block.
 */
export const SOCIAL_ICONS: Record<string, BrandIcon> = {
  facebook: Facebook,
  instagram: Instagram,
  x: X,
  linkedin: LinkedIn,
  youtube: YouTube,
  tiktok: TikTok,
  whatsapp: WhatsApp,
};
