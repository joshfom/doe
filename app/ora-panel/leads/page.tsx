'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Radio, RadioTower, Inbox } from 'lucide-react';
import { PageHeaderSkeleton, TableSkeleton } from '@/components/ui/panel-skeletons';
import type { SessionData } from '@/lib/types/session';
import {
  useLeadsRealtime,
  type LeadStatus,
  type LeadsStreamStatus,
  type InboundLeadRow,
} from './useLeadsRealtime';
import { LeadDetailSheet } from './LeadDetailSheet';

// ── Lead Engine dashboard ─────────────────────────────────────────────────────
// A live, read-only list of inbound leads from every source (web_form / email /
// whatsapp / meta_lead_ads / portal), backed by `useLeadsRealtime` (TanStack
// Query + the `leads:read`-gated SSE stream). Mirrors the Voice Console's auth
// pattern: it resolves the Better Auth session and gates on `leads:read` before
// opening the stream. The list never shows a raw phone — only intake metadata.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

const STATUS_FILTERS: Array<{ value: LeadStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'received', label: 'Received' },
  { value: 'parsed', label: 'Parsed' },
  { value: 'queued', label: 'Queued' },
  { value: 'failed', label: 'Failed' },
];

function hasLeadsAccess(session: SessionData): boolean {
  const roles = session.roles ?? [];
  const permissions = session.permissions ?? [];
  return (
    roles.includes('super_admin') ||
    permissions.includes('*:*') ||
    permissions.includes('leads:read') ||
    permissions.includes('leads:*')
  );
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  received: 'bg-blue-50 text-blue-700 ring-blue-200',
  parsed: 'bg-amber-50 text-amber-700 ring-amber-200',
  queued: 'bg-violet-50 text-violet-700 ring-violet-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
};

export default function LeadsPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const [selectedLead, setSelectedLead] = useState<InboundLeadRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not authenticated');
        const json = await res.json();
        if (!json?.data?.userId) throw new Error('Not authenticated');
        return json.data as SessionData;
      })
      .then((data) => {
        if (cancelled) return;
        if (!hasLeadsAccess(data)) {
          setUnauthorized(true);
          setAuthLoading(false);
          return;
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        const next = encodeURIComponent('/ora-panel/leads');
        router.replace(`/ora-panel/login?next=${next}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const ready = !authLoading && !unauthorized;
  const { leads, isLoading, error, streamStatus } = useLeadsRealtime({
    enabled: ready,
    status: filter === 'all' ? undefined : filter,
    limit: 100,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads]);

  if (authLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        <PageHeaderSkeleton />
        <TableSkeleton columns={5} rows={8} className="rounded-xl" />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to view the Lead Engine.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Lead Engine</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ora-charcoal-light">
            <ConnectionBadge status={streamStatus} />
            Live inbound leads across every source — including form submissions and AI chat
            <Link
              href="/ora-panel/submissions"
              className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-ora-muted underline-offset-2 hover:underline"
            >
              <Inbox className="h-3.5 w-3.5" />
              Legacy submissions
            </Link>
          </p>
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                filter === value
                  ? 'bg-ora-charcoal text-white ring-ora-charcoal'
                  : 'bg-white text-ora-charcoal-light ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
              {counts[value] != null && (
                <span className="ml-1.5 opacity-70">{counts[value]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
          {error.message}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
        {isLoading ? (
          <TableSkeleton columns={5} rows={8} className="border-0" />
        ) : leads.length === 0 ? (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
            <Inbox className="h-8 w-8 text-ora-muted" />
            <div>
              <p className="text-sm font-medium text-ora-charcoal">No leads yet</p>
              <p className="mt-1 text-xs text-ora-muted">
                Simulate one via POST /api/leads/simulate (see the Postman harness).
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-ora-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="cursor-pointer hover:bg-gray-50/60 transition-colors"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ora-charcoal">
                        {lead.name || '—'}
                      </div>
                      {lead.email && (
                        <div className="text-xs text-ora-muted">{lead.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-ora-charcoal-light">
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          STATUS_STYLES[lead.status] ??
                          'bg-gray-50 text-gray-600 ring-gray-200'
                        }`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ora-charcoal-light">
                      {lead.attribution?.utm_campaign ??
                        lead.attribution?.utm_source ??
                        '—'}
                    </td>
                    <td className="px-4 py-3 text-ora-muted">
                      {formatWhen(lead.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LeadDetailSheet
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
      />
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ConnectionBadge({ status }: { status: LeadsStreamStatus }) {
  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1 text-green-600">
        <RadioTower className="h-3.5 w-3.5" /> Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ora-muted">
      <Radio className="h-3.5 w-3.5" />
      {status === 'connecting' ? 'Connecting…' : 'Offline'}
    </span>
  );
}
