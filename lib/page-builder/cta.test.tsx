// @vitest-environment jsdom
/**
 * Render tests for the CTA block (task 5.3).
 *
 * Scope (per the implementation plan, task 5.3):
 *   - Optional-element omission: an empty eyebrow / subtext / disabled secondary
 *     button produces NO corresponding element (Req 1.4).
 *   - Anchor buttons: buttons render as semantic `<a>` elements with discernible
 *     accessible names equal to their visible labels, and external destinations
 *     get the security `rel` (Req 1.7, 1.8, 1.10).
 *   - AA default text color on an image background: with `textColor: "auto"` and
 *     an image background the foreground resolves to white over the shipped
 *     AA-safe dark fallback (Req 1.11).
 *   - RTL alignment: content/button alignment uses *logical* keywords
 *     (`start`/`end`, `flex-start`/`flex-end`) — never hard-coded `left`/`right`
 *     — so it flips correctly under `dir="rtl"` (Req 1.12, 14.3).
 *
 * Conventions mirror `config.test.ts`: jsdom environment, a ResizeObserver
 * polyfill installed before the config module is imported, the block pulled
 * from the registered `pageBuilderConfig.components`, and the element rendered
 * through the shared `renderBlock` util (which supplies `BreakpointProvider` so
 * the `withBreakpointResolution` wrapper's `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md` §"Block 1 — CTA"
 * Validates: Requirements 1.4, 1.7, 1.8, 1.10, 1.11, 1.12, 14.3
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

const CTA = pageBuilderConfig.components.CTA;

/** Build CTA props from the registered defaults, with overrides applied. */
function ctaProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(CTA.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the CTA block with the given props via the BreakpointProvider helper. */
function renderCTA(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    CTA.render as React.ComponentType<Record<string, unknown>>,
    ctaProps(overrides),
  );
  return renderBlock(element);
}

/**
 * The CTA "band" is the flex-column wrapper that holds the eyebrow / heading /
 * subtext / button row. The heading `<h2>`'s parent is always that band, which
 * is the most stable handle regardless of whether `styledRender` wrapped the
 * output in a styled `<div>` or a fragment.
 */
function getBand(container: HTMLElement): HTMLElement {
  const heading = container.querySelector("h2");
  expect(heading).toBeTruthy();
  return heading!.parentElement as HTMLElement;
}

describe("CTA — optional-element omission (Req 1.4)", () => {
  it("renders eyebrow, subtext, and exactly one button when all are present", () => {
    const { container, getByText } = renderCTA({
      eyebrow: "Limited offer",
      heading: "Ready to move?",
      subtext: "Join thousands who already did.",
      secondaryEnabled: "no",
      primaryText: "Get Started",
      primaryUrl: "/contact",
    });

    // Eyebrow + subtext both present.
    expect(getByText("Limited offer")).toBeTruthy();
    expect(container.querySelector("p")).toBeTruthy(); // subtext <p>
    expect(container.querySelector("p")!.textContent).toBe("Join thousands who already did.");

    // One anchor (primary only).
    expect(container.querySelectorAll("a")).toHaveLength(1);

    // Band has four element children: eyebrow, heading, subtext, button row.
    const band = getBand(container);
    expect(band.children).toHaveLength(4);
  });

  it("omits the eyebrow element entirely when the eyebrow is empty", () => {
    const { container, queryByText } = renderCTA({
      eyebrow: "",
      heading: "Ready to move?",
      subtext: "Some subtext.",
      secondaryEnabled: "no",
    });

    expect(queryByText("Get started")).toBeNull(); // default eyebrow text gone
    // Band has heading + subtext + button row only (no eyebrow node).
    const band = getBand(container);
    expect(band.children).toHaveLength(3);
  });

  it("omits the subtext <p> entirely when subtext is empty", () => {
    const { container } = renderCTA({
      eyebrow: "",
      heading: "Heading only",
      subtext: "",
      secondaryEnabled: "no",
    });

    expect(container.querySelector("p")).toBeNull();
    // Only heading + button row remain.
    const band = getBand(container);
    expect(band.children).toHaveLength(2);
  });

  it("omits whitespace-only optional text (treated as empty)", () => {
    const { container, queryByText } = renderCTA({
      eyebrow: "   ",
      heading: "Trimmed",
      subtext: "  \n  ",
      secondaryEnabled: "no",
    });

    expect(queryByText("Get started")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    const band = getBand(container);
    expect(band.children).toHaveLength(2); // heading + button row
  });

  it("omits the secondary button when secondaryEnabled is off", () => {
    const { container } = renderCTA({
      secondaryEnabled: "no",
      primaryUrl: "/contact",
      secondaryUrl: "/learn",
    });
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("renders both buttons when the secondary is enabled with a real url", () => {
    const { container, getByRole } = renderCTA({
      secondaryEnabled: "yes",
      primaryText: "Get Started",
      primaryUrl: "/contact",
      secondaryText: "Learn more",
      secondaryUrl: "/learn",
    });
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(getByRole("link", { name: "Get Started" })).toBeTruthy();
    expect(getByRole("link", { name: "Learn more" })).toBeTruthy();
  });

  it("still omits an enabled secondary whose url is the placeholder '#'", () => {
    // The shared anchor helper treats "#" as no destination.
    const { container } = renderCTA({
      secondaryEnabled: "yes",
      primaryUrl: "/contact",
      secondaryUrl: "#",
    });
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("CTA — anchor buttons (Req 1.7, 1.8, 1.10)", () => {
  it("renders the primary button as a semantic <a> carrying its href", () => {
    const { getByRole } = renderCTA({ primaryText: "Get Started", primaryUrl: "/contact" });
    const link = getByRole("link", { name: "Get Started" }) as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/contact");
  });

  it("gives the anchor an accessible name equal to its visible label (no aria-label)", () => {
    const { getByRole } = renderCTA({ primaryText: "Book a demo", primaryUrl: "/demo" });
    const link = getByRole("link", { name: "Book a demo" });
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.textContent).toBe("Book a demo");
  });

  it("adds rel=noopener noreferrer for an external primary destination", () => {
    const { getByRole } = renderCTA({
      primaryText: "Visit",
      primaryUrl: "https://example.com",
    });
    expect(getByRole("link", { name: "Visit" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("omits rel for an internal/relative primary destination", () => {
    const { getByRole } = renderCTA({ primaryText: "Go", primaryUrl: "/pricing" });
    expect(getByRole("link", { name: "Go" }).getAttribute("rel")).toBeNull();
  });
});

describe("CTA — AA default text color on image background (Req 1.11)", () => {
  it("resolves auto foreground to white over the AA-safe dark fallback", () => {
    const { container } = renderCTA({
      bgMode: "image",
      bgImage: "https://cdn.example.com/banner.jpg",
      textColor: "auto",
      eyebrow: "Eyebrow",
      heading: "Heading",
      subtext: "Subtext",
    });

    const band = getBand(container);
    const heading = band.querySelector("h2") as HTMLElement;

    // White (#FFFFFF) foreground — jsdom normalizes hex to rgb().
    expect(heading.style.color).toBe("rgb(255, 255, 255)");
    // Band paints the shipped AA-safe dark fallback (#1A1A1A) behind the image.
    expect(band.style.backgroundColor).toBe("rgb(26, 26, 26)");
    // The image is applied as a background-image.
    expect(band.style.backgroundImage).toContain("banner.jpg");
  });

  it("keeps white text + dark fallback even when image mode has no image yet", () => {
    const { container } = renderCTA({
      bgMode: "image",
      bgImage: "",
      textColor: "auto",
      heading: "Heading",
    });
    const band = getBand(container);
    expect(band.style.backgroundColor).toBe("rgb(26, 26, 26)");
    expect((band.querySelector("h2") as HTMLElement).style.color).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("applies the resolved white foreground to every text element on an image bg", () => {
    const { container } = renderCTA({
      bgMode: "image",
      bgImage: "https://cdn.example.com/banner.jpg",
      textColor: "auto",
      eyebrow: "Eyebrow",
      heading: "Heading",
      subtext: "Subtext",
    });
    const band = getBand(container);
    const subtext = band.querySelector("p") as HTMLElement;
    expect(subtext.style.color).toBe("rgb(255, 255, 255)");
  });
});

describe("CTA — RTL / logical alignment (Req 1.12, 14.3)", () => {
  it("maps left alignment to logical start (never physical left)", () => {
    const { container } = renderCTA({ contentAlign: "left", heading: "H" });
    const band = getBand(container);
    expect(band.style.textAlign).toBe("start");
    expect(band.style.alignItems).toBe("flex-start");
    expect(band.style.textAlign).not.toBe("left");
  });

  it("maps right alignment to logical end (never physical right)", () => {
    const { container } = renderCTA({ contentAlign: "right", heading: "H" });
    const band = getBand(container);
    expect(band.style.textAlign).toBe("end");
    expect(band.style.alignItems).toBe("flex-end");
    expect(band.style.textAlign).not.toBe("right");
  });

  it("flips the button row's justification with logical cross-alignment", () => {
    const { container } = renderCTA({
      contentAlign: "right",
      heading: "H",
      primaryUrl: "/contact",
    });
    const band = getBand(container);
    // The button row is the band's last child (a flex row).
    const buttonRow = band.lastElementChild as HTMLElement;
    expect(buttonRow.querySelector("a")).toBeTruthy(); // it is the row holding the anchor
    expect(buttonRow.style.justifyContent).toBe("flex-end");
  });

  it("renders logical alignment when mounted inside a dir=rtl container", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). Mounting under dir="rtl" must not introduce any physical
    // left/right — the logical keywords let the browser flip the layout.
    const element = React.createElement(
      CTA.render as React.ComponentType<Record<string, unknown>>,
      ctaProps({ contentAlign: "left", heading: "مرحبا" }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    const band = getBand(container);
    expect(band.style.textAlign).toBe("start");
    expect(band.style.alignItems).toBe("flex-start");
    // Guard against any hard-coded physical direction leaking into the markup.
    const styleAttr = container.innerHTML;
    expect(styleAttr).not.toContain("text-align: left");
    expect(styleAttr).not.toContain("text-align: right");
  });
});
