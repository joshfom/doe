// @vitest-environment jsdom
/**
 * Render tests for the LogoCloud block (task 8.3).
 *
 * Scope (per the implementation plan, task 8.3):
 *   - Anchor-vs-plain: a logo item with a non-empty `href` is wrapped in an
 *     `<a>`; an item without an `href` renders in a plain `<div>` with no
 *     anchor (Req 4.4). External absolute hrefs get `rel="noopener noreferrer"`.
 *   - Alt text: each logo `<img>` carries the item's author-provided alt text
 *     (Req 4.6).
 *   - Grayscale class: the grayscale toggle applies the scoped
 *     `ora-logo-cloud--grayscale` container class and emits the scoped grayscale
 *     `<style>`; with the toggle off, neither is present (Req 4.5).
 *   - RTL order: logos render in author order in the DOM (the grid auto-flows in
 *     the inline direction, so the visual order reverses under `dir="rtl"`
 *     without any hard-coded physical left/right), and the layout carries no
 *     physical `left`/`right` that would break RTL (Req 4.9, 14.3).
 *
 * Conventions mirror `cta.test.tsx` / `testimonial.test.tsx` / `config.test.ts`:
 * jsdom environment, a ResizeObserver polyfill installed before the config
 * module is imported, the block pulled from the registered
 * `pageBuilderConfig.components`, and the element rendered through the shared
 * `renderBlock` util (which supplies `BreakpointProvider` so the
 * `withBreakpointResolution` wrapper's `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 4 — LogoCloud"
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10
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

const LogoCloud = pageBuilderConfig.components.LogoCloud;

/** A single logo item with a usable `src` (so it is not skipped on render). */
function logo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    src: "https://cdn.example.com/logo.svg",
    alt: "Acme",
    href: "",
    ...overrides,
  };
}

/** Build LogoCloud props from the registered defaults, with overrides applied. */
function logoCloudProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(LogoCloud.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the LogoCloud block with the given props via the BreakpointProvider helper. */
function renderLogoCloud(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    LogoCloud.render as React.ComponentType<Record<string, unknown>>,
    logoCloudProps(overrides),
  );
  return renderBlock(element);
}

/** The grid container that holds the logo cells. */
function getGrid(container: HTMLElement): HTMLElement {
  const grid = container.querySelector(".ora-logo-cloud") as HTMLElement | null;
  expect(grid).toBeTruthy();
  return grid!;
}

describe("LogoCloud — anchor vs plain (Req 4.4)", () => {
  it("wraps a logo with an href in an anchor carrying that href", () => {
    const { container } = renderLogoCloud({
      items: [logo({ alt: "Acme", href: "/partners/acme" })],
    });

    const anchor = container.querySelector("a") as HTMLAnchorElement | null;
    expect(anchor).toBeTruthy();
    expect(anchor!.getAttribute("href")).toBe("/partners/acme");
    expect(anchor!.classList.contains("ora-logo-cloud__item")).toBe(true);
    // The logo image is nested inside the anchor.
    expect(anchor!.querySelector("img")).toBeTruthy();
  });

  it("renders a logo without an href in a plain div (no anchor)", () => {
    const { container } = renderLogoCloud({
      items: [logo({ alt: "Acme", href: "" })],
    });

    expect(container.querySelector("a")).toBeNull();
    const cell = container.querySelector(".ora-logo-cloud__item") as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.tagName).toBe("DIV");
    expect(cell.querySelector("img")).toBeTruthy();
  });

  it("mixes anchor and plain cells per-item according to each item's href", () => {
    const { container } = renderLogoCloud({
      items: [
        logo({ alt: "Linked", href: "/a" }),
        logo({ alt: "Plain", href: "" }),
        logo({ alt: "AlsoLinked", href: "/b" }),
      ],
    });

    const cells = Array.from(
      container.querySelectorAll(".ora-logo-cloud__item"),
    ) as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells[0].tagName).toBe("A");
    expect(cells[1].tagName).toBe("DIV");
    expect(cells[2].tagName).toBe("A");
    // Only the two linked logos produce anchors.
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("treats a whitespace-only href as no link (plain cell)", () => {
    const { container } = renderLogoCloud({
      items: [logo({ alt: "Acme", href: "   " })],
    });
    expect(container.querySelector("a")).toBeNull();
    expect(
      (container.querySelector(".ora-logo-cloud__item") as HTMLElement).tagName,
    ).toBe("DIV");
  });

  it("adds rel=noopener noreferrer for an external linked logo", () => {
    const { container } = renderLogoCloud({
      items: [logo({ alt: "Acme", href: "https://acme.example.com" })],
    });
    expect(
      (container.querySelector("a") as HTMLAnchorElement).getAttribute("rel"),
    ).toBe("noopener noreferrer");
  });

  it("omits rel for an internal/relative linked logo", () => {
    const { container } = renderLogoCloud({
      items: [logo({ alt: "Acme", href: "/partners/acme" })],
    });
    expect(
      (container.querySelector("a") as HTMLAnchorElement).getAttribute("rel"),
    ).toBeNull();
  });
});

describe("LogoCloud — alt text (Req 4.6)", () => {
  it("renders each logo image with the item's author-provided alt text", () => {
    const { container } = renderLogoCloud({
      items: [
        logo({ alt: "Acme Corporation", href: "" }),
        logo({ alt: "Globex", href: "/globex" }),
      ],
    });

    const imgs = Array.from(
      container.querySelectorAll("img"),
    ) as HTMLImageElement[];
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("alt")).toBe("Acme Corporation");
    expect(imgs[1].getAttribute("alt")).toBe("Globex");
  });

  it("keeps an empty alt attribute when the author leaves alt blank (decorative)", () => {
    const { container } = renderLogoCloud({
      items: [logo({ alt: "", href: "" })],
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("");
  });

  it("skips items without a usable src (no broken <img>)", () => {
    const { container } = renderLogoCloud({
      items: [
        logo({ src: "", alt: "Missing" }),
        logo({ src: "https://cdn.example.com/ok.svg", alt: "Present" }),
      ],
    });
    const imgs = Array.from(
      container.querySelectorAll("img"),
    ) as HTMLImageElement[];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("alt")).toBe("Present");
    // No image ever carries an empty src.
    imgs.forEach((img) => expect(img.getAttribute("src")).not.toBe(""));
  });
});

describe("LogoCloud — grayscale class (Req 4.5)", () => {
  it("applies the grayscale container class and emits the scoped style when enabled", () => {
    const { container } = renderLogoCloud({
      grayscale: "yes",
      items: [logo({ href: "/a" }), logo({ href: "" })],
    });

    const grid = getGrid(container);
    expect(grid.classList.contains("ora-logo-cloud--grayscale")).toBe(true);

    // The scoped grayscale rule set is emitted as a <style> element.
    const style = container.querySelector("style");
    expect(style).toBeTruthy();
    expect(style!.textContent).toContain(".ora-logo-cloud--grayscale");
    expect(style!.textContent).toContain("filter: grayscale(1)");
    // Returns to full color on hover/focus-within (Req 4.5).
    expect(style!.textContent).toContain(":hover img");
    expect(style!.textContent).toContain(":focus-within img");
  });

  it("omits the grayscale class and style when the toggle is off", () => {
    const { container } = renderLogoCloud({
      grayscale: "no",
      items: [logo({ href: "/a" })],
    });

    const grid = getGrid(container);
    expect(grid.classList.contains("ora-logo-cloud--grayscale")).toBe(false);
    expect(grid.classList.contains("ora-logo-cloud")).toBe(true);
    expect(container.querySelector("style")).toBeNull();
  });
});

describe("LogoCloud — responsive grid (Req 4.3)", () => {
  it("resolves the desktop column count into the grid template", () => {
    const { container } = renderLogoCloud({
      columns: "4",
      items: [logo(), logo(), logo(), logo()],
    });
    const grid = getGrid(container);
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, 1fr)");
  });
});

describe("LogoCloud — RTL order (Req 4.9, 14.3)", () => {
  it("renders logos in author order in the DOM (visual reversal is CSS-driven)", () => {
    const { container } = renderLogoCloud({
      items: [
        logo({ alt: "First", href: "" }),
        logo({ alt: "Second", href: "" }),
        logo({ alt: "Third", href: "" }),
      ],
    });
    const alts = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("alt"),
    );
    expect(alts).toEqual(["First", "Second", "Third"]);
  });

  it("carries no hard-coded physical left/right when mounted in a dir=rtl container", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). The grid auto-flows in the inline direction, so it reverses to
    // RTL order under `dir="rtl"` without any physical left/right in the markup.
    const element = React.createElement(
      LogoCloud.render as React.ComponentType<Record<string, unknown>>,
      logoCloudProps({
        columns: "3",
        items: [
          logo({ alt: "شعار ١", href: "/a" }),
          logo({ alt: "شعار ٢", href: "" }),
          logo({ alt: "شعار ٣", href: "/c" }),
        ],
      }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    // Author order is preserved in the DOM; the browser flips it visually.
    const alts = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("alt"),
    );
    expect(alts).toEqual(["شعار ١", "شعار ٢", "شعار ٣"]);

    // Guard against any hard-coded physical direction leaking into the markup.
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
  });
});
