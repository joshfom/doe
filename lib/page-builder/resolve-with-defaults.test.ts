import { describe, it, expect } from "vitest";
import { resolveWithDefaults } from "./resolve-render-props";
import type { BreakpointValue } from "./breakpoints";
import type { ResponsiveDefaults } from "./responsive-defaults";

/**
 * Unit tests for resolveWithDefaults.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3
 */

describe("resolveWithDefaults", () => {
  describe("Step 1: Explicit value at target breakpoint slot", () => {
    it("returns explicit mobile value when present", () => {
      const stored: BreakpointValue<string> = {
        desktop: "row",
        mobile: "column",
      };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "stacked" },
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("column");
      expect(result.source).toBe("explicit");
      expect(result.inheritedFrom).toBeUndefined();
    });

    it("returns explicit desktop value when present", () => {
      const stored: BreakpointValue<string> = { desktop: "row" };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column", desktop: "stacked" },
      };

      const result = resolveWithDefaults(
        stored,
        "desktop",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("row");
      expect(result.source).toBe("explicit");
    });

    it("returns explicit tablet value when present", () => {
      const stored: BreakpointValue<string> = {
        desktop: "row",
        tablet: "grid",
      };

      const result = resolveWithDefaults(
        stored,
        "tablet",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBe("grid");
      expect(result.source).toBe("explicit");
    });
  });

  describe("Step 2: responsiveDefaults value for target breakpoint slot", () => {
    it("returns responsiveDefaults mobile value when target slot is unset", () => {
      const stored: BreakpointValue<string> = { desktop: "row" };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column" },
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
      expect(result.inheritedFrom).toBeUndefined();
    });

    it("responsiveDefaults wins over wider-tier explicit value", () => {
      const stored: BreakpointValue<string> = {
        desktop: "row",
        tablet: "grid",
      };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column" },
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        defaults,
      );

      // responsiveDefaults should win over wider-tier (tablet: "grid")
      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });

    it("returns responsiveDefaults tablet value when target slot is unset", () => {
      const stored: BreakpointValue<string> = { desktop: "row" };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column", tablet: "grid" },
      };

      const result = resolveWithDefaults(
        stored,
        "tablet",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("grid");
      expect(result.source).toBe("default");
    });
  });

  describe("Step 3: Explicit value at next wider tier", () => {
    it("inherits from tablet when mobile is unset and no defaults for mobile", () => {
      const stored: BreakpointValue<string> = { tablet: "grid" };
      const defaults: ResponsiveDefaults = {};

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("grid");
      expect(result.source).toBe("inherited");
      expect(result.inheritedFrom).toBe("tablet");
    });

    it("inherits from desktop when mobile and tablet are unset and no defaults", () => {
      const stored: BreakpointValue<string> = { desktop: "row" };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBe("row");
      expect(result.source).toBe("inherited");
      expect(result.inheritedFrom).toBe("desktop");
    });

    it("inherits from desktop when tablet is unset and no defaults for tablet", () => {
      const stored: BreakpointValue<string> = { desktop: "row" };

      const result = resolveWithDefaults(
        stored,
        "tablet",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBe("row");
      expect(result.source).toBe("inherited");
      expect(result.inheritedFrom).toBe("desktop");
    });

    it("skips wider tiers with null/undefined/empty values", () => {
      const stored: BreakpointValue<string> = {
        desktop: "row",
        tablet: undefined,
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBe("row");
      expect(result.source).toBe("inherited");
      expect(result.inheritedFrom).toBe("desktop");
    });
  });

  describe("Step 4: Scalar default / undefined", () => {
    it("returns undefined with source scalar when all slots are empty", () => {
      const stored: BreakpointValue<string> = {};

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBeUndefined();
      expect(result.source).toBe("scalar");
    });

    it("returns undefined when responsiveDefaults has no entry for the field", () => {
      const stored: BreakpointValue<string> = {};
      const defaults: ResponsiveDefaults = {
        columns: { mobile: "1" },
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBeUndefined();
      expect(result.source).toBe("scalar");
    });

    it("returns undefined when stored value is undefined", () => {
      const result = resolveWithDefaults(
        undefined,
        "mobile",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBeUndefined();
      expect(result.source).toBe("scalar");
    });
  });

  describe("Edge cases", () => {
    it("handles legacy scalar values via migrateLegacyScalar", () => {
      // A legacy scalar "row" gets migrated to { desktop: "row" }
      const result = resolveWithDefaults(
        "row" as unknown as string,
        "desktop",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBe("row");
      expect(result.source).toBe("explicit");
    });

    it("legacy scalar inherits to mobile when no defaults", () => {
      const result = resolveWithDefaults(
        "row" as unknown as string,
        "mobile",
        "layoutDirection",
        undefined,
      );

      expect(result.value).toBe("row");
      expect(result.source).toBe("inherited");
      expect(result.inheritedFrom).toBe("desktop");
    });

    it("responsiveDefaults wins over legacy scalar at mobile", () => {
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column" },
      };

      const result = resolveWithDefaults(
        "row" as unknown as string,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });

    it("treats null slot value as unset", () => {
      const stored: BreakpointValue<string | null> = {
        desktop: "row",
        mobile: null,
      };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column" },
      };

      const result = resolveWithDefaults(
        stored as BreakpointValue<string>,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });

    it("treats empty string slot value as unset", () => {
      const stored: BreakpointValue<string> = {
        desktop: "row",
        mobile: "",
      };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column" },
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });

    it("handles numeric values correctly", () => {
      const stored: BreakpointValue<number> = { desktop: 3 };
      const defaults: ResponsiveDefaults = {
        columns: { mobile: 1 },
      };

      const result = resolveWithDefaults(
        stored,
        "mobile",
        "columns",
        defaults,
      );

      expect(result.value).toBe(1);
      expect(result.source).toBe("default");
    });

    it("does not mutate the stored value", () => {
      const stored: BreakpointValue<string> = { desktop: "row" };
      const storedCopy = { ...stored };
      const defaults: ResponsiveDefaults = {
        layoutDirection: { mobile: "column" },
      };

      resolveWithDefaults(stored, "mobile", "layoutDirection", defaults);

      expect(stored).toEqual(storedCopy);
    });

    it("desktop breakpoint never inherits (no wider tier exists)", () => {
      const stored: BreakpointValue<string> = {};
      const defaults: ResponsiveDefaults = {};

      const result = resolveWithDefaults(
        stored,
        "desktop",
        "layoutDirection",
        defaults,
      );

      expect(result.value).toBeUndefined();
      expect(result.source).toBe("scalar");
    });
  });
});
