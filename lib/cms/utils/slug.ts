import slugify from "slugify";

/**
 * Generate a URL-safe slug from a title string.
 * Uses lowercase and strict mode to strip special characters.
 */
export function generateSlug(title: string): string {
  return slugify(title, { lower: true, strict: true });
}

/**
 * Ensure a slug is unique within a set of existing slugs.
 * If baseSlug is already taken, appends -1, -2, etc. until unique.
 */
export function ensureUniqueSlug(
  baseSlug: string,
  existingSlugs: string[]
): string {
  if (!existingSlugs.includes(baseSlug)) return baseSlug;
  let counter = 1;
  while (existingSlugs.includes(`${baseSlug}-${counter}`)) counter++;
  return `${baseSlug}-${counter}`;
}
