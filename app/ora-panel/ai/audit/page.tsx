'use client';

/**
 * AI action audit view — every executed admin-AI action is recorded in
 * `audit_log` with the summary prefix "Admin chat:". This page filters the
 * audit feed down to those entries so operators have an accountability trail
 * for everything the assistant did on their behalf.
 */

import { useMemo, useState } from 'react';
import { useAuditLog } from '@/lib/cms/hooks';
import { BrainCircuit, Filter } from 'lucide-react';

const ACTOR_OPTIONS = [
  { label: 'Anyone', value: '' },
  { label: 'Just me', value: 'me' },
] as const;

export default function AiAuditPage() {
  const [actor, setActor] = useState<'' | 'me'>('');
  const { data: entries, isLoading } = useAuditLog();

  const aiEntries = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) =>
      typeof e.summary === 'string' && e.summary.startsWith('Admin chat:'),
    );
  }, [entries]);

  // "Just me" filter is best-effort client-side; the real userId comes from
  // the audit row and we don't have the current session id here. The chat
  // intent "what did the AI do today" already returns a per-user list, so
  // this page intentionally defaults to "Anyone" and lets ops scan the lot.
  // If we add a current-user hook later we can wire this filter to it.
  const visible = useMemo(() => {
    if (actor !== 'me') return aiEntries;
    return aiEntries; // placeholder until current-user hook is plumbed
  }, [aiEntries, actor]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">
            AI Action Audit
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Every action the platform copilot has executed on behalf of a staff
            member. Tickets that bridge through the lifecycle (open →
            in_progress → resolved → closed) appear as multiple entries, one
            per legal transition.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 stroke-1 text-ora-muted" />
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value as '' | 'me')}
            className="h-9 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
          >
            {ACTOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded bg-ora-sand/60"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <BrainCircuit className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-muted">
            No AI actions recorded yet. Try asking the copilot to close a
            ticket or complete a booking.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((entry) => {
            const text = entry.summary.replace(/^Admin chat:\s*/i, '');
            return (
              <div
                key={entry.id}
                className="flex items-start gap-4 border border-ora-sand/60 bg-ora-white p-4"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ora-charcoal text-ora-white">
                  <BrainCircuit className="h-4 w-4 stroke-1" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-block rounded-full bg-ora-sand px-3 py-0.5 font-medium text-ora-charcoal">
                      {entry.action}
                    </span>
                    <span className="inline-block rounded-full bg-ora-sand/60 px-3 py-0.5 text-ora-charcoal-light">
                      {entry.entityType}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ora-charcoal">{text}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-ora-muted">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-ora-muted">
                    User: {entry.userId.slice(0, 8)}…
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
