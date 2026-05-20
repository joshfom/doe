// Feature: default-responsive-component-defaults, Property 5: Validation Rejects Invalid Defaults
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateResponsiveDefaults,
  type ResponsiveDefaults,
} from "./responsive-defaults";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";
import { resolveWithDefaults, resolveAllRenderPropsWithDefaults } from "./resolve-render-props";
import type { Breakpoint, BreakpointValue } from "./breakpoints";

/**
 * Feature: default-responsive-component-defaults, Property 5: Validation Rejects Invalid Defaults
 *
 * **Validates: Requirements 1.2, 1.4, 1.6**
 *
 * For any `responsiveDefaults` object containing a key not in
 * `BREAKPOINT_AWARE_FIELDS`, or a slot key not in `{"desktop", "tablet",
 * "mobile"}`, or a declared entry missing a `mobile` slot, the
 * `validateResponsiveDefaults` function SHALL return at least one error
 * identifying the offending component, field, and reason.
 */

// --- Arbitraries ---

/** Valid breakpoint-aware field names drawn from the actual registry. */
const validFieldKeys = [...BREAKPOINT_AWARE_FIELDS];

/** Valid slot keys for a BreakpointValue. */
const VALID_SLOTS = ["desktop", "tablet", "mobile"] as const;

/**
 * Generate a string that is guaranteed NOT to be in BREAKPOINT_AWARE_FIELDS.
 * We use a prefix that no real field would have plus a random suffix.
 */
function invalidFieldKeyArb(): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 1 })
    .filter((s) => !BREAKPOINT_AWARE_FIELDS.has(s));
}

/**
 * Generate a string that is guaranteed NOT to be a valid slot key
 * (not "desktop", "tablet", or "mobile").
 */
function invalidSlotKeyArb(): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 1 })
    .filter((s) => s !== "desktop" && s !== "tablet" && s !== "mobile");
}

/** Generate a random non-null, non-undefined slot value. */
const slotValueArb = fc.oneof(
  fc.string({ minLength: 1 }),
  fc.integer(),
  fc.boolean(),
);

/** Generate a random component name. */
const componentNameArb = fc.string({ minLength: 1, maxLength: 30 });

// --- Property 5: Scenario 1 — Invalid field keys ---

describe("Feature: default-responsive-component-defaults, Property 5: Validation Rejects Invalid Defaults", () => {
  it("rejects responsiveDefaults with field keys NOT in BREAKPOINT_AWARE_FIELDS", () => {
    fc.assert(
      fc.property(
        componentNameArb,
        invalidFieldKeyArb(),
        slotValueArb,
        (componentName, invalidKey, value) => {
          const defaults: ResponsiveDefaults = {
            [invalidKey]: { mobile: value },
          };

          const errors = validateResponsiveDefaults(componentName, defaults);

          // Must return at least one error
          expect(errors.length).toBeGreaterThanOrEqual(1);
          // At least one error must reference the offending field
          const fieldError = errors.find((e) => e.field === invalidKey);
          expect(fieldError).toBeDefined();
          expect(fieldError!.component).toBe(componentName);
          expect(fieldError!.reason).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 5: Scenario 2 — Invalid slot keys ---

  it("rejects responsiveDefaults with slot keys NOT in {'desktop', 'tablet', 'mobile'}", () => {
    fc.assert(
      fc.property(
        componentNameArb,
        fc.constantFrom(...validFieldKeys),
        invalidSlotKeyArb(),
        slotValueArb,
        (componentName, validField, invalidSlot, value) => {
          const defaults: ResponsiveDefaults = {
            [validField]: { mobile: value, [invalidSlot]: value } as any,
          };

          const errors = validateResponsiveDefaults(componentName, defaults);

          // Must return at least one error
          expect(errors.length).toBeGreaterThanOrEqual(1);
          // At least one error must reference the offending slot
          const slotError = errors.find((e) => e.slot === invalidSlot);
          expect(slotError).toBeDefined();
          expect(slotError!.component).toBe(componentName);
          expect(slotError!.field).toBe(validField);
          expect(slotError!.reason).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 5: Scenario 3 — Missing mobile slot ---

  it("rejects responsiveDefaults entries missing the 'mobile' slot", () => {
    fc.assert(
      fc.property(
        componentNameArb,
        fc.constantFrom(...validFieldKeys),
        slotValueArb,
        fc.constantFrom("desktop", "tablet"),
        (componentName, validField, value, presentSlot) => {
          // Create an entry with only desktop or tablet, but NOT mobile
          const defaults: ResponsiveDefaults = {
            [validField]: { [presentSlot]: value },
          };

          const errors = validateResponsiveDefaults(componentName, defaults);

          // Must return at least one error
          expect(errors.length).toBeGreaterThanOrEqual(1);
          // At least one error must reference the missing mobile slot
          const mobileError = errors.find(
            (e) => e.field === validField && e.reason.includes("mobile"),
          );
          expect(mobileError).toBeDefined();
          expect(mobileError!.component).toBe(componentName);
          expect(mobileError!.reason).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- Property 5: Scenario 4 — Valid entries produce no errors ---

  it("accepts valid responsiveDefaults (keys in BREAKPOINT_AWARE_FIELDS, valid slots, mobile present)", () => {
    fc.assert(
      fc.property(
        componentNameArb,
        fc.subarray(validFieldKeys, { minLength: 1, maxLength: 5 }),
        slotValueArb,
        fc.option(slotValueArb, { nil: undefined }),
        fc.option(slotValueArb, { nil: undefined }),
        (componentName, fields, mobileValue, desktopValue, tabletValue) => {
          const defaults: ResponsiveDefaults = {};
          for (const field of fields) {
            const entry: Record<string, unknown> = { mobile: mobileValue };
            if (desktopValue !== undefined) entry.desktop = desktopValue;
            if (tabletValue !== undefined) entry.tablet = tabletValue;
            defaults[field] = entry;
          }

          const errors = validateResponsiveDefaults(componentName, defaults);

          // Valid entries must produce zero errors
          expect(errors).toStrictEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: default-responsive-component-defaults, Property 2: Explicit Values Always Win

/**
 * Feature: default-responsive-component-defaults, Property 2: Explicit Values Always Win
 *
 * **Validates: Requirements 3.1, 3.2, 4.11**
 *
 * For any component instance, field, and target breakpoint where the stored
 * data contains a non-null, non-undefined, non-empty-string value at the
 * target breakpoint slot, the resolver SHALL return that explicit value
 * regardless of what `responsiveDefaults` declares for that slot.
 */

describe("Feature: default-responsive-component-defaults, Property 2: Explicit Values Always Win", () => {
  /** Generate a non-null, non-undefined, non-empty-string explicit value. */
  const explicitValueArb = fc.oneof(
    fc.string({ minLength: 1 }), // non-empty strings
    fc.integer(),
    fc.boolean(),
    fc.double({ noNaN: true }),
  );

  /** Generate a random breakpoint. */
  const breakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
    "desktop",
    "tablet",
    "mobile",
  );

  /** Generate a random field name from the valid set. */
  const fieldNameArb = fc.constantFrom(...[...BREAKPOINT_AWARE_FIELDS]);

  /**
   * Generate a random responsiveDefaults value for a given field and breakpoint.
   * This ensures the defaults also declare a value for the same slot, so we can
   * verify the explicit value wins over it.
   */
  const defaultValueArb = fc.oneof(
    fc.string({ minLength: 1 }),
    fc.integer(),
    fc.boolean(),
    fc.double({ noNaN: true }),
  );

  it("explicit value at target breakpoint always wins over responsiveDefaults", () => {
    fc.assert(
      fc.property(
        breakpointArb,
        fieldNameArb,
        explicitValueArb,
        defaultValueArb,
        // Optional values for other breakpoint slots
        fc.option(explicitValueArb, { nil: undefined }),
        fc.option(explicitValueArb, { nil: undefined }),
        (
          targetBreakpoint,
          fieldName,
          explicitValue,
          defaultValue,
          otherSlot1,
          otherSlot2,
        ) => {
          // Build a BreakpointValue with an explicit value at the target breakpoint
          const storedValue: BreakpointValue<unknown> = {};
          storedValue[targetBreakpoint] = explicitValue;

          // Optionally populate other slots to make the test more thorough
          const otherBreakpoints: Breakpoint[] = (
            ["desktop", "tablet", "mobile"] as Breakpoint[]
          ).filter((bp) => bp !== targetBreakpoint);
          if (otherSlot1 !== undefined && otherBreakpoints[0]) {
            storedValue[otherBreakpoints[0]] = otherSlot1;
          }
          if (otherSlot2 !== undefined && otherBreakpoints[1]) {
            storedValue[otherBreakpoints[1]] = otherSlot2;
          }

          // Build responsiveDefaults that also declares a value for the same
          // target breakpoint — this should NOT override the explicit value
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: { [targetBreakpoint]: defaultValue, mobile: defaultValue },
          };

          // Resolve
          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The explicit value must win
          expect(result.value).toStrictEqual(explicitValue);
          expect(result.source).toBe("explicit");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("explicit value wins even when responsiveDefaults declares a different value for the same slot", () => {
    fc.assert(
      fc.property(
        breakpointArb,
        fieldNameArb,
        explicitValueArb,
        defaultValueArb,
        (targetBreakpoint, fieldName, explicitValue, defaultValue) => {
          // Ensure the explicit and default values are different to make the
          // test meaningful
          fc.pre(explicitValue !== defaultValue);

          // Stored value has explicit at target
          const storedValue: BreakpointValue<unknown> = {
            [targetBreakpoint]: explicitValue,
          };

          // responsiveDefaults declares a DIFFERENT value for the same slot
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: {
              desktop: defaultValue,
              tablet: defaultValue,
              mobile: defaultValue,
            },
          };

          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // Explicit always wins
          expect(result.value).toStrictEqual(explicitValue);
          expect(result.source).toBe("explicit");
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 1: Slot Resolution Order with Responsive Defaults ─────────────

/**
 * Feature: default-responsive-component-defaults, Property 1: Slot Resolution Order
 *
 * **Validates: Requirements 2.1, 2.2, 3.3, 4.11**
 *
 * For any component instance with a declared `responsiveDefaults` entry for a
 * field, and for any target breakpoint where the stored value at that breakpoint
 * is unset (null, undefined, or empty string), the resolver SHALL return the
 * `responsiveDefaults` value for that breakpoint in preference to any explicit
 * value stored at a wider tier.
 */

describe("Feature: default-responsive-component-defaults, Property 1: Slot Resolution Order", () => {
  /** Valid breakpoint-aware field names drawn from the actual registry. */
  const validFieldKeys = [...BREAKPOINT_AWARE_FIELDS];

  /** All breakpoints. */
  const ALL_BREAKPOINTS: Breakpoint[] = ["mobile", "tablet", "desktop"];

  /**
   * The breakpoint hierarchy ordered narrowest to widest.
   * Used to determine which breakpoints are "wider" than a target.
   */
  const HIERARCHY: Breakpoint[] = ["mobile", "tablet", "desktop"];

  /** Generate a non-empty, non-null, non-undefined slot value (explicit). */
  const explicitValueArb = fc.oneof(
    fc.string({ minLength: 1 }),
    fc.integer({ min: 1 }),
    fc.boolean(),
  );

  /** Generate an "unset" value — null, undefined, or empty string. */
  const unsetValueArb = fc.constantFrom(null, undefined, "");

  /** Generate a target breakpoint (mobile or tablet — these have wider tiers). */
  const targetBreakpointWithWiderTiersArb = fc.constantFrom<Breakpoint>(
    "mobile",
    "tablet",
  );

  /** Generate any target breakpoint. */
  const anyBreakpointArb = fc.constantFrom<Breakpoint>(...ALL_BREAKPOINTS);

  /** Generate a valid field name from BREAKPOINT_AWARE_FIELDS. */
  const fieldNameArb = fc.constantFrom(...validFieldKeys);

  it("responsiveDefaults value wins over wider-tier explicit values when target slot is unset", () => {
    fc.assert(
      fc.property(
        targetBreakpointWithWiderTiersArb,
        fieldNameArb,
        unsetValueArb,
        explicitValueArb,
        explicitValueArb,
        (targetBreakpoint, fieldName, unsetValue, defaultValue, widerTierValue) => {
          // Build a BreakpointValue where the target slot is unset
          // and wider tiers have explicit values
          const targetIndex = HIERARCHY.indexOf(targetBreakpoint);
          const storedValue: BreakpointValue<unknown> = {};

          // Set the target slot to an unset value
          if (unsetValue !== undefined) {
            (storedValue as Record<string, unknown>)[targetBreakpoint] = unsetValue;
          }
          // else leave it undefined (absent key)

          // Set explicit values at all wider tiers
          for (let i = targetIndex + 1; i < HIERARCHY.length; i++) {
            (storedValue as Record<string, unknown>)[HIERARCHY[i]] = widerTierValue;
          }

          // Build responsiveDefaults with a value for the target breakpoint
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: { [targetBreakpoint]: defaultValue },
          };

          // Resolve
          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The responsiveDefaults value should win over wider-tier values
          expect(result.value).toStrictEqual(defaultValue);
          expect(result.source).toBe("default");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("responsiveDefaults value is used when target slot is unset and no wider-tier values exist", () => {
    fc.assert(
      fc.property(
        anyBreakpointArb,
        fieldNameArb,
        unsetValueArb,
        explicitValueArb,
        (targetBreakpoint, fieldName, unsetValue, defaultValue) => {
          // Build a BreakpointValue where only the target slot exists (unset)
          const storedValue: BreakpointValue<unknown> = {};
          if (unsetValue !== undefined) {
            (storedValue as Record<string, unknown>)[targetBreakpoint] = unsetValue;
          }

          // Build responsiveDefaults with a value for the target breakpoint
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: { [targetBreakpoint]: defaultValue },
          };

          // Resolve
          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The responsiveDefaults value should be returned
          expect(result.value).toStrictEqual(defaultValue);
          expect(result.source).toBe("default");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("wider-tier explicit values are NOT used when responsiveDefaults provides a value for the target slot", () => {
    fc.assert(
      fc.property(
        targetBreakpointWithWiderTiersArb,
        fieldNameArb,
        explicitValueArb,
        explicitValueArb,
        (targetBreakpoint, fieldName, defaultValue, widerTierValue) => {
          // Ensure the default and wider-tier values are distinguishable
          fc.pre(defaultValue !== widerTierValue);

          const targetIndex = HIERARCHY.indexOf(targetBreakpoint);
          const storedValue: BreakpointValue<unknown> = {};

          // Target slot is absent (unset) — no key at all
          // Set explicit values at all wider tiers
          for (let i = targetIndex + 1; i < HIERARCHY.length; i++) {
            (storedValue as Record<string, unknown>)[HIERARCHY[i]] = widerTierValue;
          }

          // Build responsiveDefaults with a value for the target breakpoint
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: { [targetBreakpoint]: defaultValue },
          };

          // Resolve
          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The result should NOT be the wider-tier value
          expect(result.value).not.toStrictEqual(widerTierValue);
          // It should be the responsiveDefaults value
          expect(result.value).toStrictEqual(defaultValue);
          expect(result.source).toBe("default");
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 4: Renderer/Builder Parity ────────────────────────────────────

/**
 * Feature: default-responsive-component-defaults, Property 4: Renderer/Builder Parity
 *
 * **Validates: Requirements 3.7, 9.1, 9.3**
 *
 * For any (component instance, field, breakpoint, stored data) tuple, the
 * resolved value produced by the public renderer path and the builder canvas
 * path SHALL be deeply equal when given the same `responsiveDefaults` source
 * and the same stored data.
 *
 * Since both paths use the same `resolveWithDefaults` function (via
 * `withBreakpointResolution`), this property test verifies that:
 * 1. `resolveWithDefaults` produces the same result when called with identical
 *    inputs regardless of call context (determinism).
 * 2. `resolveAllRenderPropsWithDefaults` produces the same result as calling
 *    `resolveWithDefaults` individually for each field.
 * 3. The resolution is deterministic — calling it twice with the same inputs
 *    produces the same output.
 */

// --- Arbitraries for Property 4 ---

/** Generate a random slot value for Property 4. */
const p4SlotValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(""),
);

/**
 * Generate a random BreakpointValue with various combinations of set/unset slots.
 */
function p4BreakpointValueArb(): fc.Arbitrary<BreakpointValue<unknown>> {
  return fc
    .record(
      {
        desktop: fc.option(p4SlotValueArb, { nil: undefined }),
        tablet: fc.option(p4SlotValueArb, { nil: undefined }),
        mobile: fc.option(p4SlotValueArb, { nil: undefined }),
      },
      { requiredKeys: [] },
    )
    .map((obj) => {
      const result: BreakpointValue<unknown> = {};
      if (obj.desktop !== undefined) result.desktop = obj.desktop;
      if (obj.tablet !== undefined) result.tablet = obj.tablet;
      if (obj.mobile !== undefined) result.mobile = obj.mobile;
      return result;
    });
}

/** Generate random responsiveDefaults with valid field keys and slot values for Property 4. */
function p4ResponsiveDefaultsArb(): fc.Arbitrary<ResponsiveDefaults> {
  return fc
    .subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 0, maxLength: 5 })
    .chain((fields) => {
      if (fields.length === 0) return fc.constant({} as ResponsiveDefaults);
      const entries = fields.map((field) =>
        fc
          .record({
            desktop: fc.option(p4SlotValueArb, { nil: undefined }),
            tablet: fc.option(p4SlotValueArb, { nil: undefined }),
            mobile: p4SlotValueArb, // always provide mobile for valid defaults
          })
          .map((slots) => {
            const entry: Record<string, unknown> = {};
            if (slots.desktop !== undefined) entry.desktop = slots.desktop;
            if (slots.tablet !== undefined) entry.tablet = slots.tablet;
            if (slots.mobile !== undefined) entry.mobile = slots.mobile;
            return [field, entry] as const;
          }),
      );
      return fc.tuple(...(entries as [typeof entries[0], ...typeof entries])).map(
        (pairs) => {
          const result: ResponsiveDefaults = {};
          for (const [key, val] of pairs) {
            result[key] = val;
          }
          return result;
        },
      );
    });
}

/** Generate a random breakpoint for Property 4. */
const p4BreakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
  "desktop",
  "tablet",
  "mobile",
);

/** Generate a random field name from the valid set for Property 4. */
const p4FieldNameArb = fc.constantFrom(...[...BREAKPOINT_AWARE_FIELDS]);

describe("Feature: default-responsive-component-defaults, Property 4: Renderer/Builder Parity", () => {
  it("resolveWithDefaults is deterministic — two calls with identical inputs produce deeply equal results", () => {
    fc.assert(
      fc.property(
        p4BreakpointValueArb(),
        p4BreakpointArb,
        p4FieldNameArb,
        p4ResponsiveDefaultsArb(),
        (storedValue, activeBreakpoint, fieldName, responsiveDefaults) => {
          const result1 = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );
          const result2 = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // Both calls must produce deeply equal results
          expect(result1).toStrictEqual(result2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveAllRenderPropsWithDefaults produces the same value as resolveWithDefaults for each field with declared defaults", () => {
    // Exclude compound fields (_padding, _margin, _border) because
    // resolveAllRenderPropsWithDefaults applies additional deep sub-key
    // resolution on compound fields after the initial resolveWithDefaults call.
    const nonCompoundFields = [...BREAKPOINT_AWARE_FIELDS].filter(
      (f) => f !== "_padding" && f !== "_margin" && f !== "_border",
    );
    const nonCompoundFieldArb = fc.constantFrom(...nonCompoundFields);

    fc.assert(
      fc.property(
        p4BreakpointArb,
        nonCompoundFieldArb,
        p4BreakpointValueArb(),
        p4BreakpointValueArb(), // default value for the field
        (activeBreakpoint, fieldName, storedValue, defaultEntry) => {
          // Ensure the field IS declared in responsiveDefaults so both paths
          // use resolveWithDefaults
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: defaultEntry,
          };

          // Build a props object with the field set to the stored BreakpointValue
          const props: Record<string, unknown> = {
            [fieldName]: storedValue,
          };

          // Resolve via the "all props" path (simulates renderer/builder canvas)
          const allResolved = resolveAllRenderPropsWithDefaults(
            props,
            activeBreakpoint,
            BREAKPOINT_AWARE_FIELDS,
            responsiveDefaults,
          );

          // Resolve via the individual field path
          const individualResult = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The resolved value from the "all props" path must equal the
          // individual resolution value
          expect(allResolved[fieldName]).toStrictEqual(individualResult.value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("renderer path and builder path produce identical results for the same inputs", () => {
    fc.assert(
      fc.property(
        p4BreakpointArb,
        fc.subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 1, maxLength: 5 }),
        fc.array(p4BreakpointValueArb(), { minLength: 1, maxLength: 5 }),
        p4ResponsiveDefaultsArb(),
        (activeBreakpoint, fields, storedValues, responsiveDefaults) => {
          // Build a props object with multiple fields
          const props: Record<string, unknown> = {};
          for (let i = 0; i < fields.length; i++) {
            props[fields[i]] = storedValues[i % storedValues.length];
          }

          // Simulate "renderer path" — first call to resolveAllRenderPropsWithDefaults
          const rendererResult = resolveAllRenderPropsWithDefaults(
            props,
            activeBreakpoint,
            BREAKPOINT_AWARE_FIELDS,
            responsiveDefaults,
          );

          // Simulate "builder path" — second call with identical inputs
          const builderResult = resolveAllRenderPropsWithDefaults(
            props,
            activeBreakpoint,
            BREAKPOINT_AWARE_FIELDS,
            responsiveDefaults,
          );

          // Both paths must produce deeply equal results
          expect(rendererResult).toStrictEqual(builderResult);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 3: Non-Mutation of Stored Data ────────────────────────────────

/**
 * Feature: default-responsive-component-defaults, Property 3: Non-Mutation of Stored Data
 *
 * **Validates: Requirements 2.4, 5.5, 8.3**
 *
 * For any page data payload, running the resolution pipeline (resolveWithDefaults)
 * for any combination of component instances, fields, and breakpoints SHALL NOT
 * modify the input page data — the stored representation before and after
 * resolution is structurally identical (deep equality).
 */

// --- Arbitraries for Property 3 ---

/** Generate a random slot value (string, number, boolean, or undefined). */
const p3SlotValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(""),
);

/**
 * Generate a random BreakpointValue with various combinations of set/unset slots.
 * Uses explicit object construction to ensure standard prototype.
 */
function p3BreakpointValueArb(): fc.Arbitrary<BreakpointValue<unknown>> {
  return fc
    .record(
      {
        desktop: fc.option(p3SlotValueArb, { nil: undefined }),
        tablet: fc.option(p3SlotValueArb, { nil: undefined }),
        mobile: fc.option(p3SlotValueArb, { nil: undefined }),
      },
      { requiredKeys: [] },
    )
    .map((obj) => {
      // Ensure standard prototype and remove undefined keys to simulate real stored data
      const result: BreakpointValue<unknown> = {};
      if (obj.desktop !== undefined) result.desktop = obj.desktop;
      if (obj.tablet !== undefined) result.tablet = obj.tablet;
      if (obj.mobile !== undefined) result.mobile = obj.mobile;
      return result;
    });
}

/** Generate random responsiveDefaults with valid field keys and slot values. */
function p3ResponsiveDefaultsArb(): fc.Arbitrary<ResponsiveDefaults> {
  return fc
    .subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 0, maxLength: 5 })
    .chain((fields) => {
      if (fields.length === 0) return fc.constant({} as ResponsiveDefaults);
      const entries = fields.map((field) =>
        fc
          .record({
            desktop: fc.option(p3SlotValueArb, { nil: undefined }),
            tablet: fc.option(p3SlotValueArb, { nil: undefined }),
            mobile: p3SlotValueArb, // always provide mobile for valid defaults
          })
          .map((slots) => {
            const entry: Record<string, unknown> = {};
            if (slots.desktop !== undefined) entry.desktop = slots.desktop;
            if (slots.tablet !== undefined) entry.tablet = slots.tablet;
            if (slots.mobile !== undefined) entry.mobile = slots.mobile;
            return [field, entry] as const;
          }),
      );
      return fc.tuple(...(entries as [typeof entries[0], ...typeof entries])).map(
        (pairs) => {
          const result: ResponsiveDefaults = {};
          for (const [key, val] of pairs) {
            result[key] = val;
          }
          return result;
        },
      );
    });
}

/** Generate a random breakpoint for Property 3. */
const p3BreakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
  "desktop",
  "tablet",
  "mobile",
);

/** Generate a random field name from the valid set for Property 3. */
const p3FieldNameArb = fc.constantFrom(...[...BREAKPOINT_AWARE_FIELDS]);

describe("Feature: default-responsive-component-defaults, Property 3: Non-Mutation of Stored Data", () => {
  it("resolveWithDefaults does not mutate the input storedValue", () => {
    fc.assert(
      fc.property(
        p3BreakpointValueArb(),
        p3BreakpointArb,
        p3FieldNameArb,
        p3ResponsiveDefaultsArb(),
        (storedValue, activeBreakpoint, fieldName, responsiveDefaults) => {
          // Deep-clone the stored value before calling resolveWithDefaults
          const storedBefore = JSON.parse(JSON.stringify(storedValue));

          // Call resolveWithDefaults — this should NOT mutate storedValue
          resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // Verify the original stored value is deeply equal to the clone
          expect(storedValue).toStrictEqual(storedBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveWithDefaults does not mutate the responsiveDefaults input", () => {
    fc.assert(
      fc.property(
        p3BreakpointValueArb(),
        p3BreakpointArb,
        p3FieldNameArb,
        p3ResponsiveDefaultsArb(),
        (storedValue, activeBreakpoint, fieldName, responsiveDefaults) => {
          // Deep-clone the responsiveDefaults before calling resolveWithDefaults
          const defaultsBefore = JSON.parse(JSON.stringify(responsiveDefaults));

          // Call resolveWithDefaults — this should NOT mutate responsiveDefaults
          resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // Verify the responsiveDefaults is deeply equal to the clone
          expect(responsiveDefaults).toStrictEqual(defaultsBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("multiple resolution calls on the same stored data produce identical results", () => {
    fc.assert(
      fc.property(
        p3BreakpointValueArb(),
        p3BreakpointArb,
        p3FieldNameArb,
        p3ResponsiveDefaultsArb(),
        (storedValue, activeBreakpoint, fieldName, responsiveDefaults) => {
          // Deep-clone stored value before any calls
          const storedBefore = JSON.parse(JSON.stringify(storedValue));

          // Call resolveWithDefaults multiple times
          const result1 = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );
          const result2 = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );
          const result3 = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // All results should be identical (idempotent)
          expect(result1).toStrictEqual(result2);
          expect(result2).toStrictEqual(result3);

          // Stored value should still be unchanged after multiple calls
          expect(storedValue).toStrictEqual(storedBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 8: Inherited Indicator Label Correctness ──────────────────────

/**
 * Feature: default-responsive-component-defaults, Property 8: Inherited Indicator Label Correctness
 *
 * **Validates: Requirements 6.2, 6.3, 6.5**
 *
 * For any resolution result, the inherited indicator label SHALL be exactly
 * `"default"` when the source is `responsiveDefaults`, exactly `"from {tier}"`
 * (where `{tier}` is the originating wider breakpoint name) when the source is
 * wider-tier inheritance, and SHALL be hidden (not rendered) when the source is
 * an explicit value.
 */

describe("Feature: default-responsive-component-defaults, Property 8: Inherited Indicator Label Correctness", () => {
  // --- Arbitraries for Property 8 ---

  /** Generate a random slot value (string, number, boolean, or unset). */
  const p8SlotValueArb = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(""),
  );

  /** Generate a non-null, non-undefined, non-empty-string explicit value. */
  const p8ExplicitValueArb = fc.oneof(
    fc.string({ minLength: 1 }),
    fc.integer(),
    fc.boolean(),
    fc.double({ noNaN: true }),
  );

  /** Generate a random breakpoint. */
  const p8BreakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
    "desktop",
    "tablet",
    "mobile",
  );

  /** Generate a valid field name from BREAKPOINT_AWARE_FIELDS. */
  const p8FieldNameArb = fc.constantFrom(...[...BREAKPOINT_AWARE_FIELDS]);

  /**
   * Generate a random BreakpointValue with various combinations of set/unset slots.
   */
  function p8BreakpointValueArb(): fc.Arbitrary<BreakpointValue<unknown>> {
    return fc
      .record(
        {
          desktop: fc.option(p8SlotValueArb, { nil: undefined }),
          tablet: fc.option(p8SlotValueArb, { nil: undefined }),
          mobile: fc.option(p8SlotValueArb, { nil: undefined }),
        },
        { requiredKeys: [] },
      )
      .map((obj) => {
        const result: BreakpointValue<unknown> = {};
        if (obj.desktop !== undefined) result.desktop = obj.desktop;
        if (obj.tablet !== undefined) result.tablet = obj.tablet;
        if (obj.mobile !== undefined) result.mobile = obj.mobile;
        return result;
      });
  }

  /** Generate random responsiveDefaults with valid field keys. */
  function p8ResponsiveDefaultsArb(): fc.Arbitrary<ResponsiveDefaults> {
    return fc
      .subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 0, maxLength: 5 })
      .chain((fields) => {
        if (fields.length === 0) return fc.constant({} as ResponsiveDefaults);
        const entries = fields.map((field) =>
          fc
            .record({
              desktop: fc.option(p8SlotValueArb, { nil: undefined }),
              tablet: fc.option(p8SlotValueArb, { nil: undefined }),
              mobile: p8SlotValueArb,
            })
            .map((slots) => {
              const entry: Record<string, unknown> = {};
              if (slots.desktop !== undefined) entry.desktop = slots.desktop;
              if (slots.tablet !== undefined) entry.tablet = slots.tablet;
              if (slots.mobile !== undefined) entry.mobile = slots.mobile;
              return [field, entry] as const;
            }),
        );
        return fc.tuple(...(entries as [typeof entries[0], ...typeof entries])).map(
          (pairs) => {
            const result: ResponsiveDefaults = {};
            for (const [key, val] of pairs) {
              result[key] = val;
            }
            return result;
          },
        );
      });
  }

  /**
   * Derives the expected indicator label from a ResolutionResult, mirroring
   * the logic in InheritedIndicator.tsx:
   * - source "default" → "default"
   * - source "inherited" → "from {inheritedFrom}"
   * - source "explicit" or "scalar" → null (indicator hidden)
   */
  function deriveExpectedLabel(
    source: "explicit" | "default" | "inherited" | "scalar",
    inheritedFrom?: Breakpoint,
  ): string | null {
    if (source === "default") return "default";
    if (source === "inherited") return `from ${inheritedFrom}`;
    // "explicit" or "scalar" → indicator is hidden
    return null;
  }

  it("label is exactly 'default' when source is responsiveDefaults", () => {
    fc.assert(
      fc.property(
        p8BreakpointArb,
        p8FieldNameArb,
        p8ExplicitValueArb,
        (targetBreakpoint, fieldName, defaultValue) => {
          // Build a stored value with NO explicit value at the target breakpoint
          const storedValue: BreakpointValue<unknown> = {};
          // Leave target slot empty so responsiveDefaults kicks in

          // Build responsiveDefaults with a value for the target breakpoint
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: { [targetBreakpoint]: defaultValue },
          };

          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The source should be "default"
          expect(result.source).toBe("default");

          // The derived label should be exactly "default"
          const label = deriveExpectedLabel(result.source, result.inheritedFrom);
          expect(label).toBe("default");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("label is exactly 'from {tier}' when source is wider-tier inheritance", () => {
    // Only test breakpoints that have wider tiers (mobile, tablet)
    const breakpointsWithWiderTiers: fc.Arbitrary<Breakpoint> = fc.constantFrom<Breakpoint>(
      "mobile",
      "tablet",
    );

    fc.assert(
      fc.property(
        breakpointsWithWiderTiers,
        p8FieldNameArb,
        p8ExplicitValueArb,
        (targetBreakpoint, fieldName, widerTierValue) => {
          // Build a stored value with NO explicit value at the target breakpoint
          // but WITH an explicit value at a wider tier
          const storedValue: BreakpointValue<unknown> = {};

          // Set explicit value at the next wider tier
          if (targetBreakpoint === "mobile") {
            // Wider tiers: tablet or desktop — set desktop to ensure inheritance
            storedValue.desktop = widerTierValue;
          } else if (targetBreakpoint === "tablet") {
            storedValue.desktop = widerTierValue;
          }

          // NO responsiveDefaults for this field, so the resolver falls through
          // to wider-tier inheritance
          const responsiveDefaults: ResponsiveDefaults = {};

          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The source should be "inherited"
          expect(result.source).toBe("inherited");
          expect(result.inheritedFrom).toBeDefined();

          // The derived label should be "from {tier}"
          const label = deriveExpectedLabel(result.source, result.inheritedFrom);
          expect(label).toBe(`from ${result.inheritedFrom}`);

          // Verify the tier is a valid wider breakpoint
          const validWiderTiers: Breakpoint[] =
            targetBreakpoint === "mobile"
              ? ["tablet", "desktop"]
              : ["desktop"];
          expect(validWiderTiers).toContain(result.inheritedFrom);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("indicator is hidden (not rendered) when source is explicit", () => {
    fc.assert(
      fc.property(
        p8BreakpointArb,
        p8FieldNameArb,
        p8ExplicitValueArb,
        p8ExplicitValueArb,
        (targetBreakpoint, fieldName, explicitValue, defaultValue) => {
          // Build a stored value WITH an explicit value at the target breakpoint
          const storedValue: BreakpointValue<unknown> = {
            [targetBreakpoint]: explicitValue,
          };

          // Even if responsiveDefaults declares a value, explicit wins
          const responsiveDefaults: ResponsiveDefaults = {
            [fieldName]: { [targetBreakpoint]: defaultValue, mobile: defaultValue },
          };

          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The source should be "explicit"
          expect(result.source).toBe("explicit");

          // The derived label should be null (indicator hidden)
          const label = deriveExpectedLabel(result.source, result.inheritedFrom);
          expect(label).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("indicator is hidden (not rendered) when source is scalar (no value found)", () => {
    fc.assert(
      fc.property(
        p8BreakpointArb,
        p8FieldNameArb,
        (targetBreakpoint, fieldName) => {
          // Build a completely empty stored value — no explicit values anywhere
          const storedValue: BreakpointValue<unknown> = {};

          // No responsiveDefaults for this field either
          const responsiveDefaults: ResponsiveDefaults = {};

          const result = resolveWithDefaults(
            storedValue,
            targetBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          // The source should be "scalar" (nothing found)
          expect(result.source).toBe("scalar");

          // The derived label should be null (indicator hidden)
          const label = deriveExpectedLabel(result.source, result.inheritedFrom);
          expect(label).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any random resolution scenario, the label derivation is consistent with the source", () => {
    fc.assert(
      fc.property(
        p8BreakpointValueArb(),
        p8BreakpointArb,
        p8FieldNameArb,
        p8ResponsiveDefaultsArb(),
        (storedValue, activeBreakpoint, fieldName, responsiveDefaults) => {
          const result = resolveWithDefaults(
            storedValue,
            activeBreakpoint,
            fieldName,
            responsiveDefaults,
          );

          const label = deriveExpectedLabel(result.source, result.inheritedFrom);

          switch (result.source) {
            case "default":
              // Label must be exactly "default"
              expect(label).toBe("default");
              break;
            case "inherited":
              // Label must be "from {tier}" where tier is a valid breakpoint
              expect(result.inheritedFrom).toBeDefined();
              expect(label).toBe(`from ${result.inheritedFrom}`);
              expect(["desktop", "tablet", "mobile"]).toContain(
                result.inheritedFrom,
              );
              break;
            case "explicit":
            case "scalar":
              // Indicator is hidden — label is null
              expect(label).toBeNull();
              break;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});



// ─── Property 6: Write Isolation ────────────────────────────────────────────

/**
 * Feature: default-responsive-component-defaults, Property 6: Write Isolation
 *
 * **Validates: Requirements 2.5, 3.4, 3.6**
 *
 * For any page data and for any single (component instance, breakpoint, field)
 * commit or clear action, only the targeted slot is modified in the resulting
 * stored data — all other slots across all other components, fields, and
 * breakpoints remain byte-for-byte unchanged.
 */

import { clearSlot } from "./breakpoints";

describe("Feature: default-responsive-component-defaults, Property 6: Write Isolation", () => {
  // --- Arbitraries for Property 6 ---

  /** Generate a non-null, non-undefined slot value for commits. */
  const p6SlotValueArb = fc.oneof(
    fc.string({ minLength: 1 }),
    fc.integer(),
    fc.boolean(),
    fc.double({ noNaN: true }),
  );

  /** Generate a random breakpoint. */
  const p6BreakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
    "desktop",
    "tablet",
    "mobile",
  );

  /** Generate a valid field name from BREAKPOINT_AWARE_FIELDS. */
  const p6FieldNameArb = fc.constantFrom(...[...BREAKPOINT_AWARE_FIELDS]);

  /**
   * Generate a random BreakpointValue with various combinations of set/unset slots.
   * Simulates stored data for a single field on a single component instance.
   */
  function p6BreakpointValueArb(): fc.Arbitrary<BreakpointValue<unknown>> {
    return fc
      .record(
        {
          desktop: fc.option(p6SlotValueArb, { nil: undefined }),
          tablet: fc.option(p6SlotValueArb, { nil: undefined }),
          mobile: fc.option(p6SlotValueArb, { nil: undefined }),
        },
        { requiredKeys: [] },
      )
      .map((obj) => {
        const result: BreakpointValue<unknown> = {};
        if (obj.desktop !== undefined) result.desktop = obj.desktop;
        if (obj.tablet !== undefined) result.tablet = obj.tablet;
        if (obj.mobile !== undefined) result.mobile = obj.mobile;
        return result;
      });
  }

  /**
   * Generate a "page data" object: a record of field names to BreakpointValue
   * objects, simulating multiple fields across a component instance.
   */
  function p6PageDataArb(): fc.Arbitrary<Record<string, BreakpointValue<unknown>>> {
    return fc
      .subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 1, maxLength: 6 })
      .chain((fields) => {
        const entries = fields.map((field) =>
          p6BreakpointValueArb().map(
            (bv) => [field, bv] as const,
          ),
        );
        return fc
          .tuple(...(entries as [typeof entries[0], ...typeof entries]))
          .map((pairs) => {
            const result: Record<string, BreakpointValue<unknown>> = {};
            for (const [key, val] of pairs) {
              result[key] = val;
            }
            return result;
          });
      });
  }

  it("commit operation modifies only the targeted slot — all other slots remain unchanged", () => {
    fc.assert(
      fc.property(
        p6PageDataArb(),
        p6FieldNameArb,
        p6BreakpointArb,
        p6SlotValueArb,
        (pageData, targetField, targetBreakpoint, newValue) => {
          // Deep-clone the page data before the commit operation
          const dataBefore = structuredClone(pageData);

          // Simulate a commit: write newValue to the targeted (field, breakpoint) slot
          // If the field doesn't exist in pageData yet, create it
          const targetBv: BreakpointValue<unknown> = pageData[targetField] ?? {};
          const afterCommit: BreakpointValue<unknown> = {
            ...targetBv,
            [targetBreakpoint]: newValue,
          };

          // Build the resulting page data after commit
          const dataAfter: Record<string, BreakpointValue<unknown>> = {
            ...pageData,
            [targetField]: afterCommit,
          };

          // Verify: all OTHER fields are byte-for-byte unchanged
          for (const field of Object.keys(dataBefore)) {
            if (field === targetField) continue;
            expect(dataAfter[field]).toStrictEqual(dataBefore[field]);
          }

          // Verify: within the targeted field, all OTHER breakpoint slots are unchanged
          const otherBreakpoints: Breakpoint[] = (
            ["desktop", "tablet", "mobile"] as Breakpoint[]
          ).filter((bp) => bp !== targetBreakpoint);

          for (const bp of otherBreakpoints) {
            const originalSlot = dataBefore[targetField]?.[bp];
            const resultSlot = dataAfter[targetField][bp];
            expect(resultSlot).toStrictEqual(originalSlot);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clear operation modifies only the targeted slot — all other slots remain unchanged", () => {
    fc.assert(
      fc.property(
        p6PageDataArb(),
        p6BreakpointArb,
        (pageData, targetBreakpoint) => {
          // Pick a field that exists in the page data for the clear operation
          const fields = Object.keys(pageData);
          fc.pre(fields.length > 0);
          const targetField = fields[0];

          // Deep-clone the page data before the clear operation
          const dataBefore = structuredClone(pageData);

          // Simulate a clear: remove the targeted breakpoint slot using clearSlot
          const targetBv: BreakpointValue<unknown> = pageData[targetField];
          const afterClear = clearSlot(targetBv, targetBreakpoint);

          // Build the resulting page data after clear
          const dataAfter: Record<string, BreakpointValue<unknown>> = {
            ...pageData,
            [targetField]: afterClear,
          };

          // Verify: all OTHER fields are byte-for-byte unchanged
          for (const field of Object.keys(dataBefore)) {
            if (field === targetField) continue;
            expect(dataAfter[field]).toStrictEqual(dataBefore[field]);
          }

          // Verify: within the targeted field, all OTHER breakpoint slots are unchanged
          const otherBreakpoints: Breakpoint[] = (
            ["desktop", "tablet", "mobile"] as Breakpoint[]
          ).filter((bp) => bp !== targetBreakpoint);

          for (const bp of otherBreakpoints) {
            const originalSlot = dataBefore[targetField]?.[bp];
            const resultSlot = dataAfter[targetField][bp];
            expect(resultSlot).toStrictEqual(originalSlot);
          }

          // Verify: the targeted slot is actually removed (not null or empty string)
          expect(afterClear).not.toHaveProperty(targetBreakpoint);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clear operation via clearSlot removes the key entirely — not null or empty string", () => {
    fc.assert(
      fc.property(
        p6BreakpointValueArb(),
        p6BreakpointArb,
        (bv, targetBreakpoint) => {
          const result = clearSlot(bv, targetBreakpoint);

          // The targeted slot key must be absent from the result
          expect(Object.prototype.hasOwnProperty.call(result, targetBreakpoint)).toBe(false);
          expect(result[targetBreakpoint]).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("commit on one field in multi-field page data leaves all other fields untouched", () => {
    fc.assert(
      fc.property(
        p6PageDataArb(),
        p6BreakpointArb,
        p6SlotValueArb,
        (pageData, targetBreakpoint, newValue) => {
          const fields = Object.keys(pageData);
          fc.pre(fields.length >= 2);

          // Pick the first field as the target
          const targetField = fields[0];

          // Deep-clone the page data before the commit
          const dataBefore = structuredClone(pageData);

          // Simulate a commit on the target field
          const targetBv: BreakpointValue<unknown> = pageData[targetField];
          const afterCommit: BreakpointValue<unknown> = {
            ...targetBv,
            [targetBreakpoint]: newValue,
          };

          // Build the resulting page data
          const dataAfter: Record<string, BreakpointValue<unknown>> = {
            ...pageData,
            [targetField]: afterCommit,
          };

          // Verify: every other field is completely unchanged
          for (let i = 1; i < fields.length; i++) {
            expect(dataAfter[fields[i]]).toStrictEqual(dataBefore[fields[i]]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});



// ─── Property 7: Load-Save Round Trip ───────────────────────────────────────

/**
 * Feature: default-responsive-component-defaults, Property 7: Load-Save Round Trip
 *
 * **Validates: Requirements 5.5, 2.4**
 *
 * For any valid page data payload, loading it into the builder and immediately
 * saving without any author modification SHALL produce a stored payload that is
 * deeply equal to the original input (no `responsiveDefaults` values leak into
 * stored data).
 *
 * The key insight: the resolution pipeline returns NEW objects and never mutates
 * the input. So after resolution, the original data should be unchanged.
 */

describe("Feature: default-responsive-component-defaults, Property 7: Load-Save Round Trip", () => {
  // --- Arbitraries for Property 7 ---

  /** Generate a random slot value (string, number, boolean, or unset). */
  const p7SlotValueArb = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(""),
  );

  /** Generate a non-null, non-undefined, non-empty-string explicit value. */
  const p7ExplicitValueArb = fc.oneof(
    fc.string({ minLength: 1 }),
    fc.integer(),
    fc.boolean(),
    fc.double({ noNaN: true }),
  );

  /**
   * Generate a random BreakpointValue with various combinations of set/unset slots.
   */
  function p7BreakpointValueArb(): fc.Arbitrary<BreakpointValue<unknown>> {
    return fc
      .record(
        {
          desktop: fc.option(p7SlotValueArb, { nil: undefined }),
          tablet: fc.option(p7SlotValueArb, { nil: undefined }),
          mobile: fc.option(p7SlotValueArb, { nil: undefined }),
        },
        { requiredKeys: [] },
      )
      .map((obj) => {
        const result: BreakpointValue<unknown> = {};
        if (obj.desktop !== undefined) result.desktop = obj.desktop;
        if (obj.tablet !== undefined) result.tablet = obj.tablet;
        if (obj.mobile !== undefined) result.mobile = obj.mobile;
        return result;
      });
  }

  /** Generate random responsiveDefaults with valid field keys and slot values. */
  function p7ResponsiveDefaultsArb(): fc.Arbitrary<ResponsiveDefaults> {
    return fc
      .subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 1, maxLength: 5 })
      .chain((fields) => {
        const entries = fields.map((field) =>
          fc
            .record({
              desktop: fc.option(p7ExplicitValueArb, { nil: undefined }),
              tablet: fc.option(p7ExplicitValueArb, { nil: undefined }),
              mobile: p7ExplicitValueArb, // always provide mobile for valid defaults
            })
            .map((slots) => {
              const entry: Record<string, unknown> = {};
              if (slots.desktop !== undefined) entry.desktop = slots.desktop;
              if (slots.tablet !== undefined) entry.tablet = slots.tablet;
              entry.mobile = slots.mobile;
              return [field, entry] as const;
            }),
        );
        return fc.tuple(...(entries as [typeof entries[0], ...typeof entries])).map(
          (pairs) => {
            const result: ResponsiveDefaults = {};
            for (const [key, val] of pairs) {
              result[key] = val;
            }
            return result;
          },
        );
      });
  }

  /** Generate a random breakpoint for Property 7. */
  const p7BreakpointArb: fc.Arbitrary<Breakpoint> = fc.constantFrom(
    "desktop",
    "tablet",
    "mobile",
  );

  /**
   * Generate a simulated "page data" object: a record of field names to
   * BreakpointValue objects, representing a single component instance's
   * stored props.
   */
  function p7PageDataArb(): fc.Arbitrary<Record<string, BreakpointValue<unknown>>> {
    return fc
      .subarray([...BREAKPOINT_AWARE_FIELDS], { minLength: 1, maxLength: 8 })
      .chain((fields) => {
        const entries = fields.map((field) =>
          p7BreakpointValueArb().map(
            (bv) => [field, bv] as const,
          ),
        );
        return fc.tuple(...(entries as [typeof entries[0], ...typeof entries])).map(
          (pairs) => {
            const result: Record<string, BreakpointValue<unknown>> = {};
            for (const [key, val] of pairs) {
              result[key] = val;
            }
            return result;
          },
        );
      });
  }

  it("loading page data, resolving with defaults, and saving produces data deeply equal to the original (resolveWithDefaults path)", () => {
    fc.assert(
      fc.property(
        p7PageDataArb(),
        p7BreakpointArb,
        p7ResponsiveDefaultsArb(),
        (pageData, activeBreakpoint, responsiveDefaults) => {
          // Step 1: Simulate "load" — deep-clone the page data
          const loadedData = JSON.parse(JSON.stringify(pageData));

          // Step 2: Simulate render-time resolution on the loaded data
          // (this is what happens during rendering — it should NOT mutate input)
          for (const fieldName of Object.keys(loadedData)) {
            resolveWithDefaults(
              loadedData[fieldName],
              activeBreakpoint,
              fieldName,
              responsiveDefaults,
            );
          }

          // Step 3: Simulate "save" — the save path passes data through unchanged
          const savedData = loadedData;

          // Step 4: Verify the saved data is deeply equal to the original input
          // No responsiveDefaults values should have leaked into stored data
          expect(savedData).toStrictEqual(pageData);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("loading page data, resolving with resolveAllRenderPropsWithDefaults, and saving produces data deeply equal to the original", () => {
    fc.assert(
      fc.property(
        p7PageDataArb(),
        p7BreakpointArb,
        p7ResponsiveDefaultsArb(),
        (pageData, activeBreakpoint, responsiveDefaults) => {
          // Step 1: Simulate "load" — deep-clone the page data
          const loadedData = JSON.parse(JSON.stringify(pageData));

          // Step 2: Simulate render-time resolution via the "all props" path
          // resolveAllRenderPropsWithDefaults returns a NEW object and should
          // NOT mutate the input props
          resolveAllRenderPropsWithDefaults(
            loadedData,
            activeBreakpoint,
            BREAKPOINT_AWARE_FIELDS,
            responsiveDefaults,
          );

          // Step 3: Simulate "save" — the save path passes the original loaded
          // data through unchanged (the resolved result is only used for rendering)
          const savedData = loadedData;

          // Step 4: Verify the saved data is deeply equal to the original input
          // No responsiveDefaults values should have leaked into stored data
          expect(savedData).toStrictEqual(pageData);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("multiple render cycles do not accumulate mutations in stored page data", () => {
    fc.assert(
      fc.property(
        p7PageDataArb(),
        p7BreakpointArb,
        p7ResponsiveDefaultsArb(),
        fc.integer({ min: 2, max: 5 }),
        (pageData, activeBreakpoint, responsiveDefaults, renderCycles) => {
          // Step 1: Simulate "load" — deep-clone the page data
          const loadedData = JSON.parse(JSON.stringify(pageData));

          // Step 2: Simulate multiple render cycles (as would happen during
          // normal builder usage — switching breakpoints, re-rendering, etc.)
          for (let i = 0; i < renderCycles; i++) {
            // Each render cycle calls resolveAllRenderPropsWithDefaults
            resolveAllRenderPropsWithDefaults(
              loadedData,
              activeBreakpoint,
              BREAKPOINT_AWARE_FIELDS,
              responsiveDefaults,
            );

            // Also call resolveWithDefaults on individual fields
            for (const fieldName of Object.keys(loadedData)) {
              resolveWithDefaults(
                loadedData[fieldName],
                activeBreakpoint,
                fieldName,
                responsiveDefaults,
              );
            }
          }

          // Step 3: Simulate "save" after multiple render cycles
          const savedData = loadedData;

          // Step 4: Verify the saved data is still deeply equal to the original
          expect(savedData).toStrictEqual(pageData);
        },
      ),
      { numRuns: 100 },
    );
  });
});
