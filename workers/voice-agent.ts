/**
 * DOE Voice Surface — voice-agent worker (LiveKit Agents pipeline).
 *
 * CONTAINER-ONLY (design §5 / Req 12.6): a long-running LiveKit Agents JS
 * worker process. It is dispatched into a `call_{ulid}` room with the
 * prefetched {@link CallContext} as job metadata (task 7), and drives the lean
 * orchestrator `runVoiceTurn` (`lib/cms/voice/orchestrator.ts`, task 11.1).
 *
 * PIPELINE (design §13):
 *   STT:  Deepgram streaming (interim on) — model `en` primary, `ar` HOT-SWAP by
 *         `CallContext.language` (Req 4.2).
 *   LLM:  Cloudflare AI Gateway, fast-tier tool-capable model, via the
 *         orchestrator's native tool-calling (`lib/cms/ai/gateway.ts`) (Req 4.1).
 *   TTS:  ElevenLabs streaming — one DOE persona voice id, Arabic-capable voice
 *         when `ar` (Req 4.2).
 *   VAD/barge-in: agent speech stops immediately when the caller starts
 *         speaking (Req 4.3).
 *   Per-turn latency breakdown (STT-final / LLM-first-token / TTS-first-byte) is
 *         logged for the latency HUD (Req 15.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY NOTE — the LiveKit Agents JS SDK and the Deepgram/ElevenLabs
 * provider plugins are NOT yet installed in this repo (they are creds-gated and
 * container-only). So this module is structured around small, INJECTABLE
 * provider interfaces ({@link SttConfig}, {@link TtsProvider}) and a transport-
 * agnostic {@link VoiceAgentSession} that holds ALL the pipeline logic and is
 * fully unit-testable with mocked providers. The real LiveKit Agents entrypoint
 * is wired in {@link startVoiceAgentWorker} behind a guarded dynamic import, so
 * importing this file (e.g. from tests or the type-checker) never hard-fails
 * when those optional SDKs are absent. When they land, only
 * {@link startVoiceAgentWorker} needs filling in — the session core is final.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SEAMS FOR TASK 12.2 (greeting, fillers, escalation, end-of-call handoff): this
 * file is structured so 12.2 adds behaviour WITHOUT reworking the pipeline:
 *   • {@link VoiceAgentSession.start} calls an optional `buildGreeting` hook —
 *     12.2 supplies the template greeting (FR-V3) via {@link buildGreeting}.
 *   • {@link VoiceAgentSession.speak} is the single TTS seam used for the
 *     orchestrator's spoken fillers; {@link callToolWithFiller} plugs in here
 *     (the orchestrator already drives the 700ms filler timer).
 *   • {@link VoiceAgentSession.onCallerNotUnderstood} / `requestEscalation`
 *     implement 12.2's escalation policy (FR-V6): offer a rep callback, file a
 *     follow-up task, end gracefully, never loop.
 *   • {@link VoiceAgentSession.handleCallEnded} performs the end-of-call handoff
 *     (FR-V8): publish `call.ended` and `enqueueJob(post_call_processing,…)`.
 *
 * Run with: `bun workers/voice-agent.ts`
 *
 * Design references: §13 (worker pipeline), §21 (performance).
 * Requirements: 4.1, 4.2, 4.3, 15.1.
 */

import type { Database } from "@/lib/cms/db";
import {
  type ToolCaller,
  type ToolCallingLLM,
  type OrchestratorResult,
} from "@/lib/cms/voice/orchestrator";
import { runVoiceTurnRouted } from "@/lib/cms/voice/serving-path";
import type { CallContext, Language } from "@/lib/cms/voice/contracts";
import { callContextSchema } from "@/lib/cms/voice/contracts";
import type { ChatMessage } from "@/lib/cms/ai/gateway";
import { callTool } from "@/lib/cms/agents/call-tool";
import { VOICE_AGENT_ACTOR } from "@/lib/cms/ai/tools/registry";
import type { IdentityResult } from "@/lib/cms/ai/identity";
import type { OtpVerificationState } from "@/lib/cms/ai/otp";
import { publishEvent } from "@/lib/cms/realtime/events";
import { enqueueJob } from "@/lib/cms/jobs";
import { enqueueOutbox } from "@/lib/cms/outbox";

// ── Provider selection (AR hot-swap, Req 4.2) ────────────────────────────────

/** Streaming STT configuration handed to the Deepgram plugin for a call. */
export interface SttConfig {
  /** Deepgram model id selected for the call language. */
  model: string;
  /** BCP-47 language code passed to Deepgram (`en` / `ar`). */
  language: string;
  /** Interim results on, for low-latency endpointing / barge-in. */
  interimResults: boolean;
}

/**
 * Select the Deepgram STT model + language for a call. The Arabic call HOT-SWAPS
 * to the Arabic STT model/language; everything else uses the English primary
 * (Req 4.2). Model ids are env-overridable so the deployed model can change
 * without code edits (`DEEPGRAM_MODEL_EN`, `DEEPGRAM_MODEL_AR`).
 */
export function selectSttConfig(language: Language): SttConfig {
  if (language === "ar") {
    return {
      model: process.env.DEEPGRAM_MODEL_AR || "nova-2",
      language: "ar",
      interimResults: true,
    };
  }
  return {
    model: process.env.DEEPGRAM_MODEL_EN || "nova-2-phonecall",
    language: "en",
    interimResults: true,
  };
}

/**
 * Select the ElevenLabs voice id for a call. The Arabic call uses an
 * Arabic-capable voice (`ELEVENLABS_VOICE_ID_AR`) when configured, otherwise it
 * falls back to the primary DOE persona voice (`ELEVENLABS_VOICE_ID`) so a
 * missing Arabic voice never breaks the call (Req 4.2).
 */
export function selectVoiceId(language: Language): string {
  const primary = process.env.ELEVENLABS_VOICE_ID || "";
  if (language === "ar") {
    return process.env.ELEVENLABS_VOICE_ID_AR || primary;
  }
  return primary;
}

// ── TTS provider interface (injectable / mockable) ───────────────────────────

/** Options for one streaming synthesis. */
export interface TtsOptions {
  /** ElevenLabs voice id (see {@link selectVoiceId}). */
  voiceId: string;
  /** Call language, so the provider can pick the right model/normalisation. */
  language: Language;
}

/**
 * A handle to one in-flight streaming utterance. Lets the pipeline measure
 * TTS-first-byte (Req 15.1) and interrupt playback instantly on barge-in
 * (Req 4.3).
 */
export interface SpeechHandle {
  /** Resolves to ms-from-synthesize-call when the first audio byte is emitted. */
  readonly firstByteMs: Promise<number>;
  /** Resolves when playback finishes (or is stopped by barge-in). */
  readonly done: Promise<void>;
  /** Stop synthesis + playback immediately (barge-in). Idempotent. */
  stop(): void;
}

/**
 * Streaming text-to-speech provider. The real implementation wraps the
 * ElevenLabs Flash streaming plugin inside the LiveKit Agents pipeline; tests
 * inject a fake. Implementations MUST stream (emit `firstByteMs` as early as
 * possible) and MUST honour {@link SpeechHandle.stop} for barge-in.
 */
export interface TtsProvider {
  synthesize(text: string, opts: TtsOptions): SpeechHandle;
}

// ── Latency telemetry (Req 15.1) ─────────────────────────────────────────────

/** Per-turn voice-to-voice latency breakdown logged for the latency HUD. */
export interface TurnLatencyLog {
  conversationId: string;
  language: Language;
  /** Time the STT layer took to produce the final transcript for this turn. */
  sttFinalMs: number;
  /** Time from turn start to the model's first response (orchestrator-measured). */
  llmFirstTokenMs: number;
  /** Time from starting synthesis to the first audible TTS byte. */
  ttsFirstByteMs: number;
  /** Full caller-stops-speaking → first-audio-byte estimate (the NFR-1 number). */
  voiceToVoiceMs: number;
}

/** Default latency sink: a single structured line per turn. */
function defaultLogLatency(log: TurnLatencyLog): void {
  console.log(
    `[voice-agent] turn latency conv=${log.conversationId} lang=${log.language} ` +
      `stt_final=${log.sttFinalMs}ms llm_first_token=${log.llmFirstTokenMs}ms ` +
      `tts_first_byte=${log.ttsFirstByteMs}ms voice_to_voice=${log.voiceToVoiceMs}ms`,
  );
}

// ── Greeting, fillers, escalation (task 12.2) ────────────────────────────────

/**
 * Build the opening greeting from a template combined with the prefetched
 * {@link CallContext} — NEVER a free LLM call (FR-V3 / Req 4.4). The greeting
 * honours the conversation constraints (FR-V5 / Req 4.7): it is at most two
 * sentences, asks one question, never requests the phone number, and uses the
 * caller's name at most once (so the call's name-mention budget of two is kept).
 *
 *   • Known caller WITH a project interest (Req 4.5) → name + an open reference
 *     to their project / unit interest.
 *   • Known caller WITHOUT a project interest → a warm, name-led open question.
 *   • Unknown caller (Req 4.6 / FR-S5) → a warm generic greeting whose single
 *     question IS the first qualification question.
 *
 * A "known" caller with no name on file degrades to the warm generic greeting
 * rather than emitting an awkward "Hi , …".
 */
export function buildGreeting(ctx: CallContext): string {
  if (ctx.known && ctx.name) {
    if (ctx.projectInterest) {
      const unit = ctx.unitInterest ?? "unit";
      return `Hi ${ctx.name}, are you calling about the ${unit} at ${ctx.projectInterest}?`;
    }
    return `Hi ${ctx.name}, good to hear from you — how can I help today?`;
  }
  return "Hi, this is DOE, ORA's digital assistant. What can I help you find today?";
}

/** Default silence threshold (ms) past which a slow tool triggers a filler. */
const FILLER_THRESHOLD_MS = 700;

/**
 * Run a (potentially slow) tool call while guaranteeing the agent is never
 * silent for more than ~1.5s (FR-V4 / Req 4.8). A filler utterance is spoken if
 * the call has not resolved within {@link FILLER_THRESHOLD_MS} (700ms by
 * default); the timer is always cleared in `finally` so a fast call speaks
 * nothing. The tool's own result/throw is propagated unchanged — this only adds
 * the spoken bridge.
 *
 * This is the canonical FR-V4 helper the LiveKit Agents entrypoint wires around
 * direct (non-orchestrated) tool calls; the lean orchestrator drives the same
 * 700ms filler policy internally for tool calls made during a turn.
 *
 * @param tool        the async tool invocation to await
 * @param filler      the natural bridge to speak if the tool runs long
 * @param speak       the TTS seam (e.g. {@link VoiceAgentSession.speak})
 * @param thresholdMs override the 700ms silence threshold (mainly for tests)
 */
export async function callToolWithFiller<T>(
  tool: () => Promise<T>,
  filler: string,
  speak: (text: string) => void,
  thresholdMs: number = FILLER_THRESHOLD_MS,
): Promise<T> {
  let spoken = false;
  const fillerTimer = setTimeout(() => {
    spoken = true;
    if (filler) speak(filler);
  }, thresholdMs);
  void spoken; // referenced for clarity; the timer owns the side effect
  try {
    return await tool();
  } finally {
    clearTimeout(fillerTimer);
  }
}

/** Why the agent escalated to a human callback (FR-V6 / Req 4.9). */
export type EscalationReason =
  | "human_request"
  | "frustration"
  | "non_understanding";

/** Consecutive non-understandings that trigger an automatic escalation. */
const NON_UNDERSTANDING_LIMIT = 2;

/**
 * The graceful escalation offer (FR-V6 / Req 4.9): a callback from the assigned
 * rep when one is known, otherwise from the team. Two sentences, NO trailing
 * question, so the call ends cleanly without looping.
 */
export function buildEscalationOffer(repName?: string): string {
  const who = repName ? repName : "one of our team";
  return `I understand — I'll arrange for ${who} to call you back shortly. Thanks for calling DOE.`;
}

// ── Voice agent session (transport-agnostic pipeline core) ───────────────────

/** Dependencies + per-call state for one {@link VoiceAgentSession}. */
export interface VoiceAgentSessionConfig {
  /** The `aiConversations` row id for this call. */
  conversationId: string;
  /** Prefetched, mirror-only context delivered as LiveKit job metadata. */
  context: CallContext;
  db: Database;
  /**
   * Dispatch a validated tool call. Production injects an audited caller backed
   * by `POST /api/tools/:toolName` (see {@link createHttpToolCaller}); tests
   * inject a fake. The orchestrator never reaches Salesforce/jobs directly.
   */
  callTool: ToolCaller;
  /** Streaming TTS provider (ElevenLabs in production; mocked in tests). */
  tts: TtsProvider;
  /** Native tool-calling LLM step. Defaults to the gateway fast tier. */
  llm?: ToolCallingLLM;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Latency sink. Defaults to a structured console line. */
  logLatency?: (log: TurnLatencyLog) => void;
  /**
   * SEAM for task 12.2 — builds the opening greeting from the CallContext
   * (template + context, never a free LLM call — FR-V3). When omitted,
   * {@link VoiceAgentSession.start} speaks nothing (12.1 leaves greeting to 12.2).
   */
  buildGreeting?: (ctx: CallContext) => string;
}

/** The outcome of one handled caller turn. */
export interface TurnOutcome {
  result: OrchestratorResult;
  latency: TurnLatencyLog;
}

/**
 * Holds the pipeline state for a single voice call and turns a stream of final
 * STT transcripts into spoken agent responses via {@link runVoiceTurn}.
 *
 * This object is deliberately transport-agnostic: the LiveKit Agents entrypoint
 * feeds it STT events ({@link handleCallerTurn}, {@link notifyCallerSpeechStarted})
 * and wires {@link speak} to the room's audio output. That keeps the entire
 * pipeline (latency accounting, barge-in, history, language-aware synthesis)
 * unit-testable without LiveKit/Deepgram/ElevenLabs credentials.
 */
export class VoiceAgentSession {
  private readonly cfg: VoiceAgentSessionConfig;
  private readonly now: () => number;
  private readonly logLatency: (log: TurnLatencyLog) => void;
  private readonly voiceId: string;
  private readonly _sttConfig: SttConfig;
  /** Rolling transcript handed to the orchestrator each turn. */
  private history: ChatMessage[] = [];
  /** The currently-playing utterance, if any (for barge-in). */
  private currentSpeech: SpeechHandle | null = null;
  /** True once {@link handleCallEnded} has run, so it is idempotent. */
  private ended = false;
  /** True once an escalation has been offered, so escalation never loops (FR-V6). */
  private escalated = false;
  /** Consecutive non-understandings; reset on any understood turn (Req 4.9). */
  private nonUnderstandingCount = 0;

  constructor(cfg: VoiceAgentSessionConfig) {
    this.cfg = cfg;
    this.now = cfg.now ?? (() => Date.now());
    this.logLatency = cfg.logLatency ?? defaultLogLatency;
    this.voiceId = selectVoiceId(cfg.context.language);
    this._sttConfig = selectSttConfig(cfg.context.language);
  }

  /** The STT model/language the entrypoint should configure Deepgram with. */
  get sttConfig(): SttConfig {
    return this._sttConfig;
  }

  /** The ElevenLabs voice id selected for this call's language. */
  get ttsVoiceId(): string {
    return this.voiceId;
  }

  /** Read-only view of the rolling transcript (primarily for tests). */
  getHistory(): ReadonlyArray<ChatMessage> {
    return this.history;
  }

  /**
   * Open the call. SEAM for task 12.2: if a `buildGreeting` hook is provided,
   * the greeting is spoken immediately (template + context, FR-V3). 12.1 keeps
   * this minimal — with no hook it is a no-op.
   */
  async start(): Promise<void> {
    if (!this.cfg.buildGreeting) return;
    const greeting = this.cfg.buildGreeting(this.cfg.context);
    if (greeting) {
      this.history.push({ role: "assistant", content: greeting });
      await this.speakAndAwait(greeting);
    }
  }

  /**
   * Barge-in (Req 4.3): the STT/VAD layer detected the caller starting to
   * speak, so stop any agent speech immediately. Idempotent and safe to call
   * when nothing is playing.
   */
  notifyCallerSpeechStarted(): void {
    if (this.currentSpeech) {
      this.currentSpeech.stop();
      this.currentSpeech = null;
    }
  }

  /**
   * Speak a piece of text through the TTS provider, tracking it as the current
   * utterance so a subsequent barge-in can interrupt it. Used for agent turns,
   * the greeting, and the orchestrator's spoken fillers (the single TTS seam).
   * Returns the {@link SpeechHandle} so callers can await first-byte / done.
   */
  speak(text: string): SpeechHandle {
    // A new utterance supersedes any still-playing one.
    if (this.currentSpeech) this.currentSpeech.stop();
    const handle = this.cfg.tts.synthesize(text, {
      voiceId: this.voiceId,
      language: this.cfg.context.language,
    });
    this.currentSpeech = handle;
    // Clear the pointer once playback completes so barge-in after the agent has
    // finished is a no-op rather than a double-stop.
    void handle.done.then(
      () => {
        if (this.currentSpeech === handle) this.currentSpeech = null;
      },
      () => {
        if (this.currentSpeech === handle) this.currentSpeech = null;
      },
    );
    return handle;
  }

  /**
   * Handle one caller turn end-to-end: run the lean orchestrator, speak the
   * agent's reply, and log the per-turn latency breakdown (Req 15.1).
   *
   * @param userText   final STT transcript for the caller turn (non-empty)
   * @param sttFinalMs time the STT layer took to finalise this transcript
   */
  async handleCallerTurn(
    userText: string,
    sttFinalMs: number,
  ): Promise<TurnOutcome> {
    const turnStart = this.now();

    // A turn that produced a usable transcript is an "understood" turn, so the
    // consecutive non-understanding streak resets (Req 4.9).
    this.nonUnderstandingCount = 0;

    const result = await runVoiceTurnRouted(
      {
        db: this.cfg.db,
        callTool: this.cfg.callTool,
        llm: this.cfg.llm,
        // Spoken fillers route through the same TTS seam as agent turns.
        speak: (text: string) => {
          this.speak(text);
        },
        now: this.now,
      },
      {
        conversationId: this.cfg.conversationId,
        context: this.cfg.context,
        userText,
        history: [...this.history],
      },
    );

    // Synthesise the agent's reply and measure TTS-first-byte.
    const handle = this.speak(result.agentText);
    let ttsFirstByteMs = 0;
    try {
      ttsFirstByteMs = await handle.firstByteMs;
    } catch {
      // First-byte never arrived (e.g. interrupted) — record 0 rather than fail
      // the turn; the call continues.
      ttsFirstByteMs = 0;
    }

    // Voice-to-voice (NFR-1) ≈ STT-final + full processing-to-first-byte.
    const processingMs = this.now() - turnStart;
    const latency: TurnLatencyLog = {
      conversationId: this.cfg.conversationId,
      language: this.cfg.context.language,
      sttFinalMs,
      llmFirstTokenMs: result.latency.llmFirstTokenMs,
      ttsFirstByteMs,
      voiceToVoiceMs: sttFinalMs + processingMs,
    };
    this.logLatency(latency);

    // Extend the rolling transcript for the next turn.
    this.history.push({ role: "user", content: userText });
    this.history.push({ role: "assistant", content: result.agentText });

    return { result, latency };
  }

  /**
   * The caller produced a non-understanding (e.g. STT garble / off-topic noise).
   * Tracks the consecutive streak and, on the second in a row
   * ({@link NON_UNDERSTANDING_LIMIT}), escalates to a human callback and ends the
   * call gracefully without looping (FR-V6 / Req 4.9). Any understood turn
   * ({@link handleCallerTurn}) resets the streak.
   */
  async onCallerNotUnderstood(): Promise<void> {
    this.nonUnderstandingCount += 1;
    if (this.nonUnderstandingCount >= NON_UNDERSTANDING_LIMIT) {
      await this.escalate("non_understanding");
    }
  }

  /**
   * Explicit escalation: the caller asked for a human or showed frustration
   * (FR-V6 / Req 4.9). Offers a callback from the assigned rep, files a
   * follow-up task, and ends the call gracefully. Idempotent — a second request
   * after escalation has already happened is a no-op (the call never loops).
   */
  async requestEscalation(
    reason: EscalationReason = "human_request",
  ): Promise<void> {
    await this.escalate(reason);
  }

  /**
   * Shared escalation path (FR-V6 / Req 4.9): speak the callback offer, enqueue
   * a follow-up task to the Salesforce outbox, then end the call. The
   * {@link escalated} guard ensures this runs at most once per call so the agent
   * never loops escalation offers.
   */
  private async escalate(reason: EscalationReason): Promise<void> {
    if (this.escalated || this.ended) return;
    this.escalated = true;

    // 1) Offer the callback (two sentences, no trailing question — see
    //    buildEscalationOffer) and record it in the transcript.
    const repName = this.cfg.context.assignedRep?.name;
    const offer = buildEscalationOffer(repName);
    this.history.push({ role: "assistant", content: offer });
    await this.speakAndAwait(offer);

    // 2) File the follow-up task so the rep calls the lead back. Idempotent by
    //    jobKey, and privacy-safe (ids/name only — never a raw phone, P9).
    await this.enqueueEscalationTask(reason);

    // 3) End the call gracefully (publishes call.ended + post_call_processing).
    await this.handleCallEnded();
  }

  /**
   * Enqueue the rep-callback follow-up task to the Salesforce outbox (FR-V6).
   * Keyed `escalation:conv:{id}` so a retry never creates a duplicate task.
   */
  private async enqueueEscalationTask(reason: EscalationReason): Promise<void> {
    const ctx = this.cfg.context;
    const rep = ctx.assignedRep;
    const who = rep?.name ?? "the assigned team";
    await enqueueOutbox(
      this.cfg.db,
      "task",
      {
        subject: `Callback request — ${ctx.name ?? "voice caller"}`,
        description: `Voice call escalated (${reason}). Arrange a callback from ${who}.`,
        partyId: ctx.partyId,
        repId: rep?.id,
        reason,
        conversationId: this.cfg.conversationId,
        language: ctx.language,
      },
      `escalation:conv:${this.cfg.conversationId}`,
    );
  }

  /**
   * End-of-call handoff (FR-V8 / Req 4.11). Stops any in-flight speech, then:
   *   1) publishes a privacy-safe `call.ended` event to the SSE bus (ids +
   *      language only — NEVER a raw phone, P9 / Req 14.5), and
   *   2) enqueues a `post_call_processing` job keyed `conv:{conversationId}` so
   *      the summary/facts/sentiment pass runs off the live path.
   *
   * Idempotent: the {@link ended} guard makes a second hangup/close in-process a
   * no-op, and `enqueueJob`/`publishEvent` are keyed so a cross-process retry
   * never double-processes the call (Req 9.2).
   */
  async handleCallEnded(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.notifyCallerSpeechStarted(); // stop any playing audio

    const ctx = this.cfg.context;

    // Privacy-safe payload — ids + language only, no raw phone (P9 / Req 14.5).
    await publishEvent(this.cfg.db, {
      type: "call.ended",
      payload: {
        conversationId: this.cfg.conversationId,
        partyId: ctx.partyId,
        language: ctx.language,
        escalated: this.escalated,
      },
    });

    // Off-path post-call processing; idempotent by jobKey `conv:{id}` (Req 9.2).
    await enqueueJob(
      this.cfg.db,
      "post_call_processing",
      { conversationId: this.cfg.conversationId, partyId: ctx.partyId },
      `conv:${this.cfg.conversationId}`,
    );
  }

  /** Await first-byte + done for an utterance (used by greeting). */
  private async speakAndAwait(text: string): Promise<void> {
    const handle = this.speak(text);
    try {
      await handle.firstByteMs;
      await handle.done;
    } catch {
      // Interrupted or failed playback must not break the call flow.
    }
  }
}

// ── Tool caller transport (audited HTTP dispatcher) ──────────────────────────

/**
 * Build a {@link ToolCaller} that dispatches each tool IN-PROCESS through the
 * audited `callTool` → `dispatchTool` seam (Design §Components #4, Requirement
 * 3.1, 3.2). This is the PREFERRED production transport on the container tier:
 * the worker is co-located with the `db` handle, so dispatching in-process
 * removes the HTTP hop (latency + an extra auth surface) while preserving every
 * guarantee — Zod validation, RBAC, the OTP gate, and audit all live inside
 * `dispatchTool`, not the route handler.
 *
 * Every dispatch carries the static agent identity `agent:voice-lead`
 * (`VOICE_AGENT_ACTOR`, R3.3), so the audit row records the voice agent and the
 * dispatcher's in-process grant for that identity means no RBAC reseeding is
 * needed. The caller's resolved identity + OTP verification state — set once at
 * prefetch — are threaded via {@link InProcessVoiceToolCallerDefaults} so
 * OTP-gated tools (e.g. `get_lead_context`) apply the SAME isolation rules as
 * the text path; absent them, the dispatcher treats the caller as a visitor and
 * intercepts personal-data reads (fail-closed — Property 2).
 *
 * A structured dispatch error is mapped to the orchestrator's {@link ToolError}
 * shape so the agent can speak around it and continue (R3.5).
 *
 * NOTE: {@link createHttpToolCaller} remains the out-of-process fallback for a
 * separately-deployed worker; `createRegistryToolCaller`
 * (`lib/cms/voice/orchestrator.ts`) is un-audited and is for tests/local runs
 * ONLY — never production.
 *
 * @param defaults caller identity + OTP state resolved at prefetch, threaded
 *                 into every dispatch so OTP-gated reads see the verified caller
 */
export function createInProcessVoiceToolCaller(
  defaults?: InProcessVoiceToolCallerDefaults,
): ToolCaller {
  return async (toolName, input, ctx) => {
    const result = await callTool(toolName, input, {
      agentActor: VOICE_AGENT_ACTOR,
      conversationId: ctx.conversationId,
      language: ctx.context.language,
      identity: defaults?.identity,
      otpVerificationState: defaults?.otpVerificationState,
    });
    return result.ok
      ? { ok: true, result: result.result }
      : { ok: false, error: result.error };
  };
}

/** Per-call identity context the in-process caller threads into every dispatch. */
export interface InProcessVoiceToolCallerDefaults {
  /** Resolved caller identity (client / tenant / visitor), set at prefetch. */
  identity?: IdentityResult;
  /** Current OTP verification state on the conversation, set at prefetch. */
  otpVerificationState?: OtpVerificationState;
}

/**
 * Build a {@link ToolCaller} that dispatches each tool through the audited,
 * permission-checked `POST /api/tools/:toolName` route (task 9.1), authenticating
 * with the agent service token (`AGENT_SERVICE_TOKEN`, SEC-2 / Req 14.2). This is
 * the production transport for the worker — auditing + OTP gating happen on the
 * server behind this call, never in the worker. It uses only `fetch`, so it is
 * forward-compatible with the Eden Treaty client (task 19.3) without depending
 * on it.
 *
 * @param baseUrl      internal API base URL (`INTERNAL_API_URL`)
 * @param serviceToken agent service token, scoped to tool routes only
 */
export function createHttpToolCaller(
  baseUrl: string,
  serviceToken: string,
): ToolCaller {
  const root = baseUrl.replace(/\/+$/, "");
  return async (toolName, input) => {
    try {
      const res = await fetch(`${root}/api/tools/${toolName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(input ?? {}),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: unknown; message?: unknown } }
          | null;
        const err = body?.error;
        return {
          ok: false,
          error: {
            code:
              typeof err?.code === "string" ? err.code : `http_${res.status}`,
            message:
              typeof err?.message === "string"
                ? err.message
                : `Tool dispatch failed (${res.status})`,
          },
        };
      }

      const result = await res.json().catch(() => ({}));
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "transport_error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  };
}

// ── Job metadata parsing ─────────────────────────────────────────────────────

/**
 * Parse + validate the LiveKit job metadata into a {@link CallContext}. The
 * session service dispatches the agent with the prefetched context as a
 * JSON-stringified `metadata` field (`lib/cms/voice/livekit.ts` → `dispatchAgent`).
 * Throws a descriptive error on malformed/absent metadata so a bad dispatch
 * fails loudly rather than starting a context-less call.
 */
export function parseJobMetadata(rawMetadata: string | undefined | null): CallContext {
  if (!rawMetadata) {
    throw new Error(
      "[voice-agent] job metadata is missing the prefetched CallContext.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMetadata);
  } catch {
    throw new Error("[voice-agent] job metadata is not valid JSON.");
  }
  return callContextSchema.parse(parsed);
}

// ── Worker bootstrap (LiveKit Agents entrypoint) ─────────────────────────────

/**
 * Thrown by {@link loadVoiceWorkerConfig} when one or more required environment
 * values are missing. Carries the missing variable names so startup fails fast
 * with a clear, actionable message (Requirement 9.3).
 */
export class VoiceWorkerConfigError extends Error {
  /** The names of the required env vars that were absent/empty. */
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `[voice-agent] missing required configuration: ${missing.join(", ")}. ` +
        "Set these before starting the worker (see docs/VOICE_RUNBOOK.md).",
    );
    this.name = "VoiceWorkerConfigError";
    this.missing = missing;
  }
}

/** The validated configuration the voice worker needs to connect + dispatch. */
export interface VoiceWorkerConfig {
  livekit: {
    url: string;
    apiKey: string;
    apiSecret: string;
    /** The agent name the worker registers under for dispatch. */
    agentName: string;
  };
  deepgram: { apiKey: string };
  elevenlabs: {
    apiKey: string;
    /** Primary DOE persona voice id (the `ar` voice is an optional override). */
    voiceId: string;
  };
  /** Service token authenticating the out-of-process tool transport (SEC-2). */
  agentServiceToken: string;
  /** Internal API base URL used by the HTTP tool transport fallback. */
  internalApiUrl: string;
}

/**
 * Validate the voice worker's required configuration up front, throwing a
 * {@link VoiceWorkerConfigError} that names every missing value (Requirement
 * 9.3). `ELEVENLABS_VOICE_ID_AR` is intentionally optional — {@link selectVoiceId}
 * falls back to the primary voice when an Arabic voice is not configured.
 *
 * @param env the environment to read (injectable for tests; defaults to
 *            `process.env`).
 */
export function loadVoiceWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): VoiceWorkerConfig {
  const required = {
    LIVEKIT_URL: env.LIVEKIT_URL,
    LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
    LIVEKIT_AGENT_NAME: env.LIVEKIT_AGENT_NAME,
    DEEPGRAM_API_KEY: env.DEEPGRAM_API_KEY,
    ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: env.ELEVENLABS_VOICE_ID,
    AGENT_SERVICE_TOKEN: env.AGENT_SERVICE_TOKEN,
    INTERNAL_API_URL: env.INTERNAL_API_URL,
  } as const;

  const missing = Object.entries(required)
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new VoiceWorkerConfigError(missing);
  }

  return {
    livekit: {
      url: required.LIVEKIT_URL!,
      apiKey: required.LIVEKIT_API_KEY!,
      apiSecret: required.LIVEKIT_API_SECRET!,
      agentName: required.LIVEKIT_AGENT_NAME!,
    },
    deepgram: { apiKey: required.DEEPGRAM_API_KEY! },
    elevenlabs: {
      apiKey: required.ELEVENLABS_API_KEY!,
      voiceId: required.ELEVENLABS_VOICE_ID!,
    },
    agentServiceToken: required.AGENT_SERVICE_TOKEN!,
    internalApiUrl: required.INTERNAL_API_URL!,
  };
}

/**
 * Build a {@link VoiceAgentSession} for a single LiveKit job from validated
 * config + the job's metadata. This is the type-safe, transport-agnostic core
 * of the entrypoint (testable without the LiveKit SDK): it parses the prefetched
 * {@link CallContext}, wires the in-process audited tool caller
 * ({@link createInProcessVoiceToolCaller}), and supplies the template greeting
 * ({@link buildGreeting}). The caller (the LiveKit entrypoint) supplies the
 * concrete streaming {@link TtsProvider} built from the ElevenLabs plugin.
 *
 * The returned session's {@link VoiceAgentSession.sttConfig} /
 * {@link VoiceAgentSession.ttsVoiceId} tell the entrypoint how to configure
 * Deepgram (interim + barge-in) and ElevenLabs for this call's language.
 */
export function createVoiceSessionForJob(args: {
  db: Database;
  rawMetadata: string | undefined | null;
  tts: TtsProvider;
  /** Caller identity + OTP state resolved at prefetch, threaded into dispatch. */
  toolCallerDefaults?: InProcessVoiceToolCallerDefaults;
}): VoiceAgentSession {
  const context = parseJobMetadata(args.rawMetadata);
  return new VoiceAgentSession({
    conversationId: context.partyId,
    context,
    db: args.db,
    callTool: createInProcessVoiceToolCaller(args.toolCallerDefaults),
    tts: args.tts,
    buildGreeting,
  });
}

/**
 * Dynamically load an OPTIONAL, creds-gated SDK. A non-literal specifier keeps
 * the type-checker/bundler from statically resolving SDKs that may not be
 * installed (LiveKit Agents + Deepgram/ElevenLabs plugins), so importing this
 * module never hard-fails the build/tests.
 */
async function loadOptionalModule<T = unknown>(
  specifier: string,
): Promise<T | null> {
  try {
    return (await import(specifier)) as T;
  } catch {
    return null;
  }
}

/**
 * Boot the LiveKit Agents worker. Startup is fail-fast and self-describing
 * (Requirement 9.3, 9.5):
 *
 *   1. Validate the worker configuration ({@link loadVoiceWorkerConfig}). A
 *      missing value throws a named {@link VoiceWorkerConfigError}; we log it
 *      and exit WITHOUT crashing the platform (R9.5).
 *   2. Load the creds-gated provider SDKs. If any is absent, log exactly what is
 *      missing and exit cleanly — the pipeline core ({@link VoiceAgentSession})
 *      is implemented + tested independently of the SDKs (R9.5).
 *   3. With config + SDKs present, register the agent and, per job, build a
 *      session via {@link createVoiceSessionForJob}, configure Deepgram from
 *      `session.sttConfig` (interim + barge-in) and ElevenLabs from
 *      `session.ttsVoiceId`, then wire final-transcript → `handleCallerTurn`,
 *      speech-start → `notifyCallerSpeechStarted`, disconnect → `handleCallEnded`
 *      (R9.2, R9.4). The {@link VoiceAgentSession} core stays unchanged.
 */
export async function startVoiceAgentWorker(): Promise<void> {
  let cfg: VoiceWorkerConfig;
  try {
    cfg = loadVoiceWorkerConfig();
  } catch (err) {
    if (err instanceof VoiceWorkerConfigError) {
      // Missing config — log the named values and exit cleanly (R9.3, R9.5).
      console.warn(err.message);
      return;
    }
    throw err;
  }

  const agents = await loadOptionalModule("@livekit/agents");
  const deepgram = await loadOptionalModule("@livekit/agents-plugin-deepgram");
  const elevenlabs = await loadOptionalModule(
    "@livekit/agents-plugin-elevenlabs",
  );

  const missingSdks = [
    !agents && "@livekit/agents",
    !deepgram && "@livekit/agents-plugin-deepgram",
    !elevenlabs && "@livekit/agents-plugin-elevenlabs",
  ].filter((m): m is string => typeof m === "string");

  if (missingSdks.length > 0) {
    console.warn(
      `[voice-agent] provider SDK(s) not installed: ${missingSdks.join(", ")}. ` +
        "The worker cannot connect to LiveKit until these are installed. The " +
        "pipeline core (VoiceAgentSession) is implemented and tested " +
        "independently of the SDKs.",
    );
    return;
  }

  // Config + SDKs present. Launch the LiveKit Agents worker via the dedicated
  // entrypoint (`voice-livekit-entry.ts`), imported DYNAMICALLY so this module
  // never statically pulls in the SDK (keeping it import-safe for tests/build).
  // The entry registers under cfg.livekit.agentName for explicit dispatch and,
  // per job, builds the high-level voice.AgentSession (Deepgram STT + ElevenLabs
  // TTS) whose llmNode routes every turn through DOE's audited orchestrator.
  console.info(
    `[voice-agent] configuration validated; starting LiveKit worker as ` +
      `"${cfg.livekit.agentName}" against ${cfg.livekit.url}.`,
  );
  const entry = await loadOptionalModule<{ startLiveKitWorker?: () => void }>(
    "./voice-livekit-entry",
  );
  if (!entry?.startLiveKitWorker) {
    console.warn(
      "[voice-agent] could not load the LiveKit entrypoint " +
        "(workers/voice-livekit-entry.ts). The worker cannot start.",
    );
    return;
  }
  entry.startLiveKitWorker();
}

// Only auto-start when executed directly as a worker (Bun sets import.meta.main).
// Under the test runner / type-checker this stays dormant, so importing the
// module has no side effects.
if ((import.meta as { main?: boolean }).main) {
  void startVoiceAgentWorker();
}
