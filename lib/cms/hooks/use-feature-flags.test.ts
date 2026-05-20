import { describe, it, expect } from "vitest";
import {
  parseFeatureFlag,
  resolveFeatureFlag,
  resolveFeatureFlags,
  FEATURE_FLAGS,
  FEATURE_FLAG_DEFAULT,
  type FeatureFlag,
} from "./use-feature-flags";

describe("parseFeatureFlag", () => {
  it("returns false as the default for undefined and null", () => {
    expect(parseFeatureFlag(undefined)).toBe(false);
    expect(parseFeatureFlag(null)).toBe(false);
  });

  it("returns false for the empty string", () => {
    expect(parseFeatureFlag("")).toBe(false);
  });

  it("returns true only for the literal string 'true' (case-insensitive, trimmed)", () => {
    expect(parseFeatureFlag("true")).toBe(true);
    expect(parseFeatureFlag("TRUE")).toBe(true);
    expect(parseFeatureFlag("  true  ")).toBe(true);
    expect(parseFeatureFlag("True")).toBe(true);
  });

  it("returns false for any other string, including 'false', '0', '1'", () => {
    expect(parseFeatureFlag("false")).toBe(false);
    expect(parseFeatureFlag("0")).toBe(false);
    expect(parseFeatureFlag("1")).toBe(false);
    expect(parseFeatureFlag("yes")).toBe(false);
    expect(parseFeatureFlag("nonsense")).toBe(false);
  });
});

describe("resolveFeatureFlag", () => {
  it("returns the default (false) when the settings array is null or undefined", () => {
    expect(resolveFeatureFlag("branded_builder", null)).toBe(
      FEATURE_FLAG_DEFAULT,
    );
    expect(resolveFeatureFlag("breakpoint_css", undefined)).toBe(
      FEATURE_FLAG_DEFAULT,
    );
  });

  it("returns the default (false) when the flag key is absent from the settings array", () => {
    const settings = [{ key: "home_page_id", value: "abc" }];
    expect(resolveFeatureFlag("branded_builder", settings)).toBe(false);
    expect(resolveFeatureFlag("breakpoint_css", settings)).toBe(false);
    expect(resolveFeatureFlag("inline_editor", settings)).toBe(false);
  });

  it("returns true when the flag is present and stored as the string 'true'", () => {
    const settings = [
      { key: "branded_builder", value: "true" },
      { key: "breakpoint_css", value: "false" },
    ];
    expect(resolveFeatureFlag("branded_builder", settings)).toBe(true);
    expect(resolveFeatureFlag("breakpoint_css", settings)).toBe(false);
    expect(resolveFeatureFlag("inline_editor", settings)).toBe(false);
  });

  it("treats each flag independently so any combination is valid", () => {
    // Design note: "Any combination is valid; rollback is a flag flip."
    const settings = [
      { key: "branded_builder", value: "true" },
      { key: "breakpoint_css", value: "true" },
      { key: "inline_editor", value: "false" },
    ];
    expect(resolveFeatureFlag("branded_builder", settings)).toBe(true);
    expect(resolveFeatureFlag("breakpoint_css", settings)).toBe(true);
    expect(resolveFeatureFlag("inline_editor", settings)).toBe(false);
  });
});

describe("resolveFeatureFlags", () => {
  it("returns every known flag as false by default", () => {
    const result = resolveFeatureFlags(null);
    for (const flag of FEATURE_FLAGS) {
      expect(result[flag]).toBe(false);
    }
  });

  it("returns every known flag as false when the settings table is empty", () => {
    const result = resolveFeatureFlags([]);
    for (const flag of FEATURE_FLAGS) {
      expect(result[flag]).toBe(false);
    }
  });

  it("reflects the stored values for flags that are present and leaves absent flags at false", () => {
    const result = resolveFeatureFlags([
      { key: "branded_builder", value: "true" },
      // breakpoint_css absent → default false
      { key: "inline_editor", value: "true" },
      { key: "home_page_id", value: "abc" }, // irrelevant
    ]);
    expect(result).toEqual({
      branded_builder: true,
      breakpoint_css: false,
      inline_editor: true,
    });
  });
});

describe("FEATURE_FLAGS enumeration", () => {
  it("lists the three known flags", () => {
    expect(FEATURE_FLAGS).toEqual([
      "branded_builder",
      "breakpoint_css",
      "inline_editor",
    ]);
  });

  it("is type-compatible with FeatureFlag", () => {
    // Compile-time check — if the union drifts, this block fails to build.
    const flags: readonly FeatureFlag[] = FEATURE_FLAGS;
    expect(flags.length).toBe(3);
  });
});
