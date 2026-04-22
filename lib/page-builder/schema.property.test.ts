import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Feature: puck-visual-page-builder, Property 1: PageData JSON serialization round-trip
 *
 * Validates: Requirements 11.4
 *
 * For any valid PageData object, serializing it to a JSON string via
 * JSON.stringify and then parsing it back via JSON.parse SHALL produce
 * an object deeply equal to the original.
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

// --- Property Test ---

describe("PageData JSON serialization round-trip", () => {
  it("JSON.parse(JSON.stringify(pageData)) deep equals pageData", () => {
    fc.assert(
      fc.property(pageDataArb, (pageData) => {
        const serialized = JSON.stringify(pageData);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(pageData);
      }),
      { numRuns: 20 },
    );
  });
});

import { validatePageData } from "./schema";

/**
 * Feature: puck-visual-page-builder, Property 6: Schema validation rejects invalid PageData
 *
 * Validates: Requirements 11.1, 11.2, 11.3
 *
 * For any malformed PageData (missing `root`, missing `content`, component
 * instance missing `type` or `props.id`), the schema validator SHALL return
 * a failure result with at least one descriptive error containing a path.
 * For any valid PageData, the validator SHALL return success.
 */

// --- Invalid PageData Arbitraries ---

/** Generates PageData missing the `root` field */
const missingRootArb = fc
  .array(componentInstanceArb, { minLength: 0, maxLength: 3 })
  .map((content) => ({ content }));

/** Generates PageData missing the `content` field */
const missingContentArb = extraPropsArb.map((props) => ({
  root: { props },
}));

/** Generates PageData with a component instance missing `type` (empty string) */
const missingTypeArb = fc
  .record({
    root: fc.record({ props: extraPropsArb }),
    content: fc.tuple(
      fc.string({ minLength: 1 }).map((id) => ({
        type: "",
        props: { id },
      })),
    ).map(([bad]) => [bad]),
  });

/** Generates PageData with a component instance missing `props.id` (empty string) */
const missingPropsIdArb = fc
  .record({
    root: fc.record({ props: extraPropsArb }),
    content: fc.tuple(
      fc.string({ minLength: 1 }).map((type) => ({
        type,
        props: { id: "" },
      })),
    ).map(([bad]) => [bad]),
  });

describe("Schema validation rejects invalid PageData", () => {
  it("valid PageData passes validation", () => {
    fc.assert(
      fc.property(pageDataArb, (pageData) => {
        const result = validatePageData(pageData);
        expect(result.success).toBe(true);
        expect(result.errors).toBeUndefined();
      }),
      { numRuns: 20 },
    );
  });

  it("PageData missing root fails validation with descriptive error", () => {
    fc.assert(
      fc.property(missingRootArb, (data) => {
        const result = validatePageData(data);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(1);
        expect(result.errors!.some((e) => e.path !== undefined && e.message.length > 0)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it("PageData missing content fails validation with descriptive error", () => {
    fc.assert(
      fc.property(missingContentArb, (data) => {
        const result = validatePageData(data);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(1);
        expect(result.errors!.some((e) => e.path !== undefined && e.message.length > 0)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it("component instance with empty type fails validation", () => {
    fc.assert(
      fc.property(missingTypeArb, (data) => {
        const result = validatePageData(data);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(1);
        expect(result.errors!.some((e) => e.path !== undefined && e.message.length > 0)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it("component instance with empty props.id fails validation", () => {
    fc.assert(
      fc.property(missingPropsIdArb, (data) => {
        const result = validatePageData(data);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(1);
        expect(result.errors!.some((e) => e.path !== undefined && e.message.length > 0)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});
