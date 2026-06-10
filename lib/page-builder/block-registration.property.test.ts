// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Polyfill ResizeObserver for jsdom — must be set before importing config
// which transitively loads @dnd-kit/dom that accesses ResizeObserver at module scope.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation.
const { pageBuilderConfig } = await import("./config");
const { PALETTE_META } = await import("./builder-shell/palette-meta");
const { validateResponsiveDefaults } = await import("./responsive-defaults");
const { BREAKPOINT_AWARE_FIELDS } = await import("./breakpoint-fields");

/**
 * Feature: page-builder-block-library — cross-cutting registration corpus tests.
 *
 * Extends the existing config corpus (`config.test.ts` / `config.property.test.ts`)
 * with the two registration/responsive invariants from the design's
 * "Correctness Properties" section, covering the ten new marketing blocks.
 */

/**
 * The ten new blocks added by this feature, paired with the single palette
 * category each must live in (per the design's category assignment:
 * `Card` → `blocks`; `CardGrid` → `layout`; all others → `components`).
 */
const NEW_BLOCKS: ReadonlyArray<{ name: string; category: string }> = [
  { name: "CTA", category: "components" },
  { name: "Testimonial", category: "components" },
  { name: "TabGroup", category: "components" },
  { name: "LogoCloud", category: "components" },
  { name: "PricingTable", category: "components" },
  { name: "Card", category: "blocks" },
  { name: "CardGrid", category: "layout" },
  { name: "SocialLinks", category: "components" },
  { name: "Countdown", category: "components" },
  { name: "Breadcrumbs", category: "components" },
];

/**
 * The new grid blocks that declare `responsiveDefaults` (a breakpoint-aware
 * `columns` field collapsed/reduced on mobile).
 */
const NEW_GRID_BLOCKS: ReadonlyArray<string> = [
  "Testimonial",
  "LogoCloud",
  "PricingTable",
  "CardGrid",
];

/**
 * Property 1: Registration validity (Req 1, 10).
 *
 * For every new block, its name appears in exactly one
 * `categories.*.components` array, in the `wrapAllRenders` map
 * (`pageBuilderConfig.components`), and in `PALETTE_META`;
 * `pageBuilderConfig` constructs without throwing.
 *
 * **Validates: Requirements 1.1, 1.2, 10.1, 10.2, 10.3, 10.4**
 */
describe("Property 1: new-block registration validity", () => {
  const categories = pageBuilderConfig.categories as Record<
    string,
    { components: string[]; title: string; defaultExpanded?: boolean }
  >;

  // Importing `./config` already evaluates `wrapAllRenders(...)`, which throws
  // at construction on an invalid block (e.g. bad responsiveDefaults). A defined
  // config therefore proves it constructed without throwing.
  it("pageBuilderConfig constructs without throwing (config is defined)", () => {
    expect(pageBuilderConfig).toBeDefined();
    expect(pageBuilderConfig.components).toBeDefined();
    expect(pageBuilderConfig.categories).toBeDefined();
  });

  it("every new block satisfies the registration invariant (property over the corpus)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NEW_BLOCKS), ({ name, category }) => {
        // (a) Present in the wrapAllRenders component map.
        expect(pageBuilderConfig.components[name]).toBeDefined();

        // (b) Present in EXACTLY ONE category's components array.
        const categoriesContaining = Object.entries(categories)
          .filter(([, cat]) => cat.components.includes(name))
          .map(([key]) => key);
        expect(categoriesContaining).toHaveLength(1);

        // (c) ...and in the category the design assigns it to.
        expect(categoriesContaining[0]).toBe(category);

        // (d) Has a PALETTE_META entry with a description and an Icon.
        const meta = PALETTE_META[name];
        expect(meta).toBeDefined();
        expect(typeof meta.description).toBe("string");
        expect(meta.description.length).toBeGreaterThan(0);
        expect(meta.Icon).toBeDefined();
      }),
      { numRuns: NEW_BLOCKS.length },
    );
  });

  // Explicit per-block assertions complement the property run with readable,
  // individually-reported cases.
  it.each(NEW_BLOCKS)(
    "$name is registered in components, in exactly one category ($category), and in PALETTE_META",
    ({ name, category }) => {
      expect(pageBuilderConfig.components[name]).toBeDefined();

      const categoriesContaining = Object.entries(categories)
        .filter(([, cat]) => cat.components.includes(name))
        .map(([key]) => key);
      expect(categoriesContaining).toEqual([category]);

      expect(PALETTE_META[name]).toBeDefined();
    },
  );
});

/**
 * Property 2: responsiveDefaults validity (Req 12).
 *
 * Every grid block's `responsiveDefaults` passes `validateResponsiveDefaults`
 * (keys ⊆ `BREAKPOINT_AWARE_FIELDS`, `mobile` slot present). This is enforced
 * at construction inside `wrapAllRenders` (it throws on violation), so a passing
 * import is part of the proof; the explicit assertion below confirms it directly.
 *
 * **Validates: Requirements 12.1, 12.2**
 */
describe("Property 2: new grid-block responsiveDefaults validity", () => {
  it("every grid block declares responsiveDefaults that pass validateResponsiveDefaults (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NEW_GRID_BLOCKS), (name) => {
        const component = pageBuilderConfig.components[name];
        expect(component).toBeDefined();

        const responsiveDefaults = (
          component as { responsiveDefaults?: Record<string, unknown> }
        ).responsiveDefaults;
        expect(
          responsiveDefaults,
          `Grid block "${name}" must declare responsiveDefaults`,
        ).toBeDefined();

        const errors = validateResponsiveDefaults(
          name,
          responsiveDefaults as Parameters<typeof validateResponsiveDefaults>[1],
        );
        expect(
          errors,
          `Grid block "${name}" has invalid responsiveDefaults: ${errors
            .map((e) => e.reason)
            .join("; ")}`,
        ).toHaveLength(0);

        // Every declared field is breakpoint-aware and has a mobile slot.
        for (const [fieldKey, slot] of Object.entries(
          responsiveDefaults as Record<string, { mobile?: unknown }>,
        )) {
          expect(
            BREAKPOINT_AWARE_FIELDS.has(fieldKey),
            `Grid block "${name}" declares non-breakpoint-aware field "${fieldKey}"`,
          ).toBe(true);
          expect(
            slot.mobile,
            `Grid block "${name}" field "${fieldKey}" is missing a mobile slot`,
          ).toBeDefined();
        }
      }),
      { numRuns: NEW_GRID_BLOCKS.length },
    );
  });

  it.each(NEW_GRID_BLOCKS)(
    "%s responsiveDefaults passes validateResponsiveDefaults with a columns mobile slot",
    (name) => {
      const component = pageBuilderConfig.components[name];
      const responsiveDefaults = (
        component as { responsiveDefaults?: Record<string, { mobile?: unknown }> }
      ).responsiveDefaults;

      expect(responsiveDefaults).toBeDefined();
      expect(
        validateResponsiveDefaults(
          name,
          responsiveDefaults as Parameters<typeof validateResponsiveDefaults>[1],
        ),
      ).toHaveLength(0);
      expect(responsiveDefaults!.columns).toBeDefined();
      expect(responsiveDefaults!.columns.mobile).toBeDefined();
    },
  );
});
