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
import { ShieldAlert, Telescope, CheckCircle2, AlertCircle, Info, X, Activity, Inbox, MapPin, Layers, Pencil } from 'lucide-react';
import { PageHeaderSkeleton } from '@/components/ui/panel-skeletons';
import type { SessionData } from '@/lib/types/session';
import {
  BriefIntake,
  BriefDetails,
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
  WorkspaceModeToggle,
  StepGuide,
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
  AreaTrendRow,
  BatchSubject,
  StartBatchResult,
  QueueItemRow,
  ApproveResult,
  BulkApproveResult,
  BatchActivityEntry,
  ProviderSearchStatus,
  SequenceRow,
  SequenceMode,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

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

/**
 * Re-derive the editable Buyer_Hypothesis from a CURATED subset of comparables
 * (the closest matches the rep ticked). Mirrors the server's `deriveHypothesis`
 * aggregation (buyer-segment mix → ranked segments) so selecting comps visibly
 * reshapes the buyer profile that then drives prospect search. Rep-added feeder
 * markets / title edits on the prior hypothesis are preserved.
 */
function deriveHypothesisFromComps(
  comps: Comparable[],
  prev: BuyerHypothesis | null
): BuyerHypothesis {
  const totals = new Map<string, number>();
  const evidence: BuyerHypothesis['evidence'] = [];
  for (const c of comps) {
    const mix = c.stats?.buyerSegmentMix;
    const asOf = mix?.asOf ?? new Date().toISOString();
    for (const b of mix?.value ?? []) {
      totals.set(b.segment, (totals.get(b.segment) ?? 0) + b.count);
      evidence.push({
        claim: `${b.pct}% of comparable buyers at ${c.name} were ${b.segment}`,
        sourceTable: 'market_transactions',
        asOf,
      });
    }
  }
  const segments = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([s]) => s);
  return {
    segments,
    feederMarkets: prev?.feederMarkets ?? [],
    titles: segments.length
      ? prev?.titles?.length
        ? prev.titles
        : ['Founder', 'Managing Director', 'Investor', 'Family Office Principal']
      : [],
    wealthSignals: segments.length
      ? prev?.wealthSignals?.length
        ? prev.wealthSignals
        : ['liquidity event', 'high net worth']
      : [],
    evidence: evidence.slice(0, 24),
    confidence: comps.length === 0 ? 'low' : comps.length >= 3 ? 'high' : 'medium',
  };
}

export default function ProspectingPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which workflow the rep is in: a GUIDED, one-prospect-at-a-time flow, or the
  // AUTONOMOUS batch (agent runs N prospects → review inbox). Showing one at a
  // time keeps the workspace from stacking two competing mental models.
  const [mode, setMode] = useState<'guided' | 'autonomous' | 'sequences'>('guided');

  // Brief intake offers two clear, equal paths: pick from ORA's own catalog, or
  // describe the property by hand. We default to the catalog, but auto-switch to
  // the manual form when the catalog is empty so a rep is never left blocked.
  const [briefTab, setBriefTab] = useState<'catalog' | 'manual'>('catalog');

  // Property details the rep ALWAYS supplies in catalog mode — unit type +
  // bedrooms (+ optional price band). These guarantee the comparison spec is
  // never empty, so comparable sales (the AI's grounding) can always be matched.
  const [briefUnitType, setBriefUnitType] = useState<string>('');
  const [briefBedrooms, setBriefBedrooms] = useState<string>('');
  const [briefPriceMin, setBriefPriceMin] = useState<string>('');
  const [briefPriceMax, setBriefPriceMax] = useState<string>('');

  // Flow state.
  const [brief, setBrief] = useState<ProspectingBrief | null>(null);
  const [comparables, setComparables] = useState<Comparable[]>([]);
  // Which comparables the rep has ticked as closest matches — the curated set
  // the agent uses to (re)build the buyer profile. Defaults to all on load.
  const [selectedCompIds, setSelectedCompIds] = useState<Set<string>>(new Set());
  const [busyRederive, setBusyRederive] = useState(false);
  const [areaTrend, setAreaTrend] = useState<AreaTrendRow[]>([]);
  const [marketDataSource, setMarketDataSource] = useState<'live' | 'demo' | null>(null);
  const [marketDataNote, setMarketDataNote] = useState<'trial_limit' | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [hypothesis, setHypothesis] = useState<BuyerHypothesis | null>(null);
  const [candidates, setCandidates] = useState<ProviderCandidate[]>([]);
  const [searchStatus, setSearchStatus] = useState<ProviderSearchStatus | null>(null);
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

  // ── Prospecting Sequences state (named background campaigns) ────────────────
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [seqCreating, setSeqCreating] = useState(false);
  const [seqToggleBusyId, setSeqToggleBusyId] = useState<string | null>(null);
  const [openSequenceId, setOpenSequenceId] = useState<string | null>(null);
  const [seqInboxItems, setSeqInboxItems] = useState<QueueItemRow[]>([]);
  const [seqSelected, setSeqSelected] = useState<Set<string>>(new Set());
  const [seqInboxBusyId, setSeqInboxBusyId] = useState<string | null>(null);
  const [seqBulkBusy, setSeqBulkBusy] = useState(false);

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
        marketDataSource?: 'live' | 'demo' | null;
        marketDataNote?: 'trial_limit' | null;
      }>('/briefs', { method: 'POST', body: JSON.stringify(payload) });
      setBrief(data.brief);
      setComparables(data.comparables);
      // Default the curated set to every returned comparable; the rep narrows it.
      setSelectedCompIds(new Set(data.comparables.map((c) => c.marketProjectId)));
      setAreaTrend(data.areaTrend ?? []);
      setMarketDataSource(data.marketDataSource ?? null);
      setMarketDataNote(data.marketDataNote ?? null);
      setUnconfigured(data.unconfigured);
      setHypothesis(data.hypothesis);
      setGaps(data.gaps ?? []);
      if (data.marketDataNote === 'trial_limit') {
        logActivity(
          'Agent: market data trial limit reached — showing representative comparable sales (same data each time).'
        );
      }
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

  // Selecting a subject drives the brief: the server resolves the Comparison_Spec
  // from the own catalog (Req 13.5) and MERGES the rep's explicit property
  // details (unit type / bedrooms / price) over it — so the comparison spec is
  // never empty and comparable sales can always be matched. Cluster is OPTIONAL.
  const useSubject = useCallback(
    () => {
      const spec: Record<string, unknown> = { features: [] };
      if (briefUnitType) spec.unitType = briefUnitType;
      if (briefBedrooms) spec.bedrooms = Number(briefBedrooms);
      if (briefPriceMin) spec.priceMinAed = Number(briefPriceMin);
      if (briefPriceMax) spec.priceMaxAed = Number(briefPriceMax);
      return submitBrief({
        communityId: pickCommunityId ?? undefined,
        projectId: pickProjectId ?? undefined,
        clusterId: pickClusterId ?? undefined,
        spec,
      });
    },
    [
      submitBrief,
      pickCommunityId,
      pickProjectId,
      pickClusterId,
      briefUnitType,
      briefBedrooms,
      briefPriceMin,
      briefPriceMax,
    ]
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

  // ── Prospecting Sequences handlers ──────────────────────────────────────────
  const refreshSequences = useCallback(async () => {
    try {
      const data = await api<{ sequences: SequenceRow[] }>('/sequences');
      setSequences(data.sequences);
    } catch {
      // best-effort
    }
  }, []);

  const refreshOpenSequence = useCallback(async (id: string) => {
    try {
      const data = await api<{ queueItems: QueueItemRow[] }>(`/sequences/${id}`);
      setSeqInboxItems(data.queueItems);
      setSeqSelected((prev) => {
        const live = new Set(data.queueItems.map((i) => i.id));
        const next = new Set<string>();
        prev.forEach((qid) => { if (live.has(qid)) next.add(qid); });
        return next;
      });
    } catch {
      // best-effort
    }
  }, []);

  const createSequence = useCallback(
    async (input: { name: string; description: string; targetCount: number }) => {
      if (!pickProjectId) {
        pushToast('error', 'Pick a project as the sequence subject first.');
        return;
      }
      setSeqCreating(true);
      try {
        await api('/sequences', {
          method: 'POST',
          body: JSON.stringify({
            name: input.name,
            description: input.description,
            targetCount: input.targetCount,
            // The subject is the own PROJECT the rep picked; a cluster (when
            // chosen) narrows it further. The agent derives who to prospect from
            // this subject's own-catalog spec (area / segment / unit types).
            subject: {
              kind: 'cluster',
              projectId: pickProjectId,
              ...(pickClusterId ? { clusterId: pickClusterId } : {}),
              ...(pickCommunityId ? { communityId: pickCommunityId } : {}),
            },
          }),
        });
        pushToast('success', `Sequence “${input.name}” created — turn it Live to start prospecting`);
        await refreshSequences();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Failed to create sequence');
      } finally {
        setSeqCreating(false);
      }
    },
    [pickProjectId, pickClusterId, pickCommunityId, pushToast, refreshSequences]
  );

  const toggleSequence = useCallback(
    async (seq: SequenceRow, next: SequenceMode) => {
      setSeqToggleBusyId(seq.id);
      try {
        const res = await api<{ launchedRunId: string | null }>(`/sequences/${seq.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ mode: next }),
        });
        if (next === 'live') {
          pushToast('success', `“${seq.name}” is Live — the agent is looking for prospects in the background`);
          logActivity(`Sequence “${seq.name}” turned Live — agent prospecting started.`);
        } else {
          pushToast('info', `“${seq.name}” paused (Draft) — nothing new will be prospected`);
        }
        void res;
        await refreshSequences();
        if (openSequenceId === seq.id) await refreshOpenSequence(seq.id);
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Failed to update sequence');
      } finally {
        setSeqToggleBusyId(null);
      }
    },
    [pushToast, logActivity, refreshSequences, refreshOpenSequence, openSequenceId]
  );

  const openSequence = useCallback(
    async (seq: SequenceRow) => {
      setOpenSequenceId(seq.id);
      setSeqInboxItems([]);
      await refreshOpenSequence(seq.id);
    },
    [refreshOpenSequence]
  );

  const closeSequenceDetail = useCallback(() => {
    setOpenSequenceId(null);
    setSeqInboxItems([]);
    setSeqSelected(new Set());
  }, []);

  // Review-inbox actions scoped to the open sequence (reuse the /queue endpoints,
  // then refresh the sequence detail + the list counts).
  const seqToggleSelect = useCallback((id: string) => {
    setSeqSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const seqToggleAll = useCallback(() => {
    setSeqSelected((prev) => {
      const all = seqInboxItems.length > 0 && seqInboxItems.every((i) => prev.has(i.id));
      return all ? new Set<string>() : new Set(seqInboxItems.map((i) => i.id));
    });
  }, [seqInboxItems]);

  const afterSeqMutation = useCallback(async () => {
    if (openSequenceId) await refreshOpenSequence(openSequenceId);
    await refreshSequences();
  }, [openSequenceId, refreshOpenSequence, refreshSequences]);

  const seqEditItem = useCallback(
    async (id: string, subject: string, body: string) => {
      setSeqInboxBusyId(id);
      try {
        await api(`/queue/${id}`, { method: 'PUT', body: JSON.stringify({ subject, body }) });
        pushToast('success', 'Draft edits saved');
        await afterSeqMutation();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Failed to save edits');
      } finally {
        setSeqInboxBusyId(null);
      }
    },
    [pushToast, afterSeqMutation]
  );

  const seqApproveItem = useCallback(
    async (id: string) => {
      setSeqInboxBusyId(id);
      try {
        const res = await api<ApproveResult>(`/queue/${id}/approve`, { method: 'POST', body: '{}' });
        if ('skipped' in res) pushToast('info', `Not sent — ${res.reason.replace(/_/g, ' ')}`);
        else if (res.sent) pushToast('success', 'Approved and sent ✓');
        else pushToast('info', `Not sent — ${res.status}`);
        await afterSeqMutation();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Approval failed');
      } finally {
        setSeqInboxBusyId(null);
      }
    },
    [pushToast, afterSeqMutation]
  );

  const seqRejectItem = useCallback(
    async (id: string) => {
      setSeqInboxBusyId(id);
      try {
        await api(`/queue/${id}/reject`, { method: 'POST', body: '{}' });
        pushToast('info', 'Draft rejected — nothing was sent');
        await afterSeqMutation();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : 'Reject failed');
      } finally {
        setSeqInboxBusyId(null);
      }
    },
    [pushToast, afterSeqMutation]
  );

  const seqBulkApprove = useCallback(async () => {
    const ids = [...seqSelected];
    if (ids.length === 0) return;
    setSeqBulkBusy(true);
    try {
      const res = await api<BulkApproveResult>('/queue/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      pushToast(
        res.sent > 0 ? 'success' : 'info',
        `Bulk approve: ${res.approved} approved · ${res.sent} sent · ${res.skipped.length} skipped`
      );
      setSeqSelected(new Set());
      await afterSeqMutation();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Bulk approve failed');
    } finally {
      setSeqBulkBusy(false);
    }
  }, [seqSelected, pushToast, afterSeqMutation]);

  // Switch workspace mode; lazily load sequences when entering that mode (avoids
  // a setState-in-effect by loading on the user action instead).
  const changeMode = useCallback(
    (m: 'guided' | 'autonomous' | 'sequences') => {
      setMode(m);
      if (m === 'sequences') void refreshSequences();
    },
    [refreshSequences]
  );

  // While a LIVE sequence is open, poll its prospects so freshly-found drafts
  // appear as the background agent adds them (the SSE stream may not stay open
  // under `next dev`). The setState happens in the interval callback, not the
  // effect body, so this stays off the synchronous-setState path.
  useEffect(() => {
    if (!openSequenceId) return;
    const seq = sequences.find((s) => s.id === openSequenceId);
    if (seq?.mode !== 'live') return;
    const timer = setInterval(() => {
      void refreshOpenSequence(openSequenceId);
      void refreshSequences();
    }, 5000);
    return () => clearInterval(timer);
  }, [openSequenceId, sequences, refreshOpenSequence, refreshSequences]);

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

  // Toggle a comparable in the rep's curated "closest matches" set.
  const toggleComp = useCallback((id: string) => {
    setSelectedCompIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Rebuild the buyer profile from ONLY the comparables the rep selected, then
  // persist it — so the curated sold comps drive the prospect search (Step 4).
  const useSelectedComparables = useCallback(async () => {
    const selected = comparables.filter((c) => selectedCompIds.has(c.marketProjectId));
    if (selected.length === 0) return;
    setBusyRederive(true);
    const h = deriveHypothesisFromComps(selected, hypothesis);
    setHypothesis(h);
    try {
      if (brief) {
        await api(`/briefs/${brief.id}/hypothesis`, {
          method: 'PUT',
          body: JSON.stringify({ hypothesis: h }),
        });
      }
      pushToast(
        'success',
        `Buyer profile rebuilt from ${selected.length} comparable${selected.length === 1 ? '' : 's'}`
      );
      logActivity(
        `Rebuilt the buyer profile from ${selected.length} selected comparable${selected.length === 1 ? '' : 's'}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update buyer profile');
    } finally {
      setBusyRederive(false);
    }
  }, [comparables, selectedCompIds, hypothesis, brief, pushToast, logActivity]);

  const runSearch = useCallback(async () => {
    if (!brief) return;
    setError(null);
    setBusySearch(true);
    logActivity('Agent: searching investor databases (Apollo, Crunchbase) for matching profiles…');
    try {
      const data = await api<{
        candidates: ProviderCandidate[];
        unconfiguredProviders?: string[];
        failedProviders?: string[];
        rateLimitedProviders?: string[];
      }>(
        `/briefs/${brief.id}/search`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setCandidates(data.candidates);
      setSearchStatus({
        unconfiguredProviders: data.unconfiguredProviders ?? [],
        failedProviders: data.failedProviders ?? [],
        rateLimitedProviders: data.rateLimitedProviders ?? [],
      });
      if ((data.rateLimitedProviders ?? []).length > 0) {
        logActivity(`Agent: buyer data trial limit reached — showing representative buyers (cached).`);
        pushToast('info', `Buyer data trial limit reached — showing representative buyers`);
      }
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
        if (out?.targetId) {
          setPendingTargetId(out.targetId);
          // Auto-open the Outreach step for the just-recorded Target so the rep
          // flows straight into drafting. Previously the section stayed locked
          // (`muted`) until the rep clicked the target again, which read as
          // "nothing happened". We re-fetch so we have the full row to select.
          try {
            const data = await api<{ targets: TargetRow[] }>(
              `/targets?briefId=${brief.id}`
            );
            setTargets(data.targets);
            const row = data.targets.find((t) => t.id === out.targetId) ?? null;
            if (row) {
              setSelectedTarget(row);
              setApproval(null);
              setCrmCheck(null);
              await refreshDrafts(row.id);
            }
          } catch {
            // best-effort — the target is recorded regardless; the rep can still
            // click it in the Prospects list to open outreach.
          }
        }
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
    [brief, refreshTargets, refreshDrafts, pushToast, logActivity]
  );

  const enrichTarget = useCallback(
    async (t: TargetRow) => {
      setPendingTargetId(t.id);
      try {
        const res = await api<{
          attributes?: Record<string, unknown>;
          unconfiguredProviders?: string[];
          failedProviders?: string[];
        }>(`/targets/${t.id}/enrich`, { method: 'POST', body: '{}' });
        if (brief) await refreshTargets(brief.id);
        const name = t.displayName || 'target';
        const fieldCount = res.attributes ? Object.keys(res.attributes).length : 0;
        if (fieldCount > 0) {
          pushToast('success', `Enriched ${name} — ${fieldCount} detail${fieldCount === 1 ? '' : 's'} added below`);
          logActivity(`Enriched ${name} with ${fieldCount} provider field${fieldCount === 1 ? '' : 's'}.`);
        } else {
          // Honest signal: nothing came back (no provider configured / connected).
          pushToast('info', `No provider intel available for ${name} — connect a data provider to enrich`);
          logActivity(`Enrich found no provider intel for ${name} (no provider connected).`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Enrichment failed';
        setError(msg);
        pushToast('error', msg);
      } finally {
        setPendingTargetId(null);
      }
    },
    [brief, refreshTargets, pushToast, logActivity]
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
          pushToast('success', `Promoted ${t.displayName || 'target'} to a Lead — now in the Lead Engine${linked}`);
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

  // Never leave the rep blocked: when the own catalog has no communities to pick
  // from, force the manual "describe it" form so there is always a way forward
  // (the empty-catalog dead-end was the #1 source of confusion). Derived rather
  // than stored so it reacts to the catalog loading without a setState effect.
  const catalogEmpty = ready && ownCatalog.communities.length === 0;
  const effectiveBriefTab: 'catalog' | 'manual' = catalogEmpty ? 'manual' : briefTab;

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
    // Step 4 ("Prospects") covers finding candidates, saving the shortlist, and
    // picking one to draft — the rep stays here until a target is selected.
    if (!selectedTarget) return 4;
    return 5;
  }, [brief, hypothesis, selectedTarget]);

  const stepperItems = useMemo(
    () => [
      { n: 1, label: 'Brief', done: hasBrief, active: activeStep === 1 },
      { n: 2, label: 'Market', done: comparables.length > 0, active: activeStep === 2 },
      { n: 3, label: 'Buyer', done: Boolean(hypothesis), active: activeStep === 3 },
      { n: 4, label: 'Prospects', done: targets.length > 0, active: activeStep === 4 },
      { n: 5, label: 'Outreach', done: draft?.status === 'sent', active: activeStep === 5 },
    ],
    [hasBrief, comparables.length, hypothesis, targets.length, draft?.status, activeStep]
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
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
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
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      <WorkspaceModeToggle mode={mode} onChange={changeMode} />

      {/* Agent activity — a live log of what the agent is doing. Shown in both
          modes (guided per-action logs + autonomous batch decisions). */}
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

      {/* Two-column workspace: the active flow on the left, a sticky contextual
          guide on the right that explains whatever step the rep is on. The guide
          stacks under the flow on narrow screens. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
      {/* ── AUTONOMOUS BATCH ─────────────────────────────────────────────────
          Pick a subject → run a batch → the agent's cold-eligible drafts land in
          the Review inbox for approval. Self-contained: nothing here depends on
          the guided flow. */}
      {mode === 'autonomous' && (
        <>
          <div className="rounded-xl border border-ora-sand/60 bg-ora-white">
            <header className="flex items-center gap-2.5 px-5 py-3">
              <MapPin className="h-4 w-4 text-ora-gold-dark" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ora-charcoal">Subject</h2>
                <p className="text-xs text-ora-muted">Pick the community / project / cluster the batch will prospect for.</p>
              </div>
            </header>
            <div className="border-t border-ora-sand/50 px-5 py-4">
              <OwnSubjectPicker
                catalog={ownCatalog}
                selectedCommunityId={pickCommunityId}
                selectedProjectId={pickProjectId}
                selectedClusterId={pickClusterId}
                busy={busyBatch}
                onSelectCommunity={onSelectCommunity}
                onSelectProject={onSelectProject}
                onSelectCluster={setPickClusterId}
              />
            </div>
          </div>

          <RunBatchControl
            clusterId={pickClusterId}
            clusterName={pickedCluster?.name ?? null}
            busy={busyBatch}
            onRun={runBatch}
          />

          {/* Persisted Agent_Activity_Log fallback (task 10.4): reads the
              ordered, persisted log for a run on demand when the live SSE stream
              is unavailable, surfacing a retrieval error explicitly. */}
          <BatchActivityLog
            runId={batchLogRunId ?? latestBatchRunId}
            entries={batchLog}
            busy={batchLogBusy}
            error={batchLogError}
            loaded={batchLogRunId !== null}
            onView={viewActivityLog}
          />

          {/* Approval Queue / Review Inbox — the autonomous batch's output for
              human review (task 10.3). */}
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
        </>
      )}

      {/* ── SEQUENCES ────────────────────────────────────────────────────────
          Named background campaigns now live on a dedicated surface
          (`/ora-panel/prospecting/sequences`) — the builder, enrolled prospects,
          review inbox, activity log, and lifecycle controls. This compact card
          links out so the workspace stays focused on the one-shot flows. */}
      {mode === 'sequences' && (
        <section className="rounded-xl border border-ora-sand/60 bg-ora-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Telescope className="h-5 w-5 text-ora-gold-dark" />
              <div>
                <h2 className="text-sm font-semibold text-ora-charcoal">Prospecting Sequences</h2>
                <p className="text-xs text-ora-charcoal-light">
                  {sequences.length > 0
                    ? `${sequences.length} sequence${sequences.length === 1 ? '' : 's'} — manage them on the dedicated surface.`
                    : 'Named background campaigns that keep finding new prospects on a cadence.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push('/ora-panel/prospecting/sequences')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ora-gold-dark px-3 py-2 text-sm font-semibold text-white transition hover:bg-ora-gold"
            >
              Open sequences
            </button>
          </div>
        </section>
      )}

      {/* ── GUIDED FLOW ──────────────────────────────────────────────────────
          One prospect at a time: brief → comparables → buyer → candidates →
          targets → outreach. The stepper drives focus; completed steps collapse. */}
      {mode === 'guided' && (
        <>
          <ProgressStepper items={stepperItems} />

          <SectionCard step={1} title="Brief" subtitle="What are you selling?" active={activeStep === 1}>
            <div className="space-y-4">
              {/* Two clear, equal ways to set the subject — no hidden disclosure.
                  Pick from our own catalog, or describe the property by hand. */}
              <div className="inline-flex rounded-full border border-ora-sand/70 bg-ora-cream-light/40 p-0.5 text-xs">
                <button
                  type="button"
                  aria-pressed={effectiveBriefTab === 'catalog'}
                  disabled={catalogEmpty}
                  title={catalogEmpty ? 'No catalog entries available — describe it manually' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition disabled:opacity-40 ${
                    effectiveBriefTab === 'catalog'
                      ? 'bg-ora-charcoal text-ora-white'
                      : 'text-ora-charcoal-light hover:text-ora-charcoal'
                  }`}
                  onClick={() => setBriefTab('catalog')}
                >
                  <Layers className="h-3.5 w-3.5" /> Pick from our catalog
                </button>
                <button
                  type="button"
                  aria-pressed={effectiveBriefTab === 'manual'}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition ${
                    effectiveBriefTab === 'manual'
                      ? 'bg-ora-charcoal text-ora-white'
                      : 'text-ora-charcoal-light hover:text-ora-charcoal'
                  }`}
                  onClick={() => setBriefTab('manual')}
                >
                  <Pencil className="h-3.5 w-3.5" /> Describe it manually
                </button>
              </div>

              {effectiveBriefTab === 'catalog' ? (
                <>
                  <OwnSubjectPicker
                    catalog={ownCatalog}
                    selectedCommunityId={pickCommunityId}
                    selectedProjectId={pickProjectId}
                    selectedClusterId={pickClusterId}
                    busy={busyBrief}
                    onSelectCommunity={onSelectCommunity}
                    onSelectProject={onSelectProject}
                    onSelectCluster={setPickClusterId}
                  />
                  <BriefDetails
                    unitType={briefUnitType}
                    bedrooms={briefBedrooms}
                    priceMin={briefPriceMin}
                    priceMax={briefPriceMax}
                    onUnitType={setBriefUnitType}
                    onBedrooms={setBriefBedrooms}
                    onPriceMin={setBriefPriceMin}
                    onPriceMax={setBriefPriceMax}
                    busy={busyBrief}
                    onSubmit={useSubject}
                  />
                </>
              ) : (
                <BriefIntake busy={busyBrief} onSubmit={createBrief} />
              )}
            </div>
          </SectionCard>

          <SectionCard step={2} title="Market comparables" subtitle="SQL-grounded competitor stats + area trend" muted={!hasBrief} badge={comparables.length || undefined} complete={comparables.length > 0} active={activeStep === 2}>
            {gaps.length > 0 && marketDataNote !== 'trial_limit' && (
              <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
                The selected subject couldn&apos;t resolve {gaps.join(', ')} from our own
                catalog. Fill these in via the free-form brief above to sharpen the
                comparison — nothing was invented.
              </div>
            )}
            <ComparablesPanel comparables={comparables} unconfigured={unconfigured} areaTrend={areaTrend} dataSource={marketDataSource} dataNote={marketDataNote} selectedIds={selectedCompIds} onToggleSelect={toggleComp} onUseSelected={useSelectedComparables} useSelectedBusy={busyRederive} />
          </SectionCard>

          <SectionCard step={3} title="Buyer hypothesis" subtitle="Editable proposal — adjust before search" muted={!hypothesis} complete={Boolean(hypothesis)} active={activeStep === 3}>
            {hypothesis ? (
              <HypothesisEditor hypothesis={hypothesis} busy={busySearch} onSave={saveHypothesis} onSearch={runSearch} />
            ) : (
              <p className="text-xs text-ora-muted">Submit a brief to derive a buyer hypothesis.</p>
            )}
          </SectionCard>

          <SectionCard step={4} title="Prospects" subtitle="Find prospects, save your shortlist, draft outreach" muted={!hasBrief} badge={targets.length || candidates.length || undefined} complete={targets.length > 0} active={activeStep === 4}>
            <div className="space-y-5">
              {/* Saved shortlist (recorded Targets) — the rows you act on. */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ora-charcoal-light">
                    Your shortlist
                  </h3>
                  {targets.length > 0 && (
                    <span className="rounded-full bg-ora-cream-dark px-1.5 py-0.5 text-[10px] font-semibold text-ora-charcoal-light">
                      {targets.length}
                    </span>
                  )}
                </div>
                <TargetsPanel
                  targets={targets}
                  selectedId={selectedTarget?.id ?? null}
                  pendingId={pendingTargetId}
                  onSelect={selectForDraft}
                  onEnrich={enrichTarget}
                  onPromote={promoteTarget}
                  onDraft={selectForDraft}
                />
              </div>

              {/* Candidates from the providers — "Record" lifts one into the shortlist. */}
              <div className="border-t border-ora-sand/40 pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ora-charcoal-light">
                  Prospects from providers
                </h3>
                <CandidatesPanel candidates={candidates} status={searchStatus} recordingId={recordingId} onRecord={recordTarget} />
              </div>
            </div>
          </SectionCard>

          <SectionCard step={5} title="Outreach" subtitle="Editable draft → approve → send" muted={!selectedTarget} complete={draft?.status === 'sent'} active={activeStep === 5}>
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
        </>
      )}
        </div>

        {/* Contextual help — teaches the workspace as the rep moves through it. */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <StepGuide mode={mode} step={activeStep} dataSource={marketDataSource} />
        </aside>
      </div>

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
