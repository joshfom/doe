/**
 * DOE Voice Surface — LIVE LiveKit Agents entrypoint (genuine call).
 *
 * This is the real, container-only worker that LiveKit dispatches into a
 * `call_{ulid}` room. Where `workers/voice-agent.ts` holds the transport-
 * agnostic, unit-tested session core, THIS file is the thin bridge that wires
 * that intent to the live LiveKit Agents pipeline (STT → LLM → TTS + VAD/
 * barge-in), reusing the platform's audited tools and the Cloudflare AI Gateway.
 *
 * Pipeline (LiveKit Agents 1.4.x):
 *   STT : Deepgram streaming (AR/EN by CallContext.language)
 *   LLM : Cloudflare AI Gateway (OpenAI-compatible) via the openai plugin
 *   TTS : ElevenLabs streaming (DOE persona voice; AR voice when configured)
 *   VAD : Silero (loaded once in prewarm), enabling barge-in
 *   Background: BackgroundAudioPlayer.thinkingSound — a built-in looping bed
 *               that plays automatically while the agent is "thinking"
 *               (i.e. during tool calls), so the caller never hears dead air.
 *
 * Tooling reuse: every tool the model can call is the SAME audited catalog tool
 * the text path uses — each LiveKit function tool delegates to
 * `createInProcessVoiceToolCaller`, so Zod validation, RBAC, the OTP gate, and
 * audit all still apply (the agent never touches Salesforce/DB directly).
 *
 * Run (container tier only):
 *   bun --env-file=.env workers/voice-agent-livekit.ts dev      # or `start`
 *
 * The agent registers under `LIVEKIT_AGENT_NAME` (default `doe-voice-agent`),
 * matching `dispatchAgent` in `lib/cms/voice/livekit.ts`.
 */

import { fileURLToPath } from "node:url";

import {
  cli,
  defineAgent,
  llm,
  voice,
  WorkerOptions,
  type JobContext,
  type JobProcess,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";

import { db } from "@/lib/cms/db";
import { buildSystemPrompt } from "@/lib/cms/voice/orchestrator";
import { toolSchemas, TOOL_NAMES, type CallContext } from "@/lib/cms/voice/contracts";
import {
  parseJobMetadata,
  buildGreeting,
  selectSttConfig,
  selectVoiceId,
  createInProcessVoiceToolCaller,
} from "./voice-agent";

// ── Provider construction ─────────────────────────────────────────────────────

/** Deepgram streaming STT for the call's language (AR hot-swap). */
function buildStt(context: CallContext): deepgram.STT {
  const cfg = selectSttConfig(context.language);
  return new deepgram.STT({
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: cfg.model as never,
    language: cfg.language as never,
  });
}

/** ElevenLabs streaming TTS with the DOE persona voice. */
function buildTts(context: CallContext): elevenlabs.TTS {
  return new elevenlabs.TTS({
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: selectVoiceId(context.language),
    model: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
  });
}

/**
 * The LLM is the Cloudflare AI Gateway, which is OpenAI-compatible. The openai
 * plugin posts to `${baseURL}/chat/completions`, so `CF_AI_GATEWAY_URL` (the
 * OpenAI-compat endpoint) and `CF_AI_API_TOKEN` drive it with no provider lock-in.
 */
function buildLlm(): openai.LLM {
  return new openai.LLM({
    model: process.env.CF_CHAT_MODEL || "gpt-4o-mini",
    apiKey: process.env.CF_AI_API_TOKEN,
    baseURL: process.env.CF_AI_GATEWAY_URL,
  });
}

// ── Audited tools (reuse the text path's catalog) ─────────────────────────────

/**
 * Build the LiveKit function tools from the voice tool registry. Each tool
 * delegates to the in-process audited dispatcher, so every guarantee (Zod →
 * RBAC → OTP → audit → execute) holds exactly as on the text path. The Zod v4
 * input schemas implement Standard Schema, so LiveKit infers the parameters.
 */
function buildTools(context: CallContext, conversationId: string): llm.ToolContext {
  const callTool = createInProcessVoiceToolCaller();
  const tools: llm.ToolContext = {};

  for (const name of TOOL_NAMES) {
    tools[name] = llm.tool({
      description: `DOE voice tool: ${name}. Routed through the audited dispatcher.`,
      parameters: toolSchemas[name].input as never,
      execute: async (args: unknown) => {
        const result = await callTool(name, args, { conversationId, context });
        // Return a compact JSON the model can narrate; surface errors verbatim
        // so the agent can speak around a failure and continue the turn.
        return JSON.stringify(
          result.ok ? result.result ?? {} : { error: result.error }
        );
      },
    });
  }

  return tools;
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

export default defineAgent({
  /** Load the Silero VAD once per worker process (expensive); reuse per job. */
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // The prefetched, mirror-only CallContext arrives as job metadata.
    const context = parseJobMetadata(ctx.job?.metadata);
    const conversationId = context.partyId;

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: buildStt(context),
      llm: buildLlm(),
      tts: buildTts(context),
    });

    const agent = new voice.Agent({
      instructions: buildSystemPrompt(context),
      tools: buildTools(context, conversationId),
    });

    await session.start({ agent, room: ctx.room });

    // Looping "thinking" bed: plays automatically while the agent state is
    // "thinking" (during tool calls / LLM latency), so the line is never silent.
    const backgroundAudio = new voice.BackgroundAudioPlayer({
      thinkingSound: { source: voice.BuiltinAudioClip.KEYBOARD_TYPING, volume: 0.5 },
    });
    await backgroundAudio.start({ room: ctx.room, agentSession: session });

    // Open with the template greeting built from context (never a free LLM call).
    await session.say(buildGreeting(context));

    void db; // db handle is available for any future entry-time reads.
  },
});

// Launch the worker when executed directly (LiveKit CLI: `dev` | `start`).
cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: process.env.LIVEKIT_AGENT_NAME || "doe-voice-agent",
  })
);
