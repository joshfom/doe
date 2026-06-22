'use client';

// ── Chat data cards (Phase 1: read cards) ────────────────────────────────────
//
// Renders typed cards from the agent turn's STRUCTURED tool results (real
// dispatched data — not model-emitted JSON). Each card is human-readable: it
// shows titles, numbers, tiers, statuses, and the ORA/LEAD reference — never raw
// UUIDs or phone numbers. `dir="auto"` lets Arabic content right-align within a
// card (full RTL layout is a later phase).

import {
  CheckCircle2,
  Circle,
  ClipboardList,
  Users,
  BarChart3,
  Mail,
  CalendarClock,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

export interface ToolCardData {
  toolName: string;
  result: unknown;
}

// ── small shared bits ─────────────────────────────────────────────────────────

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-ora-sand/70 bg-ora-white" dir="auto">
      <div className="flex items-center gap-2 border-b border-ora-sand/50 bg-ora-cream-light/60 px-3 py-2">
        <span className="text-ora-gold">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-ora-charcoal-light">
          {title}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'open' | 'done' | 'hot' | 'warm' | 'nurture' | 'neutral'; children: ReactNode }) {
  const cls: Record<string, string> = {
    open: 'bg-amber-50 text-amber-700',
    done: 'bg-emerald-50 text-emerald-700',
    hot: 'bg-red-50 text-red-700',
    warm: 'bg-orange-50 text-orange-700',
    nurture: 'bg-sky-50 text-sky-700',
    neutral: 'bg-ora-sand/40 text-ora-charcoal-light',
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${cls[tone]}`}>
      {children}
    </span>
  );
}

const KIND_LABEL: Record<string, string> = {
  task: 'Task',
  lead_followup: 'Lead follow-up',
  appointment: 'Appointment',
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

// ── per-tool cards ──────────────────────────────────────────────────────────

function StackList({ result }: { result: unknown }) {
  const items = arr(obj(result).items);
  if (items.length === 0) {
    return (
      <Card icon={<ClipboardList className="h-4 w-4 stroke-[1.5]" />} title="Your stack">
        <p className="text-sm text-ora-charcoal-light">Nothing on your stack right now.</p>
      </Card>
    );
  }
  return (
    <Card icon={<ClipboardList className="h-4 w-4 stroke-[1.5]" />} title={`Your stack · ${items.length}`}>
      <ul className="space-y-2">
        {items.map((raw, i) => {
          const it = obj(raw);
          const done = str(it.status) === 'done';
          const due = str(it.dueAt);
          return (
            <li key={str(it.id) || i} className="flex items-start gap-2">
              {done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5] text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5] text-ora-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${done ? 'text-ora-muted line-through' : 'text-ora-charcoal'}`}>
                  {str(it.title) || 'Untitled'}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{KIND_LABEL[str(it.kind)] ?? 'Item'}</Badge>
                  <Badge tone={done ? 'done' : 'open'}>{done ? 'Done' : 'Open'}</Badge>
                  {due && (
                    <span className="inline-flex items-center gap-1 text-[0.7rem] text-ora-muted">
                      <CalendarClock className="h-3 w-3" />
                      {new Date(due).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TaskAdded({ result }: { result: unknown }) {
  const r = obj(result);
  const ref = str(r.ticketNumber).replace(/^ORA-/, 'LEAD-');
  return (
    <Card icon={<CheckCircle2 className="h-4 w-4 stroke-[1.5]" />} title="Task added">
      <p className="text-sm text-ora-charcoal">
        Added to your stack{ref ? <> · <span className="font-medium">{ref}</span></> : null}.
      </p>
    </Card>
  );
}

function TaskCompleted() {
  return (
    <Card icon={<CheckCircle2 className="h-4 w-4 stroke-[1.5]" />} title="Task completed">
      <p className="text-sm text-ora-charcoal">Marked done. ✅</p>
    </Card>
  );
}

function LeadsList({ result }: { result: unknown }) {
  const leads = arr(obj(result).leads);
  if (leads.length === 0) {
    return (
      <Card icon={<Users className="h-4 w-4 stroke-[1.5]" />} title="Leads">
        <p className="text-sm text-ora-charcoal-light">No matching leads.</p>
      </Card>
    );
  }
  const tone = (t: string) =>
    t === 'HOT' ? 'hot' : t === 'WARM' ? 'warm' : t === 'NURTURE' ? 'nurture' : 'neutral';
  return (
    <Card icon={<Users className="h-4 w-4 stroke-[1.5]" />} title={`Leads · ${leads.length}`}>
      <ul className="space-y-2">
        {leads.map((raw, i) => {
          const l = obj(raw);
          const tier = str(l.tier).toUpperCase();
          return (
            <li key={str(l.partyId) || i} className="flex items-center justify-between gap-2 border-b border-ora-sand/40 pb-2 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm text-ora-charcoal">
                  {str(l.stage) || 'Lead'}
                </p>
                {l.lastInteractionAt ? (
                  <p className="text-[0.7rem] text-ora-muted">
                    Last contact {new Date(str(l.lastInteractionAt)).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
              {tier && <Badge tone={tone(tier) as 'hot' | 'warm' | 'nurture' | 'neutral'}>{tier}</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PipelineSummary({ result }: { result: unknown }) {
  const r = obj(result);
  const metrics = obj(r.metrics);
  const entries = Object.entries(metrics).filter(
    ([, v]) => typeof v === 'number' || typeof v === 'string',
  );
  if (entries.length === 0) {
    return (
      <Card icon={<BarChart3 className="h-4 w-4 stroke-[1.5]" />} title="Pipeline">
        <p className="text-sm text-ora-charcoal-light">No figures available.</p>
      </Card>
    );
  }
  const label = (k: string) => k.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Card icon={<BarChart3 className="h-4 w-4 stroke-[1.5]" />} title="Pipeline summary">
      <dl className="grid grid-cols-2 gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-ora-cream-light/60 px-3 py-2">
            <dt className="text-[0.7rem] uppercase tracking-wide text-ora-muted">{label(k)}</dt>
            <dd className="text-lg font-semibold text-ora-charcoal">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ReportQueued({ result }: { result: unknown }) {
  const r = obj(result);
  const period = str(r.periodDate);
  return (
    <Card icon={<Mail className="h-4 w-4 stroke-[1.5]" />} title="Report queued">
      <p className="text-sm text-ora-charcoal">
        Your report is being compiled and emailed{period ? <> for <span className="font-medium">{period}</span></> : null}.
      </p>
    </Card>
  );
}

// The confirm-before-commit review card. The Twin proposes a high-impact write
// (propose_action) WITHOUT committing it; the user reviews the plain-language
// summary here and clicks Confirm — which commits it exactly once via the
// single-use token (POST /api/home/confirm) — or Cancel, which changes nothing.
// A low-stakes propose (staged=false) renders nothing: the Twin did it directly.
function ConfirmAction({ result }: { result: unknown }) {
  const r = obj(result);
  const staged = r.staged === true && r.requiresConfirmation === true;
  const token = str(r.token);
  const summary = str(r.summary);
  const affected = typeof r.affectedCount === 'number' ? (r.affectedCount as number) : undefined;
  const [status, setStatus] = useState<'idle' | 'committing' | 'done' | 'error' | 'cancelled'>('idle');
  const [note, setNote] = useState('');

  if (!staged || !token) return null;

  async function commit() {
    setStatus('committing');
    try {
      const res = await fetch('/api/home/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });
      const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
      const data = obj(json?.data);
      if (res.ok && data.executed === true) {
        setStatus('done');
        setNote(str(data.message) || 'Done.');
      } else {
        setStatus('error');
        setNote(str(data.message) || "That didn't go through.");
      }
    } catch {
      setStatus('error');
      setNote("Couldn't reach the server. Please try again.");
    }
  }

  return (
    <Card icon={<ShieldCheck className="h-4 w-4 stroke-[1.5]" />} title="Confirm before it commits">
      <p className="text-sm text-ora-charcoal">{summary || 'Confirm this change?'}</p>
      {affected ? (
        <p className="mt-0.5 text-[0.7rem] text-ora-muted">
          {affected} record{affected === 1 ? '' : 's'} affected
        </p>
      ) : null}

      {status === 'done' ? (
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
          <Check className="h-4 w-4" /> {note}
        </p>
      ) : status === 'cancelled' ? (
        <p className="mt-2 text-sm text-ora-muted">Cancelled — nothing was changed.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={commit}
            disabled={status === 'committing'}
            className="inline-flex items-center gap-1 rounded-lg bg-ora-gold px-3 py-1.5 text-sm font-medium text-ora-white transition hover:bg-ora-gold/90 disabled:opacity-60"
          >
            {status === 'committing' ? 'Committing…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setStatus('cancelled')}
            disabled={status === 'committing'}
            className="inline-flex items-center rounded-lg border border-ora-sand px-3 py-1.5 text-sm text-ora-charcoal-light transition hover:bg-ora-cream-light disabled:opacity-60"
          >
            Cancel
          </button>
          {status === 'error' ? (
            <span className="text-[0.7rem] text-red-600">{note}</span>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// ── dispatcher ────────────────────────────────────────────────────────────────

function renderCard(tr: ToolCardData, key: string): ReactNode {
  switch (tr.toolName) {
    case 'list_stack':
      return <StackList key={key} result={tr.result} />;
    case 'add_stack_item':
      return <TaskAdded key={key} result={tr.result} />;
    case 'complete_stack_item':
      return <TaskCompleted key={key} />;
    case 'query_leads':
      return <LeadsList key={key} result={tr.result} />;
    case 'get_pipeline_summary':
      return <PipelineSummary key={key} result={tr.result} />;
    case 'queue_combined_report':
    case 'queue_report_email':
      return <ReportQueued key={key} result={tr.result} />;
    case 'propose_action':
      return <ConfirmAction key={key} result={tr.result} />;
    default:
      return null;
  }
}

export function ToolResultCards({ toolResults }: { toolResults?: ToolCardData[] }) {
  if (!toolResults || toolResults.length === 0) return null;
  const cards = toolResults.map((tr, i) => renderCard(tr, `${tr.toolName}-${i}`)).filter(Boolean);
  if (cards.length === 0) return null;
  return <div className="mt-2 space-y-2">{cards}</div>;
}

export default ToolResultCards;
