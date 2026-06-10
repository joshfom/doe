import { describe, it, expect, vi } from "vitest";

/**
 * Feature: branded-font-enforcement — Unit tests for the font loader module
 *
 * Validates: Requirements 1.1, 1.2
 */

// Mock next/font/local to capture the config passed to localFont
// and return a predictable object with the variable property.
vi.mock("next/font/local", () => ({
  default: (config: { src: Array<{ weight: string }>; variable: string; display: string }) => ({
    variable: config.variable,
    className: "mocked-class",
    style: { fontFamily: "mocked-font" },
    __config: config, // expose config for test assertions
  }),
}));

// Import after mock is set up
const { urwGeometric } = await import("./urw-geometric");

describe("URW Geometric font loader", () => {
  it('exposes variable === "--font-urw-geometric"', () => {
    expect(urwGeometric.variable).toBe("--font-urw-geometric");
  });

  it("registers all 10 weight values (100–950)", () => {
    const config = (urwGeometric as unknown as { __config: { src: Array<{ weight: string }> } })
      .__config;
    const weights = config.src.map((entry) => entry.weight);

    expect(weights).toEqual([
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
      "950",
    ]);
  });

  it("has exactly 10 font source entries", () => {
    const config = (urwGeometric as unknown as { __config: { src: Array<unknown> } }).__config;
    expect(config.src).toHaveLength(10);
  });

  it('uses display: "swap" for font loading strategy', () => {
    const config = (urwGeometric as unknown as { __config: { display: string } }).__config;
    expect(config.display).toBe("swap");
  });
});
