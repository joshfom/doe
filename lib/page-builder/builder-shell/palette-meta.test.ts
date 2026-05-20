/**
 * Unit tests for `palette-meta.ts`.
 *
 * Validates the shared metadata module that powers both the ComponentPalette
 * and the ComponentPickerPopover.
 *
 * _Requirements: 5.1, 5.2_
 */

import { describe, it, expect } from "vitest";
import {
  PALETTE_META,
  FALLBACK_META,
  CATEGORY_ORDER,
  matchesQuery,
} from "./palette-meta";

describe("PALETTE_META", () => {
  const EXPECTED_COMPONENT_TYPES = [
    // Layout
    "Section",
    "Container",
    "Columns",
    "Accordion",
    "Spacer",
    "Divider",
    // Blocks
    "Heading",
    "Text",
    "Button",
    "InlineLink",
    "Image",
    "Video",
    "Quote",
    "Icon",
    "ImageCarousel",
    // Components
    "FilterTabs",
    "ScrollIndicator",
    "IconFeatureList",
    "AccordionGroup",
    "StatsGrid",
    "LocationMap",
    "ContactLocationsMap",
    "FeaturedProjects",
    "FeaturedCommunities",
    "ProjectSection",
    "ExperienceLauncher",
  ] as const;

  it.each(EXPECTED_COMPONENT_TYPES)(
    "contains an entry for %s",
    (componentType) => {
      expect(PALETTE_META).toHaveProperty(componentType);
    },
  );

  it("each entry exposes a non-empty description and a renderable Icon", () => {
    for (const [name, meta] of Object.entries(PALETTE_META)) {
      expect(
        typeof meta.description === "string" && meta.description.length > 0,
        `${name} should have a non-empty description`,
      ).toBe(true);
      expect(
        meta.Icon,
        `${name} should expose an Icon component`,
      ).toBeDefined();
    }
  });

  it("FALLBACK_META exposes the same shape as PALETTE_META entries", () => {
    expect(typeof FALLBACK_META.description).toBe("string");
    expect(FALLBACK_META.description.length).toBeGreaterThan(0);
    expect(FALLBACK_META.Icon).toBeDefined();
  });
});

describe("matchesQuery", () => {
  it("returns true when the query is empty", () => {
    expect(matchesQuery("Heading", "Titles from H1 to H6", "")).toBe(true);
    expect(matchesQuery("", "", "")).toBe(true);
  });

  it("matches a substring of the label (case-insensitive)", () => {
    expect(matchesQuery("Heading", "Titles", "head")).toBe(true);
    expect(matchesQuery("Heading", "Titles", "HEAD")).toBe(true);
    expect(matchesQuery("Heading", "Titles", "HeAd")).toBe(true);
  });

  it("matches a substring of the description (case-insensitive)", () => {
    expect(
      matchesQuery("Image", "Responsive image with alt text", "alt text"),
    ).toBe(true);
    expect(
      matchesQuery("Image", "Responsive image with alt text", "ALT TEXT"),
    ).toBe(true);
    expect(
      matchesQuery("Image", "Responsive image with alt text", "Alt Text"),
    ).toBe(true);
  });

  it("returns false when the query matches neither label nor description", () => {
    expect(matchesQuery("Heading", "Titles from H1 to H6", "carousel")).toBe(
      false,
    );
    expect(matchesQuery("Button", "Call-to-action", "xyz")).toBe(false);
  });

  it("treats the query itself case-insensitively (uppercase query, lowercase haystack)", () => {
    expect(matchesQuery("button", "call to action", "BUTTON")).toBe(true);
    expect(matchesQuery("button", "call to action", "ACTION")).toBe(true);
  });

  it("matches partial substrings, not just whole words", () => {
    expect(matchesQuery("ImageCarousel", "Swipeable slider", "carou")).toBe(
      true,
    );
    expect(matchesQuery("ScrollIndicator", "Floating hint", "indic")).toBe(
      true,
    );
  });
});

describe("CATEGORY_ORDER", () => {
  it("contains the expected categories in order", () => {
    expect(CATEGORY_ORDER).toEqual(["layout", "blocks", "components"]);
  });

  it("is a readonly tuple at the type level (frozen-like via `as const`)", () => {
    // `as const` produces a readonly tuple: array methods that mutate are
    // disallowed by TypeScript. We assert the runtime shape stays a plain
    // array with the expected length so consumers can iterate it safely.
    expect(Array.isArray(CATEGORY_ORDER)).toBe(true);
    expect(CATEGORY_ORDER).toHaveLength(3);
  });
});
