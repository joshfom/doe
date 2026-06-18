// workers/voice-livekit-entry.ts
//
// The LiveKit Agents JS entrypoint (the "agent job file"). This is the file the
// voice worker's `cli.runApp` dispatches per call: LiveKit spawns it for each
// `call_{ulid}` room, it connects, and it runs one DOE voice call.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS SHAPE (the integration decision):
//
// DOE's "brain" is the AUDITED orchestrator (`runVoiceTurnRouted` →
// `dispatchTool`: Zod → RBAC → OTP → audit → execute). We must NOT let a vendor
// LLM bypass it. So we use the LiveKit high-level `voice.AgentSession` ONLY for
// the things it is genuinely good (and version-resilient) at — real-time audio
// I/O, VAD/turn-detection, and barge-in — and we override the agent's `llmNode`
// so that EVERY model turn routes through DOE's audited orchestrator instead of
// a raw LLM. Deepgram does STT, ElevenLabs does TTS, and DOE does the thinking +
// tool calls. This keeps the audit/OTP boundary, agent memory, the unified tool
// catalog, and Salesforce wiring fully intact.
//
//   caller audio ──▶ Deepgram STT ──▶ llmNode (DOE audited orchestrator) ──▶
//                                      ElevenLabs TTS ──▶ caller audio
//
// CONTAINER-ONLY + CREDS-GATED. This file statically imports the LiveKit Agents
// SDK + the Deepgram/ElevenLabs plugins + `@livekit/rtc-node`; it is launched
// ONLY by the voice worker in the live container (never imported by app/ routes
// or by tests). The transport-agnostic pipeline pieces it reuses
// (`createInProcessVoiceToolCaller`, `buildGreeting`, `parseJobMetadata`,
// `selectSttConfig`, `selectVoiceId`) live in `workers/voice-agent.ts` and are
// unit-tested there without any SDK.
//
// LIVE VERIFICATION. The audio/STT/TTS wiring here can only be exercised against
// real LiveKit + Deepgram + ElevenLabs. Run a live test call per
// docs/VOICE_RUNBOOK.md §4 and watch the Voice Console + the latency HUD.
// ─────────────────────────────────────────────────────────────────────────────

import { fileURLToPath } from "node:url";

import {
  cli,
  WorkerOptions,
  defineAgent,
  voice,
  llm as lkLlm,
  type JobContext,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";

import { db } from "@/lib/cms/db";
import { publishEvent } from "@/lib/cms/realtime/events";
import { enqueueJob } from "@/lib/cms/jobs";
import { runVoiceTurnRouted } from "@/lib/cms/voice/serving-path";
import type { CallContext } from "@/lib/cms/voice/contracts";
import type { ChatMessage } from "@/lib/cms/ai/gateway";

import {
  parseJobMetadata,
  buildGreeting,
  selectSttConfig,
  selectVoiceId,
  createInProcessVoiceToolCaller,
} from "./voice-agent";

// ── DOE agent: high-level voice.Agent with the brain swapped for our orchestrator
//
// We subclass `voice.Agent` and override `llmNode` so the session's STT→LLM→TTS
// loop calls DOE's audited orchestrator for the "LLM" step. Everything else
// (turn detection, interruption/barge-in, audio publish/subscribe) is handled by
// the high-level `AgentSession`.
class DoeVoiceAgent extends voice.Agent {
  private readonly context: CallContext;
  private readonly conversationId: string;
  /** Rolling transcript kept for the orchestrator (mirrors the lean path). */
  private history: ChatMessage[] = [];
  private readonly callTool = createInProcessVoiceToolCaller();

  constructor(context: CallContext) {
    // `instructions` is required by the SDK but unused for routing: our llmNode
    // override ignores it and delegates to the audited orchestrator, whose own
    // system prompt governs behaviour. We pass a short, honest placeholder.
    super({
      instructions:
        "DOE voice lead-qualification agent. All reasoning and tool calls are " +
        "delegated to the audited DOE orchestrator via the llmNode override.",
    });
    this.context = context;
    this.conversationId = context.partyId;
  }

  /**
   * The single brain seam. The high-level session calls this with the running
   * `ChatContext`; we pull the latest caller utterance, run DOE's AUDITED
   * orchestrator for one turn, and stream the agent's reply text back. The
   * session then synthesises it with ElevenLabs. Tool calls happen INSIDE
   * `runVoiceTurnRouted` through `dispatchTool`, so RBAC/OTP/audit all apply.
   */
  async llmNode(
    chatCtx: lkLlm.ChatContext,
    _toolCtx: unknown,
    _modelSettings: unknown,
  ): Promise<ReadableStream<string> | null> {
    const userText = latestUserText(chatCtx);
    if (!userText) {
      // Nothing intelligible this turn — yield nothing; the session keeps
      // listening (and DOE's escalation policy applies on repeated silence).
      return emptyTextStream();
    }

    const turn = await runVoiceTurnRouted(
      {
        db,
        callTool: this.callTool,
        // Fillers are handled by the high-level session's responsiveness; a
        // no-op keeps the orchestrator's filler hook inert in this mode.
        speak: () => {},
        now: () => Date.now(),
      },
      {
        conversationId: this.conversationId,
        context: this.context,
        userText,
        history: [...this.history],
      },
    );

    // Extend the rolling transcript for the next turn.
    this.history.push({ role: "user", content: userText });
    this.history.push({ role: "assistant", content: turn.agentText });

    return singleChunkStream(turn.agentText);
  }
}

// ── Entry: one call ───────────────────────────────────────────────────────────

/**
 * Per-job entrypoint. LiveKit invokes this for each dispatched call. It connects
 * to the room, builds the session (Deepgram STT + ElevenLabs TTS) for the call's
 * language, greets the caller from the template (never a free LLM call), and on
 * close performs the DOE end-of-call handoff (publish `call.ended` + enqueue
 * `post_call_processing`).
 */
async function entry(ctx: JobContext): Promise<void> {
  const context = parseJobMetadata(ctx.job?.metadata);
  const conversationId = context.partyId;

  const stt = selectSttConfig(context.language);
  const session = new voice.AgentSession({
    stt: new deepgram.STT({
      model: stt.model,
      language: stt.language,
      interimResults: stt.interimResults,
    }),
    tts: new elevenlabs.TTS({
      voiceId: selectVoiceId(context.language),
    }),
  });

  // DOE end-of-call handoff — idempotent by jobKey/event id (mirrors
  // VoiceAgentSession.handleCallEnded; privacy-safe payload, no raw phone).
  let ended = false;
  const finalize = async () => {
    if (ended) return;
    ended = true;
    try {
      await publishEvent(db, {
        type: "call.ended",
        payload: {
          conversationId,
          partyId: context.partyId,
          language: context.language,
        },
      });
      await enqueueJob(
        db,
        "post_call_processing",
        { conversationId, partyId: context.partyId },
        `conv:${conversationId}`,
      );
    } catch (err) {
      console.error("[voice-agent] end-of-call handoff failed:", err);
    }
  };
  session.on(voice.AgentSessionEventTypes.Close, () => {
    void finalize();
  });

  await ctx.connect();
  await session.start({ agent: new DoeVoiceAgent(context), room: ctx.room });

  // Opening greeting: template + prefetched context, never a free LLM call.
  const greeting = buildGreeting(context);
  if (greeting) session.say(greeting, { allowInterruptions: true });
}

// The default export LiveKit loads in each job subprocess.
export default defineAgent({ entry });

/**
 * Start the LiveKit Agents worker for the DOE voice agent. Registers under
 * `LIVEKIT_AGENT_NAME` for EXPLICIT dispatch (jobs are only routed to rooms our
 * API dispatched the agent into, never auto-assigned). Called both when this
 * file is executed directly and from `startVoiceAgentWorker()` in
 * `workers/voice-agent.ts` (via dynamic import, so that module never statically
 * pulls in the SDK).
 */
export function startLiveKitWorker(): void {
  // `cli.runApp` reads a subcommand from argv (start | dev | connect | …).
  // Default to `start` so launching the file with no subcommand just works.
  const KNOWN = new Set(["start", "dev", "connect", "download-files"]);
  if (!process.argv.slice(2).some((a) => KNOWN.has(a))) {
    process.argv.push("start");
  }
  cli.runApp(
    new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: process.env.LIVEKIT_AGENT_NAME || "doe-voice-agent",
    }),
  );
}

// When this file is executed directly (the worker process), run the app.
if ((import.meta as { main?: boolean }).main) {
  startLiveKitWorker();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the latest caller (user) utterance from the LiveKit `ChatContext`.
 * Defensive across minor SDK shape differences: it scans the context's items for
 * the last `user`-role message and joins its text content.
 */
function latestUserText(chatCtx: lkLlm.ChatContext): string {
  const items =
    (chatCtx as unknown as { items?: unknown[] }).items ??
    (chatCtx as unknown as { messages?: unknown[] }).messages ??
    [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as {
      role?: string;
      type?: string;
      content?: unknown;
      text?: unknown;
    };
    if (item?.role !== "user") continue;
    return extractText(item.content ?? item.text);
  }
  return "";
}

/** Join a LiveKit message content (string | string[] | parts[]) into plain text. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : ((part as { text?: string })?.text ?? ""),
      )
      .join(" ")
      .trim();
  }
  return "";
}

/** A readable stream that emits exactly one text chunk then closes. */
function singleChunkStream(text: string): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      if (text) controller.enqueue(text);
      controller.close();
    },
  });
}

/** A readable stream that emits nothing and closes immediately. */
function emptyTextStream(): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      controller.close();
    },
  });
}
