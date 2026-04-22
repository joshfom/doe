// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Polyfill ResizeObserver for jsdom — must be set before importing config
// which transitively loads @dnd-kit/dom that accesses ResizeObserver at module scope
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic imports so the polyfill is in place before module evaluation
const { createTemplateRegistry } = await import("./index");
const { validatePageData } = await import("../schema");
const { pageBuilderConfig } = await import("../config");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const validComponentKeys = Object.keys(pageBuilderConfig.components);

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates a component instance using only valid component keys from config */
const componentInstanceArb = fc
  .record({
    type: fc.constantFrom(...validComponentKeys),
    id: fc.uuid(),
  })
  .map(({ type, id }) => ({
    type,
    props: { id },
  }));

/** Generates valid PageData using only known component types */
const validPageDataArb = fc
  .record({
    title: fc.string({ minLength: 1, maxLength: 50 }),
    content: fc.array(componentInstanceArb, { minLength: 0, maxLength: 5 }),
  })
  .map(({ title, content }) => ({
    root: { props: { title } },
    content,
  }));

/** Generates a valid template definition for registration */
const templateDefArb = fc
  .record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ minLength: 1, maxLength: 100 }),
    thumbnailId: fc.string({ minLength: 1, maxLength: 30 }),
    data: validPageDataArb,
  });

// ─── Property 8: All templates produce valid PageData ────────────────────────

/**
 * Feature: puck-visual-page-builder, Property 8: All templates produce valid PageData
 *
 * Validates: Requirements 8.1
 *
 * For any template in the TemplateRegistry, its `data` field SHALL pass
 * schema validation and SHALL only reference component keys that exist
 * in the Component_Library configuration.
 */

describe("All templates produce valid PageData", () => {
  const registry = createTemplateRegistry();
  const templates = registry.list();

  it("registry has at least one template", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates.map((t) => [t.id, t] as const))(
    "template %s passes schema validation and uses only known component keys",
    (_id, template) => {
      // Schema validation
      const result = validatePageData(template.data);
      expect(result.success).toBe(true);

      // All component types in content must exist in config
      for (const component of template.data.content) {
        expect(
          validComponentKeys,
          `Component type "${component.type}" in template "${template.name}" is not in config`,
        ).toContain(component.type);
      }

      // Check zones if present
      if (template.data.zones) {
        for (const [zoneName, zoneComponents] of Object.entries(template.data.zones)) {
          for (const component of zoneComponents) {
            expect(
              validComponentKeys,
              `Component type "${component.type}" in zone "${zoneName}" of template "${template.name}" is not in config`,
            ).toContain(component.type);
          }
        }
      }
    },
  );
});

// ─── Property 9: Template instantiation produces independent copy ────────────

/**
 * Feature: puck-visual-page-builder, Property 9: Template instantiation produces independent copy
 *
 * Validates: Requirements 8.3, 8.4
 *
 * For any template, creating a page from that template SHALL produce a page
 * whose initial PageData is deeply equal to the template's data. Modifying
 * the page's data after creation SHALL NOT alter the original template's data.
 */

describe("Template instantiation produces independent copy", () => {
  const registry = createTemplateRegistry();
  const templates = registry.list();

  it.each(templates.map((t) => [t.id, t] as const))(
    "template %s — getById returns deep-equal data, and mutations do not affect original",
    (_id, template) => {
      // Get the template by ID (simulates "creating a page from template")
      const retrieved = registry.getById(template.id);
      expect(retrieved).not.toBeNull();

      // Initial data should be deeply equal
      expect(retrieved!.data).toEqual(template.data);

      // Mutate the retrieved copy
      retrieved!.data.content.push({
        type: "TextBlock",
        props: { id: "mutated-id", content: "mutated" },
      });
      if (retrieved!.data.root.props) {
        retrieved!.data.root.props.title = "MUTATED TITLE";
      }

      // Re-fetch from registry — original should be unchanged
      const original = registry.getById(template.id);
      expect(original).not.toBeNull();
      expect(original!.data).toEqual(template.data);
      expect(original!.data.content.length).toBe(template.data.content.length);
      expect(original!.data.root.props.title).not.toBe("MUTATED TITLE");
    },
  );
});

// ─── Property 10: Template registration round-trip ───────────────────────────

/**
 * Feature: puck-visual-page-builder, Property 10: Template registration round-trip
 *
 * Validates: Requirements 8.5
 *
 * For any valid template definition (name, description, thumbnailId, and
 * valid PageData), registering it with the TemplateRegistry and then
 * retrieving it by ID SHALL return an equivalent template.
 */

describe("Template registration round-trip", () => {
  it("register then getById returns equivalent template", () => {
    fc.assert(
      fc.property(templateDefArb, (templateDef) => {
        const registry = createTemplateRegistry();

        registry.register(templateDef);

        const retrieved = registry.getById(templateDef.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(templateDef.id);
        expect(retrieved!.name).toBe(templateDef.name);
        expect(retrieved!.description).toBe(templateDef.description);
        expect(retrieved!.thumbnailId).toBe(templateDef.thumbnailId);
        expect(retrieved!.data).toEqual(templateDef.data);
      }),
      { numRuns: 20 },
    );
  });
});
