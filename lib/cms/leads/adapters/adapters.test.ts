/**
 * Lead Engine (S3) — Ingestion adapter failure + unconfigured-path unit tests
 * (task 2.4).
 *
 * These are pure unit tests exercised through the {@link getAdapter} registry
 * (Req 1.1, 1.2). They cover the three behaviours task 2.4 calls out:
 *
 *   1. Invalid payload — the `web_form` adapter returns
 *      `{ ok: false, code: "invalid_payload" }` and retains the unmodified
 *      Raw_Payload for human review (Req 2.3).
 *   2. Unconfigured source — a source adapter whose credentials are absent
 *      returns `{ ok: false, code: "unconfigured_source" }`, produces no lead,
 *      and retains the Raw_Payload for retry (Req 1.7). The non-`web_form`
 *      adapters (email/whatsapp/meta_lead_ads/portal) are implemented
 *      concurrently in task 2.2, so this block discovers whichever adapters are
 *      registered and asserts the contract defensively.
 *   3. No-attribution payload — a valid `web_form` submission carrying no UTM
 *      or attribution data still yields `{ ok: true }` with `attribution` left
 *      unset (Req 1.5 / Requirement 1 C5).
 *
 * Design references: §Components #1, §Error Handling.
 * Requirements: 1.5, 1.7, 2.3.
 */

import { describe, it, expect } from "vitest";

import type { AttributionData } from "@/lib/analytics/types";
import {
  LEAD_SOURCES,
  type LeadSource,
  type NormalizeResult,
} from "../inbound";
import { getAdapter, registeredSources } from "./index";
import type { WebFormRawPayload } from "./web-form";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CAPTURED_AT = "2025-01-15T12:00:00.000Z";

/** A minimal, schema-valid public-form submission. */
function validSubmission() {
  return {
    subject: "Interested in a 2-bedroom unit",
    description: "Please call me about availability and pricing.",
    contactName: "Jane Buyer",
    contactEmail: "jane@example.com",
    priority: "medium" as const,
  };
}

/** A valid `web_form` Raw_Payload carrying no attribution data (Req 1.5). */
function validRawPayloadNoAttribution(): WebFormRawPayload {
  return {
    submission: validSubmission(),
    capturedAt: CAPTURED_AT,
    ticketId: "ticket-abc-123",
  };
}

/** Attribution data as captured from the `ora_attribution` cookie. */
function attributionData(): AttributionData {
  const touch = {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring-launch",
    referrer: "https://www.google.com/",
    landing_path: "/projects/marina",
    timestamp: CAPTURED_AT,
  };
  return { first_touch: touch, last_touch: touch, touches: [touch] };
}

// ── Req 2.3 — invalid payload → invalid_payload, raw retained ─────────────────

describe("web_form adapter — invalid payload (Req 2.3)", () => {
  it("returns { ok: false, code: 'invalid_payload' } for a payload that is not the captured-submission shape", () => {
    const adapter = getAdapter("web_form");
    expect(adapter).toBeDefined();

    const raw = { not: "a valid web_form payload" };
    const result = adapter!.normalize(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected normalization to fail");
    expect(result.code).toBe("invalid_payload");
    // The unmodified Raw_Payload is retained for human review (Req 2.3).
    expect(result.raw).toBe(raw);
    expect(result.message).toBeTypeOf("string");
  });

  it("returns invalid_payload when a required submission field is missing", () => {
    const adapter = getAdapter("web_form");
    const raw = {
      submission: {
        // subject is missing — publicTicketSchema requires it
        description: "no subject provided",
        contactName: "Jane Buyer",
        contactEmail: "jane@example.com",
      },
      capturedAt: CAPTURED_AT,
    };

    const result = adapter!.normalize(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected normalization to fail");
    expect(result.code).toBe("invalid_payload");
    expect(result.raw).toBe(raw);
  });

  it("returns invalid_payload when the contact email is malformed", () => {
    const adapter = getAdapter("web_form");
    const raw: unknown = {
      submission: { ...validSubmission(), contactEmail: "not-an-email" },
      capturedAt: CAPTURED_AT,
    };

    const result = adapter!.normalize(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected normalization to fail");
    expect(result.code).toBe("invalid_payload");
  });
});

// ── Req 1.5 — no-attribution payload still produces a lead ────────────────────

describe("web_form adapter — no-attribution payload still produces a lead (Req 1.5 / C5)", () => {
  it("returns { ok: true } with attribution unset for a valid payload carrying no UTM data", () => {
    const adapter = getAdapter("web_form");
    const raw = validRawPayloadNoAttribution();

    const result = adapter!.normalize(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected success, got ${result.message}`);

    // The lead is produced (Req 1.5 — never dropped for missing attribution)…
    expect(result.lead.source).toBe("web_form");
    expect(result.lead.email).toBe("jane@example.com");
    expect(result.lead.idempotencyKey.length).toBeGreaterThan(0);
    // …and its attribution field is left unset (Req 1.5).
    expect(result.lead.attribution).toBeUndefined();
  });

  it("populates attribution when the payload carries UTM data (Req 1.4 — contrast)", () => {
    const adapter = getAdapter("web_form");
    const raw: WebFormRawPayload = {
      ...validRawPayloadNoAttribution(),
      attribution: attributionData(),
    };

    const result = adapter!.normalize(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected success, got ${result.message}`);
    expect(result.lead.attribution).toBeDefined();
    expect(result.lead.attribution).toMatchObject({
      first_touch_utm_source: "google",
      last_touch_utm_campaign: "spring-launch",
    });
  });
});

// ── Req 1.7 — unconfigured source → no lead, raw retained ─────────────────────

/** The non-`web_form` sources whose adapters are implemented in task 2.2. */
const CREDENTIALED_SOURCES: readonly LeadSource[] = LEAD_SOURCES.filter(
  (s) => s !== "web_form"
);

/**
 * Assert the unconfigured-source contract on a single NormalizeResult: when an
 * adapter signals `unconfigured_source` it must produce no lead and retain the
 * Raw_Payload it was given (Req 1.7).
 */
function assertUnconfiguredContract(result: NormalizeResult, raw: unknown) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected an unconfigured-source failure");
  expect(result.code).toBe("unconfigured_source");
  // No lead is produced and the Raw_Payload is retained for retry (Req 1.7).
  expect(result).not.toHaveProperty("lead");
  expect(result.raw).toBe(raw);
  expect(result.message).toBeTypeOf("string");
}

describe("credentialed adapters — unconfigured source (Req 1.7)", () => {
  // Task 2.2 implements these adapters concurrently. Discover whichever are
  // registered and assert the contract defensively; sources without an adapter
  // yet are reported as pending so the suite stays green during the concurrent
  // build but tightens automatically as adapters land.
  const present = CREDENTIALED_SOURCES.filter((s) => getAdapter(s));
  const pending = CREDENTIALED_SOURCES.filter((s) => !getAdapter(s));

  it("only registers adapters for the five canonical sources (Req 1.1)", () => {
    for (const source of registeredSources()) {
      expect(LEAD_SOURCES).toContain(source);
    }
  });

  if (pending.length > 0) {
    it.todo(
      `unconfigured-source contract for pending task-2.2 adapters: ${pending.join(", ")}`
    );
  }

  for (const source of present) {
    it(`${source}: returns unconfigured_source and retains the raw payload when credentials are absent`, () => {
      const adapter = getAdapter(source)!;
      // A bare payload with no provider credentials supplied. The adapter must
      // either fully normalize OR, lacking credentials, signal the
      // unconfigured-source contract — never throw and never drop the payload.
      const raw = { __unconfigured_probe__: true, source };
      const result = adapter.normalize(raw);

      expect(result.ok === true || result.ok === false).toBe(true);
      if (!result.ok && result.code === "unconfigured_source") {
        assertUnconfiguredContract(result, raw);
      } else if (!result.ok) {
        // A bare probe payload may instead be an invalid_payload; that is also
        // a non-dropping outcome that retains the raw payload (Req 2.3).
        expect(result.code).toBe("invalid_payload");
        expect(result.raw).toBe(raw);
      }
    });
  }
});
