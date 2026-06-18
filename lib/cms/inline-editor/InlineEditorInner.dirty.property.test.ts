// @vitest-environment jsdom
/**
 * Dirty state equals data divergence — Property 10.
 *
 * Spec: live-page-editor — task 10.3
 * _Validates: Requirements 8.3_
 *
 * `InlineEditorInner` derives its unsaved-changes (dirty) indication as
 * divergence from the last successfully saved snapshot:
 *
 *     dirty = !puckDataEqual(currentData, savedSnapshot)
 *
 * where `savedSnapshot` is seeded to the loaded data and advanced to the current
 * data on each successful save. The dirty flag therefore flips on according to
 * the rule "current page data differs from the last successfully saved
 * snapshot" — shown if and only if they diverge (Req 8.3).
 *
 * This property drives a faithful pure model of that state machine over
 * generated edit/save sequences (seed snapshot = current; edit changes current;
 * save advances snapshot = current) and, after every step, asserts the derived
 * dirty flag equals an INDEPENDENT deep-equality oracle's divergence verdict.
 * The oracle canonicalises both values (recursively key-sorted JSON) and
 * compares the canonical strings — a genuinely different implementation from the
 * recursive `puckDataEqual` under test, so the test does not merely echo the
 * code. Targeted ops also pin the concrete sub-cases called out by the spec:
 * reverting an edit back to the saved snapshot → not dirty; re-ordering object
 * keys without structural change → not dirty; editing after a save → dirty
 * again.
 *
 * Tag: Feature: live-page-editor, Property 10: Dirty state equals data
 * divergence — unsaved-changes indication shown iff current page data differs
 * from the last successfully saved snapshot.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Polyfill ResizeObserver / matchMedia for jsdom BEFORE importing
// InlineEditorInner. The module transitively imports `usePuckStore` →
// `@puckeditor/core` → `@dnd-kit/dom`, which touches `ResizeObserver` at module
// scope. The pure `puckDataEqual` helper itself needs no DOM, but importing the
// module does.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

// Deferred import so the polyfills above are in place before the module (and its
// transitive @dnd-kit module-scope access) loads.
const { puckDataEqual } = await import("./InlineEditorInner");

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/**
 * Independent deep-equality oracle. Rather than mirroring `puckDataEqual`'s
 * recursive walk, it canonicalises each value into a string with object keys
 * recursively sorted, then compares the canonical forms. This is key-order
 * independent (matching the implementation's documented contract) yet derived
 * from a completely different mechanism, so agreement is meaningful.
 */
function canonical(value: Json): string {
  if (value === null || typeof value !== "object") {
    // Primitive: JSON.stringify gives a stable, distinct encoding per type/value
    // (e.g. `1` vs `"1"` vs `true` differ). -0 and 0 both stringify to "0",
    // which matches `puckDataEqual` treating `-0 === 0` as equal.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

function deepEqualOracle(a: Json, b: Json): boolean {
  return canonical(a) === canonical(b);
}

/** Deep clone via structuredClone — produces a fresh, reference-distinct copy. */
function clone(value: Json): Json {
  return structuredClone(value);
}

/**
 * Deep clone with every object's keys re-ordered (reversed at each level). The
 * result is STRUCTURALLY identical to the input but with a different key
 * insertion order, used to confirm dirty stays false across key re-ordering.
 */
function reorderKeysClone(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(reorderKeysClone);
  const out: { [key: string]: Json } = {};
  for (const k of Object.keys(value).reverse()) {
    out[k] = reorderKeysClone(value[k]);
  }
  return out;
}

// Safe object keys — a small fixed alphabet (Puck-flavoured plus generic) that
// deliberately excludes `__proto__` to avoid prototype-pollution pitfalls when
// building / cloning generated objects.
const KEY_ARB = fc.constantFrom(
  "content",
  "root",
  "props",
  "type",
  "id",
  "zones",
  "a",
  "b",
  "c",
);

// Arbitrary JSON-shaped page data. Numbers are finite (no NaN/Infinity) since
// Puck data is JSON-serialisable; keys are drawn from the safe alphabet above.
const jsonArb: fc.Arbitrary<Json> = fc.letrec<{ json: Json }>((tie) => ({
  json: fc.oneof(
    { maxDepth: 4, withCrossShrink: true },
    // Leaves
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string({ maxLength: 8 }),
    // Nodes
    fc.array(tie("json"), { maxLength: 4 }),
    fc.dictionary(KEY_ARB, tie("json"), { maxKeys: 5 }),
  ),
})).json;

// Page-data top-level: bias toward an object shell resembling real Puck data,
// while still allowing arbitrary nested JSON inside.
const pageDataArb: fc.Arbitrary<Json> = fc.oneof(
  { weight: 4, arbitrary: fc.dictionary(KEY_ARB, jsonArb, { maxKeys: 5 }) },
  { weight: 1, arbitrary: jsonArb },
);

// An operation in an edit/save sequence. Values are resolved against the live
// snapshot at simulation time so revert/reorder reference the real saved data.
type Op =
  | { kind: "editFresh"; value: Json } // set current to an arbitrary value
  | { kind: "revert" } // set current = clone(savedSnapshot) → not dirty
  | { kind: "reorder" } // set current = key-reordered clone → not dirty
  | { kind: "mutate" } // set current to a guaranteed-different value → dirty
  | { kind: "save" }; // advance savedSnapshot = current → not dirty

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: jsonArb.map((value): Op => ({ kind: "editFresh", value })) },
  { weight: 2, arbitrary: fc.constant<Op>({ kind: "revert" }) },
  { weight: 2, arbitrary: fc.constant<Op>({ kind: "reorder" }) },
  { weight: 2, arbitrary: fc.constant<Op>({ kind: "mutate" }) },
  { weight: 3, arbitrary: fc.constant<Op>({ kind: "save" }) },
);

const scenarioArb = fc.record({
  initial: pageDataArb,
  ops: fc.array(opArb, { minLength: 1, maxLength: 25 }),
});

describe("Feature: live-page-editor — Property 10: Dirty state equals data divergence", () => {
  it("shows the unsaved-changes indication iff current data differs from the last saved snapshot", () => {
    fc.assert(
      fc.property(scenarioArb, ({ initial, ops }) => {
        // Mirror InlineEditorInner: savedSnapshot seeded to the loaded data and
        // current starts equal to it (clean on load).
        let savedSnapshot: Json = initial;
        let current: Json = clone(initial);
        let mutateCounter = 0;

        // Sanity: on load, current equals the saved snapshot → not dirty.
        expect(puckDataEqual(current, savedSnapshot)).toBe(true);
        expect(!puckDataEqual(current, savedSnapshot)).toBe(
          !deepEqualOracle(current, savedSnapshot),
        );

        for (const op of ops) {
          switch (op.kind) {
            case "editFresh":
              current = op.value;
              break;
            case "revert":
              // Re-applying the exact saved data must clear dirty.
              current = clone(savedSnapshot);
              break;
            case "reorder":
              // Structurally identical with re-ordered keys must clear dirty.
              current = reorderKeysClone(savedSnapshot);
              break;
            case "mutate": {
              // Wrap the saved snapshot alongside a unique sentinel, which is
              // guaranteed to differ structurally from the snapshot → dirty.
              current = [clone(savedSnapshot), { __dirty__: mutateCounter++ }];
              break;
            }
            case "save":
              // A successful save advances the snapshot to the current data.
              savedSnapshot = current;
              break;
          }

          // The editor derives dirty as divergence from the saved snapshot.
          const dirty = !puckDataEqual(current, savedSnapshot);

          // Core Property 10: dirty iff current data differs from the last saved
          // snapshot, judged by the independent oracle (Req 8.3).
          expect(dirty).toBe(!deepEqualOracle(current, savedSnapshot));

          // Targeted sub-cases the spec calls out explicitly:
          switch (op.kind) {
            case "revert":
            case "reorder":
            case "save":
              // Just made current match the saved snapshot → not dirty.
              expect(dirty).toBe(false);
              break;
            case "mutate":
              // Edited after the snapshot with a guaranteed-different value →
              // dirty again.
              expect(dirty).toBe(true);
              break;
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
