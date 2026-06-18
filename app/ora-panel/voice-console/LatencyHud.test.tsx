// Component + helper tests for the latency HUD (task 15.2).
// Feeds synthetic `turn.appended` payloads and asserts the HUD surfaces
// per-turn voice-to-voice milliseconds and the p50/p95 summary (Req 7.7 / NFR-1).

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import {
  LatencyHud,
  parseTurnAppended,
  extractLatencyTurns,
  percentile,
  type LatencyHudEvent,
} from './LatencyHud';

afterEach(cleanup);

// ── Synthetic payload builder (mirrors orchestrator emit shape) ────────────────

function turnEvent(
  conversationId: string,
  voiceToVoiceMs: number,
  opts: { sttFinalMs?: number; llmFirstTokenMs?: number; ttsFirstByteMs?: number; id?: string } = {},
): LatencyHudEvent {
  return {
    id: opts.id,
    type: 'turn.appended',
    at: new Date().toISOString(),
    payload: {
      conversationId,
      caller: { content: 'hello', tMs: 0 },
      agent: { content: 'hi there', tMs: 1, latencyMs: voiceToVoiceMs },
      latency: {
        sttFinalMs: opts.sttFinalMs ?? 100,
        llmFirstTokenMs: opts.llmFirstTokenMs ?? 200,
        ttsFirstByteMs: opts.ttsFirstByteMs ?? 50,
        voiceToVoiceMs,
      },
    },
  };
}

describe('parseTurnAppended', () => {
  it('parses a well-formed turn.appended event', () => {
    const turn = parseTurnAppended(turnEvent('conv-1', 750, { id: 'e1' }));
    expect(turn).not.toBeNull();
    expect(turn?.conversationId).toBe('conv-1');
    expect(turn?.latency.voiceToVoiceMs).toBe(750);
    expect(turn?.key).toBe('e1');
  });

  it('ignores non turn.appended events', () => {
    expect(
      parseTurnAppended({ type: 'session.created', payload: {} }),
    ).toBeNull();
  });

  it('returns null for malformed payloads (missing latency)', () => {
    expect(
      parseTurnAppended({ type: 'turn.appended', payload: { conversationId: 'c' } }),
    ).toBeNull();
  });

  it('returns null when payload is not an object', () => {
    expect(parseTurnAppended({ type: 'turn.appended', payload: null })).toBeNull();
    expect(parseTurnAppended({ type: 'turn.appended', payload: 'nope' })).toBeNull();
  });

  it('defaults missing breakdown fields to 0 but requires voiceToVoiceMs', () => {
    const turn = parseTurnAppended({
      type: 'turn.appended',
      payload: {
        conversationId: 'c',
        caller: { content: '', tMs: null },
        agent: { content: '', tMs: null, latencyMs: 500 },
        latency: { voiceToVoiceMs: 500 },
      },
    });
    expect(turn?.latency.sttFinalMs).toBe(0);
    expect(turn?.latency.llmFirstTokenMs).toBe(0);
    expect(turn?.latency.ttsFirstByteMs).toBe(0);
    expect(turn?.latency.voiceToVoiceMs).toBe(500);
  });

  it('derives a stable key from conversationId + index when no event id', () => {
    const turn = parseTurnAppended(turnEvent('conv-9', 600), 3);
    expect(turn?.key).toBe('conv-9:3');
  });
});

describe('extractLatencyTurns', () => {
  it('keeps only turn.appended events, in order', () => {
    const events: LatencyHudEvent[] = [
      { type: 'session.created', payload: {} },
      turnEvent('c', 700),
      { type: 'tool.called', payload: {} },
      turnEvent('c', 900),
    ];
    const turns = extractLatencyTurns(events);
    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t.latency.voiceToVoiceMs)).toEqual([700, 900]);
  });
});

describe('percentile', () => {
  it('returns null for an empty list', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('computes nearest-rank percentiles', () => {
    const xs = [100, 200, 300, 400, 500];
    expect(percentile(xs, 50)).toBe(300);
    expect(percentile(xs, 95)).toBe(500);
    expect(percentile(xs, 1)).toBe(100);
  });

  it('is order-independent', () => {
    expect(percentile([500, 100, 300, 200, 400], 50)).toBe(300);
  });
});

describe('<LatencyHud />', () => {
  it('renders an empty state before any turn arrives', () => {
    render(<LatencyHud events={[]} />);
    expect(screen.getByTestId('latency-hud-empty')).toBeTruthy();
  });

  it('renders one row per turn.appended event with its voice-to-voice ms', () => {
    const events = [turnEvent('c', 640), turnEvent('c', 1100), turnEvent('c', 1500)];
    render(<LatencyHud events={events} />);

    const rows = screen.getAllByTestId('latency-hud-turn');
    expect(rows).toHaveLength(3);

    // Most-recent first → the 1500ms turn is at the top.
    expect(rows[0].getAttribute('data-v2v-ms')).toBe('1500');
    expect(rows[0].textContent).toContain('1500ms');
    expect(rows[2].getAttribute('data-v2v-ms')).toBe('640');
  });

  it('shows the latest, p50 and p95 voice-to-voice summary', () => {
    const events = [
      turnEvent('c', 400),
      turnEvent('c', 600),
      turnEvent('c', 800),
      turnEvent('c', 1000),
      turnEvent('c', 1200),
    ];
    render(<LatencyHud events={events} />);

    const hud = screen.getByTestId('latency-hud');
    // Latest = last turn (1200), p50 = 800, p95 = 1200 (nearest-rank).
    expect(hud.textContent).toContain('1200ms'); // latest + p95
    expect(hud.textContent).toContain('800ms'); // p50
  });

  it('accepts pre-parsed turns via the turns prop', () => {
    const turns = extractLatencyTurns([turnEvent('c', 720)]);
    render(<LatencyHud turns={turns} />);
    expect(screen.getAllByTestId('latency-hud-turn')).toHaveLength(1);
    expect(screen.getByTestId('latency-hud-turn').textContent).toContain('720ms');
  });

  it('filters to a single conversation when conversationId is set', () => {
    const events = [
      turnEvent('conv-a', 500),
      turnEvent('conv-b', 900),
      turnEvent('conv-a', 700),
    ];
    render(<LatencyHud events={events} conversationId="conv-a" />);
    const rows = screen.getAllByTestId('latency-hud-turn');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.getAttribute('data-v2v-ms')).sort()).toEqual(['500', '700']);
  });

  it('caps the rendered rows at maxRows while keeping the most recent', () => {
    const events = Array.from({ length: 20 }, (_, i) => turnEvent('c', 100 + i, { id: `e${i}` }));
    render(<LatencyHud events={events} maxRows={5} />);
    const rows = screen.getAllByTestId('latency-hud-turn');
    expect(rows).toHaveLength(5);
    // Newest first → the last event (119ms) is on top.
    expect(rows[0].getAttribute('data-v2v-ms')).toBe('119');
  });

  it('ignores non-latency events mixed into the stream', () => {
    const events: LatencyHudEvent[] = [
      { type: 'session.created', payload: { conversationId: 'c' } },
      turnEvent('c', 650),
      { type: 'outbox.sent', payload: {} },
    ];
    render(<LatencyHud events={events} />);
    expect(screen.getAllByTestId('latency-hud-turn')).toHaveLength(1);
  });
});
