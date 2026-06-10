// @vitest-environment jsdom
/**
 * Render + property tests for the Breadcrumbs block (task 14.4).
 *
 * Scope (per the implementation plan, task 14.4):
 *   - nav/ol semantics: the trail renders as a `<nav aria-label="Breadcrumb">`
 *     containing a single `<ol>` with exactly one `<li>` per item, in the
 *     author-defined order (Req 9.3, 9.4).
 *   - aria-current: items with an `href` render as `<a>` carrying that href; the
 *     hrefless "current page" item renders as plain text marked
 *     `aria-current="page"` (Req 9.5). The visual separators between items are
 *     `aria-hidden="true"` and appear between — never after the last — crumb
 *     (Req 9.6).
 *   - JSON-LD fidelity (Property 6, Req 9.9): the emitted
 *     `<script type="application/ld+json">` parses to a `BreadcrumbList` whose
 *     `itemListElement` has one `ListItem` per source item, in order, with
 *     `position` 1..n, and an `item` URL present iff the source item has an
 *     `href`. The serialized output is valid JSON and deterministic
 *     (byte-identical across renders). This is asserted both by example and by a
 *     fast-check property over generated breadcrumb item arrays.
 *   - RTL: the `<ol>` flows in the inline direction with no hard-coded physical
 *     left/right, so it reverses to RTL order under `dir="rtl"` while preserving
 *     author order in the DOM (Req 9.7).
 *
 * Conventions mirror `card.test.tsx` / `social-links.test.tsx`: jsdom
 * environment, a ResizeObserver polyfill installed before the config module is
 * imported, the block pulled from the registered `pageBuilderConfig.components`,
 * the element rendered through the shared `renderBlock` util (which supplies
 * `BreakpointProvider`), and fast-check (`fc`) for the property test as used in
 * `public-html-stability.property.test.ts` / other repo property tests.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 10 — Breadcrumbs" and "Property 6: Breadcrumb JSON-LD fidelity".
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10
 */

import { describe, it, expect } from "vitest";
import React from "react";
import * as fc from "fast-check";
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

const Breadcrumbs = pageBuilderConfig.components.Breadcrumbs;

/** Build Breadcrumbs props from the registered defaults, with overrides applied. */
function breadcrumbProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(Breadcrumbs.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the Breadcrumbs block with the given props via the BreakpointProvider helper. */
function renderBreadcrumbs(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    Breadcrumbs.render as React.ComponentType<Record<string, unknown>>,
    breadcrumbProps(overrides),
  );
  return renderBlock(element);
}

/** Parse the single JSON-LD `<script>` body emitted inside the nav. */
function parseJsonLd(container: HTMLElement): Record<string, unknown> {
  const script = container.querySelector(
    'script[type="application/ld+json"]',
  ) as HTMLScriptElement | null;
  expect(script).toBeTruthy();
  // The render escapes `<` to `\u003c`; JSON.parse handles the escape natively.
  return JSON.parse(script!.textContent ?? "");
}

const TRAIL = [
  { label: "Home", href: "/" },
  { label: "Blog", href: "/blog" },
  { label: "My Post", href: "" },
];

describe("Breadcrumbs — nav/ol semantics (Req 9.3, 9.4)", () => {
  it("renders a single <nav aria-label='Breadcrumb'> containing one <ol>", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const navs = container.querySelectorAll("nav");
    expect(navs).toHaveLength(1);
    expect(navs[0].getAttribute("aria-label")).toBe("Breadcrumb");
    expect(navs[0].querySelectorAll("ol")).toHaveLength(1);
  });

  it("renders exactly one <li> per item", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    expect(container.querySelectorAll("ol > li")).toHaveLength(TRAIL.length);
  });

  it("preserves the author-defined item order in the DOM", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const labels = Array.from(container.querySelectorAll("ol > li")).map((li) =>
      // The crumb label is the text of the anchor or current-page span,
      // excluding the aria-hidden separator glyph.
      (li.querySelector("a, [aria-current]") as HTMLElement | null)?.textContent,
    );
    expect(labels).toEqual(["Home", "Blog", "My Post"]);
  });

  it("renders an empty <ol> (no <li>) when the items array is empty", () => {
    const { container } = renderBreadcrumbs({ items: [] });
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});

describe("Breadcrumbs — anchors, aria-current, separators (Req 9.5, 9.6)", () => {
  it("renders items with an href as anchors carrying that href", () => {
    const { getByRole } = renderBreadcrumbs({ items: TRAIL });
    expect((getByRole("link", { name: "Home" }) as HTMLAnchorElement).getAttribute("href")).toBe("/");
    expect((getByRole("link", { name: "Blog" }) as HTMLAnchorElement).getAttribute("href")).toBe("/blog");
  });

  it("renders the hrefless current item as plain text with aria-current='page'", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const current = container.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current).toBeTruthy();
    expect(current.tagName).toBe("SPAN");
    expect(current.textContent).toBe("My Post");
    // The current item is NOT an anchor.
    expect(current.closest("a")).toBeNull();
  });

  it("marks exactly one item aria-current='page' for a typical trail", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("treats a whitespace-only href as the current page (no anchor)", () => {
    const { container } = renderBreadcrumbs({
      items: [
        { label: "Home", href: "/" },
        { label: "Here", href: "   " },
      ],
    });
    expect(container.querySelectorAll("a")).toHaveLength(1);
    const current = container.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.textContent).toBe("Here");
  });

  it("hides separators from assistive technology and places them between items only", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL, separator: "/" });
    const seps = container.querySelectorAll('[aria-hidden="true"]');
    // One separator between each pair of items: n items => n-1 separators.
    expect(seps).toHaveLength(TRAIL.length - 1);
    seps.forEach((s) => expect(s.textContent).toBe("/"));
    // No separator trails the final crumb.
    const lastLi = container.querySelector("ol > li:last-child")!;
    expect(lastLi.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("renders the chosen separator glyph", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL, separator: "›" });
    const seps = container.querySelectorAll('[aria-hidden="true"]');
    seps.forEach((s) => expect(s.textContent).toBe("›"));
  });

  it("emits no separator for a single-item trail", () => {
    const { container } = renderBreadcrumbs({ items: [{ label: "Only", href: "" }] });
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });
});

describe("Breadcrumbs — JSON-LD fidelity by example (Req 9.9)", () => {
  it("emits one BreadcrumbList script inside the nav", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const scripts = container.querySelectorAll(
      'nav script[type="application/ld+json"]',
    );
    expect(scripts).toHaveLength(1);
    const data = parseJsonLd(container);
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("BreadcrumbList");
  });

  it("maps each item to a ListItem in order with position 1..n", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const data = parseJsonLd(container);
    const list = data.itemListElement as Array<Record<string, unknown>>;
    expect(list).toHaveLength(TRAIL.length);
    list.forEach((li, i) => {
      expect(li["@type"]).toBe("ListItem");
      expect(li.position).toBe(i + 1);
      expect(li.name).toBe(TRAIL[i].label);
    });
  });

  it("includes the item URL only for items with an href", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const list = parseJsonLd(container).itemListElement as Array<Record<string, unknown>>;
    expect(list[0].item).toBe("/");
    expect(list[1].item).toBe("/blog");
    // The hrefless current page is position-only (no `item` key).
    expect("item" in list[2]).toBe(false);
  });

  it("JSON-escapes labels so an injected </script> cannot break out", () => {
    const { container } = renderBreadcrumbs({
      items: [{ label: "</script><img src=x onerror=alert(1)>", href: "/" }],
    });
    // No stray <img> was parsed out of the script payload.
    expect(container.querySelector("img")).toBeNull();
    // The label survives intact once parsed back from JSON.
    const list = parseJsonLd(container).itemListElement as Array<Record<string, unknown>>;
    expect(list[0].name).toBe("</script><img src=x onerror=alert(1)>");
  });
});

describe("Breadcrumbs — RTL / logical direction (Req 9.7)", () => {
  it("flows the list inline with no hard-coded physical left/right", () => {
    const { container } = renderBreadcrumbs({ items: TRAIL });
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
    expect(html).not.toContain("float: left");
    expect(html).not.toContain("float: right");
  });

  it("preserves author order in the DOM under dir=rtl (visual reversal is CSS-driven)", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). The <ol> flows in the inline direction, so crumbs reverse to RTL
    // order visually without any physical left/right in the markup.
    const arTrail = [
      { label: "الرئيسية", href: "/ar" },
      { label: "المدونة", href: "/ar/blog" },
      { label: "مقالتي", href: "" },
    ];
    const element = React.createElement(
      Breadcrumbs.render as React.ComponentType<Record<string, unknown>>,
      breadcrumbProps({ items: arTrail }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    const labels = Array.from(container.querySelectorAll("ol > li")).map(
      (li) => (li.querySelector("a, [aria-current]") as HTMLElement | null)?.textContent,
    );
    expect(labels).toEqual(["الرئيسية", "المدونة", "مقالتي"]);

    const current = container.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.textContent).toBe("مقالتي");

    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Property 6: Breadcrumb JSON-LD fidelity (fast-check)
//
// For any generated array of breadcrumb items, the emitted BreadcrumbList has
// one ListItem per item, in order, with position 1..n and `item` present iff
// the source item has a non-empty href; the serialized output is valid JSON and
// deterministic (byte-identical across two renders of the same props).
//
// **Validates: Requirements 9.9**
// ───────────────────────────────────────────────────────────────────────────

/** Generate one breadcrumb item: always a label, sometimes an href. */
const itemArb: fc.Arbitrary<{ label: string; href: string }> = fc.record({
  label: fc.string({ minLength: 0, maxLength: 24 }),
  // Mix of: empty (current page), whitespace-only (also current page), and real
  // internal/external URLs — exercising the "item present iff non-empty href"
  // rule across all branches.
  href: fc.oneof(
    fc.constant(""),
    fc.constant("   "),
    fc.webUrl(),
    fc.constantFrom("/", "/blog", "/a/b/c", "/ar/blog"),
  ),
});

const itemsArb = fc.array(itemArb, { minLength: 0, maxLength: 8 });

/** Render the breadcrumbs and return the parsed JSON-LD + the raw script text. */
function renderAndParse(items: Array<{ label: string; href: string }>): {
  data: Record<string, unknown>;
  raw: string;
} {
  const { container, unmount } = renderBreadcrumbs({ items });
  const script = container.querySelector(
    'script[type="application/ld+json"]',
  ) as HTMLScriptElement;
  const raw = script.textContent ?? "";
  const data = JSON.parse(raw) as Record<string, unknown>;
  unmount();
  return { data, raw };
}

describe("Breadcrumbs — Property 6: JSON-LD fidelity", () => {
  it("emits one ListItem per item, in order, position 1..n, item iff href (Req 9.9)", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const { data } = renderAndParse(items);

        expect(data["@context"]).toBe("https://schema.org");
        expect(data["@type"]).toBe("BreadcrumbList");

        const list = data.itemListElement as Array<Record<string, unknown>>;
        expect(list).toHaveLength(items.length);

        list.forEach((li, i) => {
          expect(li["@type"]).toBe("ListItem");
          // Position is 1-based and in author order.
          expect(li.position).toBe(i + 1);
          // Name reflects the source label exactly.
          expect(li.name).toBe(items[i].label);

          // `item` URL present iff the source href is non-empty after trimming.
          const hasHref = items[i].href.trim().length > 0;
          expect("item" in li).toBe(hasHref);
          if (hasHref) {
            expect(li.item).toBe(items[i].href.trim());
          }
        });
      }),
      { numRuns: 8 },
    );
  });

  it("produces valid, deterministic JSON across repeated renders (Req 9.9, 9.10)", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const first = renderAndParse(items);
        const second = renderAndParse(items);
        // Byte-identical serialized JSON-LD across two independent renders.
        expect(first.raw).toBe(second.raw);
        // And it round-trips to an equal object (valid JSON).
        expect(first.data).toEqual(second.data);
      }),
      { numRuns: 8 },
    );
  });
});
