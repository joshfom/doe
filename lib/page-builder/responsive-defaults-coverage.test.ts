/**
 * CI Coverage Gate: Responsive Defaults
 *
 * Enumerates every registered page-builder component and asserts:
 * 1. Every multi-column component declares `responsiveDefaults` producing single-column on mobile
 * 2. Every component either has `responsiveDefaults.mobile` or is in RESPONSIVE_DEFAULTS_EXEMPT
 * 3. Exempt entries have non-empty justification strings
 * 4. `responsiveDefaults` entries only use keys from BREAKPOINT_AWARE_FIELDS
 * 5. Built-in templates produce single-column stacking on mobile for all multi-column instances
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5
 */
import { describe, it, expect } from "vitest";
import { pageBuilderConfig } from "./config";
import { RESPONSIVE_DEFAULTS_EXEMPT } from "./responsive-defaults-exempt";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";
import { validateResponsiveDefaults } from "./responsive-defaults";
import { createTemplateRegistry } from "./templates";
import { resolveWithDefaults } from "./resolve-render-props";
import type { ComponentInstance } from "./types";

/**
 * Multi-column components that MUST declare responsiveDefaults producing
 * single-column stacking on mobile (Requirement 4).
 */
const MULTI_COLUMN_COMPONENTS: ReadonlySet<string> = new Set([
  "Columns",
  "StatsGrid",
  "IconFeatureList",
  "FeaturedProjects",
  "FeaturedCommunities",
  "ContactLocationsMap",
  "AccordionGroup",
]);

/**
 * Fields that produce single-column stacking when set to these values.
 */
const SINGLE_COLUMN_VALUES: Record<string, unknown[]> = {
  layoutDirection: ["column"],
  columns: ["1", 1],
};

describe("Responsive Defaults Coverage Gate", () => {
  const components = pageBuilderConfig.components;
  const componentNames = Object.keys(components);

  // Requirement 7.1: Enumerate every entry in pageBuilderConfig.components
  it("should have registered components to test", () => {
    expect(componentNames.length).toBeGreaterThan(0);
  });

  // Requirement 7.2: Multi-column components declare responsiveDefaults producing single-column on mobile
  describe("Multi-column components declare single-column mobile defaults", () => {
    for (const name of MULTI_COLUMN_COMPONENTS) {
      it(`${name} declares responsiveDefaults with mobile single-column stacking`, () => {
        const component = components[name];
        expect(
          component,
          `Multi-column component "${name}" is not registered in pageBuilderConfig.components`,
        ).toBeDefined();

        const responsiveDefaults = (component as any).responsiveDefaults;
        expect(
          responsiveDefaults,
          `Multi-column component "${name}" must declare responsiveDefaults but none found`,
        ).toBeDefined();

        // Find at least one field that produces single-column stacking on mobile
        const fieldEntries = Object.entries(responsiveDefaults) as [string, { mobile?: unknown }][];
        const hasSingleColumnMobile = fieldEntries.some(([fieldName, entry]) => {
          if (!entry || entry.mobile === undefined) return false;
          const allowedValues = SINGLE_COLUMN_VALUES[fieldName];
          if (!allowedValues) return false;
          return allowedValues.includes(entry.mobile);
        });

        expect(
          hasSingleColumnMobile,
          `Multi-column component "${name}" must declare responsiveDefaults that produce single-column stacking on mobile. ` +
            `Expected at least one field (layoutDirection or columns) with a mobile value producing a single vertical stack. ` +
            `Found: ${JSON.stringify(responsiveDefaults)}`,
        ).toBe(true);
      });
    }
  });

  // Requirement 7.3, 7.4: Every component has responsiveDefaults.mobile OR is in RESPONSIVE_DEFAULTS_EXEMPT
  describe("Every component has responsiveDefaults.mobile or is exempt with justification", () => {
    for (const name of componentNames) {
      it(`${name} has responsiveDefaults.mobile or is in RESPONSIVE_DEFAULTS_EXEMPT`, () => {
        const component = components[name];
        const responsiveDefaults = (component as any).responsiveDefaults;

        if (responsiveDefaults) {
          // Component declares responsiveDefaults — check at least one entry has a mobile slot
          const fieldEntries = Object.entries(responsiveDefaults) as [string, { mobile?: unknown }][];
          const hasMobileSlot = fieldEntries.some(
            ([, entry]) => entry && entry.mobile !== undefined,
          );
          expect(
            hasMobileSlot,
            `Component "${name}" declares responsiveDefaults but none of its entries have a "mobile" slot. ` +
              `At least one field must declare a mobile default. Found: ${JSON.stringify(responsiveDefaults)}`,
          ).toBe(true);
        } else {
          // Component does not declare responsiveDefaults — must be in exempt list
          expect(
            name in RESPONSIVE_DEFAULTS_EXEMPT,
            `Component "${name}" does not declare responsiveDefaults and is not in RESPONSIVE_DEFAULTS_EXEMPT. ` +
              `Either add responsiveDefaults with a mobile slot, or add "${name}" to RESPONSIVE_DEFAULTS_EXEMPT with a non-empty justification.`,
          ).toBe(true);
        }
      });
    }
  });

  // Requirement 7.5: Exempt entries have non-empty justification strings
  describe("RESPONSIVE_DEFAULTS_EXEMPT entries have non-empty justifications", () => {
    for (const [name, justification] of Object.entries(RESPONSIVE_DEFAULTS_EXEMPT)) {
      it(`${name} has a non-empty justification string`, () => {
        expect(
          typeof justification === "string" && justification.trim().length > 0,
          `RESPONSIVE_DEFAULTS_EXEMPT entry "${name}" must have a non-empty justification string, ` +
            `but got: ${JSON.stringify(justification)}`,
        ).toBe(true);
      });
    }
  });

  // Requirement 7.6: responsiveDefaults entries only use keys from BREAKPOINT_AWARE_FIELDS
  describe("responsiveDefaults entries use only valid BREAKPOINT_AWARE_FIELDS keys", () => {
    for (const name of componentNames) {
      const component = components[name];
      const responsiveDefaults = (component as any).responsiveDefaults;

      if (responsiveDefaults) {
        it(`${name} responsiveDefaults passes validation`, () => {
          const errors = validateResponsiveDefaults(name, responsiveDefaults);
          expect(
            errors,
            `Component "${name}" has invalid responsiveDefaults:\n` +
              errors
                .map(
                  (e) =>
                    `  - ${e.reason}${e.field ? ` (field: ${e.field})` : ""}${e.slot ? ` (slot: ${e.slot})` : ""}`,
                )
                .join("\n"),
          ).toHaveLength(0);

          // Additionally verify all keys are in BREAKPOINT_AWARE_FIELDS explicitly
          for (const fieldKey of Object.keys(responsiveDefaults)) {
            expect(
              BREAKPOINT_AWARE_FIELDS.has(fieldKey),
              `Component "${name}" responsiveDefaults contains field "${fieldKey}" which is not in BREAKPOINT_AWARE_FIELDS`,
            ).toBe(true);
          }
        });
      }
    }
  });

  // Requirements 8.1, 8.2, 8.3, 8.4, 8.5: Template mobile rendering assertions
  describe("Built-in templates produce single-column stacking on mobile", () => {
    // Get all built-in templates from the registry (only those reachable from registered page routes)
    const registry = createTemplateRegistry();
    const templates = registry.list();

    /**
     * Collect all component instances from a template's data.
     * Includes top-level content and all zone children.
     */
    function collectAllInstances(
      content: ComponentInstance[],
      zones?: Record<string, ComponentInstance[]>,
    ): ComponentInstance[] {
      const instances: ComponentInstance[] = [...content];
      if (zones) {
        for (const zoneInstances of Object.values(zones)) {
          instances.push(...zoneInstances);
        }
      }
      return instances;
    }

    /**
     * Checks whether a stored field value has an explicit mobile slot set.
     * A value is explicitly set if it's non-null, non-undefined, and not an empty string.
     */
    function hasExplicitMobileSlot(storedValue: unknown): boolean {
      if (storedValue === null || storedValue === undefined) return false;
      if (typeof storedValue !== "object") return false;
      const bv = storedValue as Record<string, unknown>;
      const mobileVal = bv.mobile;
      return mobileVal !== null && mobileVal !== undefined && mobileVal !== "";
    }

    /**
     * Map of multi-column component names to the field that controls their layout stacking.
     */
    const MULTI_COLUMN_LAYOUT_FIELDS: Record<string, string> = {
      Columns: "layoutDirection",
      StatsGrid: "columns",
      IconFeatureList: "layoutDirection",
      FeaturedProjects: "columns",
      FeaturedCommunities: "columns",
      ContactLocationsMap: "layoutDirection",
      AccordionGroup: "layoutDirection",
    };

    for (const template of templates) {
      describe(`Template: ${template.name} (${template.id})`, () => {
        const allInstances = collectAllInstances(template.data.content, template.data.zones);
        const multiColumnInstances = allInstances.filter(
          (instance) => instance.type in MULTI_COLUMN_LAYOUT_FIELDS,
        );

        if (multiColumnInstances.length === 0) {
          it("has no multi-column component instances (nothing to assert)", () => {
            expect(true).toBe(true);
          });
          return;
        }

        for (const instance of multiColumnInstances) {
          const layoutField = MULTI_COLUMN_LAYOUT_FIELDS[instance.type];
          const componentDef = components[instance.type];
          const responsiveDefaults = (componentDef as any)?.responsiveDefaults;

          it(`${instance.type} (id: ${instance.props.id}) produces single-column stacking on mobile`, () => {
            const storedFieldValue = instance.props[layoutField];

            // If the template explicitly sets a non-empty mobile slot value,
            // the template author intentionally chose it — skip assertion (Req 8.2)
            if (hasExplicitMobileSlot(storedFieldValue)) {
              // Explicitly configured — no assertion needed per Req 8.4
              return;
            }

            // Otherwise, verify that resolveWithDefaults produces a single-column value on mobile
            const result = resolveWithDefaults(
              storedFieldValue,
              "mobile",
              layoutField,
              responsiveDefaults,
            );

            const allowedStackingValues = SINGLE_COLUMN_VALUES[layoutField];
            expect(
              allowedStackingValues,
              `No known single-column values defined for field "${layoutField}" on component "${instance.type}"`,
            ).toBeDefined();

            expect(
              allowedStackingValues!.includes(result.value),
              `Template "${template.name}" (${template.id}): Multi-column component "${instance.type}" ` +
                `(id: ${instance.props.id}) does not produce single-column stacking on mobile. ` +
                `Field "${layoutField}" resolved to ${JSON.stringify(result.value)} (source: ${result.source}), ` +
                `but expected one of: ${JSON.stringify(allowedStackingValues)}`,
            ).toBe(true);
          });
        }
      });
    }
  });
});
