// @vitest-environment jsdom
/**
 * Render tests for the Card block (task 10.3).
 *
 * Scope (per the implementation plan, task 10.3):
 *   - Omission: an empty image, body, or link/button is omitted entirely from
 *     the rendered output — no empty `<img>`, `<p>`, or anchor wrappers are left
 *     behind (Req 6.3).
 *   - Alt text: the image renders with the author-provided alt text (Req 6.4).
 *   - Anchor: the optional CTA renders as a semantic `<a>` carrying the
 *     configured `href` with an accessible name equal to its visible label when
 *     the link toggle is on and a URL is set; it is omitted when the toggle is
 *     off or no URL is provided (Req 6.2, 6.9). External destinations get the
 *     security `rel`.
 *   - Sanitize touchpoint: the Card body is authored as plain text (a
 *     `textarea`) per the design's default, so it renders as text with no
 *     `dangerouslySetInnerHTML` path and therefore no sanitizer call. Req 6.11
 *     is a conditional that only applies IF the body were author HTML — keeping
 *     it plain text avoids that path. These tests verify the body is rendered
 *     verbatim as text (HTML markup is shown literally, never injected).
 *   - RTL / logical alignment: the title renders in an `h3` and card content
 *     aligns with the logical `text-align: start` (never a hard-coded physical
 *     left/right), so it flips correctly under `dir="rtl"` (Req 6.4, 6.12).
 *
 * Conventions mirror `pricing-table.test.tsx` / `logo-cloud.test.tsx`: jsdom
 * environment, a ResizeObserver polyfill installed before the config module is
 * imported, the block pulled from the registered `pageBuilderConfig.components`,
 * and the element rendered through the shared `renderBlock` util (which supplies
 * `BreakpointProvider` so the `withBreakpointResolution` wrapper's
 * `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 6 — Card"
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.9, 6.10, 6.11, 6.12, 6.13
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

const Card = pageBuilderConfig.components.Card;

/** Build Card props from the registered defaults, with overrides applied. */
function cardProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(Card.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the Card block with the given props via the BreakpointProvider helper. */
function renderCard(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    Card.render as React.ComponentType<Record<string, unknown>>,
    cardProps(overrides),
  );
  return renderBlock(element);
}

const IMG_SRC = "https://cdn.example.com/card.jpg";

describe("Card — omission of empty parts (Req 6.3)", () => {
  it("omits the <img> entirely when no image source is set", () => {
    const { container } = renderCard({ image: "", title: "Title", body: "Body" });
    expect(container.querySelector("img")).toBeNull();
  });

  it("treats a whitespace-only image source as no image", () => {
    const { container } = renderCard({ image: "   ", title: "Title" });
    expect(container.querySelector("img")).toBeNull();
  });

  it("omits the body <p> entirely when the body is blank", () => {
    const { container } = renderCard({ body: "", title: "Title" });
    expect(container.querySelector("p")).toBeNull();
  });

  it("treats a whitespace-only body as no body (no empty <p>)", () => {
    const { container } = renderCard({ body: "   \n  ", title: "Title" });
    expect(container.querySelector("p")).toBeNull();
  });

  it("omits the link/button when the link toggle is off", () => {
    const { container } = renderCard({
      linkEnabled: "no",
      ctaText: "Learn more",
      ctaUrl: "/somewhere",
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders only the title when image, body, and link are all empty", () => {
    const { container, getByText } = renderCard({
      image: "",
      body: "",
      linkEnabled: "no",
      title: "Just a title",
    });
    expect(getByText("Just a title")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders all parts when image, body, and an enabled link are provided", () => {
    const { container, getByRole } = renderCard({
      image: IMG_SRC,
      imageAlt: "An image",
      title: "Full card",
      body: "Some body text.",
      linkEnabled: "yes",
      ctaText: "Read more",
      ctaUrl: "/read",
    });
    expect(container.querySelector("img")).toBeTruthy();
    expect(container.querySelector("h3")!.textContent).toBe("Full card");
    expect(container.querySelector("p")!.textContent).toBe("Some body text.");
    expect(getByRole("link", { name: "Read more" })).toBeTruthy();
  });
});

describe("Card — image alt text (Req 6.4)", () => {
  it("renders the image with the author-provided alt text", () => {
    const { container } = renderCard({
      image: IMG_SRC,
      imageAlt: "A scenic overlook",
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(IMG_SRC);
    expect(img.getAttribute("alt")).toBe("A scenic overlook");
  });

  it("keeps an empty alt attribute when the author leaves alt blank (decorative)", () => {
    const { container } = renderCard({ image: IMG_SRC, imageAlt: "" });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("");
  });
});

describe("Card — title heading (Req 6.4)", () => {
  it("renders the title inside an h3 heading element", () => {
    const { container } = renderCard({ title: "Card heading" });
    const h3 = container.querySelector("h3");
    expect(h3).toBeTruthy();
    expect(h3!.textContent).toBe("Card heading");
  });

  it("omits the heading entirely when the title is blank", () => {
    const { container } = renderCard({ title: "  ", body: "Body only" });
    expect(container.querySelector("h3")).toBeNull();
  });
});

describe("Card — CTA anchor (Req 6.2, 6.9)", () => {
  it("renders the CTA as a semantic <a> carrying its href when enabled with a URL", () => {
    const { getByRole } = renderCard({
      linkEnabled: "yes",
      ctaText: "Get started",
      ctaUrl: "/signup",
    });
    const link = getByRole("link", { name: "Get started" }) as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/signup");
  });

  it("gives the CTA an accessible name equal to its visible label (no aria-label)", () => {
    const { getByRole } = renderCard({
      linkEnabled: "yes",
      ctaText: "Contact us",
      ctaUrl: "/contact",
    });
    const link = getByRole("link", { name: "Contact us" });
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.textContent).toBe("Contact us");
  });

  it("omits the CTA when the link is enabled but no URL is set", () => {
    const { container } = renderCard({
      linkEnabled: "yes",
      ctaText: "No link",
      ctaUrl: "",
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("omits the CTA when the url is just the placeholder '#'", () => {
    const { container } = renderCard({
      linkEnabled: "yes",
      ctaText: "Nope",
      ctaUrl: "#",
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("adds rel=noopener noreferrer for an external CTA destination", () => {
    const { getByRole } = renderCard({
      linkEnabled: "yes",
      ctaText: "Visit",
      ctaUrl: "https://example.com",
    });
    expect(getByRole("link", { name: "Visit" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("omits rel for an internal/relative CTA destination", () => {
    const { getByRole } = renderCard({
      linkEnabled: "yes",
      ctaText: "Go",
      ctaUrl: "/internal",
    });
    expect(getByRole("link", { name: "Go" }).getAttribute("rel")).toBeNull();
  });
});

describe("Card — body sanitize touchpoint / plain text (Req 6.11)", () => {
  it("renders the body as plain text verbatim (no HTML injection path)", () => {
    const { container } = renderCard({
      body: "Plain body content.",
      title: "T",
    });
    const p = container.querySelector("p") as HTMLParagraphElement;
    expect(p).toBeTruthy();
    expect(p.textContent).toBe("Plain body content.");
  });

  it("does not interpret HTML markup in the body — it is shown literally as text", () => {
    // The body is authored as plain text, so any markup the author types is
    // displayed as-is, never parsed into elements. This is the no-injection
    // guarantee: there is no dangerouslySetInnerHTML / sanitizer path here.
    const { container } = renderCard({
      body: "<script>alert(1)</script><b>bold</b>",
      title: "T",
    });
    // No element parsed out of the body string.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    // The raw markup survives verbatim as the paragraph's text content.
    const p = container.querySelector("p") as HTMLParagraphElement;
    expect(p.textContent).toBe("<script>alert(1)</script><b>bold</b>");
  });
});

describe("Card — RTL / logical alignment (Req 6.12)", () => {
  it("aligns card content with the logical start (never physical left/right)", () => {
    const { container } = renderCard({
      image: IMG_SRC,
      title: "T",
      body: "B",
    });
    // Every element carrying an explicit text-align uses the logical `start`.
    const aligned = Array.from(
      container.querySelectorAll<HTMLElement>('[style*="text-align"]'),
    );
    expect(aligned.length).toBeGreaterThan(0);
    aligned.forEach((el) => {
      expect(el.style.textAlign).toBe("start");
      expect(el.style.textAlign).not.toBe("left");
      expect(el.style.textAlign).not.toBe("right");
    });
  });

  it("renders title in h3 and carries no physical left/right under dir=rtl", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). Logical column flow + `text-align: start` follow the reading
    // direction without any physical left/right in the markup.
    const element = React.createElement(
      Card.render as React.ComponentType<Record<string, unknown>>,
      cardProps({
        image: IMG_SRC,
        imageAlt: "صورة",
        title: "عنوان البطاقة",
        body: "نص وصفي قصير.",
        linkEnabled: "yes",
        ctaText: "اقرأ المزيد",
        ctaUrl: "/ar/read",
      }),
    );
    const { container, getByRole } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    // Title renders in an h3 with the Arabic content.
    const h3 = container.querySelector("h3");
    expect(h3).toBeTruthy();
    expect(h3!.textContent).toBe("عنوان البطاقة");

    // The CTA is still a semantic anchor to its destination.
    expect(
      (getByRole("link", { name: "اقرأ المزيد" }) as HTMLAnchorElement).getAttribute(
        "href",
      ),
    ).toBe("/ar/read");

    // Guard against any hard-coded physical direction leaking into the markup.
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
  });
});
