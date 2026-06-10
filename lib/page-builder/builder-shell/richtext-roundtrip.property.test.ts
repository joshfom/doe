/**
 * Property-based test for richtext round-trip sanitation.
 *
 * Feature: builder-canvas-polish-and-inline-richtext
 *
 * Covers:
 * - Property 4: Richtext round-trip sanitation
 *
 * **Validates: Requirements 1.4, 12.2, 13.4**
 *
 * For any HTML string h produced by the Inline Richtext Editor's
 * editor.getHTML(), the value sanitizeRichTextHtml(h) SHALL equal the value
 * of sanitizeRichTextHtml(sanitizeRichTextHtml(h)) — i.e., sanitization is
 * idempotent.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { sanitizeRichTextHtml } from "../config";

// ── Generators ───────────────────────────────────────────────────────────────

/**
 * Generates plain text content that Tiptap might produce.
 * Avoids HTML special characters to keep the generated HTML well-formed.
 */
const plainTextArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,40}$/);

/** Generates a valid hex color string like #ff0000 */
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

/** Generates a safe URL for link hrefs */
const urlArb = fc.constantFrom(
  "https://example.com",
  "https://example.org/page",
  "https://test.io/path/to/resource",
  "https://docs.example.com/api",
  "https://www.example.net",
);

/** Text alignment values Tiptap produces */
const textAlignArb = fc.constantFrom("left", "center", "right", "justify");

/**
 * Generates inline marks that Tiptap produces.
 * Each mark wraps text content.
 */
const inlineMarkArb: fc.Arbitrary<string> = fc.oneof(
  // Plain text
  plainTextArb,
  // Bold: <strong>text</strong>
  plainTextArb.map((text) => `<strong>${text}</strong>`),
  // Italic: <em>text</em>
  plainTextArb.map((text) => `<em>${text}</em>`),
  // Underline: <u>text</u>
  plainTextArb.map((text) => `<u>${text}</u>`),
  // Link: <a href="...">text</a>
  fc
    .tuple(plainTextArb, urlArb)
    .map(([text, url]) => `<a href="${url}">${text}</a>`),
  // Link with target and rel (Tiptap default)
  fc
    .tuple(plainTextArb, urlArb)
    .map(
      ([text, url]) =>
        `<a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${text}</a>`,
    ),
  // Color span: <span style="color: #rrggbb">text</span>
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(([text, color]) => `<span style="color: ${color}">${text}</span>`),
  // Highlight mark: <mark data-color="#rrggbb">text</mark>
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(
      ([text, color]) => `<mark data-color="${color}">${text}</mark>`,
    ),
  // Highlight with style: <mark data-color="#rrggbb" style="background-color: #rrggbb">text</mark>
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(
      ([text, color]) =>
        `<mark data-color="${color}" style="background-color: ${color}">${text}</mark>`,
    ),
  // Nested bold + italic: <strong><em>text</em></strong>
  plainTextArb.map((text) => `<strong><em>${text}</em></strong>`),
  // Nested italic + underline: <em><u>text</u></em>
  plainTextArb.map((text) => `<em><u>${text}</u></em>`),
  // Bold + color: <strong><span style="color: #rrggbb">text</span></strong>
  fc
    .tuple(plainTextArb, hexColorArb)
    .map(
      ([text, color]) =>
        `<strong><span style="color: ${color}">${text}</span></strong>`,
    ),
);

/**
 * Generates a paragraph element with optional text-align style and inline content.
 * This represents the most common Tiptap output structure.
 */
const paragraphArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.option(textAlignArb, { nil: undefined }),
    fc.array(inlineMarkArb, { minLength: 1, maxLength: 4 }),
  )
  .map(([align, inlines]) => {
    const content = inlines.join(" ");
    if (align) {
      return `<p style="text-align: ${align}">${content}</p>`;
    }
    return `<p>${content}</p>`;
  });

/** Heading levels Tiptap produces */
const headingLevelArb = fc.constantFrom(1, 2, 3, 4, 5, 6);

/**
 * Generates a heading element with optional text-align.
 */
const headingArb: fc.Arbitrary<string> = fc
  .tuple(
    headingLevelArb,
    fc.option(textAlignArb, { nil: undefined }),
    fc.array(inlineMarkArb, { minLength: 1, maxLength: 3 }),
  )
  .map(([level, align, inlines]) => {
    const content = inlines.join(" ");
    if (align) {
      return `<h${level} style="text-align: ${align}">${content}</h${level}>`;
    }
    return `<h${level}>${content}</h${level}>`;
  });

/**
 * Generates a complete HTML document fragment that Tiptap's editor.getHTML()
 * would produce. This is a sequence of block-level elements (paragraphs and
 * headings).
 */
const tiptapHtmlArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 5, arbitrary: paragraphArb },
      { weight: 2, arbitrary: headingArb },
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((blocks) => blocks.join(""));

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Richtext round-trip sanitation
// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: builder-canvas-polish-and-inline-richtext, Property 4: Richtext round-trip sanitation", () => {
  it("sanitizeRichTextHtml is idempotent — applying it twice yields the same result as applying it once", () => {
    fc.assert(
      fc.property(tiptapHtmlArb, (html) => {
        const once = sanitizeRichTextHtml(html);
        const twice = sanitizeRichTextHtml(once);

        expect(twice).toBe(once);
      }),
      { numRuns: 25 },
    );
  });
});
