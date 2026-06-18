// lib/cms/agents/evals/harness.ts
//
// The Eval_Harness (Agentic Foundation S1, Design §Components #5 "Eval_Harness",
// Requirements 6.3, 6.4). It runs a defined set of evaluation cases against an
// Agent and reports a pass/fail result per case (Requirement 6.3). The case set
// (see ./cases.ts) provides at least one case per Migrated_Capability of
// Requirements 8 and 9 (Requirement 6.4).
//
// DETERMINISM (the "[deps]" constraint): the harness never reaches a live model
// or the real database. Each case runs against a **counting fake dispatcher**
// ({@link createCountingDispatcher}) instead of the audited `dispatchTool`, and
// the Agent under test is an {@link AgentLike} — an abstraction the deterministic
// reference agents (./reference-agents.ts) implement without any model gateway
// or memory connection. A production adapter can implement `AgentLike` over a
// real Mastra agent, but the harness itself requires no network/credentials and
// is fully reproducible.
//
// The harness records every tool call the Agent makes ({@link ToolCallRecord})
// and assembles a canonical {@link AgentTrace} (reusing `assembleTrace` from
// ../tracing so the trace shape matches the tracing exporter exactly). Each
// case's `expect(trace, toolCalls)` predicate decides pass/fail; a thrown agent
// turn or a thrown predicate is reported as a deterministic failure rather than
// propagating.
//
// [container-only] This module runs on the container/worker tier only. It must
// NOT be imported by any `app/` route/page/layout module (Requirement 15.3).
//
// Design references: §Components #5 (Eval_Harness). Requirements: 6.3, 6.4.

import {
  assembleTrace,
  type AgentTrace,
  type AgentTraceStep,
  type AgentTraceOutcome,
} from "../tracing";
import type { ModelTier } from "../gateway";
import type { DispatchResult } from "../../ai/tools/dispatch";

// ── Tool-call recording ───────────────────────────────────────────────────────

/**
 * One tool call an Agent made during an evaluation run: the dispatched tool
 * name, the raw input it passed, and the (faked) {@link DispatchResult} it
 * received back. The case `expect` predicate inspects the ordered list of these
 * to decide whether the Agent behaved correctly.
 */
export interface ToolCallRecord {
  toolName: string;
  input: unknown;
  result: DispatchResult;
}

// ── Counting fake dispatcher (the determinism seam) ──────────────────────────

/**
 * A canned response generator standing in for the audited `dispatchTool`. It
 * receives the tool name, the input, and how many times this tool has already
 * been called in the current run (so a stub can vary its answer per call), and
 * returns the {@link DispatchResult} the Agent should observe. Pure and
 * synchronous — keeping every run reproducible.
 */
export type DispatchStub = (
  name: string,
  input: unknown,
  priorCount: number,
) => DispatchResult;

/** Default stub: every tool "succeeds" with a trivial echo result. */
export const DEFAULT_DISPATCH_STUB: DispatchStub = (name) => ({
  ok: true,
  result: { tool: name },
});

/**
 * The counting fake dispatcher. Records every dispatched call in order, tallies
 * per-tool invocation counts, and returns the stub's canned result — never
 * touching the real dispatcher, the database, or a model. This is what makes
 * each eval case deterministic and credential-free.
 */
export interface CountingDispatcher {
  /** Dispatch a tool call through the fake, recording it. Never throws. */
  dispatch(name: string, input: unknown): Promise<DispatchResult>;
  /** The ordered record of every call made through this dispatcher. */
  readonly calls: ReadonlyArray<ToolCallRecord>;
  /** How many times a given tool was dispatched. */
  countOf(name: string): number;
  /** Total number of tool calls recorded. */
  totalCalls(): number;
}

/**
 * Create a fresh counting fake dispatcher. A new one is created per case so
 * counts and recorded calls never leak between cases.
 *
 * @param stub Canned-response generator; defaults to {@link DEFAULT_DISPATCH_STUB}.
 */
export function createCountingDispatcher(
  stub: DispatchStub = DEFAULT_DISPATCH_STUB,
): CountingDispatcher {
  const calls: ToolCallRecord[] = [];
  const counts = new Map<string, number>();

  return {
    calls,
    async dispatch(name: string, input: unknown): Promise<DispatchResult> {
      const priorCount = counts.get(name) ?? 0;
      const result = stub(name, input, priorCount);
      counts.set(name, priorCount + 1);
      calls.push({ toolName: name, input, result });
      return result;
    },
    countOf(name: string): number {
      return counts.get(name) ?? 0;
    },
    totalCalls(): number {
      return calls.length;
    },
  };
}

// ── Agent abstraction ─────────────────────────────────────────────────────────

/**
 * The context an {@link AgentLike} receives for one evaluation turn. `callTool`
 * routes through the per-case counting fake dispatcher, so any tool the agent
 * invokes is recorded and assigned a deterministic trace step. `userId` and
 * `conversationId` are stable, synthetic identifiers (the fake dispatcher does
 * not enforce auth/OTP — that boundary is exercised by the dispatcher's own
 * property tests, not the eval harness).
 */
export interface EvalAgentContext {
  /** Invoke a catalog tool through the mocked counting dispatcher. */
  callTool(name: string, input?: unknown): Promise<DispatchResult>;
  /** Stable synthetic operator id for the run. */
  readonly userId: string;
  /** Stable synthetic conversation id for the run. */
  readonly conversationId: string;
}

/**
 * The minimal Agent surface the harness drives. The deterministic reference
 * agents (./reference-agents.ts) implement this without any model/gateway; a
 * production adapter could implement it over a real Mastra agent. `runTurn`
 * reasons about `input` and performs tool calls through `ctx.callTool`,
 * returning its final textual response (unused by the harness beyond trace
 * completion, but kept for parity with a real agent turn).
 */
export interface AgentLike {
  /** The agent identity recorded on the assembled trace (Requirement 6.1). */
  readonly id: string;
  /** The declared model tier recorded on the assembled trace (Requirement 6.1). */
  readonly modelTier: ModelTier;
  /** Run one evaluation turn, calling tools through `ctx`. */
  runTurn(input: string, ctx: EvalAgentContext): Promise<string>;
}

// ── Eval cases & reports ──────────────────────────────────────────────────────

/**
 * One evaluation case (Design §Components #5). `capability` names the
 * Migrated_Capability under test; `input` is the operator/visitor message fed to
 * the Agent; `expect` is the pass/fail predicate over the assembled trace and
 * the recorded tool calls. An optional `dispatch` stub customises the counting
 * fake's responses for this case (e.g. to return a confirmation token), and an
 * optional `detail` is surfaced on failure.
 */
export interface EvalCase {
  capability: string;
  input: string;
  expect: (
    trace: AgentTrace,
    toolCalls: ReadonlyArray<ToolCallRecord>,
  ) => boolean;
  dispatch?: DispatchStub;
  detail?: string;
}

/** The pass/fail outcome of a single evaluation case (Requirement 6.3). */
export interface EvalReport {
  capability: string;
  pass: boolean;
  /** Set when the case failed: why it failed, for diagnosis. */
  detail?: string;
}

// Deterministic synthetic per-step metrics — fixed so traces are reproducible.
const STEP_LATENCY_MS = 1;
const STEP_TOKEN_USAGE = { prompt: 1, completion: 1, total: 2 } as const;
const EVAL_USER_ID = "eval-operator";

/**
 * Run a single evaluation case against an Agent and report pass/fail
 * (Requirement 6.3). Builds a fresh counting fake dispatcher, drives the Agent's
 * turn while recording each tool call as a deterministic trace step, assembles
 * the canonical {@link AgentTrace}, then evaluates the case predicate. A thrown
 * agent turn (outcome `error`) or a thrown predicate fails the case rather than
 * propagating, so one bad case never aborts the suite.
 */
async function runEvalCase(
  agent: AgentLike,
  testCase: EvalCase,
): Promise<EvalReport> {
  const dispatcher = createCountingDispatcher(testCase.dispatch);
  const steps: AgentTraceStep[] = [];

  const ctx: EvalAgentContext = {
    userId: EVAL_USER_ID,
    conversationId: `eval-conv:${testCase.capability}`,
    async callTool(name: string, input: unknown = {}): Promise<DispatchResult> {
      const result = await dispatcher.dispatch(name, input);
      const step: AgentTraceStep = {
        index: steps.length,
        kind: "tool",
        toolName: name,
        latencyMs: STEP_LATENCY_MS,
        tokenUsage: { ...STEP_TOKEN_USAGE },
      };
      // Carry the structured dispatch error code onto error steps (Req 6.5),
      // mirroring the production tracing exporter.
      if (!result.ok) step.dispatchErrorCode = result.error.code;
      steps.push(step);
      return result;
    },
  };

  let outcome: AgentTraceOutcome = "ok";
  let turnError: string | undefined;
  try {
    await agent.runTurn(testCase.input, ctx);
  } catch (err) {
    outcome = "error";
    turnError = err instanceof Error ? err.message : String(err);
  }

  const trace = assembleTrace(
    { runId: `eval:${agent.id}:${testCase.capability}`, agentId: agent.id, modelTier: agent.modelTier },
    steps,
    outcome,
  );

  if (turnError !== undefined) {
    return {
      capability: testCase.capability,
      pass: false,
      detail: `agent turn threw: ${turnError}`,
    };
  }

  let pass: boolean;
  let detail: string | undefined;
  try {
    pass = testCase.expect(trace, dispatcher.calls);
    if (!pass) {
      detail =
        testCase.detail ??
        `expectation failed for "${testCase.capability}" ` +
          `(tools called: ${dispatcher.calls.map((c) => c.toolName).join(", ") || "none"})`;
    }
  } catch (err) {
    pass = false;
    detail = `expect() threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  const report: EvalReport = { capability: testCase.capability, pass };
  if (detail !== undefined) report.detail = detail;
  return report;
}

/**
 * Run a set of evaluation cases against an Agent and report pass/fail per case
 * (Requirement 6.3). Returns exactly one {@link EvalReport} per input case, in
 * order. Deterministic and credential-free: every tool call routes through the
 * counting fake dispatcher, never the live dispatcher or a model.
 *
 * @param agent The Agent under test (a deterministic reference agent, or a
 *              production adapter implementing {@link AgentLike}).
 * @param cases The evaluation cases to run (see ./cases.ts).
 */
export async function runEvals(
  agent: AgentLike,
  cases: EvalCase[],
): Promise<EvalReport[]> {
  const reports: EvalReport[] = [];
  for (const testCase of cases) {
    reports.push(await runEvalCase(agent, testCase));
  }
  return reports;
}
