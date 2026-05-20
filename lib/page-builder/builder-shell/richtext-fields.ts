/** Names of Puck fields whose values are HTML richtext. */
export const RICHTEXT_FIELD_NAMES: ReadonlySet<string> = new Set([
  "content", // Text.content
  "body", // Accordion items, IconFeatureList items
  "html", // user-saved library components
]);

/**
 * Returns true if the given field name is a richtext field
 * that should be edited inline on the canvas.
 */
export function isRichtextField(name: string): boolean {
  return RICHTEXT_FIELD_NAMES.has(name);
}
