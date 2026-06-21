/**
 * Prospecting Workspace (S7) — prospecting capabilities as unified
 * Catalog_Entries (Design §Components #2 "Market catalog ingestion + comparables
 * + stats", #6 "The prospecting catalog tools").
 *
 * This module contributes the prospecting `CatalogEntry` objects to the single
 * canonical Tool_Catalog (`./catalog.ts`). It is the ONE place where the
 * market-intelligence reads and (later) the prospecting writes/provider calls
 * are exposed as audited, dispatchable tools — every agent step that reads
 * `market_*`, mutates state, calls a provider, or sends flows through
 * `dispatchTool` (Zod → RBAC → OTP → audit → execute) into one of these entries.
 * The handler is the ONLY place DB/market access happens (the dispatcher
 * boundary rule, Requirement 8.1).
 *
 * Entries contributed here:
 *
 *   - `find_comparables` — given a Prospecting_Brief, rank comparable external
 *     `market_projects` by similarity (the PURE {@link rankComparables}) and
 *     surface each comparable's SQL-sourced transaction stats (the SQL reader
 *     {@link comparableStats}). Reads ONLY the `market_*` mirror, so every figure
 *     is SQL-grounded — never model-computed — and each carries its own
 *     `source` + `asOf` (Requirements 11.3, 11.4). When the catalog is
 *     empty/unconfigured the tool returns no comparables and flags it
 *     (Requirement 11.5).
 *
 *   - `market_comps` — comps/index figures for an area/profile: per-project
 *     transaction stats plus the area/segment price-index rows, sourced ONLY
 *     from `market_*` (SQL), each figure stamped with `source` + `asOf`
 *     (Requirement 11.4, CC-SQL).
 *
 * Both are read-only (`requiresOtp: false`) and dispatch under the
 * `agent:prospecting` identity; their RBAC permission is built with the shared
 * {@link prospectingToolPermission} helper so the seeded role
 * (`PROSPECTING_AGENT_IDENTITIES`) grants exactly these names.
 *
 * The write/provider entries (`record_target`, `prospect_search`,
 * `enrich_target`, `draft_outreach`, `promote_target_to_lead`, `send_outreach`)
 * are appended to {@link prospectingCapabilityEntries} by task 3.3 — the array
 * and the {@link entry} helper below are structured so they can be added without
 * touching the read entries here.
 *
 * Design references: §Components #2, #6; §Architecture (agent identities and
 * RBAC). Requirements: 8.1, 11.3, 11.4, 11.5.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../../db";
import {
  adminConfirmations,
  marketProjects,
  marketPriceIndex,
  outreachDrafts,
  targets,
} from "../../schema";
import {
  PROSPECTING_AGENT_TOOL_PERMISSION_PREFIX,
  prospectingToolPermission,
} from "../../rbac/seed";
import {
  rankComparables,
  type MarketProjectRow,
} from "../../market/comparables";
import { comparableStats, type CompStats } from "../../market/stats";
import { prospectingBriefSchema } from "../../prospecting/brief";
import {
  TARGET_TYPES,
  provenancedFieldSchema,
} from "../../prospecting/target";
import { outreachDraftSchema } from "../../prospecting/outreach";
import { isOptedOut } from "../../prospecting/optout";
import {
  getConfiguredProviders,
  isUnconfigured,
  searchAllProviders,
  type EnrichmentProvider,
  type ProspectFilter,
  type ProviderId,
  type TargetRef,
} from "../../prospecting/providers";
// Side-effect import: register the concrete providers (incl. the env-gated demo
// provider) into the shared registry so the prospect_search fan-out finds them.
import "../../prospecting/providers/register";
import {
  resolveLeadByMatchKeys,
  upsertLead,
  type MatchKey,
} from "../../tickets/crm/dedupe";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import {
  defaultChannelAdapter,
  type ChannelAdapter,
} from "../../jobs/channel-adapter";
import { enqueueOutbox } from "../../outbox";
import { publishEvent, type DoeEventType } from "../../realtime/events";
import {
  loadCatalog,
  type Catalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";
import {
  LEAD_DISTRIBUTION_AGENT_ACTOR,
  loadLeadCapabilities,
} from "./lead-capabilities";
import type { ToolContext } from "./registry";

// ── Prospecting agent identity & permissions ─────────────────────────────────

/**
 * The RBAC identity (and audit actor) the prospecting navigator dispatches
 * under (Design §Architecture, "Agent identities and RBAC"). Seeded as the
 * `agent_prospecting` role granting exactly its catalog permissions — no
 * wildcard (RBAC seed, task 3.1).
 */
export const PROSPECTING_AGENT_ACTOR = "agent:prospecting";

/**
 * The RBAC identity (and audit actor) the Outreach_Agent dispatches under when
 * it composes a grounded {@link OutreachDraft} via `draft_outreach` (Design
 * §Architecture; §Components #7). Seeded as `agent_outreach`, granting ONLY
 * `prospecting:tool:draft_outreach` — never `send_outreach` (task 3.1).
 */
export const PROSPECTING_OUTREACH_AGENT_ACTOR = "agent:outreach";

/**
 * The audit actor recorded for a `send_outreach` dispatch. A send is NEVER
 * agent-grantable (Design §5 "No auto-send"); it runs only on a valid human
 * Approval_Flow token and is dispatched under the APPROVING REP's identity. The
 * concrete approving rep is `ctx.userId` (server-controlled), recorded by the
 * dispatcher; this constant is the entry-level default that documents the send
 * is a human-gated, rep-owned action rather than an agent step.
 */
export const PROSPECTING_OUTREACH_SEND_ACTOR = "rep:outreach";

// Re-export the shared permission helpers so catalog consumers need not reach
// into the RBAC seed module directly.
export {
  PROSPECTING_AGENT_TOOL_PERMISSION_PREFIX,
  prospectingToolPermission,
};

// ── entry() helper (mirrors lead-capabilities.ts) ────────────────────────────

/**
 * Keep per-entry input/output typing intact (the handler is checked against the
 * entry's Zod schemas) while collecting heterogeneous entries into one
 * `CatalogEntry[]` for {@link loadCatalog}. Task 3.3 reuses this helper for the
 * write/provider entries it appends.
 */
function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

// ── Shared output schemas (SQL-sourced, provenance-stamped figures) ──────────

/**
 * A single figure paired with the provenance of the record(s) it derives from,
 * mirroring {@link import("../../market/stats").StatFigure}. Each figure carries
 * its own `source` + `asOf` so the UI/outreach can stamp provenance (e.g.
 * "official DLD, Q1 2026" vs "reseller, cleaned" — Requirement 11.4).
 */
const statFigureSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    source: z.string().nullable(),
    asOf: z.string().nullable(),
  });

/** One bucket of the AGGREGATE buyer-segment mix (never individual PII). */
const buyerSegmentMixEntrySchema = z.object({
  segment: z.string(),
  count: z.number(),
  pct: z.number(),
});

/** SQL-sourced statistics for a single comparable market project. */
const compStatsSchema = z.object({
  marketProjectId: z.string(),
  txnCount: z.number(),
  recentSalePriceAed: statFigureSchema(z.number().nullable()),
  avgPricePerSqft: statFigureSchema(z.number().nullable()),
  velocitySalesLast12m: statFigureSchema(z.number().nullable()),
  buyerSegmentMix: statFigureSchema(z.array(buyerSegmentMixEntrySchema)),
});

// ── DB helpers (the handler is the only place market_* is read) ──────────────

/** ISO string for a nullable `as_of` timestamp, or null. */
function toIso(asOf: Date | null): string | null {
  return asOf instanceof Date ? asOf.toISOString() : (asOf ?? null);
}

/** Normalise free-text area/segment for case-insensitive comparison. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Does a market project's location (community / city / region / country) match
 * the requested area? Exact normalised match or containment either way counts.
 */
function projectMatchesArea(project: MarketProjectRow, area: string): boolean {
  const needle = normalizeText(area);
  if (!needle) return true; // no area filter → all projects qualify
  const haystacks = [
    project.communityName,
    project.city,
    project.region,
    project.country,
  ];
  return haystacks.some((raw) => {
    const hay = normalizeText(raw);
    return hay !== "" && (hay === needle || hay.includes(needle) || needle.includes(hay));
  });
}

// ── find_comparables ─────────────────────────────────────────────────────────

const findComparablesInput = z.object({
  /** The Prospecting_Brief to find comparable market projects for. */
  brief: prospectingBriefSchema,
  /** Max comparables to return (highest-ranked first). Defaults to 25. */
  limit: z.number().int().min(1).max(100).optional(),
});

const findComparablesOutput = z.object({
  comparables: z.array(
    z.object({
      marketProjectId: z.string(),
      name: z.string(),
      segment: z.string().nullable(),
      communityName: z.string().nullable(),
      /** Similarity in [0, 1] from the PURE ranker. */
      score: z.number(),
      reasons: z.array(z.string()),
      /** Provenance of the market_projects row itself (CC-Provenance). */
      source: z.string(),
      asOf: z.string().nullable(),
      /** SQL-sourced transaction stats for this comparable. */
      stats: compStatsSchema,
    })
  ),
  /**
   * True when the market catalog is empty/unconfigured — the agent proceeds
   * with a brief-only, low-evidence hypothesis (Requirement 11.5).
   */
  unconfigured: z.boolean(),
});

const findComparablesEntry = entry({
  name: "find_comparables",
  description:
    "Given a Prospecting_Brief, rank comparable external market projects by " +
    "similarity (area, segment, price band, unit mix) and return each with its " +
    "SQL-sourced transaction stats (recent price, price/sqft, velocity, " +
    "aggregate buyer-segment mix). Reads only the market_* mirror; every figure " +
    "carries its source and as-of date. Returns no comparables when the catalog " +
    "is empty/unconfigured.",
  inputSchema: findComparablesInput,
  outputSchema: findComparablesOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("find_comparables"),
  auditActor: PROSPECTING_AGENT_ACTOR,
  // The ONLY place market_* is read. Ranking is the PURE rankComparables; stats
  // come from the SQL reader comparableStats — the model never computes a figure.
  handler: async (db, _ctx, input) => {
    const limit = input.limit ?? 25;

    // SQL read over market_* ONLY — the full project catalog, ordered
    // deterministically so repeated reads over unchanged data are identical.
    const projects = (await db
      .select()
      .from(marketProjects)
      .orderBy(asc(marketProjects.id))) as MarketProjectRow[];

    // Empty/unconfigured catalog → no comparables (Requirement 11.5).
    if (projects.length === 0) {
      return { comparables: [], unconfigured: true };
    }

    // PURE deterministic ranking; keep only the projects that actually resemble
    // the brief (score > 0), highest-ranked first, capped at `limit`.
    const ranked = rankComparables(input.brief, projects)
      .filter((r) => r.score > 0)
      .slice(0, limit);

    if (ranked.length === 0) {
      return { comparables: [], unconfigured: false };
    }

    // SQL-sourced stats, in the same (ranked) order so output rows align.
    const rankedIds = ranked.map((r) => r.marketProjectId);
    const stats = await comparableStats(db, rankedIds);
    const statsById = new Map<string, CompStats>(
      stats.map((s) => [s.marketProjectId, s])
    );
    const projectsById = new Map<string, MarketProjectRow>(
      projects.map((p) => [p.id, p])
    );

    const comparables = ranked.map((r) => {
      const project = projectsById.get(r.marketProjectId)!;
      const projectStats =
        statsById.get(r.marketProjectId) ??
        ({
          marketProjectId: r.marketProjectId,
          txnCount: 0,
          recentSalePriceAed: { value: null, source: null, asOf: null },
          avgPricePerSqft: { value: null, source: null, asOf: null },
          velocitySalesLast12m: { value: null, source: null, asOf: null },
          buyerSegmentMix: { value: [], source: null, asOf: null },
        } satisfies CompStats);

      return {
        marketProjectId: r.marketProjectId,
        name: project.name,
        segment: project.segment ?? null,
        communityName: project.communityName ?? null,
        score: r.score,
        reasons: r.reasons,
        source: project.source,
        asOf: toIso(project.asOf),
        stats: projectStats,
      };
    });

    return { comparables, unconfigured: false };
  },
});

// ── market_comps ──────────────────────────────────────────────────────────────

const marketCompsInput = z.object({
  /** Area/community to pull comps + index figures for (e.g. "Palm Jumeirah"). */
  area: z.string().max(120).optional(),
  /** Optional segment filter. */
  segment: z.enum(["ultra_luxury", "luxury", "premium", "mid"]).optional(),
  /** Max comparable projects to return stats for. Defaults to 25. */
  limit: z.number().int().min(1).max(100).optional(),
});

const priceIndexRowSchema = z.object({
  // S7 increment (§4, Req 14.8): the stable `market_price_index` row id, so a
  // draft_outreach grounding manifest entry whose claim is grounded in this
  // Area_Trend can pin to it — `{ sourceTable: "market_price_index", recordId }`
  // re-resolves to this exact row (mirrors how a comp claim pins to a
  // `market_transactions` row by `id`). Additive + SQL-sourced: the Area_Trend
  // figure the model narrates is never model-computed (CC-SQL, extending Req 6.2).
  recordId: z.string(),
  areaName: z.string(),
  segment: z.string().nullable(),
  period: z.string(),
  indexValue: z.number().nullable(),
  avgPricePerSqft: z.number().nullable(),
  yoyPct: z.number().nullable(),
  // S7 increment (§4, Req 14.7): Area_Trend figures carried from the reseller
  // summary block (`market_price_index.roi_pct`/`.volume`/`.trend`, added in
  // task 10.1). Additive + optional — existing consumers/tests ignore them.
  // Every figure in this row shares the row-level `source` + `asOf` below, so
  // each Area_Trend figure (avg price/sqft, YoY, ROI, volume, raw trend) is
  // provenance-stamped (Req 14.7, CC-Provenance, Property 16).
  /** ROI %, when carried by the source summary. */
  roiPct: z.number().nullable().optional(),
  /** Transaction volume backing the index period. */
  volume: z.number().nullable().optional(),
  /** Raw summary block (e.g. saleAvgPrice + *_change figures), as ingested. */
  trend: z.unknown().nullable().optional(),
  source: z.string(),
  asOf: z.string().nullable(),
});

const marketCompsOutput = z.object({
  area: z.string().nullable(),
  segment: z.string().nullable(),
  /** Per-project transaction stats for the matching area/profile. */
  comps: z.array(compStatsSchema),
  /** Area/segment price-index figures, each stamped with source + as-of. */
  priceIndex: z.array(priceIndexRowSchema),
  /** True when neither comps nor index figures exist for the area/profile. */
  unconfigured: z.boolean(),
});

const marketCompsEntry = entry({
  name: "market_comps",
  description:
    "Return comparable transaction stats and price-index figures for an area " +
    "and/or segment, sourced only from the market_* mirror (SQL). Each figure " +
    "carries its source and as-of date. The model narrates these figures; it " +
    "never computes them.",
  inputSchema: marketCompsInput,
  outputSchema: marketCompsOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("market_comps"),
  auditActor: PROSPECTING_AGENT_ACTOR,
  // The ONLY place market_* is read. Project selection + index reads are SQL;
  // per-project stats come from the SQL reader comparableStats.
  handler: async (db, _ctx, input) => {
    const limit = input.limit ?? 25;
    const area = input.area?.trim() || null;
    const segment = input.segment ?? null;

    // SQL read over market_projects — filter by segment in SQL (indexed), match
    // the free-text area client-side. Deterministic id ordering for stable output.
    const projectRows = (await db
      .select()
      .from(marketProjects)
      .where(segment ? eq(marketProjects.segment, segment) : undefined)
      .orderBy(asc(marketProjects.id))) as MarketProjectRow[];

    const matchingProjects = (area
      ? projectRows.filter((p) => projectMatchesArea(p, area))
      : projectRows
    ).slice(0, limit);

    const comps =
      matchingProjects.length > 0
        ? await comparableStats(
            db,
            matchingProjects.map((p) => p.id)
          )
        : [];

    // SQL read over market_price_index — area/segment index rows, latest period
    // first, then deterministic source/id ordering.
    const indexRows = await db
      .select({
        id: marketPriceIndex.id,
        areaName: marketPriceIndex.areaName,
        segment: marketPriceIndex.segment,
        period: marketPriceIndex.period,
        indexValue: marketPriceIndex.indexValue,
        avgPricePerSqft: marketPriceIndex.avgPricePerSqft,
        yoyPct: marketPriceIndex.yoyPct,
        roiPct: marketPriceIndex.roiPct,
        volume: marketPriceIndex.volume,
        trend: marketPriceIndex.trend,
        source: marketPriceIndex.source,
        asOf: marketPriceIndex.asOf,
      })
      .from(marketPriceIndex)
      .where(segment ? eq(marketPriceIndex.segment, segment) : undefined)
      .orderBy(
        desc(marketPriceIndex.period),
        asc(marketPriceIndex.source),
        asc(marketPriceIndex.id)
      );

    const priceIndex = indexRows
      .filter((r) => (area ? projectMatchesAreaName(r.areaName, area) : true))
      .map((r) => ({
        recordId: r.id,
        areaName: r.areaName,
        segment: r.segment ?? null,
        period: r.period,
        indexValue: r.indexValue ?? null,
        avgPricePerSqft: r.avgPricePerSqft ?? null,
        yoyPct: r.yoyPct ?? null,
        // Area_Trend figures (Req 14.7) — share this row's source + asOf below.
        roiPct: r.roiPct ?? null,
        volume: r.volume ?? null,
        trend: r.trend ?? null,
        source: r.source,
        asOf: toIso(r.asOf),
      }));

    return {
      area,
      segment,
      comps,
      priceIndex,
      unconfigured: comps.length === 0 && priceIndex.length === 0,
    };
  },
});

/** Area match against a single index `area_name` value. */
function projectMatchesAreaName(areaName: string, area: string): boolean {
  const needle = normalizeText(area);
  if (!needle) return true;
  const hay = normalizeText(areaName);
  return hay !== "" && (hay === needle || hay.includes(needle) || needle.includes(hay));
}

// ═══════════════════════════════════════════════════════════════════════════
// Write / provider Catalog_Entries (task 3.3)
//
// These are the prospecting MUTATIONS, provider fan-outs, and the human-gated
// send. Each is the ONLY place its DB write / provider call / external send
// happens (the dispatcher boundary, Req 8.1) — agents reason and plan, but
// reach the world only through these handlers behind `dispatchTool`.
//
//   - record_target          write `targets`; phone → salted hash, provenance
//                             stamped (Req 1.3, 1.5, CC-Privacy, CC-Provenance)
//   - prospect_search         provider search fan-out → candidate Targets (Req 2.1)
//   - enrich_target           provider enrich fan-out → provenanced attributes
//                             (Req 3.1, 3.2)
//   - draft_outreach          grounded, editable, UNSENT OutreachDraft (Req 6.1)
//   - promote_target_to_lead  S2 dedupe → upsertLead; attach/create/none (Req 5.2–5.4)
//   - send_outreach           human Approval_Flow token + opt-out gate + send
//                             via ChannelAdapter + outbox side effect (Req 7.1–7.3)
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Normalise an email for storage / matching: lower-cased + trimmed (the same
 * normalisation the dedupe + opt-out stores apply, so a Target's email lines up
 * with what `resolveLeadByMatchKeys` / `isOptedOut` look up).
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Build the {@link MatchKey}s to resolve/link a Target against the party graph
 * (mirrors `buildMatchKeys` in lead-capabilities.ts). A phone is contributed
 * ONLY as its salted `phone_hash`, never raw (CC-Privacy); an un-normalizable
 * phone is skipped (resolution short-circuits to `error` before linking).
 */
function buildMatchKeys(input: { phone?: string; email?: string }): MatchKey[] {
  const keys: MatchKey[] = [];
  if (input.phone !== undefined) {
    try {
      keys.push({
        kind: "phone_hash",
        value: computePhoneHash(normalizePhoneToE164(input.phone)),
      });
    } catch {
      // Un-normalizable phone — skip; resolution returns `error` before here.
    }
  }
  if (input.email !== undefined) {
    keys.push({ kind: "email", value: normalizeEmail(input.email) });
  }
  return keys;
}

// ── Prospecting lifecycle event types (cast until task 5.4) ──────────────────
//
// TODO(task 5.4): the `prospecting.*` event types are added to the
// `DoeEventType` union in `lib/cms/realtime/events.ts`. `events.type` is plain
// `text`, so publishing them is safe at runtime today and needs no migration;
// until 5.4 lands we cast at the publish sites (the same precedent the
// lead-engine capabilities set for the `lead.*` family).
const PROSPECTING_TARGET_PROMOTED_EVENT =
  "prospecting.target.promoted" as DoeEventType;
const PROSPECTING_OUTREACH_DRAFTED_EVENT =
  "prospecting.outreach.drafted" as DoeEventType;
const PROSPECTING_OUTREACH_APPROVED_EVENT =
  "prospecting.outreach.approved" as DoeEventType;
const PROSPECTING_OUTREACH_SENT_EVENT =
  "prospecting.outreach.sent" as DoeEventType;
const PROSPECTING_OUTREACH_SUPPRESSED_EVENT =
  "prospecting.outreach.suppressed" as DoeEventType;

// ── record_target ──────────────────────────────────────────────────────────────

const recordTargetInput = z.object({
  /** Optional Prospecting_Brief this Target was discovered for. */
  briefId: z.string().uuid().optional(),
  targetType: z.enum(TARGET_TYPES),
  displayName: z.string().max(255).optional(),
  companyName: z.string().max(255).optional(),
  title: z.string().max(160).optional(),
  /** Normalized lower-cased; the matchable identity for dedupe. */
  email: z.string().max(254).optional(),
  /** Raw phone — hashed to `phone_hash`; the raw copy is held transiently only. */
  phone: z.string().optional(),
  country: z.string().max(60).optional(),
  /** Per-field provenance map (key → value/source/asOf/lawfulBasis). */
  attributes: z.record(z.string(), provenancedFieldSchema).default({}),
  /** Record-acquisition provenance: the provider this Target came from (Req 1.3). */
  sourceProvider: z.string(),
  sourceRef: z.string().optional(),
  /** Record-level lawful basis for holding this Target's data (Req 9.1). */
  lawfulBasis: z.string(),
});

const recordTargetOutput = z.object({
  targetId: z.string().uuid(),
  /** The salted hash the phone was stored as, or null when no phone was given. */
  phoneHash: z.string().nullable(),
});

const recordTargetEntry = entry({
  name: "record_target",
  description:
    "Persist a prospective Target (person / company / intermediary). The phone " +
    "is stored only as a salted hash (the raw number is held transiently for an " +
    "eventual Salesforce-bound payload, never surfaced); per-field provenance is " +
    "stamped on each attribute and the record carries its acquisition source and " +
    "lawful basis. A Target is NOT a Lead and NOT a tickets row.",
  inputSchema: recordTargetInput,
  outputSchema: recordTargetOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("record_target"),
  auditActor: PROSPECTING_AGENT_ACTOR,
  // The ONLY place `targets` is written. Phone → E.164 → salted hash (never
  // persisted raw beyond the transient `raw_phone` column, purged ≤24h by task
  // 8.1). Provenance is persisted field-identically (CC-Provenance, Req 1.3).
  handler: async (db, _ctx, input) => {
    // Phone → salted hash. An un-normalizable phone yields no hash (we still
    // record the Target — the phone simply is not a usable identity).
    let phoneHash: string | null = null;
    let rawPhone: string | null = null;
    if (input.phone !== undefined && input.phone.trim() !== "") {
      try {
        phoneHash = computePhoneHash(normalizePhoneToE164(input.phone));
        rawPhone = input.phone; // transient only (CC-Privacy, Req 1.5)
      } catch {
        phoneHash = null;
        rawPhone = null;
      }
    }

    const [row] = await db
      .insert(targets)
      .values({
        briefId: input.briefId ?? null,
        targetType: input.targetType,
        displayName: input.displayName ?? null,
        companyName: input.companyName ?? null,
        title: input.title ?? null,
        email: input.email ? normalizeEmail(input.email) : null,
        phoneHash,
        rawPhone,
        country: input.country ?? null,
        attributes: input.attributes,
        sourceProvider: input.sourceProvider,
        sourceRef: input.sourceRef ?? null,
        lawfulBasis: input.lawfulBasis,
      })
      .returning({ id: targets.id });

    return { targetId: row.id, phoneHash };
  },
});

// ── prospect_search ──────────────────────────────────────────────────────────

/** An ICP filter for `prospect_search`, mirroring {@link ProspectFilter}. */
const prospectFilterSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  geography: z.array(z.string().max(80)).max(40).optional(),
  titles: z.array(z.string().max(80)).max(40).optional(),
  seniority: z.array(z.string().max(60)).max(20).optional(),
  companySize: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .optional(),
  industries: z.array(z.string().max(80)).max(40).optional(),
  fundingSignals: z.array(z.string().max(80)).max(20).optional(),
  wealthSignals: z.array(z.string().max(80)).max(20).optional(),
  keywords: z.array(z.string().max(80)).max(20).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/** A candidate Target from a provider search, mirroring `ProviderResult`. */
const providerCandidateSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  displayName: z.string().optional(),
  companyName: z.string().optional(),
  title: z.string().optional(),
  email: z.string().optional(),
  /** Raw provider phone, held transiently for `record_target` to hash — never persisted raw here. */
  phone: z.string().optional(),
  country: z.string().optional(),
  attributes: z.record(z.string(), provenancedFieldSchema),
  sourceProvider: z.string(),
  sourceRef: z.string().optional(),
  lawfulBasis: z.string(),
});

const prospectSearchInput = z.object({
  /** The ICP filter to fan out to the configured providers. */
  filter: prospectFilterSchema,
});

const prospectSearchOutput = z.object({
  candidates: z.array(providerCandidateSchema),
  /** Provider ids skipped because their credentials are absent (Req 2.4). */
  unconfiguredProviders: z.array(z.string()),
  /** Provider ids that threw and were skipped (the search still succeeds). */
  failedProviders: z.array(z.string()),
});

const prospectSearchEntry = entry({
  name: "prospect_search",
  description:
    "Search for candidate Targets matching an ICP filter (target type, " +
    "geography, titles/seniority, company size/industry, funding & wealth " +
    "signals). Fans the filter out across the configured Account/Person " +
    "providers; a provider with absent credentials is skipped without failing " +
    "the search. Every candidate field carries its provider source.",
  inputSchema: prospectSearchInput,
  outputSchema: prospectSearchOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("prospect_search"),
  auditActor: PROSPECTING_AGENT_ACTOR,
  // The ONLY place the provider search fan-out happens. Caching window / job
  // idempotency is task 4.2; here we wire the fan-out and return candidates.
  handler: async (_db, _ctx, input) => {
    const { results, unconfiguredProviders, failedProviders } =
      await searchAllProviders(input.filter as ProspectFilter);

    return {
      candidates: results.map((r) => ({
        targetType: r.targetType,
        displayName: r.displayName,
        companyName: r.companyName,
        title: r.title,
        email: r.email,
        phone: r.phone,
        country: r.country,
        attributes: r.attributes,
        sourceProvider: r.sourceProvider,
        sourceRef: r.sourceRef,
        lawfulBasis: r.lawfulBasis,
      })),
      unconfiguredProviders,
      failedProviders,
    };
  },
});

// ── enrich_target ──────────────────────────────────────────────────────────────

/**
 * Fan a Target's enrichment out across the configured providers and merge their
 * provenanced attributes (the enrich counterpart to {@link searchAllProviders}).
 * A provider returning `{ unconfigured: true }` is skipped; one that throws is
 * isolated so a single flaky source cannot sink the run. Later providers'
 * attributes win on a key collision (a deterministic last-write merge in the
 * canonical provider order).
 */
async function enrichAllProviders(
  target: TargetRef,
  providers: EnrichmentProvider[] = getConfiguredProviders()
): Promise<{
  attributes: Record<string, z.infer<typeof provenancedFieldSchema>>;
  unconfiguredProviders: ProviderId[];
  failedProviders: ProviderId[];
}> {
  const attributes: Record<string, z.infer<typeof provenancedFieldSchema>> = {};
  const unconfiguredProviders: ProviderId[] = [];
  const failedProviders: ProviderId[] = [];

  const settled = await Promise.allSettled(
    providers.map((p) => p.enrich(target))
  );

  settled.forEach((outcome, i) => {
    const provider = providers[i];
    if (outcome.status === "rejected") {
      failedProviders.push(provider.id);
      return;
    }
    if (isUnconfigured(outcome.value)) {
      unconfiguredProviders.push(provider.id);
      return;
    }
    Object.assign(attributes, outcome.value.attributes);
  });

  return { attributes, unconfiguredProviders, failedProviders };
}

const enrichTargetInput = z.object({
  /** The Target to enrich. */
  targetId: z.string().uuid(),
});

const enrichTargetOutput = z.object({
  targetId: z.string().uuid(),
  /** The Target's merged per-field provenance map after enrichment. */
  attributes: z.record(z.string(), provenancedFieldSchema),
  unconfiguredProviders: z.array(z.string()),
  failedProviders: z.array(z.string()),
});

const enrichTargetEntry = entry({
  name: "enrich_target",
  description:
    "Assemble Account/Person intelligence for an existing Target by fanning out " +
    "to the configured providers and merging the returned attributes onto the " +
    "Target. Every merged field carries its provider source, as-of date, and " +
    "(for PII) lawful basis; a provider with absent credentials is skipped.",
  inputSchema: enrichTargetInput,
  outputSchema: enrichTargetOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("enrich_target"),
  auditActor: PROSPECTING_AGENT_ACTOR,
  // The ONLY place the provider enrich fan-out + the resulting `targets` write
  // happen. The enrichment_fetch job idempotency is task 4.2/6.3; here we wire
  // the fan-out and persist the provenanced attributes (Req 3.1, 3.2).
  handler: async (db, _ctx, input) => {
    const [target] = await db
      .select({
        id: targets.id,
        displayName: targets.displayName,
        companyName: targets.companyName,
        email: targets.email,
        rawPhone: targets.rawPhone,
        country: targets.country,
        sourceRef: targets.sourceRef,
        attributes: targets.attributes,
      })
      .from(targets)
      .where(eq(targets.id, input.targetId))
      .limit(1);

    if (!target) {
      throw new Error(`enrich_target: target "${input.targetId}" not found`);
    }

    const ref: TargetRef = {
      targetId: target.id,
      displayName: target.displayName ?? undefined,
      companyName: target.companyName ?? undefined,
      email: target.email ?? undefined,
      phone: target.rawPhone ?? undefined, // transient lookup only — never persisted raw
      country: target.country ?? undefined,
      sourceRef: target.sourceRef ?? undefined,
    };

    const { attributes, unconfiguredProviders, failedProviders } =
      await enrichAllProviders(ref);

    // Merge onto any existing per-field provenance map; new provider fields win.
    const existing =
      (target.attributes as Record<
        string,
        z.infer<typeof provenancedFieldSchema>
      > | null) ?? {};
    const merged = { ...existing, ...attributes };

    await db
      .update(targets)
      .set({ attributes: merged, status: "researching", updatedAt: new Date() })
      .where(eq(targets.id, input.targetId));

    return {
      targetId: input.targetId,
      attributes: merged,
      unconfiguredProviders,
      failedProviders,
    };
  },
});

// ── draft_outreach ──────────────────────────────────────────────────────────────

const draftOutreachOutput = z.object({
  draftId: z.string().uuid(),
  status: z.enum(["draft", "approved", "sent", "suppressed"]),
  draft: outreachDraftSchema,
});

const draftOutreachEntry = entry({
  name: "draft_outreach",
  description:
    "Persist an editable, UNSENT outreach draft for a researched Target in the " +
    "requested channel and language, carrying a grounding manifest that pins " +
    "every factual claim to a real SQL record. Does NOT send — a send requires " +
    "a separate human Approval_Flow token via send_outreach.",
  inputSchema: outreachDraftSchema,
  outputSchema: draftOutreachOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("draft_outreach"),
  auditActor: PROSPECTING_OUTREACH_AGENT_ACTOR,
  // The ONLY place `outreach_drafts` is written by the Outreach_Agent. The draft
  // is created `draft` (unsent); the grounding manifest is persisted verbatim so
  // the send path and the grounded-outreach property test can re-resolve every
  // claim against its named SQL source (Req 6.1, 6.2).
  //
  // S7 increment (§4, Req 14.8): the grounding `sourceTable` enum already permits
  // both market tables, so the manifest contract is unchanged. A claim grounded
  // in the Area_Trend pins to a `market_price_index` row by `recordId` (the id
  // surfaced by `market_comps`, now carrying ROI/volume/YoY); a claim grounded in
  // a specific comp pins to a `market_transactions` row by `id`. Every market /
  // Area_Trend figure in a draft therefore comes from SQL, never model-computed
  // (CC-SQL, extending Req 6.2).
  handler: async (db, _ctx, input) => {
    const [row] = await db
      .insert(outreachDrafts)
      .values({
        targetId: input.targetId,
        briefId: input.briefId ?? null,
        channel: input.channel,
        language: input.language,
        subject: input.subject ?? null,
        body: input.body,
        grounding: input.grounding,
        status: "draft",
      })
      .returning({ id: outreachDrafts.id });

    await publishEvent(db, {
      type: PROSPECTING_OUTREACH_DRAFTED_EVENT,
      payload: { draftId: row.id, targetId: input.targetId, channel: input.channel },
    });

    return { draftId: row.id, status: "draft" as const, draft: input };
  },
});

// ── S3 lead-engine handoff (reuse S3 routing + DNA, Req 5.3) ─────────────────
//
// Once promotion has produced a `partyId`, a promoted prospect must enter the
// EXACT inbound pipeline an S3 Lead does: S3 routing (`assign_lead_owner`,
// project × language × capacity) selects + records the owning rep, and the S3
// enrichment/DNA step (`score_lead`) tiers the Lead from its mirror signals
// (Design §Components #5; Requirement 5.3). These are REUSED S3 capabilities,
// never re-implemented here.
//
// They run as INTERNAL effects of the single audited `promote_target_to_lead`
// action — the dispatcher already wrote the one audit row for the promotion —
// so the S3 catalog handlers are invoked DIRECTLY rather than through a second
// dispatch: the exact S3 logic (no new routing, no duplicate audit row). The
// handoff is BEST-EFFORT: a routing/DNA failure (e.g. an unconfigured rep table
// or model gateway) never undoes a promoted Lead — the Lead exists, the Target
// is stamped, and the case is surfaced for follow-up (P-NoDrop spirit, Req 5.4).

/** Lazily-loaded S3 lead-engine catalog (the routing + scoring handlers). */
let leadEngineCatalog: Catalog | null = null;
function leadEngineHandler(name: string): CatalogEntry | undefined {
  if (leadEngineCatalog === null) {
    leadEngineCatalog = loadLeadCapabilities().catalog;
  }
  return leadEngineCatalog.get(name);
}

/**
 * Hand a freshly-promoted Lead (`partyId`) to the S3 lead-engine: route it via
 * `assign_lead_owner` and assemble its DNA via `score_lead`. Reuses the S3
 * handlers directly (the promotion's single audit row covers the whole action);
 * each step is isolated so a failure never undoes the promotion. Returns the
 * assigned owning rep id when routing succeeded, else null.
 */
async function handOffPromotedLeadToS3(
  db: Database,
  partyId: string
): Promise<{ repId: string | null }> {
  const ctx: ToolContext = { actor: LEAD_DISTRIBUTION_AGENT_ACTOR };
  let repId: string | null = null;

  // S3 ROUTING — reuse assign_lead_owner (selectRep + persist + lead.routed).
  try {
    const assign = leadEngineHandler("assign_lead_owner");
    if (assign) {
      const routed = (await assign.handler(db, ctx, { partyId })) as {
        repId?: string | null;
      };
      repId = typeof routed?.repId === "string" ? routed.repId : null;
    }
  } catch {
    // Best-effort: a routing failure never undoes a promoted Lead (Req 5.4).
  }

  // S3 ENRICHMENT/DNA — reuse score_lead to tier the new Lead from its mirror.
  try {
    const score = leadEngineHandler("score_lead");
    if (score) {
      await score.handler(db, ctx, { partyId });
    }
  } catch {
    // Best-effort: an enrichment/DNA failure never undoes a promoted Lead.
  }

  return { repId };
}

// ── promote_target_to_lead ──────────────────────────────────────────────────────

const promoteTargetInput = z.object({
  targetId: z.string().uuid(),
  phone: z.string().optional(),
  email: z.string().optional(),
  sfLeadId: z.string().optional(),
});

const promoteTargetOutput = z.object({
  resolution: z.enum(["match", "new", "conflict", "error"]),
  partyId: z.string().nullable(),
});

const promoteTargetToLeadEntry = entry({
  name: "promote_target_to_lead",
  description:
    "Promote a qualified Target into the DOE party graph using the S2 dedupe " +
    "core: attach to the existing Party on a match, create the parties + " +
    "leads_mirror pairing on a new contact, and create NOTHING on a conflict or " +
    "error (surfaced for human resolution). On success the Target is stamped " +
    "with its party id and status=promoted.",
  inputSchema: promoteTargetInput,
  outputSchema: promoteTargetOutput,
  requiresOtp: false,
  permission: prospectingToolPermission("promote_target_to_lead"),
  auditActor: PROSPECTING_AGENT_ACTOR,
  // Promotion is entirely S2 reuse (resolveLeadByMatchKeys + upsertLead) — never
  // re-implements identity resolution. A Target is never a tickets row; it is
  // promoted into parties + leads_mirror (Req 5.1–5.4). Once a partyId exists the
  // new Lead is handed to the S3 lead-engine — routed (assign_lead_owner) and
  // DNA-assembled (score_lead) — so a promoted prospect enters the EXACT pipeline
  // an inbound Lead does (Req 5.3); that handoff reuses S3 unchanged.
  handler: async (db, _ctx, input) => {
    const r = await resolveLeadByMatchKeys(db, {
      phone: input.phone,
      email: input.email,
      sfLeadId: input.sfLeadId,
    });

    // conflict → attach nothing; surface for human resolution (Req 5.4).
    if (r.kind === "conflict") {
      await publishEvent(db, {
        type: PROSPECTING_TARGET_PROMOTED_EVENT,
        payload: {
          targetId: input.targetId,
          resolution: "conflict",
          candidatePartyIds: r.candidatePartyIds,
        },
      });
      return { resolution: "conflict" as const, partyId: null };
    }

    // error → create nothing; the Target is retained (Req 5.4).
    if (r.kind === "error") {
      return { resolution: "error" as const, partyId: null };
    }

    // match → attach to the resolved Party; new → create parties + leads_mirror
    // (Req 5.2, 5.3). Identities are linked idempotently by upsertLead.
    const up = await upsertLead(db, {
      partyId: r.kind === "match" ? r.partyId : undefined,
      identities: buildMatchKeys(input),
      sfLeadId: input.sfLeadId,
      mirror: {},
    });

    // Stamp the Target with its resolved party + promoted status.
    await db
      .update(targets)
      .set({ partyId: up.partyId, status: "promoted", updatedAt: new Date() })
      .where(eq(targets.id, input.targetId));

    // Hand the promoted Lead to the S3 lead-engine — route it (assign_lead_owner)
    // and assemble its DNA (score_lead), reusing S3 unchanged (Req 5.3). The
    // handoff is best-effort: a failure never undoes the promoted Lead (Req 5.4).
    const { repId } = await handOffPromotedLeadToS3(db, up.partyId);

    await publishEvent(db, {
      type: PROSPECTING_TARGET_PROMOTED_EVENT,
      payload: {
        targetId: input.targetId,
        partyId: up.partyId,
        resolution: r.kind,
        repId,
      },
    });

    return { resolution: r.kind, partyId: up.partyId };
  },
});

// ── send_outreach — human Approval_Flow gate (Req 7.1, 7.2, 7.3) ─────────────
//
// The SECOND of the two human-gated dispatches: presenting the single-use,
// short-TTL, user-AND-draft-bound Approval_Flow token issued by
// `approve_outreach`. It executes only on a valid token — the SAME reused S1
// admin confirmation pattern (`DurableOutreachApprovalStore` above), bound
// additionally to the specific draft so a token for draft A can never send
// draft B. The token is NEVER agent-grantable (Design §5 "No auto-send"); the
// send runs under the approving rep's identity and the dispatcher writes the
// single send audit row (so approve + send → exactly two audit rows, Req 7.4).
//
// On a valid token this sends via the ChannelAdapter, enqueues the CRM side
// effect to the outbox under the draft's `outreach_send:{draftId}` jobKey
// (at-most-once, shared with the async `outreach_send` job), and sets
// `outreach_drafts.status=sent`. It refuses on opt-out and on an expired /
// reused / wrong-user / wrong-draft token. No raw phone enters any event /
// audit / outbox payload (CC-Privacy, Req 9.2). The store and ChannelAdapter
// are injectable seams so the durable store / a fake adapter swap in without
// touching the entry.

/** Single-use Approval_Flow token TTL (mirrors the admin confirmation TTL). */
export const OUTREACH_APPROVAL_TTL_MS = 5 * 60_000;

/** Re-approve prompt returned when a token cannot be honoured (Req 7.1). */
export const OUTREACH_REISSUE_PROMPT =
  "That approval has expired, was already used, wasn't issued to you, or doesn't " +
  "match this draft — please re-approve the outreach to get a fresh approval.";

/** A persisted Approval_Flow token bound to a rep AND a specific draft. */
export interface OutreachApprovalRecord {
  token: string;
  /** The approving rep the token is bound to (Req 7.1). */
  userId: string;
  /** The draft the token authorises sending (Req 7.1). */
  draftId: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** Why a token could not be consumed — each maps to a re-approve refusal. */
export type OutreachApprovalRejectReason =
  | "not_found"
  | "wrong_user"
  | "wrong_draft"
  | "expired"
  | "already_consumed";

export type OutreachApprovalConsumeResult =
  | { ok: true; record: OutreachApprovalRecord }
  | { ok: false; reason: OutreachApprovalRejectReason };

/**
 * The Approval_Flow token store contract. The in-memory default below makes
 * `send_outreach` complete + testable today; task 6.2 supplies the durable,
 * user-bound store via {@link setOutreachApprovalStore} WITHOUT changing the
 * entry. `db` is passed through for a future durable, table-backed store.
 */
export interface OutreachApprovalStore {
  issue(
    db: Database,
    userId: string,
    draftId: string,
    ttlMs: number
  ): Promise<OutreachApprovalRecord>;
  consume(
    db: Database,
    token: string,
    userId: string,
    draftId: string
  ): Promise<OutreachApprovalConsumeResult>;
}

/**
 * Default, in-memory Approval_Flow token store. Single-process and non-durable —
 * the seam default until task 6.2 replaces it with a durable store. The
 * single-use + expiry + user-and-draft binding it implements is exactly what the
 * durable store must preserve.
 */
export class InMemoryOutreachApprovalStore implements OutreachApprovalStore {
  private readonly tokens = new Map<string, OutreachApprovalRecord>();

  async issue(
    _db: Database,
    userId: string,
    draftId: string,
    ttlMs: number
  ): Promise<OutreachApprovalRecord> {
    const now = Date.now();
    const record: OutreachApprovalRecord = {
      token: randomUUID(),
      userId,
      draftId,
      issuedAt: new Date(now),
      expiresAt: new Date(now + ttlMs),
      consumedAt: null,
    };
    this.tokens.set(record.token, record);
    return record;
  }

  async consume(
    _db: Database,
    token: string,
    userId: string,
    draftId: string
  ): Promise<OutreachApprovalConsumeResult> {
    const rec = this.tokens.get(token);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.userId !== userId) return { ok: false, reason: "wrong_user" };
    if (rec.draftId !== draftId) return { ok: false, reason: "wrong_draft" };
    if (rec.consumedAt) return { ok: false, reason: "already_consumed" };
    if (rec.expiresAt.getTime() <= Date.now())
      return { ok: false, reason: "expired" };

    rec.consumedAt = new Date();
    this.tokens.set(token, rec);
    return { ok: true, record: rec };
  }
}

let outreachApprovalStore: OutreachApprovalStore =
  new InMemoryOutreachApprovalStore();

/** The active Approval_Flow token store. */
export function getOutreachApprovalStore(): OutreachApprovalStore {
  return outreachApprovalStore;
}

/** Replace the active token store (task 6.2 wiring + tests). */
export function setOutreachApprovalStore(store: OutreachApprovalStore): void {
  outreachApprovalStore = store;
}

/** Test-only: restore the default in-memory token store. */
export function _resetOutreachApprovalStoreForTests(): void {
  outreachApprovalStore = new InMemoryOutreachApprovalStore();
}

// ── Durable Approval_Flow store — REUSE of the S1 admin confirmation flow ─────
//
// Task 6.2 makes the human-gated send durable by REUSING the S1 admin
// confirmation-token Approval_Flow — the SAME single-use, short-TTL, user-bound
// token mechanism (and the SAME `admin_confirmations` table) the
// Admin_Confirmation_Flow uses (`admin-capabilities.ts` /
// `DurableAdminConfirmationStore`). No new token mechanism and no new migration
// are introduced (Design §Components #7, "reused admin confirmation pattern";
// Requirement 7.1).
//
// An outreach approval is persisted as an `admin_confirmations` row stamped
// `kind = "outreach_send"` with `args = { draftId }`, so the token is bound to
// BOTH the approving rep (`user_id`) AND the specific draft (`args.draftId`) —
// a token issued for draft A can never send draft B. Consuming is the same
// atomic, single-use conditional `UPDATE … WHERE consumed_at IS NULL AND
// expires_at > now AND user_id = $u RETURNING` the admin flow uses, so the token
// authorises EXACTLY ONE send and can never be replayed (Req 7.1, CC-Idem). A
// rejected token is NOT consumed and is classified for the re-approve prompt.

/** The `admin_confirmations.kind` discriminator used for outreach approvals. */
export const OUTREACH_APPROVAL_KIND = "outreach_send";

/**
 * Matches a canonical RFC-4122 UUID. The `token` column is a Postgres `uuid`
 * primary key, so a non-UUID token can never name an existing row — classify it
 * as `not_found` rather than letting Postgres raise on an invalid uuid literal
 * (mirrors {@link DurableAdminConfirmationStore}).
 */
const OUTREACH_TOKEN_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the draft id an approval row is bound to (the `args.draftId` marker). */
function boundDraftId(args: unknown): string | null {
  const draftId = (args as { draftId?: unknown } | null | undefined)?.draftId;
  return typeof draftId === "string" ? draftId : null;
}

/**
 * Durable Approval_Flow store backed by the S1 `admin_confirmations` table.
 *
 * This is the production implementation of {@link OutreachApprovalStore}: it
 * REUSES the admin confirmation-token mechanism (same table, same single-use
 * atomic consume), adding only the draft binding via `args.draftId`. It
 * preserves the in-memory default's semantics:
 *
 *   • {@link issue} writes a token row bound to `userId` + `draftId` with a
 *     future `expiresAt` and a null `consumedAt`, mutating no business state.
 *   • {@link consume} validates user + draft binding WITHOUT consuming on a
 *     mismatch, then atomically stamps `consumed_at` iff the token is currently
 *     unconsumed, unexpired, AND bound to this user — so two racing sends can
 *     never both succeed (single-use, Req 7.1 / CC-Idem). A token the predicate
 *     rejects is classified `not_found` / `wrong_user` / `wrong_draft` /
 *     `expired` / `already_consumed` for the re-approve prompt.
 */
export class DurableOutreachApprovalStore implements OutreachApprovalStore {
  async issue(
    db: Database,
    userId: string,
    draftId: string,
    ttlMs: number
  ): Promise<OutreachApprovalRecord> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const [row] = await db
      .insert(adminConfirmations)
      .values({
        userId,
        kind: OUTREACH_APPROVAL_KIND,
        args: { draftId },
        expiresAt,
        consumedAt: null,
      })
      .returning();
    return {
      token: row.token,
      userId: row.userId,
      draftId,
      issuedAt: row.createdAt ?? now,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  async consume(
    db: Database,
    token: string,
    userId: string,
    draftId: string
  ): Promise<OutreachApprovalConsumeResult> {
    // A non-UUID token can never match the uuid PK; classify without querying.
    if (!OUTREACH_TOKEN_UUID_RE.test(token)) {
      return { ok: false, reason: "not_found" };
    }

    const now = new Date();

    // Classify binding mismatches WITHOUT consuming (a rejected token is never
    // spent — mirrors the in-memory default). The atomic UPDATE below is what
    // actually guarantees single-use for the valid-token path.
    const [existing] = await db
      .select()
      .from(adminConfirmations)
      .where(eq(adminConfirmations.token, token))
      .limit(1);

    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.userId !== userId) return { ok: false, reason: "wrong_user" };
    if (boundDraftId(existing.args) !== draftId) {
      return { ok: false, reason: "wrong_draft" };
    }
    if (existing.consumedAt) return { ok: false, reason: "already_consumed" };
    if (existing.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }

    // Atomic single-use consume: stamp consumed_at iff still unconsumed,
    // unexpired, AND bound to this user. One statement, so concurrent sends
    // race on the write and at most one wins (Req 7.1 / CC-Idem).
    const [consumed] = await db
      .update(adminConfirmations)
      .set({ consumedAt: now })
      .where(
        and(
          eq(adminConfirmations.token, token),
          eq(adminConfirmations.userId, userId),
          isNull(adminConfirmations.consumedAt),
          gt(adminConfirmations.expiresAt, now)
        )
      )
      .returning();

    if (!consumed) {
      // Lost the race to a concurrent consume (or it expired between the read
      // and the write) — the token is spent; never honour it twice.
      return { ok: false, reason: "already_consumed" };
    }

    return {
      ok: true,
      record: {
        token: consumed.token,
        userId: consumed.userId,
        draftId,
        issuedAt: consumed.createdAt ?? now,
        expiresAt: consumed.expiresAt,
        consumedAt: consumed.consumedAt,
      },
    };
  }
}

/**
 * Create the durable, `admin_confirmations`-backed Approval_Flow store. The
 * container-tier outreach module installs it via {@link setOutreachApprovalStore}
 * (mirroring how `admin-agent.ts` installs the durable admin store); the catalog
 * entries are untouched because they resolve the store lazily through
 * {@link getOutreachApprovalStore}.
 */
export function createDurableOutreachApprovalStore(): OutreachApprovalStore {
  return new DurableOutreachApprovalStore();
}

// The ChannelAdapter `send_outreach` sends through. Injectable so task 6.2 and
// tests can swap the transport (a fake adapter offline) without changing the
// entry. Defaults to the env-resolved adapter (throws on send when unconfigured,
// keeping the send re-runnable rather than silently dropping it).
let outreachChannelAdapter: ChannelAdapter = defaultChannelAdapter();

/** The active outreach send channel. */
export function getOutreachChannelAdapter(): ChannelAdapter {
  return outreachChannelAdapter;
}

/** Replace the outreach send channel (task 6.2 wiring + tests). */
export function setOutreachChannelAdapter(adapter: ChannelAdapter): void {
  outreachChannelAdapter = adapter;
}

/** Test-only: restore the env-resolved default channel adapter. */
export function _resetOutreachChannelAdapterForTests(): void {
  outreachChannelAdapter = defaultChannelAdapter();
}

// ── approve_outreach — the rep's approval dispatch (Req 7.1, 7.4) ────────────
//
// The FIRST of the two human-gated dispatches (approve, then send) — each its
// OWN `dispatchTool` call, so the dispatcher writes EXACTLY ONE audit row for
// the approval and one for the send under the approving rep (Req 7.4). This
// entry is the rep approving an editable draft: it marks the draft `approved`,
// records the approving rep, and ISSUES a single-use, short-TTL, user-AND-draft-
// bound Approval_Flow token (the reused S1 admin confirmation mechanism). It
// performs NO send — presenting the returned token to `send_outreach` is what
// sends. Dispatched under the approving rep's identity, never an agent (the
// approval is human-gated; no agent role is granted `approve_outreach`).

const approveOutreachInput = z.object({
  /** The editable draft the rep is approving for send. */
  draftId: z.string().uuid(),
});

const approveOutreachOutput = z.object({
  draftId: z.string().uuid(),
  status: z.enum(["draft", "approved", "sent", "suppressed"]),
  /** The single-use Approval_Flow token to present to send_outreach. */
  token: z.string().optional(),
  /** ISO-8601 future expiry of the token (short TTL). */
  expiresAt: z.string().optional(),
  /** Set when no token was issued: why the draft could not be approved. */
  reason: z.enum(["already_sent", "suppressed"]).optional(),
});

const approveOutreachEntry = entry({
  name: "approve_outreach",
  description:
    "Approve an editable outreach draft for send. Records the approving rep, " +
    "marks the draft approved, and issues a single-use, short-TTL Approval_Flow " +
    "token bound to BOTH the rep and this draft (the reused admin confirmation " +
    "pattern). Performs NO send — the rep presents the returned token to " +
    "send_outreach to actually send. Already-sent or suppressed drafts cannot " +
    "be approved.",
  inputSchema: approveOutreachInput,
  outputSchema: approveOutreachOutput,
  // The token IS the human gate; OTP is not the mechanism here (Req 7.1).
  requiresOtp: false,
  permission: prospectingToolPermission("approve_outreach"),
  // Dispatched under the approving rep, never an agent (Design §5).
  auditActor: PROSPECTING_OUTREACH_SEND_ACTOR,
  // One of the TWO human dispatches. Marks approved + issues the Approval_Flow
  // token; the dispatcher records the single approval audit row. No raw phone
  // appears in the approval event payload (CC-Privacy, Req 9.2).
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    if (!userId) {
      // The approval MUST be bound to an approving rep (Req 7.1, 7.4).
      throw new Error("approve_outreach requires an authenticated user in context");
    }

    const [draft] = await db
      .select({
        id: outreachDrafts.id,
        targetId: outreachDrafts.targetId,
        status: outreachDrafts.status,
      })
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, input.draftId))
      .limit(1);

    if (!draft) {
      throw new Error(`approve_outreach: draft "${input.draftId}" not found`);
    }

    // A sent or suppressed draft is terminal — no token is issued.
    if (draft.status === "sent") {
      return {
        draftId: input.draftId,
        status: "sent" as const,
        reason: "already_sent" as const,
      };
    }
    if (draft.status === "suppressed") {
      return {
        draftId: input.draftId,
        status: "suppressed" as const,
        reason: "suppressed" as const,
      };
    }

    // Mark approved under the approving rep, then issue the single-use,
    // user-AND-draft-bound Approval_Flow token (reused admin confirmation flow).
    await db
      .update(outreachDrafts)
      .set({ status: "approved", approvedBy: userId, updatedAt: new Date() })
      .where(eq(outreachDrafts.id, input.draftId));

    const record = await getOutreachApprovalStore().issue(
      db,
      userId,
      input.draftId,
      OUTREACH_APPROVAL_TTL_MS
    );

    await publishEvent(db, {
      type: PROSPECTING_OUTREACH_APPROVED_EVENT,
      // No raw phone in the payload (CC-Privacy, Req 9.2).
      payload: {
        draftId: input.draftId,
        targetId: draft.targetId,
        approvedBy: userId,
      },
    });

    return {
      draftId: input.draftId,
      status: "approved" as const,
      token: record.token,
      expiresAt: record.expiresAt.toISOString(),
    };
  },
});

const sendOutreachInput = z.object({
  /** The approved draft to send. */
  draftId: z.string().uuid(),
  /** The single-use Approval_Flow token issued when the rep approved the draft. */
  token: z.string().min(1),
});

const sendOutreachOutput = z.object({
  /** True when an external send occurred (or the draft was already sent). */
  sent: z.boolean(),
  draftId: z.string().uuid(),
  status: z.enum(["draft", "approved", "sent", "suppressed"]),
  /** Set when refused: why the send did not occur. */
  reason: z
    .enum([
      "not_found",
      "wrong_user",
      "wrong_draft",
      "expired",
      "already_consumed",
      "opted_out",
    ])
    .optional(),
  /** Operator-facing message — the re-approve prompt on a token refusal. */
  message: z.string().optional(),
  /** Provider message id, when a send occurred. */
  messageId: z.string().optional(),
  /** True when the draft was already sent (an idempotent no-op). */
  alreadySent: z.boolean().optional(),
});

/** The send `jobKey` for a draft — keeps the send + outbox side effect at-most-once. */
function outreachSendJobKey(draftId: string, existing: string | null): string {
  return existing ?? `outreach_send:${draftId}`;
}

const sendOutreachEntry = entry({
  name: "send_outreach",
  description:
    "Send an approved outreach draft. Requires a valid single-use, user-bound " +
    "Approval_Flow token (never agent-grantable): an expired, already-used, " +
    "wrong-user, or wrong-draft token is refused with a re-approve prompt and no " +
    "send occurs. Refuses to send to an opted-out Target. On a valid token the " +
    "message is sent through the ChannelAdapter under the approving rep, a CRM " +
    "side effect is enqueued to the outbox with a jobKey (at-most-once), and the " +
    "draft is marked sent. No raw phone appears in any side-effect payload.",
  inputSchema: sendOutreachInput,
  outputSchema: sendOutreachOutput,
  // The token IS the human gate; OTP is not the mechanism here (Req 7.1).
  requiresOtp: false,
  permission: prospectingToolPermission("send_outreach"),
  // Dispatched under the approving rep, never an agent (Design §5).
  auditActor: PROSPECTING_OUTREACH_SEND_ACTOR,
  // The ONLY place an outreach is sent. Token gate → opt-out gate → send →
  // outbox side effect → status transition. Deep wiring is refined in task 6.2;
  // the shape, the token requirement, and the opt-out refusal are correct here.
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    if (!userId) {
      // A send MUST be bound to an approving rep (Req 7.1).
      throw new Error("send_outreach requires an authenticated user in context");
    }

    // Load the draft + its Target's privacy-safe identity (phone_hash, email).
    const [draft] = await db
      .select({
        id: outreachDrafts.id,
        targetId: outreachDrafts.targetId,
        channel: outreachDrafts.channel,
        body: outreachDrafts.body,
        status: outreachDrafts.status,
        jobKey: outreachDrafts.jobKey,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
        targetRawPhone: targets.rawPhone,
      })
      .from(outreachDrafts)
      .leftJoin(targets, eq(targets.id, outreachDrafts.targetId))
      .where(eq(outreachDrafts.id, input.draftId))
      .limit(1);

    if (!draft) {
      throw new Error(`send_outreach: draft "${input.draftId}" not found`);
    }

    // Idempotent no-op: an already-sent draft never re-sends (CC-Idem, Req 8.2).
    if (draft.status === "sent") {
      return {
        sent: true,
        draftId: input.draftId,
        status: "sent" as const,
        alreadySent: true,
      };
    }

    // ── Token gate (Req 7.1) ──────────────────────────────────────────────────
    // A valid, single-use, user-AND-draft-bound token authorises this send. A
    // rejected token is NOT consumed and yields a re-approve prompt with NO
    // side effect of any kind.
    const consumed = await getOutreachApprovalStore().consume(
      db,
      input.token,
      userId,
      input.draftId
    );
    if (!consumed.ok) {
      return {
        sent: false,
        draftId: input.draftId,
        status: draft.status,
        reason: consumed.reason,
        message: OUTREACH_REISSUE_PROMPT,
      };
    }

    // ── Opt-out gate (Req 7.3) ────────────────────────────────────────────────
    // Refuse an opted-out Target — matched on the same privacy-preserving keys
    // the party graph uses (normalized email + salted phone hash).
    const optedOut = await isOptedOut(db, {
      emailHash: draft.targetEmail ?? undefined,
      phoneHash: draft.targetPhoneHash ?? undefined,
    });
    if (optedOut) {
      await db
        .update(outreachDrafts)
        .set({ status: "suppressed", updatedAt: new Date() })
        .where(eq(outreachDrafts.id, input.draftId));

      await publishEvent(db, {
        type: PROSPECTING_OUTREACH_SUPPRESSED_EVENT,
        // No raw phone in the payload (CC-Privacy, Req 9.2).
        payload: { draftId: input.draftId, targetId: draft.targetId, reason: "opted_out" },
      });

      return {
        sent: false,
        draftId: input.draftId,
        status: "suppressed" as const,
        reason: "opted_out" as const,
      };
    }

    // ── Send (Req 7.2) ────────────────────────────────────────────────────────
    // Resolve the provider-addressable recipient: email for the email channel,
    // else the transient raw phone (held only until the SF-bound outbox forward,
    // purged ≤24h by task 8.1). The recipient is handed to the ChannelAdapter
    // for the external send ONLY — it never enters an event/audit/outbox payload.
    const recipient =
      draft.channel === "email"
        ? draft.targetEmail ?? undefined
        : draft.targetRawPhone ?? undefined;
    if (!recipient) {
      throw new Error(
        `send_outreach: no ${draft.channel} recipient resolvable for draft "${input.draftId}"`
      );
    }

    const sendResult = await getOutreachChannelAdapter().send({
      to: recipient,
      body: draft.body,
    });

    // CRM side effect enqueued to the outbox with a jobKey so retries reconcile
    // to one row + one external effect (CC-Idem, Req 7.2, 8.2). The draft's
    // stable send jobKey is `outreach_send:{draftId}` — the SAME key the async
    // `outreach_send` job uses — so this synchronous human-gated send and the
    // job converge on ONE outbox row (the `:sf-task` sub-key matches
    // `outreach-send.ts`) and one `outreach_drafts.job_key`. If the job later
    // runs for this draft it sees `status=sent` and re-sends nothing. The
    // payload is privacy-safe: target id + salted phone hash only, never raw.
    const jobKey = outreachSendJobKey(input.draftId, draft.jobKey);
    await enqueueOutbox(
      db,
      "task",
      {
        kind: "outreach_sent",
        draftId: input.draftId,
        targetId: draft.targetId,
        channel: draft.channel,
        phoneHash: draft.targetPhoneHash ?? null,
        messageId: sendResult.messageId,
        provider: sendResult.provider,
      },
      `${jobKey}:sf-task`
    );

    // Mark sent under the approving rep, stamping the idempotency key.
    await db
      .update(outreachDrafts)
      .set({
        status: "sent",
        approvedBy: userId,
        jobKey,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(outreachDrafts.id, input.draftId));

    await publishEvent(db, {
      type: PROSPECTING_OUTREACH_SENT_EVENT,
      // No raw phone in the payload (CC-Privacy, Req 9.2).
      payload: {
        draftId: input.draftId,
        targetId: draft.targetId,
        channel: draft.channel,
        approvedBy: userId,
      },
    });

    return {
      sent: true,
      draftId: input.draftId,
      status: "sent" as const,
      messageId: sendResult.messageId,
    };
  },
});

// ── The prospecting catalog contributor set ──────────────────────────────────

/**
 * The prospecting Catalog_Entries contributed to the single canonical
 * Tool_Catalog (Design §Components #6). The read/SQL entries land here first;
 * task 3.3 appends the write/provider entries (`record_target`,
 * `prospect_search`, `enrich_target`, `draft_outreach`,
 * `promote_target_to_lead`, `send_outreach`) to this array.
 */
export const prospectingCapabilityEntries: CatalogEntry[] = [
  findComparablesEntry,
  marketCompsEntry,
  recordTargetEntry,
  prospectSearchEntry,
  enrichTargetEntry,
  draftOutreachEntry,
  promoteTargetToLeadEntry,
  approveOutreachEntry,
  sendOutreachEntry,
];

/** The names of the prospecting capabilities exposed by this module. */
export const PROSPECTING_CAPABILITY_NAMES = prospectingCapabilityEntries.map(
  (e) => e.name
);

/**
 * Validate and assemble just the prospecting capabilities through
 * {@link loadCatalog}. Surfaces `incomplete_entry`/`duplicate_name` errors the
 * same way the full catalog load does, so this module can be self-checked in
 * isolation and the prospecting agents can fail fast rather than bind a partial
 * tool set.
 */
export function loadProspectingCapabilities(): CatalogLoadResult {
  return loadCatalog(prospectingCapabilityEntries);
}
