import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { z } from "zod";
import {
  loadCatalog,
  toToolDefinitionSpec,
  type CatalogEntry,
} from "./catalog";

/**
 * **Feature: agentic-foundation, Property 2: For any set of candidate Catalog_Entries, loadCatalog excludes exactly those entries missing any required field and surfaces an incomplete_entry error naming each excluded entry, while retaining all complete entries.**
 *
 * **Validates: Requirements 2.2, 2.8**
 *
 * The required fields of a Catalog_Entry (Requirement 2.2) are: name,
 * description, inputSchema, outputSchema, requiresOtp, permission, auditActor,
 * and handler. An entry missing ANY of these must be excluded from the loaded
 * catalog with an `incomplete_entry` error that names it (Requirement 2.8),
 * while every complete, uniquely-named entry must be retained.
 *
 * Note: `requiresOtp: false` is a VALID, PRESENT value — only `undefined`/
 * `null` count as missing — so complete entries are generated with both `true`
 * and `false`, and a `false` flag must never cause exclusion.
 */

// ── The fields a candidate entry may be missing ──────────────────────────────
// `name` is checked separately by loadCatalog, but a missing name still makes
// the entry incomplete, so it belongs in the omission pool.
const FIELD_POOL = [
  "name",
  "description",
  "inputSchema",
  "outputSchema",
  "requiresOtp",
  "permission",
  "auditActor",
  "handler",
] as const;

type CandidateSpec =
  | { kind: "complete"; requiresOtp: boolean }
  | { kind: "incomplete"; requiresOtp: boolean; missing: string[] };

const candidateArb: fc.Arbitrary<CandidateSpec> = fc.oneof(
  fc.record({
    kind: fc.constant("complete" as const),
    requiresOtp: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("incomplete" as const),
    requiresOtp: fc.boolean(),
    // at least one required field is dropped → guaranteed incomplete
    missing: fc.uniqueArray(fc.constantFrom(...FIELD_POOL), {
      minLength: 1,
      maxLength: FIELD_POOL.length,
    }),
  })
);

/**
 * Build a fully-populated CatalogEntry, then (for incomplete specs) delete the
 * chosen required fields. Names are assigned uniquely per index so the ONLY
 * reason an entry can be excluded is a missing field — never a duplicate name.
 */
function buildEntry(spec: CandidateSpec, index: number): CatalogEntry {
  const base: Record<string, unknown> = {
    name: `tool_${index}`,
    description: `description for tool ${index}`,
    inputSchema: z.object({ a: z.string() }),
    outputSchema: z.object({ b: z.number() }),
    requiresOtp: spec.requiresOtp,
    permission: "lead:create",
    auditActor: "agent:text-lead",
    handler: async () => ({ b: 1 }),
  };
  if (spec.kind === "incomplete") {
    for (const field of spec.missing) delete base[field];
  }
  return base as unknown as CatalogEntry;
}

describe("loadCatalog — catalog completeness (Property 2)", () => {
  it("excludes exactly the incomplete entries (naming each) and retains every complete entry", () => {
    fc.assert(
      fc.property(
        fc.array(candidateArb, { minLength: 0, maxLength: 12 }),
        (specs) => {
          const entries = specs.map(buildEntry);
          const completeIdx = specs
            .map((s, i) => ({ s, i }))
            .filter((x) => x.s.kind === "complete");
          const incompleteIdx = specs
            .map((s, i) => ({ s, i }))
            .filter((x) => x.s.kind === "incomplete") as {
            s: Extract<CandidateSpec, { kind: "incomplete" }>;
            i: number;
          }[];

          const result = loadCatalog(entries);

          // Every complete entry is retained, exactly, by its name.
          expect(result.catalog.size).toBe(completeIdx.length);
          for (const { i } of completeIdx) {
            expect(result.catalog.has(`tool_${i}`)).toBe(true);
          }
          // No incomplete entry leaks into the catalog.
          for (const { i } of incompleteIdx) {
            expect(result.catalog.has(`tool_${i}`)).toBe(false);
          }

          if (incompleteIdx.length === 0) {
            // All complete (and uniquely named) → the load succeeds.
            expect(result.ok).toBe(true);
            return;
          }

          // At least one incomplete entry → load fails with only
          // incomplete_entry errors, one per excluded entry.
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("unreachable");

          const incompleteErrors = result.errors.filter(
            (e) => e.code === "incomplete_entry"
          );
          // Exactly those entries missing a required field are reported.
          expect(incompleteErrors.length).toBe(incompleteIdx.length);
          // No spurious duplicate_name errors — names are unique by construction.
          expect(result.errors.every((e) => e.code === "incomplete_entry")).toBe(
            true
          );
          // Each excluded entry that still has a name is named in an error.
          for (const { s, i } of incompleteIdx) {
            if (!s.missing.includes("name")) {
              expect(
                incompleteErrors.some((e) => e.name === `tool_${i}`)
              ).toBe(true);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("retains a complete entry whose requiresOtp flag is false (false is a present value)", () => {
    const entry = buildEntry({ kind: "complete", requiresOtp: false }, 0);
    const result = loadCatalog([entry]);
    expect(result.ok).toBe(true);
    expect(result.catalog.has("tool_0")).toBe(true);
  });
});

/**
 * **Feature: agentic-foundation, Property 3: For any set of Catalog_Entries containing two entries with the same name, loadCatalog returns ok:false with a duplicate_name error naming the duplicated tool, and does not present a catalog containing both.**
 *
 * **Validates: Requirements 2.5, 2.9**
 *
 * A duplicate tool name poisons the whole catalog: `loadCatalog` must return
 * `ok: false` and surface a `duplicate_name` error naming the duplicated tool
 * (Requirement 2.5, 2.9). The assembled catalog is keyed by name, so it can
 * never hold both colliding entries — this property pins that guarantee down
 * across many generated entry sets, each carrying at least one duplicated name.
 */

describe("loadCatalog — catalog uniqueness (Property 3)", () => {
  it("rejects the catalog on a duplicated name, names the duplicate, and never presents both colliding entries", () => {
    fc.assert(
      fc.property(
        // Base entries: each flag yields one complete, uniquely-named entry
        // (tool_0, tool_1, …). At least one entry guarantees a name to clone.
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        // Which existing base name to duplicate.
        fc.nat(),
        // Where to splice the duplicate entry into the list (before/after/among).
        fc.nat(),
        (flags, dupSel, posSel) => {
          const baseEntries = flags.map((otp, i) =>
            buildEntry({ kind: "complete", requiresOtp: otp }, i)
          );

          const dupIndex = dupSel % baseEntries.length;
          const dupName = `tool_${dupIndex}`;
          const original = baseEntries[dupIndex];

          // A second, DISTINCT entry object that reuses the same name.
          const duplicate = buildEntry(
            { kind: "complete", requiresOtp: !flags[dupIndex] },
            dupIndex
          );
          expect(duplicate).not.toBe(original); // genuinely two objects, one name
          expect(duplicate.name).toBe(original.name);

          // Splice the duplicate in at an arbitrary position.
          const entries = [...baseEntries];
          const insertAt = posSel % (entries.length + 1);
          entries.splice(insertAt, 0, duplicate);

          const result = loadCatalog(entries);

          // The duplicate poisons the whole catalog (Requirement 2.5, 2.9).
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("unreachable");

          // A duplicate_name error is surfaced naming the duplicated tool.
          const dupErrors = result.errors.filter(
            (e) => e.code === "duplicate_name"
          );
          expect(dupErrors.length).toBeGreaterThanOrEqual(1);
          expect(dupErrors.some((e) => e.name === dupName)).toBe(true);

          // The catalog never presents BOTH colliding entries.
          const values = [...result.catalog.values()];
          expect(values.includes(original) && values.includes(duplicate)).toBe(
            false
          );
          // At most one entry is keyed to the duplicated name.
          const keptForDupName = values.filter((e) => e.name === dupName);
          expect(keptForDupName.length).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects two same-named entries with a duplicate_name error naming the tool (concrete example)", () => {
    const a = buildEntry({ kind: "complete", requiresOtp: false }, 0);
    const b = buildEntry({ kind: "complete", requiresOtp: true }, 0); // same name tool_0
    const result = loadCatalog([a, b]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(
      result.errors.some(
        (e) => e.code === "duplicate_name" && e.name === "tool_0"
      )
    ).toBe(true);

    const values = [...result.catalog.values()];
    expect(values.includes(a) && values.includes(b)).toBe(false);
    expect(result.catalog.size).toBe(1);
  });
});

/**
 * **Feature: agentic-foundation, Property 5: For any Catalog_Entry, toToolDefinitionSpec(entry).parameters is a valid JSON Schema derived from the entry's Zod input schema.**
 *
 * **Validates: Requirements 2.6**
 *
 * When a Catalog_Entry is exposed to a model for native tool-calling, the
 * catalog must generate the tool's argument schema as a *valid JSON Schema*
 * derived from the entry's Zod input schema. This property generates entries
 * over a wide variety of Zod input schemas (primitives, optionals, nullables,
 * enums, arrays, and nested objects) and asserts that for every one:
 *   - `name`/`description` are carried through unchanged;
 *   - `parameters` is exactly the JSON Schema Zod derives from the input schema
 *     (`z.toJSONSchema(entry.inputSchema)`), i.e. it is *derived from* it;
 *   - `parameters` is a well-formed JSON Schema object: a plain (non-array,
 *     non-null) object that is fully JSON-serialisable (round-trips through
 *     `JSON.stringify`/`JSON.parse` unchanged), describes an object type, and
 *     exposes exactly the input schema's top-level fields as `properties`.
 */

// A varied pool of Zod schemas used as object-field value types. Includes
// optionals, nullables, enums, arrays, and a nested object so the generated
// JSON Schema exercises every common shape.
const leafSchemaArb = fc.constantFrom<z.ZodTypeAny>(
  z.string(),
  z.number(),
  z.boolean(),
  z.string().optional(),
  z.number().nullable(),
  z.string().min(1).max(10),
  z.number().int(),
  z.enum(["x", "y", "z"]),
  z.array(z.string()),
  z.array(z.number()),
  z.object({ nested: z.string(), flag: z.boolean().optional() })
);

// An arbitrary Zod *object* input schema with 0–6 varied fields, plus the set
// of top-level field names it declares (used to check the derived properties).
const inputSchemaArb = fc
  .dictionary(
    fc.constantFrom("a", "b", "c", "d", "e", "f"),
    leafSchemaArb,
    { minKeys: 0, maxKeys: 6 }
  )
  .map((fields) => ({ fields, schema: z.object(fields) }));

function buildEntryWithSchema(
  inputSchema: z.ZodTypeAny,
  index: number
): CatalogEntry {
  return {
    name: `tool_${index}`,
    description: `description for tool ${index}`,
    inputSchema: inputSchema as z.ZodType,
    outputSchema: z.object({ b: z.number() }),
    requiresOtp: false,
    permission: "lead:create",
    auditActor: "agent:text-lead",
    handler: async () => ({ b: 1 }),
  } as unknown as CatalogEntry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("toToolDefinitionSpec — JSON Schema generation (Property 5)", () => {
  it("derives a valid JSON Schema from each entry's Zod input schema, carrying name/description through", () => {
    fc.assert(
      fc.property(inputSchemaArb, fc.integer({ min: 0, max: 9999 }), ({ fields, schema }, index) => {
        const entry = buildEntryWithSchema(schema, index);
        const spec = toToolDefinitionSpec(entry);

        // name/description are carried through unchanged.
        expect(spec.name).toBe(entry.name);
        expect(spec.description).toBe(entry.description);

        // Derived FROM the entry's Zod input schema: the parameters equal the
        // JSON Schema Zod produces for that exact input schema.
        expect(spec.parameters).toEqual(z.toJSONSchema(schema));

        // Well-formed JSON Schema object: a plain object (not an array/null).
        expect(isPlainObject(spec.parameters)).toBe(true);

        // Fully JSON-serialisable — round-trips unchanged (no functions, no
        // circular refs, no undefined-only keys).
        const roundTripped = JSON.parse(JSON.stringify(spec.parameters));
        expect(roundTripped).toEqual(spec.parameters);

        // Describes an object type and exposes EXACTLY the input schema's
        // top-level fields as JSON Schema `properties`.
        const params = spec.parameters as Record<string, unknown>;
        expect(params.type).toBe("object");
        const properties = (params.properties ?? {}) as Record<string, unknown>;
        expect(new Set(Object.keys(properties))).toEqual(new Set(Object.keys(fields)));
      }),
      { numRuns: 200 }
    );
  });

  it("produces parameters whose required fields are a subset of its declared properties", () => {
    // A representative schema mixing required and optional fields.
    const schema = z.object({
      title: z.string(),
      count: z.number(),
      note: z.string().optional(),
    });
    const entry = buildEntryWithSchema(schema, 0);
    const spec = toToolDefinitionSpec(entry);
    const params = spec.parameters as Record<string, unknown>;

    const properties = (params.properties ?? {}) as Record<string, unknown>;
    const required = (params.required ?? []) as string[];

    expect(params.type).toBe("object");
    expect(new Set(Object.keys(properties))).toEqual(
      new Set(["title", "count", "note"])
    );
    // Every required name is an actual declared property; the optional one is
    // not required.
    for (const name of required) {
      expect(Object.keys(properties)).toContain(name);
    }
    expect(required).not.toContain("note");
  });
});
