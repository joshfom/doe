import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { webFormAdapter } from "./web-form";
import type { NormalizeResult } from "../inbound";

/**
 * Property test for deterministic normalization (task 2.3).
 *
 * **Feature: lead-engine, Property 3: Normalizing the same Raw_Payload twice yields a field-equal InboundLead with an identical idempotencyKey.**
 *
 * **Validates: Requirements 2.4**
 *
 * The `web_form` adapter (Design §Components #1) derives every field of the
 * produced InboundLead — including `capturedAt` and the `idempotencyKey` — as a
 * pure function of the Raw_Payload, never the wall clock. This property
 * exercises that contract: for any valid `web_form` Raw_Payload (one matching
 * `webFormRawPayloadSchema`), normalizing it twice must produce two
 * field-by-field deeply-equal InboundLeads with an identical idempotencyKey.
 *
 * This is a pure-function test — no database is required.
 */

// Iteration count is env-configurable for fast local runs; CI sets PBT_NUM_RUNS=100.
const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 10);

/** A clean, non-blank token (letters/digits) — survives the schema's `.trim()`
 * and `.min(1)` bounds, so generated submissions are always schema-valid. */
const token = (maxLength: number) =>
  fc
    .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
      minLength: 1,
      maxLength,
    })
    .map((chars) => chars.join(""));

/** A syntactically valid email the public-ticket schema accepts. */
const emailArb = fc
  .tuple(token(12), token(10))
  .map(([local, domain]) => `${local}@${domain}.com`);

/** A phone-shaped string (raw phone is retained verbatim in-memory). */
const phoneArb = fc
  .array(fc.constantFrom(..."0123456789".split("")), { minLength: 7, maxLength: 12 })
  .map((d) => `+${d.join("")}`);

/** One `ora_attribution` touch record — all fields optional strings. */
const touchArb = fc.record(
  {
    utm_source: fc.option(token(20), { nil: undefined }),
    utm_medium: fc.option(token(20), { nil: undefined }),
    utm_campaign: fc.option(token(20), { nil: undefined }),
    utm_content: fc.option(token(20), { nil: undefined }),
    referrer: fc.option(token(20), { nil: undefined }),
    landing_path: fc.option(token(20), { nil: undefined }),
  },
  { requiredKeys: [] }
);

const attributionArb = fc.option(
  fc.record({ first_touch: touchArb, last_touch: touchArb }),
  { nil: undefined }
);

/** A valid `web_form` Raw_Payload matching `webFormRawPayloadSchema`. */
const webFormRawPayloadArb = fc.record(
  {
    submission: fc.record(
      {
        subject: token(60),
        description: token(120),
        contactName: token(40),
        contactEmail: emailArb,
        contactPhone: fc.option(phoneArb, { nil: undefined }),
        priority: fc.option(fc.constantFrom("low", "medium", "high", "urgent"), {
          nil: undefined,
        }),
        category: fc.option(token(20), { nil: undefined }),
        unitNumber: fc.option(token(10), { nil: undefined }),
      },
      { requiredKeys: ["subject", "description", "contactName", "contactEmail"] }
    ),
    capturedAt: fc
      .date({
        min: new Date("2020-01-01T00:00:00.000Z"),
        max: new Date("2030-01-01T00:00:00.000Z"),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString()),
    attribution: attributionArb,
    ticketId: fc.option(token(24), { nil: undefined }),
    ticketNumber: fc.option(token(12), { nil: undefined }),
  },
  { requiredKeys: ["submission", "capturedAt"] }
);

function expectOk(
  result: NormalizeResult
): asserts result is Extract<NormalizeResult, { ok: true }> {
  expect(result.ok).toBe(true);
}

describe("web_form adapter — Property 3: deterministic normalization (Req 2.4)", () => {
  it("normalizing the same Raw_Payload twice yields a field-equal InboundLead with an identical idempotencyKey", () => {
    fc.assert(
      fc.property(webFormRawPayloadArb, (raw) => {
        const first = webFormAdapter.normalize(raw);
        const second = webFormAdapter.normalize(raw);

        // The generated payloads are all schema-valid, so both runs succeed.
        expectOk(first);
        expectOk(second);

        // Field-by-field deep equality of the whole canonical lead, …
        expect(second.lead).toEqual(first.lead);
        // … and explicitly the identical idempotency key.
        expect(second.lead.idempotencyKey).toBe(first.lead.idempotencyKey);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
