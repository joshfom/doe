// @vitest-environment jsdom
/**
 * Render tests for the PricingTable block (task 9.3).
 *
 * Scope (per the implementation plan, task 9.3):
 *   - Highlight emphasis: the highlighted plan card gains an accent border in
 *     `highlightColor` plus a "Most Popular" badge; non-highlighted plans get a
 *     neutral border and no badge (Req 5.4).
 *   - Feature-list semantics: each plan's `features` textarea is split on
 *     newlines (blank lines dropped) and rendered as a semantic `<ul><li>` list
 *     (Req 5.6).
 *   - CTA anchor: each plan's CTA renders as a semantic `<a>` carrying its own
 *     `href` with an accessible name equal to its visible label — navigation
 *     only, never a payment control. External destinations get the security
 *     `rel`; a plan without a `ctaUrl` omits the CTA entirely (Req 5.5, 5.8).
 *   - RTL: plan cards keep author order in the DOM (visual reversal is CSS-
 *     driven by the auto-flow grid) and align content with the logical
 *     `text-align: start` — never a hard-coded physical left/right — so they
 *     flip correctly under `dir="rtl"` (Req 5.10, 14.3).
 *
 * Conventions mirror `logo-cloud.test.tsx` / `cta.test.tsx` /
 * `testimonial.test.tsx`: jsdom environment, a ResizeObserver polyfill installed
 * before the config module is imported, the block pulled from the registered
 * `pageBuilderConfig.components`, and the element rendered through the shared
 * `renderBlock` util (which supplies `BreakpointProvider` so the
 * `withBreakpointResolution` wrapper's `useBreakpoint()` works).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 5 — PricingTable"
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 14.3
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

const PricingTable = pageBuilderConfig.components.PricingTable;

/** Default accent color shipped by the PricingTable block (ORA cyan). */
const HIGHLIGHT_COLOR = "#01A7C7";

/** A single fully-populated plan used as the test baseline. */
function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Starter",
    price: "$0",
    period: "/mo",
    features: "Feature one\nFeature two\nFeature three",
    highlight: "no",
    ctaLabel: "Get Started",
    ctaUrl: "/contact",
    ...overrides,
  };
}

/** Build PricingTable props from the registered defaults, with overrides applied. */
function pricingProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...(PricingTable.defaultProps as Record<string, unknown>), ...overrides };
}

/** Render the PricingTable block with the given props via the BreakpointProvider helper. */
function renderPricing(overrides: Record<string, unknown> = {}) {
  const element = React.createElement(
    PricingTable.render as React.ComponentType<Record<string, unknown>>,
    pricingProps(overrides),
  );
  return renderBlock(element);
}

/**
 * The plan cards are the flex-column wrappers that each hold a plan's name /
 * price / features / CTA. Every card carries `text-align: start` and a border,
 * and sits directly in the grid container — the most stable handle is the set
 * of elements whose parent is the grid (the element with `display: grid`).
 */
function getCards(container: HTMLElement): HTMLElement[] {
  const grid = container.querySelector(
    '[style*="display: grid"]',
  ) as HTMLElement | null;
  expect(grid).toBeTruthy();
  return Array.from(grid!.children) as HTMLElement[];
}

describe("PricingTable — highlight emphasis (Req 5.4)", () => {
  it("gives the highlighted plan an accent border + 'Most Popular' badge", () => {
    const { container, getByText } = renderPricing({
      highlightColor: HIGHLIGHT_COLOR,
      plans: [plan({ name: "Pro", highlight: "yes" })],
    });

    const card = getCards(container)[0];
    // Accent border in the highlight color (jsdom normalizes hex to rgb()).
    expect(card.style.border).toBe("2px solid rgb(1, 167, 199)");

    // A "Most Popular" badge is present, painted in the highlight color.
    const badge = getByText("Most Popular");
    expect(badge).toBeTruthy();
    expect((badge as HTMLElement).style.backgroundColor).toBe("rgb(1, 167, 199)");
  });

  it("gives a non-highlighted plan a neutral border and no badge", () => {
    const { container, queryByText } = renderPricing({
      plans: [plan({ name: "Starter", highlight: "no" })],
    });

    const card = getCards(container)[0];
    expect(card.style.border).toBe("1px solid rgb(232, 228, 223)");
    expect(queryByText("Most Popular")).toBeNull();
  });

  it("emphasizes only the highlighted card when plans are mixed", () => {
    const { container } = renderPricing({
      highlightColor: HIGHLIGHT_COLOR,
      plans: [
        plan({ name: "Starter", highlight: "no" }),
        plan({ name: "Pro", highlight: "yes" }),
        plan({ name: "Enterprise", highlight: "no" }),
      ],
    });

    const cards = getCards(container);
    expect(cards).toHaveLength(3);
    // Only the middle card carries the accent border.
    expect(cards[0].style.border).toBe("1px solid rgb(232, 228, 223)");
    expect(cards[1].style.border).toBe("2px solid rgb(1, 167, 199)");
    expect(cards[2].style.border).toBe("1px solid rgb(232, 228, 223)");

    // Exactly one "Most Popular" badge across the whole table.
    const badges = Array.from(container.querySelectorAll("div")).filter(
      (el) => el.textContent === "Most Popular",
    );
    expect(badges).toHaveLength(1);
  });

  it("honours a custom highlightColor on both border and badge", () => {
    const { container, getByText } = renderPricing({
      highlightColor: "#FF0000",
      plans: [plan({ name: "Pro", highlight: "yes" })],
    });
    const card = getCards(container)[0];
    expect(card.style.border).toBe("2px solid rgb(255, 0, 0)");
    expect(getByText("Most Popular").style.backgroundColor).toBe("rgb(255, 0, 0)");
  });
});

describe("PricingTable — feature list semantics (Req 5.6)", () => {
  it("renders features split on newlines as a semantic <ul><li> list", () => {
    const { container } = renderPricing({
      plans: [plan({ features: "Feature one\nFeature two\nFeature three" })],
    });

    const list = container.querySelector("ul");
    expect(list).toBeTruthy();
    const items = Array.from(list!.querySelectorAll("li"));
    expect(items.map((li) => li.textContent)).toEqual([
      "Feature one",
      "Feature two",
      "Feature three",
    ]);
  });

  it("drops blank lines and trims whitespace when splitting features", () => {
    const { container } = renderPricing({
      plans: [plan({ features: "  Alpha  \n\n   \nBeta\n" })],
    });
    const items = Array.from(container.querySelectorAll("ul li"));
    expect(items.map((li) => li.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("omits the feature list entirely when no features are provided", () => {
    const { container } = renderPricing({
      plans: [plan({ features: "   \n  \n" })],
    });
    expect(container.querySelector("ul")).toBeNull();
  });

  it("renders one feature list per plan", () => {
    const { container } = renderPricing({
      plans: [
        plan({ name: "Starter", features: "A\nB" }),
        plan({ name: "Pro", features: "C\nD\nE" }),
      ],
    });
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(lists[0].querySelectorAll("li")).toHaveLength(2);
    expect(lists[1].querySelectorAll("li")).toHaveLength(3);
  });
});

describe("PricingTable — CTA anchor (Req 5.5, 5.8)", () => {
  it("renders the plan CTA as a semantic <a> carrying its own href", () => {
    const { getByRole } = renderPricing({
      plans: [plan({ ctaLabel: "Start Free Trial", ctaUrl: "/signup" })],
    });
    const link = getByRole("link", { name: "Start Free Trial" }) as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/signup");
  });

  it("gives the CTA an accessible name equal to its visible label (no aria-label)", () => {
    const { getByRole } = renderPricing({
      plans: [plan({ ctaLabel: "Contact Sales", ctaUrl: "/contact" })],
    });
    const link = getByRole("link", { name: "Contact Sales" });
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.textContent).toBe("Contact Sales");
  });

  it("links each plan to its own destination", () => {
    const { getByRole } = renderPricing({
      plans: [
        plan({ name: "Starter", ctaLabel: "Get Started", ctaUrl: "/start" }),
        plan({ name: "Pro", ctaLabel: "Go Pro", ctaUrl: "/pro" }),
      ],
    });
    expect(
      (getByRole("link", { name: "Get Started" }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/start");
    expect(
      (getByRole("link", { name: "Go Pro" }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/pro");
  });

  it("omits the CTA entirely for a plan without a ctaUrl", () => {
    const { container } = renderPricing({
      plans: [plan({ ctaLabel: "Nope", ctaUrl: "" })],
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("omits the CTA when the url is just the placeholder '#'", () => {
    const { container } = renderPricing({
      plans: [plan({ ctaLabel: "Nope", ctaUrl: "#" })],
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("adds rel=noopener noreferrer for an external CTA destination", () => {
    const { getByRole } = renderPricing({
      plans: [plan({ ctaLabel: "Buy", ctaUrl: "https://store.example.com" })],
    });
    expect(getByRole("link", { name: "Buy" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("omits rel for an internal/relative CTA destination", () => {
    const { getByRole } = renderPricing({
      plans: [plan({ ctaLabel: "Go", ctaUrl: "/pricing" })],
    });
    expect(getByRole("link", { name: "Go" }).getAttribute("rel")).toBeNull();
  });

  it("renders a CTA for some plans and omits it for others within one table", () => {
    const { container, getByRole } = renderPricing({
      plans: [
        plan({ name: "Starter", ctaLabel: "Start", ctaUrl: "/start" }),
        plan({ name: "Custom", ctaLabel: "", ctaUrl: "" }),
      ],
    });
    // Only the first plan produces an anchor.
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(getByRole("link", { name: "Start" })).toBeTruthy();
  });
});

describe("PricingTable — RTL / logical alignment (Req 5.10, 14.3)", () => {
  it("aligns card content with the logical start (never physical left/right)", () => {
    const { container } = renderPricing({ plans: [plan()] });
    const card = getCards(container)[0];
    expect(card.style.textAlign).toBe("start");
    expect(card.style.textAlign).not.toBe("left");
    expect(card.style.textAlign).not.toBe("right");
  });

  it("renders plan cards in author order in the DOM (visual reversal is CSS-driven)", () => {
    const { container } = renderPricing({
      plans: [
        plan({ name: "First" }),
        plan({ name: "Second" }),
        plan({ name: "Third" }),
      ],
    });
    const names = Array.from(container.querySelectorAll("h3")).map(
      (h) => h.textContent,
    );
    expect(names).toEqual(["First", "Second", "Third"]);
  });

  it("preserves author order and carries no physical left/right under dir=rtl", () => {
    // The block itself does not set `dir`; RTL comes from an ancestor (the ar
    // layout). The grid auto-flows in the inline direction, so cards reverse to
    // RTL order under `dir="rtl"` without any physical left/right in the markup.
    const element = React.createElement(
      PricingTable.render as React.ComponentType<Record<string, unknown>>,
      pricingProps({
        columns: "3",
        plans: [
          plan({ name: "الأساسية", ctaUrl: "/a" }),
          plan({ name: "الاحترافية", highlight: "yes", ctaUrl: "/b" }),
          plan({ name: "المؤسسات", ctaUrl: "/c" }),
        ],
      }),
    );
    const { container } = render(
      <div dir="rtl">
        <BreakpointProvider initial="desktop">{element}</BreakpointProvider>
      </div>,
    );

    // Author order is preserved in the DOM; the browser flips it visually.
    const names = Array.from(container.querySelectorAll("h3")).map(
      (h) => h.textContent,
    );
    expect(names).toEqual(["الأساسية", "الاحترافية", "المؤسسات"]);

    // Guard against any hard-coded physical direction leaking into the markup.
    const html = container.innerHTML;
    expect(html).not.toContain("text-align: left");
    expect(html).not.toContain("text-align: right");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-right");
  });
});
