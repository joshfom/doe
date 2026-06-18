// @vitest-environment jsdom
/**
 * Property-based test for the Component_Sheet search filter.
 *
 * Feature: live-page-editor, Property 5: Component search filter is a case-insensitive substring match
 *
 * For any set of available components and any query string, the components
 * listed by the Component_Sheet are exactly those whose name (label) or
 * description contains the query as a case-insensitive substring; an empty
 * query lists all available components, and a query that matches none lists
 * zero components.
 *
 * The filter is the pure `matchesQuery(label, description, query)` helper,
 * imported here from the ComponentSheet module (which re-exports the single
 * source of truth from `palette-meta`). Its semantics (confirmed in source):
 *   - empty query (`!query`) → matches everything;
 *   - otherwise case-insensitive substring over `label` OR `description`.
 *
 * The Component_Sheet lists a component iff `matchesQuery` returns true, so we
 * model the listing as `registry.filter((c) => matchesQuery(...))` and assert
 * it equals an independently-computed expected set (the core biconditional),
 * plus the empty-query-lists-all and absent-query-lists-zero corollaries.
 *
 * **Validates: Requirements 6.5, 6.6, 6.7**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Polyfill ResizeObserver for jsdom — must be set before importing the
// ComponentSheet module, which transitively loads @dnd-kit/dom (via the Puck
// store) that accesses ResizeObserver at module scope.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation. The task
// requires the helper to be imported from the ComponentSheet module, which
// re-exports the single source of truth (`matchesQuery`) from `palette-meta`.
const { matchesQuery } = await import("@/lib/cms/live-editor/ComponentSheet");

// ── Model under test ─────────────────────────────────────────────────────────

interface Component {
  label: string;
  description: string;
}

/** The Component_Sheet's listing: keep exactly the components that match. */
function listComponents(registry: Component[], query: string): Component[] {
  return registry.filter((c) => matchesQuery(c.label, c.description, query));
}

/**
 * Independent oracle for the expected listed set — re-derived from the
 * acceptance criteria, NOT by calling `matchesQuery`, so the property is a
 * genuine cross-check rather than a tautology.
 */
function expectedListing(registry: Component[], query: string): Component[] {
  if (query === "") return registry.slice();
  const needle = query.toLowerCase();
  return registry.filter(
    (c) =>
      c.label.toLowerCase().includes(needle) ||
      c.description.toLowerCase().includes(needle),
  );
}

// ── Generators ───────────────────────────────────────────────────────────────

/** Arbitrary component registries with unconstrained (unicode) text. */
const componentArb: fc.Arbitrary<Component> = fc.record({
  label: fc.string(),
  description: fc.string(),
});

const registryArb: fc.Arbitrary<Component[]> = fc.array(componentArb, {
  minLength: 0,
  maxLength: 15,
});

/** Arbitrary query strings, including the empty string. */
const queryArb: fc.Arbitrary<string> = fc.string();

// ── Generators for the "query is a real substring of an entry" corollary ──────

const asciiCharArb = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ".split(""),
);
const asciiTextArb: fc.Arbitrary<string> = fc
  .array(asciiCharArb, { minLength: 0, maxLength: 20 })
  .map((cs) => cs.join(""));

const asciiRegistryArb: fc.Arbitrary<Component[]> = fc.array(
  fc.record({ label: asciiTextArb, description: asciiTextArb }),
  { minLength: 1, maxLength: 12 },
);

/** Toggle each character's case according to a repeating boolean seed. */
function recase(s: string, seed: boolean[]): string {
  return [...s]
    .map((ch, i) =>
      seed[i % seed.length] ? ch.toUpperCase() : ch.toLowerCase(),
    )
    .join("");
}

/**
 * A registry plus a query that is guaranteed to be a (re-cased) substring of
 * some entry's label or description. Used to prove matching entries are listed.
 */
const registryWithSubstringArb = asciiRegistryArb
  .chain((registry) => {
    const haystacks: string[] = [];
    for (const c of registry) {
      if (c.label.length > 0) haystacks.push(c.label);
      if (c.description.length > 0) haystacks.push(c.description);
    }
    if (haystacks.length === 0) {
      return fc.constant(null as { registry: Component[]; query: string } | null);
    }
    return fc.constantFrom(...haystacks).chain((h) =>
      fc
        .tuple(
          fc.nat({ max: h.length - 1 }),
          fc.integer({ min: 1, max: h.length }),
          fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        )
        .map(([start, len, seed]) => ({
          registry,
          query: recase(h.slice(start, start + len), seed),
        })),
    );
  })
  .filter(
    (x): x is { registry: Component[]; query: string } =>
      x !== null && x.query.length > 0,
  );

// ── Generators for the "absent query lists zero" corollary ────────────────────

// Registry text drawn from letters a–m + space only…
const restrictedTextArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abcdefghijklm ".split("")), {
    minLength: 0,
    maxLength: 20,
  })
  .map((cs) => cs.join(""));

const restrictedRegistryArb: fc.Arbitrary<Component[]> = fc.array(
  fc.record({ label: restrictedTextArb, description: restrictedTextArb }),
  { minLength: 0, maxLength: 12 },
);

// …so a non-empty query of digits can never appear in any label/description
// (digits are unaffected by `toLowerCase`, and the haystacks contain none).
const absentQueryArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."0123456789".split("")), {
    minLength: 1,
    maxLength: 6,
  })
  .map((cs) => cs.join(""));

// ── Properties ───────────────────────────────────────────────────────────────

describe("Feature: live-page-editor, Property 5: Component search filter is a case-insensitive substring match", () => {
  it("lists exactly the components matching the query (case-insensitive substring biconditional)", () => {
    fc.assert(
      fc.property(registryArb, queryArb, (registry, query) => {
        expect(listComponents(registry, query)).toEqual(
          expectedListing(registry, query),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("lists all components for an empty query", () => {
    fc.assert(
      fc.property(registryArb, (registry) => {
        expect(listComponents(registry, "")).toEqual(registry);
      }),
      { numRuns: 100 },
    );
  });

  it("includes every entry whose label/description contains the query (any case)", () => {
    fc.assert(
      fc.property(registryWithSubstringArb, ({ registry, query }) => {
        const listed = listComponents(registry, query);
        const needle = query.toLowerCase();

        // At least one entry must match (the query came from a real haystack).
        const independentlyMatching = registry.filter(
          (c) =>
            c.label.toLowerCase().includes(needle) ||
            c.description.toLowerCase().includes(needle),
        );
        expect(independentlyMatching.length).toBeGreaterThan(0);

        // Every independently-matching entry is listed, and nothing else is.
        expect(listed).toEqual(independentlyMatching);
      }),
      { numRuns: 100 },
    );
  });

  it("lists zero components for a query that matches none", () => {
    fc.assert(
      fc.property(restrictedRegistryArb, absentQueryArb, (registry, query) => {
        expect(listComponents(registry, query)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
