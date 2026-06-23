'use client';

// ── Prospecting Sequences — Index page (task 8.2) ────────────────────────────
//
// Lists the rep's named background prospecting campaigns (Sequences) with their
// lifecycle status, enrolled-prospect count, pending-review count, and last
// refresh. A "New sequence" affordance opens a create form; clicking a row opens
// its detail / builder page. Mirrors the Prospecting Workspace surface's
// auth/RBAC gating and the audited `/api/prospecting/*` bridge — the browser
// never calls a provider or reads personal data directly.
//
// App-Router conventions (per node_modules/next/dist/docs/01-app, read for this
// `[next-docs]` task): this is a client `page.tsx` leaf segment under
// `app/ora-panel/prospecting/sequences/`; navigation uses `next/navigation`
// `useRouter`; the dynamic detail route lives at `[id]/page.tsx`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Telescope,
  Plus,
  ChevronRight,
  Clock,
  Users,
  Inbox,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { PageHeaderSkeleton } from '@/components/ui/panel-skeletons';
import type { SessionData } from '@/lib/types/session';
import { OwnSubjectPicker } from '../components';
import type { OwnCatalog, SequenceRow, SequenceStatus } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

function hasProspectingAccess(session: SessionData): boolean {
  const roles = session.roles ?? [];
  const permissions = session.permissions ?? [];
  return (
    roles.includes('super_admin') ||
    permissions.includes('*:*') ||
    permissions.includes('leads:read') ||
    permissions.includes('leads:*')
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON body when one is actually sent: the API rejects a
  // bodyless request that still carries `Content-Type: application/json` with a
  // 400 "Bad Request" (its JSON parser fails on the empty body). This bit the
  // bodyless lifecycle POSTs (publish/pause/resume/archive).
  const res = await fetch(`${API_BASE_URL}/api/prospecting${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  }
  return json as T;
}

const STATUS_STYLES: Record<SequenceStatus, { label: string; cls: string; dot: string }> = {
  draft: { label: 'Draft', cls: 'bg-ora-cream-dark text-ora-charcoal-light ring-ora-sand/60', dot: 'bg-ora-muted' },
  live: { label: 'Live', cls: 'bg-green-100 text-green-700 ring-green-300', dot: 'bg-green-600' },
  paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-700 ring-amber-300', dot: 'bg-amber-500' },
  archived: { label: 'Archived', cls: 'bg-ora-cream-dark text-ora-muted ring-ora-sand/50', dot: 'bg-ora-muted' },
};

/** A lifecycle status pill. */
export function SequenceStatusBadge({ status }: { status: SequenceStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Format a last-refresh timestamp, or an em dash when never refreshed. */
function lastRefreshLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SequencesIndexPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  // ── Auth gate (mirrors the Prospecting Workspace surface) ───────────────────
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
        if (!hasProspectingAccess(data)) {
          setUnauthorized(true);
          setAuthLoading(false);
          return;
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        const next = encodeURIComponent('/ora-panel/prospecting/sequences');
        router.replace(`/ora-panel/login?next=${next}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const ready = !authLoading && !unauthorized;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ sequences: SequenceRow[] }>('/sequences');
      setSequences(data.sequences);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sequences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  const handleCreated = useCallback(
    (id: string) => {
      setShowCreate(false);
      router.push(`/ora-panel/prospecting/sequences/${id}`);
    },
    [router]
  );

  if (authLoading) {
    return (
      <div className="space-y-4 p-6">
        <PageHeaderSkeleton />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-8 w-8 text-ora-muted" />
        <p className="text-sm text-ora-charcoal-light">
          You don&apos;t have access to prospecting sequences.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Telescope className="h-6 w-6 text-ora-gold-dark" />
          <div>
            <h1 className="text-lg font-semibold text-ora-charcoal">Prospecting Sequences</h1>
            <p className="text-xs text-ora-charcoal-light">
              Named background campaigns that keep finding new prospects on a cadence.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ora-gold-dark px-3 py-2 text-sm font-semibold text-white transition hover:bg-ora-gold"
        >
          <Plus className="h-4 w-4" />
          New sequence
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-ora-charcoal-light">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sequences…
        </div>
      ) : sequences.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-ora-sand/70 bg-ora-white py-12 text-center">
          <Telescope className="h-8 w-8 text-ora-muted" />
          <p className="text-sm text-ora-charcoal-light">
            No sequences yet. Create one to start prospecting in the background.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ora-sand/70 px-3 py-1.5 text-sm font-medium text-ora-charcoal hover:bg-ora-cream-dark"
          >
            <Plus className="h-4 w-4" /> New sequence
          </button>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="sequence-list">
          {sequences.map((seq) => (
            <li key={seq.id}>
              <Link
                href={`/ora-panel/prospecting/sequences/${seq.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-ora-sand/60 bg-ora-white px-4 py-3 transition hover:border-ora-gold/60 hover:bg-ora-cream-dark/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ora-charcoal">
                      {seq.name}
                    </span>
                    <SequenceStatusBadge status={seq.status} />
                  </div>
                  {seq.description && (
                    <p className="mt-0.5 truncate text-xs text-ora-charcoal-light">
                      {seq.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-ora-charcoal-light">
                  <span className="inline-flex items-center gap-1" title="Enrolled prospects">
                    <Users className="h-3.5 w-3.5" />
                    {seq.enrolledProspects ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Awaiting review">
                    <Inbox className="h-3.5 w-3.5" />
                    {seq.pendingProspects ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Last refresh">
                    <Clock className="h-3.5 w-3.5" />
                    {lastRefreshLabel(seq.lastRefreshedAt)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-ora-muted" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateSequenceModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

const CADENCE_OPTIONS = [
  { label: 'Hourly', minutes: 60 },
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Daily', minutes: 1440 },
  { label: 'Weekly', minutes: 10080 },
];

/** A modal create form: name + subject (own catalog or ICP) + cadence + cap. */
function CreateSequenceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [catalog, setCatalog] = useState<OwnCatalog>({
    communities: [],
    projects: [],
    clusters: [],
  });
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(1440);
  const [enrollmentCap, setEnrollmentCap] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load the picker one level at a time: communities seed on mount, then
  // projects load when a community is chosen, clusters when a project is chosen.
  // (A one-shot `/own-catalog` with no params only ever returns communities, so
  // the Project dropdown stayed empty / "Select project…" — this refetches.)
  const loadCatalog = useCallback(
    async (community?: string | null, project?: string | null) => {
      const qs = new URLSearchParams();
      if (community) qs.set('communityId', community);
      if (project) qs.set('projectId', project);
      try {
        const data = await api<OwnCatalog>(
          `/own-catalog${qs.toString() ? `?${qs.toString()}` : ''}`
        );
        setCatalog(data);
      } catch {
        /* best-effort — a rep can still create an ICP-less own-project subject */
      }
    },
    []
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const onSelectCommunity = useCallback(
    (cid: string | null) => {
      setCommunityId(cid);
      setProjectId(null);
      setClusterId(null);
      void loadCatalog(cid, null);
    },
    [loadCatalog]
  );

  const onSelectProject = useCallback(
    (pid: string | null) => {
      setProjectId(pid);
      setClusterId(null);
      void loadCatalog(communityId, pid);
    },
    [loadCatalog, communityId]
  );

  const subject = useMemo(() => {
    if (clusterId) return { kind: 'cluster' as const, clusterId, projectId: projectId ?? undefined, communityId: communityId ?? undefined };
    if (projectId) return { kind: 'cluster' as const, projectId, communityId: communityId ?? undefined };
    return null;
  }, [clusterId, projectId, communityId]);

  const canSubmit = name.trim().length > 0 && subject !== null && !busy;

  const submit = useCallback(async () => {
    if (!subject) {
      setError('Pick a project and cluster for this sequence.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ sequence: { id: string } }>('/sequences', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          subject,
          refreshIntervalMinutes,
          enrollmentCap,
        }),
      });
      onCreated(data.sequence.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create sequence');
      setBusy(false);
    }
  }, [subject, name, description, refreshIntervalMinutes, enrollmentCap, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-ora-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ora-charcoal">New sequence</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ora-muted hover:bg-ora-cream-dark"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-ora-charcoal-light">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Palm villas — UHNW buyers"
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ora-charcoal-light">Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none"
          />
        </label>

        <div>
          <span className="text-xs font-medium text-ora-charcoal-light">Subject</span>
          <div className="mt-1">
            <OwnSubjectPicker
              catalog={catalog}
              selectedCommunityId={communityId}
              selectedProjectId={projectId}
              selectedClusterId={clusterId}
              busy={busy}
              onSelectCommunity={onSelectCommunity}
              onSelectProject={onSelectProject}
              onSelectCluster={setClusterId}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-ora-charcoal-light">Refresh cadence</span>
            <select
              value={refreshIntervalMinutes}
              onChange={(e) => setRefreshIntervalMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none"
            >
              {CADENCE_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ora-charcoal-light">Enrollment cap / period</span>
            <input
              type="number"
              min={1}
              value={enrollmentCap}
              onChange={(e) => setEnrollmentCap(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none"
            />
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-ora-sand/70 px-3 py-2 text-sm font-medium text-ora-charcoal hover:bg-ora-cream-dark"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ora-gold-dark px-3 py-2 text-sm font-semibold text-white transition hover:bg-ora-gold disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create draft
          </button>
        </div>
      </div>
    </div>
  );
}
