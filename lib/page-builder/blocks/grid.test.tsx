// @vitest-environment jsdom
/**
 * Unit tests for the shared responsive-grid helper (`grid.ts`).
 *
 * Scope: this file covers task 3.2 — the two helpers exported by
 * `blocks/grid.ts`:
 *   - `gridStyle(props, { gap })`: how the breakpoint-aware `columns` field is
 *     resolved at the DESKTOP tier into a static `grid-template-columns` inline
 *     style, the default/invalid fallbacks, and the `gap` pass-through.
 *   - `responsiveColumnsField(label, max)`: that the built selector offers the
 *     values `1..max` and coerces a sub-1 / non-finite `max` to a single
 *     option.
 *
 * The selector's options live inside the `createCustomSelectField` render
 * closure (a React component), so they are inspected by rendering the field and
 * opening the dropdown — hence the jsdom environment.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/grid.ts`
 * Validates: Requirements 12.1, 12.3
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import {
  gridStyle,
  responsiveColumnsField,
  COLUMNS_FIELD_NAME,
} from "./grid";

/**
 * Render a `responsiveColumnsField` field, open its custom select dropdown, and
 * return the option labels in order. The dropdown's options are `<button>`s
 * whose text is the bare column number; the toggle button shows "Select" (no
 * digits) and the description text lives in a `<div>`, so filtering buttons by a
 * digit-only text content isolates the options.
 */
function optionLabels(field: ReturnType<typeof responsiveColumnsField>): string[] {
  const f = field as unknown as {
    render: (p: { value: unknown; onChange: (v: string) => void }) => React.ReactElement;
  };
  const { container, unmount } = render(
    f.render({ value: "", onChange: () => {} }),
  );
  // The first button is the closed-select toggle; clicking it reveals options.
  const toggle = container.querySelector("button");
  if (toggle) fireEvent.click(toggle);
  const labels = Array.from(container.querySelectorAll("button"))
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => /^\d+$/.test(t));
  unmount();
  return labels;
}

describe("COLUMNS_FIELD_NAME", () => {
  it("is the fixed `columns` key the helpers key off", () => {
    expect(COLUMNS_FIELD_NAME).toBe("columns");
  });
});

describe("gridStyle — column resolution per breakpoint (Req 12.1)", () => {
  it("always returns a CSS grid container", () => {
    const style = gridStyle({ [COLUMNS_FIELD_NAME]: 3 });
    expect(style.display).toBe("grid");
  });

  it("resolves a scalar number into repeat(n, 1fr)", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 3 }).gridTemplateColumns).toBe(
      "repeat(3, 1fr)",
    );
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 1 }).gridTemplateColumns).toBe(
      "repeat(1, 1fr)",
    );
  });

  it("resolves a legacy scalar string into repeat(n, 1fr)", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: "2" }).gridTemplateColumns).toBe(
      "repeat(2, 1fr)",
    );
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: "4" }).gridTemplateColumns).toBe(
      "repeat(4, 1fr)",
    );
  });

  it("resolves the DESKTOP slot of a BreakpointValue, ignoring tablet/mobile", () => {
    const style = gridStyle({
      [COLUMNS_FIELD_NAME]: { desktop: 3, tablet: 2, mobile: 1 },
    });
    // The desktop tier (3) wins for the static baseline, not tablet (2) or mobile (1).
    expect(style.gridTemplateColumns).toBe("repeat(3, 1fr)");
  });

  it("resolves a BreakpointValue that only declares desktop", () => {
    const style = gridStyle({ [COLUMNS_FIELD_NAME]: { desktop: 4 } });
    expect(style.gridTemplateColumns).toBe("repeat(4, 1fr)");
  });

  it("falls back to 1 column when the BreakpointValue has no desktop slot", () => {
    // resolveBreakpointValue(..., "desktop") reads only the desktop slot; with
    // no desktop value the result is undefined and the helper defaults to 1.
    const style = gridStyle({ [COLUMNS_FIELD_NAME]: { tablet: 2, mobile: 1 } });
    expect(style.gridTemplateColumns).toBe("repeat(1, 1fr)");
  });
});

describe("gridStyle — default / invalid handling (Req 12.3)", () => {
  it("defaults to a single column when `columns` is absent", () => {
    expect(gridStyle({}).gridTemplateColumns).toBe("repeat(1, 1fr)");
  });

  it("defaults to a single column when `columns` is null or undefined", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: null }).gridTemplateColumns).toBe(
      "repeat(1, 1fr)",
    );
    expect(
      gridStyle({ [COLUMNS_FIELD_NAME]: undefined }).gridTemplateColumns,
    ).toBe("repeat(1, 1fr)");
  });

  it("defaults to a single column for a non-numeric string", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: "abc" }).gridTemplateColumns).toBe(
      "repeat(1, 1fr)",
    );
  });

  it("defaults to a single column for zero and negative counts", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 0 }).gridTemplateColumns).toBe(
      "repeat(1, 1fr)",
    );
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: -3 }).gridTemplateColumns).toBe(
      "repeat(1, 1fr)",
    );
  });

  it("floors a fractional column count to a whole number of tracks", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 2.9 }).gridTemplateColumns).toBe(
      "repeat(2, 1fr)",
    );
  });
});

describe("gridStyle — gap mapping", () => {
  it("passes the gap option through to the style's gap", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 2 }, { gap: "16px" }).gap).toBe(
      "16px",
    );
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 2 }, { gap: "24px" }).gap).toBe(
      "24px",
    );
  });

  it("leaves gap undefined when no gap option is supplied", () => {
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 2 }).gap).toBeUndefined();
    expect(gridStyle({ [COLUMNS_FIELD_NAME]: 2 }, {}).gap).toBeUndefined();
  });

  it("maps gap independently of the resolved column count", () => {
    const style = gridStyle(
      { [COLUMNS_FIELD_NAME]: { desktop: 3 } },
      { gap: "32px" },
    );
    expect(style.gridTemplateColumns).toBe("repeat(3, 1fr)");
    expect(style.gap).toBe("32px");
  });
});

describe("responsiveColumnsField", () => {
  it("builds a custom select field carrying the given label", () => {
    const field = responsiveColumnsField("Columns", 4) as unknown as {
      type: string;
      label?: string;
    };
    expect(field.type).toBe("custom");
    expect(field.label).toBe("Columns");
  });

  it("offers exactly the values 1..max in order", () => {
    expect(optionLabels(responsiveColumnsField("Columns", 4))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(optionLabels(responsiveColumnsField("Columns", 1))).toEqual(["1"]);
  });

  it("floors a fractional max to a whole number of options", () => {
    expect(optionLabels(responsiveColumnsField("Columns", 3.9))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("coerces a sub-1 max to a single `1` option", () => {
    expect(optionLabels(responsiveColumnsField("Columns", 0))).toEqual(["1"]);
    expect(optionLabels(responsiveColumnsField("Columns", -5))).toEqual(["1"]);
  });

  it("coerces a non-finite max to a single `1` option", () => {
    expect(optionLabels(responsiveColumnsField("Columns", NaN))).toEqual(["1"]);
    expect(
      optionLabels(responsiveColumnsField("Columns", Number.POSITIVE_INFINITY)),
    ).toEqual(["1"]);
  });
});
