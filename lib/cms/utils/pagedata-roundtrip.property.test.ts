import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Property-based tests for PageData JSON round-trip integrity.
 *
 * **Validates: Requirements 2.6, 14.6**
 *
 * Property 3: PageData JSON round-trip integrity
 *
 * For any valid PageData object, `JSON.parse(JSON.stringify(data))` SHALL
 * produce a deeply equal object.
 */

// ── Arbitraries ──────────────────────────────────────────────────────────────

const componentInstanceArb = fc.record({
  type: fc.constantFrom(
    "Hero",
    "Text",
    "Image",
    "ContentBlock",
    "PropertyCard",
    "FormBuilder"
  ),
  props: fc.record({
    id: fc.uuid(),
  }).chain((base) =>
    fc
      .dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
        fc.oneof(
          fc.string({ maxLength: 50 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null)
        ),
        { minKeys: 0, maxKeys: 5 }
      )
      .map((extra) => ({ ...base, ...extra }))
  ),
});

const pageDataArb = fc.record({
  root: fc.record({
    props: fc
      .dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
        fc.oneof(
          fc.string({ maxLength: 30 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null)
        ),
        { minKeys: 0, maxKeys: 4 }
      )
      .map((extra) => ({
        title: undefined as string | undefined,
        ...extra,
      }))
      .chain((base) =>
        fc
          .option(fc.string({ minLength: 1, maxLength: 20 }), {
            nil: undefined,
          })
          .map((title) => (title ? { ...base, title } : base))
      ),
  }),
  content: fc.array(componentInstanceArb, { maxLength: 5 }),
  zones: fc
    .option(
      fc.dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,15}$/),
        fc.array(componentInstanceArb, { maxLength: 3 }),
        { minKeys: 0, maxKeys: 3 }
      ),
      { nil: undefined }
    )
    .map((z) => z ?? undefined),
});

// ── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: ora-cms-platform, Property 3: PageData JSON round-trip integrity", () => {
  it("JSON.parse(JSON.stringify(pageData)) produces a deeply equal object", () => {
    fc.assert(
      fc.property(pageDataArb, (data) => {
        const serialized = JSON.stringify(data);
        const deserialized = JSON.parse(serialized);

        // Deep equality check
        expect(deserialized).toEqual(data);

        // Verify structure is preserved
        expect(deserialized.root).toBeDefined();
        expect(deserialized.root.props).toBeDefined();
        expect(Array.isArray(deserialized.content)).toBe(true);
        expect(deserialized.content.length).toBe(data.content.length);

        // Verify each component instance round-trips
        for (let i = 0; i < data.content.length; i++) {
          expect(deserialized.content[i].type).toBe(data.content[i].type);
          expect(deserialized.content[i].props.id).toBe(
            data.content[i].props.id
          );
        }

        // Verify zones round-trip if present
        if (data.zones) {
          expect(deserialized.zones).toBeDefined();
          for (const [zoneKey, zoneComponents] of Object.entries(data.zones)) {
            expect(deserialized.zones[zoneKey]).toBeDefined();
            expect(deserialized.zones[zoneKey].length).toBe(
              zoneComponents.length
            );
          }
        }
      }),
      { numRuns: 20 }
    );
  });

  it("round-trip preserves all prop types (string, number, boolean, null)", () => {
    fc.assert(
      fc.property(pageDataArb, (data) => {
        const roundTripped = JSON.parse(JSON.stringify(data));

        // Walk through all content components and verify prop types
        for (let i = 0; i < data.content.length; i++) {
          const original = data.content[i].props;
          const restored = roundTripped.content[i].props;

          for (const [key, value] of Object.entries(original)) {
            if (value === null) {
              expect(restored[key]).toBeNull();
            } else {
              expect(typeof restored[key]).toBe(typeof value);
              expect(restored[key]).toEqual(value);
            }
          }
        }
      }),
      { numRuns: 20 }
    );
  });
});
