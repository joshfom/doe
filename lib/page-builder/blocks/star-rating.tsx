/**
 * Shared star-rating renderer for the page-builder block library.
 *
 * The Testimonial block lets each item carry an optional 0..5 rating. Rather
 * than inline the star markup inside that block's config render, this module
 * centralises it as `renderStarRating(n)` so the visual + accessible shape lives
 * in one unit-testable place.
 *
 * Output shape: a single `<span role="img" aria-label="Rated N out of 5">`
 * wrapping exactly five lucide `Star` icons — the first `N` filled and the rest
 * empty, where `N` is the clamped integer rating. The wrapper carries the
 * accessible name so the rating is announced as one phrase to assistive
 * technology (Req 2.7, 13.6); the individual icons are `aria-hidden` so a screen
 * reader does not read five separate "star" graphics.
 *
 * Reuse, not reinvention: the `Star` icon is the same lucide-react icon used by
 * `ICON_MAP` in `config.ts` (`star: Star`), so a rendered rating matches the
 * star iconography used elsewhere in the builder. Filled stars use
 * `fill="currentColor"` and empty stars `fill="none"`, so the color flows from
 * the inherited text color (typography helpers) and the markup stays
 * deterministic / byte-stable.
 *
 * This file is `.tsx` to sit alongside the other `blocks/` helpers, but — like
 * `button-fields.ts`'s `renderButtonAnchor` — it builds its output with
 * `React.createElement` rather than JSX so it composes cleanly inside the
 * `config.ts` render path (which is also `React.createElement`-based).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/star-rating.tsx`
 * Validates: Requirements 2.7, 13.6
 */

import React from "react";
import { Star } from "lucide-react";

/** The fixed number of stars a rating renders out of. */
export const MAX_RATING = 5;

/**
 * Clamp an arbitrary rating value to a whole number of filled stars in
 * `0..MAX_RATING`.
 *
 * Rules (per the design's "Out-of-range rating: clamped to 0..5" note):
 *   - `NaN` / non-numeric → `0` (treated as "no rating").
 *   - values `<= 0` (incl. `-Infinity`) → `0`.
 *   - values `>= MAX_RATING` (incl. `+Infinity`) → `MAX_RATING`.
 *   - fractional values in range are floored (`2.9` → `2`, `4.5` → `4`),
 *     matching the flooring the grid helper applies to its column count.
 *
 * @param n Raw rating from item data.
 * @returns An integer in `0..MAX_RATING`.
 */
export function clampRating(n: number): number {
  const num = Number(n);
  if (Number.isNaN(num)) return 0;
  if (num <= 0) return 0;
  if (num >= MAX_RATING) return MAX_RATING;
  return Math.floor(num);
}

/**
 * Render a 0..5 star rating as an accessible image.
 *
 * Produces a `<span role="img" aria-label="Rated N out of 5">` containing five
 * lucide `Star` icons; the first `clampRating(n)` are filled
 * (`fill="currentColor"`) and the remainder empty (`fill="none"`). Every icon is
 * `aria-hidden` so the rating is announced once, via the wrapper's label, using
 * the clamped integer `N`.
 *
 * @param n The raw rating value (clamped on render — see {@link clampRating}).
 * @returns A React element for the rating.
 */
export function renderStarRating(n: number): React.ReactElement {
  const rating = clampRating(n);

  const stars = Array.from({ length: MAX_RATING }, (_, i) =>
    React.createElement(Star, {
      key: i,
      size: 16,
      strokeWidth: 1.5,
      // Filled up to the rating; outline-only beyond it. Color is inherited via
      // currentColor so the rating follows the surrounding text color.
      fill: i < rating ? "currentColor" : "none",
      // The wrapper carries the accessible name; hide the individual graphics.
      "aria-hidden": true,
    }),
  );

  return React.createElement(
    "span",
    {
      role: "img",
      "aria-label": `Rated ${rating} out of ${MAX_RATING}`,
      style: { display: "inline-flex", alignItems: "center", gap: 2 },
    },
    ...stars,
  );
}
