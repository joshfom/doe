import { describe, it, expect } from "vitest";
import { resolveRenderProp, resolveAllRenderProps, COMPOUND_BREAKPOINT_FIELDS } from "./resolve-render-props";
import type { BreakpointValue } from "./breakpoints";
import { BREAKPOINT_AWARE_FIELDS } from "./breakpoint-fields";

/**
 * Unit tests for resolve-render-props utility.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

describe("resolveRenderProp", () => {
  describe("scalar passthrough", () => {
    it("returns a string value unchanged", () => {
      expect(resolveRenderProp("hello", "desktop")).toBe("hello");
    });

    it("returns a number value unchanged", () => {
      expect(resolveRenderProp(42, "desktop")).toBe(42);
    });

    it("returns null unchanged", () => {
      expect(resolveRenderProp(null, "desktop")).toBeNull();
    });

    it("returns undefined unchanged", () => {
      expect(resolveRenderProp(undefined, "desktop")).toBeUndefined();
    });

    it("returns a boolean unchanged", () => {
      expect(resolveRenderProp(true, "mobile")).toBe(true);
    });
  });

  describe("BreakpointValue resolution", () => {
    it("resolves desktop slot at desktop breakpoint", () => {
      const value: BreakpointValue<string> = { desktop: "32px" };
      expect(resolveRenderProp(value, "desktop")).toBe("32px");
    });

    it("resolves tablet slot at tablet breakpoint", () => {
      const value: BreakpointValue<string> = { desktop: "32px", tablet: "24px" };
      expect(resolveRenderProp(value, "tablet")).toBe("24px");
    });

    it("resolves mobile slot at mobile breakpoint", () => {
      const value: BreakpointValue<string> = { desktop: "32px", tablet: "24px", mobile: "16px" };
      expect(resolveRenderProp(value, "mobile")).toBe("16px");
    });
  });

  describe("fallback chain (mobile→tablet→desktop)", () => {
    it("mobile falls back to tablet when mobile slot is absent", () => {
      const value: BreakpointValue<string> = { desktop: "32px", tablet: "24px" };
      expect(resolveRenderProp(value, "mobile")).toBe("24px");
    });

    it("mobile falls back to desktop when both mobile and tablet are absent", () => {
      const value: BreakpointValue<string> = { desktop: "32px" };
      expect(resolveRenderProp(value, "mobile")).toBe("32px");
    });

    it("tablet falls back to desktop when tablet slot is absent", () => {
      const value: BreakpointValue<string> = { desktop: "32px" };
      expect(resolveRenderProp(value, "tablet")).toBe("32px");
    });

    it("returns undefined when no slots are populated", () => {
      const value: BreakpointValue<string> = {};
      expect(resolveRenderProp(value, "desktop")).toBeUndefined();
    });
  });
});

describe("resolveAllRenderProps", () => {
  const breakpointAwareFields = new Set(["fontSize", "lineHeight", "letterSpacing"]);

  it("resolves only fields in the breakpointAwareFields set", () => {
    const props = {
      fontSize: { desktop: "20", tablet: "16" } as BreakpointValue<string>,
      lineHeight: { desktop: "1.5" } as BreakpointValue<string>,
      letterSpacing: { desktop: "0.5px", mobile: "0.2px" } as BreakpointValue<string>,
    };

    const result = resolveAllRenderProps(props, "desktop", breakpointAwareFields);

    expect(result.fontSize).toBe("20");
    expect(result.lineHeight).toBe("1.5");
    expect(result.letterSpacing).toBe("0.5px");
  });

  it("leaves non-breakpoint-aware fields untouched", () => {
    const complexObject = { nested: "value", arr: [1, 2, 3] };
    const props = {
      fontSize: { desktop: "20" } as BreakpointValue<string>,
      content: "<p>Hello</p>",
      items: complexObject,
      id: "block-123",
    };

    const result = resolveAllRenderProps(props, "desktop", breakpointAwareFields);

    expect(result.fontSize).toBe("20");
    expect(result.content).toBe("<p>Hello</p>");
    expect(result.items).toBe(complexObject);
    expect(result.id).toBe("block-123");
  });

  it("passes through scalar values in breakpoint-aware fields unchanged", () => {
    const props = {
      fontSize: "20",
      lineHeight: "1.5",
      letterSpacing: "normal",
    };

    const result = resolveAllRenderProps(props, "tablet", breakpointAwareFields);

    // Scalars get migrated to { desktop: value } then resolved — result is the same scalar
    expect(result.fontSize).toBe("20");
    expect(result.lineHeight).toBe("1.5");
    expect(result.letterSpacing).toBe("normal");
  });

  it("does not mutate the original props object", () => {
    const props = {
      fontSize: { desktop: "20", tablet: "16" } as BreakpointValue<string>,
      content: "hello",
    };

    const result = resolveAllRenderProps(props, "tablet", breakpointAwareFields);

    expect(result).not.toBe(props);
    expect(props.fontSize).toEqual({ desktop: "20", tablet: "16" });
    expect(result.fontSize).toBe("16");
  });

  it("resolves with fallback chain at mobile breakpoint", () => {
    const props = {
      fontSize: { desktop: "32", tablet: "24" } as BreakpointValue<string>,
      lineHeight: { desktop: "1.6" } as BreakpointValue<string>,
    };

    const result = resolveAllRenderProps(props, "mobile", breakpointAwareFields);

    // mobile → tablet fallback
    expect(result.fontSize).toBe("24");
    // mobile → tablet (absent) → desktop fallback
    expect(result.lineHeight).toBe("1.6");
  });
});


describe("compound breakpoint-aware fields (_padding, _margin, _border)", () => {
  describe("case (a): entire compound is a BreakpointValue<Record<string, string>>", () => {
    it("resolves _padding from BreakpointValue to compound object at desktop", () => {
      const props = {
        _padding: {
          desktop: { paddingTop: "16", paddingBottom: "16", paddingLeft: "8", paddingRight: "8" },
          tablet: { paddingTop: "8", paddingBottom: "8", paddingLeft: "4", paddingRight: "4" },
        } as BreakpointValue<Record<string, string>>,
      };

      const result = resolveAllRenderProps(props, "desktop", BREAKPOINT_AWARE_FIELDS);

      expect(result._padding).toEqual({
        paddingTop: "16",
        paddingBottom: "16",
        paddingLeft: "8",
        paddingRight: "8",
      });
    });

    it("resolves _padding from BreakpointValue to compound object at tablet", () => {
      const props = {
        _padding: {
          desktop: { paddingTop: "16", paddingBottom: "16", paddingLeft: "8", paddingRight: "8" },
          tablet: { paddingTop: "8", paddingBottom: "8", paddingLeft: "4", paddingRight: "4" },
        } as BreakpointValue<Record<string, string>>,
      };

      const result = resolveAllRenderProps(props, "tablet", BREAKPOINT_AWARE_FIELDS);

      expect(result._padding).toEqual({
        paddingTop: "8",
        paddingBottom: "8",
        paddingLeft: "4",
        paddingRight: "4",
      });
    });

    it("resolves _margin from BreakpointValue with fallback chain", () => {
      const props = {
        _margin: {
          desktop: { marginTop: "24", marginBottom: "24" },
        } as BreakpointValue<Record<string, string>>,
      };

      // mobile → tablet (absent) → desktop fallback
      const result = resolveAllRenderProps(props, "mobile", BREAKPOINT_AWARE_FIELDS);

      expect(result._margin).toEqual({ marginTop: "24", marginBottom: "24" });
    });

    it("resolves _border from BreakpointValue at active breakpoint", () => {
      const props = {
        _border: {
          desktop: { borderWidth: "2", borderColor: "#000", borderRadius: "8" },
          tablet: { borderWidth: "1", borderColor: "#333", borderRadius: "4" },
        } as BreakpointValue<Record<string, string>>,
      };

      const result = resolveAllRenderProps(props, "tablet", BREAKPOINT_AWARE_FIELDS);

      expect(result._border).toEqual({
        borderWidth: "1",
        borderColor: "#333",
        borderRadius: "4",
      });
    });
  });

  describe("case (b): individual sub-keys are BreakpointValue<string>", () => {
    it("resolves sub-key BreakpointValues within _padding", () => {
      const props = {
        _padding: {
          paddingTop: { desktop: "16", tablet: "8" } as BreakpointValue<string>,
          paddingBottom: "16", // legacy scalar sub-key
          paddingLeft: { desktop: "12" } as BreakpointValue<string>,
          paddingRight: "0",
        },
      };

      const result = resolveAllRenderProps(props, "tablet", BREAKPOINT_AWARE_FIELDS);

      expect(result._padding).toEqual({
        paddingTop: "8",
        paddingBottom: "16",
        paddingLeft: "12", // tablet falls back to desktop
        paddingRight: "0",
      });
    });

    it("resolves sub-key BreakpointValues within _margin", () => {
      const props = {
        _margin: {
          marginTop: { desktop: "24", mobile: "8" } as BreakpointValue<string>,
          marginBottom: "12",
        },
      };

      const result = resolveAllRenderProps(props, "mobile", BREAKPOINT_AWARE_FIELDS);

      expect(result._margin).toEqual({
        marginTop: "8",
        marginBottom: "12",
      });
    });

    it("resolves sub-key BreakpointValues within _border", () => {
      const props = {
        _border: {
          borderWidth: { desktop: "2", tablet: "1" } as BreakpointValue<string>,
          borderColor: "#E8E4DF",
          borderRadius: { desktop: "8" } as BreakpointValue<string>,
        },
      };

      const result = resolveAllRenderProps(props, "tablet", BREAKPOINT_AWARE_FIELDS);

      expect(result._border).toEqual({
        borderWidth: "1",
        borderColor: "#E8E4DF",
        borderRadius: "8", // tablet falls back to desktop
      });
    });

    it("does not mutate the original compound object", () => {
      const padding = {
        paddingTop: { desktop: "16", tablet: "8" } as BreakpointValue<string>,
        paddingBottom: "16",
        paddingLeft: "0",
        paddingRight: "0",
      };
      const props = { _padding: padding };

      const result = resolveAllRenderProps(props, "desktop", BREAKPOINT_AWARE_FIELDS);

      // Original is not mutated
      expect(padding.paddingTop).toEqual({ desktop: "16", tablet: "8" });
      // Result is resolved
      expect((result._padding as Record<string, unknown>).paddingTop).toBe("16");
    });
  });

  describe("legacy scalar compound (no BreakpointValue wrapping)", () => {
    it("passes through legacy _padding unchanged", () => {
      const props = {
        _padding: { paddingTop: "0", paddingBottom: "0", paddingLeft: "0", paddingRight: "0" },
      };

      const result = resolveAllRenderProps(props, "desktop", BREAKPOINT_AWARE_FIELDS);

      expect(result._padding).toEqual({
        paddingTop: "0",
        paddingBottom: "0",
        paddingLeft: "0",
        paddingRight: "0",
      });
    });

    it("passes through legacy _margin unchanged", () => {
      const props = {
        _margin: { marginTop: "0", marginBottom: "0" },
      };

      const result = resolveAllRenderProps(props, "tablet", BREAKPOINT_AWARE_FIELDS);

      expect(result._margin).toEqual({ marginTop: "0", marginBottom: "0" });
    });

    it("passes through legacy _border unchanged", () => {
      const props = {
        _border: { borderWidth: "0", borderColor: "#E8E4DF", borderRadius: "0" },
      };

      const result = resolveAllRenderProps(props, "mobile", BREAKPOINT_AWARE_FIELDS);

      expect(result._border).toEqual({
        borderWidth: "0",
        borderColor: "#E8E4DF",
        borderRadius: "0",
      });
    });
  });

  describe("COMPOUND_BREAKPOINT_FIELDS registry", () => {
    it("includes _padding", () => {
      expect(COMPOUND_BREAKPOINT_FIELDS.has("_padding")).toBe(true);
    });

    it("includes _margin", () => {
      expect(COMPOUND_BREAKPOINT_FIELDS.has("_margin")).toBe(true);
    });

    it("includes _border", () => {
      expect(COMPOUND_BREAKPOINT_FIELDS.has("_border")).toBe(true);
    });
  });
});
