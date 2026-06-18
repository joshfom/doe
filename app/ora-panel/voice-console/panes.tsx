'use client';

import { useMemo } from 'react';
import {
  MessageSquare,
  GitBranch,
  Activity,
  Send,
  Cog,
  Phone,
  PhoneOff,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import type { DoeEvent } from './types';
import {
  asRecord,
  asTurnAppended,
  payloadNumber,
  payloadString,
} from './types';

// ── Demo Console panes ────────────────────────────────────────────────────────
// Each pane receives the full ordered event log and derives its own view. They
// never throw on an unexpected payload: unknown fields fall back to a generic
// render. (Design §7.6; Req 7.6)

function PaneShell({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: typeof MessageSquare;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col border border-ora-sand/60 bg-ora-white">
      <header className="flex items-center justify-between border-b border-ora-sand bg-ora-cream-light px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 stroke-[1.5] text-ora-charcoal-light" />
          <h2 className="text-xs font-medium uppercase tracking-wide text-ora-charcoal">
            {title}
          </h2>
        </div>
        {typeof count === 'number' && (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ora-sand px-1.5 text-xs text-ora-charcoal-light">
            {count}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="px-1 py-6 text-center text-xs text-ora-muted">{label}</p>
  );
}

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('en-US', { hour12: false });
}

// ── 1. Transcript ─────────────────────────────────────────────────────────────

export function TranscriptPane({ events }: { events: DoeEvent[] }) {
  const turns = useMemo(
    () =>
      events
        .filter((e) => e.type === 'turn.appended')
        .map((e) => ({ id: e.id, at: e.at, turn: asTurnAppended(e.payload) }))
        .filter((t): t is { id: string; at: string; turn: NonNullable<ReturnType<typeof asTurnAppended>> } => t.turn !== null),
    [events]
  );

  return (
    <PaneShell title="Transcript" icon={MessageSquare} count={turns.length}>
      {turns.length === 0 ? (
        <EmptyState label="Waiting for the first exchange…" />
      ) : (
        <ul className="space-y-3">
          {turns.map(({ id, turn }) => (
            <li key={id} className="space-y-1.5">
              {turn.caller.content && (
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg rounded-br-none bg-ora-charcoal px-3 py-1.5 text-sm text-white">
                    {turn.caller.content}
                  </p>
                </div>
              )}
              {turn.agent.content && (
                <div className="flex flex-col items-start">
                  <p className="max-w-[85%] rounded-lg rounded-bl-none bg-ora-cream px-3 py-1.5 text-sm text-ora-charcoal">
                    {turn.agent.content}
                  </p>
                  <span className="mt-0.5 pl-1 text-[10px] uppercase tracking-wide text-ora-muted">
                    {fmtMs(turn.agent.latencyMs)} voice-to-voice
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PaneShell>
  );
}

// ── 2. Decisions ────────────────────────────────────────────────────────────

export function DecisionsPane({ events }: { events: DoeEvent[] }) {
  const decisions = useMemo(
    () => events.filter((e) => e.type === 'decision.made' || e.type === 'tool.called'),
    [events]
  );

  return (
    <PaneShell title="Decisions" icon={GitBranch} count={decisions.length}>
      {decisions.length === 0 ? (
        <EmptyState label="No decisions yet." />
      ) : (
        <ul className="space-y-2">
          {decisions.map((e) => {
            const p = asRecord(e.payload);
            const label =
              payloadString(e.payload, 'decision') ??
              payloadString(e.payload, 'tool') ??
              e.type;
            const routing = payloadString(e.payload, 'routing');
            const repName = payloadString(e.payload, 'repName');
            return (
              <li
                key={e.id}
                className="border border-ora-sand/60 bg-ora-cream-light px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-ora-charcoal">
                    {label}
                  </span>
                  <span className="text-[10px] text-ora-muted">{fmtTime(e.at)}</span>
                </div>
                {repName && (
                  <p className="mt-1 text-xs text-ora-charcoal-light">
                    → {repName}
                  </p>
                )}
                {routing && (
                  <p className="mt-0.5 text-[11px] italic text-ora-muted">{routing}</p>
                )}
                {!repName && !routing && (
                  <p className="mt-1 truncate font-mono text-[11px] text-ora-muted">
                    {JSON.stringify(p)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PaneShell>
  );
}

// ── 3. Actions (per-call status + latency) ───────────────────────────────────

type CallStatus = 'connecting' | 'connected' | 'ended' | 'processed';

interface CallRow {
  conversationId: string;
  status: CallStatus;
  known: boolean | null;
  turns: number;
  lastLatencyMs: number | null;
  bestLatencyMs: number | null;
  updatedAt: string;
}

const CALL_STATUS_META: Record<
  CallStatus,
  { label: string; icon: typeof Phone; className: string }
> = {
  connecting: { label: 'Connecting', icon: Clock, className: 'text-amber-600' },
  connected: { label: 'Live', icon: Phone, className: 'text-emerald-600' },
  ended: { label: 'Ended', icon: PhoneOff, className: 'text-ora-charcoal-light' },
  processed: { label: 'Processed', icon: CheckCircle2, className: 'text-blue-600' },
};

export function ActionsPane({ events }: { events: DoeEvent[] }) {
  const calls = useMemo(() => {
    const byId = new Map<string, CallRow>();
    const ensure = (conversationId: string, at: string): CallRow => {
      let row = byId.get(conversationId);
      if (!row) {
        row = {
          conversationId,
          status: 'connecting',
          known: null,
          turns: 0,
          lastLatencyMs: null,
          bestLatencyMs: null,
          updatedAt: at,
        };
        byId.set(conversationId, row);
      }
      row.updatedAt = at;
      return row;
    };

    for (const e of events) {
      const convId = payloadString(e.payload, 'conversationId');
      switch (e.type) {
        case 'session.created': {
          if (!convId) break;
          const row = ensure(convId, e.at);
          row.status = 'connecting';
          row.known = asRecord(e.payload).known === true;
          break;
        }
        case 'call.connected': {
          if (!convId) break;
          ensure(convId, e.at).status = 'connected';
          break;
        }
        case 'turn.appended': {
          if (!convId) break;
          const row = ensure(convId, e.at);
          if (row.status === 'connecting') row.status = 'connected';
          row.turns += 1;
          const latency = payloadNumber(asRecord(e.payload).agent, 'latencyMs');
          if (latency != null) {
            row.lastLatencyMs = latency;
            row.bestLatencyMs =
              row.bestLatencyMs == null ? latency : Math.min(row.bestLatencyMs, latency);
          }
          break;
        }
        case 'call.ended': {
          if (!convId) break;
          ensure(convId, e.at).status = 'ended';
          break;
        }
        case 'call.processed': {
          if (!convId) break;
          ensure(convId, e.at).status = 'processed';
          break;
        }
      }
    }

    return Array.from(byId.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [events]);

  return (
    <PaneShell title="Calls" icon={Activity} count={calls.length}>
      {calls.length === 0 ? (
        <EmptyState label="No calls yet." />
      ) : (
        <ul className="space-y-2">
          {calls.map((call) => {
            const meta = CALL_STATUS_META[call.status];
            const StatusIcon = meta.icon;
            return (
              <li
                key={call.conversationId}
                className="border border-ora-sand/60 bg-ora-cream-light px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ora-charcoal">
                    {shortId(call.conversationId)}
                  </span>
                  <span className={`flex items-center gap-1 text-xs font-medium ${meta.className}`}>
                    <StatusIcon className="h-3.5 w-3.5 stroke-[1.5]" />
                    {meta.label}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-ora-charcoal-light">
                  <span>
                    {call.known != null && (
                      <span className="mr-2 rounded bg-ora-sand px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {call.known ? 'Known' : 'New'}
                      </span>
                    )}
                    {call.turns} turn{call.turns === 1 ? '' : 's'}
                  </span>
                  <span className="text-ora-muted">
                    last {fmtMs(call.lastLatencyMs)} · best {fmtMs(call.bestLatencyMs)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PaneShell>
  );
}

// ── 4. Salesforce outbox ─────────────────────────────────────────────────────

type OutboxState = 'queued' | 'sent' | 'dead';

interface OutboxRow {
  key: string;
  kind: string | null;
  state: OutboxState;
  sfId: string | null;
  attempts: number | null;
  lastError: string | null;
  updatedAt: string;
}

const OUTBOX_META: Record<OutboxState, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-amber-100 text-amber-700' },
  sent: { label: 'Sent', className: 'bg-emerald-100 text-emerald-700' },
  dead: { label: 'Dead', className: 'bg-red-100 text-red-700' },
};

export function OutboxPane({ events }: { events: DoeEvent[] }) {
  const rows = useMemo(() => {
    const byKey = new Map<string, OutboxRow>();
    for (const e of events) {
      if (!e.type.startsWith('outbox.')) continue;
      // The outbox identifies a row by its db id; fall back to event id.
      const key = payloadString(e.payload, 'id') ?? e.id;
      const state: OutboxState =
        e.type === 'outbox.sent' ? 'sent' : e.type === 'outbox.dead' ? 'dead' : 'queued';
      const prev = byKey.get(key);
      byKey.set(key, {
        key,
        // Later events may omit fields the queued event carried; keep prior values.
        kind: payloadString(e.payload, 'kind') ?? prev?.kind ?? null,
        state,
        sfId: payloadString(e.payload, 'sfId') ?? prev?.sfId ?? null,
        attempts: payloadNumber(e.payload, 'attempts') ?? prev?.attempts ?? null,
        lastError: payloadString(e.payload, 'lastError') ?? prev?.lastError ?? null,
        updatedAt: e.at,
      });
    }
    return Array.from(byKey.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [events]);

  return (
    <PaneShell title="Salesforce Outbox" icon={Send} count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState label="Nothing queued for Salesforce." />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const meta = OUTBOX_META[row.state];
            return (
              <li
                key={row.key}
                className="border border-ora-sand/60 bg-ora-cream-light px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ora-charcoal">
                    {row.kind ?? 'outbox'}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.className}`}>
                    {meta.label}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-ora-muted">
                  <span>{row.sfId ? `sf: ${shortId(row.sfId)}` : shortId(row.key)}</span>
                  {row.attempts != null && <span>{row.attempts} attempt{row.attempts === 1 ? '' : 's'}</span>}
                </div>
                {row.lastError && (
                  <p className="mt-1 truncate text-[11px] text-red-600">{row.lastError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PaneShell>
  );
}

// ── 5. Job runs ───────────────────────────────────────────────────────────────

type JobState = 'queued' | 'running' | 'done' | 'failed';

interface JobRow {
  key: string;
  kind: string | null;
  state: JobState;
  error: string | null;
  updatedAt: string;
}

const JOB_META: Record<JobState, { label: string; icon: typeof Cog; className: string }> = {
  queued: { label: 'Queued', icon: Clock, className: 'text-amber-600' },
  running: { label: 'Running', icon: Cog, className: 'text-blue-600' },
  done: { label: 'Done', icon: CheckCircle2, className: 'text-emerald-600' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-red-600' },
};

export function JobRunsPane({ events }: { events: DoeEvent[] }) {
  const rows = useMemo(() => {
    const byKey = new Map<string, JobRow>();
    for (const e of events) {
      const isJob = e.type.startsWith('job.');
      const isReport = e.type === 'report.sent';
      if (!isJob && !isReport) continue;
      const key =
        payloadString(e.payload, 'jobId') ??
        payloadString(e.payload, 'jobKey') ??
        e.id;
      const state: JobState = isReport
        ? 'done'
        : e.type === 'job.running'
          ? 'running'
          : e.type === 'job.done'
            ? 'done'
            : e.type === 'job.failed'
              ? 'failed'
              : 'queued';
      byKey.set(key, {
        key,
        kind: payloadString(e.payload, 'kind') ?? (isReport ? 'report' : null),
        state,
        error: payloadString(e.payload, 'error'),
        updatedAt: e.at,
      });
    }
    return Array.from(byKey.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [events]);

  return (
    <PaneShell title="Job Runs" icon={Cog} count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState label="No jobs have run yet." />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const meta = JOB_META[row.state];
            const JobIcon = meta.icon;
            return (
              <li
                key={row.key}
                className="border border-ora-sand/60 bg-ora-cream-light px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ora-charcoal">
                    {row.kind ?? 'job'}
                  </span>
                  <span className={`flex items-center gap-1 text-xs font-medium ${meta.className}`}>
                    <JobIcon className="h-3.5 w-3.5 stroke-[1.5]" />
                    {meta.label}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-ora-muted">
                  <span>{shortId(row.key)}</span>
                  <span>{fmtTime(row.updatedAt)}</span>
                </div>
                {row.error && (
                  <p className="mt-1 truncate text-[11px] text-red-600">{row.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PaneShell>
  );
}
