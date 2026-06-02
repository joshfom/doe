/**
 * Shared Tiptap extension set — the single source of truth for which
 * extensions the inline/blog editors and the SSR renderer use.
 *
 * Spec: builder-production-hardening (Req 3.4, 3.5)
 *
 * Keeping the extension list/config in one module ensures the editor
 * (`InlineRichtextController`, `TiptapEditor`) and the SSR renderer
 * (`rich-text-renderer`) stay in sync against a single, unified
 * `@tiptap/core` install.
 */

import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import type { AnyExtension } from "@tiptap/core";

/**
 * Canonical interactive editor extension list.
 *
 * Returns a fresh array on each call so each Editor instance owns its own
 * configured extension objects (Tiptap extensions are stateful once bound
 * to an editor).
 *
 * Mirrors exactly the list previously built inline by
 * `InlineRichtextController.promoteToEditMode`.
 */
export function createEditorExtensions(): AnyExtension[] {
  return [
    StarterKit,
    Underline,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Link.configure({ openOnClick: false }),
  ];
}

/**
 * SSR / `generateHTML` extension set.
 *
 * Consumed by `rich-text-renderer.ts` to convert stored Tiptap JSON to HTML.
 * It must include every node/mark that could appear in stored content so
 * `generateHTML` neither drops nodes nor errors on unknown schema members:
 *
 * - StarterKit, Link, Image — the blog `TiptapEditor` schema.
 * - Underline, TextStyle, Color, Highlight, TextAlign — the inline-editor
 *   marks (`createEditorExtensions`) so inline-edited content renders faithfully.
 *
 * Mark/node config is kept consistent with the editor where it affects HTML
 * output (Highlight `multicolor`, TextAlign `heading`/`paragraph`, Link config).
 *
 * `generateHTML` is a stateless conversion that does not bind extensions to a
 * live editor, so a module-level const array (rather than a fresh-array factory)
 * is sufficient and shared safely across calls.
 */
export const ssrExtensions: AnyExtension[] = [
  StarterKit,
  Link.configure({ openOnClick: false }),
  Image,
  Underline,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
];
