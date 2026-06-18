import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  assembleTrace,
  stepSpanToTraceStep,
  type StepSpan,
  type AgentTraceStep,
} from "./tracing";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import type { DispatchErrorCode } from "../ai/tools/dispatch";

/**
 * **Feature: agentic-foundation, Property 21: For any sequence of run/step spans, the assembled Agent_Trace records the agent identity and model tier, one trace step per span with its latency and token usage, correct totals, and the structured error code for any step carrying a tool dispatch error.**
 *
 * **Validates: Requirements 6.1, 6.5**
 *
 * The tracing exporter (Design §Components #5) folds a run's normalised
 * run/step spans into a single `AgentTrace`. `stepSpanToTraceStep` projects one
 * `step` span onto the trace step it contributes, and `assembleTrace` combines
 * the run identity (agentId + modelTier) with the ordered steps to produce the
 * final trace with correct latency/token totals (Requirement 6.1). Any step
 * carrying a tool dispatch error must keep its structured error code on the
 * assembled trace (Requirement 6.5).
 *
 * This is a pure property over the assembly functions — no Mastra runtime, DB,
 * or SSE bus is required. We generate an arbitrary run identity and an arbitrary
 * sequence of `step` spans (model and tool steps, some tool steps carrying a
 * dispatch error code), project each span through `stepSpanToTraceStep`, then
 * assemble. An independent reference computes the expected totals and the
 * expected per-step projection, and we assert the assembled trace agrees.
 */

// ── Generators ────────────────────────────────────────────────────────────────

const modelTierArb: fc.Arbitrary<ModelTier> = fc.constantFrom(
  ...(Object.keys(MODEL_TIERS) as ModelTier[]),
);

const dispatchErrorCodeArb: fc.Arbitrary<DispatchErrorCode> = fc.constantFrom(
  "unknown_tool",
  "validation_error",
  "permission_denied",
  "otp_required",
  "handler_error",
);

const tokenUsageArb = fc
  .record({
    prompt: fc.nat({ max: 5000 }),
    completion: fc.nat({ max: 5000 }),
  })
  .map(({ prompt, completion }) => ({
    prompt,
    completion,
    total: prompt + completion,
  }));

/**
 * Generate one `step` span. Tool steps may carry a `toolName` and a dispatch
 * error code; both kinds may carry token usage. `index` is assigned positionally
 * after generation, so we leave a placeholder of 0 here.
 */
const stepSpanArb = (runId: string): fc.Arbitrary<StepSpan> =>
  fc
    .record({
      kind: fc.constantFrom("model" as const, "tool" as const),
      toolName: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
        nil: undefined,
      }),
      latencyMs: fc.nat({ max: 60_000 }),
      tokenUsage: fc.option(tokenUsageArb, { nil: undefined }),
      dispatchErrorCode: fc.option(dispatchErrorCodeArb, { nil: undefined }),
    })
    .map((r) => {
      const span: StepSpan = {
        type: "step",
        runId,
        index: 0, // assigned positionally below
        kind: r.kind,
        latencyMs: r.latencyMs,
      };
      if (r.toolName !== undefined) span.toolName = r.toolName;
      if (r.tokenUsage !== undefined) span.tokenUsage = r.tokenUsage;
      // Dispatch errors only make sense on tool steps (Req 6.5).
      if (r.kind === "tool" && r.dispatchErrorCode !== undefined) {
        span.dispatchErrorCode = r.dispatchErrorCode;
      }
      return span;
    });

const runArb = fc.record({
  runId: fc.uuid(),
  agentId: fc.string({ minLength: 1, maxLength: 40 }),
  modelTier: modelTierArb,
});

const outcomeArb = fc.constantFrom(
  "ok" as const,
  "budget_exceeded" as const,
  "error" as const,
);

describe("Feature: agentic-foundation, Property 21: trace assembly from run/step spans", () => {
  it("records identity + tier, one step per span with latency/usage, correct totals, and dispatch error codes", () => {
    fc.assert(
      fc.property(
        runArb.chain((run) =>
          fc.tuple(
            fc.constant(run),
            fc.array(stepSpanArb(run.runId), { maxLength: 30 }),
            outcomeArb,
          ),
        ),
        ([run, rawSpans, outcome]) => {
          // Assign positional indices, mirroring how the exporter receives an
          // ordered sequence of step spans for one run.
          const spans: StepSpan[] = rawSpans.map((s, i) => ({
            ...s,
            index: i,
          }));

          const steps: AgentTraceStep[] = spans.map(stepSpanToTraceStep);
          const trace = assembleTrace(run, steps, outcome);

          // Identity + tier are recorded faithfully (Req 6.1).
          expect(trace.runId).toBe(run.runId);
          expect(trace.agentId).toBe(run.agentId);
          expect(trace.modelTier).toBe(run.modelTier);
          expect(trace.outcome).toBe(outcome);

          // Exactly one trace step per span, preserving order (Req 6.1).
          expect(trace.steps).toHaveLength(spans.length);

          // Independent reference totals.
          let expectedLatency = 0;
          let expectedTokens = 0;
          for (const span of spans) {
            expectedLatency += span.latencyMs;
            expectedTokens += span.tokenUsage?.total ?? 0;
          }
          expect(trace.totalLatencyMs).toBe(expectedLatency);
          expect(trace.totalTokens).toBe(expectedTokens);

          // Each step carries its source span's index, kind, latency, usage,
          // tool name, and dispatch error code (Req 6.1, 6.5).
          spans.forEach((span, i) => {
            const step = trace.steps[i];
            expect(step.index).toBe(span.index);
            expect(step.kind).toBe(span.kind);
            expect(step.latencyMs).toBe(span.latencyMs);
            expect(step.toolName).toBe(span.toolName);
            expect(step.tokenUsage).toEqual(span.tokenUsage);
            // The structured error code appears on exactly the steps whose span
            // carried one (Req 6.5) — and never invented for steps without one.
            expect(step.dispatchErrorCode).toBe(span.dispatchErrorCode);
          });

          // Every span that carried a dispatch error has its code preserved on
          // the matching assembled step, and no error-free span gains a code.
          const expectedErrorIndices = spans
            .filter((s) => s.dispatchErrorCode !== undefined)
            .map((s) => s.index);
          const actualErrorIndices = trace.steps
            .filter((s) => s.dispatchErrorCode !== undefined)
            .map((s) => s.index);
          expect(actualErrorIndices).toEqual(expectedErrorIndices);
        },
      ),
      { numRuns: 100 },
    );
  });
});
