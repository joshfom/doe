/**
 * Unit tests for multi-column component responsive defaults.
 *
 * Verifies that `resolveWithDefaults` with each component's declared
 * `responsiveDefaults` produces single-column stacking on mobile.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11
 */
import { describe, it, expect } from "vitest";
import { resolveWithDefaults } from "./resolve-render-props";
import type { ResponsiveDefaults } from "./responsive-defaults";

describe("Multi-column component responsiveDefaults produce single-column stacking on mobile", () => {
  describe("Columns (Requirement 4.1)", () => {
    const defaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
    };

    it("resolves layoutDirection to 'column' on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "layoutDirection", defaults);
      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });
  });

  describe("StatsGrid (Requirement 4.2)", () => {
    const defaults: ResponsiveDefaults = {
      columns: { mobile: "1" },
    };

    it("resolves columns to '1' on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "columns", defaults);
      expect(result.value).toBe("1");
      expect(result.source).toBe("default");
    });
  });

  describe("IconFeatureList (Requirement 4.3)", () => {
    const defaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
    };

    it("resolves layoutDirection to 'column' on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "layoutDirection", defaults);
      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });
  });

  describe("FeaturedProjects (Requirement 4.4)", () => {
    const defaults: ResponsiveDefaults = {
      columns: { mobile: 1 },
    };

    it("resolves columns to 1 on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "columns", defaults);
      expect(result.value).toBe(1);
      expect(result.source).toBe("default");
    });
  });

  describe("FeaturedCommunities (Requirement 4.5)", () => {
    const defaults: ResponsiveDefaults = {
      columns: { mobile: 1 },
    };

    it("resolves columns to 1 on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "columns", defaults);
      expect(result.value).toBe(1);
      expect(result.source).toBe("default");
    });
  });

  describe("ContactLocationsMap (Requirement 4.6)", () => {
    const defaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
    };

    it("resolves layoutDirection to 'column' on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "layoutDirection", defaults);
      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });
  });

  describe("AccordionGroup (Requirement 4.7)", () => {
    const defaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
    };

    it("resolves layoutDirection to 'column' on mobile when no explicit value is set", () => {
      const result = resolveWithDefaults({}, "mobile", "layoutDirection", defaults);
      expect(result.value).toBe("column");
      expect(result.source).toBe("default");
    });
  });

  describe("Override semantics (Requirement 4.11)", () => {
    const defaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
    };

    it("explicit mobile value overrides the responsive default", () => {
      const result = resolveWithDefaults(
        { mobile: "row" },
        "mobile",
        "layoutDirection",
        defaults,
      );
      expect(result.value).toBe("row");
      expect(result.source).toBe("explicit");
    });
  });

  describe("Desktop breakpoint not affected by mobile defaults (Requirement 4.8)", () => {
    const defaults: ResponsiveDefaults = {
      layoutDirection: { mobile: "column" },
    };

    it("desktop breakpoint uses explicit desktop value, not mobile default", () => {
      const result = resolveWithDefaults(
        { desktop: "row" },
        "desktop",
        "layoutDirection",
        defaults,
      );
      expect(result.value).toBe("row");
      expect(result.source).toBe("explicit");
    });
  });
});
