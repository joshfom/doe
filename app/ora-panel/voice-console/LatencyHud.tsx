'use client';

// ── Latency HUD (Demo Console) ────────────────────────────────────────────────
// Task 15.2 — Design §7.6, §21; Requirements 7.7 (FR-C2, NFR-1).
//
// Self-contained, presentational client component that renders the per-turn
// voice-to-voice latency surfaced by `turn.appended` SSE events. It deliberately
// does NOT own an `EventSource`: the Console page (task 15.1) owns the single
// `GET /api/realtime/events` subscription and feeds this component the events (or
// pre-parsed turns) it has already accumulated. Keeping it controlled-by-props
// means it can be unit-tested with synthetic payloads and mounted anywhere the
// page already has the event stream.
//
// Mounting (task 15.1):
//   import { LatencyHud } from './LatencyHud';
//   <LatencyHud events={events} />            // pass the raw SSE event list, or
//   <LatencyHud turns={parsedTurns} />        // pass pre-parsed turns
//
// PRIVACY: the upstream `turn.appended` payload is already privacy-safe (ids,
// timings, transcript text — never a raw phone number, FR-V5 / Property 9). This
// component only reads latency numbers, so it cannot leak phone data.

import { useMemo } from 'react';

// ── Payload contracts (mirror lib/cms/voice/orchestrator.ts emit shape) ────────

/** Per-turn latency breakdown carried on a `turn.appended` event. */
export interface TurnLatency {
  /** STT-final time (worker pipeline). */
  sttFinalMs: number;
  /** Time from turn start to the model's first response token. */
  llmFirstTokenMs: number;
  /** TTS-first-byte time (worker pipeline). */
  ttsFirstByteMs: number;
  /** Full caller-stops-speaking → first-audio-byte estimate (the NFR-1 number). */
  voiceToVoiceMs: number;
}

/** The `payload` of a `turn.appended` event as emitted by the orchestrator. */
export interface TurnAppendedPayload {
  conversationId: string;
  caller: { content: string; tMs: number | null };
  agent: { content: string; tMs: number | null; latencyMs: number };
  latency: TurnLatency;
}

/**
 * Minimal shape of an SSE event the HUD can consume. Matches `DoeEvent` from
 * `lib/cms/realtime/events.ts` but only requires the fields the HUD reads, so
 * task 15.1 can pass through whatever event objects it already holds.
 */
export interface LatencyHudEvent {
  id?: string;
  type: string;
  payload: unknown;
  at?: string;
}

/** A normalized latency turn the HUD renders. */
export interface LatencyTurn {
  /** Stable key for list rendering (event id when available, else derived). */
  key: string;
  conversationId: string;
  latency: TurnLatency;
}

// ── Budget thresholds (Requirement 15.1 / NFR-1) ───────────────────────────────
// Voice-to-voice budget: p50 ≤ 800ms, p95 ≤ 1200ms. We colour individual turns
// against these same thresholds so the eye can spot a turn that blew the budget.
const BUDGET_GOOD_MS = 800;
const BUDGET_WARN_MS = 1200;

type Tier = 'good' | 'warn' | 'bad';

function tierFor(ms: number): Tier {
  if (ms <= BUDGET_GOOD_MS) return 'good';
  if (ms <= BUDGET_WARN_MS) return 'warn';
  return 'bad';
}

const TIER_TEXT: Record<Tier, string> = {
  good: 'text-ora-success',
  warn: 'text-ora-warning',
  bad: 'text-ora-error',
};

const TIER_DOT: Record<Tier, string> = {
  good: 'bg-ora-success',
  warn: 'bg-ora-warning',
  bad: 'bg-ora-error',
};

// ── Pure helpers (exported for unit testing) ───────────────────────────────────

/** Type guard: is `value` a finite, non-negative millisecond number? */
function isMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Parse a single SSE event into a {@link LatencyTurn}, or `null` when the event
 * is not a well-formed `turn.appended` payload. Tolerant of malformed payloads
 * so a bad event never crashes the HUD.
 */
export function parseTurnAppended(
  event: LatencyHudEvent,
  index = 0,
): LatencyTurn | null {
  if (!event || event.type !== 'turn.appended') return null;
  const payload = event.payload as Partial<TurnAppendedPayload> | null;
  if (!payload || typeof payload !== 'object') return null;

  const conversationId =
    typeof payload.conversationId === 'string' ? payload.conversationId : null;
  const raw = payload.latency as Partial<TurnLatency> | undefined;
  if (!conversationId || !raw || !isMs(raw.voiceToVoiceMs)) return null;

  const latency: TurnLatency = {
    sttFinalMs: isMs(raw.sttFinalMs) ? raw.sttFinalMs : 0,
    llmFirstTokenMs: isMs(raw.llmFirstTokenMs) ? raw.llmFirstTokenMs : 0,
    ttsFirstByteMs: isMs(raw.ttsFirstByteMs) ? raw.ttsFirstByteMs : 0,
    voiceToVoiceMs: raw.voiceToVoiceMs,
  };

  return {
    key: event.id ?? `${conversationId}:${index}`,
    conversationId,
    latency,
  };
}

/** Extract all latency turns from a list of SSE events, in order. */
export function extractLatencyTurns(
  events: ReadonlyArray<LatencyHudEvent>,
): LatencyTurn[] {
  const turns: LatencyTurn[] = [];
  events.forEach((event, i) => {
    const turn = parseTurnAppended(event, i);
    if (turn) turns.push(turn);
  });
  return turns;
}

/**
 * Nearest-rank percentile (0–100) over a list of numbers. Returns `null` for an
 * empty list. Used for the p50/p95 voice-to-voice summary (NFR-1).
 */
export function percentile(values: ReadonlyArray<number>, p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

function fmtMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface LatencyHudProps {
  /** Raw SSE events (the HUD filters for `turn.appended`). */
  events?: ReadonlyArray<LatencyHudEvent>;
  /** Pre-parsed turns, used instead of `events` when provided. */
  turns?: ReadonlyArray<LatencyTurn>;
  /** Restrict the HUD to a single conversation when set. */
  conversationId?: string;
  /** Max number of recent turns to list (default 12). The summary uses all turns. */
  maxRows?: number;
  className?: string;
}

/**
 * Per-turn voice-to-voice latency HUD. Shows a live summary (latest, p50, p95
 * against the NFR-1 budget) plus a per-turn list with the STT / LLM / TTS
 * breakdown. Renders an empty state until the first `turn.appended` arrives.
 */
export function LatencyHud({
  events,
  turns: turnsProp,
  conversationId,
  maxRows = 12,
  className,
}: LatencyHudProps) {
  const turns = useMemo(() => {
    const base = turnsProp ?? extractLatencyTurns(events ?? []);
    return conversationId
      ? base.filter((t) => t.conversationId === conversationId)
      : base;
  }, [events, turnsProp, conversationId]);

  const v2v = useMemo(
    () => turns.map((t) => t.latency.voiceToVoiceMs),
    [turns],
  );

  const latest = v2v.length > 0 ? v2v[v2v.length - 1] : null;
  const p50 = percentile(v2v, 50);
  const p95 = percentile(v2v, 95);

  // Most recent turns first, capped at maxRows.
  const recent = useMemo(
    () => [...turns].reverse().slice(0, maxRows),
    [turns, maxRows],
  );

  return (
    <section
      data-testid="latency-hud"
      className={`rounded-lg border border-ora-sand bg-white p-4 ${className ?? ''}`}
      aria-label="Voice-to-voice latency HUD"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ora-charcoal">
          Latency
        </h2>
        <span className="text-[11px] text-ora-charcoal-light">
          voice-to-voice · budget p50 ≤ {BUDGET_GOOD_MS}ms / p95 ≤ {BUDGET_WARN_MS}ms
        </span>
      </header>

      {turns.length === 0 ? (
        <p
          data-testid="latency-hud-empty"
          className="py-6 text-center text-sm text-ora-charcoal-light"
        >
          Waiting for the first turn…
        </p>
      ) : (
        <>
          {/* Summary stats */}
          <dl className="mb-4 grid grid-cols-3 gap-3">
            <Stat label="Latest" ms={latest} />
            <Stat label="p50" ms={p50} />
            <Stat label="p95" ms={p95} />
          </dl>

          {/* Per-turn list (most recent first) */}
          <ol className="space-y-1.5" data-testid="latency-hud-turns">
            {recent.map((turn, i) => {
              const ms = turn.latency.voiceToVoiceMs;
              const tier = tierFor(ms);
              const turnNumber = turns.length - i;
              return (
                <li
                  key={turn.key}
                  data-testid="latency-hud-turn"
                  data-v2v-ms={Math.round(ms)}
                  className="flex items-center justify-between gap-3 rounded-md bg-ora-sand/40 px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${TIER_DOT[tier]}`}
                      aria-hidden
                    />
                    <span className="text-xs font-medium text-ora-charcoal">
                      Turn {turnNumber}
                    </span>
                  </span>

                  <span className="flex items-center gap-3">
                    <span className="hidden text-[10px] tabular-nums text-ora-charcoal-light sm:inline">
                      stt {fmtMs(turn.latency.sttFinalMs)} · llm{' '}
                      {fmtMs(turn.latency.llmFirstTokenMs)} · tts{' '}
                      {fmtMs(turn.latency.ttsFirstByteMs)}
                    </span>
                    <span
                      className={`text-sm font-semibold tabular-nums ${TIER_TEXT[tier]}`}
                    >
                      {fmtMs(ms)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function Stat({ label, ms }: { label: string; ms: number | null }) {
  const tier = ms == null ? null : tierFor(ms);
  return (
    <div className="rounded-md border border-ora-sand bg-ora-sand/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-ora-charcoal-light">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tier ? TIER_TEXT[tier] : 'text-ora-charcoal-light'
        }`}
      >
        {ms == null ? '—' : fmtMs(ms)}
      </dd>
    </div>
  );
}

export default LatencyHud;
