/**
 * DOE Voice Surface — lean low-latency voice orchestrator (`runVoiceTurn`).
 *
 * The text path's `handleChatMessage` is deliberately sequential (load history →
 * resolve identity → scope → dispatch → OTP gate → RAG → persist) and is too
 * slow for the < 800ms voice-to-voice budget. The voice path therefore gets its
 * OWN lean turn handler that:
 *
 *   • Receives the prefetched {@link CallContext} ONCE at session start and
 *     never re-resolves identity per turn (Req 5.1). Identity lives on the turn.
 *   • Uses NATIVE LLM tool-calling against the typed tool registry
 *     (`lib/cms/ai/tools/registry.ts`) — not deterministic keyword dispatch
 *     (Req 5.2). The text dispatcher (`lib/cms/ai/agent.ts`, `chat.ts`) is left
 *     untouched (Req 5.6).
 *   • Never performs a Salesforce write inline — SF-bound effects flow through
 *     the tools, which enqueue to `sf_outbox` (Req 5.3). Work expected to exceed
 *     ~2s is likewise enqueued to the job runner by its tool with a spoken
 *     acknowledgement, never awaited inline (Req 5.4).
 *   • Wraps every tool with a spoken filler if it runs long so the agent is
 *     never silent > 1.5s (FR-V4); on a STRUCTURED tool error it feeds the error
 *     back to the model so the agent speaks around it and continues the turn,
 *     and falls back to a graceful utterance if the model itself fails (Req 5.5).
 *   • Appends BOTH the caller and agent turns to `aiMessages` with `tMs` /
 *     `latencyMs` and emits a `turn.appended` event to the SSE bus (Req 4.10).
 *
 * DISPATCH (forward-compatible): the orchestrator never imports the tool route
 * directly. It depends on an injected {@link ToolCaller}. In production the
 * voice-agent worker supplies a caller backed by the audited, permission-checked
 * `POST /api/tools/:toolName` dispatcher (task 9.1) via the Eden client
 * (task 19.3). Until those land, {@link createRegistryToolCaller} provides a
 * thin local wrapper over the typed registry that validates input against each
 * tool's Zod schema. Audit + OTP gating are the DISPATCHER's responsibility, not
 * the orchestrator's — see the note on {@link createRegistryToolCaller}.
 *
 * Design references: §7.5 (lean orchestrator), §13 (worker pipeline / turn
 * spec). Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 4.10.
 */

import { z } from "zod";

import type { Database } from "../db";
import { aiConversations, aiMessages } from "../schema";
import { eq } from "drizzle-orm";
import { publishEvent } from "../realtime/events";
import {
  generateToolCallCompletion,
  type ChatMessage,
  type CompletionOptions,
  type ToolCallCompletion,
  type ToolChatMessage,
  type ToolDefinitionSpec,
  type ToolFunctionCall,
} from "../ai/gateway";
import {
  getTool,
  isToolName,
  type ToolContext,
} from "../ai/tools/registry";
import {
  TOOL_NAMES,
  toolSchemas,
  type CallContext,
  type ToolName,
} from "./contracts";

// ── Public interfaces (design §7.5) ──────────────────────────────────────────

/** A single turn handed to {@link runVoiceTurn}. */
export interface OrchestratorTurn {
  conversationId: string;
  /** Prefetched mirror-only context, resolved once at session start (Req 5.1). */
  context: CallContext;
  /** Final STT transcript for this caller turn (non-empty). */
  userText: string;
  /** Prior turns in this call, oldest first. */
  history: ChatMessage[];
}

/** The per-turn latency breakdown surfaced to the latency HUD (Req 4.10). */
export interface TurnLatency {
  /** STT-final time — owned by the worker pipeline; 0 here unless supplied. */
  sttFinalMs: number;
  /** Time from turn start to the model's first response (orchestrator-measured). */
  llmFirstTokenMs: number;
  /** TTS-first-byte time — owned by the worker pipeline; 0 here unless supplied. */
  ttsFirstByteMs: number;
  /** Orchestrator wall-clock for the whole turn (LLM + tools), stored as latencyMs. */
  voiceToVoiceMs: number;
}

/** A record of one tool call made during a turn (for the Console + result). */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  output?: unknown;
  error?: ToolError;
  /** Wall-clock duration of the dispatch in ms. */
  ms: number;
}

/** The result of one orchestrated turn. */
export interface OrchestratorResult {
  /** The agent's utterance for TTS (always non-empty — falls back gracefully). */
  agentText: string;
  toolCalls: ToolCallRecord[];
  latency: TurnLatency;
}

// ── Tool dispatch contract (forward-compatible) ──────────────────────────────

/** A structured tool error the agent can speak around (Req 5.5 / 6.10). */
export interface ToolError {
  code: string;
  message: string;
}

/** The outcome of dispatching a single tool. */
export type ToolDispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ToolError };

/**
 * Dispatches one tool call. Injected into the orchestrator so the transport is
 * swappable: production routes through the audited `POST /api/tools/:toolName`
 * dispatcher via Eden; tests/local use {@link createRegistryToolCaller}.
 */
export type ToolCaller = (
  toolName: ToolName,
  input: unknown,
  ctx: { conversationId: string; context: CallContext }
) => Promise<ToolDispatchResult>;

/** A native tool-calling LLM step. Defaults to the Cloudflare AI Gateway. */
export type ToolCallingLLM = (
  messages: ToolChatMessage[],
  tools: ToolDefinitionSpec[],
  options?: CompletionOptions
) => Promise<ToolCallCompletion>;

/** Dependencies for {@link runVoiceTurn}. */
export interface VoiceDeps {
  db: Database;
  /**
   * Dispatch a validated tool call. REQUIRED — the orchestrator never reaches
   * Salesforce or the job runner directly; everything goes through a tool, and
   * in production that tool call is audited + permission-checked by the
   * dispatcher behind this caller.
   */
  callTool: ToolCaller;
  /** Native tool-calling LLM step. Defaults to {@link generateToolCallCompletion}. */
  llm?: ToolCallingLLM;
  /** Emit an immediate utterance (spoken filler / acknowledgement). No-op if omitted. */
  speak?: (text: string) => void;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Max tool-calling iterations within one turn (default 4). */
  maxToolIterations?: number;
  /** Silence threshold (ms) past which a long tool triggers a spoken filler (default 700). */
  fillerThresholdMs?: number;
}

// ── Tuning + copy ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOOL_ITERATIONS = 4;
const DEFAULT_FILLER_THRESHOLD_MS = 700;

/**
 * Graceful fallback utterance when the model fails outright or stalls (Req 5.5).
 * Short, on-brand, never blames the caller, and ends the turn cleanly.
 */
const FALLBACK_UTTERANCE =
  "Sorry, I didn't quite catch that — could you say that again?";

/** Per-tool spoken filler said when a tool exceeds the silence threshold. */
const TOOL_FILLERS: Record<ToolName, string> = {
  get_lead_context: "Give me a moment, let me pull up your details…",
  update_qualification: "Got it — just noting that down…",
  score_lead: "Let me look into that…",
  check_viewing_slots: "Let me check what's available…",
  book_viewing: "Booking that in for you…",
  assign_rep: "Let me find the right person for you…",
  send_whatsapp_brief: "Sending that over now…",
  queue_report_email: "Let me put that report together…",
  log_outcome: "Noting that down…",
  get_pipeline_summary: "Let me pull the latest numbers together…",
};;

/** Short LLM-facing descriptions so the model knows when to call each tool. */
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_lead_context:
    "Refresh the caller's lead context (name, tier, interests, assigned rep) from the local mirror.",
  update_qualification:
    "Record qualification facts (budget band, timeline, intent, unit type) as they emerge.",
  score_lead:
    "Score the lead into a tier from the qualification signals on record.",
  check_viewing_slots:
    "List available viewing slots for a project, optionally near a date hint.",
  book_viewing:
    "Book a viewing for the caller into a specific available slot.",
  assign_rep:
    "Assign the best rep to the caller by project, language and capacity.",
  send_whatsapp_brief:
    "Queue a WhatsApp brief to a rep about this caller (runs in the background).",
  queue_report_email:
    "Queue an emailed pipeline report for a scope and period (runs in the background).",
  log_outcome:
    "Log a free-text call outcome as a Salesforce task (queued, not inline).",
  get_pipeline_summary:
    "Get pipeline figures for a scope and period (numbers are computed in SQL; narrate them).",
};

// ── Tool specs for the model ──────────────────────────────────────────────────

let cachedToolSpecs: ToolDefinitionSpec[] | undefined;

/**
 * Build the OpenAI-style tool specs from the typed registry schemas. Each tool's
 * Zod input schema is converted to JSON Schema (Zod v4 `z.toJSONSchema`) so the
 * model and the dispatcher validate against the SAME source of truth.
 */
export function buildToolSpecs(): ToolDefinitionSpec[] {
  if (cachedToolSpecs) return cachedToolSpecs;
  cachedToolSpecs = TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: z.toJSONSchema(toolSchemas[name].input) as Record<
      string,
      unknown
    >,
  }));
  return cachedToolSpecs;
}

// ── System prompt (built from CallContext, never a free LLM lookup) ───────────

/**
 * Build the per-call system prompt from the prefetched context. Encodes the
 * conversation constraints (FR-V5): one question per turn, at most two
 * sentences, no lists read aloud, never ask for the phone number, use the
 * caller's name sparingly. Identity is baked in here ONCE — it is not
 * re-resolved per turn (Req 5.1).
 */
export function buildSystemPrompt(ctx: CallContext): string {
  const lines: string[] = [
    "You are DOE, ORA's digital voice assistant for luxury real estate.",
    "Speak naturally and concisely: ONE question per turn, at most two sentences.",
    "Never read lists aloud. Never ask for the caller's phone number. Use the caller's name at most twice in the whole call.",
    "Use the available tools to qualify, score, route, check availability, and book — never invent figures; numbers come from tools.",
    `Caller language: ${ctx.language}.`,
  ];

  if (ctx.known) {
    lines.push(
      `This is a known caller${ctx.name ? ` named ${ctx.name}` : ""}.`
    );
    if (ctx.tier) lines.push(`Current lead tier: ${ctx.tier}.`);
    if (ctx.projectInterest)
      lines.push(`Project of interest: ${ctx.projectInterest}.`);
    if (ctx.unitInterest) lines.push(`Unit of interest: ${ctx.unitInterest}.`);
    if (ctx.budgetBand) lines.push(`Budget band: ${ctx.budgetBand}.`);
    if (ctx.lastInteraction)
      lines.push(`Last interaction: ${ctx.lastInteraction}.`);
    if (ctx.assignedRep)
      lines.push(`Assigned rep: ${ctx.assignedRep.name}.`);
  } else {
    lines.push(
      "This is a new caller — qualify warmly without re-asking for details already on file."
    );
  }

  lines.push(`The caller's partyId is "${ctx.partyId}"; pass it to tools that need it.`);

  return lines.join(" ");
}

// ── runVoiceTurn ──────────────────────────────────────────────────────────────

/**
 * Handle one voice turn end-to-end (Req 5.1–5.5, 4.10).
 *
 * Never throws: a transport/model failure produces the graceful fallback
 * utterance so the call continues. Every tool dispatched is recorded in the
 * returned {@link ToolCallRecord}s (and audited by the dispatcher behind
 * {@link VoiceDeps.callTool}); both the caller and agent turns are appended to
 * `aiMessages` and a `turn.appended` event is emitted.
 */
export async function runVoiceTurn(
  deps: VoiceDeps,
  turn: OrchestratorTurn
): Promise<OrchestratorResult> {
  const now = deps.now ?? (() => Date.now());
  const llm = deps.llm ?? generateToolCallCompletion;
  const speak = deps.speak ?? (() => {});
  const maxIterations = deps.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const fillerThresholdMs =
    deps.fillerThresholdMs ?? DEFAULT_FILLER_THRESHOLD_MS;

  const turnStart = now();
  const toolCalls: ToolCallRecord[] = [];
  const toolSpecs = buildToolSpecs();

  const messages: ToolChatMessage[] = [
    { role: "system", content: buildSystemPrompt(turn.context) },
    ...turn.history.map(toToolChatMessage),
    { role: "user", content: turn.userText },
  ];

  let agentText = "";
  let llmFirstTokenMs = 0;
  let measuredFirst = false;

  try {
    for (let i = 0; i < maxIterations; i++) {
      const step = await llm(messages, toolSpecs, {
        temperature: 0.4,
        maxTokens: 300,
      });

      if (!measuredFirst) {
        llmFirstTokenMs = now() - turnStart;
        measuredFirst = true;
      }

      if (step.toolCalls.length === 0) {
        agentText = (step.content ?? "").trim();
        break;
      }

      // Record the assistant turn that requested the tools so the follow-up
      // call has the tool_call ids in context.
      messages.push({
        role: "assistant",
        content: step.content,
        toolCalls: step.toolCalls,
      });

      for (const call of step.toolCalls) {
        const record = await invokeTool(deps, turn, call, {
          speak,
          now,
          fillerThresholdMs,
        });
        toolCalls.push(record);

        // Feed the result (or the structured error) back to the model so it can
        // use it — or speak around the failure — and continue the turn (Req 5.5).
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(
            record.ok ? record.output ?? {} : { error: record.error }
          ),
        });
      }
    }

    if (!agentText) {
      // Model never settled on a spoken reply (exhausted iterations or empty
      // content) — fall back gracefully rather than going silent.
      agentText = FALLBACK_UTTERANCE;
    }
  } catch {
    // LLM transport failure mid-turn — never let it bubble into dead air.
    agentText = FALLBACK_UTTERANCE;
  }

  const voiceToVoiceMs = now() - turnStart;
  const latency: TurnLatency = {
    sttFinalMs: 0,
    llmFirstTokenMs,
    ttsFirstByteMs: 0,
    voiceToVoiceMs,
  };

  await appendTurn(deps.db, turn, agentText, latency);

  return { agentText, toolCalls, latency };
}

// ── Tool invocation with spoken filler ────────────────────────────────────────

async function invokeTool(
  deps: VoiceDeps,
  turn: OrchestratorTurn,
  call: ToolFunctionCall,
  opts: {
    speak: (text: string) => void;
    now: () => number;
    fillerThresholdMs: number;
  }
): Promise<ToolCallRecord> {
  const start = opts.now();

  if (!isToolName(call.name)) {
    return {
      name: call.name,
      input: undefined,
      ok: false,
      error: { code: "unknown_tool", message: `Unknown tool "${call.name}"` },
      ms: opts.now() - start,
    };
  }

  let input: unknown;
  try {
    input = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    return {
      name: call.name,
      input: call.arguments,
      ok: false,
      error: {
        code: "bad_arguments",
        message: "Tool arguments were not valid JSON.",
      },
      ms: opts.now() - start,
    };
  }

  // Spoken filler if the tool runs long so the agent is never silent > 1.5s
  // (FR-V4). Real-timer based; harmless for fast tools / fast unit tests.
  const filler = TOOL_FILLERS[call.name];
  const fillerTimer = setTimeout(() => {
    if (filler) opts.speak(filler);
  }, opts.fillerThresholdMs);

  try {
    const res = await deps.callTool(call.name, input, {
      conversationId: turn.conversationId,
      context: turn.context,
    });
    const ms = opts.now() - start;
    if (res.ok) {
      return { name: call.name, input, ok: true, output: res.result, ms };
    }
    return { name: call.name, input, ok: false, error: res.error, ms };
  } catch (err) {
    return {
      name: call.name,
      input,
      ok: false,
      error: {
        code: "handler_error",
        message: err instanceof Error ? err.message : String(err),
      },
      ms: opts.now() - start,
    };
  } finally {
    clearTimeout(fillerTimer);
  }
}

// ── Turn persistence + event (Req 4.10) ───────────────────────────────────────

/**
 * Append the caller and agent turns to `aiMessages` with `tMs` (offset from call
 * start) and `latencyMs` (voice-to-voice for the agent turn), then emit a
 * privacy-safe `turn.appended` event (Req 4.10 / Property 9 — no raw phone).
 *
 * `tMs` is the offset from the conversation's `createdAt`. If the conversation
 * is missing (e.g. an ad-hoc/test turn), `tMs` is left null rather than failing
 * the turn — persistence must never break the live call.
 *
 * Exported so the Mastra Voice_Agent path (`lib/cms/agents/voice-agent.ts`)
 * persists and emits turns through the SAME path as the lean orchestrator, so
 * observability is identical regardless of which path served the turn (S6
 * Requirement 6.2).
 */
export async function appendTurn(
  db: Database,
  turn: OrchestratorTurn,
  agentText: string,
  latency: TurnLatency
): Promise<void> {
  const nowWall = Date.now();

  let callStartMs: number | null = null;
  const [conversation] = await db
    .select({ createdAt: aiConversations.createdAt })
    .from(aiConversations)
    .where(eq(aiConversations.id, turn.conversationId))
    .limit(1);
  if (conversation?.createdAt) {
    callStartMs = new Date(conversation.createdAt).getTime();
  }

  const callerTMs =
    callStartMs != null ? Math.max(0, nowWall - callStartMs) : null;
  const agentTMs =
    callStartMs != null
      ? Math.max(0, nowWall + latency.voiceToVoiceMs - callStartMs)
      : null;

  await db.insert(aiMessages).values([
    {
      conversationId: turn.conversationId,
      role: "caller",
      content: turn.userText,
      tMs: callerTMs,
      latencyMs: null,
    },
    {
      conversationId: turn.conversationId,
      role: "agent",
      content: agentText,
      tMs: agentTMs,
      latencyMs: latency.voiceToVoiceMs,
    },
  ]);

  // Privacy-safe payload: ids, timing, and transcript text only — never a raw
  // phone number (the agent never asks for it — FR-V5).
  await publishEvent(db, {
    type: "turn.appended",
    payload: {
      conversationId: turn.conversationId,
      caller: { content: turn.userText, tMs: callerTMs },
      agent: {
        content: agentText,
        tMs: agentTMs,
        latencyMs: latency.voiceToVoiceMs,
      },
      latency,
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map a plain {@link ChatMessage} from history to a {@link ToolChatMessage}. */
function toToolChatMessage(m: ChatMessage): ToolChatMessage {
  return { role: m.role, content: m.content };
}

/**
 * A thin, FORWARD-COMPATIBLE tool caller backed by the typed registry. It
 * validates input against each tool's Zod schema and runs the handler.
 *
 * ⚠️ This wrapper does NOT audit or OTP-gate — those are the dispatcher's
 * responsibility (`POST /api/tools/:toolName`, task 9.1). Use this for local
 * runs and tests; in production the voice-agent worker injects a caller backed
 * by the audited HTTP dispatcher (via the Eden client, task 19.3) so every
 * voice tool call is permission-checked and audited (Req 6.1, 6.3, 13.2).
 */
export function createRegistryToolCaller(
  db: Database,
  ctxDefaults?: Partial<ToolContext>
): ToolCaller {
  return async (toolName, input, ctx) => {
    const tool = getTool(toolName);
    if (!tool) {
      return {
        ok: false,
        error: { code: "unknown_tool", message: `Unknown tool "${toolName}"` },
      };
    }

    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: parsed.error.issues
            .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
            .join("; "),
        },
      };
    }

    const toolCtx: ToolContext = {
      actor: "agent:voice-lead",
      conversationId: ctx.conversationId,
      language: ctx.context.language,
      ...ctxDefaults,
    };

    try {
      const result = await tool.handler(
        db,
        toolCtx,
        parsed.data as never
      );
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "handler_error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  };
}
