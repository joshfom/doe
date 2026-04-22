import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateSlug } from "./slug";

/**
 * **Validates: Requirements 2.1**
 *
 * Property 1: Slug generation produces URL-safe deterministic output
 *
 * For any non-empty title string, generateSlug(title) SHALL produce a
 * lowercase string containing only alphanumeric characters and hyphens,
 * and calling generateSlug again with the same title SHALL produce the
 * same slug (deterministic).
 */
describe("Feature: ora-cms-platform, Property 1: Slug generation produces URL-safe deterministic output", () => {
  it("output only contains [a-z0-9-] characters (or is empty for strings with no alphanumeric content)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (title) => {
        const slug = generateSlug(title);
        // Slug must either be empty (no alphanumeric content) or match URL-safe pattern
        expect(slug).toMatch(/^[a-z0-9-]*$/);
      }),
      { numRuns: 20 }
    );
  });

  it("output is always lowercase", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (title) => {
        const slug = generateSlug(title);
        expect(slug).toBe(slug.toLowerCase());
      }),
      { numRuns: 20 }
    );
  });

  it("same input always produces same output (deterministic)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (title) => {
        const slug1 = generateSlug(title);
        const slug2 = generateSlug(title);
        expect(slug1).toBe(slug2);
      }),
      { numRuns: 20 }
    );
  });
});

import { ensureUniqueSlug } from "./slug";

/**
 * **Validates: Requirements 2.2**
 *
 * Property 2: Slug deduplication ensures uniqueness
 *
 * For any base slug and any set of existing slugs,
 * `ensureUniqueSlug(baseSlug, existingSlugs)` SHALL return a slug that
 * is NOT present in the existing set. If the base slug is not in the set,
 * it SHALL be returned as-is. If it is in the set, the returned slug
 * SHALL follow the pattern `{baseSlug}-{N}` where N is a positive integer.
 */
describe("Feature: ora-cms-platform, Property 2: Slug deduplication ensures uniqueness", () => {
  it("result is never in the existing slugs set", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/), { maxLength: 20 }),
        (baseSlug, existingSlugs) => {
          const result = ensureUniqueSlug(baseSlug, existingSlugs);
          expect(existingSlugs).not.toContain(result);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("if baseSlug is not in existingSlugs, result equals baseSlug", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/), { maxLength: 20 }),
        (baseSlug, existingSlugs) => {
          fc.pre(!existingSlugs.includes(baseSlug));
          const result = ensureUniqueSlug(baseSlug, existingSlugs);
          expect(result).toBe(baseSlug);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("if baseSlug is in existingSlugs, result matches pattern {baseSlug}-{N}", () => {
    const slugArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/);
    // Generate a baseSlug and an array that always contains it
    const arbWithCollision = slugArb.chain((baseSlug) =>
      fc.array(slugArb, { maxLength: 19 }).map((others) => ({
        baseSlug,
        existingSlugs: [baseSlug, ...others],
      }))
    );

    fc.assert(
      fc.property(arbWithCollision, ({ baseSlug, existingSlugs }) => {
        const result = ensureUniqueSlug(baseSlug, existingSlugs);
        const pattern = new RegExp(`^${baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
        const match = result.match(pattern);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBeGreaterThan(0);
      }),
      { numRuns: 20 }
    );
  });
});
