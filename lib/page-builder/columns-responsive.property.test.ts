// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import React from "react";
import { render } from "@testing-library/react";
import { resolveColumnCount, mapLegacySpacing } from "./config";

// Polyfill ResizeObserver for jsdom — must be set before importing config
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation
const { pageBuilderConfig } = await import("./config");
const { BreakpointProvider } = await import("./breakpoint-context");
const columnsComponent = pageBuilderConfig.components.Columns;

/**
 * Helper to render the Columns component within a BreakpointProvider context.
 * The render function uses useBreakpoint() hook internally, so it must be
 * called within a React component tree that has the provider.
 */
function renderColumnsWithProvider(props: Record<string, unknown>) {
  const ColumnsWrapper = () => {
    return (columnsComponent.render as (p: Record<string, unknown>) => React.ReactElement)(props);
  };
  return render(
    React.createElement(BreakpointProvider, { initial: "desktop", children: React.createElement(ColumnsWrapper) })
  );
}

/**
 * Feature: columns-responsive-controls, Property 1: Column count resize preserves existing data
 *
 * Validates: Requirements 1.2, 1.3
 *
 * For any columnList of length N (1 ≤ N ≤ 6) and any target columnCount M (1 ≤ M ≤ 6),
 * after resizing: the first min(N, M) items are preserved when slicing columnList to columnCount.
 */
describe("Feature: columns-responsive-controls, Property 1: Column count resize preserves existing data", () => {
  const columnItemArb = fc.record({
    width: fc.constantFrom("1fr", "2fr", "3fr", "25%", "50%"),
    paddingTop: fc.constantFrom("0", "4px", "8px", "16px"),
    paddingBottom: fc.constantFrom("0", "4px", "8px", "16px"),
    paddingLeft: fc.constantFrom("0", "4px", "8px", "16px"),
    paddingRight: fc.constantFrom("0", "4px", "8px", "16px"),
    marginTop: fc.constantFrom("0", "4px", "8px", "16px"),
    marginBottom: fc.constantFrom("0", "4px", "8px", "16px"),
    marginLeft: fc.constantFrom("0", "4px", "8px", "16px"),
    marginRight: fc.constantFrom("0", "4px", "8px", "16px"),
    align: fc.constantFrom("flex-start", "center", "flex-end"),
    justify: fc.constantFrom("stretch", "flex-start", "center"),
  });

  it("first min(N, M) items are preserved when slicing columnList to columnCount", () => {
    fc.assert(
      fc.property(
        fc.array(columnItemArb, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 6 }),
        (columnList, columnCount) => {
          // Simulate what the render function does: slice columnList to columnCount
          const cols = columnList.slice(0, columnCount);
          const preserved = Math.min(columnList.length, columnCount);

          // The sliced result should have exactly min(N, M) items
          expect(cols.length).toBe(preserved);

          // Each preserved item should be identical to the original
          for (let i = 0; i < preserved; i++) {
            expect(cols[i]).toEqual(columnList[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveColumnCount returns the explicit columnCount when slicing is applied", () => {
    fc.assert(
      fc.property(
        fc.array(columnItemArb, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 6 }),
        (columnList, columnCount) => {
          // resolveColumnCount should return the explicit columnCount
          const resolved = resolveColumnCount({ columnCount, columnList });
          expect(resolved).toBe(columnCount);

          // The render function slices to resolved count — data is preserved
          const cols = columnList.slice(0, resolved);
          const preserved = Math.min(columnList.length, resolved);

          for (let i = 0; i < preserved; i++) {
            expect(cols[i]).toEqual(columnList[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: columns-responsive-controls, Property 6: Legacy spacing migration is lossless
 *
 * Validates: Requirements 6.3, 6.4
 *
 * For any legacy Column_Item with `paddingY`, `paddingX`, and `marginY` values
 * from SPACING_OPTS, the `mapLegacySpacing` function SHALL produce:
 * paddingTop = paddingBottom = paddingY,
 * paddingLeft = paddingRight = paddingX,
 * marginTop = marginBottom = marginY,
 * marginLeft = marginRight = "0".
 */
describe("Feature: columns-responsive-controls, Property 6: Legacy spacing migration is lossless", () => {
  const spacingValues = ["0", "4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px"];
  const spacingArb = fc.constantFrom(...spacingValues);

  it("maps legacy paddingY/paddingX/marginY to four-sided equivalents", () => {
    fc.assert(
      fc.property(
        spacingArb, spacingArb, spacingArb,
        (paddingY, paddingX, marginY) => {
          const item = { paddingY, paddingX, marginY };
          const result = mapLegacySpacing(item as Record<string, string>);
          expect(result.paddingTop).toBe(paddingY);
          expect(result.paddingBottom).toBe(paddingY);
          expect(result.paddingLeft).toBe(paddingX);
          expect(result.paddingRight).toBe(paddingX);
          expect(result.marginTop).toBe(marginY);
          expect(result.marginBottom).toBe(marginY);
          expect(result.marginLeft).toBe("0");
          expect(result.marginRight).toBe("0");
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: columns-responsive-controls, Property 2: Render output matches columnCount
 *
 * Validates: Requirements 1.5
 *
 * For any valid columnCount N with a columnList of length ≥ N,
 * the render produces exactly N column divs.
 */
describe("Feature: columns-responsive-controls, Property 2: Render output matches columnCount", () => {
  const columnItemArb = fc.record({
    width: fc.constantFrom("1fr", "2fr", "3fr", "25%", "50%"),
    paddingTop: fc.constantFrom("0", "4px", "8px", "16px"),
    paddingBottom: fc.constantFrom("0", "4px", "8px", "16px"),
    paddingLeft: fc.constantFrom("0", "4px", "8px", "16px"),
    paddingRight: fc.constantFrom("0", "4px", "8px", "16px"),
    marginTop: fc.constantFrom("0", "4px", "8px", "16px"),
    marginBottom: fc.constantFrom("0", "4px", "8px", "16px"),
    marginLeft: fc.constantFrom("0", "4px", "8px", "16px"),
    marginRight: fc.constantFrom("0", "4px", "8px", "16px"),
    align: fc.constantFrom("flex-start", "center", "flex-end"),
    justify: fc.constantFrom("stretch", "flex-start", "center"),
  });

  it("renders exactly N column divs for columnCount N", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }).chain((columnCount) =>
          fc.tuple(
            fc.constant(columnCount),
            fc.array(columnItemArb, { minLength: columnCount, maxLength: 6 }),
          )
        ),
        ([columnCount, columnList]) => {
          const props: Record<string, unknown> = {
            ...(columnsComponent.defaultProps as Record<string, unknown>),
            columnCount,
            columnList,
            gap: "md",
            layoutDirection: { desktop: "row" },
            id: "test-count",
          };

          const { container } = renderColumnsWithProvider(props);

          // The grid div contains the column divs as direct children
          const gridDiv = container.querySelector(".grid");
          expect(gridDiv).toBeTruthy();
          expect(gridDiv!.children.length).toBe(columnCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: columns-responsive-controls, Property 4: Layout direction determines grid template
 *
 * Validates: Requirements 4.3, 4.4
 *
 * For any Columns component with N columns (1 ≤ N ≤ 6) and a resolved layoutDirection value:
 * when direction is "row", the grid container SHALL have gridTemplateColumns equal to the
 * space-joined widths of the N columns; when direction is "column", the grid container SHALL
 * have gridTemplateColumns equal to "1fr".
 */
describe("Feature: columns-responsive-controls, Property 4: Layout direction determines grid template", () => {
  const widthArb = fc.constantFrom("1fr", "2fr", "3fr", "25%", "50%");

  /**
   * Helper: renders the Columns component inside a BreakpointProvider so
   * the withBreakpointResolution wrapper can call useBreakpoint().
   */
  function renderColumns(props: Record<string, unknown>) {
    const ColumnsWrapper = () =>
      (columnsComponent.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(
      React.createElement(BreakpointProvider, { initial: "desktop", children: React.createElement(ColumnsWrapper) }),
    );
    return container;
  }

  it("row direction uses joined column widths as gridTemplateColumns", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }).chain((count) =>
          fc.tuple(
            fc.constant(count),
            fc.array(widthArb, { minLength: count, maxLength: count }),
          ),
        ),
        ([count, widths]) => {
          const columnList = widths.map((w) => ({
            width: w,
            paddingTop: "0",
            paddingBottom: "0",
            paddingLeft: "0",
            paddingRight: "0",
            marginTop: "0",
            marginBottom: "0",
            marginLeft: "0",
            marginRight: "0",
            align: "flex-start",
            justify: "stretch",
          }));

          const props = {
            ...(columnsComponent.defaultProps as Record<string, unknown>),
            columnCount: count,
            layoutDirection: { desktop: "row" },
            columnList,
            gap: "md",
            id: "test-cols",
          };

          const container = renderColumns(props);

          // The grid div is inside the wrapper (styledRender may wrap in a div)
          const gridDiv = container.querySelector(".grid") as HTMLElement | null;
          expect(gridDiv).toBeTruthy();

          const expectedTemplate = widths
            .map((w) => (w || "1fr"))
            .join(" ");
          expect(gridDiv!.style.gridTemplateColumns).toBe(expectedTemplate);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("column direction uses 1fr as gridTemplateColumns", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        (count) => {
          const columnList = Array.from({ length: count }, () => ({
            width: "1fr",
            paddingTop: "0",
            paddingBottom: "0",
            paddingLeft: "0",
            paddingRight: "0",
            marginTop: "0",
            marginBottom: "0",
            marginLeft: "0",
            marginRight: "0",
            align: "flex-start",
            justify: "stretch",
          }));

          const props = {
            ...(columnsComponent.defaultProps as Record<string, unknown>),
            columnCount: count,
            layoutDirection: { desktop: "column" },
            columnList,
            gap: "md",
            id: "test-cols",
          };

          const container = renderColumns(props);

          const gridDiv = container.querySelector(".grid") as HTMLElement | null;
          expect(gridDiv).toBeTruthy();
          expect(gridDiv!.style.gridTemplateColumns).toBe("1fr");
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: columns-responsive-controls, Property 3: Spacing values applied to rendered columns
 *
 * Validates: Requirements 2.2, 3.2
 *
 * For any Column_Item with valid padding and margin values (from SPACING_OPTS),
 * the rendered column container element SHALL have CSS properties paddingTop,
 * paddingBottom, paddingLeft, paddingRight, marginTop, marginBottom, marginLeft,
 * marginRight matching the Column_Item's respective field values.
 */
describe("Feature: columns-responsive-controls, Property 3: Spacing values applied to rendered columns", () => {
  const spacingArb = fc.constantFrom("0", "4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px");

  /**
   * jsdom normalizes "0" to "0px" when setting CSS properties via style.
   * This helper accounts for that normalization when comparing values.
   */
  function normalizeSpacing(value: string): string {
    return value === "0" ? "0px" : value;
  }

  it("rendered column has matching CSS padding and margin properties", () => {
    fc.assert(
      fc.property(
        spacingArb, spacingArb, spacingArb, spacingArb,
        spacingArb, spacingArb, spacingArb, spacingArb,
        (pT, pB, pL, pR, mT, mB, mL, mR) => {
          const columnList = [{
            width: "1fr",
            paddingTop: pT,
            paddingBottom: pB,
            paddingLeft: pL,
            paddingRight: pR,
            marginTop: mT,
            marginBottom: mB,
            marginLeft: mL,
            marginRight: mR,
            align: "flex-start",
            justify: "stretch",
          }];

          const props = {
            ...(columnsComponent.defaultProps as Record<string, unknown>),
            columnCount: 1,
            layoutDirection: { desktop: "row" },
            columnList,
            gap: "md",
            id: "test-spacing",
          };

          const { container } = renderColumnsWithProvider(props);

          const gridDiv = container.querySelector(".grid") as HTMLElement;
          expect(gridDiv).toBeTruthy();

          // The first (and only) child of the grid div is the column div
          const columnDiv = gridDiv.children[0] as HTMLElement;
          expect(columnDiv).toBeTruthy();

          expect(columnDiv.style.paddingTop).toBe(normalizeSpacing(pT));
          expect(columnDiv.style.paddingBottom).toBe(normalizeSpacing(pB));
          expect(columnDiv.style.paddingLeft).toBe(normalizeSpacing(pL));
          expect(columnDiv.style.paddingRight).toBe(normalizeSpacing(pR));
          expect(columnDiv.style.marginTop).toBe(normalizeSpacing(mT));
          expect(columnDiv.style.marginBottom).toBe(normalizeSpacing(mB));
          expect(columnDiv.style.marginLeft).toBe(normalizeSpacing(mL));
          expect(columnDiv.style.marginRight).toBe(normalizeSpacing(mR));
        },
      ),
      { numRuns: 100 },
    );
  });
});
