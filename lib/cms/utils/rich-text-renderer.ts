import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";

/**
 * Tiptap extensions matching the editor configuration.
 * Must stay in sync with the TiptapEditor component.
 */
const extensions = [StarterKit, Link, Image];

/**
 * Convert Tiptap JSON content to HTML string for SSR rendering.
 * Uses the same extension set as the editor to ensure formatting fidelity.
 */
export function renderTiptapToHtml(
  content: Record<string, unknown> | null | undefined
): string {
  if (!content) return "";

  try {
    return generateHTML(content as Parameters<typeof generateHTML>[0], extensions);
  } catch {
    return "";
  }
}
