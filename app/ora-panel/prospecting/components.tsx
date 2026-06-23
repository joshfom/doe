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
  Lightbulb,
  Info,
  Users,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import type {
  BriefSpec,
  BuyerHypothesis,
  Comparable,
  ProviderCandidate,
  ProviderSearchStatus,
  TargetRow,
  OutreachDraftRow,
  Channel,
  Language,
  ComposedDraft,
  GroundingClaim,
  CrmCheckResult,
  TargetType,
  OwnCatalog,
  AreaTrendRow,
  BatchSubject,
  QueueItemRow,
  BatchActivityEntry,
  BatchActivityAction,
  SequenceRow,
  SequenceMode,
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

/**
 * Top-level workspace mode switch: separate the GUIDED per-prospect flow from
 * the AUTONOMOUS batch so the rep faces one mental model at a time instead of
 * two competing workflows stacked on a single long screen.
 */
export function WorkspaceModeToggle({
  mode,
  onChange,
}: {
  mode: 'guided' | 'autonomous' | 'sequences';
  onChange: (m: 'guided' | 'autonomous' | 'sequences') => void;
}) {
  const opts = [
    { id: 'guided', icon: Layers, title: 'Guided', sub: 'One prospect at a time' },
    { id: 'autonomous', icon: Bot, title: 'Autonomous batch', sub: 'Agent runs a batch → you review' },
    { id: 'sequences', icon: Rocket, title: 'Sequences', sub: 'Named campaigns running in the background' },
  ] as const;
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-ora-sand/60 bg-ora-white p-1.5 sm:grid-cols-3">
      {opts.map((o) => {
        const active = mode === o.id;
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-left transition ${
              active ? 'bg-ora-charcoal text-ora-white' : 'text-ora-charcoal hover:bg-ora-cream-light'
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-ora-gold' : 'text-ora-gold-dark'}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className={`block text-[11px] ${active ? 'text-ora-white/70' : 'text-ora-muted'}`}>
                {o.sub}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Contextual help sidebar ───────────────────────────────────────────────────
//
// New reps don't know what "comparables", "buyer hypothesis", or "cold-eligible"
// mean. The StepGuide sits in a sticky right rail and explains — in plain
// language — what the section the rep is currently on does, what to do next, and
// what to expect. The content swaps as the active step changes, so the workspace
// teaches itself. Pure presentational; no data fetching.

interface GuideContent {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  intro: string;
  /** Short, imperative "what to do here" bullets. */
  todo: string[];
  /** Optional "good to know" footnote. */
  note?: string;
}

/** Per-step guidance for the GUIDED, one-prospect-at-a-time flow. */
const GUIDED_GUIDES: Record<number, GuideContent> = {
  1: {
    icon: MapPin,
    eyebrow: 'Step 1 of 5 · Brief',
    title: 'Tell ORA what you’re selling',
    intro:
      'This is the starting point. Pick the ORA project you’re selling and ORA builds everything else around it — comparable sales, likely buyers, and a first message.',
    todo: [
      'Choose a Project, then a Cluster. That’s enough to continue.',
      'Add the unit type + bedrooms (and price, if you have it).',
      'Press “Run market research” to pull comparable sold units.',
    ],
    note: 'Not an ORA project? Switch to “Describe it manually” and type the area, price, and unit type instead.',
  },
  2: {
    icon: TrendingUp,
    eyebrow: 'Step 2 of 5 · Market',
    title: 'Comparable sold units near your property',
    intro:
      'Market research: recent sales of similar properties at a similar price, with the area trend. This is the concrete evidence the agent uses to understand what you’re selling.',
    todo: [
      'Scan the match %, recent sale price, and price-per-sqft.',
      'Tick the closest matches — the agent uses those to build the buyer profile and pitch.',
      'Press “Build buyer profile from selected” to carry them forward.',
    ],
    note: 'Live = current market data. Representative = sample data, shown when the trial limit is hit (same set each time).',
  },
  3: {
    icon: Users,
    eyebrow: 'Step 3 of 5 · Buyer',
    title: 'Who is most likely to buy',
    intro:
      'Based on who actually bought the comparable properties, ORA proposes a buyer profile: segments, feeder markets, job titles, and wealth signals. It’s a starting guess — you’re in control.',
    todo: [
      'Read the proposed profile and adjust anything that doesn’t fit.',
      'Add or remove titles and markets — these drive the people search.',
      'Press “Search targets” when it looks right.',
    ],
    note: 'Confidence reflects how much real sales evidence backs the guess.',
  },
  4: {
    icon: Search,
    eyebrow: 'Step 4 of 5 · Prospects',
    title: 'Find prospects to reach out to',
    intro:
      'ORA searches buyer databases (Apollo and others) for real people matching the profile built from your selected comparables. Save the ones worth pursuing to your shortlist.',
    todo: [
      'Press “Record” on a prospect to add them to your shortlist.',
      'Pick a shortlisted prospect to draft outreach for them.',
      'ORA auto-checks Salesforce so you don’t cold-contact an existing client.',
    ],
    note: 'If the trial limit is hit, you’ll see representative prospects — clearly labelled and cached.',
  },
  5: {
    icon: Send,
    eyebrow: 'Step 5 of 5 · Outreach',
    title: 'Draft, approve, and send',
    intro:
      'ORA writes a personalized first message grounded in the real market figures you just saw. You always review before anything leaves.',
    todo: [
      'Pick a channel (email, WhatsApp, call script) and language, then generate.',
      'Edit the draft until it sounds like you.',
      'Approve to unlock sending — nothing sends until you do.',
    ],
    note: 'If the prospect is already in Salesforce, ORA suggests a warm follow-up instead of cold outreach.',
  },
};

/** Guidance for the AUTONOMOUS batch flow (single, mode-level explainer). */
const AUTONOMOUS_GUIDE: GuideContent = {
  icon: Bot,
  eyebrow: 'Autonomous batch',
  title: 'Let the agent work a whole list',
  intro:
    'Point ORA at a subject and a number. It finds that many buyers, checks each against Salesforce, scores how well they fit, and drafts outreach — all on its own. The results land in your review inbox.',
  todo: [
    'Pick a cluster as the subject (or describe an ideal customer).',
    'Set how many prospects to work, then press “Run batch”.',
    'Review each AI draft in the inbox — approve, edit, reject, or bulk-approve.',
  ],
  note: 'Nothing is ever sent without your approval. Watch progress live in “Agent activity”.',
};

/** Guidance for the SEQUENCES flow (named, toggleable background campaigns). */
const SEQUENCES_GUIDE: GuideContent = {
  icon: Rocket,
  eyebrow: 'Sequences',
  title: 'Save campaigns that run in the background',
  intro:
    'A sequence is a named prospecting campaign you can save and come back to. Turn it Live and the agent prospects in the background; turn it Draft to pause. Run several at once for different projects or buyer types.',
  todo: [
    'Create a sequence: give it a name, a short description, and pick what it sells.',
    'Toggle it Live — the agent starts finding prospects in the background.',
    'Open a sequence any time to review the prospects it found.',
  ],
  note: 'Live work continues even if you close the page. Nothing sends without your approval.',
};

/** A small live/representative data-source explainer used inside the guide. */
function DataSourceNote({ dataSource }: { dataSource?: 'live' | 'demo' | null }) {
  if (!dataSource) return null;
  const live = dataSource === 'live';
  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug ${
        live
          ? 'bg-green-50 text-green-800 ring-1 ring-green-200'
          : 'bg-ora-cream-light/70 text-ora-charcoal-light ring-1 ring-ora-sand/60'
      }`}
    >
      {live ? <RadioTower className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ScrollText className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>
        {live ? (
          <>You’re seeing <strong>live market data</strong> for this area.</>
        ) : (
          <>You’re seeing <strong>representative data</strong>. It works the same way; live market data isn’t connected for this area yet.</>
        )}
      </span>
    </div>
  );
}

/**
 * The sticky right-rail guide. Shows plain-language help for whichever section
 * the rep is currently on, so the workspace is self-explanatory for someone who
 * has never prospected before.
 */
export function StepGuide({
  mode,
  step,
  dataSource,
}: {
  mode: 'guided' | 'autonomous' | 'sequences';
  /** Active step in the guided flow (1–5); ignored in the other modes. */
  step: number;
  /** Live vs representative market data, surfaced on the market/prospect steps. */
  dataSource?: 'live' | 'demo' | null;
}) {
  const guide =
    mode === 'autonomous'
      ? AUTONOMOUS_GUIDE
      : mode === 'sequences'
        ? SEQUENCES_GUIDE
        : GUIDED_GUIDES[step] ?? GUIDED_GUIDES[1];
  const Icon = guide.icon;
  const showDataNote = mode === 'autonomous' || (mode === 'guided' && (step === 2 || step === 4));

  return (
    <div className="rounded-xl border border-ora-sand/60 bg-ora-white">
      <header className="flex items-center gap-2 border-b border-ora-sand/50 bg-ora-cream-light/40 px-4 py-2.5">
        <Lightbulb className="h-4 w-4 text-ora-gold-dark" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ora-charcoal-light">
          What this step does
        </h2>
      </header>
      <div className="px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ora-gold/15 text-ora-gold-dark">
            <Icon className="h-4 w-4 stroke-[1.5]" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ora-muted">
              {guide.eyebrow}
            </p>
            <h3 className="text-sm font-semibold leading-tight text-ora-charcoal">{guide.title}</h3>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ora-charcoal-light">{guide.intro}</p>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ora-muted">
            <ListChecks className="h-3.5 w-3.5 text-ora-gold-dark" /> What to do
          </div>
          <ul className="space-y-1.5">
            {guide.todo.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-snug text-ora-charcoal-light">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ora-gold-dark" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        {showDataNote && <DataSourceNote dataSource={dataSource} />}

        {guide.note && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-ora-cream-light/60 px-3 py-2 text-[11px] leading-snug text-ora-charcoal-light">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ora-gold-dark" />
            <span>{guide.note}</span>
          </div>
        )}
      </div>
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
//
// ORA is a single company; reps prospect for ORA's OWN projects, so the subject
// is always picked from our catalog. The picker resolves the comparison spec
// from real own records — cluster is OPTIONAL (it only sharpens the match), so a
// rep can move forward with just a project. The primary action button is ALWAYS
// visible (never hidden behind a cluster selection) so the way forward is
// obvious; it enables as soon as a project is chosen.

export function OwnSubjectPicker({
  catalog,
  selectedCommunityId,
  selectedProjectId,
  selectedClusterId,
  busy,
  onSelectCommunity,
  onSelectProject,
  onSelectCluster,
  onSubmit,
  submitLabel = 'Run market research',
}: {
  catalog: OwnCatalog;
  selectedCommunityId: string | null;
  selectedProjectId: string | null;
  selectedClusterId: string | null;
  busy: boolean;
  onSelectCommunity: (id: string | null) => void;
  onSelectProject: (id: string | null) => void;
  onSelectCluster: (id: string | null) => void;
  /**
   * When provided, the picker shows its own primary CTA that submits the current
   * selection (project + optional cluster). Omit it when an outer control drives
   * the action (e.g. the autonomous "Run batch" button below the picker).
   */
  onSubmit?: () => void;
  submitLabel?: string;
}) {
  // `selectedClusterId` / `onSelectCluster` are retained on the props (callers
  // still pass them) but the third level is not surfaced for now — the picker is
  // a two-step Project → Cluster selection. (Underlying catalog levels are
  // unchanged: the "Project" dropdown lists catalog communities and the
  // "Cluster" dropdown lists catalog projects — a display-only relabel.)
  void selectedClusterId;
  void onSelectCluster;

  // The selected real project is the minimum needed to resolve a comparison.
  const canSubmit = Boolean(selectedProjectId);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ora-muted">
        Pick the ORA project you&apos;re selling. We resolve the comparison from
        our own catalog automatically — no free-form typing needed.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-ora-charcoal-light">
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5 text-ora-gold-dark" /> Project
          </span>
          <select
            className={inputCls}
            value={selectedCommunityId ?? ''}
            onChange={(e) => onSelectCommunity(e.target.value || null)}
          >
            <option value="">Select project…</option>
            {catalog.communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
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
            value={selectedProjectId ?? ''}
            disabled={!selectedCommunityId || catalog.projects.length === 0}
            onChange={(e) => onSelectProject(e.target.value || null)}
          >
            <option value="">
              {selectedCommunityId ? 'Select cluster…' : 'Pick a project first'}
            </option>
            {catalog.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameEn}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Always-visible primary action so the way forward is never ambiguous. */}
      {onSubmit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-ora-sand/40 pt-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !canSubmit}
            onClick={onSubmit}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {submitLabel}
          </button>
          <span className="text-[11px] text-ora-muted">
            {!selectedCommunityId
              ? 'Start by picking a project.'
              : !selectedProjectId
                ? 'Select a cluster to continue.'
                : 'Ready.'}
          </span>
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

// ── 0a. Brief property details (always-collected matching keys) ──────────────
//
// The rep ALWAYS supplies unit type + bedrooms (+ optional price band), even
// when picking an ORA project from the catalog. These are the primary keys for
// matching comparable sold transactions — without them the comparison spec is
// empty and the AI has no concrete grounding. Pairs with `OwnSubjectPicker`
// (which supplies the ORA project identity) in the catalog brief.

const BRIEF_UNIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'villa', label: 'Villa' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'penthouse', label: 'Penthouse' },
  { value: 'plot', label: 'Plot' },
  { value: 'office', label: 'Office' },
];

export function BriefDetails({
  unitType,
  bedrooms,
  priceMin,
  priceMax,
  onUnitType,
  onBedrooms,
  onPriceMin,
  onPriceMax,
  busy,
  onSubmit,
}: {
  unitType: string;
  bedrooms: string;
  priceMin: string;
  priceMax: string;
  onUnitType: (v: string) => void;
  onBedrooms: (v: string) => void;
  onPriceMin: (v: string) => void;
  onPriceMax: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const canSubmit = Boolean(unitType) && Boolean(bedrooms);
  return (
    <div className="space-y-3 border-t border-ora-sand/40 pt-3">
      <p className="text-xs text-ora-muted">
        What exactly are you selling? These find the comparable sales the AI uses
        to understand the property and write the pitch.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-ora-charcoal-light">
          Unit type
          <select className={inputCls} value={unitType} onChange={(e) => onUnitType(e.target.value)}>
            <option value="">Select…</option>
            {BRIEF_UNIT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ora-charcoal-light">
          Bedrooms
          <input
            className={inputCls}
            type="number"
            min={0}
            max={20}
            value={bedrooms}
            onChange={(e) => onBedrooms(e.target.value)}
            placeholder="4"
          />
        </label>
        <label className="text-xs text-ora-charcoal-light">
          Min price (AED)
          <input
            className={inputCls}
            type="number"
            min={0}
            value={priceMin}
            onChange={(e) => onPriceMin(e.target.value)}
            placeholder="optional"
          />
        </label>
        <label className="text-xs text-ora-charcoal-light">
          Max price (AED)
          <input
            className={inputCls}
            type="number"
            min={0}
            value={priceMax}
            onChange={(e) => onPriceMax(e.target.value)}
            placeholder="optional"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={busy || !canSubmit} onClick={onSubmit}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Run market research
        </button>
        <span className="text-[11px] text-ora-muted">
          {!unitType
            ? 'Pick the unit type to continue.'
            : !bedrooms
              ? 'Add the number of bedrooms.'
              : 'Ready — we’ll pull comparable sold units.'}
        </span>
      </div>
    </div>
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
          <option value="plot">Plot</option>
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
          Run market research
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
  dataSource = null,
  dataNote = null,
  selectedIds,
  onToggleSelect,
  onUseSelected,
  useSelectedBusy = false,
}: {
  comparables: Comparable[];
  unconfigured: boolean;
  areaTrend?: AreaTrendRow[];
  /** Whether the comparables came from LIVE provider rows or the demo fallback. */
  dataSource?: 'live' | 'demo' | null;
  /** `trial_limit` when the trial market source is tapped out (representative data). */
  dataNote?: 'trial_limit' | null;
  /** When provided, each comp gets a checkbox and a "build profile from selected" CTA. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onUseSelected?: () => void;
  useSelectedBusy?: boolean;
}) {
  const selectable = Boolean(selectedIds && onToggleSelect);
  const selectedCount = selectedIds
    ? comparables.filter((c) => selectedIds.has(c.marketProjectId)).length
    : 0;
  const asOf = comparables[0]?.asOf ?? areaTrend[0]?.asOf ?? null;
  const sourceBadge =
    dataNote === 'trial_limit' ? (
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <strong>Market data trial limit reached.</strong> Showing representative
          comparable sales so you can keep working — the same set each time. Live
          comparables resume automatically when the trial quota resets.
        </span>
      </div>
    ) : dataSource === 'live' ? (
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700 ring-1 ring-green-200">
        <RadioTower className="h-3 w-3" />
        Live · Property Finder{asOf ? ` · as of ${new Date(asOf).toLocaleDateString()}` : ''}
      </div>
    ) : dataSource === 'demo' ? (
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-ora-cream-dark px-2.5 py-1 text-[11px] font-medium text-ora-charcoal-light ring-1 ring-ora-sand/60">
        <ScrollText className="h-3 w-3" />
        Representative data{asOf ? ` · captured ${new Date(asOf).toLocaleDateString()}` : ''}
      </div>
    ) : null;

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
      {sourceBadge}
      <AreaTrendHeadline rows={areaTrend} />
      {selectable && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-ora-gold/30 bg-ora-gold/5 px-3 py-2.5">
          <span className="text-xs text-ora-charcoal-light">
            Tick the closest matches — the agent uses these to build the buyer profile and pitch.
          </span>
          <button
            type="button"
            className={`${btnPrimary} ml-auto`}
            disabled={useSelectedBusy || selectedCount === 0}
            onClick={onUseSelected}
            title="Re-derive the buyer profile from the comparables you selected"
          >
            {useSelectedBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Build buyer profile from selected ({selectedCount})
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {comparables.map((c) => {
        const checked = selectedIds?.has(c.marketProjectId) ?? false;
        return (
        <div
          key={c.marketProjectId}
          className={`rounded-lg border p-3 transition ${
            selectable && checked
              ? 'border-ora-gold/60 bg-ora-cream ring-1 ring-ora-gold/30'
              : 'border-ora-sand/60 bg-ora-cream-light/40'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {selectable && (
                <button
                  type="button"
                  aria-label={checked ? 'Deselect comparable' : 'Select comparable'}
                  aria-pressed={checked}
                  className="mt-0.5 shrink-0 text-ora-charcoal-light transition hover:text-ora-charcoal"
                  onClick={() => onToggleSelect?.(c.marketProjectId)}
                >
                  {checked ? (
                    <CheckSquare className="h-4 w-4 text-ora-gold-dark" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              )}
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
        );
      })}
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
          Find prospects
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
  status,
  recordingId,
  onRecord,
}: {
  candidates: ProviderCandidate[];
  status?: ProviderSearchStatus | null;
  recordingId: string | null;
  onRecord: (c: ProviderCandidate) => void;
}) {
  const banner = providerStatusBanner(status, candidates);
  if (candidates.length === 0) {
    return (
      <div className="space-y-3">
        {banner}
        <p className="text-xs text-ora-muted">
          No prospects yet. Press “Find prospects” on the buyer profile above —
          results come from the configured data providers (Apollo, PDL, Cognism,
          Crunchbase), with a representative set when the trial limit is hit.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {banner}
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
    </div>
  );
}

/**
 * Render the data-source banner for the candidate search. Because the buyer
 * providers (Apollo et al.) run on a TRIAL tier, the ONE expected, normal
 * condition is "trial limit reached" — when that happens (a provider returned
 * 429, or none was usable so the representative demo set carried the search) we
 * show a single, clear notice that the prospects below are representative and
 * cached. Returns `null` when live providers carried the search.
 */
function providerStatusBanner(
  status: ProviderSearchStatus | null | undefined,
  candidates: ProviderCandidate[]
) {
  if (!status) return null;
  const allDemo =
    candidates.length > 0 && candidates.every((c) => c.sourceProvider === 'demo');
  const rateLimited = status.rateLimitedProviders.length > 0;
  const noLive =
    allDemo &&
    (status.unconfiguredProviders.length > 0 || status.failedProviders.length > 0);

  if (rateLimited || noLive) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Buyer data trial limit reached.</strong> The live buyer source is
          on a trial tier and hit its quota, so the prospects below are{' '}
          <em>representative</em> (and cached — you may see the same profiles again).
          Live results resume automatically when the quota resets.
        </span>
      </div>
    );
  }
  return null;
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

/** Human-readable label for an enriched attribute key (camelCase → Title Case). */
function attrLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Provider intel surfaced after "Enrich" — the per-field provenanced attributes
 * `enrich_target` merged onto the Target (seniority, wealth signal, industry,
 * LinkedIn, …). Without this the enrich action only flipped a status badge and
 * showed a toast; now the fetched intelligence is actually visible, each value
 * stamped with the provider that supplied it.
 */
function TargetIntel({
  attributes,
}: {
  attributes: TargetRow['attributes'];
}) {
  if (!attributes) return null;
  const entries = Object.entries(attributes).filter(
    ([, f]) => f && typeof f.value === 'string' && f.value.trim() !== ''
  );
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-ora-sand/50 bg-ora-cream-light/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ora-charcoal-light">
        <Sparkles className="h-3 w-3 text-ora-gold-dark" /> Provider intel
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {entries.slice(0, 8).map(([key, field]) => {
          const isLink = /^https?:\/\//i.test(field.value);
          return (
            <div key={key} className="flex items-baseline justify-between gap-2 text-[11px]">
              <dt className="shrink-0 text-ora-muted">{attrLabel(key)}</dt>
              <dd className="min-w-0 truncate text-right font-medium text-ora-charcoal" title={field.value}>
                {isLink ? (
                  <a
                    href={field.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ora-gold-dark underline-offset-2 hover:underline"
                  >
                    {field.source ? `${field.source} link` : 'link'}
                  </a>
                ) : (
                  field.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

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
            <TargetIntel attributes={t.attributes} />
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

// ── 8. Prospecting Sequences (named, toggleable background campaigns) ────────
//
// The top-level "save a prospecting campaign and run it in the background"
// surface. A rep creates a NAMED sequence (name + short description + subject +
// target count), then toggles it Live (the agent prospects in the background) or
// Draft (paused). Multiple sequences run in parallel; opening one shows its
// prospects (the review inbox scoped to that sequence). Presentational only —
// every fetch + mutation lives in `page.tsx`.

/** A Live/Draft pill + toggle for one sequence. */
function SequenceModeToggle({
  mode,
  busy,
  onToggle,
}: {
  mode: SequenceMode;
  busy: boolean;
  onToggle: (next: SequenceMode) => void;
}) {
  const live = mode === 'live';
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={live}
      onClick={() => onToggle(live ? 'draft' : 'live')}
      title={live ? 'Pause this sequence' : 'Turn on — the agent prospects in the background'}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
        live
          ? 'bg-green-100 text-green-700 ring-1 ring-green-300 hover:bg-green-200'
          : 'bg-ora-cream-dark text-ora-charcoal-light ring-1 ring-ora-sand/60 hover:bg-ora-sand/40'
      }`}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span className={`h-2 w-2 rounded-full ${live ? 'bg-green-600' : 'bg-ora-muted'}`} />
      )}
      {live ? 'Live' : 'Draft'}
    </button>
  );
}

export function SequencesPanel({
  sequences,
  catalog,
  selectedCommunityId,
  selectedProjectId,
  selectedClusterId,
  onSelectCommunity,
  onSelectProject,
  onSelectCluster,
  creating,
  onCreate,
  toggleBusyId,
  onToggle,
  openSequenceId,
  onOpen,
  onCloseDetail,
  inboxItems,
  inboxSelected,
  inboxBusyId,
  inboxBulkBusy,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onApprove,
  onReject,
  onBulkApprove,
}: {
  sequences: SequenceRow[];
  catalog: OwnCatalog;
  selectedCommunityId: string | null;
  selectedProjectId: string | null;
  selectedClusterId: string | null;
  onSelectCommunity: (id: string | null) => void;
  onSelectProject: (id: string | null) => void;
  onSelectCluster: (id: string | null) => void;
  creating: boolean;
  /** Create a sequence from the form fields + the currently-picked subject. */
  onCreate: (input: { name: string; description: string; targetCount: number }) => void;
  toggleBusyId: string | null;
  onToggle: (seq: SequenceRow, next: SequenceMode) => void;
  openSequenceId: string | null;
  onOpen: (seq: SequenceRow) => void;
  onCloseDetail: () => void;
  // Review inbox for the OPENED sequence (reuses the queue projection).
  inboxItems: QueueItemRow[];
  inboxSelected: Set<string>;
  inboxBusyId: string | null;
  inboxBulkBusy: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string, subject: string, body: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onBulkApprove: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetCount, setTargetCount] = useState('10');
  const [showCreate, setShowCreate] = useState(false);

  const n = Number(targetCount);
  const nValid = Number.isInteger(n) && n > 0;
  // A sequence sells an own subject: a Project is the minimum (a Community alone
  // is not specific enough); a Cluster is an optional finer-grained subject.
  const canCreate = name.trim().length > 0 && Boolean(selectedProjectId) && nValid;

  const submit = () => {
    if (!canCreate) return;
    onCreate({ name: name.trim(), description: description.trim(), targetCount: n });
    setName('');
    setDescription('');
    setTargetCount('10');
    setShowCreate(false);
  };

  const openSeq = sequences.find((s) => s.id === openSequenceId) ?? null;

  return (
    <div className="space-y-4">
      {/* Create a new sequence */}
      <section className="rounded-xl border border-ora-gold-dark/30 bg-ora-gold/5">
        <header className="flex items-center gap-2.5 px-5 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ora-gold-dark text-ora-white">
            <Rocket className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ora-charcoal">New prospecting sequence</h2>
            <p className="text-xs text-ora-muted">
              Name a campaign, pick what it sells, and turn it Live — the agent prospects in the background.
            </p>
          </div>
          <button
            type="button"
            className={btnGhost}
            onClick={() => setShowCreate((s) => !s)}
          >
            {showCreate ? 'Close' : 'New sequence'}
          </button>
        </header>
        {showCreate && (
          <div className="space-y-3 border-t border-ora-gold/20 px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <label className="text-xs text-ora-charcoal-light">
                Sequence name
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Coastline penthouses — India HNW"
                />
              </label>
              <label className="text-xs text-ora-charcoal-light">
                Target count (N)
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  max={500}
                  value={targetCount}
                  onChange={(e) => setTargetCount(e.target.value)}
                />
              </label>
            </div>
            <label className="block text-xs text-ora-charcoal-light">
              Short description
              <input
                className={inputCls}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this campaign is for"
              />
            </label>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ora-muted">
                Subject — what this sequence sells
              </div>
              <OwnSubjectPicker
                catalog={catalog}
                selectedCommunityId={selectedCommunityId}
                selectedProjectId={selectedProjectId}
                selectedClusterId={selectedClusterId}
                busy={creating}
                onSelectCommunity={onSelectCommunity}
                onSelectProject={onSelectProject}
                onSelectCluster={onSelectCluster}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={btnPrimary} disabled={creating || !canCreate} onClick={submit}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                Create sequence (Draft)
              </button>
              <span className="text-[11px] text-ora-muted">
                {!name.trim()
                  ? 'Give the sequence a name.'
                  : !selectedProjectId
                    ? 'Pick a project as the subject (cluster is optional).'
                    : 'Created as Draft — turn it Live to start prospecting.'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Sequence list */}
      {sequences.length === 0 ? (
        <p className="rounded-xl border border-ora-sand/60 bg-ora-white px-5 py-6 text-center text-xs text-ora-muted">
          No sequences yet. Create one above to start prospecting in the background.
        </p>
      ) : (
        <ul className="space-y-2">
          {sequences.map((s) => {
            const isOpen = s.id === openSequenceId;
            return (
              <li key={s.id} className="rounded-xl border border-ora-sand/60 bg-ora-white">
                <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-ora-charcoal">{s.name}</h3>
                      {(s.pendingProspects ?? 0) > 0 && (
                        <span className="rounded-full bg-ora-gold/15 px-2 py-0.5 text-[10px] font-semibold text-ora-gold-dark">
                          {s.pendingProspects} to review
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="truncate text-xs text-ora-muted">{s.description}</p>
                    )}
                  </div>
                  <SequenceModeToggle
                    mode={s.mode}
                    busy={toggleBusyId === s.id}
                    onToggle={(next) => onToggle(s, next)}
                  />
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => (isOpen ? onCloseDetail() : onOpen(s))}
                  >
                    <Inbox className="h-3.5 w-3.5" /> {isOpen ? 'Hide prospects' : 'View prospects'}
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-ora-sand/50 px-5 py-4">
                    {openSeq?.mode === 'live' && inboxItems.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-lg bg-ora-cream-light/60 px-3 py-2.5 text-xs text-ora-charcoal-light">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Live — the agent is looking for prospects. Drafts will appear here as they&apos;re found.
                      </div>
                    ) : (
                      <ReviewInboxPanel
                        items={inboxItems}
                        selectedIds={inboxSelected}
                        busyId={inboxBusyId}
                        bulkBusy={inboxBulkBusy}
                        onToggleSelect={onToggleSelect}
                        onToggleAll={onToggleAll}
                        onEdit={onEdit}
                        onApprove={onApprove}
                        onReject={onReject}
                        onBulkApprove={onBulkApprove}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
