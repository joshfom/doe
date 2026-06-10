// @vitest-environment node
/**
 * Server-mode unit tests for the isomorphic rich-text sanitizer.
 *
 * Feature: builder-production-hardening
 *
 * The `// @vitest-environment node` pragma above forces this file to run in the
 * Node environment (no `window`), even though `vitest.config.ts` sets
 * `environment: "jsdom"` globally. This exercises the SERVER branch of
 * `sanitizeRichTextHtml` — the jsdom-backed DOMPurify path used during SSR —
 * which is the security-critical path validated by Requirement 4.5.
 *
 * Covers:
 * - Req 4.1: removes <script>/<iframe>/<object>/<embed> on the server
 * - Req 4.2: strips `on*` event handlers and `javascript:` URLs
 * - Req 4.3: idempotent sanitization
 * - Req 4.4: preserves allow-listed formatting
 * - Design "Error Handling" / Property 3: fail-closed, never returns raw HTML,
 *   never throws on malformed input
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */

import { describe, it, expect } from "vitest";
import { sanitizeRichTextHtml } from "./sanitize";

describe("Feature: builder-production-hardening, sanitizeRichTextHtml (server mode)", () => {
  // Guard: confirm we are actually running the Node/server branch so these
  // tests genuinely cover the SSR path (Req 4.5), not the browser path.
  it("runs in the Node/server environment (no browser window)", () => {
    expect(typeof window).toBe("undefined");
  });

  describe("Req 4.1: removes dangerous elements", () => {
    it("removes <script>, <iframe>, <object>, and <embed> tags", () => {
      const dirty = [
        '<p>hello</p>',
        '<script>alert(1)</script>',
        '<iframe src="https://evil.example"></iframe>',
        '<object data="evil.swf"></object>',
        '<embed src="evil.swf">',
      ].join("");

      const clean = sanitizeRichTextHtml(dirty);

      expect(clean).not.toMatch(/<script/i);
      expect(clean).not.toMatch(/<iframe/i);
      expect(clean).not.toMatch(/<object/i);
      expect(clean).not.toMatch(/<embed/i);
      // Safe content around the dangerous tags survives.
      expect(clean).toContain("hello");
    });

    it("does not leave executable script text after stripping the tag", () => {
      const clean = sanitizeRichTextHtml("<script>alert(1)</script>");
      expect(clean).not.toContain("<script");
    });
  });

  describe("Req 4.2: strips on* handlers and javascript: URLs", () => {
    it("removes on* event-handler attributes", () => {
      const clean = sanitizeRichTextHtml('<p onclick="alert(1)">hi</p>');

      expect(clean).not.toMatch(/onclick/i);
      expect(clean).not.toMatch(/\son\w+\s*=/i);
      expect(clean).toContain("hi");
    });

    it("removes a variety of on* handlers", () => {
      const clean = sanitizeRichTextHtml(
        '<p onmouseover="x()" onload="y()"><span onerror="z()">text</span></p>',
      );

      expect(clean).not.toMatch(/\son\w+\s*=/i);
      expect(clean).toContain("text");
    });

    it("strips javascript: URLs from anchor hrefs", () => {
      const clean = sanitizeRichTextHtml(
        '<a href="javascript:alert(1)">x</a>',
      );

      expect(clean).not.toMatch(/javascript:/i);
      // The text content is preserved even when the href is dropped.
      expect(clean).toContain("x");
    });

    it("preserves safe http(s) hrefs while dropping javascript: ones", () => {
      const clean = sanitizeRichTextHtml(
        '<a href="https://example.com">safe</a>' +
          '<a href="javascript:alert(1)">bad</a>',
      );

      expect(clean).toContain("https://example.com");
      expect(clean).not.toMatch(/javascript:/i);
    });
  });

  describe("Req 4.4: preserves allow-listed formatting", () => {
    it("keeps allow-listed tags and structure", () => {
      const input = [
        "<p>paragraph text</p>",
        "<strong>bold</strong>",
        "<em>italic</em>",
        "<u>underline</u>",
        "<s>strike</s>",
        '<a href="https://example.com">link</a>',
        "<ul><li>item one</li><li>item two</li></ul>",
        "<ol><li>ordered</li></ol>",
        "<h1>h1</h1><h2>h2</h2><h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>",
        "<blockquote>quote</blockquote>",
        "<mark>highlighted</mark>",
        '<span style="color: red">colored</span>',
        "<code>inline code</code>",
        "<pre>block code</pre>",
        "<hr>",
      ].join("");

      const clean = sanitizeRichTextHtml(input);

      // Paragraph text survives.
      expect(clean).toContain("paragraph text");
      // Bold.
      expect(clean).toMatch(/<strong>bold<\/strong>/);
      // Italic.
      expect(clean).toMatch(/<em>italic<\/em>/);
      // Underline.
      expect(clean).toMatch(/<u>underline<\/u>/);
      // Link href preserved.
      expect(clean).toContain('href="https://example.com"');
      expect(clean).toContain("link");
      // List items.
      expect(clean).toContain("item one");
      expect(clean).toContain("item two");
      expect(clean).toMatch(/<li>/);
      // Heading survives.
      expect(clean).toMatch(/<h1>h1<\/h1>/);
      // Span color style survives.
      expect(clean).toMatch(/<span[^>]*style="[^"]*color[^"]*"[^>]*>colored<\/span>/);
      // Highlight mark survives.
      expect(clean).toMatch(/<mark>highlighted<\/mark>/);
    });

    it("preserves a representative blockquote and heading hierarchy", () => {
      const clean = sanitizeRichTextHtml(
        "<h2>Title</h2><blockquote>A quote</blockquote><p>Body</p>",
      );

      expect(clean).toContain("Title");
      expect(clean).toContain("A quote");
      expect(clean).toContain("Body");
      expect(clean).toMatch(/<blockquote>/);
    });
  });

  describe("Req 4.3: idempotence", () => {
    it("applying the sanitizer twice equals applying it once (dirty input)", () => {
      const dirty =
        '<p onclick="alert(1)">keep</p>' +
        '<script>alert(2)</script>' +
        '<a href="javascript:evil()">x</a>' +
        '<span style="color: blue">blue</span>' +
        '<iframe src="https://evil.example"></iframe>';

      const once = sanitizeRichTextHtml(dirty);
      const twice = sanitizeRichTextHtml(once);

      expect(twice).toBe(once);
    });

    it("applying the sanitizer twice equals applying it once (clean input)", () => {
      const clean = "<p>just <strong>text</strong></p>";

      const once = sanitizeRichTextHtml(clean);
      const twice = sanitizeRichTextHtml(once);

      expect(twice).toBe(once);
    });
  });

  describe("Fail-closed contract (design Error Handling / Property 3)", () => {
    it("always returns a string and never throws on malformed input", () => {
      const malformedInputs = ["<<>>", "<p><span>unclosed", "</p></div>", "", "   "];

      for (const input of malformedInputs) {
        expect(() => sanitizeRichTextHtml(input)).not.toThrow();
        expect(typeof sanitizeRichTextHtml(input)).toBe("string");
      }
    });

    it("never returns the raw, unsanitized HTML for a script payload", () => {
      const payload = '<script>alert("xss")</script><p>visible</p>';

      const clean = sanitizeRichTextHtml(payload);

      // Output must differ from the dangerous input and contain no script tag.
      expect(clean).not.toBe(payload);
      expect(clean).not.toMatch(/<script/i);
    });

    it("yields safe output for an input that contains only dangerous content", () => {
      const clean = sanitizeRichTextHtml(
        '<script>alert(1)</script><iframe src="x"></iframe>',
      );

      expect(typeof clean).toBe("string");
      expect(clean).not.toMatch(/<script/i);
      expect(clean).not.toMatch(/<iframe/i);
    });
  });
});
