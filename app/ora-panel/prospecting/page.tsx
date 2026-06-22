'use client';

// ── Prospecting Workspace surface (S7, task 8.4) ─────────────────────────────
//
// The outbound prospecting workspace: brief intake → comparables + editable
// Buyer_Hypothesis → ranked targets → research → editable outreach draft →
// approve/send. Classic-panel-consistent shell, mirroring the Lead Engine
// dashboard's auth/RBAC gating and SSE-driven freshness. Every effect goes
// through the AUDITED bridge (`/api/prospecting/*`) which dispatches the
// prospecting catalog tools server-side — the browser never calls a provider or
// reads personal data directly. The container-only Mastra agents/workflow are
// never imported here (the surface is serverless).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Telescope, CheckCircle2, AlertCircle, Info, X, Activity, Inbox } from 'lucide-react';
import { PageHeaderSkeleton } from '@/components/ui/panel-skeletons';
import { VoiceCallButton } from '@/components/voice/VoiceCallButton';
import type { SessionData } from '@/lib/types/session';
import {
  BriefIntake,
  OwnSubjectPicker,
  ComparablesPanel,
  HypothesisEditor,
  CandidatesPanel,
  TargetsPanel,
  OutreachPanel,
  SectionCard,
  ProgressStepper,
  ConnectionBadge,
  RunBatchControl,
  ReviewInboxPanel,
  BatchActivityLog,
} from './components';
import { useProspectingRealtime, type ProspectingEvent } from './useProspectingRealtime';
import type {
  BriefSpec,
  BuyerHypothesis,
  Comparable,
  ProspectingBrief,
  ProviderCandidate,
  TargetRow,
  OutreachDraftRow,
  Channel,
  Language,
  ComposedDraft,
  GroundingClaim,
  CrmCheckResult,
  OwnCatalog,
  ClusterNode,
  AreaTrendRow,
  BatchSubject,
  StartBatchResult,
  QueueItemRow,
  ApproveResult,
  BulkApproveResult,
  BatchActivityEntry,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Spoken-style prototype notice shown FIRST when the rep opens the voice agent,
 * framed like a customer-service "this call may be recorded" disclaimer: it sets
 * expectations (early prototype, may have flaws), states the purpose (a demo of
 * hands-free agentic prospecting), reassures on the guardrail (nothing sends
 * without approval), and invites the rep to interrupt.
 */
const VOICE_PROSPECTING_NOTICE =
  'Quick heads-up — this voice prospecting agent is an early prototype with a short training window, so it may have a few rough edges. ' +
  'It\u2019s a demo of hands-free, agentic prospecting: just tell me who you\u2019re looking for and which project, and I\u2019ll line everything up in your review inbox. ' +
  'Nothing is sent without your approval, and you can interrupt me anytime.';

/** Lightweight in-page toast (no new dependency) for action feedback. */
interface ToastState {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

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
  const res = await fetch(`${API_BASE_URL}/api/prospecting${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  }
  return json as T;
}

/**
 * Map a live `prospecting.batch.*` / `prospecting.queue.*` SSE event to a short,
 * human-readable activity line for the agent activity feed (task 10.4). The
 * payload carries internal ids / counts / reasons only — never a raw phone
 * (CC-Privacy) — so these lines are privacy-safe by construction. Returns
 * `null` for an event type that should not append a feed line.
 */
function describeBatchEvent(type: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const queued = typeof p.queued === 'number' ? p.queued : null;
  const reason = typeof p.reason === 'string' ? p.reason.replace(/_/g, ' ') : null;
  const targetCount = typeof p.targetCount === 'number' ? p.targetCount : null;
  switch (type) {
    case 'prospecting.batch.started':
      return targetCount != null
        ? `Batch run started — targeting ${targetCount} prospect${targetCount === 1 ? '' : 's'}.`
        : 'Batch run started.';
    case 'prospecting.batch.progress':
      return queued != null
        ? `Queued ${queued} so far…`
        : 'Queued another prospect…';
    case 'prospecting.batch.candidate.skipped':
      return reason ? `Skipped a candidate (${reason}).` : 'Skipped a candidate.';
    case 'prospecting.batch.completed':
      if (reason) return `Batch run complete — ${reason}.`;
      return queued != null
        ? `Batch run complete — ${queued} drafted for review.`
        : 'Batch run complete.';
    case 'prospecting.queue.item.queued':
      return 'Drafted outreach for a candidate — queued for your review.';
    case 'prospecting.queue.item.approved':
      return 'A queued draft was approved.';
    case 'prospecting.queue.item.rejected':
      return 'A queued draft was rejected — nothing was sent.';
    case 'prospecting.queue.item.sent':
      return 'Outreach sent from the review inbox ✓';
    default:
      return null;
  }
}

export default function ProspectingPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flow state.
  const [brief, setBrief] = useState<ProspectingBrief | null>(null);
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [areaTrend, setAreaTrend] = useState<AreaTrendRow[]>([]);
  const [unconfigured, setUnconfigured] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [hypothesis, setHypothesis] = useState<BuyerHypothesis | null>(null);
  const [candidates, setCandidates] = useState<ProviderCandidate[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetRow | null>(null);
  const [draft, setDraft] = useState<OutreachDraftRow | null>(null);
  const [approval, setApproval] = useState<{ token: string; expiresAt: string } | null>(null);

  // Own_Subject picker state (community → project → cluster).
  const [ownCatalog, setOwnCatalog] = useState<OwnCatalog>({
    communities: [],
    projects: [],
    clusters: [],
  });
  const [pickCommunityId, setPickCommunityId] = useState<string | null>(null);
  const [pickProjectId, setPickProjectId] = useState<string | null>(null);
  const [pickClusterId, setPickClusterId] = useState<string | null>(null);

  // Per-action busy flags.
  const [busyBrief, setBusyBrief] = useState(false);
  const [busySearch, setBusySearch] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [busyOutreach, setBusyOutreach] = useState(false);
  const [busyBatch, setBusyBatch] = useState(false);

  // ── Approval Queue / Review Inbox state (task 10.3) ─────────────────────────
  const [queueItems, setQueueItems] = useState<QueueItemRow[]>([]);
  const [queueSelected, setQueueSelected] = useState<Set<string>>(new Set());
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // ── Persisted Agent_Activity_Log fallback state (task 10.4) ─────────────────
  // The live SSE stream may not stay open under `next dev` (the documented
  // serverless caveat), so the rep can read the PERSISTED log for a run on
  // demand. We track the most-recently-started run id (returned by `runBatch`
  // via `StartBatchResult`) as the default subject of the "view activity log"
  // affordance.
  const [latestBatchRunId, setLatestBatchRunId] = useState<string | null>(null);
  const [batchLog, setBatchLog] = useState<BatchActivityEntry[]>([]);
  const [batchLogBusy, setBatchLogBusy] = useState(false);
  const [batchLogError, setBatchLogError] = useState<string | null>(null);
  const [batchLogRunId, setBatchLogRunId] = useState<string | null>(null);

  // Toasts — immediate, legible feedback for every action.
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const pushToast = useCallback((kind: ToastState['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Agent activity feed — a human-readable, live log of what the agent is doing.
  const [activity, setActivity] = useState<{ id: number; text: string; at: string }[]>([]);
  const logActivity = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setActivity((prev) => [{ id, text, at }, ...prev].slice(0, 30));
  }, []);

  // CRM pre-check for the selected target ("already in Salesforce?").
  const [crmCheck, setCrmCheck] = useState<CrmCheckResult | null>(null);
  const [crmChecking, setCrmChecking] = useState(false);

  // ── Auth gate (mirrors the Lead Engine dashboard) ──────────────────────────
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
        const next = encodeURIComponent('/ora-panel/prospecting');
        router.replace(`/ora-panel/login?next=${next}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const ready = !authLoading && !unauthorized;

  // ── Data refreshers ─────────────────────────────────────────────────────────
  const refreshTargets = useCallback(async (briefId: string) => {
    try {
      const data = await api<{ targets: TargetRow[] }>(`/targets?briefId=${briefId}`);
      setTargets(data.targets);
    } catch {
      // best-effort refresh
    }
  }, []);

  const refreshDrafts = useCallback(async (targetId: string) => {
    try {
      const data = await api<{ drafts: OutreachDraftRow[] }>(`/drafts?targetId=${targetId}`);
      setDraft(data.drafts[0] ?? null);
    } catch {
      // best-effort
    }
  }, []);

  // The Review Inbox: every PENDING, cold-eligible Queued_Item awaiting human
  // review across the rep's own Batch_Runs (Req 4.1). Best-effort — a transient
  // read failure leaves the last-known queue in place rather than clearing it.
  const refreshQueue = useCallback(async () => {
    try {
      const data = await api<{ count: number; queueItems: QueueItemRow[] }>('/queue');
      setQueueItems(data.queueItems);
      // Drop any selection that no longer maps to a pending item.
      setQueueSelected((prev) => {
        const live = new Set(data.queueItems.map((i) => i.id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (live.has(id)) next.add(id);
        });
        return next;
      });
    } catch {
      // best-effort refresh
    }
  }, []);

  // ── Live updates: refresh the affected slice as each step completes ─────────
  const onEvent = useCallback(
    (event: ProspectingEvent) => {
      if (brief) void refreshTargets(brief.id);
      if (selectedTarget) void refreshDrafts(selectedTarget.id);
      // The autonomous batch streams `prospecting.batch.*` / `prospecting.queue.*`
      // events as it works; refresh the Review Inbox so newly drafted items and
      // status changes (queued / approved / rejected / sent) appear live, AND
      // mirror each batch decision into the human-readable agent activity feed
      // (task 10.4). The event payload carries internal ids / counts / reasons
      // only (privacy-safe — never a raw phone), so the line is safe to render.
      if (
        event.type.startsWith('prospecting.batch.') ||
        event.type.startsWith('prospecting.queue.')
      ) {
        void refreshQueue();
        const line = describeBatchEvent(event.type, event.payload);
        if (line) logActivity(line);
      }
    },
    [brief, selectedTarget, refreshTargets, refreshDrafts, refreshQueue, logActivity]
  );
  const streamStatus = useProspectingRealtime(onEvent, ready);

  // Seed the Review Inbox once authorized (the SSE stream may not stay open
  // under `next dev`, so an explicit initial read guarantees the inbox loads).
  useEffect(() => {
    if (ready) void refreshQueue();
  }, [ready, refreshQueue]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  // ── Own-catalog picker: lazy-load each level from the read route ────────────
  const loadCatalog = useCallback(
    async (communityId?: string | null, projectId?: string | null) => {
      const qs = new URLSearchParams();
      if (communityId) qs.set('communityId', communityId);
      if (projectId) qs.set('projectId', projectId);
      try {
        const data = await api<OwnCatalog>(
          `/own-catalog${qs.toString() ? `?${qs.toString()}` : ''}`
        );
        setOwnCatalog(data);
      } catch {
        // best-effort — the free-form brief intake still works without the picker
      }
    },
    []
  );

  // Seed the picker's first level (communities) once authorized.
  useEffect(() => {
    if (ready) void loadCatalog();
  }, [ready, loadCatalog]);

  const onSelectCommunity = useCallback(
    (id: string | null) => {
      setPickCommunityId(id);
      setPickProjectId(null);
      setPickClusterId(null);
      void loadCatalog(id, null);
    },
    [loadCatalog]
  );

  const onSelectProject = useCallback(
    (id: string | null) => {
      setPickProjectId(id);
      setPickClusterId(null);
      void loadCatalog(pickCommunityId, id);
    },
    [loadCatalog, pickCommunityId]
  );

  // ── Brief submission (free-form spec OR resolved Own_Subject) ───────────────
  const submitBrief = useCallback(async (payload: Record<string, unknown>) => {
    setError(null);
    setBusyBrief(true);
    setCandidates([]);
    setTargets([]);
    setSelectedTarget(null);
    setDraft(null);
    logActivity('Agent: pulling comparable sales and the area price trend…');
    try {
      const data = await api<{
        brief: ProspectingBrief;
        comparables: Comparable[];
        unconfigured: boolean;
        hypothesis: BuyerHypothesis;
        areaTrend?: AreaTrendRow[];
        gaps?: string[];
      }>('/briefs', { method: 'POST', body: JSON.stringify(payload) });
      setBrief(data.brief);
      setComparables(data.comparables);
      setAreaTrend(data.areaTrend ?? []);
      setUnconfigured(data.unconfigured);
      setHypothesis(data.hypothesis);
      setGaps(data.gaps ?? []);
      logActivity(
        `Agent: found ${data.comparables.length} comparable project${data.comparables.length === 1 ? '' : 's'} and derived a ${data.hypothesis?.confidence ?? 'low'}-confidence buyer hypothesis.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create brief';
      setError(msg);
      pushToast('error', msg);
    } finally {
      setBusyBrief(false);
    }
  }, [logActivity, pushToast]);

  const createBrief = useCallback(
    (spec: BriefSpec) => submitBrief({ spec }),
    [submitBrief]
  );

  // Selecting a cluster drives the brief: the server resolves the Comparison_Spec
  // from the own catalog (Req 13.5) and any unfillable parameters return as gaps.
  const useCluster = useCallback(
    (cluster: ClusterNode) => {
      setPickClusterId(cluster.id);
      return submitBrief({
        communityId: pickCommunityId ?? undefined,
        projectId: cluster.projectId,
        clusterId: cluster.id,
      });
    },
    [submitBrief, pickCommunityId]
  );

  // ── Autonomous Batch_Run kick-off (task 10.2) ───────────────────────────────
  // Additive to the per-prospect flow: POST the subject + N to the bridge, which
  // validates and cap-prechecks, persists the run, and enqueues the durable job.
  // The `api()` helper throws with the route's `error` message on non-2xx, so a
  // 400 (invalid_subject / invalid_target_count) or 409 (cap_exhausted) surfaces
  // as an error toast here (Req 1.1, 1.4, 1.5).
  const runBatch = useCallback(
    async (subject: BatchSubject, targetCount: number) => {
      setBusyBatch(true);
      try {
        const res = await api<StartBatchResult>('/batches', {
          method: 'POST',
          body: JSON.stringify({ subject, targetCount }),
        });
        const shortId = res.batchRunId.slice(0, 8);
        // Track the most-recently-started run so the persisted-activity-log
        // fallback (task 10.4) has a default subject to read on demand.
        setLatestBatchRunId(res.batchRunId);
        pushToast('success', `Batch run started (${shortId}…) — the agent is working it`);
        logActivity(
          `Agent: autonomous batch run ${shortId}… started for ${targetCount} prospect${targetCount === 1 ? '' : 's'}.`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to start batch run';
        pushToast('error', msg);
      } finally {
        setBusyBatch(false);
      }
    },
    [pushToast, logActivity]
  );

  // ── Review Inbox actions (task 10.3) ────────────────────────────────────────
  const toggleQueueSelect = useCallback((id: string) => {
    setQueueSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleQueueAll = useCallback(() => {
    setQueueSelected((prev) => {
      const allSelected = queueItems.length > 0 && queueItems.every((i) => prev.has(i.id));
      return allSelected ? new Set<string>() : new Set(queueItems.map((i) => i.id));
    });
  }, [queueItems]);

  // Edit a draft: PUT /queue/:id with { subject, body } (Req 4.2). The route
  // retains the AI original on the first edit. Refresh to reflect the saved copy.
  const editQueueItem = useCallback(
    async (id: string, subject: string, body: string) => {
      setQueueBusyId(id);
      try {
        await api(`/queue/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ subject, body }),
        });
        pushToast('success', 'Draft edits saved');
        await refreshQueue();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Failed to save edits');
      } finally {
        setQueueBusyId(null);
      }
    },
    [pushToast, refreshQueue]
  );

  // Approve + send one item (Req 4.3, 8). The route returns EITHER a confirmed
  // send (`{ sent, status }`) OR a structured send-time skip (`{ skipped, reason }`
  // — opted out, cap reached, …); toast accordingly (Req 6.4, 7.2).
  const approveQueueItem = useCallback(
    async (id: string) => {
      setQueueBusyId(id);
      try {
        const res = await api<ApproveResult>(`/queue/${id}/approve`, {
          method: 'POST',
          body: '{}',
        });
        if ('skipped' in res) {
          pushToast('info', `Not sent — ${res.reason.replace(/_/g, ' ')}`);
        } else if (res.sent) {
          pushToast('success', 'Approved and sent ✓');
          logActivity('Outreach approved and sent from the review inbox ✓');
        } else {
          pushToast('info', `Not sent — ${res.status}`);
        }
        await refreshQueue();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Approval failed');
      } finally {
        setQueueBusyId(null);
      }
    },
    [pushToast, logActivity, refreshQueue]
  );

  // Reject one item (Req 4.4) — nothing is sent and the cross-rep claim is freed.
  const rejectQueueItem = useCallback(
    async (id: string) => {
      setQueueBusyId(id);
      try {
        await api(`/queue/${id}/reject`, { method: 'POST', body: '{}' });
        pushToast('info', 'Draft rejected — nothing was sent');
        await refreshQueue();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Reject failed');
      } finally {
        setQueueBusyId(null);
      }
    },
    [pushToast, refreshQueue]
  );

  // Bulk-approve the selected set (Req 5). The route applies the same per-item
  // opt-out + cap gate and returns `{ approved, sent, skipped: [{ id, reason }] }`;
  // render the result counts via toasts (Req 5.4).
  const bulkApprove = useCallback(async () => {
    const ids = [...queueSelected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api<BulkApproveResult>('/queue/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      pushToast(
        res.sent > 0 ? 'success' : 'info',
        `Bulk approve: ${res.approved} approved · ${res.sent} sent · ${res.skipped.length} skipped`
      );
      // Surface each skip reason so the rep understands what was held back.
      if (res.skipped.length > 0) {
        const byReason = res.skipped.reduce<Record<string, number>>((acc, s) => {
          acc[s.reason] = (acc[s.reason] ?? 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(byReason)
          .map(([reason, n]) => `${n} ${reason.replace(/_/g, ' ')}`)
          .join(', ');
        pushToast('info', `Skipped: ${summary}`);
      }
      if (res.sent > 0) {
        logActivity(`Bulk-approved ${res.sent} draft${res.sent === 1 ? '' : 's'} from the review inbox ✓`);
      }
      setQueueSelected(new Set());
      await refreshQueue();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Bulk approve failed');
    } finally {
      setBulkBusy(false);
    }
  }, [queueSelected, pushToast, logActivity, refreshQueue]);

  // ── Persisted Agent_Activity_Log fallback (task 10.4) ───────────────────────
  // Read `GET /api/prospecting/batches/:id/activity` on demand. The live SSE
  // stream may not stay open under `next dev`, so this gives the rep an explicit
  // way to see the ordered, persisted log for a run (Req 3.5). The route returns
  // `{ count, activity }` on success; on a read FAILURE it returns 500 with
  // `{ error, code }` — the `api()` helper throws with that `error` message, so
  // we surface it explicitly here and DO NOT show an empty success (Req 3.6).
  const viewActivityLog = useCallback(
    async (batchRunId?: string | null) => {
      const id = batchRunId ?? latestBatchRunId;
      if (!id) {
        pushToast('info', 'No batch run yet — start one to see its activity log.');
        return;
      }
      setBatchLogBusy(true);
      setBatchLogError(null);
      setBatchLogRunId(id);
      try {
        const data = await api<{ count: number; activity: BatchActivityEntry[] }>(
          `/batches/${id}/activity`
        );
        setBatchLog(data.activity);
      } catch (e) {
        // A retrieval failure must surface — never a silent empty list (Req 3.6).
        const msg = e instanceof Error ? e.message : 'Failed to retrieve the activity log';
        setBatchLog([]);
        setBatchLogError(msg);
        pushToast('error', msg);
      } finally {
        setBatchLogBusy(false);
      }
    },
    [latestBatchRunId, pushToast]
  );

  const saveHypothesis = useCallback(
    async (h: BuyerHypothesis) => {
      if (!brief) return;
      setHypothesis(h);
      try {
        await api(`/briefs/${brief.id}/hypothesis`, {
          method: 'PUT',
          body: JSON.stringify({ hypothesis: h }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save hypothesis');
      }
    },
    [brief]
  );

  const runSearch = useCallback(async () => {
    if (!brief) return;
    setError(null);
    setBusySearch(true);
    logActivity('Agent: searching investor databases (Apollo, Crunchbase) for matching profiles…');
    try {
      const data = await api<{ candidates: ProviderCandidate[] }>(
        `/briefs/${brief.id}/search`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setCandidates(data.candidates);
      logActivity(
        `Agent: returned ${data.candidates.length} candidate prospect${data.candidates.length === 1 ? '' : 's'} matching the buyer profile.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Search failed';
      setError(msg);
      pushToast('error', msg);
    } finally {
      setBusySearch(false);
    }
  }, [brief, logActivity, pushToast]);

  const recordTarget = useCallback(
    async (c: ProviderCandidate) => {
      if (!brief) return;
      const key = c.email || c.sourceRef || c.displayName || 'candidate';
      const name = c.displayName || c.companyName || 'prospect';
      setRecordingId(key);
      try {
        const out = await api<{ targetId: string }>('/targets', {
          method: 'POST',
          body: JSON.stringify({
            briefId: brief.id,
            targetType: c.targetType,
            displayName: c.displayName,
            companyName: c.companyName,
            title: c.title,
            email: c.email,
            phone: c.phone,
            country: c.country,
            attributes: c.attributes,
            sourceProvider: c.sourceProvider,
            sourceRef: c.sourceRef,
            lawfulBasis: c.lawfulBasis,
          }),
        });
        await refreshTargets(brief.id);
        if (out?.targetId) setPendingTargetId(out.targetId);
        pushToast('success', `Added ${name} to Targets — ready to draft outreach`);
        logActivity(`Recorded ${name} as a Target.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to record target';
        setError(msg);
        pushToast('error', msg);
      } finally {
        setRecordingId(null);
      }
    },
    [brief, refreshTargets, pushToast, logActivity]
  );

  const enrichTarget = useCallback(
    async (t: TargetRow) => {
      setPendingTargetId(t.id);
      try {
        await api(`/targets/${t.id}/enrich`, { method: 'POST', body: '{}' });
        if (brief) await refreshTargets(brief.id);
        pushToast('success', `Enriched ${t.displayName || 'target'} with provider intel`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Enrichment failed';
        setError(msg);
        pushToast('error', msg);
      } finally {
        setPendingTargetId(null);
      }
    },
    [brief, refreshTargets, pushToast]
  );

  const promoteTarget = useCallback(
    async (t: TargetRow) => {
      setPendingTargetId(t.id);
      try {
        const res = await api<{ resolution: string; crmLinked?: boolean }>(`/targets/${t.id}/promote`, {
          method: 'POST',
          body: JSON.stringify({ email: t.email ?? undefined }),
        });
        if (res.resolution === 'conflict' || res.resolution === 'error') {
          const msg = `Promotion returned "${res.resolution}" — no Lead was created; resolve manually.`;
          setError(msg);
          pushToast('error', msg);
        } else {
          const linked = res.crmLinked
            ? ' (linked to the existing Salesforce Lead)'
            : '';
          pushToast('success', `Promoted ${t.displayName || 'target'} to a Lead → Salesforce${linked}`);
          logActivity(
            res.crmLinked
              ? `Promoted ${t.displayName || 'target'} and linked to the existing Salesforce Lead — no duplicate created.`
              : `Promoted ${t.displayName || 'target'} to a Lead and handed off to Salesforce routing.`
          );
        }
        if (brief) await refreshTargets(brief.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Promotion failed';
        setError(msg);
        pushToast('error', msg);
      } finally {
        setPendingTargetId(null);
      }
    },
    [brief, refreshTargets, pushToast, logActivity]
  );

  const selectForDraft = useCallback(
    async (t: TargetRow) => {
      setSelectedTarget(t);
      setApproval(null);
      setCrmCheck(null);
      await refreshDrafts(t.id);

      // Before outreach, check whether this prospect is already in Salesforce.
      setCrmChecking(true);
      logActivity(`Checking Salesforce for ${t.displayName || 'this prospect'}…`);
      try {
        const res = await api<CrmCheckResult>(`/targets/${t.id}/crm-check`, {
          method: 'POST',
          body: '{}',
        });
        setCrmCheck(res);
        if (!res.configured) {
          logActivity('Salesforce not configured — proceeding without a CRM check.');
        } else if (res.found) {
          const m = res.matches[0];
          logActivity(
            `Found in Salesforce: ${m.name ?? 'contact'} (${m.object}${
              m.owner ? `, owner ${m.owner}` : ''
            }) — recommend a warm follow-up, not cold outreach.`
          );
          pushToast('info', `${t.displayName || 'Prospect'} is already in Salesforce — review before outreach`);
        } else {
          logActivity(`Not found in Salesforce — clear for cold outreach.`);
        }
      } catch (e) {
        logActivity('CRM check failed — proceeding manually.');
        setCrmCheck(null);
        void e;
      } finally {
        setCrmChecking(false);
      }
    },
    [refreshDrafts, logActivity, pushToast]
  );

  const createDraft = useCallback(
    async (
      channel: Channel,
      language: Language,
      subject: string,
      body: string,
      grounding: GroundingClaim[] = []
    ) => {
      if (!selectedTarget) return;
      setBusyOutreach(true);
      try {
        await api<{ draftId: string; draft: OutreachDraftRow }>('/drafts', {
          method: 'POST',
          body: JSON.stringify({
            targetId: selectedTarget.id,
            briefId: selectedTarget.briefId ?? undefined,
            channel,
            language,
            subject: channel === 'email' ? subject || undefined : undefined,
            body,
            grounding,
          }),
        });
        await refreshDrafts(selectedTarget.id);
        pushToast('success', 'Outreach draft saved — review, approve, then send');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to save draft';
        setError(msg);
        pushToast('error', msg);
      } finally {
        setBusyOutreach(false);
      }
    },
    [selectedTarget, refreshDrafts, pushToast]
  );

  // AI composes a personalized, SQL-grounded first-touch draft from the project
  // spec + this Target's profile + comparable market figures. The rep edits it
  // before saving (compose → edit → save → approve → send).
  const composeDraft = useCallback(
    async (channel: Channel, language: Language): Promise<ComposedDraft> => {
      if (!selectedTarget) {
        return { channel, language, subject: '', body: '', grounding: [] };
      }
      logActivity(
        `AI is drafting a ${channel === 'message' ? 'call script' : channel} for ${selectedTarget.displayName || 'the prospect'}…`
      );
      const data = await api<ComposedDraft>(
        `/targets/${selectedTarget.id}/compose-draft`,
        { method: 'POST', body: JSON.stringify({ channel, language }) }
      );
      logActivity(
        `AI draft ready (${data.grounding.length} grounded market figure${data.grounding.length === 1 ? '' : 's'}) — review and edit.`
      );
      return data;
    },
    [selectedTarget, logActivity]
  );

  const changeDraft = useCallback(
    async (subject: string, body: string) => {
      if (!draft || draft.status === 'sent' || draft.status === 'suppressed') return;
      try {
        await api(`/drafts/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify({ subject, body }),
        });
        setApproval(null); // edits invalidate any prior approval
        if (selectedTarget) await refreshDrafts(selectedTarget.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update draft');
      }
    },
    [draft, selectedTarget, refreshDrafts]
  );

  const approveDraft = useCallback(async () => {
    if (!draft) return;
    setBusyOutreach(true);
    try {
      const res = await api<{ token?: string; expiresAt?: string; reason?: string }>(
        `/drafts/${draft.id}/approve`,
        { method: 'POST', body: '{}' }
      );
      if (res.token && res.expiresAt) {
        setApproval({ token: res.token, expiresAt: res.expiresAt });
        pushToast('success', 'Draft approved — send is now unlocked');
      } else {
        const msg = `Could not approve: ${res.reason ?? 'unknown'}`;
        setError(msg);
        pushToast('error', msg);
      }
      if (selectedTarget) await refreshDrafts(selectedTarget.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Approval failed';
      setError(msg);
      pushToast('error', msg);
    } finally {
      setBusyOutreach(false);
    }
  }, [draft, selectedTarget, refreshDrafts, pushToast]);

  const sendDraft = useCallback(async () => {
    if (!draft || !approval) return;
    setBusyOutreach(true);
    try {
      const res = await api<{ sent: boolean; reason?: string; message?: string }>(
        `/drafts/${draft.id}/send`,
        { method: 'POST', body: JSON.stringify({ token: approval.token }) }
      );
      if (!res.sent) {
        const msg = res.message || `Send refused: ${res.reason ?? 'unknown'}`;
        setError(msg);
        pushToast('error', msg);
      } else {
        pushToast('success', 'Outreach sent ✓');
        logActivity(`Outreach sent to ${selectedTarget?.displayName || 'the prospect'} ✓`);
      }
      setApproval(null);
      if (selectedTarget) await refreshDrafts(selectedTarget.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed';
      setError(msg);
      pushToast('error', msg);
    } finally {
      setBusyOutreach(false);
    }
  }, [draft, approval, selectedTarget, refreshDrafts, pushToast, logActivity]);

  const hasBrief = useMemo(() => Boolean(brief), [brief]);

  // The cluster currently selected in the Own_Subject picker — reused as the
  // subject of an autonomous Batch_Run (task 10.2).
  const pickedCluster = useMemo(
    () => ownCatalog.clusters.find((c) => c.id === pickClusterId) ?? null,
    [ownCatalog.clusters, pickClusterId]
  );

  // Guided-flow state: which step is the current focus, and which are done.
  // Typed as `number` (not the inferred literal union) so the stepper's
  // `activeStep === n` comparisons stay valid for every step n.
  const activeStep = useMemo<number>(() => {
    if (!brief) return 1;
    if (!hypothesis) return 3;
    if (candidates.length === 0) return 4;
    if (targets.length === 0) return 4;
    if (!selectedTarget) return 5;
    return 6;
  }, [brief, hypothesis, candidates.length, targets.length, selectedTarget]);

  const stepperItems = useMemo(
    () => [
      { n: 1, label: 'Brief', done: hasBrief, active: activeStep === 1 },
      { n: 2, label: 'Market', done: comparables.length > 0, active: activeStep === 2 },
      { n: 3, label: 'Buyer', done: Boolean(hypothesis), active: activeStep === 3 },
      { n: 4, label: 'Prospects', done: candidates.length > 0, active: activeStep === 4 },
      { n: 5, label: 'Targets', done: targets.length > 0, active: activeStep === 5 },
      { n: 6, label: 'Outreach', done: draft?.status === 'sent', active: activeStep === 6 },
    ],
    [hasBrief, comparables.length, hypothesis, candidates.length, targets.length, draft?.status, activeStep]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        <PageHeaderSkeleton />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to view the Prospecting Workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ora-charcoal">
            <Telescope className="h-6 w-6 stroke-[1.5] text-ora-gold-dark" />
            Prospecting Workspace
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ora-charcoal-light">
            <ConnectionBadge status={streamStatus} />
            Property-led outbound — comparables, buyer hypothesis, grounded outreach
          </p>
        </div>

        {/* Hands-free entry: opens the voice agent in staff mode behind a short
            prototype notice. Talk through who you're after; it preps the run
            for your review (nothing sends without approval). */}
        <VoiceCallButton
          mode="staff"
          page="ora-panel-prospecting"
          label="Ask voice agent"
          title="Voice prospecting"
          introNotice={VOICE_PROSPECTING_NOTICE}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      <ProgressStepper items={stepperItems} />

      <RunBatchControl
        clusterId={pickClusterId}
        clusterName={pickedCluster?.name ?? null}
        busy={busyBatch}
        onRun={runBatch}
      />


      {activity.length > 0 && (
        <div className="rounded-xl border border-ora-sand/60 bg-ora-cream-light/50">
          <header className="flex items-center gap-2 border-b border-ora-sand/50 px-4 py-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ora-gold/60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ora-gold-dark" />
            </span>
            <Activity className="h-4 w-4 text-ora-gold-dark" />
            <h2 className="text-sm font-semibold text-ora-charcoal">Agent activity</h2>
            <span className="ml-auto text-[11px] text-ora-muted">live</span>
          </header>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto px-4 py-3">
            {activity.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-xs text-ora-charcoal-light">
                <span className="mt-0.5 font-mono text-[10px] text-ora-muted">{a.at}</span>
                <span className="flex-1 leading-snug">{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Persisted Agent_Activity_Log fallback (task 10.4). The live feed above
          is fed by SSE, which may not stay open under `next dev`; this reads the
          ordered, persisted log for a run on demand (Req 3.5) and surfaces a
          retrieval error explicitly rather than an empty success (Req 3.6). */}
      <BatchActivityLog
        runId={batchLogRunId ?? latestBatchRunId}
        entries={batchLog}
        busy={batchLogBusy}
        error={batchLogError}
        loaded={batchLogRunId !== null}
        onView={viewActivityLog}
      />

      <SectionCard step={1} title="Brief" subtitle="What are you selling?" active={activeStep === 1}>
        <div className="space-y-4">
          <OwnSubjectPicker
            catalog={ownCatalog}
            selectedCommunityId={pickCommunityId}
            selectedProjectId={pickProjectId}
            selectedClusterId={pickClusterId}
            busy={busyBrief}
            onSelectCommunity={onSelectCommunity}
            onSelectProject={onSelectProject}
            onSelectCluster={setPickClusterId}
            onUseCluster={useCluster}
          />
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-ora-sand/50" />
            <span className="text-[10px] uppercase tracking-wide text-ora-muted">or describe it</span>
            <div className="h-px flex-1 bg-ora-sand/50" />
          </div>
          <BriefIntake busy={busyBrief} onSubmit={createBrief} />
        </div>
      </SectionCard>

      <SectionCard step={2} title="Market comparables" subtitle="SQL-grounded competitor stats + area trend" muted={!hasBrief} badge={comparables.length || undefined} complete={comparables.length > 0} active={activeStep === 2}>
        {gaps.length > 0 && (
          <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
            The selected subject couldn&apos;t resolve {gaps.join(', ')} from our own
            catalog. Fill these in via the free-form brief above to sharpen the
            comparison — nothing was invented.
          </div>
        )}
        <ComparablesPanel comparables={comparables} unconfigured={unconfigured} areaTrend={areaTrend} />
      </SectionCard>

      <SectionCard step={3} title="Buyer hypothesis" subtitle="Editable proposal — adjust before search" muted={!hypothesis} complete={Boolean(hypothesis)} active={activeStep === 3}>
        {hypothesis ? (
          <HypothesisEditor hypothesis={hypothesis} busy={busySearch} onSave={saveHypothesis} onSearch={runSearch} />
        ) : (
          <p className="text-xs text-ora-muted">Submit a brief to derive a buyer hypothesis.</p>
        )}
      </SectionCard>

      <SectionCard step={4} title="Candidate targets" subtitle="From the configured providers" muted={!hasBrief} badge={candidates.length || undefined} complete={candidates.length > 0} active={activeStep === 4}>
        <CandidatesPanel candidates={candidates} recordingId={recordingId} onRecord={recordTarget} />
      </SectionCard>

      <SectionCard step={5} title="Targets" subtitle="Research, promote, draft" muted={targets.length === 0} badge={targets.length || undefined} complete={targets.length > 0} active={activeStep === 5}>
        <TargetsPanel
          targets={targets}
          selectedId={selectedTarget?.id ?? null}
          pendingId={pendingTargetId}
          onSelect={selectForDraft}
          onEnrich={enrichTarget}
          onPromote={promoteTarget}
          onDraft={selectForDraft}
        />
      </SectionCard>

      <SectionCard step={6} title="Outreach" subtitle="Editable draft → approve → send" muted={!selectedTarget} complete={draft?.status === 'sent'} active={activeStep === 6}>
        <OutreachPanel
          target={selectedTarget}
          draft={draft}
          approval={approval}
          busy={busyOutreach}
          crmCheck={crmCheck}
          crmChecking={crmChecking}
          onCreateDraft={createDraft}
          onChangeDraft={changeDraft}
          onCompose={composeDraft}
          onApprove={approveDraft}
          onSend={sendDraft}
        />
      </SectionCard>

      {/* Approval Queue / Review Inbox — the autonomous batch's output for human
          review (task 10.3). Additive to the per-prospect flow above. */}
      <section className="rounded-xl border border-ora-gold-dark/30 bg-ora-white">
        <header className="flex items-center gap-2.5 px-5 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ora-gold-dark text-ora-white">
            <Inbox className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ora-charcoal">Review inbox</h2>
            <p className="text-xs text-ora-muted">
              AI-drafted outreach awaiting your approval — edit, approve &amp; send,
              reject, or bulk-approve. Nothing sends without you.
            </p>
          </div>
          {queueItems.length > 0 && (
            <span className="rounded-full bg-ora-cream-dark px-2 py-0.5 text-[10px] font-semibold text-ora-charcoal-light">
              {queueItems.length} pending
            </span>
          )}
        </header>
        <div className="border-t border-ora-sand/50 px-5 py-4">
          <ReviewInboxPanel
            items={queueItems}
            selectedIds={queueSelected}
            busyId={queueBusyId}
            bulkBusy={bulkBusy}
            onToggleSelect={toggleQueueSelect}
            onToggleAll={toggleQueueAll}
            onEdit={editQueueItem}
            onApprove={approveQueueItem}
            onReject={rejectQueueItem}
            onBulkApprove={bulkApprove}
          />
        </div>
      </section>

      {/* Toasts — immediate feedback for every action */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Info;
          const tone =
            t.kind === 'success'
              ? 'border-ora-success/30 bg-white text-ora-charcoal'
              : t.kind === 'error'
                ? 'border-ora-error/30 bg-white text-ora-charcoal'
                : 'border-ora-sand/60 bg-white text-ora-charcoal';
          const iconTone =
            t.kind === 'success' ? 'text-ora-success' : t.kind === 'error' ? 'text-ora-error' : 'text-ora-info';
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-ora-lg ${tone}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />
              <span className="flex-1 leading-snug">{t.text}</span>
              <button
                type="button"
                aria-label="Dismiss"
                className="text-ora-muted hover:text-ora-charcoal"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
