// ── Prospecting Workspace — client-safe types (S7, task 8.4) ─────────────────
//
// Client-safe mirror of the wire shapes the prospecting bridge
// (`lib/cms/api/routes/prospecting.ts`) returns. The server modules
// (`schema.ts`, `events.ts`) import Drizzle and must not enter the client
// bundle, so — exactly like the Lead Engine (`leads/useLeadsRealtime.ts`) and
// the Home_Surface (`_home/HomeRealtime.tsx`) — we restate the shapes here.

export type TargetType = "person" | "company" | "intermediary";
export type TargetStatus =
  | "new"
  | "researching"
  | "qualified"
  | "promoted"
  | "discarded"
  | "opted_out";
export type DraftStatus = "draft" | "approved" | "sent" | "suppressed";
export type Channel = "email" | "whatsapp" | "message";
export type Language = "en" | "ar";

/** One grounded claim pinned to a SQL source record (CC-SQL). */
export interface GroundingClaim {
  claim: string;
  sourceTable: string;
  recordId: string;
  asOf: string;
}

/** The AI-composed, editable outreach draft returned by compose-draft. */
export interface ComposedDraft {
  channel: Channel;
  language: Language;
  subject: string;
  body: string;
  grounding: GroundingClaim[];
}

/** A single Salesforce match surfaced by the CRM pre-check. */
export interface CrmMatch {
  object: 'Lead' | 'Contact';
  id: string;
  name: string | null;
  email: string | null;
  status: string | null;
  company: string | null;
  owner: string | null;
  lastActivity: string | null;
  isConverted?: boolean;
}

/** Result of the "is this prospect already in Salesforce?" pre-check. */
export interface CrmCheckResult {
  configured: boolean;
  found: boolean;
  matches: CrmMatch[];
  checkedEmail: string | null;
  note?: string;
}

/** The "what I want to sell" spec a Prospecting_Brief carries. */
export interface BriefSpec {
  area?: string;
  segment?: "ultra_luxury" | "luxury" | "premium" | "mid";
  unitType?: "apartment" | "villa" | "townhouse" | "penthouse" | "plot" | "office";
  bedrooms?: number;
  priceMinAed?: number;
  priceMaxAed?: number;
  features: string[];
}

/** The agent-derived, editable Buyer_Hypothesis proposal. */
export interface BuyerHypothesis {
  segments: string[];
  feederMarkets: string[];
  titles: string[];
  wealthSignals: string[];
  evidence: Array<{ claim: string; sourceTable: string; asOf: string }>;
  confidence: "low" | "medium" | "high";
}

/** A figure paired with its SQL provenance (source + as-of). */
export interface StatFigure<T> {
  value: T;
  source: string | null;
  asOf: string | null;
}

/** SQL-sourced transaction stats for a comparable market project. */
export interface CompStats {
  marketProjectId: string;
  txnCount: number;
  recentSalePriceAed: StatFigure<number | null>;
  avgPricePerSqft: StatFigure<number | null>;
  velocitySalesLast12m: StatFigure<number | null>;
  buyerSegmentMix: StatFigure<
    Array<{ segment: string; count: number; pct: number }>
  >;
}

/** A ranked comparable market project returned by find_comparables. */
export interface Comparable {
  marketProjectId: string;
  name: string;
  segment: string | null;
  communityName: string | null;
  score: number;
  reasons: string[];
  source: string;
  asOf: string | null;
  stats: CompStats;
}

export interface ProspectingBrief {
  id: string;
  spec: BriefSpec;
  buyerHypothesis: BuyerHypothesis | null;
  status: "draft" | "searching" | "complete" | "archived";
  projectId: string | null;
  aiUnitId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A candidate Target returned by prospect_search (not yet recorded). */
export interface ProviderCandidate {
  targetType: TargetType;
  displayName?: string;
  companyName?: string;
  title?: string;
  email?: string;
  phone?: string;
  country?: string;
  attributes: Record<
    string,
    { value: string; source: string; asOf: string; lawfulBasis?: string }
  >;
  sourceProvider: string;
  sourceRef?: string;
  lawfulBasis: string;
}

/**
 * Provider fan-out status for a prospect search — which providers were skipped
 * because they were unconfigured, failed, or hit their request quota (429). The
 * workspace surfaces a banner from this so the rep understands when results are
 * live vs. representative fallback data.
 */
export interface ProviderSearchStatus {
  unconfiguredProviders: string[];
  failedProviders: string[];
  rateLimitedProviders: string[];
}

/** A recorded Target row (privacy-safe projection — phone hash only). */
export interface TargetRow {
  id: string;
  briefId: string | null;
  targetType: TargetType;
  displayName: string | null;
  companyName: string | null;
  title: string | null;
  email: string | null;
  phoneHash: string | null;
  country: string | null;
  attributes: Record<
    string,
    { value: string; source: string; asOf: string; lawfulBasis?: string }
  > | null;
  sourceProvider: string;
  status: TargetStatus;
  partyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachDraftRow {
  id: string;
  targetId: string;
  briefId: string | null;
  channel: Channel;
  language: Language;
  subject: string | null;
  body: string;
  grounding: GroundingClaim[];
  status: DraftStatus;
  approvedBy: string | null;
  jobKey: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Own-catalog picker (S7 increment, Req 13.3) ──────────────────────────────
// The community → project → cluster nodes the picker reads from
// `GET /api/prospecting/own-catalog`. Pure own-catalog reads — no market data.

export interface CommunityNode {
  id: string;
  nameEn: string;
  nameAr: string | null;
  city: string | null;
  region: string | null;
  status: string;
}

export interface ProjectNode {
  id: string;
  communityId: string;
  nameEn: string;
  nameAr: string | null;
  status: string;
}

export interface ClusterNode {
  id: string;
  projectId: string;
  name: string;
  nameAr: string | null;
  slug: string;
  segment: "ultra_luxury" | "luxury" | "premium" | "mid" | null;
  unitTypes: string[] | null;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  priceMinAed: number | null;
  priceMaxAed: number | null;
  avgPricePerSqft: number | null;
  totalUnits: number | null;
}

export interface OwnCatalog {
  communities: CommunityNode[];
  projects: ProjectNode[];
  clusters: ClusterNode[];
}

// ── Area_Trend (S7 increment, Req 14.7) ──────────────────────────────────────
// One area/segment price-index row returned by `market_comps`. Each headline
// figure (avg price/sqft, YoY, ROI, volume, raw trend) shares this row's
// `source` + `asOf`, so every figure is provenance-stamped (CC-Provenance).

export interface AreaTrendRow {
  recordId: string;
  areaName: string | null;
  segment: string | null;
  period: string | null;
  indexValue: number | null;
  avgPricePerSqft: number | null;
  yoyPct: number | null;
  roiPct?: number | null;
  volume?: number | null;
  trend?: unknown;
  source: string;
  asOf: string | null;
}

// ── Agentic Batch_Run + Approval Queue — client-safe types (task 10.1) ───────
//
// Client-safe mirror of the wire shapes the batch + queue bridge routes
// (`lib/cms/api/routes/prospecting.ts`, tasks 8.1–8.5) return. Same convention
// as the rest of this file: no Drizzle imports, plain TS interfaces, field
// names matching the route JSON exactly (the camelCase Drizzle select aliases).
// Timestamps arrive as ISO strings over the wire; `numeric` columns (fitScore)
// arrive as strings, never numbers.

/**
 * The subject of a Batch_Run — a Bayn cluster reference or an ICP filter
 * (client-safe mirror of `BatchSubject` in
 * `lib/cms/prospecting/batch/rerun-key.ts`). `kind` records which one is
 * authoritative; the `icpFilter` is kept as an opaque record here (the
 * server-side `ProspectFilter` is not client-safe).
 */
export interface BatchSubject {
  kind: "cluster" | "icp";
  /** Set when `kind === "cluster"` — the Bayn cluster id. */
  clusterId?: string;
  /** An own project subject (own-catalog led), optionally with a cluster. */
  projectId?: string;
  /** The community the project / cluster belongs to. */
  communityId?: string;
  /** Optional originating Prospecting_Brief id. */
  briefId?: string;
  /** Set when `kind === "icp"` — the ICP filter the run searched against. */
  icpFilter?: Record<string, unknown>;
}

/** One evaluated dimension's contribution to a Fit_Score (mirror of `FitSignalContribution`). */
export interface FitSignalContribution {
  /** The signal dimension evaluated (e.g. `"titles"`, `"geography"`). */
  dimension: string;
  /** The dimension's relative weight in the (normalised) overall score. */
  weight: number;
  /** Sub-score in `[0, 1]` for this dimension. */
  similarity: number;
  /** The subject's expected signals for the dimension. */
  expected: string[];
  /** The candidate signals that matched an expected signal. */
  matched: string[];
}

/**
 * The explainable rationale for a deterministic Fit_Score (client-safe mirror
 * of `FitRationale` in `lib/cms/prospecting/batch/fit-score.ts`): the overall
 * score, every evaluated signal with its weight + contribution, and a short
 * human-readable summary.
 */
export interface FitRationale {
  /** Overall fit score in `[0, 1]`, mirroring the queue item's `fitScore`. */
  score: number;
  /** Every evaluated dimension with its weight + similarity. Always non-empty. */
  signals: FitSignalContribution[];
  /** A short, deterministic human-readable explanation of the score. */
  summary: string;
}

/** Lifecycle state of a Batch_Run (`prospecting_batch_runs.status`). */
export type BatchRunStatus = "running" | "completed" | "failed";

/**
 * One Batch_Run row. Matches `GET /api/prospecting/batches` list rows; the
 * `GET /api/prospecting/batches/:id` `run` is the same shape (it additionally
 * carries `rerunKey`, surfaced here as optional).
 */
export interface BatchRunRow {
  id: string;
  ownerRep: string;
  subject: BatchSubject;
  clusterId: string | null;
  targetCount: number;
  status: BatchRunStatus;
  reason: string | null;
  /** Present on the single-run read (`GET /batches/:id`), omitted from the list. */
  rerunKey?: string;
  createdAt: string;
  updatedAt: string;
}

/** Lifecycle state of a Queued_Item (`prospecting_queue_items.status`). */
export type QueueItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "sent"
  | "skipped";

/** How a candidate was classified by the eligibility pipeline. */
export type QueueEligibility = "cold_eligible" | "warm_path" | "skipped";

/** The decision point an Agent_Activity_Log entry records (`action`). */
export type BatchActivityAction =
  | "discovered"
  | "crm_checked"
  | "scored"
  | "eligibility"
  | "drafted"
  | "skipped"
  | "warm_path";

/**
 * One Queued_Item, privacy-safe (phoneHash ONLY, never a raw phone). Unifies
 * the two route projections:
 *
 *   - `GET /api/prospecting/batches/:id` queue items carry `skipReason`;
 *   - `GET /api/prospecting/queue` items omit `skipReason` but ADD the grounded
 *     draft content (`draft*` fields) for review.
 *
 * Fields only present in one projection are optional. All Target/draft fields
 * are nullable because they come from a LEFT JOIN. `fitScore` arrives as a
 * string (a `numeric` column) or null, never a JS number.
 */
export interface QueueItemRow {
  id: string;
  batchRunId: string;
  targetId: string;
  draftId: string | null;
  eligibility: QueueEligibility;
  /** Only on the batch-detail projection (`GET /batches/:id`). */
  skipReason?: string | null;
  /** `numeric` column — a decimal string or null, not a number. */
  fitScore: string | null;
  fitRationale: FitRationale | null;
  lawfulBasis: string | null;
  dataSource: string | null;
  acquiredAt: string | null;
  status: QueueItemStatus;
  createdAt: string;
  updatedAt: string;

  // Grounded draft content — only on the Review Inbox projection (`GET /queue`).
  draftSubject?: string | null;
  draftBody?: string | null;
  draftChannel?: Channel | null;
  draftLanguage?: Language | null;
  draftStatus?: DraftStatus | null;

  // Privacy-safe Target projection (LEFT JOIN — all nullable; phoneHash only).
  targetType: TargetType | null;
  targetDisplayName: string | null;
  targetCompanyName: string | null;
  targetTitle: string | null;
  targetEmail: string | null;
  targetPhoneHash: string | null;
  targetCountry: string | null;
  targetStatus: TargetStatus | null;
}

/**
 * One persisted Agent_Activity_Log entry (`GET /api/prospecting/batches/:id/activity`).
 * Privacy-safe — internal ids only, never a raw phone. Ordered by monotonic `seq`.
 */
export interface BatchActivityEntry {
  id: string;
  batchRunId: string;
  seq: number;
  action: BatchActivityAction;
  reason: string | null;
  targetId: string | null;
  payload: Record<string, unknown> | null;
  at: string;
}

/** Result of `POST /api/prospecting/batches` — the idempotent run kick-off. */
export interface StartBatchResult {
  batchRunId: string;
  status: BatchRunStatus;
}

// ── Prospecting Sequences (named background campaigns) ───────────────────────

/** Legacy toggle kept in sync with `status` (`draft` = paused, `live` = running). */
export type SequenceMode = "draft" | "live";

/** The authoritative lifecycle state of a Sequence (`prospecting_sequences.status`). */
export type SequenceStatus = "draft" | "live" | "paused" | "archived";

/** The Enrollment_Cap period a Sequence's cap is reckoned over. */
export type SequencePeriod = "day" | "week" | "month";

/** A lifecycle action a rep can take on a Sequence (maps to a POST route). */
export type SequenceLifecycleAction = "publish" | "pause" | "resume" | "archive";

/**
 * A named, owner-scoped prospecting campaign. The durable parent the rep manages
 * (name + description + subject + per-refresh size + cadence + enrollment cap),
 * with a lifecycle `status`; each `live` Sequence refreshes in the background and
 * lands prospects in its inbox. `enrolledProspects` / `pendingProspects` are
 * present on the list projection (`GET /sequences`).
 */
export interface SequenceRow {
  id: string;
  ownerRep: string;
  name: string;
  description: string | null;
  subject: BatchSubject;
  /** Per-refresh batch size (repurposed `target_count`). */
  targetCount: number;
  /** Legacy toggle, kept in sync with `status`. */
  mode: SequenceMode;
  /** Authoritative lifecycle state. */
  status: SequenceStatus;
  /** Refresh_Frequency in minutes (>= 60). */
  refreshIntervalMinutes: number | null;
  /** When the Sequence last completed a Refresh_Run (null → never). */
  lastRefreshedAt: string | null;
  /** The next scheduled refresh instant (null when not scheduled). */
  nextRefreshAt: string | null;
  /** Enrollment cap per period (null → unbounded). */
  enrollmentCap: number | null;
  /** The period the enrollment cap is reckoned over. */
  enrollmentPeriod: SequencePeriod | null;
  /** When the Sequence was archived (null unless archived). */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Enrolled-prospect count (only on the list projection). */
  enrolledProspects?: number;
  /** Count of prospects awaiting review (only on the list projection). */
  pendingProspects?: number;
}

/**
 * One enrolled prospect in a Sequence's enrollment ledger, joined to its Target
 * for a privacy-safe projection (phoneHash ONLY, never a raw phone). Returned by
 * `GET /sequences/:id` as `enrolledProspects`.
 */
export interface EnrolledProspectRow {
  id: string;
  targetId: string;
  batchRunId: string;
  periodBucket: string;
  createdAt: string;
  targetType: TargetType | null;
  targetDisplayName: string | null;
  targetCompanyName: string | null;
  targetTitle: string | null;
  targetEmail: string | null;
  targetPhoneHash: string | null;
  targetCountry: string | null;
  targetStatus: TargetStatus | null;
}

/**
 * The full Sequence detail returned by `GET /sequences/:id`: the config row, the
 * pending Review_Inbox items, the enrolled prospects, and the Activity_Log
 * aggregated across the Sequence's Refresh_Runs.
 */
export interface SequenceDetail {
  sequence: SequenceRow;
  count: number;
  queueItems: QueueItemRow[];
  enrolledProspects: EnrolledProspectRow[];
  enrolledCount: number;
  activity: BatchActivityEntry[];
}


/**
 * Result of `POST /api/prospecting/queue/bulk-approve` (Req 5.4): how many of
 * the selected items were approved + sent, plus a per-item skip reason for each
 * one the per-item send-time gate refused (`cap_reached`, `opted_out`,
 * `not_found`, …). `approved + skipped.length` accounts for every selected id.
 */
export interface BulkApproveResult {
  approved: number;
  sent: number;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Result of `POST /api/prospecting/queue/:id/approve` — either a confirmed send
 * or a structured skip (the send-time gate refused: opted out, cap reached,
 * draft not approvable, …). The two arms are discriminated by `sent` vs
 * `skipped`.
 */
export type ApproveResult =
  | {
      queueItemId: string;
      sent: boolean;
      status: string;
      messageId: string | null;
    }
  | {
      skipped: true;
      reason: string;
      status?: string;
    };
