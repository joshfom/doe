// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// Polyfill ResizeObserver for jsdom — must be set before importing config
// which transitively loads @dnd-kit/dom that accesses ResizeObserver at module scope
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation
const { pageBuilderConfig } = await import("./config");

/**
 * Feature: puck-visual-page-builder, Property 11: All component fields have default values
 *
 * Validates: Requirements 12.2
 *
 * For any component in the Component_Library configuration, every field
 * defined in its Field_Config SHALL have a corresponding default value
 * in `defaultProps`, ensuring new component instances are always fully
 * initialized.
 */

describe("All component fields have default values", () => {
  const componentEntries = Object.entries(pageBuilderConfig.components);

  it("config has at least one component registered", () => {
    expect(componentEntries.length).toBeGreaterThan(0);
  });

  it.each(componentEntries)(
    "%s — every field key has a corresponding defaultProps key",
    (componentName, componentConfig) => {
      const fields = componentConfig.fields ?? {};
      const defaultProps = (componentConfig.defaultProps as Record<string, unknown>) ?? {};

      const fieldKeys = Object.keys(fields);
      if (fieldKeys.length === 0) {
        // Template components have no fields — nothing to validate
        return;
      }

      for (const fieldKey of fieldKeys) {
        expect(
          defaultProps,
          `Component "${componentName}" is missing a default value for field "${fieldKey}"`,
        ).toHaveProperty(fieldKey);
      }
    },
  );
});

import fc from "fast-check";
import { render, cleanup } from "@testing-library/react";
import React from "react";

const { ICON_MAP } = await import("./config");

/**
 * Feature: atomic-component-architecture, Property 3: Icon renders valid SVG for any predefined icon name
 *
 * Validates: Requirements 4.6, 4.7, 4.8
 *
 * For any icon name in the predefined ICON_MAP, rendering the Icon component
 * with that name, a valid size, and a valid color SHALL produce a rendered
 * element containing an SVG.
 */

describe("Icon renders valid SVG for any predefined icon name", () => {
  const iconNames = Object.keys(ICON_MAP);
  const Icon = pageBuilderConfig.components.Icon;

  it("ICON_MAP has at least one icon defined", () => {
    expect(iconNames.length).toBeGreaterThan(0);
  });

  it("renders an SVG element for any valid icon name, size, and color", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...iconNames),
        fc.constantFrom("16", "20", "24", "32", "40", "48", "64"),
        fc.constantFrom("#000000", "#FFFFFF", "#B8956B", "#2C2C2C", "#FF0000", "#00FF00", "#0000FF"),
        (iconName, size, color) => {
          const element = Icon.render({
            ...Icon.defaultProps,
            id: "test-icon",
            icon: iconName,
            size,
            color,
          });

          const { container, unmount } = render(element as React.ReactElement);
          const svg = container.querySelector("svg");

          expect(svg).not.toBeNull();

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Dynamic import for component templates ──────────────────────────────────
const { componentTemplates, instantiate } = await import("./templates/component-templates");

/**
 * Feature: atomic-component-architecture, Property 5: Template expansion produces unique component IDs
 *
 * Validates: Requirements 6.6, 6.7
 *
 * For any template definition, calling its build() function SHALL produce a data
 * structure where every ComponentInstance across content and all zones entries has
 * a unique id value, and calling build() twice SHALL produce different ID sets
 * (no collisions across invocations).
 */

function collectIds(result: {
  content: Array<{ props: { id: string } }>;
  zones: Record<string, Array<{ props: { id: string } }>>;
}): string[] {
  const ids: string[] = [];
  for (const item of result.content) ids.push(item.props.id);
  for (const zoneItems of Object.values(result.zones)) {
    for (const item of zoneItems) ids.push(item.props.id);
  }
  return ids;
}

describe("Template expansion produces unique component IDs", () => {
  it("has at least one template defined", () => {
    expect(componentTemplates.length).toBeGreaterThan(0);
  });

  it.each(componentTemplates.map((t) => [t.name, t] as const))(
    "%s — all IDs within a single instantiate() are unique",
    (_name, template) => {
      const result = instantiate(template);
      const ids = collectIds(result);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(componentTemplates.map((t) => [t.name, t] as const))(
    "%s — two instantiate() calls produce non-overlapping ID sets",
    (_name, template) => {
      const first = collectIds(instantiate(template));
      const second = collectIds(instantiate(template));

      const firstSet = new Set(first);
      for (const id of second) {
        expect(firstSet.has(id)).toBe(false);
      }
    },
  );
});


/**
 * Feature: atomic-component-architecture, Property 8: Template expanded data JSON round-trip
 *
 * Validates: Requirements 12.3, 12.4
 *
 * For any component template, the output of build() (containing content and zones)
 * serialized to JSON and deserialized back SHALL produce a deeply equal data structure.
 */
describe("Template expanded data JSON round-trip", () => {
  it.each(componentTemplates.map((t) => [t.name, t] as const))(
    "%s — instantiate() output survives JSON round-trip",
    (_name, template) => {
      const original = instantiate(template);
      const roundTripped = JSON.parse(JSON.stringify(original));
      expect(roundTripped).toEqual(original);
    },
  );
});


// ─── Dynamic imports for page template registry & schema validation ──────────
const { createTemplateRegistry } = await import("./templates/index");
const { validatePageData } = await import("./schema");

/**
 * Feature: atomic-component-architecture, Property 6: All built-in page templates pass schema validation
 *
 * Validates: Requirements 11.4
 *
 * For any built-in page template in the template registry, its data field
 * SHALL pass validatePageData() successfully (returning { success: true }).
 */
describe("All built-in page templates pass schema validation", () => {
  const registry = createTemplateRegistry();
  const templates = registry.list();

  it("registry has at least one template", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates.map((t) => [t.name, t] as const))(
    "%s — passes schema validation",
    (_name, template) => {
      const result = validatePageData(template.data);
      expect(result.success).toBe(true);
    },
  );
});


/**
 * Feature: atomic-component-architecture, Property 1: Style system fields present on all atomic components
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6
 *
 * For any atomic component registered in the Component_Registry (Heading, Text,
 * Button, InlineLink, Image, Quote, Divider, Icon), its field definitions SHALL
 * include `_padding`, `_margin`, and `_border`.
 *
 * Note: Spacer is intentionally excluded — it is a minimal layout utility with
 * only a `height` field and does not participate in the style system.
 */
describe("Style system fields present on all atomic components", () => {
  // Atomic components that include spacingBorderFields
  // Note: Button is excluded — it has its own per-side padding/border controls
  const atomicComponents = [
    "Heading",
    "Text",
    "InlineLink",
    "Image",
    "Quote",
    "Divider",
    "Icon",
  ];

  it.each(atomicComponents)(
    "%s — has _padding, _margin, and _border fields",
    (componentName) => {
      const component = pageBuilderConfig.components[componentName];
      expect(component).toBeDefined();
      const fieldKeys = Object.keys(component.fields ?? {});
      expect(fieldKeys).toContain("_padding");
      expect(fieldKeys).toContain("_margin");
      expect(fieldKeys).toContain("_border");
    },
  );

  it("Button — has its own padding/border/margin controls", () => {
    const btn = pageBuilderConfig.components.Button;
    expect(btn).toBeDefined();
    const fieldKeys = Object.keys(btn.fields ?? {});
    // Button uses per-side stepper padding, inline border sliders and _margin
    expect(fieldKeys).toContain("btnPadding");
    expect(fieldKeys).toContain("borderSize");
    expect(fieldKeys).toContain("borderRadius");
    expect(fieldKeys).toContain("borderColor");
    expect(fieldKeys).toContain("_margin");
  });

  it("Spacer is intentionally minimal (no style system fields)", () => {
    const spacer = pageBuilderConfig.components.Spacer;
    expect(spacer).toBeDefined();
    const fieldKeys = Object.keys(spacer.fields ?? {});
    expect(fieldKeys).not.toContain("_padding");
    expect(fieldKeys).not.toContain("_margin");
    expect(fieldKeys).not.toContain("_border");
  });
});


/**
 * Feature: atomic-component-architecture, Property 4: Heading renders correct HTML tag for any level
 *
 * Validates: Requirements 10.2
 *
 * For any heading level in {h1, h2, h3, h4, h5, h6}, rendering the Heading
 * component with that level SHALL produce an element with the corresponding
 * HTML tag name.
 */
describe("Heading renders correct HTML tag for any level", () => {
  const Heading = pageBuilderConfig.components.Heading;
  const levels = ["h1", "h2", "h3", "h4", "h5", "h6"];

  it.each(levels)(
    "renders <%s> element when level is %s",
    (level) => {
      const element = (Heading.render as (p: Record<string, unknown>) => React.ReactElement)({
        ...Heading.defaultProps,
        id: "test-heading",
        text: "Test Heading",
        level,
      });

      const { container, unmount } = render(element);
      const headingEl = container.querySelector(level);
      expect(headingEl).not.toBeNull();
      expect(headingEl!.textContent).toBe("Test Heading");
      unmount();
    },
  );
});


/**
 * Feature: atomic-component-architecture, Property 2: Typography fields present on text-bearing atomic components
 *
 * Validates: Requirements 5.5
 *
 * For any text-bearing atomic component that uses direct typography styling
 * (Heading, Text, InlineLink, Quote), its field definitions SHALL include
 * fontFamily, fontSize, fontWeight, color, textAlign, letterSpacing, and lineHeight.
 *
 * Note: Button is excluded — it uses variant/size-based styling rather than
 * direct typography fields, so typography is not applicable per Requirement 5.5.
 */
describe("Typography fields present on text-bearing atomic components", () => {
  const textBearingComponents = ["Heading", "Text", "InlineLink", "Quote"];
  const requiredTypoFields = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "color",
    "textAlign",
    "letterSpacing",
    "lineHeight",
  ];

  it.each(textBearingComponents)(
    "%s — has all required typography fields",
    (componentName) => {
      const component = pageBuilderConfig.components[componentName];
      expect(component).toBeDefined();
      const fieldKeys = Object.keys(component.fields ?? {});
      for (const typoField of requiredTypoFields) {
        expect(
          fieldKeys,
          `${componentName} missing typography field "${typoField}"`,
        ).toContain(typoField);
      }
    },
  );
});


/**
 * Feature: atomic-component-architecture, Property 7: Component props JSON round-trip
 *
 * Validates: Requirements 12.1, 12.2
 *
 * For any component registered in the Component_Registry (atomic or layout),
 * serializing its defaultProps to JSON via JSON.stringify and deserializing
 * back via JSON.parse SHALL produce an object deeply equal to the original defaultProps.
 */
describe("Component props JSON round-trip", () => {
  const componentEntries = Object.entries(pageBuilderConfig.components);

  it.each(componentEntries)(
    "%s — defaultProps survive JSON round-trip",
    (_name, componentConfig) => {
      const defaultProps = componentConfig.defaultProps ?? {};
      const roundTripped = JSON.parse(JSON.stringify(defaultProps));
      expect(roundTripped).toEqual(defaultProps);
    },
  );
});
