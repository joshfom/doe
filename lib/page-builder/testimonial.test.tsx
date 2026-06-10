// @vitest-environment jsdom
/**
 * Render tests for the Testimonial block (task 6.5).
 *
 * Scope (per the implementation plan, task 6.5):
 *   - Each layout renders: `single` → exactly one `<blockquote>`; `grid` →
 *     a `gridStyle` grid of `<blockquote>` cards; `slider` → the
 *     `TestimonialRuntime` carousel shell (Req 2.4, 2.5, 2.6).
 *   - Optional-element omission: an empty role / avatar / rating produces NO
 *     corresponding element, and a rating of "0" renders no stars (Req 2.3).
 *   - Star-rating accessible label: a rating of N exposes
 *     `role="img"` + `aria-label="Rated N out of 5"` (Req 2.7).
 *   - Avatar alt fallback: an avatar with empty alt text falls back to the
 *     author name; an explicit alt is used verbatim (Req 2.8).
 *   - Semantic markup: each quote sits inside a `<blockquote>` with the author
 *     attributed in a `<cite>` within a `<footer>` (Req 2.9).
 *   - RTL: the per-item layout uses *logical* alignment (`text-align: start`)
 *     and never hard-codes physical `left`/`right`, so it flips correctly under
 *     `dir="rtl"` (Req 2.12, 14.3).
 *
 * Conventions mirror `cta.test.tsx` / `config.test.ts`: jsdom environment, a
 * ResizeObserver polyfill installed before the config module is imported, the
 * block pulled from the registered `pageBuilderConfig.components`, and the
 * element rendered through the shared `renderBlock` util (which supplies
 * `BreakpointProvider` so the `withBreakpointResolution` wrapper's
 * `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 2 — Testimonial"
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.12, 14.3
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

const Testimonial = pageBuilderConfig.components.Testimonial;

/** A single fully-populated testimonial item used as the test baseline. */
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quote: "This product changed the way our team works.",
    author: "Jane Doe",
    role: "CEO, Acme Inc.",
    avatar: "",
    avatarAlt: "",
    rating: "5",
    ...overrides,
  };
}

/** Build Testimonial props from the registered defaults, with overrides applied. */
function testimonialProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(Testimonial.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the Testimonial block with the given props via the BreakpointProvider helper. */
function renderTestimonial(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    Testimonial.render as React.ComponentType<Record<string, unknown>>,
    testimonialProps(overrides),
  );
  return renderBlock(element);
}

describe("Testimonial — layouts (Req 2.4, 2.5, 2.6)", () => {
  it("single layout renders exactly one blockquote (the first item)", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [
        item({ author: "Jane Doe" }),
        item({ author: "John Smith" }),
        item({ author: "Aisha Rahman" }),
      ],
    });

    const quotes = container.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    // It is the FIRST item that is rendered.
    expect(quotes[0].querySelector("cite")!.textContent).toBe("Jane Doe");
  });

  it("grid layout renders a CSS grid of blockquote cards (one per item)", () => {
    const { container } = renderTestimonial({
      layout: "grid",
      columns: "3",
      items: [item(), item(), item()],
    });

    // The grid container is the element carrying the resolved grid-template.
    const grid = container.querySelector(
      '[style*="grid-template-columns"]',
    ) as HTMLElement | null;
    expect(grid).toBeTruthy();
    expect(grid!.style.display).toBe("grid");
    expect(grid!.style.gridTemplateColumns).toBe("repeat(3, 1fr)");

    // Each item is a direct blockquote child of the grid.
    expect(grid!.children).toHaveLength(3);
    Array.from(grid!.children).forEach((child) =>
      expect(child.tagName).toBe("BLOCKQUOTE"),
    );
  });

  it("grid layout resolves the desktop column count from the columns field", () => {
    const { container } = renderTestimonial({
      layout: "grid",
      columns: "2",
      items: [item(), item()],
    });
    const grid = container.querySelector(
      '[style*="grid-template-columns"]',
    ) as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, 1fr)");
  });

  it("slider layout renders the TestimonialRuntime carousel shell with each item", () => {
    const { container } = renderTestimonial({
      layout: "slider",
      items: [item(), item(), item()],
    });

    // The runtime exposes a labelled carousel region.
    const carousel = container.querySelector(
      '[aria-roledescription="carousel"]',
    ) as HTMLElement | null;
    expect(carousel).toBeTruthy();
    expect(carousel!.getAttribute("aria-label")).toBe("Testimonials");

    // The shared per-item blockquote markup is carouselled, one per item.
    expect(container.querySelectorAll("blockquote")).toHaveLength(3);
  });
});

describe("Testimonial — semantic blockquote + attribution (Req 2.9)", () => {
  it("renders the quote in a blockquote with the author in a cite inside a footer", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ quote: "Outstanding support.", author: "Jane Doe" })],
    });

    const blockquote = container.querySelector("blockquote")!;
    expect(blockquote.tagName).toBe("BLOCKQUOTE");
    // Quote text lives in a <p> within the blockquote.
    expect(blockquote.querySelector("p")!.textContent).toBe("Outstanding support.");
    // Author is attributed in a <cite> inside the blockquote's <footer>.
    const footer = blockquote.querySelector("footer")!;
    expect(footer).toBeTruthy();
    expect(footer.querySelector("cite")!.textContent).toBe("Jane Doe");
  });
});

describe("Testimonial — optional-element omission (Req 2.3)", () => {
  it("omits the role line when role is empty (author still attributed)", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ author: "Jane Doe", role: "", avatar: "", rating: "0" })],
    });

    const footer = container.querySelector("footer")!;
    const names = footer.querySelector("div")!; // author/role column
    // Only the <cite> remains — no role <span>.
    expect(names.children).toHaveLength(1);
    expect(names.querySelector("cite")!.textContent).toBe("Jane Doe");
    expect(names.querySelector("span")).toBeNull();
  });

  it("omits the avatar <img> when no avatar source is set", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ avatar: "", avatarAlt: "" })],
    });
    expect(container.querySelector("img")).toBeNull();
  });

  it("omits the star rating entirely when the rating is '0'", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ rating: "0" })],
    });
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("omits the quote <p> when the quote is empty", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ quote: "", rating: "0", avatar: "" })],
    });
    expect(container.querySelector("blockquote p")).toBeNull();
  });
});

describe("Testimonial — star-rating accessible label (Req 2.7)", () => {
  it("exposes the rating as 'Rated N out of 5' on a role=img wrapper", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ rating: "4" })],
    });
    const rating = container.querySelector('[role="img"]') as HTMLElement;
    expect(rating).toBeTruthy();
    expect(rating.getAttribute("aria-label")).toBe("Rated 4 out of 5");
  });

  it("renders the rating label for a full 5-star score", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item({ rating: "5" })],
    });
    expect(
      container.querySelector('[role="img"]')!.getAttribute("aria-label"),
    ).toBe("Rated 5 out of 5");
  });
});

describe("Testimonial — avatar alt fallback (Req 2.8)", () => {
  it("falls back to the author name when avatarAlt is empty", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [
        item({
          author: "Jane Doe",
          avatar: "https://cdn.example.com/jane.jpg",
          avatarAlt: "",
        }),
      ],
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("alt")).toBe("Jane Doe");
  });

  it("uses the explicit avatar alt text when provided", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [
        item({
          author: "Jane Doe",
          avatar: "https://cdn.example.com/jane.jpg",
          avatarAlt: "Portrait of Jane Doe smiling",
        }),
      ],
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("Portrait of Jane Doe smiling");
  });
});

describe("Testimonial — RTL / logical alignment (Req 2.12, 14.3)", () => {
  it("aligns the blockquote with the logical start (never physical left/right)", () => {
    const { container } = renderTestimonial({
      layout: "single",
      items: [item()],
    });
    const blockquote = container.querySelector("blockquote") as HTMLElement;
    expect(blockquote.style.textAlign).toBe("start");
    expect(blockquote.style.textAlign).not.toBe("left");
    expect(blockquote.style.textAlign).not.toBe("right");
  });

  it("renders no hard-coded physical left/right when mounted in a dir=rtl container", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). Logical keywords let the browser flip the layout, so the markup
    // must not carry any physical text-align.
    const element = React.createElement(
      Testimonial.render as React.ComponentType<Record<string, unknown>>,
      testimonialProps({
        layout: "grid",
        columns: "3",
        items: [item({ author: "جين دو" }), item(), item()],
      }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    const blockquote = container.querySelector("blockquote") as HTMLElement;
    expect(blockquote.style.textAlign).toBe("start");

    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
  });
});
