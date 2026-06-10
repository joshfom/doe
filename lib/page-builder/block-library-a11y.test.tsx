// @vitest-environment jsdom
/**
 * Cross-cutting RTL + accessibility sweep over the new block library (task 17).
 *
 * The ten new marketing blocks each ship their own per-block render test that
 * already exercises block-specific RTL/a11y details. THIS file is the
 * consolidated cross-cutting sweep the design calls for: it asserts the same
 * universal RTL and accessibility invariants once, uniformly, across every new
 * block, so a regression in any one of them is caught here with clear
 * attribution even if a per-block test drifts.
 *
 * Scope (per the implementation plan, task 17):
 *
 *   RTL (Req 14.1, 14.3):
 *     - Rendered markup carries NO hard-coded physical left/right — no
 *       `text-align: left|right`, `margin-left|right`, `padding-left|right`, or
 *       `float: left|right`. Blocks use logical properties (`start`/`end`,
 *       `margin-inline`, `padding-inline`, grid/flex order) so `dir="rtl"`
 *       flips them correctly. Asserted both as examples and as a fast-check
 *       property (LOW iteration count for speed).
 *     - Author / DOM order is preserved under `dir="rtl"` (the browser reverses
 *       the visual order via the inline flow; the DOM order never changes).
 *
 *   A11y (Req 13.1, 13.5, 13.6):
 *     - Every rendered `<img>` carries an `alt` attribute (empty only when
 *       decorative) — Req 13.1.
 *     - Every actionable element (anchor / button / tab) has a discernible
 *       accessible name — Req 13.6.
 *     - Roles are correct for the blocks that declare them.
 *
 *   TabGroup (Req 13.2, 13.3): conforms to the WAI-ARIA tabs pattern —
 *     `tablist`/`tab`/`tabpanel` roles, `aria-selected`, `aria-controls` ↔
 *     `aria-labelledby` associations, and a roving `tabindex` — verified through
 *     the registered block `render` (which delegates to `TabGroupRuntime`). The
 *     deep keyboard-interaction coverage lives in `TabGroupRuntime.test.tsx`
 *     (task 7.4 / Property 7); this sweep confirms the registered block emits a
 *     conformant initial structure.
 *
 *   Countdown (Req 13.4): exposes an `aria-live` region (`role="timer"`,
 *     `aria-live="polite"`) for its dynamic updates.
 *
 * Conventions mirror `card.test.tsx` / `social-links.test.tsx` /
 * `block-library-stability.property.test.ts`: jsdom environment, a
 * ResizeObserver polyfill installed before the config module is imported, each
 * block pulled from the registered `pageBuilderConfig.components`, props seeded
 * from each block's `defaultProps`, and the element rendered through the shared
 * `renderBlock` util (which supplies `BreakpointProvider` so the
 * `withBreakpointResolution` wrapper's `useBreakpoint()` works). fast-check
 * (`fc`) is used for the property portions, with LOW `numRuns` so the suite
 * stays fast.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Cross-cutting: Accessibility", §"Cross-cutting: Localization / RTL",
 *   §"Property 7: Tabs invariant".
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 14.3
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

// ───────────────────────────────────────────────────────────────────────────
// Representative props per block
//
// Each block is exercised with realistic, fully-populated content (images with
// alt text, internal + external links, ordered items, etc.) so the sweep
// touches the actionable elements, images, roles, and ordered markup the
// requirements care about. Slot-host blocks (TabGroup panels, CardGrid children)
// receive their slots "the Columns way" — as functions returning React nodes —
// exactly as a real Puck slot would.
// ───────────────────────────────────────────────────────────────────────────

/** A linked logo (anchor wraps the <img>; its accessible name is the alt). */
const LINKED_LOGO = {
  src: "https://cdn.example.com/acme.svg",
  alt: "Acme",
  href: "https://acme.example.com",
};
/** A plain (unlinked) logo. */
const PLAIN_LOGO = {
  src: "https://cdn.example.com/globex.svg",
  alt: "Globex",
  href: "",
};

/** A fully-populated testimonial item (avatar + rating). */
function testimonialItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    quote: "This product changed the way our team works.",
    author: "Jane Doe",
    role: "CEO, Acme Inc.",
    avatar: "https://cdn.example.com/jane.jpg",
    avatarAlt: "Portrait of Jane Doe",
    rating: "5",
    ...overrides,
  };
}

/** A fully-populated pricing plan with a CTA. */
function pricingPlan(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

/** A Puck slot render function (the Columns way). */
function slotFn(...nodes: React.ReactNode[]): () => React.ReactNode {
  return () => nodes;
}

/**
 * Representative override props for each new block, keyed by registered name.
 * Merged over the block's `defaultProps` at render time.
 */
const BLOCK_PROPS: Record<string, Record<string, unknown>> = {
  CTA: {
    eyebrow: "Limited offer",
    heading: "Ready to move?",
    subtext: "Join thousands who already did.",
    secondaryEnabled: "yes",
    primaryText: "Get Started",
    primaryUrl: "/contact",
    secondaryText: "Learn more",
    secondaryUrl: "https://example.com/learn",
  },

  Testimonial: {
    layout: "grid",
    columns: "3",
    items: [
      testimonialItem({ author: "Jane Doe" }),
      testimonialItem({ author: "John Smith", rating: "4" }),
      testimonialItem({ author: "Aisha Rahman", rating: "0", avatar: "" }),
    ],
  },

  TabGroup: {
    tabCount: 3,
    defaultIndex: 0,
    "tab-0-label": "Overview",
    "tab-1-label": "Features",
    "tab-2-label": "Pricing",
    "tab-0": slotFn(React.createElement("p", { key: 0 }, "Overview panel")),
    "tab-1": slotFn(React.createElement("p", { key: 0 }, "Features panel")),
    "tab-2": slotFn(React.createElement("p", { key: 0 }, "Pricing panel")),
  },

  LogoCloud: {
    columns: "3",
    grayscale: "yes",
    items: [
      { ...LINKED_LOGO, alt: "Acme" },
      { ...PLAIN_LOGO, alt: "Globex" },
      { ...LINKED_LOGO, alt: "Initech", href: "/partners/initech" },
    ],
  },

  PricingTable: {
    columns: "3",
    plans: [
      pricingPlan({ name: "Starter", ctaUrl: "/start" }),
      pricingPlan({ name: "Pro", highlight: "yes", ctaUrl: "https://buy.example.com" }),
      pricingPlan({ name: "Enterprise", ctaLabel: "Contact Sales", ctaUrl: "/contact" }),
    ],
  },

  Card: {
    image: "https://cdn.example.com/card.jpg",
    imageAlt: "A scenic overlook",
    title: "Full card",
    body: "Some descriptive body text.",
    linkEnabled: "yes",
    ctaText: "Read more",
    ctaUrl: "/read",
  },

  CardGrid: {
    columns: "3",
    "card-content": slotFn(
      React.createElement("a", { key: 0, href: "/a", "data-card": "A" }, "Card A"),
      React.createElement("a", { key: 1, href: "/b", "data-card": "B" }, "Card B"),
      React.createElement("a", { key: 2, href: "/c", "data-card": "C" }, "Card C"),
    ),
  },

  SocialLinks: {
    align: "center",
    items: [
      { icon: "facebook", href: "https://facebook.com/ora", label: "Facebook" },
      { icon: "instagram", href: "https://instagram.com/ora", label: "" },
      { icon: "linkedin", href: "/contact", label: "LinkedIn" },
    ],
  },

  Countdown: {
    // A far-future target so the timer is in its counting (live-region) state.
    targetDateTime: "2999-01-01T00:00:00Z",
    timeZone: "UTC",
    expiryMessage: "This offer has ended",
  },

  Breadcrumbs: {
    items: [
      { label: "Home", href: "/" },
      { label: "Blog", href: "/blog" },
      { label: "My Post", href: "" },
    ],
    separator: "/",
  },
};

/** Every new block this sweep covers. */
const NEW_BLOCKS = Object.keys(BLOCK_PROPS);

// Guard: every name above must be a registered component, so the sweep fails
// loudly if a block is renamed/removed rather than silently passing.
const registered = new Set(Object.keys(pageBuilderConfig.components));
for (const name of NEW_BLOCKS) {
  if (!registered.has(name)) {
    throw new Error(`block-library-a11y: "${name}" is not a registered component`);
  }
}

/** Build a block element from its defaults + representative override props. */
function blockElement(name: string): React.ReactElement {
  const config = pageBuilderConfig.components[name];
  const props = {
    ...(config.defaultProps as Record<string, unknown>),
    ...BLOCK_PROPS[name],
    id: `${name}-sweep`,
  };
  return React.createElement(
    config.render as React.ComponentType<Record<string, unknown>>,
    props,
  );
}

/** Render a block inside the BreakpointProvider (LTR). */
function renderLtr(name: string) {
  return renderBlock(blockElement(name));
}

/** Render a block inside a `dir="rtl"` ancestor + BreakpointProvider. */
function renderRtl(name: string) {
  return render(
    <div dir="rtl">
      <BreakpointProvider initial="desktop">{blockElement(name)}</BreakpointProvider>
    </div>,
  );
}

/**
 * The hard-coded physical-direction patterns that must never appear in rendered
 * markup. Each must be expressed with a logical property instead so it flips
 * under `dir="rtl"` (Req 14.3).
 */
const PHYSICAL_DIRECTION_PATTERNS = [
  "text-align: left",
  "text-align: right",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
  "float: left",
  "float: right",
] as const;

/** Assert the given markup carries no hard-coded physical left/right. */
function expectNoPhysicalDirection(html: string) {
  for (const pattern of PHYSICAL_DIRECTION_PATTERNS) {
    expect(html, `markup must not contain "${pattern}"`).not.toContain(pattern);
  }
}

/**
 * Whether an actionable element exposes a discernible accessible name, covering
 * the mechanisms the new blocks actually use:
 *   - an explicit, non-blank `aria-label` (SocialLinks anchors),
 *   - an `aria-labelledby` pointing at a node with text,
 *   - a non-blank `title`,
 *   - non-blank visible text content (CTA / Pricing / Card / Breadcrumb anchors,
 *     TabGroup tab buttons),
 *   - a descendant `<img>`/`<svg>` whose `alt`/`aria-label`/`<title>` names it
 *     (LogoCloud linked logos derive their name from the wrapped logo's alt).
 */
function hasDiscernibleName(el: Element): boolean {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return true;

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const labelText = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join("")
      .trim();
    if (labelText) return true;
  }

  const title = el.getAttribute("title");
  if (title && title.trim()) return true;

  if ((el.textContent ?? "").trim()) return true;

  const img = el.querySelector("img[alt]");
  if (img && (img.getAttribute("alt") ?? "").trim()) return true;

  const namedSvg = el.querySelector("svg[aria-label], svg > title");
  if (namedSvg) return true;

  return false;
}

/** All actionable elements (anchors, buttons, tabs) within a container. */
function actionableElements(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll('a, button, [role="tab"]'),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RTL — no hard-coded physical left/right (Req 14.1, 14.3)
// ═══════════════════════════════════════════════════════════════════════════

describe("RTL sweep — no hard-coded physical left/right (Req 14.1, 14.3)", () => {
  it.each(NEW_BLOCKS)(
    "%s renders only logical directions under dir=rtl",
    (name) => {
      const { container } = renderRtl(name);
      expectNoPhysicalDirection(container.innerHTML);
    },
  );

  it.each(NEW_BLOCKS)(
    "%s also avoids physical left/right in the default LTR render",
    (name) => {
      const { container } = renderLtr(name);
      expectNoPhysicalDirection(container.innerHTML);
    },
  );

  // Property-based portion (LOW iteration count for speed): for any new block,
  // the rendered markup under dir="rtl" contains no physical left/right.
  it("property: no new block emits a physical direction under dir=rtl", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NEW_BLOCKS), (name) => {
        const { container, unmount } = renderRtl(name);
        try {
          expectNoPhysicalDirection(container.innerHTML);
        } finally {
          unmount();
        }
      }),
      { numRuns: 6 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RTL — author / DOM order preserved under dir=rtl (Req 14.1)
// ═══════════════════════════════════════════════════════════════════════════

describe("RTL sweep — author/DOM order preserved under dir=rtl (Req 14.1)", () => {
  it("LogoCloud keeps logo author order in the DOM (visual reversal is CSS-driven)", () => {
    const { container } = renderRtl("LogoCloud");
    const alts = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("alt"),
    );
    expect(alts).toEqual(["Acme", "Globex", "Initech"]);
  });

  it("PricingTable keeps plan author order in the DOM", () => {
    const { container } = renderRtl("PricingTable");
    const names = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(names).toEqual(["Starter", "Pro", "Enterprise"]);
  });

  it("SocialLinks keeps anchor author order in the DOM", () => {
    const { container } = renderRtl("SocialLinks");
    const names = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Facebook", "Visit our Instagram", "LinkedIn"]);
  });

  it("Breadcrumbs keeps crumb author order in the DOM", () => {
    const { container } = renderRtl("Breadcrumbs");
    const labels = Array.from(container.querySelectorAll("ol > li")).map(
      (li) => (li.querySelector("a, [aria-current]") as HTMLElement | null)?.textContent,
    );
    expect(labels).toEqual(["Home", "Blog", "My Post"]);
  });

  it("CardGrid keeps slot child order in the DOM", () => {
    const { container } = renderRtl("CardGrid");
    const cards = Array.from(container.querySelectorAll("[data-card]")).map(
      (c) => c.textContent,
    );
    expect(cards).toEqual(["Card A", "Card B", "Card C"]);
  });

  it("TabGroup keeps tab author order in the DOM", () => {
    const { container } = renderRtl("TabGroup");
    const labels = Array.from(
      container.querySelectorAll('[role="tab"]'),
    ).map((t) => t.textContent);
    expect(labels).toEqual(["Overview", "Features", "Pricing"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A11y — images carry alt text (Req 13.1)
// ═══════════════════════════════════════════════════════════════════════════

describe("A11y sweep — every image carries an alt attribute (Req 13.1)", () => {
  // The blocks that render <img> elements with author-provided content.
  const IMAGE_BLOCKS = ["Testimonial", "LogoCloud", "Card"];

  it.each(IMAGE_BLOCKS)("%s renders every <img> with an alt attribute", (name) => {
    const { container } = renderLtr(name);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    imgs.forEach((img) => {
      // The alt attribute must be present (empty is allowed only for
      // decorative images; here every image is content-bearing).
      expect(img.hasAttribute("alt")).toBe(true);
      expect((img.getAttribute("alt") ?? "").trim().length).toBeGreaterThan(0);
    });
  });

  it("Card image uses the author-provided alt text verbatim", () => {
    const { container } = renderLtr("Card");
    expect(container.querySelector("img")!.getAttribute("alt")).toBe(
      "A scenic overlook",
    );
  });

  it("Testimonial avatar falls back to the author name when alt is blank", () => {
    const element = React.createElement(
      pageBuilderConfig.components.Testimonial.render as React.ComponentType<
        Record<string, unknown>
      >,
      {
        ...(pageBuilderConfig.components.Testimonial.defaultProps as Record<
          string,
          unknown
        >),
        layout: "single",
        items: [
          testimonialItem({
            author: "Maria Lopez",
            avatar: "https://cdn.example.com/maria.jpg",
            avatarAlt: "",
          }),
        ],
      },
    );
    const { container } = renderBlock(element);
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("Maria Lopez");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A11y — actionable elements have discernible names (Req 13.6)
// ═══════════════════════════════════════════════════════════════════════════

describe("A11y sweep — actionable elements have discernible names (Req 13.6)", () => {
  it.each(NEW_BLOCKS)(
    "%s gives every anchor/button/tab a discernible accessible name",
    (name) => {
      const { container } = renderLtr(name);
      const actionable = actionableElements(container);
      actionable.forEach((el) => {
        expect(
          hasDiscernibleName(el),
          `${name}: ${el.tagName.toLowerCase()}${
            el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""
          } has no discernible accessible name`,
        ).toBe(true);
      });
    },
  );

  it("CTA exposes both buttons as named anchors", () => {
    const { getByRole } = renderLtr("CTA");
    expect(getByRole("link", { name: "Get Started" })).toBeTruthy();
    expect(getByRole("link", { name: "Learn more" })).toBeTruthy();
  });

  it("LogoCloud linked logos derive their name from the wrapped logo alt", () => {
    const { container } = renderLtr("LogoCloud");
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.length).toBeGreaterThan(0);
    anchors.forEach((a) => {
      // No anchor text; the accessible name comes from the nested <img alt>.
      expect((a.textContent ?? "").trim()).toBe("");
      expect(hasDiscernibleName(a)).toBe(true);
    });
  });

  it("SocialLinks anchors are named while their brand glyph is aria-hidden", () => {
    const { container } = renderLtr("SocialLinks");
    Array.from(container.querySelectorAll("a")).forEach((a) => {
      expect((a.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(0);
      const svg = a.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A11y — roles are correct (Req 13.3, 13.4, 13.6)
// ═══════════════════════════════════════════════════════════════════════════

describe("A11y sweep — roles are correct", () => {
  it("Testimonial exposes its star rating via role=img with a text label", () => {
    const { container } = renderLtr("Testimonial");
    const ratings = Array.from(container.querySelectorAll('[role="img"]'));
    expect(ratings.length).toBeGreaterThan(0);
    ratings.forEach((r) => {
      expect(r.getAttribute("aria-label")).toMatch(/^Rated \d out of 5$/);
    });
  });

  it("Breadcrumbs marks the current page with aria-current=page exactly once", () => {
    const { container } = renderLtr("Breadcrumbs");
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Breadcrumb");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("PricingTable renders each plan's features as a semantic list", () => {
    const { container } = renderLtr("PricingTable");
    const lists = container.querySelectorAll("ul");
    expect(lists.length).toBe(3);
    lists.forEach((ul) => expect(ul.querySelectorAll("li").length).toBeGreaterThan(0));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TabGroup — WAI-ARIA tabs pattern conformance (Req 13.2, 13.3, Property 7)
// ═══════════════════════════════════════════════════════════════════════════

describe("TabGroup — WAI-ARIA tabs pattern conformance (Req 13.2, 13.3)", () => {
  it("emits a tablist of tabs wired to one tabpanel each through the registered block render", () => {
    const { container } = renderLtr("TabGroup");

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));
    expect(tabs).toHaveLength(3);
    expect(panels).toHaveLength(3);

    // Every tab is wired to a panel that points back at it (both directions).
    tabs.forEach((tab) => {
      const controlled = tab.getAttribute("aria-controls");
      expect(controlled).toBeTruthy();
      const panel = container.ownerDocument.getElementById(controlled!);
      expect(panel).toBeTruthy();
      expect(panel!.getAttribute("role")).toBe("tabpanel");
      expect(panel!.getAttribute("aria-labelledby")).toBe(tab.id);
    });
  });

  it("satisfies the Tabs invariant (Property 7): exactly one selected tab in the tab order, one visible panel", () => {
    const { container } = renderLtr("TabGroup");

    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    const panels = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
    );

    // Exactly one selected tab.
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);

    // Roving tabindex: the selected tab is the only one in the tab order.
    const roving = tabs.filter((t) => t.getAttribute("tabindex") === "0");
    expect(roving).toHaveLength(1);
    expect(roving[0]).toBe(selected[0]);
    tabs
      .filter((t) => t !== selected[0])
      .forEach((t) => expect(t.getAttribute("tabindex")).toBe("-1"));

    // Exactly one visible panel, wired to the selected tab.
    const visible = panels.filter((p) => !p.hasAttribute("hidden"));
    expect(visible).toHaveLength(1);
    expect(visible[0].getAttribute("aria-labelledby")).toBe(selected[0].id);
    expect(selected[0].getAttribute("aria-controls")).toBe(visible[0].id);

    // The default tab (index 0) is the one selected on first render.
    expect(tabs.indexOf(selected[0])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Countdown — live region for dynamic updates (Req 13.4)
// ═══════════════════════════════════════════════════════════════════════════

describe("Countdown — exposes an aria-live region (Req 13.4)", () => {
  it("renders the live remaining time inside a polite role=timer live region", () => {
    const { container } = renderLtr("Countdown");
    const region = container.querySelector('[role="timer"]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the aria-live region in the expiry state too", () => {
    const element = React.createElement(
      pageBuilderConfig.components.Countdown.render as React.ComponentType<
        Record<string, unknown>
      >,
      {
        ...(pageBuilderConfig.components.Countdown.defaultProps as Record<
          string,
          unknown
        >),
        targetDateTime: "not-a-real-date",
        timeZone: "UTC",
        expiryMessage: "This offer has ended",
        id: "Countdown-expired",
      },
    );
    const { container } = renderBlock(element);
    const region = container.querySelector('[role="timer"]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute("aria-live")).toBe("polite");
    expect(region!.textContent).toContain("This offer has ended");
  });
});
