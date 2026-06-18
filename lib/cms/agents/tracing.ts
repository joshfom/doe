/**
 * Agent tracing exporter (Agentic Foundation S1, Design §Components #5).
 *
 * When a Mastra agent run executes, the runtime must produce an `AgentTrace`
 * recording the agent identity, model tier, tool calls, per-step latency, and
 * token usage (Requirement 6.1); when the agent makes a decision or tool call
 * it must publish a corresponding event to the SSE event bus so the reasoning
 * is visible on the existing Demo Console (Requirement 6.2); and when a trace
 * step records a tool dispatch error, the structured error code must appear on
 * that step (Requirement 6.5).
 *
 * This module is the observability **exporter** Mastra hands its built-in
 * run/step spans to. For each span it (a) accumulates the `AgentTrace` for the
 * run and (b) publishes exactly one `agent.*` event to the SSE bus via
 * `publishEvent`. On `run.finished` it assembles the final trace (correct
 * latency/token totals) and persists it.
 *
 * PRIVACY (CC-Privacy, Requirement 4.7 precedent): event payloads carry only
 * ids, tool names, tiers, latency, token counts, and structured error codes —
 * NEVER a raw phone number. `sanitizeEvent()` is applied to every payload
 * before `publishEvent` as a defence-in-depth guard, hashing any phone-shaped
 * value with the same salted-SHA-256 convention the voice surface uses
 * (`PHONE_HASH_SALT`; see `lib/cms/voice/identity.ts`).
 *
 * The exporter is deliberately structured around pure, directly-testable
 * functions — `assembleTrace`, `spanToEvent`, and `sanitizeEvent` — so the
 * trace-assembly property (P21) and the SSE-per-decision property (P22) can be
 * exercised without a live Mastra runtime.
 *
 * Design references: §Components #5 (Tracing), §Data Models (Enum extension).
 * Requirements: 6.1, 6.2, 6.5.
 */

import { createHash } from "node:crypto";
import { db, type Database } from "../db";
import {
  publishEvent,
  type DoeEvent,
  type DoeEventType,
} from "../realtime/events";
import type { DispatchErrorCode } from "../ai/tools/dispatch";
import type { ModelTier } from "./gateway";

// ── Trace data models (Design §Components #5) ─────────────────────────────────

/** Token usage tallied for a single model/tool step. */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/** The outcome of an agent run, as recorded on the assembled trace. */
export type AgentTraceOutcome = "ok" | "budget_exceeded" | "error";

/**
 * One step of an agent run. A `model` step is a model call; a `tool` step is a
 * dispatched tool call. A tool step that failed at the dispatcher carries the
 * structured `dispatchErrorCode` (Requirement 6.5).
 */
export interface AgentTraceStep {
  index: number;
  kind: "model" | "tool";
  toolName?: string;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  /** Set only when this step recorded a tool dispatch error (Req 6.5). */
  dispatchErrorCode?: DispatchErrorCode;
}

/**
 * The structured, per-run record of an agent's reasoning (Requirement 6.1):
 * agent identity, model tier, the ordered steps (each with latency + token
 * usage), and the run totals.
 */
export interface AgentTrace {
  runId: string;
  agentId: string;
  modelTier: ModelTier;
  steps: AgentTraceStep[];
  totalLatencyMs: number;
  totalTokens: number;
  outcome: AgentTraceOutcome;
}

// ── Run/step spans (the exporter's normalised input) ──────────────────────────

/**
 * The normalised view of a Mastra run/step span. Each span maps to exactly one
 * `agent.*` SSE event (Requirement 6.2) and, for step spans, to exactly one
 * `AgentTraceStep` (Requirement 6.1). The `type` discriminator mirrors the
 * `agent.*` event suffix.
 */
export type AgentSpanType =
  | "run.started"
  | "step"
  | "decision"
  | "tool.called"
  | "run.finished"
  | "budget.exceeded";

interface SpanBase {
  /** Correlates every span of one agent run. */
  runId: string;
}

/** Emitted once at the start of a run; seeds the trace identity + tier. */
export interface RunStartedSpan extends SpanBase {
  type: "run.started";
  agentId: string;
  modelTier: ModelTier;
}

/** A model or tool step; contributes one `AgentTraceStep` to the trace. */
export interface StepSpan extends SpanBase {
  type: "step";
  index: number;
  kind: "model" | "tool";
  toolName?: string;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  dispatchErrorCode?: DispatchErrorCode;
}

/** A reasoning/decision span — published for Console visibility, not a step. */
export interface DecisionSpan extends SpanBase {
  type: "decision";
  index: number;
  summary?: string;
}

/** A tool-call span — published for Console visibility (the action panes). */
export interface ToolCalledSpan extends SpanBase {
  type: "tool.called";
  index: number;
  toolName: string;
  dispatchErrorCode?: DispatchErrorCode;
}

/** Emitted once at the end of a run; finalises + persists the trace. */
export interface RunFinishedSpan extends SpanBase {
  type: "run.finished";
  outcome: AgentTraceOutcome;
}

/** Emitted when the per-run budget guard halts the run (Req 5.5 surface). */
export interface BudgetExceededSpan extends SpanBase {
  type: "budget.exceeded";
  reason: "tokens" | "steps";
  usedTokens: number;
  usedSteps: number;
}

export type AgentSpan =
  | RunStartedSpan
  | StepSpan
  | DecisionSpan
  | ToolCalledSpan
  | RunFinishedSpan
  | BudgetExceededSpan;

/** The full set of `agent.*` event types this exporter can publish. */
export const AGENT_EVENT_TYPES: readonly DoeEventType[] = [
  "agent.run.started",
  "agent.step",
  "agent.decision",
  "agent.tool.called",
  "agent.run.finished",
  "agent.budget.exceeded",
] as const;

// ── Trace assembly (Requirement 6.1, 6.5) ─────────────────────────────────────

/** Project a step span onto the trace step it contributes (Req 6.1, 6.5). */
export function stepSpanToTraceStep(span: StepSpan): AgentTraceStep {
  const step: AgentTraceStep = {
    index: span.index,
    kind: span.kind,
    latencyMs: span.latencyMs,
  };
  if (span.toolName !== undefined) step.toolName = span.toolName;
  if (span.tokenUsage !== undefined) step.tokenUsage = span.tokenUsage;
  // Carry the structured dispatch error code onto error steps (Req 6.5).
  if (span.dispatchErrorCode !== undefined) {
    step.dispatchErrorCode = span.dispatchErrorCode;
  }
  return step;
}

/**
 * Assemble the final `AgentTrace` from the run identity and its ordered steps
 * (Requirement 6.1). Totals are the exact sums of per-step latency and per-step
 * token totals, so the trace faithfully aggregates its steps; any step carrying
 * a dispatch error keeps that structured code (Requirement 6.5).
 */
export function assembleTrace(
  run: { runId: string; agentId: string; modelTier: ModelTier },
  steps: AgentTraceStep[],
  outcome: AgentTraceOutcome = "ok",
): AgentTrace {
  let totalLatencyMs = 0;
  let totalTokens = 0;
  for (const s of steps) {
    totalLatencyMs += s.latencyMs;
    totalTokens += s.tokenUsage?.total ?? 0;
  }
  return {
    runId: run.runId,
    agentId: run.agentId,
    modelTier: run.modelTier,
    steps: steps.map((s) => ({ ...s })),
    totalLatencyMs,
    totalTokens,
    outcome,
  };
}

// ── Span → event mapping (Requirement 6.2) ────────────────────────────────────

/** A publishable event derived from a span — type plus privacy-safe payload. */
export type AgentEvent = Pick<DoeEvent, "type" | "payload">;

/**
 * Map a span to the single `agent.*` event it publishes (Requirement 6.2): one
 * span → exactly one event of the matching type. The payload carries only
 * privacy-safe fields (ids, tool names, tiers, latency, token counts, error
 * codes); it is run through `sanitizeEvent` by the exporter before publishing.
 */
export function spanToEvent(span: AgentSpan): AgentEvent {
  switch (span.type) {
    case "run.started":
      return {
        type: "agent.run.started",
        payload: {
          runId: span.runId,
          agentId: span.agentId,
          modelTier: span.modelTier,
        },
      };
    case "step":
      return {
        type: "agent.step",
        payload: {
          runId: span.runId,
          index: span.index,
          kind: span.kind,
          toolName: span.toolName,
          latencyMs: span.latencyMs,
          tokenUsage: span.tokenUsage,
          dispatchErrorCode: span.dispatchErrorCode,
        },
      };
    case "decision":
      return {
        type: "agent.decision",
        payload: {
          runId: span.runId,
          index: span.index,
          summary: span.summary,
        },
      };
    case "tool.called":
      return {
        type: "agent.tool.called",
        payload: {
          runId: span.runId,
          index: span.index,
          toolName: span.toolName,
          dispatchErrorCode: span.dispatchErrorCode,
        },
      };
    case "run.finished":
      return {
        type: "agent.run.finished",
        payload: { runId: span.runId, outcome: span.outcome },
      };
    case "budget.exceeded":
      return {
        type: "agent.budget.exceeded",
        payload: {
          runId: span.runId,
          reason: span.reason,
          usedTokens: span.usedTokens,
          usedSteps: span.usedSteps,
        },
      };
  }
}

// ── Phone-privacy sanitisation (CC-Privacy) ───────────────────────────────────

/**
 * A phone-shaped token: an optional `+` then 8–15 digits, allowing common
 * separators (spaces, dashes, dots, parentheses). The negative look-around for
 * word characters and id separators (`.`, `-`, `+`) prevents matching digit
 * runs inside UUID run-ids or other identifiers — only standalone phone-like
 * tokens in free text are caught.
 */
const PHONE_TOKEN = /(?<![\w.+\-])\+?\d[\d\s().\-]{6,16}\d(?![\w.\-])/g;

/** E.164 numbers are 8–15 digits; bound the match to that to limit false hits. */
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

/**
 * Replace a phone-shaped token with a salted SHA-256 hash, matching the voice
 * surface's `phone_hash` convention (`${salt}:${e164}`; `lib/cms/voice/
 * identity.ts`). If no salt is configured the token is redacted to a fixed
 * marker so a raw number can never leak even in a misconfigured environment.
 */
function redactPhone(token: string, salt: string | undefined): string {
  const digits = token.replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return token; // not phone-length — leave untouched (e.g. short codes)
  }
  const resolvedSalt = salt ?? process.env.PHONE_HASH_SALT;
  if (!resolvedSalt || resolvedSalt.trim().length === 0) {
    return "[redacted-phone]";
  }
  const e164 = token.trim().startsWith("+") ? `+${digits}` : `+${digits}`;
  const hash = createHash("sha256")
    .update(`${resolvedSalt}:${e164}`)
    .digest("hex");
  return `phone_hash:${hash}`;
}

function sanitizeValue(value: unknown, salt: string | undefined): unknown {
  if (typeof value === "string") {
    return value.replace(PHONE_TOKEN, (m) => redactPhone(m, salt));
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, salt));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v, salt);
    }
    return out;
  }
  return value;
}

/**
 * Strip raw phone numbers from an event payload before it reaches the SSE bus
 * (CC-Privacy). Any phone-shaped value is replaced by a salted `phone_hash`
 * (or a redaction marker when no salt is configured); all other data is left
 * unchanged. Pure and recursive over objects/arrays/strings, so it is directly
 * property-testable (P22's no-raw-phone clause).
 */
export function sanitizeEvent<T>(payload: T, salt?: string): T {
  return sanitizeValue(payload, salt) as T;
}

// ── The exporter (Requirements 6.1, 6.2, 6.5) ─────────────────────────────────

/** Dependencies the exporter needs to publish events and persist traces. */
export interface TracingExporterDeps {
  /** Database handle the SSE bus publishes through. */
  db: Database;
  /**
   * Persist the assembled trace on `run.finished`. Mastra's observability store
   * owns the durable record (Design §Data Models); this hook lets the exporter
   * forward the assembled projection (and lets tests capture it). Defaults to a
   * no-op.
   */
  persistTrace?: (trace: AgentTrace) => void | Promise<void>;
  /** Salt for phone-hash sanitisation; defaults to the `PHONE_HASH_SALT` env. */
  salt?: string;
}

/** In-progress accumulation of a single run's trace. */
interface RunState {
  runId: string;
  agentId: string;
  modelTier: ModelTier;
  steps: AgentTraceStep[];
  outcome: AgentTraceOutcome;
}

/** The exporter surface consumed by the Mastra runtime (Design §runtime.ts). */
export interface TracingExporter {
  /**
   * Consume one run/step span: publish its `agent.*` event (sanitised) and fold
   * it into the run's trace. On `run.finished` the trace is assembled and
   * persisted, then the run's in-progress state is released.
   */
  exportSpan(span: AgentSpan): Promise<void>;
}

/**
 * Create a tracing exporter bound to a database handle and persistence hook.
 *
 * The exporter is stateful across the spans of a run (keyed by `runId`): it
 * seeds identity/tier from `run.started`, appends a trace step per `step` span
 * (carrying any dispatch error code — Req 6.5), tracks the outcome from
 * `budget.exceeded`/`run.finished`, and on `run.finished` assembles the trace
 * with correct totals (Req 6.1) and persists it. Every span — including
 * `decision` and `tool.called` — publishes exactly one matching `agent.*` event
 * to the SSE bus (Req 6.2), with each payload sanitised of phone numbers first.
 */
export function createTracingExporter(
  deps: TracingExporterDeps,
): TracingExporter {
  const { db, persistTrace, salt } = deps;
  const runs = new Map<string, RunState>();

  function ensureRun(span: AgentSpan): RunState {
    let state = runs.get(span.runId);
    if (!state) {
      // A run.started span seeds identity/tier; if spans arrive out of order we
      // still record the run with placeholders rather than dropping the trace.
      state = {
        runId: span.runId,
        agentId: span.type === "run.started" ? span.agentId : "unknown",
        modelTier: span.type === "run.started" ? span.modelTier : "fast",
        steps: [],
        outcome: "ok",
      };
      runs.set(span.runId, state);
    } else if (span.type === "run.started") {
      // Late identity: backfill from the authoritative run.started span.
      state.agentId = span.agentId;
      state.modelTier = span.modelTier;
    }
    return state;
  }

  return {
    async exportSpan(span: AgentSpan): Promise<void> {
      const state = ensureRun(span);

      // Fold the span into the run's trace (Req 6.1, 6.5).
      switch (span.type) {
        case "step":
          state.steps.push(stepSpanToTraceStep(span));
          break;
        case "budget.exceeded":
          state.outcome = "budget_exceeded";
          break;
        case "run.finished":
          // run.finished carries the authoritative outcome; do not override a
          // budget halt with an "ok".
          if (state.outcome === "ok") state.outcome = span.outcome;
          break;
        default:
          break;
      }

      // Publish exactly one matching agent.* event per span (Req 6.2), with the
      // payload scrubbed of any phone-shaped value first (CC-Privacy).
      const event = spanToEvent(span);
      await publishEvent(db, {
        type: event.type,
        payload: sanitizeEvent(event.payload, salt),
      });

      // On run end, assemble + persist the final trace, then release state.
      if (span.type === "run.finished") {
        const trace = assembleTrace(
          {
            runId: state.runId,
            agentId: state.agentId,
            modelTier: state.modelTier,
          },
          state.steps,
          state.outcome,
        );
        if (persistTrace) await persistTrace(trace);
        runs.delete(span.runId);
      }
    },
  };
}

/**
 * The default tracing exporter the Mastra runtime registers
 * (`observability: { exporters: [tracingExporter] }`). Bound to the shared
 * database handle; Mastra's observability store owns durable trace persistence,
 * so the default `persistTrace` hook is left unset (the SSE projection is the
 * Console's source). [container-only] — runs on the container/worker tier only
 * (Requirement 15.3).
 */
export const tracingExporter: TracingExporter = createTracingExporter({ db });
