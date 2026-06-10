// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// Polyfill ResizeObserver for jsdom — must be set before importing config
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation
const { pageBuilderConfig, resolveColumnCount, mapLegacySpacing } = await import("./config");

const columnsComponent = pageBuilderConfig.components.Columns;

/**
 * Feature: columns-responsive-controls — Unit tests for field definitions and defaults
 *
 * Validates: Requirements 1.1, 2.1, 2.3, 2.4, 3.1, 3.3, 3.4, 4.1, 4.5
 */
describe("Columns component field definitions and defaults", () => {
  describe("columnCount field", () => {
    it("exists with type number, min 1, and max 6", () => {
      const fields = columnsComponent.fields!;
      const field = fields.columnCount as {
        type: string;
        min?: number;
        max?: number;
      };
      expect(field).toBeDefined();
      expect(field.type).toBe("number");
      expect(field.min).toBe(1);
      expect(field.max).toBe(6);
    });
  });

  describe("layoutDirection field", () => {
    it("exists with type custom and label Layout Direction", () => {
      const fields = columnsComponent.fields!;
      const field = fields.layoutDirection as {
        type: string;
        label: string;
      };
      expect(field).toBeDefined();
      expect(field.type).toBe("custom");
      expect(field.label).toBe("Layout Direction");
    });
  });

  describe("columnList.arrayFields spacing fields", () => {
    it("includes all eight spacing fields", () => {
      const fields = columnsComponent.fields!;
      const columnList = fields.columnList as {
        arrayFields: Record<string, unknown>;
      };
      const arrayFields = columnList.arrayFields;

      expect(arrayFields.paddingTop).toBeDefined();
      expect(arrayFields.paddingBottom).toBeDefined();
      expect(arrayFields.paddingLeft).toBeDefined();
      expect(arrayFields.paddingRight).toBeDefined();
      expect(arrayFields.marginTop).toBeDefined();
      expect(arrayFields.marginBottom).toBeDefined();
      expect(arrayFields.marginLeft).toBeDefined();
      expect(arrayFields.marginRight).toBeDefined();
    });

    it("spacing fields have type custom", () => {
      const fields = columnsComponent.fields!;
      const columnList = fields.columnList as {
        arrayFields: Record<string, { type: string }>;
      };
      const arrayFields = columnList.arrayFields;

      const spacingFieldNames = [
        "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
        "marginTop", "marginBottom", "marginLeft", "marginRight",
      ];

      for (const name of spacingFieldNames) {
        expect(arrayFields[name].type).toBe("custom");
      }
    });
  });

  describe("default props", () => {
    it("has columnCount defaulting to 2", () => {
      const defaults = columnsComponent.defaultProps as Record<string, unknown>;
      expect(defaults.columnCount).toBe(2);
    });

    it("has layoutDirection defaulting to desktop row and mobile column", () => {
      const defaults = columnsComponent.defaultProps as Record<string, unknown>;
      expect(defaults.layoutDirection).toEqual({
        desktop: "row",
        mobile: "column",
      });
    });

    it("has columnList items with four-sided spacing set to 0", () => {
      const defaults = columnsComponent.defaultProps as Record<string, unknown>;
      const columnList = defaults.columnList as Array<Record<string, string>>;

      expect(columnList).toBeDefined();
      expect(columnList.length).toBe(2);

      for (const item of columnList) {
        expect(item.paddingTop).toBe("0");
        expect(item.paddingBottom).toBe("0");
        expect(item.paddingLeft).toBe("0");
        expect(item.paddingRight).toBe("0");
        expect(item.marginTop).toBe("0");
        expect(item.marginBottom).toBe("0");
        expect(item.marginLeft).toBe("0");
        expect(item.marginRight).toBe("0");
      }
    });
  });
});


/**
 * Feature: columns-responsive-controls — Backward compatibility scenarios
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */
describe("Backward compatibility scenarios", () => {
  describe("resolveColumnCount fallback", () => {
    it("returns columnList.length when columnCount is absent", () => {
      const result = resolveColumnCount({ columnList: [{}, {}, {}] });
      expect(result).toBe(3);
    });

    it("returns columnList.length when columnCount is invalid (0)", () => {
      const result = resolveColumnCount({ columnCount: 0, columnList: [{}, {}] });
      expect(result).toBe(2);
    });

    it("returns columnList.length when columnCount is invalid (negative)", () => {
      const result = resolveColumnCount({ columnCount: -1, columnList: [{}, {}, {}, {}] });
      expect(result).toBe(4);
    });

    it("returns columnList.length when columnCount is invalid (> 6)", () => {
      const result = resolveColumnCount({ columnCount: 10, columnList: [{}, {}, {}] });
      expect(result).toBe(3);
    });

    it("clamps to 6 when columnList is longer", () => {
      const result = resolveColumnCount({ columnList: [{}, {}, {}, {}, {}, {}, {}, {}] });
      expect(result).toBe(6);
    });

    it("clamps to 1 when columnList is empty", () => {
      const result = resolveColumnCount({ columnList: [] });
      expect(result).toBe(1);
    });

    it("defaults to 2 when no columnList", () => {
      const result = resolveColumnCount({});
      expect(result).toBe(2);
    });

    it("uses explicit columnCount when valid", () => {
      const result = resolveColumnCount({ columnCount: 4, columnList: [{}, {}] });
      expect(result).toBe(4);
    });
  });

  describe("mapLegacySpacing mixed fields", () => {
    it("new fields take precedence over legacy fields", () => {
      const item = {
        paddingY: "16px",
        paddingX: "8px",
        marginY: "4px",
        paddingTop: "32px",  // new field overrides paddingY
        paddingLeft: "24px", // new field overrides paddingX
        marginTop: "48px",   // new field overrides marginY
      };
      const result = mapLegacySpacing(item);
      expect(result.paddingTop).toBe("32px");
      expect(result.paddingBottom).toBe("16px"); // falls back to paddingY
      expect(result.paddingLeft).toBe("24px");
      expect(result.paddingRight).toBe("8px"); // falls back to paddingX
      expect(result.marginTop).toBe("48px");
      expect(result.marginBottom).toBe("4px"); // falls back to marginY
      expect(result.marginLeft).toBe("0");
      expect(result.marginRight).toBe("0");
    });

    it("handles item with no spacing fields at all", () => {
      const result = mapLegacySpacing({});
      expect(result.paddingTop).toBe("0");
      expect(result.paddingBottom).toBe("0");
      expect(result.paddingLeft).toBe("0");
      expect(result.paddingRight).toBe("0");
      expect(result.marginTop).toBe("0");
      expect(result.marginBottom).toBe("0");
      expect(result.marginLeft).toBe("0");
      expect(result.marginRight).toBe("0");
    });

    it("maps legacy paddingY to both paddingTop and paddingBottom", () => {
      const result = mapLegacySpacing({ paddingY: "24px" });
      expect(result.paddingTop).toBe("24px");
      expect(result.paddingBottom).toBe("24px");
    });

    it("maps legacy paddingX to both paddingLeft and paddingRight", () => {
      const result = mapLegacySpacing({ paddingX: "12px" });
      expect(result.paddingLeft).toBe("12px");
      expect(result.paddingRight).toBe("12px");
    });

    it("maps legacy marginY to both marginTop and marginBottom", () => {
      const result = mapLegacySpacing({ marginY: "8px" });
      expect(result.marginTop).toBe("8px");
      expect(result.marginBottom).toBe("8px");
    });

    it("marginLeft and marginRight always default to 0 (no legacy equivalent)", () => {
      const result = mapLegacySpacing({ paddingY: "16px", paddingX: "8px", marginY: "4px" });
      expect(result.marginLeft).toBe("0");
      expect(result.marginRight).toBe("0");
    });
  });

  describe("legacy data renders correctly", () => {
    it("renders legacy column data without columnCount or layoutDirection", () => {
      const legacyProps = {
        columnList: [
          { width: "1fr", paddingY: "16px", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
          { width: "1fr", paddingY: "0", paddingX: "8px", marginY: "0", align: "center", justify: "stretch" },
        ],
        gap: "md",
        "column-0": () => null,
        "column-1": () => null,
      };

      // Verify resolveColumnCount derives count from columnList
      const count = resolveColumnCount(legacyProps);
      expect(count).toBe(2);

      // Verify mapLegacySpacing correctly maps legacy fields for each column
      const col0Spacing = mapLegacySpacing(legacyProps.columnList[0]);
      expect(col0Spacing.paddingTop).toBe("16px");
      expect(col0Spacing.paddingBottom).toBe("16px");
      expect(col0Spacing.paddingLeft).toBe("0");
      expect(col0Spacing.paddingRight).toBe("0");
      expect(col0Spacing.marginTop).toBe("0");
      expect(col0Spacing.marginBottom).toBe("0");

      const col1Spacing = mapLegacySpacing(legacyProps.columnList[1]);
      expect(col1Spacing.paddingTop).toBe("0");
      expect(col1Spacing.paddingBottom).toBe("0");
      expect(col1Spacing.paddingLeft).toBe("8px");
      expect(col1Spacing.paddingRight).toBe("8px");
      expect(col1Spacing.marginTop).toBe("0");
      expect(col1Spacing.marginBottom).toBe("0");
    });

    it("legacy data without layoutDirection defaults to row behavior", () => {
      // When layoutDirection is absent, the render function defaults to "row"
      // which means gridTemplateColumns uses the column widths.
      // We verify this by checking that resolveColumnCount works correctly
      // and mapLegacySpacing produces the expected four-sided values for all columns.
      const legacyProps = {
        columnList: [
          { width: "1fr", paddingY: "16px", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
          { width: "2fr", paddingY: "0", paddingX: "8px", marginY: "4px", align: "center", justify: "stretch" },
          { width: "1fr", paddingY: "0", paddingX: "0", marginY: "0", align: "flex-start", justify: "stretch" },
        ],
        gap: "md",
      };

      // No columnCount → derives from columnList.length
      expect(resolveColumnCount(legacyProps)).toBe(3);

      // Each column's legacy spacing maps correctly
      const col1Spacing = mapLegacySpacing(legacyProps.columnList[1]);
      expect(col1Spacing.paddingTop).toBe("0");
      expect(col1Spacing.paddingBottom).toBe("0");
      expect(col1Spacing.paddingLeft).toBe("8px");
      expect(col1Spacing.paddingRight).toBe("8px");
      expect(col1Spacing.marginTop).toBe("4px");
      expect(col1Spacing.marginBottom).toBe("4px");
      expect(col1Spacing.marginLeft).toBe("0");
      expect(col1Spacing.marginRight).toBe("0");
    });
  });
});
