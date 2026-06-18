import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { z, type ZodType } from "zod";
import type { CatalogEntry } from "./catalog";

/**
 * **Feature: agentic-foundation, Property 6: For any value generated as a valid input of a Catalog_Entry's Zod input schema, serialising it to JSON and parsing it back through the schema yields an equivalent value.**
 *
 * **Validates: Requirements 2.7**
 *
 * Catalog_Entry input schemas describe the arguments a model emits for native
 * tool-calling. Those arguments cross a JSON boundary: the model emits JSON,
 * the dispatcher parses it back through the entry's Zod input schema before
 * executing (Requirement 2.7). This property pins the round-trip guarantee —
 * any value that is valid under an entry's input schema survives
 * `JSON.parse(JSON.stringify(value))` re-parsed through the same schema with no
 * change in meaning.
 *
 * There is no `zod-fast-check` in the toolchain, so for each representative
 * Catalog_Entry input schema we pair it with a hand-built fast-check arbitrary
 * that generates only JSON-shaped values inside the schema's input space
 * (strings, finite numbers, booleans, enums, optional keys that are either
 * present-with-a-value or wholly absent, arrays, and nested objects). Each
 * generated value is first asserted to be VALID under the schema (so the
 * generators are honest), then the round-trip equivalence is checked against
 * the schema's own canonical parse output.
 */

// ── A representative Catalog_Entry input schema paired with its arbitrary ─────
interface SchemaCase<I> {
  /** The catalog entry whose `inputSchema` is exercised. */
  entry: CatalogEntry<I>;
  /** A generator that yields values inside the schema's input space. */
  arb: fc.Arbitrary<unknown>;
}

/** Wrap a schema in a minimal, complete Catalog_Entry so we exercise a real
 *  Catalog_Entry's input schema (not a bare Zod type). */
function entryFor<I>(name: string, inputSchema: ZodType<I>): CatalogEntry<I> {
  return {
    name,
    description: `representative entry ${name}`,
    inputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    requiresOtp: false,
    permission: "lead:create",
    auditActor: "agent:text-lead",
    handler: async () => ({ ok: true }),
  } as unknown as CatalogEntry<I>;
}

// Finite, JSON-safe number generators (NaN / ±Infinity are not representable in
// JSON, so they fall outside the "value serialisable to JSON" input space).
// `-0` is likewise not a distinct JSON value (`JSON.stringify(-0) === "0"`), so
// it is normalised to `+0`: a model emitting JSON arguments cannot produce a
// `-0` distinct from `0`.
const finiteInt = fc.integer({ min: -1_000_000, max: 1_000_000 });
const finiteNum = fc
  .double({
    noNaN: true,
    noDefaultInfinity: true,
    min: -1e9,
    max: 1e9,
  })
  .map((x) => (Object.is(x, -0) ? 0 : x));

// create_lead-like: required identity fields + optional qualification signals.
const createLeadSchema = z.object({
  name: z.string(),
  phone: z.string(),
  projectInterest: z.string().optional(),
  budgetBand: z.enum(["low", "mid", "high"]).optional(),
});
const createLeadArb = fc.record(
  {
    name: fc.string(),
    phone: fc.string(),
    projectInterest: fc.string(),
    budgetBand: fc.constantFrom("low", "mid", "high"),
  },
  { requiredKeys: ["name", "phone"] }
);

// create_booking-like: ids + date/time strings + a typed appointment kind.
const createBookingSchema = z.object({
  partyId: z.string(),
  slotId: z.string(),
  scheduledDate: z.string(),
  scheduledTime: z.string(),
  appointmentType: z.enum(["site_visit", "call", "meeting"]),
});
const createBookingArb = fc.record({
  partyId: fc.string(),
  slotId: fc.string(),
  scheduledDate: fc.string(),
  scheduledTime: fc.string(),
  appointmentType: fc.constantFrom("site_visit", "call", "meeting"),
});

// create_ticket-like: text fields, an enum priority, and an array of tags.
const createTicketSchema = z.object({
  subject: z.string(),
  description: z.string(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  tags: z.array(z.string()).optional(),
});
const createTicketArb = fc.record(
  {
    subject: fc.string(),
    description: fc.string(),
    priority: fc.constantFrom("low", "normal", "high", "urgent"),
    tags: fc.array(fc.string(), { maxLength: 6 }),
  },
  { requiredKeys: ["subject", "description", "priority"] }
);

// navigate-like: a path plus an optional nested params object and a boolean.
const navigateSchema = z.object({
  path: z.string(),
  replace: z.boolean(),
  params: z
    .object({
      query: z.string().optional(),
      page: z.number().int().optional(),
    })
    .optional(),
});
const navigateArb = fc.record(
  {
    path: fc.string(),
    replace: fc.boolean(),
    params: fc.record(
      {
        query: fc.string(),
        page: finiteInt,
      },
      { requiredKeys: [] }
    ),
  },
  { requiredKeys: ["path", "replace"] }
);

// numeric-heavy entry: integers, finite floats, and a boolean flag.
const metricsSchema = z.object({
  count: z.number().int(),
  ratio: z.number(),
  flag: z.boolean(),
});
const metricsArb = fc.record({
  count: finiteInt,
  ratio: finiteNum,
  flag: fc.boolean(),
});

const CASES: SchemaCase<unknown>[] = [
  { entry: entryFor("create_lead", createLeadSchema), arb: createLeadArb },
  { entry: entryFor("create_booking", createBookingSchema), arb: createBookingArb },
  { entry: entryFor("create_ticket", createTicketSchema), arb: createTicketArb },
  { entry: entryFor("navigate", navigateSchema), arb: navigateArb },
  { entry: entryFor("report_metrics", metricsSchema), arb: metricsArb },
];

describe("Catalog_Entry input schema — JSON round-trip (Property 6)", () => {
  for (const { entry, arb } of CASES) {
    it(`round-trips any valid input of "${entry.name}" through JSON and the schema`, () => {
      fc.assert(
        fc.property(arb, (value) => {
          // The generated value must be a VALID input of the entry's schema,
          // otherwise the property is vacuous (the generator would be lying).
          const parsedOk = entry.inputSchema.safeParse(value);
          expect(parsedOk.success).toBe(true);
          if (!parsedOk.success) return;

          // Canonical input = the schema's own parse output. Serialise it to
          // JSON, parse it back through the SAME schema (as the dispatcher
          // does with model-emitted arguments), and require equivalence.
          const canonical = parsedOk.data;
          const reparsed = entry.inputSchema.safeParse(
            JSON.parse(JSON.stringify(canonical))
          );

          expect(reparsed.success).toBe(true);
          if (!reparsed.success) return;
          expect(reparsed.data).toStrictEqual(canonical);
        }),
        { numRuns: 200 }
      );
    });
  }
});
