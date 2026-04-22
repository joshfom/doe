import type { PageNamespaceGroup } from "../types";

/**
 * Determine the locale completion status for a page namespace group.
 * - green: all locale versions are published
 * - amber: exactly one locale version is published
 * - gray: no locale version is published
 */
export function getLocaleCompletionStatus(
  group: PageNamespaceGroup
): "green" | "amber" | "gray" {
  const enPublished = group.locales.en?.status === "published";
  const arPublished = group.locales.ar?.status === "published";

  if (enPublished && arPublished) return "green";
  if (enPublished || arPublished) return "amber";
  return "gray";
}
