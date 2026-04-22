import type { Locale } from "../types";

/**
 * Resolve the public URL for a page given its locale and slug.
 *
 * Rules:
 * - EN pages serve at `/{slug}` (no locale prefix)
 * - AR pages serve at `/ar/{slug}`
 * - Root slug `/` resolves to `/` for EN and `/ar` for AR
 */
export function resolvePageUrl(locale: Locale, slug: string): string {
  const isHome = slug === "/" || slug === "";

  if (locale === "en") {
    return isHome ? "/" : `/${slug}`;
  }

  // AR locale
  return isHome ? "/ar" : `/ar/${slug}`;
}
