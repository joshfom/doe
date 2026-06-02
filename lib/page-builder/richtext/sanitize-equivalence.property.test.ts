/**
 * Property-based test for server/client sanitization equivalence.
 *
 * Feature: builder-production-hardening
 *
 * Covers:
 * - Property 2: Server/client sanitization equivalence — for any HTML string h,
 *   the sanitizer produces the SAME output on the server (jsdom-backed
 *   DOMPurify) and client (browser-window DOMPurify) paths, so SSR markup and
 *   the client's re-render of it match (no hydration mismatch).
 *
 * **Validates: Requirements 4.3, 4.5**
 *
 * ── How both paths are exercised in ONE environment ──────────────────────────
 * `sanitizeRichTextHtml` auto-selects its purifier via `typeof window`, which is
 * fixed per test-file environment — so a single call cannot reveal both paths.
 * This file intentionally has NO `// @vitest-environment` pragma, so it runs in
 * the global jsdom environment (`vitest.config.ts` → `environment: "jsdom"`),
 * meaning a real browser-like `window` exists.
 *
 *   CLIENT output: `sanitizeRichTextHtml(h)` — with the jsdom `window` present,
 *                  the module takes its browser branch (the client path).
 *   SERVER output: `sanitizeWith(createServerPurifier(), h)` — the module's own
 *                  jsdom-window-backed purifier factory (the exact SSR path),
 *                  driven through the same canonical `SANITIZE_CONFIG`.
 *
 * Both paths share `SANITIZE_CONFIG` and `sanitizeWith` from `./sanitize`, so
 * the allow-list cannot drift between what runtime uses and what this test
 * compares. Equivalence here therefore reflects a genuine runtime guarantee.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import {
  sanitizeRichTextHtml,
  sanitizeWith,
  createServerPurifier,
} from "./sanitize";
import type { DOMPurify as DOMPurifyInstance } from "dompurify";

// ── Generators ───────────────────────────────────────────────────────────────
// A compact mirror of the Tiptap-HTML generator used by
// `builder-shell/richtext-roundtrip.property.test.ts`. Duplicated (kept small)
// so the existing idempotence test stays untouched while this file remains
// self-contained.

/** Plain text Tiptap might produce (no HTML special chars → well-formed HTML). */
const plainTextArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,40}$/);

/** A valid hex color string like #ff0000. */
const hexColorArb = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(
    ([r, g, b]) =>
      `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`,
  );

/** Safe URLs for link hrefs. */
const urlArb = fc.constantFrom(
  "https://example.com",
  "https://example.org/page",
  "https://test.io/path/to/resource",
  "https://docs.example.com/api",
  "https://www.example.net",
);

/** Text alignment values Tiptap produces. */
const textAlignArb = fc.constantFrom("left", "center", "right", "justify");

/** Inline marks Tiptap produces, each wrapping text content. */
const inlineMarkArb: fc.Arbitrary<string> = fc.oneof(
  plainTextArb,
  plainTextArb.map((text) => `<strong>${text}</strong>`),
  plainTextArb.map((text) => `<em>${text}</em>`),
  plainTextArb.map((text) => `<u>${text}</u>`),
  fc
    .tuple(plainTextArb, urlArb)
    .map(([text, url]) => `<a href="${url}">${text}</a>`),
  fc
    .tuple(plainTextArb, urlArb)
    .map(
      ([text, url]) =>
        `<a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${text}</a>`,
    ),
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(([text, color]) => `<span style="color: ${color}">${text}</span>`),
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(([text, color]) => `<mark data-color="${color}">${text}</mark>`),
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(
      ([text, color]) =>
        `<mark data-color="${color}" style="background-color: ${color}">${text}</mark>`,
    ),
  plainTextArb.map((text) => `<strong><em>${text}</em></strong>`),
);

/** A paragraph with optional text-align and inline content. */
const paragraphArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.option(textAlignArb, { nil: undefined }),
    fc.array(inlineMarkArb, { minLength: 1, maxLength: 4 }),
  )
  .map(([align, inlines]) => {
    const content = inlines.join(" ");
    return align
      ? `<p style="text-align: ${align}">${content}</p>`
      : `<p>${content}</p>`;
  });

/** Heading levels Tiptap produces. */
const headingLevelArb = fc.constantFrom(1, 2, 3, 4, 5, 6);

/** A heading with optional text-align and inline content. */
const headingArb: fc.Arbitrary<string> = fc
  .tuple(
    headingLevelArb,
    fc.option(textAlignArb, { nil: undefined }),
    fc.array(inlineMarkArb, { minLength: 1, maxLength: 3 }),
  )
  .map(([level, align, inlines]) => {
    const content = inlines.join(" ");
    return align
      ? `<h${level} style="text-align: ${align}">${content}</h${level}>`
      : `<h${level}>${content}</h${level}>`;
  });

/** A full Tiptap `editor.getHTML()`-style fragment (sequence of blocks). */
const tiptapHtmlArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 5, arbitrary: paragraphArb },
      { weight: 2, arbitrary: headingArb },
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((blocks) => blocks.join(""));

/**
 * Dangerous fragments that must be neutralized identically on both paths. Mixing
 * these into the generated input proves equivalence holds for the security-
 * relevant cases too — not just clean formatting.
 */
const dangerousArb = fc.constantFrom(
  "<script>alert(1)</script>",
  '<iframe src="https://evil.example"></iframe>',
  '<object data="evil.swf"></object>',
  '<embed src="evil.swf">',
  '<p onclick="alert(1)">click</p>',
  '<a href="javascript:alert(1)">x</a>',
  "<style>body{display:none}</style>",
  '<img src="x" onerror="alert(1)">',
);

/** Tiptap-style content optionally interleaved with dangerous fragments. */
const mixedHtmlArb: fc.Arbitrary<string> = fc
  .tuple(tiptapHtmlArb, fc.array(dangerousArb, { maxLength: 3 }))
  .map(([safe, dangers]) => safe + dangers.join(""));

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Server/client sanitization equivalence
// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: builder-production-hardening, Property 2: server/client sanitization equivalence", () => {
  let serverPurifier: DOMPurifyInstance;

  beforeAll(() => {
    // Guard: this file must run WITH a browser-like window so `sanitizeRichTextHtml`
    // takes its CLIENT branch. (Global vitest env is jsdom.)
    expect(typeof window).not.toBe("undefined");

    const purifier = createServerPurifier();
    // The server purifier must construct in this Node-backed jsdom test runner;
    // a null here would mean the SSR path itself is unavailable.
    expect(purifier).not.toBeNull();
    serverPurifier = purifier as DOMPurifyInstance;
  });

  it("produces identical output on the server (jsdom) and client (browser) paths for Tiptap content", () => {
    fc.assert(
      fc.property(tiptapHtmlArb, (html) => {
        const clientOutput = sanitizeRichTextHtml(html); // jsdom window → client path
        const serverOutput = sanitizeWith(serverPurifier, html); // SSR path

        expect(serverOutput).toBe(clientOutput);
      }),
      { numRuns: 40 },
    );
  });

  it("produces identical output on both paths even when dangerous fragments are present", () => {
    fc.assert(
      fc.property(mixedHtmlArb, (html) => {
        const clientOutput = sanitizeRichTextHtml(html);
        const serverOutput = sanitizeWith(serverPurifier, html);

        expect(serverOutput).toBe(clientOutput);
      }),
      { numRuns: 40 },
    );
  });
});
