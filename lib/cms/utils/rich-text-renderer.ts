import { generateHTML } from "@tiptap/html";
import { ssrExtensions } from "@/lib/page-builder/richtext/tiptap-extensions";

/**
 * Convert Tiptap JSON content to HTML string for SSR rendering.
 * Uses the shared `ssrExtensions` set so the SSR renderer stays in sync
 * with the editor configuration against a single unified `@tiptap/core`.
 */
export function renderTiptapToHtml(
  content: Record<string, unknown> | null | undefined
): string {
  if (!content) return "";

  try {
    return generateHTML(content as Parameters<typeof generateHTML>[0], ssrExtensions);
  } catch {
    return "";
  }
}
