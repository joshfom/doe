import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

/**
 * **Feature: agentic-foundation, Property 22: For any sequence of decision/tool-call spans in a run, the tracing exporter publishes exactly one matching agent.* event per span to the SSE bus, and no published event payload contains a raw phone number.**
 *
 * **Validates: Requirements 6.2**
 *
 * The tracing exporter (Design §Components #5) folds a run's normalised spans
 * into an `AgentTrace` and, for every span, publishes exactly one matching
 * `agent.*` event to the SSE event bus so the reasoning is visible on the
 * existing Demo Console (Requirement 6.2). A `decision` span publishes one
 * `agent.decision` event; a `tool.called` span publishes one `agent.tool.called`
 * event — one span → one matching event, in order.
 *
 * The exporter applies `sanitizeEvent` to every payload before it reaches the
 * bus (CC-Privacy), so a raw phone number must never appear in any published
 * payload even when one is present in a span's free-text fields.
 *
 * This property exercises the live exporter (`createTracingExporter`) with the
 * SSE bus (`publishEvent` from `../realtime/events`) mocked to capture every
 * published event. We generate an arbitrary sequence of decision/tool-call
 * spans for one run — some decisions carrying a phone number in their summary —
 * drive them through the exporter, and assert (a) exactly one matching
 * `agent.*` event per span and (b) no captured payload contains an injected raw
 * phone number.
 */

// ── SSE bus capture (mock publishEvent) ───────────────────────────────────────
// Capture every event the exporter publishes. `publishEvent` is the single
// write boundary onto the SSE event bus (`lib/cms/realtime/events.ts`).
const published: Array<{ type: string; payload: unknown }> = [];

vi.mock("../realtime/events", () => ({
  publishEvent: vi.fn(
    async (_db: unknown, e: { type: string; payload: unknown }) => {
      published.push({ type: e.type, payload: e.payload });
    },
  ),
}));

// `tracing.ts` imports the shared db handle at module load to build the default
// exporter; stub it so importing the module opens no real connection.
vi.mock("../db", () => ({ db: {} }));

import {
  createTracingExporter,
  type AgentSpan,
  type DecisionSpan,
  type ToolCalledSpan,
} from "./tracing";
import type { Database } from "../db";
import type { DispatchErrorCode } from "../ai/tools/dispatch";

// A configured salt makes the sanitiser hash phone tokens (vs. redact to a
// marker); either way the raw number must never survive into the payload.
const SALT = "p22-test-salt";

// ── Generators ────────────────────────────────────────────────────────────────

/**
 * A phone-shaped, sanitiser-catchable token: `+` then 8–15 digits (E.164
 * range), first digit non-zero. Embedded in free text with whitespace
 * boundaries, this is exactly the shape `sanitizeEvent` must scrub.
 */
const phoneArb: fc.Arbitrary<string> = fc
  .integer({ min: 8, max: 15 })
  .chain((len) =>
    fc.tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), {
        minLength: len - 1,
        maxLength: len - 1,
      }),
    ),
  )
  .map(([first, rest]) => `+${first}${rest.join("")}`);

const dispatchErrorCodeArb: fc.Arbitrary<DispatchErrorCode> = fc.constantFrom(
  "unknown_tool",
  "validation_error",
  "permission_denied",
  "otp_required",
  "handler_error",
);

/** A decision span item: may carry a phone number inside its free-text summary. */
const decisionItemArb = fc.record({
  kind: fc.constant("decision" as const),
  phone: fc.option(phoneArb, { nil: null }),
  verb: fc.constantFrom("plan", "decide", "consider", "evaluate", "follow up"),
});

/** A tool-call span item: a catalog-style tool name, optionally an error code. */
const toolItemArb = fc.record({
  kind: fc.constant("tool" as const),
  toolName: fc.constantFrom(
    "create_lead",
    "create_booking",
    "cancel_appointment",
    "request_otp",
    "navigate",
  ),
  errorCode: fc.option(dispatchErrorCodeArb, { nil: null }),
});

const itemsArb = fc.array(fc.oneof(decisionItemArb, toolItemArb), {
  minLength: 1,
  maxLength: 25,
});

type DecisionItem = { kind: "decision"; phone: string | null; verb: string };
type ToolItem = {
  kind: "tool";
  toolName: string;
  errorCode: DispatchErrorCode | null;
};
type SpanItem = DecisionItem | ToolItem;

type BuiltSpan = { span: AgentSpan; rawPhone: string | null };

/** Project a generated item onto the span the exporter receives (index = position). */
function buildSpan(item: SpanItem, runId: string, index: number): BuiltSpan {
  if (item.kind === "decision") {
    const summary = item.phone
      ? `agent will ${item.verb} and contact ${item.phone} regarding the lead`
      : `agent will ${item.verb} on the next step`;
    const span: DecisionSpan = { type: "decision", runId, index, summary };
    return { span, rawPhone: item.phone };
  }
  const span: ToolCalledSpan = {
    type: "tool.called",
    runId,
    index,
    toolName: item.toolName,
  };
  if (item.errorCode) span.dispatchErrorCode = item.errorCode;
  return { span, rawPhone: null };
}

/** The `agent.*` event type each span kind must publish (Req 6.2, one-to-one). */
const EXPECTED_EVENT_TYPE: Record<"decision" | "tool.called", string> = {
  decision: "agent.decision",
  "tool.called": "agent.tool.called",
};

describe("Feature: agentic-foundation, Property 22: SSE event per decision/tool-call span, no raw phone in payloads", () => {
  it("publishes exactly one matching agent.* event per span and never leaks a raw phone number", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        itemsArb,
        async (runId, items) => {
          // Fresh capture + fresh exporter per case (exporter state is keyed by
          // runId; a new instance keeps runs isolated across iterations).
          published.length = 0;
          const exporter = createTracingExporter({
            db: {} as Database,
            salt: SALT,
          });

          const built = items.map((item, i) => buildSpan(item, runId, i));

          for (const { span } of built) {
            await exporter.exportSpan(span);
          }

          // (a) Exactly one matching agent.* event per span, in order (Req 6.2).
          expect(published).toHaveLength(built.length);
          built.forEach(({ span }, i) => {
            const ev = published[i];
            expect(ev.type).toBe(
              EXPECTED_EVENT_TYPE[span.type as "decision" | "tool.called"],
            );
            // The event correlates to its source span's run + index.
            const payload = ev.payload as { runId: string; index: number };
            expect(payload.runId).toBe(runId);
            expect(payload.index).toBe(i);
          });

          // (b) No published payload contains an injected raw phone number
          // (CC-Privacy). We check the exact raw tokens we injected so the
          // assertion can never be fooled by digit runs inside a phone_hash.
          const rawPhones = built
            .map((b) => b.rawPhone)
            .filter((p): p is string => p !== null);
          for (const ev of published) {
            const serialized = JSON.stringify(ev.payload);
            for (const raw of rawPhones) {
              expect(serialized.includes(raw)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
