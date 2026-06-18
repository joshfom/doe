// ── Demo Console: client-safe event types ─────────────────────────────────────
// The server event surface lives in `lib/cms/realtime/events.ts`, but that
// module imports Drizzle/`Database`, so it must not be pulled into the client
// bundle. We mirror the wire shape here as a client-safe contract consumed by
// the EventSource hook and the SSE-driven panes. Keep this union in sync with
// `DoeEventType` in `lib/cms/realtime/events.ts`. (Design §7.6; Req 7.6)

/** Event types emitted across the voice surface and rendered by the Console. */
export type DoeEventType =
  | "session.created"
  | "call.connected"
  | "call.ended"
  | "call.processed"
  | "turn.appended"
  | "tool.called"
  | "decision.made"
  | "outbox.queued"
  | "outbox.sent"
  | "outbox.dead"
  | "job.queued"
  | "job.running"
  | "job.done"
  | "job.failed"
  | "report.sent";

/** A single event as delivered over SSE (`data: ${JSON.stringify(event)}`). */
export interface DoeEvent {
  id: string;
  type: DoeEventType;
  payload: unknown;
  at: string;
}

/** Connection state of the EventSource feeding the Console. */
export type StreamStatus = "connecting" | "open" | "closed";

// ── Payload shapes ────────────────────────────────────────────────────────────
// Payloads arrive as `unknown` over the wire. The panes narrow them with the
// guards below rather than trusting a cast, so a malformed or future payload
// degrades gracefully (rendered generically) instead of throwing.

/** `turn.appended` — one caller/agent exchange plus its latency breakdown. */
export interface TurnLatency {
  sttFinalMs: number;
  llmFirstTokenMs: number;
  ttsFirstByteMs: number;
  voiceToVoiceMs: number;
}

export interface TurnAppendedPayload {
  conversationId: string;
  caller: { content: string; tMs: number | null };
  agent: { content: string; tMs: number | null; latencyMs: number };
  latency: TurnLatency;
}

export interface SessionCreatedPayload {
  conversationId: string;
  partyId: string;
  known: boolean;
  roomName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asTurnAppended(payload: unknown): TurnAppendedPayload | null {
  if (!isRecord(payload)) return null;
  const { conversationId, caller, agent, latency } = payload;
  if (typeof conversationId !== "string") return null;
  if (!isRecord(caller) || !isRecord(agent) || !isRecord(latency)) return null;
  return {
    conversationId,
    caller: {
      content: typeof caller.content === "string" ? caller.content : "",
      tMs: typeof caller.tMs === "number" ? caller.tMs : null,
    },
    agent: {
      content: typeof agent.content === "string" ? agent.content : "",
      tMs: typeof agent.tMs === "number" ? agent.tMs : null,
      latencyMs: typeof agent.latencyMs === "number" ? agent.latencyMs : 0,
    },
    latency: {
      sttFinalMs: typeof latency.sttFinalMs === "number" ? latency.sttFinalMs : 0,
      llmFirstTokenMs:
        typeof latency.llmFirstTokenMs === "number" ? latency.llmFirstTokenMs : 0,
      ttsFirstByteMs:
        typeof latency.ttsFirstByteMs === "number" ? latency.ttsFirstByteMs : 0,
      voiceToVoiceMs:
        typeof latency.voiceToVoiceMs === "number" ? latency.voiceToVoiceMs : 0,
    },
  };
}

export function asRecord(payload: unknown): Record<string, unknown> {
  return isRecord(payload) ? payload : {};
}

/** Best-effort string field read from an unknown payload. */
export function payloadString(payload: unknown, key: string): string | null {
  const record = asRecord(payload);
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** Best-effort number field read from an unknown payload. */
export function payloadNumber(payload: unknown, key: string): number | null {
  const record = asRecord(payload);
  const value = record[key];
  return typeof value === "number" ? value : null;
}
