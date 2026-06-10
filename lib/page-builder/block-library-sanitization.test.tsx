// @vitest-environment jsdom
/**
 * Block library sanitization — Property 5.
 *
 * Spec: page-builder-block-library — task 16.2
 * _Validates: Requirements 11.1, 11.2, 11.3, 11.4 (design Property 5)_
 *
 * Property 5 (design.md): "Any code path that renders author HTML routes
 * through `sanitizeRichTextHtml` … verified by … injecting a script payload."
 *
 * This test injects a `<script>` payload (and an `<img onerror>` payload) into
 * every author-content field of every block that renders author-supplied
 * content, renders it through the real public `<PageRenderer>` path, and asserts
 * the payload is neutralized — i.e. no executable `<script>` element and no
 * `onerror`-bearing element is ever parsed into the DOM.
 *
 * Two distinct neutralization mechanisms are covered:
 *
 *   1. PLAIN-TEXT FIELDS (the new block library). By design the new blocks keep
 *      their author-editable text fields PLAIN TEXT (CTA heading/eyebrow/subtext,
 *      Testimonial quote/author, Pricing name/price/features, Card title/body,
 *      Breadcrumb / Social labels, Countdown expiry message, TabGroup labels).
 *      React renders these as text children / attributes, so any markup is
 *      auto-escaped and never becomes a live node. There is therefore NO
 *      `dangerouslySetInnerHTML` author-HTML path to exploit — the
 *      no-injection guarantee holds without a sanitizer call. Breadcrumbs emits
 *      its `BreadcrumbList` as a serialized JSON `<script type="application/ld+json">`
 *      (never author HTML; `<` is escaped to `\u003c`), so a payload in a label
 *      can never break out of that script element.
 *
 *   2. AUTHOR-HTML FIELDS (the existing rich-text blocks `Text` and
 *      `AccordionGroup`). These DO render author HTML via
 *      `dangerouslySetInnerHTML`, and they route it through
 *      `sanitizeRichTextHtml` first (config.ts), which strips `<script>` and
 *      `on*` handlers. This is the genuine Property 5 call-site assertion.
 *
 * Conventions mirror `block-library-stability.property.test.ts` (task 16.1):
 * jsdom env, a ResizeObserver polyfill installed before the config module is
 * imported, fast-check over the block set, and a `QueryClientProvider` safety
 * net around `<PageRenderer>`.
 *
 * Tag: Feature: page-builder-block-library, Property 5: Sanitization
 */
import { describe, it, expect, afterEach } from "vitest";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import React from "react";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderBlock } from "./test-utils";

const { pageBuilderConfig } = await import("./config");
const { PageRenderer } = await import("./components/PageRenderer");
const { sanitizeRichTextHtml } = await import("./richtext/sanitize");

// ─── Payloads ────────────────────────────────────────────────────────────────
// A unique marker (`window.__ORA_XSS__`) lets us assert both that the payload
// reached the render (its escaped text survives) AND that it never executed.
const XSS_MARKER = "__ORA_XSS__";
const SCRIPT_PAYLOAD = `<script>window.${XSS_MARKER}=true</script>`;
const IMG_PAYLOAD = `<img src=x onerror="window.${XSS_MARKER}=true">`;
const MIXED_PAYLOAD = `${SCRIPT_PAYLOAD}<p>visible text</p>${IMG_PAYLOAD}`;

const PAYLOADS = [SCRIPT_PAYLOAD, IMG_PAYLOAD, MIXED_PAYLOAD] as const;

type Props = Record<string, unknown>;
type Injector = (payload: string, defaults: Props) => Props;

/** Helper: build per-item array props from the block's default items. */
function mapItems(
  defaults: Props,
  key: string,
  fn: (item: Props) => Props,
): Props[] {
  const items = (defaults[key] as Props[] | undefined) ?? [];
  return items.map(fn);
}

// ─── New blocks: inject the payload into every author-content field ───────────
// Each injector starts from the block's registered defaultProps and overrides
// the author-editable fields with the payload. All of these fields are PLAIN
// TEXT, so the expected behavior is escaping (no live node), not a sanitizer
// call. CardGrid is intentionally omitted: it is a slot host with NO author
// text of its own; its nested `Card` children are covered by the Card injector.
const NEW_BLOCK_INJECTORS: Record<string, Injector> = {
  CTA: (p, d) => ({
    ...d,
    eyebrow: p,
    heading: p,
    subtext: p,
    secondaryEnabled: "yes",
    primaryText: p,
    primaryUrl: "/contact",
    secondaryText: p,
    secondaryUrl: "/learn-more",
  }),

  Testimonial: (p, d) => ({
    ...d,
    layout: "grid",
    items: mapItems(d, "items", (it) => ({
      ...it,
      quote: p,
      author: p,
      role: p,
      avatarAlt: p,
    })),
  }),

  TabGroup: (p, d) => ({
    ...d,
    "tab-0-label": p,
    "tab-1-label": p,
  }),

  LogoCloud: (p, d) => ({
    ...d,
    // Provide a usable src so the item is not skipped; the payload goes into the
    // alt + href attributes, which React escapes.
    items: [{ src: "/logo.png", alt: p, href: p }],
  }),

  PricingTable: (p, d) => ({
    ...d,
    plans: mapItems(d, "plans", (pl) => ({
      ...pl,
      name: p,
      price: p,
      period: p,
      features: `${p}\n${p}`,
      ctaLabel: p,
      ctaUrl: "/contact",
    })),
  }),

  Card: (p, d) => ({
    ...d,
    title: p,
    body: p,
    imageAlt: p,
    linkEnabled: "yes",
    ctaText: p,
    ctaUrl: "/contact",
  }),

  SocialLinks: (p, d) => ({
    ...d,
    items: [{ icon: "facebook", href: p, label: p }],
  }),

  Countdown: (p, d) => ({
    ...d,
    // An invalid target renders the expiry message deterministically (the
    // payload), so we exercise the author-text path without the live tick.
    targetDateTime: "not-a-real-date",
    expiryMessage: p,
  }),

  Breadcrumbs: (p, d) => ({
    ...d,
    // A linked item (href present → anchor + JSON-LD `item`) and the hrefless
    // current-page item (plain text). Both carry the payload as the label.
    items: [
      { label: p, href: p },
      { label: p, href: "" },
    ],
  }),
};

// ─── Existing rich-text blocks: the genuine author-HTML (sanitizer) path ──────
// These render author HTML via `dangerouslySetInnerHTML` AFTER routing it
// through `sanitizeRichTextHtml` (config.ts). That sanitizer call lives in the
// block `render`'s STRING branch — the server-render / SSR path, where `content`
// / item `body` arrive as raw HTML strings. (Under Puck's interactive `<Render>`
// the richtext field is instead pre-transformed into a read-mode editor element,
// a different non-string branch — so to exercise the actual sanitizer call-site
// we invoke the block's registered `render` directly with string props via
// `renderBlock`, mirroring the SSR path.) Injecting the payload here is the
// Property 5 call-site assertion: the sanitizer must strip the script/handler
// before it is written via `dangerouslySetInnerHTML`.
const HTML_PATH_INJECTORS: Record<string, Injector> = {
  Text: (p, d) => ({ ...d, content: p }),
  AccordionGroup: (p, d) => ({
    ...d,
    items: [{ title: "Title", body: p }],
  }),
};

const ALL_INJECTOR_NAMES = [
  ...Object.keys(NEW_BLOCK_INJECTORS),
  ...Object.keys(HTML_PATH_INJECTORS),
];

// Guard: every targeted block must be a registered component, so this test
// fails loudly if a block is renamed/removed rather than silently passing.
const registered = new Set(Object.keys(pageBuilderConfig.components));
for (const name of ALL_INJECTOR_NAMES) {
  if (!registered.has(name)) {
    throw new Error(
      `block-library-sanitization: "${name}" is not a registered component`,
    );
  }
}

function withProvider(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

/**
 * Render a NEW-library block (seeded from its defaults + injector) through the
 * real public `<PageRenderer>` path.
 */
function renderNewBlock(type: string, payload: string): {
  container: HTMLElement;
  unmount: () => void;
} {
  const defaults =
    (pageBuilderConfig.components[type]?.defaultProps as Props) ?? {};
  const props = { id: `${type}-xss`, ...NEW_BLOCK_INJECTORS[type](payload, defaults) };
  const data = {
    root: { props: { title: "Sanitization" } },
    content: [{ type, props }],
  };
  const r = render(withProvider(React.createElement(PageRenderer, { data })));
  return { container: r.container, unmount: r.unmount };
}

/**
 * Render a rich-text block (`Text` / `AccordionGroup`) by invoking its
 * registered `render` directly with string props — the SSR / string branch
 * where the `sanitizeRichTextHtml` call-site lives. Wrapped in the
 * `BreakpointProvider` via `renderBlock` (the registered render is the
 * `withBreakpointResolution` wrapper, which calls `useBreakpoint()`).
 */
function renderHtmlPathBlock(type: string, payload: string): {
  container: HTMLElement;
  unmount: () => void;
} {
  const config = pageBuilderConfig.components[type];
  const defaults = (config?.defaultProps as Props) ?? {};
  const props = { id: `${type}-xss`, ...HTML_PATH_INJECTORS[type](payload, defaults) };
  const element = React.createElement(
    config.render as React.ComponentType<Props>,
    props,
  );
  const r = renderBlock(element);
  return { container: r.container, unmount: r.unmount };
}

/**
 * Core safety assertions that hold for EVERY HTML-rendering path, regardless of
 * the neutralization mechanism (escaping vs. stripping):
 *   - no executable `<script>` element survives (a `BreadcrumbList`
 *     `application/ld+json` data block is permitted, but must itself be inert —
 *     its serialized text must not contain a raw `<script>`/`</script>`),
 *   - no element carries an `onerror`/`onload` handler from the payload,
 *   - the payload never executed (`window.__ORA_XSS__` stays unset).
 *
 * Note the marker's presence is intentionally NOT asserted here: the two paths
 * neutralize differently. Plain-text fields ESCAPE the payload (marker survives
 * as inert text/attribute); the rich-text sanitizer STRIPS the `<script>`
 * element together with its text (marker is removed). Both are safe, so the
 * per-path tests assert the path-specific outcome separately.
 */
function assertCoreSafety(container: HTMLElement) {
  for (const script of Array.from(container.querySelectorAll("script"))) {
    // The only legitimate <script> is the Breadcrumbs JSON-LD data block.
    expect(script.getAttribute("type")).toBe("application/ld+json");
    const text = script.textContent ?? "";
    // The author payload must be JSON-escaped inside the data block so it can
    // never re-open a nested <script> element.
    expect(text).not.toContain("<script");
    expect(text.toLowerCase()).not.toContain("</script");
  }

  // No `on*` event-handler attribute survived on any element (the <img onerror>
  // payload must have been escaped/stripped, not parsed into a live node).
  expect(container.querySelector("[onerror]")).toBeNull();
  expect(container.querySelector("[onload]")).toBeNull();

  // The payload never executed.
  expect(
    (window as unknown as Record<string, unknown>)[XSS_MARKER],
  ).toBeUndefined();
}

afterEach(() => {
  // Defensive: ensure no test leaks the marker to a later assertion.
  delete (window as unknown as Record<string, unknown>)[XSS_MARKER];
});

const NEW_BLOCK_NAMES = Object.keys(NEW_BLOCK_INJECTORS);
const HTML_PATH_NAMES = Object.keys(HTML_PATH_INJECTORS);

describe("Feature: page-builder-block-library — Property 5: Sanitization", () => {
  // ── Property: every targeted block neutralizes every payload ───────────────
  it("neutralizes an injected <script>/onerror payload in every HTML-rendering path", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NEW_BLOCK_NAMES),
        fc.constantFrom(...PAYLOADS),
        (type, payload) => {
          const { container, unmount } = renderNewBlock(type, payload);
          try {
            assertCoreSafety(container);
          } finally {
            unmount();
            delete (window as unknown as Record<string, unknown>)[XSS_MARKER];
          }
        },
      ),
      { numRuns: 8 },
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...HTML_PATH_NAMES),
        fc.constantFrom(...PAYLOADS),
        (type, payload) => {
          const { container, unmount } = renderHtmlPathBlock(type, payload);
          try {
            assertCoreSafety(container);
          } finally {
            unmount();
            delete (window as unknown as Record<string, unknown>)[XSS_MARKER];
          }
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Per-block example coverage (clear attribution on failure) ──────────────
  describe("new block library — plain-text fields escape injected markup", () => {
    it.each(NEW_BLOCK_NAMES)(
      "%s neutralizes the script payload (no live <script>/onerror node)",
      (type) => {
        const { container, unmount } = renderNewBlock(type, MIXED_PAYLOAD);
        try {
          assertCoreSafety(container);
          // A plain-text field never produces a `dangerouslySetInnerHTML`
          // author-HTML node, so no non-JSON-LD <script> can exist.
          const execScripts = Array.from(
            container.querySelectorAll("script"),
          ).filter((s) => s.getAttribute("type") !== "application/ld+json");
          expect(execScripts).toHaveLength(0);
          // The payload reached the render but was ESCAPED to inert text — its
          // marker survives, proving neutralization (not a silent drop).
          expect(container.innerHTML).toContain(XSS_MARKER);
        } finally {
          unmount();
        }
      },
    );
  });

  describe("existing rich-text blocks — sanitizeRichTextHtml strips the payload", () => {
    it.each(HTML_PATH_NAMES)(
      "%s routes author HTML through the sanitizer before rendering",
      (type) => {
        const { container, unmount } = renderHtmlPathBlock(type, MIXED_PAYLOAD);
        try {
          assertCoreSafety(container);
          // These blocks DO use dangerouslySetInnerHTML; after sanitization the
          // surviving safe markup (the <p>) must still render as a real node,
          // proving the content path ran (not a blanket drop)…
          expect(container.querySelector("p")).not.toBeNull();
          // …while the dangerous payload — script element AND its marker text —
          // was stripped entirely by the sanitizer.
          expect(container.innerHTML).not.toContain(XSS_MARKER);
        } finally {
          unmount();
        }
      },
    );
  });

  // ── Direct sanitizer call-site assertion (Property 5 core, Req 11.1) ───────
  it("sanitizeRichTextHtml removes <script> tags and on* handlers for every payload", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PAYLOADS), (payload) => {
        const clean = sanitizeRichTextHtml(payload);
        expect(clean).not.toMatch(/<script/i);
        expect(clean.toLowerCase()).not.toContain("</script");
        expect(clean).not.toMatch(/onerror/i);
        expect(clean).not.toMatch(/onload/i);
      }),
      { numRuns: 6 },
    );
  });
});
