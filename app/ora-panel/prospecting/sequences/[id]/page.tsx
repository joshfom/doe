'use client';

// ── Prospecting Sequences — Detail / Builder page (task 8.3) ─────────────────
//
// One Sequence's full surface: Configuration (the builder — subject + name +
// description + cadence + enrollment cap + ICP refinements), Enrolled Prospects,
// the Review Inbox (reusing `ReviewInboxPanel`), and the Activity log (reusing
// `BatchActivityLog`), plus the lifecycle controls (Publish / Pause / Resume /
// Archive) shown per the transitions the state machine allows for the current
// status. Every effect goes through the audited `/api/prospecting/*` bridge.
//
// App-Router conventions (per node_modules/next/dist/docs/01-app, read for this
// `[next-docs]` task): this is the client `page.tsx` for the dynamic `[id]`
// segment under `app/ora-panel/prospecting/sequences/`; the route param is read
// with `useParams` from `next/navigation`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Loader2,
  ShieldAlert,
  Play,
  Pause,
  RotateCw,
  Archive,
  Save,
} from 'lucide-react';
import { PageHeaderSkeleton } from '@/components/ui/panel-skeletons';
import type { SessionData } from '@/lib/types/session';
import {
  OwnSubjectPicker,
  ReviewInboxPanel,
  BatchActivityLog,
} from '../../components';
import { SequenceStatusBadge } from '../page';
import type {
  OwnCatalog,
  SequenceDetail,
  SequenceLifecycleAction,
  SequenceStatus,
  QueueItemRow,
  EnrolledProspectRow,
} from '../../types';

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

const CADENCE_OPTIONS = [
  { label: 'Hourly', minutes: 60 },
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Daily', minutes: 1440 },
  { label: 'Weekly', minutes: 10080 },
];

/**
 * The lifecycle actions the state machine permits for a status (mirrors
 * `applyTransition`): a `draft` can publish or archive; a `live` can pause or
 * archive; a `paused` can resume or archive; an `archived` is terminal.
 */
export function allowedActions(status: SequenceStatus): SequenceLifecycleAction[] {
  switch (status) {
    case 'draft':
      return ['publish', 'archive'];
    case 'live':
      return ['pause', 'archive'];
    case 'paused':
      return ['resume', 'archive'];
    case 'archived':
    default:
      return [];
  }
}

const ACTION_META: Record<
  SequenceLifecycleAction,
  { label: string; Icon: typeof Play; cls: string }
> = {
  publish: { label: 'Publish', Icon: Play, cls: 'bg-green-600 text-white hover:bg-green-700' },
  pause: { label: 'Pause', Icon: Pause, cls: 'bg-amber-500 text-white hover:bg-amber-600' },
  resume: { label: 'Resume', Icon: RotateCw, cls: 'bg-green-600 text-white hover:bg-green-700' },
  archive: {
    label: 'Archive',
    Icon: Archive,
    cls: 'border border-ora-sand/70 text-ora-charcoal hover:bg-ora-cream-dark',
  },
};

export default function SequenceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SequenceDetail | null>(null);
  const [actionBusy, setActionBusy] = useState<SequenceLifecycleAction | null>(null);

  // ── Auth gate ───────────────────────────────────────────────────────────────
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
        const next = encodeURIComponent(`/ora-panel/prospecting/sequences/${id}`);
        router.replace(`/ora-panel/login?next=${next}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router, id]);

  const ready = !authLoading && !unauthorized;

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api<SequenceDetail>(`/sequences/${id}`);
      setDetail(data);
      setNotFound(false);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load sequence';
      if (/not found/i.test(msg)) setNotFound(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  const runLifecycle = useCallback(
    async (action: SequenceLifecycleAction) => {
      setActionBusy(action);
      setError(null);
      try {
        await api(`/sequences/${id}/${action}`, { method: 'POST' });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : `Failed to ${action} sequence`);
      } finally {
        setActionBusy(null);
      }
    },
    [id, refresh]
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
          You don&apos;t have access to this sequence.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-ora-charcoal-light">This sequence was not found.</p>
        <Link
          href="/ora-panel/prospecting/sequences"
          className="text-sm font-medium text-ora-gold-dark hover:underline"
        >
          Back to sequences
        </Link>
      </div>
    );
  }

  if (loading || !detail) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-ora-charcoal-light">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading sequence…
      </div>
    );
  }

  const seq = detail.sequence;
  const actions = allowedActions(seq.status);

  return (
    <div className="space-y-5 p-6">
      <div>
        <Link
          href="/ora-panel/prospecting/sequences"
          className="inline-flex items-center gap-1 text-xs font-medium text-ora-charcoal-light hover:text-ora-charcoal"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All sequences
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-semibold text-ora-charcoal">{seq.name}</h1>
          <SequenceStatusBadge status={seq.status} />
        </div>
        <div className="flex items-center gap-2" data-testid="lifecycle-controls">
          {actions.map((action) => {
            const meta = ACTION_META[action];
            const Icon = meta.Icon;
            return (
              <button
                key={action}
                type="button"
                disabled={actionBusy !== null}
                onClick={() => runLifecycle(action)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${meta.cls}`}
              >
                {actionBusy === action ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {meta.label}
              </button>
            );
          })}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <ConfigSection detail={detail} onSaved={refresh} />

      <EnrolledProspectsSection enrolled={detail.enrolledProspects} count={detail.enrolledCount} />

      <section className="rounded-xl border border-ora-sand/60 bg-ora-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ora-charcoal">Review inbox</h2>
        <SequenceReviewInbox items={detail.queueItems} onChanged={refresh} />
      </section>

      <BatchActivityLog
        runId={null}
        entries={detail.activity}
        busy={false}
        error={null}
        loaded
        onView={() => void refresh()}
      />
    </div>
  );
}

/** The editable Configuration builder (PATCH /sequences/:id). */
function ConfigSection({
  detail,
  onSaved,
}: {
  detail: SequenceDetail;
  onSaved: () => Promise<void> | void;
}) {
  const seq = detail.sequence;
  const [name, setName] = useState(seq.name);
  const [description, setDescription] = useState(seq.description ?? '');
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(
    seq.refreshIntervalMinutes ?? 1440
  );
  const [enrollmentCap, setEnrollmentCap] = useState<number>(seq.enrollmentCap ?? 200);
  const [targetCount, setTargetCount] = useState<number>(seq.targetCount);

  const [catalog, setCatalog] = useState<OwnCatalog>({
    communities: [],
    projects: [],
    clusters: [],
  });
  const [communityId, setCommunityId] = useState<string | null>(
    seq.subject.communityId ?? null
  );
  const [projectId, setProjectId] = useState<string | null>(
    seq.subject.projectId ?? null
  );
  const [clusterId, setClusterId] = useState<string | null>(seq.subject.clusterId ?? null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Lazy-load the picker one level at a time (communities → projects →
  // clusters). Seed with the sequence's existing community/project so the
  // current subject's projects + clusters are populated on open; a one-shot
  // `/own-catalog` with no params only returns communities, leaving the Project
  // dropdown stuck on "Select project…".
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
        /* best-effort — the picker is optional context for the edit */
      }
    },
    []
  );

  useEffect(() => {
    void loadCatalog(seq.subject.communityId ?? null, seq.subject.projectId ?? null);
  }, [loadCatalog, seq.subject.communityId, seq.subject.projectId]);

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
    if (clusterId)
      return {
        kind: 'cluster' as const,
        clusterId,
        projectId: projectId ?? undefined,
        communityId: communityId ?? undefined,
      };
    if (projectId)
      return { kind: 'cluster' as const, projectId, communityId: communityId ?? undefined };
    return null;
  }, [clusterId, projectId, communityId]);

  // The Sequence already had a resolvable subject; an edit must keep one.
  const editable = seq.status !== 'archived';

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        refreshIntervalMinutes,
        enrollmentCap,
        targetCount,
      };
      if (subject) body.subject = subject;
      await api(`/sequences/${seq.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save configuration');
    } finally {
      setBusy(false);
    }
  }, [name, description, refreshIntervalMinutes, enrollmentCap, targetCount, subject, seq.id, onSaved]);

  return (
    <section className="rounded-xl border border-ora-sand/60 bg-ora-white p-4" data-testid="config-section">
      <h2 className="mb-3 text-sm font-semibold text-ora-charcoal">Configuration</h2>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ora-charcoal-light">Name</span>
          <input
            type="text"
            value={name}
            disabled={!editable}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ora-charcoal-light">Description</span>
          <input
            type="text"
            value={description}
            disabled={!editable}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none disabled:opacity-60"
          />
        </label>
      </div>

      <div className="mt-3">
        <span className="text-xs font-medium text-ora-charcoal-light">Subject</span>
        <div className="mt-1">
          <OwnSubjectPicker
            catalog={catalog}
            selectedCommunityId={communityId}
            selectedProjectId={projectId}
            selectedClusterId={clusterId}
            busy={busy || !editable}
            onSelectCommunity={onSelectCommunity}
            onSelectProject={onSelectProject}
            onSelectCluster={setClusterId}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-ora-charcoal-light">Refresh cadence</span>
          <select
            value={refreshIntervalMinutes}
            disabled={!editable}
            onChange={(e) => setRefreshIntervalMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none disabled:opacity-60"
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
            disabled={!editable}
            onChange={(e) => setEnrollmentCap(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ora-charcoal-light">Prospects per refresh</span>
          <input
            type="number"
            min={1}
            max={500}
            value={targetCount}
            disabled={!editable}
            onChange={(e) => setTargetCount(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-ora-sand/70 px-3 py-2 text-sm focus:border-ora-gold focus:outline-none disabled:opacity-60"
          />
        </label>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {saved && <p className="mt-3 text-xs font-medium text-green-700">Configuration saved.</p>}

      {editable && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={busy || name.trim().length === 0}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ora-gold-dark px-3 py-2 text-sm font-semibold text-white transition hover:bg-ora-gold disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      )}
    </section>
  );
}

/** A privacy-safe list of the Sequence's enrolled prospects (phoneHash only). */
function EnrolledProspectsSection({
  enrolled,
  count,
}: {
  enrolled: EnrolledProspectRow[];
  count: number;
}) {
  return (
    <section className="rounded-xl border border-ora-sand/60 bg-ora-white p-4" data-testid="enrolled-section">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ora-charcoal">
        <Users className="h-4 w-4 text-ora-gold-dark" />
        Enrolled prospects
        <span className="rounded-full bg-ora-cream-dark px-2 py-0.5 text-[11px] text-ora-charcoal-light">
          {count}
        </span>
      </h2>
      {enrolled.length === 0 ? (
        <p className="py-4 text-center text-xs text-ora-charcoal-light">
          No prospects enrolled yet. They appear here as refreshes find them.
        </p>
      ) : (
        <ul className="divide-y divide-ora-sand/40">
          {enrolled.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ora-charcoal">
                  {p.targetDisplayName ?? p.targetCompanyName ?? 'Prospect'}
                </p>
                <p className="truncate text-xs text-ora-charcoal-light">
                  {[p.targetTitle, p.targetCompanyName, p.targetCountry]
                    .filter(Boolean)
                    .join(' · ') || p.targetType || ''}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-ora-muted">{p.periodBucket}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Review Inbox for the Sequence, wired to the shared queue routes. */
function SequenceReviewInbox({
  items,
  onChanged,
}: {
  items: QueueItemRow[];
  onChanged: () => Promise<void> | void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))
    );
  }, [items]);

  const approve = useCallback(
    async (itemId: string) => {
      setBusyId(itemId);
      try {
        await api(`/queue/${itemId}/approve`, { method: 'POST' });
        await onChanged();
      } finally {
        setBusyId(null);
      }
    },
    [onChanged]
  );

  const reject = useCallback(
    async (itemId: string) => {
      setBusyId(itemId);
      try {
        await api(`/queue/${itemId}/reject`, { method: 'POST' });
        await onChanged();
      } finally {
        setBusyId(null);
      }
    },
    [onChanged]
  );

  const edit = useCallback(
    async (itemId: string, subject: string, body: string) => {
      setBusyId(itemId);
      try {
        await api(`/queue/${itemId}`, {
          method: 'PUT',
          body: JSON.stringify({ subject, body }),
        });
        await onChanged();
      } finally {
        setBusyId(null);
      }
    },
    [onChanged]
  );

  const bulkApprove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await api('/queue/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      setSelectedIds(new Set());
      await onChanged();
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, onChanged]);

  return (
    <ReviewInboxPanel
      items={items}
      selectedIds={selectedIds}
      busyId={busyId}
      bulkBusy={bulkBusy}
      onToggleSelect={toggleSelect}
      onToggleAll={toggleAll}
      onEdit={edit}
      onApprove={approve}
      onReject={reject}
      onBulkApprove={bulkApprove}
    />
  );
}
