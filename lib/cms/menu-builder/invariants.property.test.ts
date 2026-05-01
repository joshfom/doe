import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateSlug } from "@/lib/cms/utils/menu-tree";

// ── Shared arbitraries ───────────────────────────────────────────────────────

/**
 * Generate non-empty strings containing at least one alphanumeric character.
 * This ensures the slug will be non-empty after processing.
 */
const nonEmptyNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => /[a-zA-Z0-9]/.test(s));

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Valid slug generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.1**
 *
 * Property 1: Valid slug generation
 *
 * For any non-empty name containing at least one alphanumeric character,
 * `generateSlug(name)` SHALL produce a non-empty string containing only
 * lowercase alphanumeric characters and hyphens, with no leading or
 * trailing hyphens.
 */
describe("Feature: menu-builder, Property 1: Valid slug generation", () => {
  it("produces a non-empty slug for any name with at least one alphanumeric character", () => {
    fc.assert(
      fc.property(nonEmptyNameArb, (name) => {
        const slug = generateSlug(name);
        expect(slug.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("contains only lowercase alphanumeric characters and hyphens", () => {
    fc.assert(
      fc.property(nonEmptyNameArb, (name) => {
        const slug = generateSlug(name);
        expect(slug).toMatch(/^[a-z0-9-]+$/);
      }),
      { numRuns: 100 }
    );
  });

  it("has no leading hyphens", () => {
    fc.assert(
      fc.property(nonEmptyNameArb, (name) => {
        const slug = generateSlug(name);
        expect(slug.startsWith("-")).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("has no trailing hyphens", () => {
    fc.assert(
      fc.property(nonEmptyNameArb, (name) => {
        const slug = generateSlug(name);
        expect(slug.endsWith("-")).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Position auto-assignment
// ─────────────────────────────────────────────────────────────────────────────

import { assignNextPosition } from "@/lib/cms/utils/menu-tree";

/**
 * **Validates: Requirements 2.1**
 *
 * Property 3: Position auto-assignment
 *
 * For any menu with N existing items at a given parent level, adding a new
 * menu item to that parent level SHALL assign it position N (zero-indexed),
 * making it the last item in that group.
 */
describe("Feature: menu-builder, Property 3: Position auto-assignment", () => {
  /** Arbitrary for a parentId value — either null (root) or a UUID-like string. */
  const parentIdArb = fc.oneof(
    fc.constant(null),
    fc.uuid()
  );

  /** Arbitrary for a single item with a parentId and position. */
  const itemArb = fc.record({
    parentId: parentIdArb,
    position: fc.nat({ max: 1000 }),
  });

  /** Arbitrary for an array of items (0–50 items). */
  const itemsArb = fc.array(itemArb, { minLength: 0, maxLength: 50 });

  it("assigns position equal to the count of existing items at the target parent level", () => {
    fc.assert(
      fc.property(itemsArb, parentIdArb, (items, targetParentId) => {
        const expectedPosition = items.filter(
          (item) => item.parentId === targetParentId
        ).length;

        const result = assignNextPosition(items, targetParentId);

        expect(result).toBe(expectedPosition);
      }),
      { numRuns: 100 }
    );
  });

  it("returns 0 when no items exist at the target parent level", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        // Use a parentId that doesn't exist in the items array
        const unusedParentId = "00000000-0000-0000-0000-000000000000";
        const filtered = items.filter(
          (item) => item.parentId !== unusedParentId
        );

        const result = assignNextPosition(filtered, unusedParentId);

        expect(result).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("returns N for root level (null parentId) when N root items exist", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const rootCount = items.filter(
          (item) => item.parentId === null
        ).length;

        const result = assignNextPosition(items, null);

        expect(result).toBe(rootCount);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 5: dropdown_type/item_type consistency
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeDropdownType } from "@/lib/cms/utils/menu-tree";
import type { ItemType } from "@/lib/cms/types";

/**
 * **Validates: Requirements 2.5, 2.6, 2.7, 12.5**
 *
 * Property 5: dropdown_type/item_type consistency
 *
 * For any menu item after any create or update operation, the `dropdown_type`
 * field SHALL be `null` when `item_type` is "link", `"simple"` when `item_type`
 * is "dropdown", and `"mega"` when `item_type` is "mega".
 */
describe("Feature: menu-builder, Property 5: dropdown_type/item_type consistency", () => {
  /** Arbitrary that produces a random ItemType value. */
  const itemTypeArb = fc.constantFrom<ItemType>("link", "dropdown", "mega");

  it("returns null for 'link' item type", () => {
    fc.assert(
      fc.property(fc.constant<ItemType>("link"), (itemType) => {
        expect(normalizeDropdownType(itemType)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("returns 'simple' for 'dropdown' item type", () => {
    fc.assert(
      fc.property(fc.constant<ItemType>("dropdown"), (itemType) => {
        expect(normalizeDropdownType(itemType)).toBe("simple");
      }),
      { numRuns: 100 }
    );
  });

  it("returns 'mega' for 'mega' item type", () => {
    fc.assert(
      fc.property(fc.constant<ItemType>("mega"), (itemType) => {
        expect(normalizeDropdownType(itemType)).toBe("mega");
      }),
      { numRuns: 100 }
    );
  });

  it("maps every ItemType to the correct dropdown_type", () => {
    const expectedMapping: Record<ItemType, string | null> = {
      link: null,
      dropdown: "simple",
      mega: "mega",
    };

    fc.assert(
      fc.property(itemTypeArb, (itemType) => {
        const result = normalizeDropdownType(itemType);
        expect(result).toBe(expectedMapping[itemType]);
      }),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Active URL matching
// ─────────────────────────────────────────────────────────────────────────────

import { isActiveUrl } from "@/lib/cms/utils/menu-tree";

/**
 * **Validates: Requirements 5.5**
 *
 * Property 9: Active URL matching
 *
 * For any menu item URL and current page URL, the active state detection
 * function SHALL return true if and only if the current URL matches the
 * menu item URL exactly or is a path-prefix match (for non-root URLs).
 */
describe("Feature: menu-builder, Property 9: Active URL matching", () => {
  /**
   * Arbitrary for a non-root URL path segment (e.g., "blog", "about", "contact").
   * Only lowercase alpha to keep things simple and avoid encoding issues.
   */
  const segmentArb = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
    .filter((s) => s.length > 0);

  /**
   * Arbitrary for a non-root URL path with 1–4 segments (e.g., "/blog", "/blog/post/123").
   */
  const nonRootPathArb = fc
    .array(segmentArb, { minLength: 1, maxLength: 4 })
    .map((segments) => "/" + segments.join("/"));

  /**
   * Arbitrary for any URL path (root or non-root).
   */
  const anyPathArb = fc.oneof(fc.constant("/"), nonRootPathArb);

  it("exact match always returns true for any URL", () => {
    fc.assert(
      fc.property(anyPathArb, (url) => {
        expect(isActiveUrl(url, url)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("path-prefix match returns true for non-root URLs", () => {
    fc.assert(
      fc.property(nonRootPathArb, segmentArb, (itemUrl, extraSegment) => {
        const currentUrl = itemUrl + "/" + extraSegment;
        expect(isActiveUrl(itemUrl, currentUrl)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("root URL '/' only matches exactly, not as prefix", () => {
    fc.assert(
      fc.property(nonRootPathArb, (currentUrl) => {
        // Root "/" should NOT match any non-root URL as a prefix
        expect(isActiveUrl("/", currentUrl)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("partial segment match returns false (e.g., '/blog' does NOT match '/blogger')", () => {
    fc.assert(
      fc.property(nonRootPathArb, segmentArb, (itemUrl, suffix) => {
        // Append extra chars directly (no slash) to create a partial segment match
        // e.g., "/blog" + "ger" = "/blogger" — should NOT match
        const currentUrl = itemUrl + suffix;
        // Only test when the suffix doesn't start with "/" (not a real sub-path)
        // and the resulting URL is different from itemUrl
        if (currentUrl !== itemUrl && !suffix.startsWith("/")) {
          expect(isActiveUrl(itemUrl, currentUrl)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
