// @vitest-environment jsdom
/**
 * Render tests for the SocialLinks block (task 12.4).
 *
 * Scope (per the implementation plan, task 12.4):
 *   - Icon lookup: each item's `icon` resolves through `ICON_MAP` (the inline
 *     social brand SVGs merged from `blocks/social-icons.ts`) and renders an
 *     `<svg>`; items whose `icon` has no registered component, or that have no
 *     `href`, are skipped entirely — no empty/broken anchor is emitted
 *     (Req 7.3, 7.5).
 *   - Accessible names: because the brand glyphs are `aria-hidden`, every anchor
 *     carries an explicit `aria-label`. It is the author-provided `label` when
 *     present, otherwise the fallback "Visit our {Name}" (e.g. "Visit our
 *     Instagram") (Req 7.6).
 *   - External rel: external (`http(s)://`) destinations get
 *     `rel="noopener noreferrer"`; internal/relative destinations omit it
 *     (Req 7.7).
 *   - Alignment: `align` left/center/right maps to `justifyContent`
 *     flex-start/center/flex-end on the flex row (Req 7.4).
 *   - RTL: the row flows in the inline direction with no hard-coded physical
 *     left/right, so icons reverse to RTL order under `dir="rtl"` (Req 7.9).
 *
 * Conventions mirror `card.test.tsx` / `pricing-table.test.tsx`: jsdom
 * environment, a ResizeObserver polyfill installed before the config module is
 * imported, the block pulled from the registered `pageBuilderConfig.components`,
 * and the element rendered through the shared `renderBlock` util (which supplies
 * `BreakpointProvider` so the `withBreakpointResolution` wrapper's
 * `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 8 — SocialLinks"
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { renderBlock } from "./test-utils";
import { BreakpointProvider } from "./breakpoint-context";

// Polyfill ResizeObserver for jsdom — must be set before importing config.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation.
const { pageBuilderConfig } = await import("./config");

const SocialLinks = pageBuilderConfig.components.SocialLinks;

/** A single social item with sensible defaults, overridable per test. */
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { icon: "facebook", href: "https://facebook.com/ora", label: "", ...overrides };
}

/** Build SocialLinks props from the registered defaults, with overrides applied. */
function socialProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(SocialLinks.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the SocialLinks block with the given props via the BreakpointProvider helper. */
function renderSocial(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    SocialLinks.render as React.ComponentType<Record<string, unknown>>,
    socialProps(overrides),
  );
  return renderBlock(element);
}

/** The flex row that holds the anchors (the element with `display: flex`). */
function getRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector('[style*="display: flex"]') as HTMLElement | null;
  expect(row).toBeTruthy();
  return row!;
}

describe("SocialLinks — icon lookup (Req 7.3, 7.5)", () => {
  it("resolves each item's icon via ICON_MAP and renders an <svg> inside its anchor", () => {
    const { getByRole } = renderSocial({
      items: [
        item({ icon: "facebook", href: "https://facebook.com/ora", label: "Facebook" }),
        item({ icon: "instagram", href: "https://instagram.com/ora", label: "Instagram" }),
      ],
    });
    const fb = getByRole("link", { name: "Facebook" });
    const ig = getByRole("link", { name: "Instagram" });
    expect(fb.querySelector("svg")).toBeTruthy();
    expect(ig.querySelector("svg")).toBeTruthy();
  });

  it("renders the icon at the configured size and color", () => {
    const { getByRole } = renderSocial({
      iconSize: 40,
      iconColor: "#01A7C7",
      items: [item({ icon: "x", href: "https://x.com/ora", label: "X" })],
    });
    const svg = getByRole("link", { name: "X" }).querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");
    // jsdom normalizes the hex fill to rgb().
    expect(svg.getAttribute("fill")).toBe("#01A7C7");
  });

  it("skips an item whose icon key has no registered ICON_MAP component", () => {
    const { container, getByRole } = renderSocial({
      items: [
        item({ icon: "facebook", href: "https://facebook.com/ora", label: "Facebook" }),
        item({ icon: "not-a-real-icon", href: "https://example.com", label: "Bogus" }),
      ],
    });
    // Only the resolvable icon produces an anchor.
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(getByRole("link", { name: "Facebook" })).toBeTruthy();
  });

  it("skips an item with no href (empty or whitespace-only)", () => {
    const { container } = renderSocial({
      items: [
        item({ icon: "facebook", href: "" }),
        item({ icon: "instagram", href: "   " }),
      ],
    });
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders only the usable items, skipping the broken ones in a mixed list", () => {
    const { container, getByRole } = renderSocial({
      items: [
        item({ icon: "facebook", href: "https://facebook.com/ora", label: "Facebook" }),
        item({ icon: "instagram", href: "" }), // skipped: no href
        item({ icon: "bogus", href: "https://example.com" }), // skipped: no icon
        item({ icon: "linkedin", href: "https://linkedin.com/ora", label: "LinkedIn" }),
      ],
    });
    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(2);
    expect(getByRole("link", { name: "Facebook" })).toBeTruthy();
    expect(getByRole("link", { name: "LinkedIn" })).toBeTruthy();
  });

  it("renders no anchors when the items array is empty", () => {
    const { container } = renderSocial({ items: [] });
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("SocialLinks — accessible names (Req 7.6)", () => {
  it("uses the author-provided label as the anchor's aria-label", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "facebook", href: "https://facebook.com/ora", label: "Follow ORA on Facebook" })],
    });
    const link = getByRole("link", { name: "Follow ORA on Facebook" });
    expect(link.getAttribute("aria-label")).toBe("Follow ORA on Facebook");
  });

  it("falls back to 'Visit our {Name}' for a known social key when no label is set", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "instagram", href: "https://instagram.com/ora", label: "" })],
    });
    expect(getByRole("link", { name: "Visit our Instagram" })).toBeTruthy();
  });

  it("trims a whitespace-only label and falls back to 'Visit our {Name}'", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "linkedin", href: "https://linkedin.com/ora", label: "   " })],
    });
    expect(getByRole("link", { name: "Visit our LinkedIn" })).toBeTruthy();
  });

  it("gives the anchor a discernible name even though the icon glyph is aria-hidden", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "youtube", href: "https://youtube.com/@ora", label: "" })],
    });
    const link = getByRole("link", { name: "Visit our YouTube" });
    // The brand glyph itself is hidden from the accessibility tree.
    const svg = link.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("SocialLinks — external rel (Req 7.7)", () => {
  it("adds rel=noopener noreferrer for an external (https) destination", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "facebook", href: "https://facebook.com/ora", label: "Facebook" })],
    });
    expect(getByRole("link", { name: "Facebook" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("adds rel for an http (non-secure but external) destination", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "x", href: "http://x.com/ora", label: "X" })],
    });
    expect(getByRole("link", { name: "X" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("omits rel for an internal/relative destination", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "facebook", href: "/contact", label: "Contact" })],
    });
    expect(getByRole("link", { name: "Contact" }).getAttribute("rel")).toBeNull();
  });

  it("omits rel for a mailto destination (not http(s))", () => {
    const { getByRole } = renderSocial({
      items: [item({ icon: "whatsapp", href: "mailto:hi@ora.example", label: "Email" })],
    });
    expect(getByRole("link", { name: "Email" }).getAttribute("rel")).toBeNull();
  });
});

describe("SocialLinks — alignment (Req 7.4)", () => {
  it("maps align=left to justifyContent flex-start", () => {
    const { container } = renderSocial({
      align: "left",
      items: [item({ label: "Facebook" })],
    });
    expect(getRow(container).style.justifyContent).toBe("flex-start");
  });

  it("maps align=center to justifyContent center", () => {
    const { container } = renderSocial({
      align: "center",
      items: [item({ label: "Facebook" })],
    });
    expect(getRow(container).style.justifyContent).toBe("center");
  });

  it("maps align=right to justifyContent flex-end", () => {
    const { container } = renderSocial({
      align: "right",
      items: [item({ label: "Facebook" })],
    });
    expect(getRow(container).style.justifyContent).toBe("flex-end");
  });
});

describe("SocialLinks — RTL / logical direction (Req 7.9)", () => {
  it("flows the row in the inline direction with no hard-coded physical left/right", () => {
    const { container } = renderSocial({
      align: "left",
      items: [
        item({ icon: "facebook", href: "https://facebook.com/ora", label: "Facebook" }),
        item({ icon: "instagram", href: "https://instagram.com/ora", label: "Instagram" }),
      ],
    });
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
  });

  it("preserves author order in the DOM under dir=rtl (visual reversal is CSS-driven)", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). The flex row flows in the inline direction, so anchors reverse to
    // RTL order under `dir="rtl"` without any physical left/right in the markup.
    const element = React.createElement(
      SocialLinks.render as React.ComponentType<Record<string, unknown>>,
      socialProps({
        align: "right",
        items: [
          item({ icon: "facebook", href: "https://facebook.com/ora", label: "فيسبوك" }),
          item({ icon: "instagram", href: "https://instagram.com/ora", label: "انستغرام" }),
          item({ icon: "x", href: "https://x.com/ora", label: "إكس" }),
        ],
      }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    // Author order is preserved in the DOM; the browser flips it visually.
    const labels = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["فيسبوك", "انستغرام", "إكس"]);

    // Alignment still maps to the logical justifyContent value.
    expect(getRow(container).style.justifyContent).toBe("flex-end");

    // Guard against any hard-coded physical direction leaking into the markup.
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
  });
});
