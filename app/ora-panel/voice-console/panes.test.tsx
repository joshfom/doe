// Component tests for the five SSE-driven Demo Console panes (task 15.4).
// Feeds synthetic ordered event logs to each pane and asserts the rendered
// view derives correctly from the stream.
//
// Validates: Requirements 7.6 (transcript, decisions, actions w/ per-call
// status + latency, Salesforce outbox state, job runs — all driven by the
// SSE event bus).

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';

import {
  TranscriptPane,
  DecisionsPane,
  ActionsPane,
  OutboxPane,
  JobRunsPane,
} from './panes';
import type { DoeEvent, DoeEventType } from './types';

afterEach(cleanup);

// ── Synthetic event builders ───────────────────────────────────────────────

let seq = 0;
function evt(type: DoeEventType, payload: unknown, at?: string): DoeEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    type,
    payload,
    // Monotonic ISO timestamps so ordering/sorting is deterministic.
    at: at ?? new Date(Date.UTC(2025, 0, 1, 0, 0, seq)).toISOString(),
  };
}

function turnAppended(
  conversationId: string,
  caller: string,
  agent: string,
  latencyMs: number,
  at?: string,
): DoeEvent {
  return evt(
    'turn.appended',
    {
      conversationId,
      caller: { content: caller, tMs: 0 },
      agent: { content: agent, tMs: 1, latencyMs },
      latency: {
        sttFinalMs: 100,
        llmFirstTokenMs: 200,
        ttsFirstByteMs: 50,
        voiceToVoiceMs: latencyMs,
      },
    },
    at,
  );
}

// ── 1. Transcript ───────────────────────────────────────────────────────────

describe('<TranscriptPane />', () => {
  it('renders an empty state when no turns have arrived', () => {
    render(<TranscriptPane events={[]} />);
    expect(screen.getByText(/waiting for the first exchange/i)).toBeTruthy();
  });

  it('renders caller and agent content from turn.appended events', () => {
    const events = [
      turnAppended('c1', 'Hi, I want a 2BR in Dubai Marina', 'Sure, let me check availability', 640),
      turnAppended('c1', 'What about the price?', 'Starting at 1.8M AED', 720),
    ];
    render(<TranscriptPane events={events} />);

    expect(screen.getByText('Hi, I want a 2BR in Dubai Marina')).toBeTruthy();
    expect(screen.getByText('Sure, let me check availability')).toBeTruthy();
    expect(screen.getByText('What about the price?')).toBeTruthy();
    expect(screen.getByText('Starting at 1.8M AED')).toBeTruthy();
  });

  it('surfaces the per-turn voice-to-voice latency label', () => {
    render(<TranscriptPane events={[turnAppended('c1', 'hello', 'hi there', 850)]} />);
    expect(screen.getByText(/850ms voice-to-voice/i)).toBeTruthy();
  });

  it('ignores non turn.appended events in the stream', () => {
    const events = [
      evt('session.created', { conversationId: 'c1', known: false }),
      turnAppended('c1', 'only this one', 'reply', 500),
      evt('tool.called', { tool: 'book_viewing' }),
    ];
    render(<TranscriptPane events={events} />);
    expect(screen.getByText('only this one')).toBeTruthy();
    expect(screen.getByText('reply')).toBeTruthy();
  });

  it('does not throw on a malformed turn payload and renders nothing for it', () => {
    const events = [evt('turn.appended', { conversationId: 'c1' /* missing caller/agent */ })];
    render(<TranscriptPane events={events} />);
    // Malformed payloads are filtered out → empty state.
    expect(screen.getByText(/waiting for the first exchange/i)).toBeTruthy();
  });
});

// ── 2. Decisions ──────────────────────────────────────────────────────────────

describe('<DecisionsPane />', () => {
  it('renders an empty state with no decisions', () => {
    render(<DecisionsPane events={[]} />);
    expect(screen.getByText(/no decisions yet/i)).toBeTruthy();
  });

  it('renders decision.made entries with routing and rep details', () => {
    const events = [
      evt('decision.made', {
        decision: 'assign_rep',
        repName: 'Layla Hassan',
        routing: 'Marina project · Arabic-speaking · lowest load',
      }),
    ];
    render(<DecisionsPane events={events} />);

    expect(screen.getByText('assign_rep')).toBeTruthy();
    expect(screen.getByText(/Layla Hassan/)).toBeTruthy();
    expect(screen.getByText(/Marina project · Arabic-speaking · lowest load/)).toBeTruthy();
  });

  it('renders tool.called entries using the tool name', () => {
    const events = [evt('tool.called', { tool: 'book_viewing' })];
    render(<DecisionsPane events={events} />);
    expect(screen.getByText('book_viewing')).toBeTruthy();
  });

  it('aggregates both decision.made and tool.called and ignores other events', () => {
    const events = [
      evt('session.created', { conversationId: 'c1' }),
      evt('decision.made', { decision: 'score_lead' }),
      evt('tool.called', { tool: 'check_viewing_slots' }),
      evt('turn.appended', { conversationId: 'c1' }),
    ];
    render(<DecisionsPane events={events} />);
    expect(screen.getByText('score_lead')).toBeTruthy();
    expect(screen.getByText('check_viewing_slots')).toBeTruthy();
  });
});

// ── 3. Actions / Calls (per-call status + latency) ────────────────────────────

describe('<ActionsPane />', () => {
  it('renders an empty state with no calls', () => {
    render(<ActionsPane events={[]} />);
    expect(screen.getByText(/no calls yet/i)).toBeTruthy();
  });

  it('aggregates a call lifecycle into a single row reflecting the latest status', () => {
    const events = [
      evt('session.created', { conversationId: 'conv-aaaaaa11', known: true }),
      evt('call.connected', { conversationId: 'conv-aaaaaa11' }),
      turnAppended('conv-aaaaaa11', 'hi', 'hello', 600),
      turnAppended('conv-aaaaaa11', 'more', 'sure', 800),
      evt('call.ended', { conversationId: 'conv-aaaaaa11' }),
      evt('call.processed', { conversationId: 'conv-aaaaaa11' }),
    ];
    render(<ActionsPane events={events} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const row = items[0];

    // Final status after the full lifecycle is "Processed".
    expect(within(row).getByText('Processed')).toBeTruthy();
    // Known caller badge + 2 turns aggregated.
    expect(within(row).getByText('Known')).toBeTruthy();
    expect(within(row).getByText(/2 turns/)).toBeTruthy();
    // Latency: last = 800ms, best = min(600,800) = 600ms.
    expect(within(row).getByText(/last 800ms · best 600ms/)).toBeTruthy();
  });

  it('marks an unknown caller as New and shows Live while connected', () => {
    const events = [
      evt('session.created', { conversationId: 'conv-bbbbbb22', known: false }),
      evt('call.connected', { conversationId: 'conv-bbbbbb22' }),
    ];
    render(<ActionsPane events={events} />);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('New')).toBeTruthy();
    expect(within(row).getByText('Live')).toBeTruthy();
  });

  it('tracks multiple concurrent calls as separate rows', () => {
    const events = [
      evt('session.created', { conversationId: 'conv-aaaaaa11', known: true }),
      evt('session.created', { conversationId: 'conv-bbbbbb22', known: false }),
      evt('call.connected', { conversationId: 'conv-aaaaaa11' }),
    ];
    render(<ActionsPane events={events} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('promotes a call to connected on the first turn even without call.connected', () => {
    const events = [
      evt('session.created', { conversationId: 'conv-cccccc33', known: false }),
      turnAppended('conv-cccccc33', 'hi', 'hello', 700),
    ];
    render(<ActionsPane events={events} />);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Live')).toBeTruthy();
    expect(within(row).getByText(/1 turn\b/)).toBeTruthy();
  });
});

// ── 4. Salesforce outbox ─────────────────────────────────────────────────────

describe('<OutboxPane />', () => {
  it('renders an empty state with nothing queued', () => {
    render(<OutboxPane events={[]} />);
    expect(screen.getByText(/nothing queued for salesforce/i)).toBeTruthy();
  });

  it('reflects the latest outbox state when a row transitions queued → sent', () => {
    const events = [
      evt('outbox.queued', { id: 'ob-1', kind: 'event', attempts: 0 }),
      evt('outbox.sent', { id: 'ob-1', kind: 'event', sfId: '003ABCDEFG', attempts: 1 }),
    ];
    render(<OutboxPane events={events} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const row = items[0];
    expect(within(row).getByText('Sent')).toBeTruthy();
    expect(within(row).getByText('event')).toBeTruthy();
    expect(within(row).getByText(/sf: 003ABCDE/)).toBeTruthy();
    expect(within(row).getByText(/1 attempt\b/)).toBeTruthy();
  });

  it('renders a dead-lettered row with its last error', () => {
    const events = [
      evt('outbox.queued', { id: 'ob-9', kind: 'task' }),
      evt('outbox.dead', { id: 'ob-9', kind: 'task', attempts: 5, lastError: 'INVALID_FIELD' }),
    ];
    render(<OutboxPane events={events} />);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Dead')).toBeTruthy();
    expect(within(row).getByText('INVALID_FIELD')).toBeTruthy();
  });

  it('keeps prior fields when later events omit them', () => {
    const events = [
      evt('outbox.queued', { id: 'ob-2', kind: 'event', attempts: 0 }),
      evt('outbox.sent', { id: 'ob-2', sfId: '006XYZ' }),
    ];
    render(<OutboxPane events={events} />);
    const row = screen.getByRole('listitem');
    // kind carried over from the queued event.
    expect(within(row).getByText('event')).toBeTruthy();
    expect(within(row).getByText('Sent')).toBeTruthy();
  });

  it('tracks distinct outbox rows separately and ignores non-outbox events', () => {
    const events = [
      evt('job.queued', { jobId: 'j1', kind: 'post_call_processing' }),
      evt('outbox.queued', { id: 'ob-a', kind: 'event' }),
      evt('outbox.queued', { id: 'ob-b', kind: 'task' }),
    ];
    render(<OutboxPane events={events} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

// ── 5. Job runs ───────────────────────────────────────────────────────────────

describe('<JobRunsPane />', () => {
  it('renders an empty state when no jobs have run', () => {
    render(<JobRunsPane events={[]} />);
    expect(screen.getByText(/no jobs have run yet/i)).toBeTruthy();
  });

  it('reflects a job progressing queued → running → done as a single row', () => {
    const events = [
      evt('job.queued', { jobId: 'job-1', kind: 'post_call_processing' }),
      evt('job.running', { jobId: 'job-1', kind: 'post_call_processing' }),
      evt('job.done', { jobId: 'job-1', kind: 'post_call_processing' }),
    ];
    render(<JobRunsPane events={events} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const row = items[0];
    expect(within(row).getByText('Done')).toBeTruthy();
    expect(within(row).getByText('post_call_processing')).toBeTruthy();
  });

  it('renders a failed job with its error message', () => {
    const events = [
      evt('job.queued', { jobId: 'job-2', kind: 'report' }),
      evt('job.failed', { jobId: 'job-2', kind: 'report', error: 'SMTP timeout' }),
    ];
    render(<JobRunsPane events={events} />);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Failed')).toBeTruthy();
    expect(within(row).getByText('SMTP timeout')).toBeTruthy();
  });

  it('renders a report.sent event as a done report row', () => {
    const events = [evt('report.sent', { jobId: 'rep-1' })];
    render(<JobRunsPane events={events} />);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Done')).toBeTruthy();
    expect(within(row).getByText('report')).toBeTruthy();
  });

  it('tracks distinct jobs separately and ignores unrelated events', () => {
    const events = [
      evt('outbox.queued', { id: 'ob-1', kind: 'event' }),
      evt('job.running', { jobId: 'job-a', kind: 'post_call_processing' }),
      evt('job.queued', { jobId: 'job-b', kind: 'report' }),
    ];
    render(<JobRunsPane events={events} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
