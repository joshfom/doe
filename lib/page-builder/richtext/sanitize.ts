/**
 * Isomorphic rich-text HTML sanitizer.
 *
 * Backed by DOMPurify. On the client it uses the browser `window`; on the
 * server (Node) it builds a window via `jsdom` and binds a DOMPurify instance
 * to it. This guarantees sanitization actually runs during SSR (the browser-only
 * predecessor in `config.ts` no-oped on the server, leaking unsanitized HTML into
 * the first paint).
 *
 * The exported name/signature is kept identical to the previous implementation
 * (`sanitizeRichTextHtml(html: string): string`) so existing call sites can be
 * migrated by changing only their import path (task 9).
 *
 * Fail-closed: if the server window/purifier cannot be constructed (e.g. the
 * `jsdom` require fails, the DOMPurify factory throws, or `.sanitize()` itself
 * throws), this module returns an empty string — never the raw input. This is a
 * deliberate reversal of the predecessor's fail-OPEN behavior, which leaked
 * unsanitized HTML on the server. (See design "Error Handling".)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */
import DOMPurify from "dompurify";
import type { Config, DOMPurify as DOMPurifyInstance, WindowLike } from "dompurify";

/**
 * Allow-list of formatting tags produced by the page-builder inline rich-text
 * editor — the only content that flows through this sanitizer.
 *
 * Provenance / scope (verified against call sites in task 8.2):
 *   - `config.ts` Text render            → sanitizeRichTextHtml(rawContent)
 *   - `config.ts` AccordionGroup body    → sanitizeRichTextHtml(value)
 *   - InlineRichtextController.tsx        → sanitizeRichTextHtml(editor.getHTML())
 * All three feed content authored by the inline editor, whose schema is the
 * shared `createEditorExtensions()` set. Each tag below maps to an extension in
 * that set:
 *
 *   p, br                  StarterKit (paragraph, hardBreak)
 *   strong, em, s, code    StarterKit (bold→strong, italic→em, strike→s, code)
 *   pre                    StarterKit (codeBlock→pre, wraps a <code>)
 *   ul, ol, li             StarterKit (bulletList, orderedList, listItem)
 *   h1..h6                 StarterKit (heading levels 1-6)
 *   blockquote             StarterKit (blockquote)
 *   hr                     StarterKit (horizontalRule) — enabled by default, so
 *                          the inline editor can emit <hr>; must be preserved
 *                          (Req 4.4) since this content is sanitized.
 *   u                      Underline
 *   a                      Link
 *   span                   TextStyle / Color (inline color via style attr)
 *   mark                   Highlight (multicolor)
 *
 * NOTE — `img` is intentionally NOT allow-listed. Blog post bodies (the only
 * source of authored <img>) render via `renderTiptapToHtml` → `generateHTML`
 * (rich-text-renderer.ts), which does NOT call this function. The page-builder
 * inline editor has no Image extension, so no <img> ever reaches this sanitizer.
 * Adding it would only widen the attack surface with no formatting to preserve.
 */
const ALLOWED_TAGS = [
  // StarterKit block/inline nodes
  "p",
  "br",
  "strong",
  "em",
  "s",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  // Underline mark
  "u",
  // Link mark
  "a",
  // TextStyle / Color marks (inline <span style="color:…">)
  "span",
  // Highlight mark (<mark>)
  "mark",
];

/**
 * Allow-list of attributes the inline editor emits on the tags above:
 *   - href, target, rel  Link (`<a>`)
 *   - style              TextStyle/Color (color), Highlight, TextAlign
 *                        (text-align on p/headings). DOMPurify still sanitizes
 *                        the CSS inside `style`.
 *   - class              utility classes the editor/renderer may attach
 *   - data-color         Highlight color metadata
 *
 * `src`/`alt` are intentionally absent for the same reason as `img` above — no
 * image content flows through this sanitizer.
 */
const ALLOWED_ATTR = ["href", "target", "rel", "style", "class", "data-color"];

/**
 * Tags that must never survive sanitization (Req 4.1). DOMPurify additionally
 * strips `on*` event-handler attributes and `javascript:` URLs by default
 * (Req 4.2), so they are not enumerated here.
 */
const FORBID_TAGS = ["script", "iframe", "object", "embed"];

/**
 * The single canonical DOMPurify configuration applied on BOTH the server
 * (jsdom) and client (browser) paths. Centralizing it here guarantees the two
 * paths cannot drift apart — the foundation of the server/client output
 * equivalence guarantee (Property 2, Req 4.3/4.5).
 *
 * Exported (alongside `sanitizeWith`) so the equivalence property test can build
 * a server-path purifier and compare its output against the client path WITHOUT
 * duplicating this allow-list (which could silently diverge from runtime). This
 * export is configuration/metadata only and does not change runtime behavior.
 */
export const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_TAGS,
};

/**
 * Applies the canonical {@link SANITIZE_CONFIG} using a caller-supplied DOMPurify
 * instance. This isolates the actual `.sanitize()` call + config from purifier
 * SELECTION (browser vs. jsdom), which is what makes the two paths comparable in
 * a single test environment.
 *
 * Runtime callers go through {@link sanitizeRichTextHtml}, which selects the
 * purifier for the current runtime and delegates here. The equivalence test
 * reuses this with an explicitly-built jsdom purifier to exercise the server
 * path from within the (jsdom) client environment.
 */
export function sanitizeWith(
  purifier: DOMPurifyInstance,
  html: string,
): string {
  // With this config (no RETURN_DOM / RETURN_DOM_FRAGMENT / RETURN_TRUSTED_TYPE)
  // DOMPurify's typed overload returns a plain string.
  return purifier.sanitize(html, SANITIZE_CONFIG);
}

/**
 * Minimal structural typing for the parts of `jsdom` used here. `jsdom` ships no
 * bundled types and `@types/jsdom` is not installed, so this precise shape keeps
 * the lazy server `require` fully typed without resorting to `any`.
 *
 * `window` is declared as DOMPurify's `WindowLike` because jsdom's window is a
 * structural superset of it — exactly the type the DOMPurify factory expects.
 */
interface JsdomModule {
  JSDOM: new (html?: string) => { window: WindowLike };
}

/**
 * Cached server-side purifier. Building a jsdom window is expensive, so we reuse
 * a single instance across calls in the Node runtime.
 */
let serverPurifier: DOMPurifyInstance | null = null;

/**
 * Builds a DOMPurify instance bound to a freshly-constructed jsdom window — the
 * exact server-side purifier used during SSR. Returns `null` if a usable
 * purifier cannot be constructed (failed `require("jsdom")`, factory throw, or
 * an unsupported environment).
 *
 * Exported so the server/client equivalence property test can construct the
 * SERVER path's purifier identically to runtime (rather than re-deriving the
 * jsdom wiring and risking divergence) while running under the jsdom test
 * environment that provides the CLIENT path's `window`.
 */
export function createServerPurifier(): DOMPurifyInstance | null {
  try {
    const { JSDOM } = require("jsdom") as JsdomModule;
    const instance = DOMPurify(new JSDOM("").window);
    return instance.isSupported ? instance : null;
  } catch {
    return null;
  }
}

/**
 * Returns a DOMPurify instance appropriate for the current runtime, or `null`
 * if a usable purifier cannot be constructed.
 *
 * - Browser: the default DOMPurify, already bound to the real `window`.
 * - Server: a DOMPurify instance bound to a lazily-constructed jsdom window. The
 *   `require("jsdom")` is intentionally lazy and guarded behind the server check
 *   so jsdom is never pulled into the client bundle.
 *
 * Construction is wrapped so any failure (a failed `require("jsdom")`, the
 * DOMPurify factory throwing, or an environment where DOMPurify is unsupported)
 * yields `null` rather than propagating — letting the caller fail closed.
 */
function getPurifier(): DOMPurifyInstance | null {
  try {
    if (typeof window !== "undefined") {
      return DOMPurify.isSupported ? DOMPurify : null;
    }

    if (serverPurifier === null) {
      serverPurifier = createServerPurifier();
    }

    return serverPurifier;
  } catch {
    return null;
  }
}

/**
 * Sanitizes rich-text HTML, removing dangerous elements/attributes while
 * preserving allow-listed formatting. Produces identical output on the server
 * (jsdom) and client (browser) for the same input, and is idempotent.
 *
 * Fails closed: if the purifier/window cannot be constructed, or `.sanitize()`
 * itself throws, this returns an empty string instead of the raw input. This
 * preserves the security guarantee (Property 3 in design) — unsanitized HTML
 * must never reach the response, even on an internal failure.
 */
export function sanitizeRichTextHtml(html: string): string {
  try {
    const purifier = getPurifier();
    if (purifier === null) {
      return "";
    }

    return sanitizeWith(purifier, html);
  } catch {
    return "";
  }
}
