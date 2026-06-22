'use client';

// ── Prospecting Workspace — presentational components (S7, task 8.4) ─────────
//
// Classic-panel-consistent (ORA theme tokens, the same look as the Lead Engine
// and AI surfaces). These are pure presentational pieces; all data fetching +
// dispatch lives in `page.tsx`, which threads state + callbacks down. Every
// factual market figure shown carries its SQL provenance (source + as-of),
// satisfying CC-Provenance at the UI edge.

import { useState } from 'react';
import {
  Radio,
  RadioTower,
  Building2,
  Sparkles,
  Loader2,
  Send,
  ShieldCheck,
  ShieldAlert,
  Search,
  UserPlus,
  ArrowUpRight,
  Pencil,
  MapPin,
  Layers,
  TrendingUp,
  Check,
  Lock,
  Rocket,
  Bot,
  Inbox,
  ThumbsDown,
  Save,
  Gauge,
  CheckCheck,
  Square,
  CheckSquare,
  ShieldQuestion,
  ScrollText,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import type {
  BriefSpec,
  BuyerHypothesis,
  Comparable,
  ProviderCandidate,
  TargetRow,
  OutreachDraftRow,
  Channel,
  Language,
  ComposedDraft,
  GroundingClaim,
  CrmCheckResult,
  TargetType,
  OwnCatalog,
  ClusterNode,
  AreaTrendRow,
  BatchSubject,
  QueueItemRow,
  BatchActivityEntry,
  BatchActivityAction,
} from './types';
import type { ProspectingStreamStatus } from './useProspectingRealtime';

// ── Shared atoms ──────────────────────────────────────────────────────────────

export function SectionCard({
  step,
  title,
  subtitle,
  children,
  muted,
  badge,
  complete,
  active,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  muted?: boolean;
  /** Optional count/label pill shown next to the title (e.g. number of items). */
  badge?: string | number;
  /** When true, the step number renders as a completed tick. */
  complete?: boolean;
  /** When true, the card is the current focus — highlighted, never collapsed. */
  active?: boolean;
}) {
  // Locked (not-yet-reachable) steps collapse to a thin header so the workspace
  // reads as a guided flow rather than a wall of six open cards.
  const collapsed = muted && !active;
  return (
    <section
      className={`rounded-xl border bg-ora-white transition-all ${
        collapsed
          ? 'border-ora-sand/40 opacity-70'
          : active
            ? 'border-ora-gold-dark/40 shadow-ora-md ring-1 ring-ora-gold/30'
            : 'border-ora-sand/60'
      }`}
    >
      <header className="flex items-center gap-3 px-5 py-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
            complete
              ? 'bg-ora-success text-ora-white'
              : active
                ? 'bg-ora-gold-dark text-ora-white'
                : collapsed
                  ? 'bg-ora-stone text-ora-white'
                  : 'bg-ora-charcoal text-ora-white'
          }`}
        >
          {complete ? <Check className="h-3.5 w-3.5" /> : step}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ora-charcoal">{title}</h2>
            {badge !== undefined && badge !== '' && (
              <span className="rounded-full bg-ora-cream-dark px-2 py-0.5 text-[10px] font-semibold text-ora-charcoal-light">
                {badge}
              </span>
            )}
            {active && (
              <span className="rounded-full bg-ora-gold/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ora-gold-dark">
                You are here
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-ora-muted">{subtitle}</p>}
        </div>
        {collapsed && <Lock className="h-3.5 w-3.5 shrink-0 text-ora-muted" />}
      </header>
      {!collapsed && <div className="border-t border-ora-sand/50 px-5 py-4">{children}</div>}
    </section>
  );
}

/** A single step in the top progress rail. */
interface StepperItem {
  n: number;
  label: string;
  done: boolean;
  active: boolean;
}

/** Horizontal progress rail across the six prospecting steps. */
export function ProgressStepper({ items }: { items: StepperItem[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-ora-sand/60 bg-ora-white px-3 py-2.5">
      {items.map((it, i) => (
        <div key={it.n} className="flex flex-1 items-center gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                it.done
                  ? 'bg-ora-success text-ora-white'
                  : it.active
                    ? 'bg-ora-gold-dark text-ora-white ring-2 ring-ora-gold/30'
                    : 'bg-ora-cream-dark text-ora-charcoal-light'
              }`}
            >
              {it.done ? <Check className="h-3.5 w-3.5" /> : it.n}
            </span>
            <span
              className={`hidden truncate text-xs sm:inline ${
                it.active ? 'font-semibold text-ora-charcoal' : 'text-ora-muted'
              }`}
            >
              {it.label}
            </span>
          </div>
          {i < items.length - 1 && (
            <span className={`h-px flex-1 ${it.done ? 'bg-ora-success/50' : 'bg-ora-sand/60'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function ConnectionBadge({ status }: { status: ProspectingStreamStatus }) {
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

function Provenance({ source, asOf }: { source: string | null; asOf: string | null }) {
  if (!source && !asOf) return null;
  return (
    <span className="text-[10px] uppercase tracking-wide text-ora-muted">
      {source ?? 'source ?'}
      {asOf ? ` · ${new Date(asOf).toLocaleDateString()}` : ''}
    </span>
  );
}

function aed(value: number | null): string {
  if (value == null) return '—';
  return `AED ${Math.round(value).toLocaleString()}`;
}

const btnPrimary =
  'inline-flex h-9 items-center gap-2 rounded-full bg-ora-charcoal px-4 text-xs font-medium text-ora-white transition hover:bg-[#1f1f1f] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2';
const btnGhost =
  'inline-flex h-9 items-center gap-2 rounded-full border border-ora-sand/70 bg-ora-white px-4 text-xs text-ora-charcoal transition hover:bg-ora-cream-light disabled:opacity-50';
const inputCls =
  'w-full rounded-lg border border-ora-sand/70 bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus:border-ora-gold focus:outline-none';

// ── 0. Own_Subject picker (community → project → cluster) ─────────────────────

export function OwnSubjectPicker({
  catalog,
  selectedCommunityId,
  selectedProjectId,
  selectedClusterId,
  busy,
  onSelectCommunity,
  onSelectProject,
  onSelectCluster,
  onUseCluster,
}: {
  catalog: OwnCatalog;
  selectedCommunityId: string | null;
  selectedProjectId: string | null;
  selectedClusterId: string | null;
  busy: boolean;
  onSelectCommunity: (id: string | null) => void;
  onSelectProject: (id: string | null) => void;
  onSelectCluster: (id: string | null) => void;
  onUseCluster: (cluster: ClusterNode) => void;
}) {
  const cluster =
    catalog.clusters.find((c) => c.id === selectedClusterId) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ora-muted">
        Pick one of ORA&apos;s own communities, projects, and clusters as the
        subject — the comparison parameters are resolved from our own catalog, no
        free-form typing needed.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-ora-charcoal-light">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-ora-gold-dark" /> Community
          </span>
          <select
            className={inputCls}
            value={selectedCommunityId ?? ''}
            onChange={(e) => onSelectCommunity(e.target.value || null)}
          >
            <option value="">Select community…</option>
            {catalog.communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ora-charcoal-light">
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5 text-ora-gold-dark" /> Project
          </span>
          <select
            className={inputCls}
            value={selectedProjectId ?? ''}
            disabled={!selectedCommunityId || catalog.projects.length === 0}
            onChange={(e) => onSelectProject(e.target.value || null)}
          >
            <option value="">
              {selectedCommunityId ? 'Select project…' : 'Pick a community first'}
            </option>
            {catalog.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ora-charcoal-light">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-ora-gold-dark" /> Cluster
          </span>
          <select
            className={inputCls}
            value={selectedClusterId ?? ''}
            disabled={!selectedProjectId || catalog.clusters.length === 0}
            onChange={(e) => onSelectCluster(e.target.value || null)}
          >
            <option value="">
              {selectedProjectId ? 'Select cluster…' : 'Pick a project first'}
            </option>
            {catalog.clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {cluster && (
        <div className="rounded-lg border border-ora-sand/60 bg-ora-cream-light/40 p-3">
          <div className="text-xs font-medium text-ora-charcoal">{cluster.name}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ora-charcoal-light">
            {cluster.segment && (
              <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">{cluster.segment}</span>
            )}
            {(cluster.bedroomsMin != null || cluster.bedroomsMax != null) && (
              <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">
                {cluster.bedroomsMin ?? '?'}–{cluster.bedroomsMax ?? '?'} bed
              </span>
            )}
            {cluster.priceMinAed != null && (
              <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">from {aed(cluster.priceMinAed)}</span>
            )}
            {cluster.totalUnits != null && (
              <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">{cluster.totalUnits} units</span>
            )}
          </div>
          <button
            type="button"
            className={`${btnPrimary} mt-3`}
            disabled={busy}
            onClick={() => onUseCluster(cluster)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Use this cluster &amp; find comparables
          </button>
        </div>
      )}
    </div>
  );
}

// ── 0b. Run batch — autonomous Batch_Run entry (task 10.2) ───────────────────
//
// The autonomous leap on top of the per-prospect flow: point the agent at a
// subject (the picked Bayn cluster OR an ICP filter) and a target count N, then
// kick off `POST /api/prospecting/batches`. This is ADDITIVE — it sits beside
// the guided per-prospect flow and never replaces it. Validation (`400`) and
// cap-exhausted (`409`) errors come back through the bridge's `error` message
// and are surfaced by the caller via the existing toast pattern (Req 1.1, 1.4,
// 1.5).

const TARGET_TYPE_OPTIONS: { value: TargetType; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'company', label: 'Company' },
  { value: 'intermediary', label: 'Intermediary' },
];

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function RunBatchControl({
  clusterId,
  clusterName,
  busy,
  onRun,
}: {
  /** The cluster currently selected in the Own_Subject picker (page state). */
  clusterId: string | null;
  /** Human-readable name of the picked cluster, for the subject summary. */
  clusterName?: string | null;
  busy: boolean;
  /** Kicks off the run; the caller surfaces 400/409 via the toast pattern. */
  onRun: (subject: BatchSubject, targetCount: number) => void;
}) {
  // Subject mode: reuse the picked cluster, or describe an ICP filter inline.
  const [mode, setMode] = useState<'cluster' | 'icp'>('cluster');
  const [targetCount, setTargetCount] = useState('10');

  // ICP filter fields (a client-safe subset of the providers' ProspectFilter).
  const [icpTargetType, setIcpTargetType] = useState<TargetType>('person');
  const [geography, setGeography] = useState('');
  const [titles, setTitles] = useState('');
  const [industries, setIndustries] = useState('');

  const n = Number(targetCount);
  const nValid = Number.isInteger(n) && n > 0;
  const canRun = nValid && (mode === 'icp' || Boolean(clusterId));

  const submit = () => {
    if (mode === 'cluster') {
      // Reuse the picked cluster as the subject (clusterId may be null — the
      // route then rejects with a 400 invalid_subject the caller will toast).
      onRun({ kind: 'cluster', ...(clusterId ? { clusterId } : {}) }, n);
      return;
    }
    const icpFilter: Record<string, unknown> = { targetType: icpTargetType };
    const geo = splitList(geography);
    const tit = splitList(titles);
    const ind = splitList(industries);
    if (geo.length) icpFilter.geography = geo;
    if (tit.length) icpFilter.titles = tit;
    if (ind.length) icpFilter.industries = ind;
    onRun({ kind: 'icp', icpFilter }, n);
  };

  return (
    <section className="rounded-xl border border-ora-gold-dark/30 bg-ora-gold/5">
      <header className="flex items-center gap-2.5 px-5 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ora-gold-dark text-ora-white">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ora-charcoal">Run autonomous batch</h2>
          <p className="text-xs text-ora-muted">
            Point the agent at a subject and a target count — it finds, pre-checks,
            scores, and drafts each prospect for your review.
          </p>
        </div>
      </header>
      <div className="space-y-3 border-t border-ora-gold/20 px-5 py-4">
        {/* Subject mode toggle */}
        <div className="inline-flex rounded-full border border-ora-sand/70 bg-ora-white p-0.5 text-xs">
          <button
            type="button"
            className={`rounded-full px-3 py-1 font-medium transition ${
              mode === 'cluster' ? 'bg-ora-charcoal text-ora-white' : 'text-ora-charcoal-light'
            }`}
            onClick={() => setMode('cluster')}
          >
            Use picked cluster
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1 font-medium transition ${
              mode === 'icp' ? 'bg-ora-charcoal text-ora-white' : 'text-ora-charcoal-light'
            }`}
            onClick={() => setMode('icp')}
          >
            Describe an ICP
          </button>
        </div>

        {mode === 'cluster' ? (
          clusterId ? (
            <div className="rounded-lg border border-ora-sand/60 bg-ora-white px-3 py-2 text-xs text-ora-charcoal">
              Subject:{' '}
              <span className="font-medium">{clusterName || 'selected cluster'}</span>
            </div>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Pick a cluster in the Brief step above, or switch to “Describe an ICP”.
            </p>
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-ora-charcoal-light">
              Target type
              <select
                className={inputCls}
                value={icpTargetType}
                onChange={(e) => setIcpTargetType(e.target.value as TargetType)}
              >
                {TARGET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ora-charcoal-light">
              Geography / feeder markets
              <input
                className={inputCls}
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                placeholder="India, DIFC, KSA"
              />
            </label>
            <label className="text-xs text-ora-charcoal-light">
              Titles / seniority
              <input
                className={inputCls}
                value={titles}
                onChange={(e) => setTitles(e.target.value)}
                placeholder="Founder, Managing Partner, CFO"
              />
            </label>
            <label className="text-xs text-ora-charcoal-light">
              Industries
              <input
                className={inputCls}
                value={industries}
                onChange={(e) => setIndustries(e.target.value)}
                placeholder="Venture Capital, Family Office"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-ora-charcoal-light">
            Target count (N)
            <input
              className={`${inputCls} max-w-[7rem]`}
              type="number"
              min={1}
              max={500}
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
              placeholder="10"
            />
          </label>
          <button type="button" className={btnPrimary} disabled={busy || !canRun} onClick={submit}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {busy ? 'Starting…' : 'Run batch'}
          </button>
          {!nValid && (
            <span className="text-[11px] text-ora-error">Enter a positive whole number.</span>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 1. Brief intake ─────────────────────────────────────────────────────────

export function BriefIntake({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (spec: BriefSpec) => void;
}) {
  const [area, setArea] = useState('');
  const [segment, setSegment] = useState<BriefSpec['segment'] | ''>('');
  const [unitType, setUnitType] = useState<BriefSpec['unitType'] | ''>('');
  const [bedrooms, setBedrooms] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [features, setFeatures] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          area: area.trim() || undefined,
          segment: segment || undefined,
          unitType: unitType || undefined,
          bedrooms: bedrooms ? Number(bedrooms) : undefined,
          priceMinAed: priceMin ? Number(priceMin) : undefined,
          priceMaxAed: priceMax ? Number(priceMax) : undefined,
          features: features
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean),
        });
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <label className="text-xs text-ora-charcoal-light">
        Area / community
        <input className={inputCls} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Palm Jumeirah" />
      </label>
      <label className="text-xs text-ora-charcoal-light">
        Segment
        <select className={inputCls} value={segment} onChange={(e) => setSegment(e.target.value as BriefSpec['segment'])}>
          <option value="">Any</option>
          <option value="ultra_luxury">Ultra luxury</option>
          <option value="luxury">Luxury</option>
          <option value="premium">Premium</option>
          <option value="mid">Mid</option>
        </select>
      </label>
      <label className="text-xs text-ora-charcoal-light">
        Unit type
        <select className={inputCls} value={unitType} onChange={(e) => setUnitType(e.target.value as BriefSpec['unitType'])}>
          <option value="">Any</option>
          <option value="apartment">Apartment</option>
          <option value="villa">Villa</option>
          <option value="townhouse">Townhouse</option>
          <option value="penthouse">Penthouse</option>
          <option value="office">Office</option>
        </select>
      </label>
      <label className="text-xs text-ora-charcoal-light">
        Bedrooms
        <input className={inputCls} type="number" min={0} max={20} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} placeholder="4" />
      </label>
      <label className="text-xs text-ora-charcoal-light">
        Min price (AED)
        <input className={inputCls} type="number" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="30000000" />
      </label>
      <label className="text-xs text-ora-charcoal-light">
        Max price (AED)
        <input className={inputCls} type="number" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="50000000" />
      </label>
      <label className="text-xs text-ora-charcoal-light sm:col-span-2 lg:col-span-3">
        Features (comma-separated)
        <input className={inputCls} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="sea view, branded, private beach" />
      </label>
      <div className="sm:col-span-2 lg:col-span-3">
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Find comparables &amp; propose buyers
        </button>
      </div>
    </form>
  );
}

// ── 2. Comparables ────────────────────────────────────────────────────────────

function pct(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * The Area_Trend headline (S7 increment, Req 14.7): avg price/sqft, YoY, ROI,
 * and volume for the area/segment, each figure carrying the price-index row's
 * `source` + `as_of` stamp (CC-Provenance). Built from the `market_comps`
 * price-index rows returned by the bridge — never model-computed.
 */
export function AreaTrendHeadline({ rows }: { rows: AreaTrendRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {rows.slice(0, 3).map((r) => (
        <div
          key={r.recordId}
          className="rounded-lg border border-ora-gold/30 bg-ora-gold/5 p-3"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-ora-charcoal">
            <TrendingUp className="h-4 w-4 stroke-[1.5] text-ora-gold-dark" />
            Area trend — {r.areaName ?? 'area'}
            {r.segment ? ` · ${r.segment}` : ''}
            {r.period ? ` · ${r.period}` : ''}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-ora-muted">Price / sqft</dt>
              <dd className="text-sm font-medium text-ora-charcoal">{aed(r.avgPricePerSqft)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-ora-muted">YoY change</dt>
              <dd className="text-sm font-medium text-ora-charcoal">{pct(r.yoyPct)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-ora-muted">ROI</dt>
              <dd className="text-sm font-medium text-ora-charcoal">{pct(r.roiPct)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-ora-muted">Volume</dt>
              <dd className="text-sm font-medium text-ora-charcoal">
                {r.volume != null ? r.volume.toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
          <div className="mt-2">
            <Provenance source={r.source} asOf={r.asOf} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ComparablesPanel({
  comparables,
  unconfigured,
  areaTrend = [],
}: {
  comparables: Comparable[];
  unconfigured: boolean;
  areaTrend?: AreaTrendRow[];
}) {
  if (unconfigured && comparables.length === 0) {
    return (
      <>
        <AreaTrendHeadline rows={areaTrend} />
        <p className="text-xs text-ora-muted">
          No market comparables are configured yet — proceeding with a brief-only,
          low-evidence hypothesis. Wire the market catalog (Property Monitor / Dubai
          Pulse) to ground the comparison.
        </p>
      </>
    );
  }
  if (comparables.length === 0) {
    return (
      <>
        <AreaTrendHeadline rows={areaTrend} />
        <p className="text-xs text-ora-muted">No comparable projects matched this brief.</p>
      </>
    );
  }
  return (
    <>
      <AreaTrendHeadline rows={areaTrend} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {comparables.map((c) => (
        <div key={c.marketProjectId} className="rounded-lg border border-ora-sand/60 bg-ora-cream-light/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 stroke-[1.5] text-ora-gold-dark" />
              <div>
                <div className="text-sm font-medium text-ora-charcoal">{c.name}</div>
                <div className="text-[11px] text-ora-muted">
                  {c.communityName ?? '—'} · {c.segment ?? 'segment ?'}
                </div>
              </div>
            </div>
            <span className="rounded-full bg-ora-gold/15 px-2 py-0.5 text-[10px] font-semibold text-ora-gold-dark">
              {(c.score * 100).toFixed(0)}% match
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Stat label="Recent sale" value={aed(c.stats.recentSalePriceAed.value)} fig={c.stats.recentSalePriceAed} />
            <Stat
              label="Price / sqft"
              value={c.stats.avgPricePerSqft.value != null ? aed(c.stats.avgPricePerSqft.value) : '—'}
              fig={c.stats.avgPricePerSqft}
            />
            <Stat
              label="Velocity (12m)"
              value={c.stats.velocitySalesLast12m.value != null ? String(c.stats.velocitySalesLast12m.value) : '—'}
              fig={c.stats.velocitySalesLast12m}
            />
            <Stat label="Transactions" value={String(c.stats.txnCount)} fig={null} />
          </dl>
          {c.stats.buyerSegmentMix.value.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-ora-muted">Buyer mix (aggregate)</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.stats.buyerSegmentMix.value.map((b) => (
                  <span key={b.segment} className="rounded-full bg-ora-sand/40 px-2 py-0.5 text-[10px] text-ora-charcoal-light">
                    {b.segment} {b.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2">
            <Provenance source={c.source} asOf={c.asOf} />
          </div>
        </div>
      ))}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  fig,
}: {
  label: string;
  value: string;
  fig: { source: string | null; asOf: string | null } | null;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ora-muted">{label}</dt>
      <dd className="text-sm font-medium text-ora-charcoal">{value}</dd>
      {fig && <Provenance source={fig.source} asOf={fig.asOf} />}
    </div>
  );
}

// ── 3. Buyer_Hypothesis editor ────────────────────────────────────────────────

export function HypothesisEditor({
  hypothesis,
  busy,
  onSave,
  onSearch,
}: {
  hypothesis: BuyerHypothesis;
  busy: boolean;
  onSave: (h: BuyerHypothesis) => void;
  onSearch: () => void;
}) {
  const [draft, setDraft] = useState<BuyerHypothesis>(hypothesis);
  const editList = (key: keyof BuyerHypothesis) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value.split(',').map((s) => s.trim()).filter(Boolean) }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-ora-muted">Confidence</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            draft.confidence === 'high'
              ? 'bg-green-50 text-green-700'
              : draft.confidence === 'medium'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-gray-100 text-gray-600'
          }`}
        >
          {draft.confidence}
        </span>
      </div>
      <ListField label="Buyer segments" value={draft.segments} onChange={editList('segments')} />
      <ListField label="Feeder markets" value={draft.feederMarkets} onChange={editList('feederMarkets')} />
      <ListField label="Titles / seniority" value={draft.titles} onChange={editList('titles')} />
      <ListField label="Wealth signals" value={draft.wealthSignals} onChange={editList('wealthSignals')} />

      {draft.evidence.length > 0 && (
        <details className="rounded-lg border border-ora-sand/60 bg-ora-cream-light/40 p-3">
          <summary className="cursor-pointer text-xs font-medium text-ora-charcoal">
            Evidence ({draft.evidence.length}) — SQL-grounded
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-ora-charcoal-light">
            {draft.evidence.map((e, i) => (
              <li key={i}>
                · {e.claim}{' '}
                <span className="text-ora-muted">[{e.sourceTable} · {new Date(e.asOf).toLocaleDateString()}]</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} disabled={busy} onClick={() => onSave(draft)}>
          <Pencil className="h-3.5 w-3.5" /> Save edits
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={() => {
            onSave(draft);
            onSearch();
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search targets
        </button>
      </div>
    </div>
  );
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs text-ora-charcoal-light">
      {label}
      <input className={inputCls} defaultValue={value.join(', ')} onBlur={(e) => onChange(e.target.value)} placeholder="comma-separated" />
    </label>
  );
}

// ── 4. Candidates → record ─────────────────────────────────────────────────────

export function CandidatesPanel({
  candidates,
  recordingId,
  onRecord,
}: {
  candidates: ProviderCandidate[];
  recordingId: string | null;
  onRecord: (c: ProviderCandidate) => void;
}) {
  if (candidates.length === 0) {
    return (
      <p className="text-xs text-ora-muted">
        No candidates yet. Run a search — results stream in from the configured
        Account/Person providers (Apollo, PDL, Cognism, Crunchbase). Providers
        without credentials are skipped without failing the search.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-ora-sand/40">
      {candidates.map((c, i) => {
        const key = c.email || c.sourceRef || `${c.displayName}-${i}`;
        return (
          <li key={key} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ora-charcoal">
                {c.displayName || c.companyName || 'Unnamed'}
              </div>
              <div className="truncate text-[11px] text-ora-muted">
                {[c.title, c.companyName, c.country].filter(Boolean).join(' · ') || c.targetType}
                {' · '}
                <span className="uppercase tracking-wide">{c.sourceProvider}</span>
              </div>
            </div>
            <button type="button" className={btnGhost} disabled={recordingId === key} onClick={() => onRecord(c)}>
              {recordingId === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              Record
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── 5. Recorded targets ─────────────────────────────────────────────────────

const TARGET_STATUS_STYLE: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700',
  researching: 'bg-violet-50 text-violet-700',
  qualified: 'bg-amber-50 text-amber-700',
  promoted: 'bg-green-50 text-green-700',
  discarded: 'bg-gray-100 text-gray-500',
  opted_out: 'bg-red-50 text-red-700',
};

export function TargetsPanel({
  targets,
  selectedId,
  pendingId,
  onSelect,
  onEnrich,
  onPromote,
  onDraft,
}: {
  targets: TargetRow[];
  selectedId: string | null;
  pendingId: string | null;
  onSelect: (t: TargetRow) => void;
  onEnrich: (t: TargetRow) => void;
  onPromote: (t: TargetRow) => void;
  onDraft: (t: TargetRow) => void;
}) {
  if (targets.length === 0) {
    return <p className="text-xs text-ora-muted">No recorded targets yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {targets.map((t) => {
        const busy = pendingId === t.id;
        const selected = selectedId === t.id;
        return (
          <li
            key={t.id}
            className={`rounded-lg border p-3 ${selected ? 'border-ora-gold/50 bg-ora-cream' : 'border-ora-sand/60 bg-ora-white'}`}
          >
            <button type="button" onClick={() => onSelect(t)} className="flex w-full items-center justify-between gap-2 text-left">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ora-charcoal">
                  {t.displayName || t.companyName || 'Unnamed target'}
                </div>
                <div className="truncate text-[11px] text-ora-muted">
                  {[t.title, t.companyName, t.country].filter(Boolean).join(' · ') || t.targetType}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TARGET_STATUS_STYLE[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {t.status}
              </span>
            </button>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btnGhost} disabled={busy} onClick={() => onEnrich(t)}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Enrich
              </button>
              <button type="button" className={btnGhost} disabled={busy || t.status === 'promoted'} onClick={() => onPromote(t)}>
                <ArrowUpRight className="h-3.5 w-3.5" /> {t.status === 'promoted' ? 'Promoted' : 'Promote to Lead'}
              </button>
              <button type="button" className={btnGhost} disabled={busy} onClick={() => onDraft(t)}>
                <Pencil className="h-3.5 w-3.5" /> Draft outreach
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── 6. Outreach draft → approve → send ────────────────────────────────────────

/** "Already in Salesforce?" banner shown above the outreach composer. */
function CrmStatusBanner({
  checking,
  result,
}: {
  checking?: boolean;
  result?: CrmCheckResult | null;
}) {
  if (checking) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ora-sand/60 bg-ora-cream-light/60 px-3 py-2 text-xs text-ora-charcoal-light">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Salesforce for this prospect…
      </div>
    );
  }
  if (!result) return null;

  if (!result.configured) {
    return (
      <div className="rounded-lg border border-ora-sand/60 bg-ora-cream-light/60 px-3 py-2 text-xs text-ora-muted">
        Salesforce not configured — proceeding without a CRM check.
      </div>
    );
  }

  if (result.found) {
    const m = result.matches[0];
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <div className="flex items-center gap-1.5 font-semibold">
          <ShieldAlert className="h-3.5 w-3.5" />
          Already in Salesforce — not a cold prospect
        </div>
        <p className="mt-1 leading-relaxed">
          {m.name ?? 'This contact'} exists as a <b>{m.object}</b>
          {m.status ? ` (${m.status})` : ''}
          {m.company ? ` at ${m.company}` : ''}
          {m.owner ? `, owned by ${m.owner}` : ''}
          {m.lastActivity ? `. Last activity ${new Date(m.lastActivity).toLocaleDateString()}` : ''}.
          {result.matches.length > 1 ? ` +${result.matches.length - 1} more match(es).` : ''}
        </p>
        <p className="mt-1 text-[11px] text-amber-800">
          Recommend a warm follow-up via the existing owner instead of cold outreach.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
      <ShieldCheck className="h-3.5 w-3.5" /> Not in Salesforce — clear for first-touch outreach.
    </div>
  );
}

/**
 * Defensive guard: if an outreach value arrives as a raw `{"subject","body"}`
 * JSON blob (e.g. a draft saved before the server-side parser was hardened, or
 * a model reply that slipped through), pull out the requested field so the
 * textarea/subject input never shows JSON. Plain text passes through untouched.
 */
function cleanOutreachField(
  raw: string | null | undefined,
  field: 'subject' | 'body',
): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!(t.startsWith('{') && t.includes('"body"'))) return raw;
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    if (typeof obj[field] === 'string') return obj[field] as string;
  } catch {
    // Tolerant extraction for JSON with raw newlines in the body.
    const m = t.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (m) {
      return m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return raw;
}

export function OutreachPanel({
  target,
  draft,
  approval,
  busy,
  crmCheck,
  crmChecking,
  onCreateDraft,
  onChangeDraft,
  onCompose,
  onApprove,
  onSend,
}: {
  target: TargetRow | null;
  draft: OutreachDraftRow | null;
  approval: { token: string; expiresAt: string } | null;
  busy: boolean;
  crmCheck?: CrmCheckResult | null;
  crmChecking?: boolean;
  onCreateDraft: (channel: Channel, language: Language, subject: string, body: string, grounding?: GroundingClaim[]) => void;
  onChangeDraft: (subject: string, body: string) => void;
  onCompose: (channel: Channel, language: Language) => Promise<ComposedDraft>;
  onApprove: () => void;
  onSend: () => void;
}) {
  const [channel, setChannel] = useState<Channel>('email');
  const [language, setLanguage] = useState<Language>('en');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [composing, setComposing] = useState(false);
  const [grounding, setGrounding] = useState<GroundingClaim[]>([]);
  const [composeError, setComposeError] = useState<string | null>(null);

  if (!target) {
    return <p className="text-xs text-ora-muted">Select a recorded target to draft outreach.</p>;
  }

  const handleCompose = async () => {
    setComposing(true);
    setComposeError(null);
    try {
      const result = await onCompose(channel, language);
      setSubject(cleanOutreachField(result.subject, 'subject'));
      setBody(cleanOutreachField(result.body, 'body'));
      setGrounding(result.grounding ?? []);
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'AI draft failed');
    } finally {
      setComposing(false);
    }
  };

  const crmBanner = <CrmStatusBanner checking={crmChecking} result={crmCheck} />;

  // No draft yet — show the composer that creates an editable, UNSENT draft.
  if (!draft) {
    const channelNoun = channel === 'message' ? 'call script' : channel;
    return (
      <div className="space-y-3">
        {crmBanner}
        <div className="flex gap-2">
          <select className={`${inputCls} max-w-[8rem]`} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="message">Call script</option>
          </select>
          <select className={`${inputCls} max-w-[6rem]`} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="en">EN</option>
            <option value="ar">AR</option>
          </select>
          <button
            type="button"
            className={btnPrimary}
            disabled={composing}
            onClick={handleCompose}
            title="Let the AI draft a personalized, grounded message from the project, this prospect, and comparable sales"
          >
            {composing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {composing ? 'Drafting…' : `Generate ${channelNoun} with AI`}
          </button>
        </div>
        {composeError && <p className="text-xs text-red-600">{composeError}</p>}
        {channel === 'email' && (
          <input className={inputCls} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        )}
        <textarea
          className={`${inputCls} min-h-[260px] leading-relaxed`}
          rows={12}
          placeholder={`Click "Generate ${channelNoun} with AI" to draft a personalized message for ${target.displayName || target.companyName} grounded in comparable sales — then edit before saving.`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {grounding.length > 0 && (
          <div className="rounded-lg border border-ora-sand/60 bg-ora-cream-light/40 p-2 text-[11px] text-ora-charcoal-light">
            <span className="font-medium text-ora-charcoal">AI-grounded:</span>{' '}
            {grounding.length} market figure(s) pinned to SQL records.
          </div>
        )}
        <button type="button" className={btnPrimary} disabled={busy || !body.trim()} onClick={() => onCreateDraft(channel, language, subject, body, grounding)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} Save editable draft
        </button>
      </div>
    );
  }

  const sent = draft.status === 'sent';
  const suppressed = draft.status === 'suppressed';

  return (
    <div className="space-y-3">
      {crmBanner}
      <div className="flex items-center gap-2 text-[11px] text-ora-muted">
        <span className="uppercase tracking-wide">{draft.channel} · {draft.language}</span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            sent ? 'bg-green-50 text-green-700' : suppressed ? 'bg-red-50 text-red-700' : draft.status === 'approved' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {draft.status}
        </span>
      </div>
      {draft.channel === 'email' && (
        <input className={inputCls} defaultValue={cleanOutreachField(draft.subject, 'subject')} disabled={sent} onBlur={(e) => onChangeDraft(e.target.value, body || draft.body)} placeholder="Subject" />
      )}
      <textarea
        className={`${inputCls} min-h-[260px] leading-relaxed`}
        rows={12}
        defaultValue={cleanOutreachField(draft.body, 'body')}
        disabled={sent}
        onChange={(e) => setBody(e.target.value)}
        onBlur={(e) => onChangeDraft(draft.subject ?? '', e.target.value)}
      />

      {draft.grounding.length > 0 && (
        <div className="rounded-lg border border-ora-sand/60 bg-ora-cream-light/40 p-2 text-[11px] text-ora-charcoal-light">
          <span className="font-medium text-ora-charcoal">Grounding manifest:</span>{' '}
          {draft.grounding.length} claim(s) pinned to SQL records.
        </div>
      )}

      {sent ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          <ShieldCheck className="h-3.5 w-3.5" /> Sent {draft.sentAt ? `· ${new Date(draft.sentAt).toLocaleString()}` : ''}
        </div>
      ) : suppressed ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Suppressed — the target is on the do-not-contact list.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnGhost} disabled={busy} onClick={onApprove}>
            <ShieldCheck className="h-3.5 w-3.5" /> {approval ? 'Re-approve' : 'Approve'}
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !approval} onClick={onSend} title={!approval ? 'Approve first to unlock send' : 'Send now'}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
          </button>
          {approval && (
            <span className="text-[10px] text-ora-muted">
              Approval token valid until {new Date(approval.expiresAt).toLocaleTimeString()} — single use.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export type { TargetType };

// ── 7. Approval Queue / Review Inbox (task 10.3) ─────────────────────────────
//
// The human review surface for an autonomous Batch_Run's output: every PENDING,
// cold-eligible Queued_Item the agent drafted, presented WITH its grounded draft
// content (editable), channel + language, deterministic Fit_Score + rationale,
// and lawful-basis provenance (Req 4.1, 10.1). The rep edits a draft
// (PUT /queue/:id), approves (POST /queue/:id/approve), or rejects
// (POST /queue/:id/reject) one item at a time, or multi-selects and
// bulk-approves a set (POST /queue/bulk-approve). NOTHING sends without one of
// these explicit human actions (CC-HITL). Presentational only — every fetch +
// the toast accounting live in `page.tsx`.

/** Format the queue item's `fitScore` (a numeric column → string|null) as a %. */
function formatFitScore(score: string | null): string {
  if (score === null || score === '') return '—';
  const n = Number(score);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

/** A single Review-Inbox row with its own edit state (subject/body draft). */
function ReviewInboxItem({
  item,
  selected,
  busy,
  onToggleSelect,
  onEdit,
  onApprove,
  onReject,
}: {
  item: QueueItemRow;
  selected: boolean;
  busy: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (id: string, subject: string, body: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isEmail = item.draftChannel === 'email';
  const [subject, setSubject] = useState(item.draftSubject ?? '');
  const [body, setBody] = useState(item.draftBody ?? '');

  // Dirty when the local edit diverges from the persisted draft content.
  const dirty =
    body !== (item.draftBody ?? '') ||
    (isEmail && subject !== (item.draftSubject ?? ''));

  const name = item.targetDisplayName || item.targetCompanyName || 'Prospect';
  const company =
    item.targetCompanyName && item.targetCompanyName !== item.targetDisplayName
      ? item.targetCompanyName
      : null;

  return (
    <li className="rounded-xl border border-ora-sand/60 bg-ora-white p-4">
      <div className="flex items-start gap-3">
        {/* Multi-select for bulk-approve */}
        <button
          type="button"
          aria-label={selected ? 'Deselect item' : 'Select item'}
          aria-pressed={selected}
          className="mt-0.5 shrink-0 text-ora-charcoal-light transition hover:text-ora-charcoal"
          onClick={() => onToggleSelect(item.id)}
        >
          {selected ? (
            <CheckSquare className="h-4 w-4 text-ora-gold-dark" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          {/* Header: name, channel + language, fit score */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ora-charcoal">{name}</span>
            {company && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ora-muted">
                <Building2 className="h-3 w-3" />
                {company}
              </span>
            )}
            {item.targetTitle && (
              <span className="text-[11px] text-ora-muted">· {item.targetTitle}</span>
            )}
            {item.draftChannel && (
              <span className="rounded-full bg-ora-cream-dark px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ora-charcoal-light">
                {item.draftChannel === 'message' ? 'call script' : item.draftChannel}
                {item.draftLanguage ? ` · ${item.draftLanguage}` : ''}
              </span>
            )}
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-ora-gold/15 px-2 py-0.5 text-[10px] font-semibold text-ora-gold-dark"
              title={item.fitRationale?.summary ?? 'Deterministic fit score'}
            >
              <Gauge className="h-3 w-3" /> {formatFitScore(item.fitScore)} fit
            </span>
          </div>

          {/* Fit rationale summary (Req 2.4) */}
          {item.fitRationale?.summary && (
            <p className="mt-1 text-[11px] leading-snug text-ora-charcoal-light">
              {item.fitRationale.summary}
            </p>
          )}

          {/* Editable draft (Req 4.1, 4.2) */}
          <div className="mt-3 space-y-2">
            {isEmail && (
              <input
                className={inputCls}
                value={subject}
                placeholder="Subject"
                disabled={busy}
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
            <textarea
              className={`${inputCls} min-h-[110px]`}
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {/* Lawful-basis provenance (Req 4.1, 10.1 — CC-Provenance) */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-ora-muted">
            <ShieldQuestion className="h-3 w-3 text-ora-gold-dark" />
            <span className="font-medium uppercase tracking-wide text-ora-charcoal-light">
              Lawful basis
            </span>
            <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">
              {item.lawfulBasis ?? 'not recorded'}
            </span>
            {item.dataSource && (
              <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">
                via {item.dataSource}
              </span>
            )}
            {item.acquiredAt && (
              <span className="rounded-full bg-ora-sand/40 px-2 py-0.5">
                acquired {new Date(item.acquiredAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Per-item actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnGhost}
              disabled={busy || !dirty}
              onClick={() => onEdit(item.id, subject, body)}
              title={dirty ? 'Save your edits to the draft' : 'No changes to save'}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save edits
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={() => onApprove(item.id)}
              title="Approve and send under your identity"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Approve &amp; send
            </button>
            <button
              type="button"
              className={`${btnGhost} text-ora-error hover:bg-red-50`}
              disabled={busy}
              onClick={() => onReject(item.id)}
              title="Reject this draft — nothing is sent"
            >
              <ThumbsDown className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function ReviewInboxPanel({
  items,
  selectedIds,
  busyId,
  bulkBusy,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onApprove,
  onReject,
  onBulkApprove,
}: {
  items: QueueItemRow[];
  /** Ids currently multi-selected for bulk-approve. */
  selectedIds: Set<string>;
  /** Id of the item with an in-flight single-item action, or null. */
  busyId: string | null;
  /** True while a bulk-approve request is in flight. */
  bulkBusy: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string, subject: string, body: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onBulkApprove: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Inbox className="h-7 w-7 text-ora-muted" />
        <p className="text-xs text-ora-muted">
          No drafts awaiting review. Run an autonomous batch above — the agent&apos;s
          cold-eligible drafts land here for your approval.
        </p>
      </div>
    );
  }

  const allSelected = items.every((it) => selectedIds.has(it.id));
  const selectedCount = items.filter((it) => selectedIds.has(it.id)).length;

  return (
    <div className="space-y-3">
      {/* Bulk action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-ora-charcoal-light transition hover:text-ora-charcoal"
          onClick={onToggleAll}
        >
          {allSelected ? (
            <CheckSquare className="h-4 w-4 text-ora-gold-dark" />
          ) : (
            <Square className="h-4 w-4" />
          )}
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span className="text-[11px] text-ora-muted">
          {selectedCount} of {items.length} selected
        </span>
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          disabled={bulkBusy || selectedCount === 0}
          onClick={onBulkApprove}
          title="Approve and send every selected draft — per-item caps and opt-outs still apply"
        >
          {bulkBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" />
          )}
          Bulk approve ({selectedCount})
        </button>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <ReviewInboxItem
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            busy={busyId === item.id || bulkBusy}
            onToggleSelect={onToggleSelect}
            onEdit={onEdit}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Persisted Agent_Activity_Log (task 10.4) ─────────────────────────────────
//
// The on-demand fallback for the live SSE progress stream. Under `next dev` the
// SSE connection does not stay open (the documented serverless caveat), so the
// rep can read the PERSISTED Agent_Activity_Log for a run here (Req 3.5). The
// route returns the ordered entries (by monotonic `seq`); a retrieval failure
// is surfaced explicitly as an error banner rather than an empty success
// (Req 3.6). Every entry is privacy-safe — internal ids only, never a raw phone
// (CC-Privacy).

/** Per-action label + tone for an activity entry's verb chip. */
const ACTIVITY_ACTION_META: Record<BatchActivityAction, { label: string; tone: string }> = {
  discovered: { label: 'Discovered', tone: 'bg-ora-cream-dark text-ora-charcoal-light' },
  crm_checked: { label: 'CRM checked', tone: 'bg-blue-50 text-blue-700' },
  scored: { label: 'Scored', tone: 'bg-ora-gold/15 text-ora-gold-dark' },
  eligibility: { label: 'Eligibility', tone: 'bg-ora-cream-dark text-ora-charcoal-light' },
  drafted: { label: 'Drafted', tone: 'bg-green-50 text-green-700' },
  skipped: { label: 'Skipped', tone: 'bg-amber-50 text-amber-700' },
  warm_path: { label: 'Warm path', tone: 'bg-purple-50 text-purple-700' },
};

function ActivityActionChip({ action }: { action: BatchActivityAction }) {
  const meta = ACTIVITY_ACTION_META[action] ?? {
    label: action,
    tone: 'bg-ora-cream-dark text-ora-charcoal-light',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
      {meta.label}
    </span>
  );
}

export function BatchActivityLog({
  runId,
  entries,
  busy,
  error,
  loaded,
  onView,
}: {
  /** The run whose log the affordance reads (the latest started run by default). */
  runId: string | null;
  /** The persisted, ordered (`seq`) entries returned by the activity route. */
  entries: BatchActivityEntry[];
  busy: boolean;
  /** A retrieval error surfaced verbatim (Req 3.6) — never swallowed. */
  error: string | null;
  /** True once a fetch has been attempted (distinguishes "not loaded" from "empty"). */
  loaded: boolean;
  /** Reads `GET /api/prospecting/batches/:id/activity` on demand. */
  onView: (runId?: string | null) => void;
}) {
  const shortId = runId ? `${runId.slice(0, 8)}…` : null;
  return (
    <section className="rounded-xl border border-ora-sand/60 bg-ora-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-ora-sand/50 px-4 py-2.5">
        <ScrollText className="h-4 w-4 text-ora-gold-dark" />
        <h2 className="text-sm font-semibold text-ora-charcoal">Activity log</h2>
        {shortId && (
          <span className="rounded-full bg-ora-cream-dark px-2 py-0.5 font-mono text-[10px] text-ora-charcoal-light">
            run {shortId}
          </span>
        )}
        <button
          type="button"
          className={`${btnGhost} ml-auto`}
          disabled={busy || !runId}
          onClick={() => onView(runId)}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : loaded ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <ScrollText className="h-3.5 w-3.5" />
          )}
          {loaded ? 'Refresh log' : 'View activity log'}
        </button>
      </header>
      <div className="px-4 py-3">
        {!runId ? (
          <p className="text-xs text-ora-muted">
            Start an autonomous batch run to view its persisted activity log here —
            handy when the live stream is unavailable.
          </p>
        ) : error ? (
          // Req 3.6: a retrieval failure is shown explicitly, never as an empty list.
          <div className="flex items-start gap-2 rounded-lg border border-ora-error/30 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ora-error" />
            <div className="flex-1">
              <p className="font-medium">Could not retrieve the activity log.</p>
              <p className="mt-0.5 leading-snug">{error}</p>
            </div>
          </div>
        ) : busy && entries.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-ora-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the persisted log…
          </p>
        ) : loaded && entries.length === 0 ? (
          <p className="text-xs text-ora-muted">
            No activity recorded for this run yet.
          </p>
        ) : entries.length > 0 ? (
          <ol className="max-h-72 space-y-1.5 overflow-y-auto">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-2 border-b border-ora-sand/30 pb-1.5 text-xs text-ora-charcoal-light last:border-0 last:pb-0"
              >
                <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[10px] text-ora-muted">
                  {e.seq}
                </span>
                <ActivityActionChip action={e.action} />
                <span className="flex-1 leading-snug">
                  {e.reason ? e.reason.replace(/_/g, ' ') : '—'}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ora-muted">
                  {new Date(e.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-ora-muted">
            Read the ordered, persisted record of what the agent did on this run.
          </p>
        )}
      </div>
    </section>
  );
}
