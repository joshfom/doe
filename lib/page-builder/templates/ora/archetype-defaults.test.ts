import { describe, it, expect } from "vitest";
import {
  ORA_PAGE_TEMPLATE_PALETTE,
  ORA_PAGE_TEMPLATE_GRADIENTS,
  ORA_TEMPLATE_IMAGES,
} from "./archetype-defaults";

describe("archetype-defaults", () => {
  describe("ORA_PAGE_TEMPLATE_PALETTE", () => {
    it("every member matches the hex color regex /^#[0-9A-F]{6}$/i", () => {
      const hexRegex = /^#[0-9A-F]{6}$/i;
      for (const color of ORA_PAGE_TEMPLATE_PALETTE) {
        expect(color).toMatch(hexRegex);
      }
    });
  });

  describe("ORA_PAGE_TEMPLATE_GRADIENTS", () => {
    it("every gradient pair's `from` and `to` are members of the palette", () => {
      const palette = new Set<string>(ORA_PAGE_TEMPLATE_PALETTE);
      for (const [name, pair] of Object.entries(ORA_PAGE_TEMPLATE_GRADIENTS)) {
        expect(palette.has(pair.from), `${name}.from (${pair.from}) should be in palette`).toBe(true);
        expect(palette.has(pair.to), `${name}.to (${pair.to}) should be in palette`).toBe(true);
      }
    });
  });

  describe("ORA_TEMPLATE_IMAGES", () => {
    it("every image url is a non-empty https string", () => {
      for (const [key, url] of Object.entries(ORA_TEMPLATE_IMAGES)) {
        expect(url.length, `${key} should be non-empty`).toBeGreaterThan(0);
        expect(url, `${key} should start with https://`).toMatch(/^https:\/\//);
      }
    });
  });
});
