import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { InMemoryDataStore } from "./data-store";

/**
 * Feature: puck-visual-page-builder, Property 2: DataStore save/load round-trip
 *
 * Validates: Requirements 5.4
 *
 * For any valid PageData object and any page identifier, saving the PageData
 * via the DataStore and then loading it back SHALL return PageData equivalent
 * to the originally saved data.
 */

// --- Arbitraries ---

/** JSON-safe value arbitrary (primitives, arrays, plain objects — no undefined) */
const jsonSafeValue: fc.Arbitrary<unknown> = fc.jsonValue().map((v) =>
  JSON.parse(JSON.stringify(v)),
);

const safeKeyArb = fc.string({ minLength: 1 }).filter((s) => s !== "__proto__");

/** Generates extra props as a plain object (JSON-normalized) */
const extraPropsArb = fc
  .array(fc.tuple(safeKeyArb, jsonSafeValue), { maxLength: 3 })
  .map((entries) => Object.fromEntries(entries));

/** Generates a valid ComponentInstance */
const componentInstanceArb = fc
  .record({
    type: fc.string({ minLength: 1 }),
    id: fc.string({ minLength: 1 }),
  })
  .chain((base) =>
    extraPropsArb.map((extra) => ({
      type: base.type,
      props: { ...extra, id: base.id },
    })),
  );

/** Generates a valid PageData object (JSON-normalized) */
const pageDataArb = fc
  .record({
    root: fc.record({
      props: extraPropsArb,
    }),
    content: fc.array(componentInstanceArb, { maxLength: 5 }),
  })
  .chain((base) =>
    fc
      .option(
        fc
          .array(
            fc.tuple(
              safeKeyArb,
              fc.array(componentInstanceArb, { maxLength: 3 }),
            ),
            { maxLength: 2 },
          )
          .map((entries) => Object.fromEntries(entries)),
        { nil: undefined },
      )
      .map((zones) => {
        const data: Record<string, unknown> = {
          root: base.root,
          content: base.content,
        };
        if (zones !== undefined) {
          data.zones = zones;
        }
        return data;
      }),
  );

/** Generates a non-empty page identifier string */
const pageIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// --- Property Test ---

describe("DataStore save/load round-trip", () => {
  it("loading saved PageData returns equivalent data", async () => {
    const store = new InMemoryDataStore();

    await fc.assert(
      fc.asyncProperty(pageIdArb, pageDataArb, async (pageId, pageData) => {
        await store.save(pageId, pageData as any);
        const loaded = await store.load(pageId);

        expect(loaded).not.toBeNull();
        expect(loaded).toEqual(pageData);
      }),
      { numRuns: 20 },
    );
  });
});
