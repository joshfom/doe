/**
 * Unit tests for `zone-constraints.ts`.
 *
 * Validates that `resolveZoneConstraints` correctly resolves the
 * `allow` / `disallow` rules for a Puck zone, used by the
 * Component_Picker to filter insertable component types.
 *
 * _Requirements: 5.9_
 */

import { describe, it, expect } from "vitest";
import { resolveZoneConstraints } from "./zone-constraints";
import type { Config, Data } from "@puckeditor/core";

// ── Factories ────────────────────────────────────────────────────────────────

/**
 * Build a minimal Puck `Config` from a map of component-type to slot field
 * definitions. Each slot field is keyed by zone name and may carry `allow`
 * and/or `disallow` arrays.
 */
function makeConfig(
  components: Record<
    string,
    Record<string, { type: string; allow?: string[]; disallow?: string[] }>
  > = {},
): Config {
  const componentsConfig: Record<string, { fields: Record<string, unknown> }> =
    {};
  for (const [componentType, fields] of Object.entries(components)) {
    componentsConfig[componentType] = { fields };
  }
  return { components: componentsConfig } as unknown as Config;
}

/**
 * Build a minimal Puck `Data` from root content and named zones.
 */
function makeData(
  content: Array<{ type: string; props: Record<string, unknown> }> = [],
  zones: Record<
    string,
    Array<{ type: string; props: Record<string, unknown> }>
  > = {},
): Data {
  return { content, zones } as unknown as Data;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolveZoneConstraints", () => {
  it("returns empty constraints for the root zone", () => {
    const config = makeConfig({
      Section: {
        content: { type: "slot", disallow: ["Section"] },
      },
    });
    const data = makeData([{ type: "Section", props: { id: "s1" } }]);

    const constraints = resolveZoneConstraints(
      "root:default-zone",
      config,
      data,
    );

    expect(constraints).toEqual({ allow: [], disallow: [] });
  });

  it("returns the `disallow` array for a named zone with disallow rules", () => {
    const config = makeConfig({
      Section: {
        content: {
          type: "slot",
          disallow: ["Section", "Columns"],
        },
      },
    });
    const data = makeData([{ type: "Section", props: { id: "s1" } }]);

    const constraints = resolveZoneConstraints("s1:content", config, data);

    expect(constraints.allow).toEqual([]);
    expect(constraints.disallow).toEqual(["Section", "Columns"]);
  });

  it("returns the `allow` array for a named zone with allow rules", () => {
    const config = makeConfig({
      Columns: {
        left: {
          type: "slot",
          allow: ["Heading", "Text", "Image"],
        },
      },
    });
    const data = makeData(
      [{ type: "Section", props: { id: "s1" } }],
      {
        "s1:content": [{ type: "Columns", props: { id: "c1" } }],
      },
    );

    const constraints = resolveZoneConstraints("c1:left", config, data);

    expect(constraints.allow).toEqual(["Heading", "Text", "Image"]);
    expect(constraints.disallow).toEqual([]);
  });

  it("returns empty arrays for a named zone with no constraints defined", () => {
    const config = makeConfig({
      Section: {
        // Slot field present but without `allow` or `disallow` arrays.
        content: { type: "slot" },
      },
    });
    const data = makeData([{ type: "Section", props: { id: "s1" } }]);

    const constraints = resolveZoneConstraints("s1:content", config, data);

    expect(constraints).toEqual({ allow: [], disallow: [] });
  });
});
