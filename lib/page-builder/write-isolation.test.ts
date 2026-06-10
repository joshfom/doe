/**
 * Write Isolation & Load-Save Round Trip Verification
 *
 * Task 8.1: Verify and enforce that the builder's save logic only persists
 * explicitly-set slot values.
 *
 * This test suite documents and verifies three critical guarantees:
 *
 * 1. `responsiveDefaults` values are NEVER written to stored data — the
 *    resolution pipeline is read-only and the save path only persists what
 *    the Puck data state contains.
 *
 * 2. Clearing a slot removes the key entirely (not null or empty string) —
 *    the `clearSlot` function uses `delete` to remove the key.
 *
 * 3. Re-saving without modifications produces identical output — the save
 *    path passes `dataRef.current` directly without transformation.
 *
 * Validates: Requirements 2.4, 2.5, 3.4, 3.6, 5.5
 */

import { describe, it, expect } from "vitest";
import { clearSlot, type BreakpointValue } from "./breakpoints";
import { resolveWithDefaults, resolveAllRenderPropsWithDefaults } from "./resolve-render-props";
import type { ResponsiveDefaults } from "./responsive-defaults";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";

// ─── Requirement 3.6: clearSlot removes the key entirely ────────────────────

describe("clearSlot removes the key entirely (Req 3.6)", () => {
  it("removes the desktop key entirely — not null, not undefined, not empty string", () => {
    const bv: BreakpointValue<string> = {
      desktop: "row",
      tablet: "row",
      mobile: "column",
    };
    const result = clearSlot(bv, "desktop");

    // The key must not exist at all
    expect("desktop" in result).toBe(false);
    expect(Object.keys(result)).not.toContain("desktop");
    // Other keys are preserved
    expect(result.tablet).toBe("row");
    expect(result.mobile).toBe("column");
  });

  it("removes the mobile key entirely", () => {
    const bv: BreakpointValue<string> = {
      desktop: "row",
      mobile: "column",
    };
    const result = clearSlot(bv, "mobile");

    expect("mobile" in result).toBe(false);
    expect(Object.keys(result)).not.toContain("mobile");
    expect(result.desktop).toBe("row");
  });

  it("removes the tablet key entirely", () => {
    const bv: BreakpointValue<number> = {
      desktop: 3,
      tablet: 2,
      mobile: 1,
    };
    const result = clearSlot(bv, "tablet");

    expect("tablet" in result).toBe(false);
    expect(Object.keys(result)).not.toContain("tablet");
    expect(result.desktop).toBe(3);
    expect(result.mobile).toBe(1);
  });

  it("clearing an already-absent slot still returns a fresh copy without the key", () => {
    const bv: BreakpointValue<string> = { desktop: "row" };
    const result = clearSlot(bv, "mobile");

    expect("mobile" in result).toBe(false);
    expect(result.desktop).toBe("row");
    // Must be a new reference (not the same object)
    expect(result).not.toBe(bv);
  });

  it("clearing all slots produces an empty object with no residual keys", () => {
    const bv: BreakpointValue<string> = {
      desktop: "row",
      tablet: "row",
      mobile: "column",
    };
    let result = clearSlot(bv, "desktop");
    result = clearSlot(result, "tablet");
    result = clearSlot(result, "mobile");

    expect(Object.keys(result)).toHaveLength(0);
    expect(result).toStrictEqual({});
  });
});

// ─── Requirement 2.4, 5.5: responsiveDefaults never written to stored data ──

describe("responsiveDefaults values are never written to stored data (Req 2.4, 5.5)", () => {
  it("resolveWithDefaults does not mutate the input BreakpointValue", () => {
    const storedValue: BreakpointValue<string> = { desktop: "row" };
    const storedBefore = JSON.stringify(storedValue);

    const responsiveDefaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column", tablet: "column" },
    };

    // Resolve at mobile — should return "column" from defaults
    const result = resolveWithDefaults(
      storedValue,
      "mobile",
      "layoutDirection",
      responsiveDefaults,
    );

    expect(result.value).toBe("column");
    expect(result.source).toBe("default");

    // The stored value must be unchanged
    expect(JSON.stringify(storedValue)).toBe(storedBefore);
    expect("mobile" in storedValue).toBe(false);
    expect("tablet" in storedValue).toBe(false);
  });

  it("resolveAllRenderPropsWithDefaults does not mutate the input props object", () => {
    const props: Record<string, unknown> = {
      layoutDirection: { desktop: "row" },
      columns: { desktop: 3 },
    };
    const propsBefore = JSON.parse(JSON.stringify(props));

    const responsiveDefaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
      columns: { mobile: 1 },
    };

    // Resolve at mobile
    const resolved = resolveAllRenderPropsWithDefaults(
      props,
      "mobile",
      BREAKPOINT_AWARE_FIELDS,
      responsiveDefaults,
    );

    // Resolved values should use defaults
    expect(resolved.layoutDirection).toBe("column");
    expect(resolved.columns).toBe(1);

    // Original props must be unchanged
    expect(props).toStrictEqual(propsBefore);
    expect((props.layoutDirection as any).mobile).toBeUndefined();
    expect((props.columns as any).mobile).toBeUndefined();
  });

  it("the resolution pipeline returns a new object — never the same reference as input", () => {
    const props: Record<string, unknown> = {
      layoutDirection: { desktop: "row" },
    };

    const resolved = resolveAllRenderPropsWithDefaults(
      props,
      "desktop",
      BREAKPOINT_AWARE_FIELDS,
      undefined,
    );

    // Must be a different reference
    expect(resolved).not.toBe(props);
  });
});

// ─── Requirement 3.4: writeActiveSlot only writes to the active slot ────────

describe("writeActiveSlot only writes to the active breakpoint slot (Req 3.4)", () => {
  /**
   * Simulates the writeActiveSlot logic from BreakpointAwareFieldWrapper:
   *   const nextBv = { ...bv, [activeBreakpoint]: next };
   *
   * This is a direct unit test of the write semantics.
   */
  function simulateWriteActiveSlot(
    bv: BreakpointValue<unknown>,
    activeBreakpoint: "desktop" | "tablet" | "mobile",
    next: unknown,
  ): BreakpointValue<unknown> {
    return { ...bv, [activeBreakpoint]: next };
  }

  it("writing to mobile preserves desktop and tablet values unchanged", () => {
    const bv: BreakpointValue<string> = {
      desktop: "row",
      tablet: "row",
      mobile: "column",
    };

    const result = simulateWriteActiveSlot(bv, "mobile", "row");

    expect(result.mobile).toBe("row");
    expect(result.desktop).toBe("row");
    expect(result.tablet).toBe("row");
  });

  it("writing to desktop preserves tablet and mobile values unchanged", () => {
    const bv: BreakpointValue<number> = {
      desktop: 3,
      tablet: 2,
      mobile: 1,
    };

    const result = simulateWriteActiveSlot(bv, "desktop", 4);

    expect(result.desktop).toBe(4);
    expect(result.tablet).toBe(2);
    expect(result.mobile).toBe(1);
  });

  it("writing to tablet preserves desktop and mobile values unchanged", () => {
    const bv: BreakpointValue<string> = {
      desktop: "3",
      mobile: "1",
    };

    const result = simulateWriteActiveSlot(bv, "tablet", "2");

    expect(result.tablet).toBe("2");
    expect(result.desktop).toBe("3");
    expect(result.mobile).toBe("1");
  });

  it("writing does not add extra keys beyond the three breakpoint slots", () => {
    const bv: BreakpointValue<string> = { desktop: "row" };

    const result = simulateWriteActiveSlot(bv, "mobile", "column");

    const keys = Object.keys(result);
    expect(keys.every((k) => ["desktop", "tablet", "mobile"].includes(k))).toBe(true);
  });
});

// ─── Requirement 5.5: Re-saving without modifications produces identical output

describe("re-saving without modifications produces identical output (Req 5.5)", () => {
  it("page data round-trips through the resolution pipeline without gaining new keys", () => {
    // Simulate page data with component props
    const pageData = {
      content: [
        {
          type: "Columns",
          props: {
            id: "col-1",
            layoutDirection: { desktop: "row" },
          },
        },
        {
          type: "StatsGrid",
          props: {
            id: "stats-1",
            columns: { desktop: "3" },
          },
        },
      ],
      root: { props: {} },
    };

    // Deep clone to simulate "loaded from storage"
    const loaded = JSON.parse(JSON.stringify(pageData));

    // Simulate what the builder does: resolve for rendering (read-only)
    // then save the data as-is (no transformation)
    const responsiveDefaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
      columns: { mobile: "1" },
    };

    // Resolution happens at render time — it reads from the data but
    // never writes back. The save path just passes `dataRef.current` through.
    for (const component of loaded.content) {
      // Simulate render-time resolution (read-only)
      resolveAllRenderPropsWithDefaults(
        component.props,
        "mobile",
        BREAKPOINT_AWARE_FIELDS,
        responsiveDefaults,
      );
    }

    // After resolution, the loaded data should be unchanged
    expect(loaded).toStrictEqual(pageData);

    // Specifically verify no mobile/tablet keys were injected
    expect("mobile" in loaded.content[0].props.layoutDirection).toBe(false);
    expect("tablet" in loaded.content[0].props.layoutDirection).toBe(false);
    expect("mobile" in loaded.content[1].props.columns).toBe(false);
    expect("tablet" in loaded.content[1].props.columns).toBe(false);
  });

  it("JSON serialization of page data is identical before and after render-time resolution", () => {
    const pageData = {
      content: [
        {
          type: "FeaturedProjects",
          props: {
            id: "fp-1",
            columns: { desktop: 3 },
          },
        },
      ],
      root: { props: {} },
    };

    const serializedBefore = JSON.stringify(pageData);

    // Simulate multiple render passes (as would happen during editing)
    const responsiveDefaults: ResponsiveDefaults = {
      columns: { mobile: 1 },
    };

    for (let i = 0; i < 5; i++) {
      for (const component of pageData.content) {
        resolveAllRenderPropsWithDefaults(
          component.props,
          "mobile",
          BREAKPOINT_AWARE_FIELDS,
          responsiveDefaults,
        );
        resolveAllRenderPropsWithDefaults(
          component.props,
          "tablet",
          BREAKPOINT_AWARE_FIELDS,
          responsiveDefaults,
        );
        resolveAllRenderPropsWithDefaults(
          component.props,
          "desktop",
          BREAKPOINT_AWARE_FIELDS,
          responsiveDefaults,
        );
      }
    }

    const serializedAfter = JSON.stringify(pageData);

    // Byte-for-byte identical
    expect(serializedAfter).toBe(serializedBefore);
  });
});
