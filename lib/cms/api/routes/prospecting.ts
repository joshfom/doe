import { Elysia } from "elysia";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db";
import {
  aiUnits,
  communities,
  inboundLeads,
  marketTransactions,
  outreachDrafts,
  projectClusters,
  projects,
  prospectingBatchRuns,
  prospectingBriefs,
  prospectingQueueItems,
  prospectingSequences,
  targets,
} from "../../schema";
import { generateCompletion } from "../../ai/gateway";
import { checkCrmForContact } from "../../prospecting/crm-check";
import {
  deriveRerunKey,
  type BatchSubject,
} from "../../prospecting/batch/rerun-key";
import {
  capExhausted,
  recordSend,
  incrementScope,
} from "../../prospecting/batch/send-cap";
import { isOptedOut } from "../../prospecting/optout";
import { releaseClaim } from "../../prospecting/batch/claim";
import { readActivity } from "../../prospecting/batch/activity";
import { enqueueJob } from "../../jobs";
import {
  resolveComparisonSpec,
  type OwnSubjectSelector,
} from "../../prospecting/own-subject";
import { buildDemoComparables } from "../../prospecting/demo-comparables";
import { DemoProvider } from "../../prospecting/providers/demo";
import type { ProspectFilter } from "../../prospecting/providers";
import type { BriefSpec } from "../../prospecting/brief";
import { identityGuard, requirePermission } from "../../rbac/middleware";
import { streamEvents } from "../../realtime/subscribe";
import { publishEvent, type DoeEventType } from "../../realtime/events";
import { dispatchTool, type DispatchResult } from "../../ai/tools/dispatch";
import {
  PROSPECTING_AGENT_ACTOR,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
} from "../../ai/tools/prospecting-capabilities";

// ── Prospecting Workspace bridge (S7, task 8.4) ──────────────────────────────
//
// The thin, AUDITED bridge that makes the Prospecting Workspace surface
// (`app/ora-panel/prospecting/`) reachable from the serverless Next mount
// WITHOUT importing the container-only Mastra agents/workflow. The
// Prospecting_Agent, Outreach_Agent, and `runProspectingRun` workflow
// hard-refuse to run on serverless (`assertProspectingContainerTier`); this
// module therefore NEVER imports them. Instead it drives the user-facing flow
// through the SAME audited boundary the agents use — `dispatchTool` into the
// prospecting `CatalogEntry`s (`find_comparables`, `prospect_search`,
// `record_target`, `enrich_target`, `draft_outreach`,
// `promote_target_to_lead`, `approve_outreach`, `send_outreach`). Every
// mutation / personal-data read / provider call / send is a single
// Zod→RBAC→OTP→audit→execute dispatch (Requirement 8.1); the bridge itself only
// does workspace bookkeeping (creating/reading briefs, fanning live events).
//
// BRIDGE APPROACH (documented choice — design "(a) call the catalog tools
// directly and present the assembled data"): the agent REASONING step
// (Buyer_Hypothesis derivation) is performed serverless-side as a deterministic,
// SQL-grounded proposal built ONLY from the figures `find_comparables` returns
// (the model never computes a figure — CC-SQL); it is presented as an EDITABLE
// proposal the rep adjusts before search (Req 10.6). The container-tier
// Prospecting_Agent remains the production navigator; this keeps serverless
// clean and the flow demoable end-to-end. The Outreach_Agent's grounded
// composition is likewise container-only; serverless persists an editable
// starter draft via `draft_outreach` that the rep refines, approves, and sends.
//
// SECURITY: this is an authenticated staff surface. Every route is gated by the
// existing RBAC server gate — `identityGuard` (Better Auth session) +
// `requirePermission("leads:read")` (the same permission the sibling inbound
// Lead Engine surface uses). Provider calls and personal-data reads are NEVER
// exposed to the browser directly; they happen only inside the dispatched
// `CatalogEntry` handlers. The agent-bound reads/mutations dispatch under the
// `agent:prospecting` / `agent:outreach` identities (their in-process RBAC
// grants); `approve_outreach` / `send_outreach` dispatch under the APPROVING
// REP's identity (`userId`) so the human Approval_Flow token is bound to the
// rep — a send is never auto-issued and never agent-grantable.
//
// Same Bun-mount caveat as the other realtime streams: `GET
// /api/prospecting/events` is a durable SSE connection, effective only on the
// standalone Bun mount (`server.ts`); Caddy already routes `/api/realtime/*` and
// long-lived streams there. Request/response routes resolve on either mount.

// ── Prospecting lifecycle event types (events.type is text; no migration) ────
// The `prospecting.*` types exist in the `DoeEventType` union (task 5.4). The
// bridge publishes the lifecycle events the container-tier workflow would emit,
// so the workspace updates live as the rep drives each step.
const EV_BRIEF_RECEIVED: DoeEventType = "prospecting.brief.received";
const EV_COMPARABLES_FOUND: DoeEventType = "prospecting.comparables.found";
const EV_HYPOTHESIS_PROPOSED: DoeEventType = "prospecting.hypothesis.proposed";
const EV_SEARCH_COMPLETED: DoeEventType = "prospecting.search.completed";
const EV_TARGET_RECORDED: DoeEventType = "prospecting.target.recorded";
const EV_TARGET_ENRICHED: DoeEventType = "prospecting.target.enriched";
const EV_CRM_CHECKED: DoeEventType = "prospecting.crm.checked";
// Approval-queue lifecycle events (task 8.4). Published as the rep approves +
// sends or rejects a Queued_Item so the workspace updates live. Internal ids
// only — never a raw phone (CC-Privacy, Req 3.4, 10.4).
const EV_QUEUE_ITEM_SENT: DoeEventType = "prospecting.queue.item.sent";
const EV_QUEUE_ITEM_REJECTED: DoeEventType = "prospecting.queue.item.rejected";

// ── Dispatch helpers ──────────────────────────────────────────────────────────

/** Turn a {@link DispatchResult} into an HTTP response, or throw to the caller. */
function unwrap(
  result: DispatchResult,
  set: { status?: number | string }
): unknown {
  if (result.ok) return result.result;
  // Map the structured dispatch error onto an HTTP status the UI can act on.
  const code = result.error.code;
  set.status =
    code === "permission_denied"
      ? 403
      : code === "validation_error"
        ? 400
        : code === "otp_required"
          ? 401
          : code === "unknown_tool"
            ? 404
            : 500;
  return { error: result.error.message, code };
}

// ── Buyer_Hypothesis derivation (serverless, SQL-grounded, editable) ──────────

type ComparableRow = {
  marketProjectId: string;
  name: string;
  communityName: string | null;
  segment: string | null;
  score: number;
  stats: {
    buyerSegmentMix: {
      value: Array<{ segment: string; count: number; pct: number }>;
      source: string | null;
      asOf: string | null;
    };
  };
};

/**
 * Build an editable Buyer_Hypothesis proposal from the comparables' SQL-sourced
 * aggregate buyer-segment mix ONLY (CC-SQL: figures come from the tool, the
 * bridge narrates). Conforms to `buyerHypothesisSchema`. The rep edits this
 * before search (Req 10.3, 10.4, 10.6).
 */
function deriveHypothesis(comparables: ComparableRow[]): {
  segments: string[];
  feederMarkets: string[];
  titles: string[];
  wealthSignals: string[];
  evidence: Array<{ claim: string; sourceTable: string; asOf: string }>;
  confidence: "low" | "medium" | "high";
} {
  const segmentTotals = new Map<string, number>();
  const evidence: Array<{ claim: string; sourceTable: string; asOf: string }> = [];

  for (const comp of comparables) {
    const mix = comp.stats?.buyerSegmentMix;
    const asOf = mix?.asOf ?? new Date().toISOString();
    for (const bucket of mix?.value ?? []) {
      segmentTotals.set(
        bucket.segment,
        (segmentTotals.get(bucket.segment) ?? 0) + bucket.count
      );
      // Each evidence claim pins a real SQL figure to its source table + as-of.
      evidence.push({
        claim: `${bucket.pct}% of comparable buyers at ${comp.name} were ${bucket.segment}`,
        sourceTable: "market_transactions",
        asOf,
      });
    }
  }

  const segments = [...segmentTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([segment]) => segment);

  // Title/wealth seeds are derived heuristically from the observed segments so
  // the rep has a starting point for search; they carry no figures and are
  // fully editable. Feeder markets are left for the rep to add (no aggregate
  // nationality figure is surfaced here — buyer data is segment-level only).
  const titles = segments.length
    ? ["Founder", "Managing Director", "Investor", "Family Office Principal"]
    : [];

  return {
    segments,
    feederMarkets: [],
    titles,
    wealthSignals: segments.length ? ["liquidity event", "high net worth"] : [],
    evidence: evidence.slice(0, 24),
    confidence:
      comparables.length === 0
        ? "low"
        : comparables.length >= 3
          ? "high"
          : "medium",
  };
}

/** Build an ICP filter for `prospect_search` from a (possibly edited) hypothesis. */
function filterFromHypothesis(
  hypothesis: {
    segments?: string[];
    feederMarkets?: string[];
    titles?: string[];
    wealthSignals?: string[];
  } | null,
  targetType: "person" | "company" | "intermediary"
): Record<string, unknown> {
  return {
    targetType,
    geography: hypothesis?.feederMarkets ?? [],
    titles: hypothesis?.titles ?? [],
    wealthSignals: hypothesis?.wealthSignals ?? [],
    keywords: hypothesis?.segments ?? [],
    limit: 50,
  };
}

// ── Own_Subject → Comparison_Spec (S7 increment, Req 13.3–13.6) ───────────────

/** The own-catalog selector fields a brief may carry (community → … → unit). */
const OWN_SUBJECT_KEYS = [
  "communityId",
  "projectId",
  "clusterId",
  "aiUnitId",
] as const;

/** True when the body pins at least one Own_Subject node (vs. free-form spec). */
function hasOwnSubject(selector: OwnSubjectSelector): boolean {
  return OWN_SUBJECT_KEYS.some((k) => Boolean(selector[k]));
}

/** Best-effort parse of a model reply that should be `{subject, body}` JSON. */
function parseDraftJson(raw: string): { subject?: string; body?: string } {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // 1) Try a direct parse, then the first {...} block.
  for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0] ?? ""]) {
    if (!candidate) continue;
    try {
      const obj = JSON.parse(candidate) as { subject?: unknown; body?: unknown };
      return {
        subject: typeof obj.subject === "string" ? obj.subject : undefined,
        body: typeof obj.body === "string" ? obj.body : undefined,
      };
    } catch {
      /* fall through */
    }
  }
  // 2) Tolerant field extraction. Models frequently emit a `body` containing
  //    RAW newlines (multi-paragraph copy), which is invalid JSON and makes
  //    `JSON.parse` above throw — without this fallback the caller would dump
  //    the whole `{...}` blob into the body field. The `[^"\\]` class matches
  //    newlines, so we recover the string content even when it spans lines,
  //    then unescape the common JSON escapes.
  const subject = extractJsonStringField(cleaned, "subject");
  const body = extractJsonStringField(cleaned, "body");
  if (subject !== undefined || body !== undefined) {
    return { subject, body };
  }
  return {};
}

/**
 * Extract a single JSON string field's value by key, tolerant of raw newlines
 * inside the value (which strict `JSON.parse` rejects). Returns the unescaped
 * string, or `undefined` when the key is absent.
 */
function extractJsonStringField(
  text: string,
  key: string
): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = text.match(re);
  if (!m) return undefined;
  return m[1]
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

/**
 * Merge a resolver-produced Comparison_Spec with the rep's free-form overrides.
 * The rep's explicitly-supplied fields win (so a manually-filled gap, Req 13.6,
 * is honoured); otherwise the SQL-resolved own value stands. Neither side
 * invents a value — undefined fields stay undefined. `features` unions both.
 */
function mergeSpec(resolved: BriefSpec, override: Partial<BriefSpec>): BriefSpec {
  const merged: BriefSpec = { ...resolved, features: [...(resolved.features ?? [])] };
  for (const [key, value] of Object.entries(override)) {
    if (key === "features") continue;
    if (value !== undefined && value !== "" && value !== null) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  const overrideFeatures = override.features ?? [];
  if (overrideFeatures.length > 0) {
    merged.features = [...new Set([...merged.features, ...overrideFeatures])];
  }
  return merged;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export const prospectingRoutes = new Elysia({
  name: "prospecting",
  prefix: "/prospecting",
})
  .use(identityGuard)
  .use(requirePermission("leads:read"))

  // ── Reads (workspace plumbing — never returns a raw phone) ──────────────────

  // GET /api/prospecting/briefs — list the rep's recent briefs, newest first.
  .get("/briefs", async ({ query }) => {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const rows = await db
      .select({
        id: prospectingBriefs.id,
        spec: prospectingBriefs.spec,
        buyerHypothesis: prospectingBriefs.buyerHypothesis,
        status: prospectingBriefs.status,
        projectId: prospectingBriefs.projectId,
        aiUnitId: prospectingBriefs.aiUnitId,
        createdAt: prospectingBriefs.createdAt,
        updatedAt: prospectingBriefs.updatedAt,
      })
      .from(prospectingBriefs)
      .orderBy(desc(prospectingBriefs.createdAt))
      .limit(limit);
    return { count: rows.length, briefs: rows };
  })

  // GET /api/prospecting/briefs/:id — one brief with its targets + drafts.
  .get("/briefs/:id", async ({ params, set }) => {
    const [brief] = await db
      .select()
      .from(prospectingBriefs)
      .where(eq(prospectingBriefs.id, params.id))
      .limit(1);
    if (!brief) {
      set.status = 404;
      return { error: "Brief not found" };
    }
    const briefTargets = await selectTargets(eq(targets.briefId, params.id));
    const briefDrafts = await db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.briefId, params.id))
      .orderBy(desc(outreachDrafts.createdAt));
    return { brief, targets: briefTargets, drafts: briefDrafts };
  })

  // GET /api/prospecting/targets?briefId= — targets (optionally by brief).
  .get("/targets", async ({ query }) => {
    const rows = query.briefId
      ? await selectTargets(eq(targets.briefId, query.briefId as string))
      : await selectTargets();
    return { count: rows.length, targets: rows };
  })

  // GET /api/prospecting/drafts?targetId= — drafts (optionally by target).
  .get("/drafts", async ({ query }) => {
    const base = db.select().from(outreachDrafts);
    const rows = await (query.targetId
      ? base.where(eq(outreachDrafts.targetId, query.targetId as string))
      : base
    ).orderBy(desc(outreachDrafts.createdAt));
    return { count: rows.length, drafts: rows };
  })

  // GET /api/prospecting/own-catalog?communityId=&projectId= — the OWN-catalog
  // source for the community → project → cluster picker (S7 increment, Req
  // 13.3). PURE SQL reads over `communities` / `projects` / `project_clusters`,
  // newest-first, scoped by the optional query params so the picker lazy-loads
  // one level at a time. No provider call, no mutation, no `market_*` read — the
  // market read still happens only inside the audited `find_comparables` /
  // `market_comps` dispatches. Gated by the file's existing `identityGuard` +
  // `requirePermission("leads:read")`.
  .get("/own-catalog", async ({ query }) => {
    const communityId = (query.communityId as string | undefined) || undefined;
    const projectId = (query.projectId as string | undefined) || undefined;

    // Level 1 — communities are always available to seed the first dropdown.
    const communityRows = await db
      .select({
        id: communities.id,
        nameEn: communities.nameEn,
        nameAr: communities.nameAr,
        city: communities.city,
        region: communities.region,
        status: communities.status,
      })
      .from(communities)
      .orderBy(desc(communities.createdAt));

    // Level 2 — projects load only once a community is chosen.
    const projectRows = communityId
      ? await db
          .select({
            id: projects.id,
            communityId: projects.communityId,
            nameEn: projects.nameEn,
            nameAr: projects.nameAr,
            status: projects.status,
          })
          .from(projects)
          .where(eq(projects.communityId, communityId))
          .orderBy(desc(projects.createdAt))
      : [];

    // Level 3 — clusters load only once a project is chosen. The cluster's
    // own-sourced fields are returned so the picker can preview the subject.
    const clusterRows = projectId
      ? await db
          .select({
            id: projectClusters.id,
            projectId: projectClusters.projectId,
            name: projectClusters.name,
            nameAr: projectClusters.nameAr,
            slug: projectClusters.slug,
            segment: projectClusters.segment,
            unitTypes: projectClusters.unitTypes,
            bedroomsMin: projectClusters.bedroomsMin,
            bedroomsMax: projectClusters.bedroomsMax,
            priceMinAed: projectClusters.priceMinAed,
            priceMaxAed: projectClusters.priceMaxAed,
            avgPricePerSqft: projectClusters.avgPricePerSqft,
            totalUnits: projectClusters.totalUnits,
          })
          .from(projectClusters)
          .where(eq(projectClusters.projectId, projectId))
          .orderBy(desc(projectClusters.createdAt))
      : [];

    return {
      communities: communityRows,
      projects: projectRows,
      clusters: clusterRows,
    };
  })

  // GET /api/prospecting/resolve-subject?communityId=&projectId=&clusterId=&aiUnitId=
  // Resolve an Own_Subject selection into a Comparison_Spec from the OWN catalog
  // ONLY (S7 increment, Req 13.5, 13.6). This drives the picker → brief prefill:
  // when the rep picks a community → project → cluster, the workspace calls this
  // to prefill the brief's spec fields and surface the unfillable parameters as
  // `gaps` for manual entry. PURE SQL, deterministic, never invents a value; no
  // provider, no mutation, no `market_*` read — `resolveComparisonSpec` reads
  // only `communities` / `projects` / `project_clusters` / the cluster's
  // `ai_units`. Same RBAC gate as the rest of this file.
  .get("/resolve-subject", async ({ query, set }) => {
    const selector: OwnSubjectSelector = {
      communityId: (query.communityId as string | undefined) || undefined,
      projectId: (query.projectId as string | undefined) || undefined,
      clusterId: (query.clusterId as string | undefined) || undefined,
      aiUnitId: (query.aiUnitId as string | undefined) || undefined,
    };
    if (!hasOwnSubject(selector)) {
      set.status = 400;
      return {
        error:
          "Provide at least one Own_Subject id (communityId, projectId, clusterId, or aiUnitId)",
      };
    }
    const resolved = await resolveComparisonSpec(db, selector);
    return {
      spec: resolved.spec,
      coords: resolved.coords ?? null,
      provenance: resolved.provenance,
      gaps: resolved.gaps ?? [],
    };
  })

  // GET /api/prospecting/market-comps?area=&segment=&limit= — the Area_Trend
  // headline source (S7 increment, Req 14.7). Dispatches the AUDITED
  // `market_comps` tool (read-only, agent:prospecting, SQL-only over the
  // `market_*` mirror) and returns its per-project comps + the area/segment
  // price-index rows. Each Area_Trend figure (avg price, price/sqft, YoY, ROI,
  // volume) is stamped with its `source` + `as_of` by the tool. The browser
  // never reads `market_*` directly; no provider, no mutation.
  .get("/market-comps", async ({ query, set }) => {
    const input: Record<string, unknown> = {};
    if (query.area) input.area = String(query.area);
    if (query.segment) input.segment = String(query.segment);
    if (query.limit) {
      input.limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    }
    const result = await dispatchTool(db, "market_comps", input, {
      actor: PROSPECTING_AGENT_ACTOR,
    });
    if (!result.ok) return unwrap(result, set);
    return result.result;
  })

  // ── Flow: brief intake → comparables + editable Buyer_Hypothesis ────────────

  // POST /api/prospecting/briefs — create a brief, pull SQL comparables via
  // `find_comparables`, derive an editable Buyer_Hypothesis from those figures,
  // and return both. The brief row is workspace bookkeeping bound to the rep.
  .post("/briefs", async ({ body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const payload = (body ?? {}) as {
      spec?: Record<string, unknown>;
      communityId?: string;
      projectId?: string;
      clusterId?: string;
      aiUnitId?: string;
    };

    // Own_Subject (S7 increment, Req 13.4–13.6): when the rep drives the brief
    // from the community → project → cluster picker, resolve the Comparison_Spec
    // from the OWN catalog (pure SQL, deterministic, never invents a value) and
    // merge it under the rep's free-form overrides. The unfillable parameters
    // (Req 13.6) come back as `gaps` for the rep to supply manually.
    const selector: OwnSubjectSelector = {
      communityId: payload.communityId,
      projectId: payload.projectId,
      clusterId: payload.clusterId,
      aiUnitId: payload.aiUnitId,
    };
    const override = (payload.spec ?? {}) as Partial<BriefSpec>;

    let spec: BriefSpec | Record<string, unknown> = override;
    let gaps: string[] = [];
    if (hasOwnSubject(selector)) {
      const resolved = await resolveComparisonSpec(db, selector);
      spec = mergeSpec(resolved.spec, override);
      // Only report gaps still unfilled after the rep's manual overrides.
      gaps = (resolved.gaps ?? []).filter(
        (g) => (spec as Record<string, unknown>)[g] === undefined
      );
    }

    // Persist the brief (status draft) bound to the requesting rep. `clusterId`
    // has no column on prospecting_briefs (it is purely additive to the brief
    // schema, Req 13.4); the resolved `spec` it produced is what is persisted,
    // and the clusterId is threaded into the find_comparables dispatch below.
    const [brief] = await db
      .insert(prospectingBriefs)
      .values({
        createdBy: userId,
        projectId: payload.projectId ?? null,
        aiUnitId: payload.aiUnitId ?? null,
        spec,
      })
      .returning();

    await publishEvent(db, {
      type: EV_BRIEF_RECEIVED,
      payload: { briefId: brief.id },
    });

    // Area_Trend headline (S7 increment, Req 14.7): pull the area/segment
    // price-index rows via the AUDITED `market_comps` tool (SQL-only over the
    // `market_*` mirror, agent:prospecting). Each figure (avg price/sqft, YoY,
    // ROI, volume, raw trend) is stamped with `source` + `as_of` by the tool and
    // surfaced to the workspace as `areaTrend`. Independent of the comparables
    // read below, so it stands even when no comparable project matches.
    const specRecord = spec as Record<string, unknown>;
    const trendArea =
      typeof specRecord.area === "string" ? specRecord.area : undefined;
    const trendSegment =
      typeof specRecord.segment === "string" ? specRecord.segment : undefined;
    const trendResult = await dispatchTool(
      db,
      "market_comps",
      {
        ...(trendArea ? { area: trendArea } : {}),
        ...(trendSegment ? { segment: trendSegment } : {}),
      },
      { actor: PROSPECTING_AGENT_ACTOR }
    );
    const areaTrend = trendResult.ok
      ? (trendResult.result as { priceIndex: unknown[] }).priceIndex
      : [];

    // SQL comparables via the audited tool (read-only, agent:prospecting).
    // Optional UUID brief fields are passed as undefined (not null) to satisfy
    // prospectingBriefSchema's `.optional()` shape; `clusterId` flows opaquely
    // through `rankComparables` (no tool signature change, Req 13.4).
    const compResult = await dispatchTool(
      db,
      "find_comparables",
      {
        brief: {
          projectId: brief.projectId ?? undefined,
          aiUnitId: brief.aiUnitId ?? undefined,
          clusterId: payload.clusterId ?? undefined,
          spec,
        },
        limit: 25,
      },
      { actor: PROSPECTING_AGENT_ACTOR }
    );
    if (!compResult.ok) {
      // Comparables read failed (e.g. the trial-tier market source hit its
      // quota). NEVER dead-end: fall back to deterministic, clearly-labelled
      // representative comparables so the hypothesis + pitch still have concrete
      // grounding. The rep sees a single, expected "trial limit" notice.
      const demoComps = buildDemoComparables(spec as BriefSpec);
      const demoHypothesis = deriveHypothesis(demoComps as unknown as ComparableRow[]);
      await db
        .update(prospectingBriefs)
        .set({ buyerHypothesis: demoHypothesis, updatedAt: new Date() })
        .where(eq(prospectingBriefs.id, brief.id));
      set.status = 200;
      return {
        brief: { ...brief, buyerHypothesis: demoHypothesis },
        comparables: demoComps,
        unconfigured: false,
        hypothesis: demoHypothesis,
        areaTrend,
        gaps,
        marketDataSource: "demo" as const,
        marketDataNote: "trial_limit" as const,
      };
    }
    const comp = compResult.result as {
      comparables: ComparableRow[];
      unconfigured: boolean;
    };

    // ALWAYS return concrete comparables. When the live read matched nothing
    // (area not synced, or the trial-tier source is tapped out), substitute
    // deterministic representative comparables so the hypothesis + pitch have
    // grounding. `marketDataNote = "trial_limit"` drives the single expected
    // "we hit the trial data limit" notice in the UI (the only error we surface
    // for the trial data source).
    let comparablesOut: ComparableRow[] = comp.comparables;
    let marketDataNote: "trial_limit" | null = null;
    if (comp.comparables.length === 0) {
      comparablesOut = buildDemoComparables(spec as BriefSpec) as unknown as ComparableRow[];
      marketDataNote = "trial_limit";
    }

    // Honest data-source signal for the workspace: do we hold LIVE provider
    // transactions for the comparable areas, or only the demo-stamped fallback
    // catalog? Derived from the mirror's `demo` flag on `market_transactions`
    // for the matched areas (the live market-sync ingests transactions + area
    // trends, so this flips to "live" once a sync has run). `null` when there is
    // nothing to classify.
    let marketDataSource: "live" | "demo" | null = null;
    if (marketDataNote === "trial_limit") {
      // Representative fallback in use — the data source is demo by construction.
      marketDataSource = "demo";
    } else {
      const compAreas = [
        ...new Set(
          comparablesOut
            .map((c) => c.communityName)
            .filter((a): a is string => Boolean(a))
        ),
      ];
      if (compAreas.length > 0) {
        const txnRows = await db
          .select({ demo: marketTransactions.demo })
          .from(marketTransactions)
          .where(inArray(marketTransactions.areaName, compAreas))
          .limit(500);
        if (txnRows.length > 0) {
          marketDataSource = txnRows.some((r) => !r.demo) ? "live" : "demo";
        }
      }
    }

    await publishEvent(db, {
      type: EV_COMPARABLES_FOUND,
      payload: { briefId: brief.id, count: comparablesOut.length },
    });

    // Derive the editable, SQL-grounded Buyer_Hypothesis proposal and persist it.
    const hypothesis = deriveHypothesis(comparablesOut);
    await db
      .update(prospectingBriefs)
      .set({ buyerHypothesis: hypothesis, updatedAt: new Date() })
      .where(eq(prospectingBriefs.id, brief.id));

    await publishEvent(db, {
      type: EV_HYPOTHESIS_PROPOSED,
      payload: { briefId: brief.id, confidence: hypothesis.confidence },
    });

    return {
      brief: { ...brief, buyerHypothesis: hypothesis },
      comparables: comparablesOut,
      unconfigured: comp.unconfigured,
      hypothesis,
      areaTrend,
      gaps,
      marketDataSource,
      marketDataNote,
    };
  })

  // PUT /api/prospecting/briefs/:id/hypothesis — save the rep's edited proposal.
  .put("/briefs/:id/hypothesis", async ({ params, body, set }) => {
    const payload = (body ?? {}) as { hypothesis?: unknown };
    if (!payload.hypothesis) {
      set.status = 400;
      return { error: "Missing hypothesis" };
    }
    const [updated] = await db
      .update(prospectingBriefs)
      .set({ buyerHypothesis: payload.hypothesis, updatedAt: new Date() })
      .where(eq(prospectingBriefs.id, params.id))
      .returning();
    if (!updated) {
      set.status = 404;
      return { error: "Brief not found" };
    }
    return { brief: updated };
  })

  // POST /api/prospecting/briefs/:id/search — run prospect_search against the
  // (edited) hypothesis and return candidate Targets.
  .post("/briefs/:id/search", async ({ params, body, set }) => {
    const payload = (body ?? {}) as {
      filter?: Record<string, unknown>;
      targetType?: "person" | "company" | "intermediary";
    };
    const [brief] = await db
      .select({ buyerHypothesis: prospectingBriefs.buyerHypothesis })
      .from(prospectingBriefs)
      .where(eq(prospectingBriefs.id, params.id))
      .limit(1);
    if (!brief) {
      set.status = 404;
      return { error: "Brief not found" };
    }
    const filter =
      payload.filter ??
      filterFromHypothesis(
        brief.buyerHypothesis as Parameters<typeof filterFromHypothesis>[0],
        payload.targetType ?? "person"
      );

    const result = await dispatchTool(db, "prospect_search", { filter }, {
      actor: PROSPECTING_AGENT_ACTOR,
    });
    if (!result.ok) return unwrap(result, set);

    const out = result.result as {
      candidates: unknown[];
      unconfiguredProviders?: string[];
      failedProviders?: string[];
      rateLimitedProviders?: string[];
    };

    // ALWAYS return buyers. When the live providers yielded nothing (trial quota
    // exhausted, or none configured), fall back to a deterministic representative
    // set so the rep can keep working. The DemoProvider is forced on here (not
    // env-gated) and is fully offline/synthetic — recording a candidate still
    // goes through the audited `record_target`. The `trial_limit` note drives the
    // single expected "trial limit reached" notice (the only error we surface for
    // the trial data source).
    if (out.candidates.length === 0) {
      const demo = new DemoProvider({ apiKey: "demo", baseUrl: "demo://local" });
      const demoResults = await demo.search(filter as unknown as ProspectFilter);
      const candidates = Array.isArray(demoResults) ? demoResults : [];
      await db
        .update(prospectingBriefs)
        .set({ status: "searching", updatedAt: new Date() })
        .where(eq(prospectingBriefs.id, params.id));
      await publishEvent(db, {
        type: EV_SEARCH_COMPLETED,
        payload: { briefId: params.id, count: candidates.length },
      });
      return {
        candidates,
        unconfiguredProviders: out.unconfiguredProviders ?? [],
        failedProviders: out.failedProviders ?? [],
        // Signal the trial-limit banner even when the cause was "no live provider".
        rateLimitedProviders:
          (out.rateLimitedProviders ?? []).length > 0
            ? out.rateLimitedProviders
            : ["apollo"],
        dataNote: "trial_limit" as const,
      };
    }

    await db
      .update(prospectingBriefs)
      .set({ status: "searching", updatedAt: new Date() })
      .where(eq(prospectingBriefs.id, params.id));

    await publishEvent(db, {
      type: EV_SEARCH_COMPLETED,
      payload: { briefId: params.id, count: out.candidates.length },
    });
    return result.result;
  })

  // ── Flow: record / enrich / promote a Target ────────────────────────────────

  // POST /api/prospecting/targets — record a chosen candidate as a Target.
  .post("/targets", async ({ body, set }) => {
    const result = await dispatchTool(db, "record_target", body, {
      actor: PROSPECTING_AGENT_ACTOR,
    });
    if (!result.ok) return unwrap(result, set);
    const out = result.result as { targetId: string };
    await publishEvent(db, {
      type: EV_TARGET_RECORDED,
      payload: { targetId: out.targetId },
    });
    set.status = 201;
    return result.result;
  })

  // POST /api/prospecting/targets/:id/enrich — assemble Account/Person intel.
  .post("/targets/:id/enrich", async ({ params, set }) => {
    const result = await dispatchTool(
      db,
      "enrich_target",
      { targetId: params.id },
      { actor: PROSPECTING_AGENT_ACTOR }
    );
    if (!result.ok) return unwrap(result, set);
    await publishEvent(db, {
      type: EV_TARGET_ENRICHED,
      payload: { targetId: params.id },
    });
    return result.result;
  })

  // POST /api/prospecting/targets/:id/promote — dedupe + promote into a Lead.
  .post("/targets/:id/promote", async ({ params, body, set }) => {
    const payload = (body ?? {}) as { phone?: string; email?: string; sfLeadId?: string };

    // Load the Target's identity so we can (a) dedupe by email, (b) link any
    // EXISTING Salesforce Lead before promoting, and (c) mirror the promoted
    // prospect into the Lead Engine ledger so it is VISIBLE on the leads
    // dashboard (the dashboard lists `inbound_leads`; promotion otherwise only
    // writes parties + leads_mirror, so a promoted prospect never appeared).
    const [target] = await db
      .select({
        displayName: targets.displayName,
        companyName: targets.companyName,
        title: targets.title,
        email: targets.email,
        phoneHash: targets.phoneHash,
        country: targets.country,
      })
      .from(targets)
      .where(eq(targets.id, params.id))
      .limit(1);
    const email = payload.email ?? target?.email ?? undefined;

    let sfLeadId = payload.sfLeadId;
    let crmLinked = false;
    if (!sfLeadId && email) {
      const crm = await checkCrmForContact({ email });
      // Only an un-converted Lead carries a reusable Lead id; a converted Lead or
      // a Contact is already a downstream record and is left for manual handling.
      const leadMatch = crm.matches.find((m) => m.object === "Lead" && !m.isConverted);
      if (leadMatch) {
        sfLeadId = leadMatch.id;
        crmLinked = true;
      }
    }

    const result = await dispatchTool(
      db,
      "promote_target_to_lead",
      { targetId: params.id, phone: payload.phone, email, sfLeadId },
      { actor: PROSPECTING_AGENT_ACTOR }
    );
    if (!result.ok) return unwrap(result, set);

    // Mirror the promoted prospect into the Lead Engine ledger so the rep can
    // actually see it on the leads dashboard. Only on a real promotion (match /
    // new with a resolved party); a conflict/error created no Lead, so nothing
    // is mirrored. The row is recorded as `parsed` and pre-linked to the
    // resolved party, so the inbound parse flow (which keys on `received`) never
    // re-processes it — it is already a resolved Lead. Idempotent by a
    // deterministic key so re-promoting the same Target never duplicates the row.
    const promotion = result.result as { resolution: string; partyId: string | null };
    if (promotion.partyId && (promotion.resolution === "match" || promotion.resolution === "new")) {
      const name = target?.displayName ?? target?.companyName ?? null;
      const detail = [target?.title, target?.companyName].filter(Boolean).join(" at ");
      const content = detail
        ? `Outbound prospect promoted to a Lead — ${detail}.`
        : "Outbound prospect promoted to a Lead.";
      const inserted = await db
        .insert(inboundLeads)
        .values({
          source: "prospecting",
          idempotencyKey: `prospecting:promote:${params.id}`,
          name,
          email: email ?? null,
          phoneHash: target?.phoneHash ?? null, // already a salted hash (CC-Privacy)
          content,
          rawPayload: {
            origin: "prospecting",
            targetId: params.id,
            partyId: promotion.partyId,
            resolution: promotion.resolution,
          },
          attribution: { source: "prospecting" },
          structured: null,
          status: "parsed", // already resolved — skip the inbound parse flow
          attempts: 0,
          partyId: promotion.partyId,
        })
        .onConflictDoNothing({ target: inboundLeads.idempotencyKey })
        .returning({ id: inboundLeads.id });

      // Live-update the leads dashboard with the new row (CC-Privacy: internal
      // ids + already-exposed fields only, never a raw phone). Only on a fresh
      // insert — a re-promote that conflicts must not re-announce the lead.
      if (inserted.length > 0) {
        await publishEvent(db, {
          type: "lead.ingested" as DoeEventType,
          payload: {
            id: inserted[0].id,
            source: "prospecting",
            status: "parsed",
            name,
            email: email ?? null,
            capturedAt: new Date().toISOString(),
          },
        });
      }
    }

    // Surface whether we linked to an existing SF Lead (the tool publishes its
    // own promotion event).
    return { ...(result.result as Record<string, unknown>), crmLinked, sfLeadId: sfLeadId ?? null };
  })

  // POST /api/prospecting/targets/:id/crm-check — is this prospect already in
  // Salesforce? A READ-ONLY lookup by email before any cold outreach. If found,
  // the workspace shows a CRM summary so the rep pursues a warm follow-up
  // through the existing owner instead of cold-approaching a known contact.
  .post("/targets/:id/crm-check", async ({ params, set }) => {
    const [target] = await db
      .select({ id: targets.id, email: targets.email, displayName: targets.displayName })
      .from(targets)
      .where(eq(targets.id, params.id))
      .limit(1);
    if (!target) {
      set.status = 404;
      return { error: "Target not found" };
    }

    const result = await checkCrmForContact({ email: target.email });

    // Privacy-safe event payload (no raw PII beyond counts/flags).
    await publishEvent(db, {
      type: EV_CRM_CHECKED,
      payload: {
        targetId: target.id,
        configured: result.configured,
        found: result.found,
        matchCount: result.matches.length,
      },
    });

    return result;
  })

  // ── Flow: grounded outreach draft → approve → send (human-gated) ────────────

  // POST /api/prospecting/targets/:id/compose-draft — the AI composes an
  // editable, GROUNDED first-touch outreach draft (personalized subject + body)
  // for a recorded Target, which the rep then edits before saving via /drafts.
  //
  // Grounding (CC-SQL): the model writes prose ONLY; every market figure it may
  // cite is pulled here from SQL (real `market_transactions` comps + the
  // `market_price_index` Area_Trend, via the audited find_comparables /
  // market_comps tools) and passed as Facts. The same figures are returned as a
  // `grounding` manifest pinned to their SQL recordIds, so the persisted draft
  // carries provenance. The model never invents a number.
  .post("/targets/:id/compose-draft", async ({ params, body, set }) => {
    const payload = (body ?? {}) as {
      channel?: "email" | "whatsapp" | "message";
      language?: "en" | "ar";
    };
    const channel = payload.channel ?? "email";
    const language = payload.language ?? "en";

    const [target] = await db
      .select()
      .from(targets)
      .where(eq(targets.id, params.id))
      .limit(1);
    if (!target) {
      set.status = 404;
      return { error: "Target not found" };
    }

    // The Own_Subject the rep is selling, from the Target's brief.
    type DraftHypothesis = { segments?: string[]; titles?: string[] };
    let spec: Record<string, unknown> = {};
    let hypothesis: DraftHypothesis | null = null;
    let aiUnitId: string | null = null;
    if (target.briefId) {
      const [brief] = await db
        .select({
          spec: prospectingBriefs.spec,
          buyerHypothesis: prospectingBriefs.buyerHypothesis,
          aiUnitId: prospectingBriefs.aiUnitId,
        })
        .from(prospectingBriefs)
        .where(eq(prospectingBriefs.id, target.briefId))
        .limit(1);
      if (brief) {
        spec = (brief.spec as Record<string, unknown>) ?? {};
        hypothesis = (brief.buyerHypothesis as DraftHypothesis | null) ?? null;
        aiUnitId = brief.aiUnitId ?? null;
      }
    }
    const area = typeof spec.area === "string" ? spec.area : undefined;
    const segment = typeof spec.segment === "string" ? spec.segment : undefined;

    // The actual unit the rep wants to sell (the Own_Subject), from ORA's own
    // catalog. This is the SUBJECT of the outreach — what the message is ABOUT.
    // Market comps below are only PRICING EVIDENCE, never the thing being sold.
    // Its real figures (asking price, size, floor, handover) are grounded to the
    // `ai_units` record so the model never invents them (CC-SQL).
    let subjectUnit:
      | {
          id: string;
          projectName: string;
          unitNumber: string;
          unitType: string;
          floorNumber: number | null;
          areaSqm: number | null;
          purchasePrice: number | null;
          status: string;
          estimatedHandoverDate: string | null;
          updatedAt: Date;
        }
      | null = null;
    if (aiUnitId) {
      const [unit] = await db
        .select({
          id: aiUnits.id,
          projectName: aiUnits.projectName,
          unitNumber: aiUnits.unitNumber,
          unitType: aiUnits.unitType,
          floorNumber: aiUnits.floorNumber,
          areaSqm: aiUnits.areaSqm,
          purchasePrice: aiUnits.purchasePrice,
          status: aiUnits.status,
          estimatedHandoverDate: aiUnits.estimatedHandoverDate,
          updatedAt: aiUnits.updatedAt,
        })
        .from(aiUnits)
        .where(eq(aiUnits.id, aiUnitId))
        .limit(1);
      if (unit) subjectUnit = unit;
    }

    // SQL-grounded comparables for the same area/segment (audited tool).
    const compResult = await dispatchTool(
      db,
      "find_comparables",
      { brief: { spec }, limit: 3 },
      { actor: PROSPECTING_AGENT_ACTOR }
    );
    const comparables = compResult.ok
      ? ((compResult.result as { comparables: ComparableRow[] }).comparables ?? [])
      : [];

    // Area_Trend (price-index) rows → grounded recordIds (audited tool).
    const trendResult = await dispatchTool(
      db,
      "market_comps",
      { ...(area ? { area } : {}), ...(segment ? { segment } : {}) },
      { actor: PROSPECTING_AGENT_ACTOR }
    );
    const priceIndex = trendResult.ok
      ? ((trendResult.result as { priceIndex: Array<Record<string, unknown>> })
          .priceIndex ?? [])
      : [];

    // Real comparable sale transactions → grounded, specific figures.
    const compIds = comparables.map((c) => c.marketProjectId);
    const nameById = new Map(comparables.map((c) => [c.marketProjectId, c.name]));
    const txns = compIds.length
      ? await db
          .select({
            id: marketTransactions.id,
            projectId: marketTransactions.marketProjectId,
            price: marketTransactions.priceAed,
            ppsf: marketTransactions.pricePerSqft,
            beds: marketTransactions.bedrooms,
            unitType: marketTransactions.unitType,
            asOf: marketTransactions.asOf,
          })
          .from(marketTransactions)
          .where(
            and(
              inArray(marketTransactions.marketProjectId, compIds),
              eq(marketTransactions.txnType, "sale")
            )
          )
          .orderBy(desc(marketTransactions.txnDate))
          .limit(8)
      : [];

    // Build the grounding manifest + the Facts the model is allowed to cite.
    const grounding: Array<{
      claim: string;
      sourceTable: "market_transactions" | "market_price_index" | "ai_units";
      recordId: string;
      asOf: string;
    }> = [];
    const facts: string[] = [];

    // The SUBJECT unit's own real figures — what we are actually selling. These
    // are grounded to the `ai_units` record and are the unit the message is
    // about (NOT a comparable). Listed first so they anchor the draft.
    const subjectFacts: string[] = [];
    if (subjectUnit) {
      const bits: string[] = [];
      bits.push(
        `${subjectUnit.unitType} ${subjectUnit.unitNumber} at ${subjectUnit.projectName}`,
      );
      if (subjectUnit.areaSqm != null)
        bits.push(`${subjectUnit.areaSqm} sqm`);
      if (subjectUnit.floorNumber != null)
        bits.push(`floor ${subjectUnit.floorNumber}`);
      if (subjectUnit.purchasePrice != null)
        bits.push(
          `asking AED ${Number(subjectUnit.purchasePrice).toLocaleString()}`,
        );
      if (subjectUnit.estimatedHandoverDate)
        bits.push(`handover ${subjectUnit.estimatedHandoverDate}`);
      const subjectClaim = bits.join(", ");
      subjectFacts.push(subjectClaim);
      grounding.push({
        claim: subjectClaim.slice(0, 200),
        sourceTable: "ai_units",
        recordId: subjectUnit.id,
        asOf: subjectUnit.updatedAt
          ? new Date(subjectUnit.updatedAt).toISOString()
          : new Date().toISOString(),
      });
    }

    for (const t of txns.slice(0, 4)) {
      if (t.price == null && t.ppsf == null) continue;
      const nm =
        (t.projectId ? nameById.get(t.projectId) : undefined) ??
        "a comparable project";
      const priceStr = t.price != null ? `AED ${Number(t.price).toLocaleString()}` : "n/a";
      const ppsfStr = t.ppsf != null ? `AED ${t.ppsf}/sqft` : "n/a";
      const claim = `${nm}: ${t.beds ?? ""}-bed ${t.unitType ?? "unit"} sold at ${priceStr} (${ppsfStr})`;
      grounding.push({
        claim: claim.slice(0, 200),
        sourceTable: "market_transactions",
        recordId: t.id,
        asOf: t.asOf ? new Date(t.asOf).toISOString() : new Date().toISOString(),
      });
      facts.push(claim);
    }
    for (const p of priceIndex.slice(0, 1)) {
      const ppsf = p.avgPricePerSqft;
      const yoy = p.yoyPct;
      const roi = p.roiPct;
      const claim =
        `${String(p.areaName)} ${p.segment ? String(p.segment) : ""} market: ` +
        `avg AED ${ppsf ?? "n/a"}/sqft, ${yoy ?? "n/a"}% YoY` +
        (roi != null ? `, ~${roi}% gross yield` : "");
      grounding.push({
        claim: claim.slice(0, 200),
        sourceTable: "market_price_index",
        recordId: String(p.recordId),
        asOf:
          typeof p.asOf === "string" && p.asOf
            ? p.asOf
            : new Date().toISOString(),
      });
      facts.push(claim);
    }

    // Compose — personalized, grounded, in the rep's voice and language.
    const profile =
      [target.displayName, target.title, target.companyName, target.country]
        .filter(Boolean)
        .join(" · ") || "a high-net-worth prospect";
    const signals =
      (hypothesis?.segments ?? []).filter(Boolean).join(", ") || "HNW investor";
    // What we're selling: the REAL subject unit when the brief names one;
    // otherwise fall back to the brief's generic profile. The subject unit is
    // the thing the message promotes — comps are only supporting evidence.
    const sellingShort = subjectUnit
      ? subjectFacts[0]!
      : `${segment ? segment.replace(/_/g, " ") : ""} ${
          (spec.unitType as string) ?? "residence"
        } in ${area ?? "Dubai"}` +
        (spec.bedrooms ? `, ${spec.bedrooms} bedrooms` : "") +
        (spec.priceMinAed
          ? `, from AED ${Number(spec.priceMinAed).toLocaleString()}`
          : "");
    const wordTarget = channel === "email" ? "120–160 words" : "45–80 words";
    const channelGuidance =
      channel === "email"
        ? "Format as a first-touch email with a compelling, specific subject line and short paragraphs."
        : channel === "whatsapp"
          ? "Format as a brief, friendly WhatsApp message — 1-2 short paragraphs, no subject."
          : "Format as a concise phone CALL SCRIPT the rep can read aloud: a warm opener, one grounded value point, and a soft ask for a viewing/callback. No subject.";

    const system =
      `You are a senior Dubai prime-residential sales advisor writing a concise, warm, ` +
      `professional first-touch ${channel === "message" ? "call script" : channel} to a prospective buyer, in the rep's own voice. ` +
      `Personalize it to the recipient and their wealth/segment signals. ${channelGuidance} ` +
      `The message must promote the property under "What we're selling" — that is the unit on offer. ` +
      `The figures under "Comparable evidence" are recent nearby SOLD transactions, given ONLY to justify value — ` +
      `you may reference them as market proof (e.g. "comparable homes nearby recently traded at…"), but NEVER present a comparable as the unit for sale. ` +
      `You MAY cite ONLY the figures given — never invent numbers or names. ` +
      (language === "ar" ? "Write entirely in Arabic. " : "Write in English. ") +
      `Keep the body around ${wordTarget}. Write finished, ready-to-send copy: NO placeholders, ` +
      `NO square brackets such as [Your Name], NO "Dear [name]" — address the recipient by their real first name. ` +
      `End with "Warm regards," on its own line (do not invent a signature name). ` +
      `Return STRICT JSON only: {"subject": string, "body": string}` +
      (channel === "email" ? "." : ' (subject must be an empty string).');

    const comparableLines = facts.length
      ? facts.join("\n- ")
      : "(no market comps available yet)";
    const user =
      `Recipient: ${profile}.\n` +
      `Wealth/segment signals: ${signals}.\n` +
      `What we're selling (the unit on offer — make the message about THIS): ${sellingShort}.\n` +
      `Comparable evidence (recent nearby SOLD homes, cite ONLY as market proof, verbatim figures, NEVER as the unit on offer):\n- ` +
      comparableLines +
      `\n\nWrite a personalized subject line and ${channel} body promoting the unit on offer to this specific recipient.`;

    try {
      const raw = await generateCompletion(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { temperature: 0.7, maxTokens: 700 }
      );
      const parsed = parseDraftJson(raw);
      const composedBody = (parsed.body ?? raw).trim();
      const composedSubject =
        channel === "email" ? (parsed.subject ?? "").trim() : "";
      return {
        channel,
        language,
        subject: composedSubject,
        body: composedBody,
        grounding,
      };
    } catch (e) {
      set.status = 502;
      return {
        error: e instanceof Error ? e.message : "AI draft composition failed",
        grounding,
      };
    }
  })

  // POST /api/prospecting/drafts — persist an editable, UNSENT outreach draft.
  .post("/drafts", async ({ body, set }) => {
    const result = await dispatchTool(db, "draft_outreach", body, {
      actor: PROSPECTING_OUTREACH_AGENT_ACTOR,
    });
    if (!result.ok) return unwrap(result, set);
    set.status = 201;
    return result.result; // draft_outreach publishes prospecting.outreach.drafted
  })

  // PUT /api/prospecting/drafts/:id — edit an UNSENT draft's subject/body. This
  // is workspace bookkeeping on an editable, not-yet-approved draft (Req 6.3);
  // a sent/suppressed draft is terminal and cannot be edited.
  .put("/drafts/:id", async ({ params, body, set }) => {
    const payload = (body ?? {}) as { subject?: string; body?: string };
    const [existing] = await db
      .select({ status: outreachDrafts.status })
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, params.id))
      .limit(1);
    if (!existing) {
      set.status = 404;
      return { error: "Draft not found" };
    }
    if (existing.status === "sent" || existing.status === "suppressed") {
      set.status = 409;
      return { error: `Cannot edit a ${existing.status} draft` };
    }
    const [updated] = await db
      .update(outreachDrafts)
      .set({
        subject: payload.subject ?? null,
        ...(payload.body !== undefined ? { body: payload.body } : {}),
        // An edit re-opens the draft for approval (a stale token is invalidated
        // by the rep re-approving; the draft returns to `draft` state).
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(outreachDrafts.id, params.id))
      .returning();
    return { draft: updated };
  })

  // POST /api/prospecting/drafts/:id/approve — issue the single-use, rep-bound
  // Approval_Flow token (reused admin confirmation flow). NO send occurs here.
  // Dispatched under the approving rep's identity, never an agent.
  .post("/drafts/:id/approve", async ({ params, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const result = await dispatchTool(
      db,
      "approve_outreach",
      { draftId: params.id },
      { actor: userId, userId }
    );
    if (!result.ok) return unwrap(result, set);
    return result.result; // approve_outreach publishes prospecting.outreach.approved
  })

  // POST /api/prospecting/drafts/:id/send — send an approved draft on a valid
  // token. Refuses on opt-out / expired-or-reused token; never auto-sends.
  .post("/drafts/:id/send", async ({ params, body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const payload = (body ?? {}) as { token?: string };
    if (!payload.token) {
      set.status = 400;
      return { error: "Missing approval token" };
    }
    const result = await dispatchTool(
      db,
      "send_outreach",
      { draftId: params.id, token: payload.token },
      { actor: userId, userId }
    );
    if (!result.ok) return unwrap(result, set);
    return result.result; // send_outreach publishes sent / suppressed itself
  })

  // ── Agentic Batch_Run: initiation (S? task 8.1) ─────────────────────────────

  // POST /api/prospecting/batches — initiate an autonomous Batch_Run. This is a
  // request/response KICK-OFF only (the long-running per-candidate loop runs on
  // the container job-runner tier, never here): it validates the subject, runs
  // the send-cap precheck, persists the `prospecting_batch_runs` row, and
  // enqueues the durable `prospecting_batch` job keyed by the deterministic
  // `rerun_key`, then returns immediately.
  //
  // RBAC (Req 1.2): the route is already behind `identityGuard` +
  // `requirePermission("leads:read")`; the initiating rep is authorized by that
  // server gate before the run row is created, and the owner_rep is the
  // authenticated user id. Every effect the job later performs is re-authorized
  // per-dispatch by `dispatchTool`.
  //
  // Idempotent re-run (Req 9.1/9.2): `rerun_key` is derived from
  // `{ ownerRep, subject }`; the run row is upserted by `rerun_key` (reuse the
  // existing row on conflict) and the job is enqueued with `rerun_key` as its
  // `job_key` (the spine's `ON CONFLICT (job_key) DO NOTHING` makes the enqueue
  // idempotent), so an equivalent re-run never spawns a duplicate run or job.
  .post("/batches", async ({ body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    const payload = (body ?? {}) as {
      subject?: Partial<BatchSubject>;
      targetCount?: unknown;
    };

    // ── Validate StartBatchRequest → BatchSubject (Req 1.1, 1.4) ──────────────
    const rawSubject = payload.subject ?? {};
    const hasCluster = Boolean(rawSubject.clusterId);
    const hasIcp = Boolean(rawSubject.icpFilter);
    // Reject when neither a Bayn cluster reference nor an ICP filter is present:
    // the Batch_Run has no subject to work and SHALL NOT start (Req 1.4).
    if (!hasCluster && !hasIcp) {
      set.status = 400;
      return {
        error:
          "A Batch_Run requires a subject: either a cluster reference (clusterId) or an ICP filter (icpFilter).",
        code: "invalid_subject",
      };
    }

    // Normalize the subject. `kind` records which side is authoritative; default
    // it from the supplied refs (cluster ref wins) when the caller omits it.
    const subject: BatchSubject = {
      kind: rawSubject.kind ?? (hasCluster ? "cluster" : "icp"),
      ...(rawSubject.clusterId ? { clusterId: rawSubject.clusterId } : {}),
      ...(rawSubject.briefId ? { briefId: rawSubject.briefId } : {}),
      ...(rawSubject.icpFilter ? { icpFilter: rawSubject.icpFilter } : {}),
    };

    // Target count N — a positive integer (Req 1.1).
    const targetCount = Number(payload.targetCount);
    if (!Number.isInteger(targetCount) || targetCount <= 0) {
      set.status = 400;
      return {
        error: "targetCount must be a positive integer.",
        code: "invalid_target_count",
      };
    }

    // Cluster scoping for the send cap (denormalized onto the run row).
    const clusterId = subject.clusterId ?? null;

    // ── Send-cap precheck (Req 1.5, Req 7) ────────────────────────────────────
    // Reject before the run starts when the rep's or cluster's remaining budget
    // for the current period is zero. The period bucket is the daily key (the
    // same convention the batch handler uses), so the precheck reads the same
    // counters a send would later increment.
    const periodBucket = dailyPeriodBucket(new Date());
    if (
      await capExhausted(db, {
        scopeKind: "rep",
        scopeId: userId,
        periodBucket,
      })
    ) {
      set.status = 409;
      return { error: "Send cap exhausted for this rep.", code: "cap_exhausted" };
    }
    if (
      clusterId &&
      (await capExhausted(db, {
        scopeKind: "cluster",
        scopeId: clusterId,
        periodBucket,
      }))
    ) {
      set.status = 409;
      return {
        error: "Send cap exhausted for this cluster.",
        code: "cap_exhausted",
      };
    }

    // ── Upsert the run by rerun_key (Req 1.3, 9.1, 9.2) ───────────────────────
    const rerunKey = deriveRerunKey({ ownerRep: userId, subject });
    const inserted = await db
      .insert(prospectingBatchRuns)
      .values({
        ownerRep: userId,
        subject,
        clusterId,
        targetCount,
        status: "running",
        rerunKey,
      })
      .onConflictDoNothing({ target: prospectingBatchRuns.rerunKey })
      .returning({
        id: prospectingBatchRuns.id,
        status: prospectingBatchRuns.status,
      });

    let run = inserted[0];
    if (!run) {
      // Conflict: an equivalent Batch_Run already exists for this rerun_key —
      // reuse the existing row (idempotent re-run, Req 9.2).
      const [existing] = await db
        .select({
          id: prospectingBatchRuns.id,
          status: prospectingBatchRuns.status,
        })
        .from(prospectingBatchRuns)
        .where(eq(prospectingBatchRuns.rerunKey, rerunKey))
        .limit(1);
      run = existing;
    }

    // ── Enqueue the durable job keyed by rerun_key (Req 9.2) ──────────────────
    // `enqueueJob` inserts with `ON CONFLICT (job_key) DO NOTHING`, so a re-run
    // of an in-flight/completed batch does not enqueue a duplicate job.
    await enqueueJob(db, "prospecting_batch", { batchRunId: run.id }, rerunKey);

    set.status = 201;
    return { batchRunId: run.id, status: run.status };
  })

  // ── Prospecting Sequences: named, toggleable background campaigns ───────────
  //
  // A Sequence is the durable, owner-scoped campaign the rep manages: a subject
  // (cluster / ICP) + target count + name/description, with a `mode` toggle
  // (`draft` = paused, `live` = the agent prospects in the background). Going
  // `live` enqueues a `prospecting_batch` run linked to the sequence, which the
  // worker tier processes — landing prospects in the review inbox. Multiple
  // sequences run in parallel (each is an independent row + independent runs).

  // POST /api/prospecting/sequences — create a sequence (starts in `draft`).
  .post("/sequences", async ({ body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const payload = (body ?? {}) as {
      name?: unknown;
      description?: unknown;
      subject?: Partial<BatchSubject>;
      targetCount?: unknown;
    };

    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) {
      set.status = 400;
      return { error: "A sequence needs a name.", code: "invalid_name" };
    }

    const rawSubject = payload.subject ?? {};
    const hasCluster = Boolean(rawSubject.clusterId);
    const hasIcp = Boolean(rawSubject.icpFilter);
    if (!hasCluster && !hasIcp) {
      set.status = 400;
      return {
        error:
          "A sequence requires a subject: either a cluster reference (clusterId) or an ICP filter (icpFilter).",
        code: "invalid_subject",
      };
    }
    const subject: BatchSubject = {
      kind: rawSubject.kind ?? (hasCluster ? "cluster" : "icp"),
      ...(rawSubject.clusterId ? { clusterId: rawSubject.clusterId } : {}),
      ...(rawSubject.briefId ? { briefId: rawSubject.briefId } : {}),
      ...(rawSubject.icpFilter ? { icpFilter: rawSubject.icpFilter } : {}),
    };

    const n = Number(payload.targetCount);
    const targetCount = Number.isInteger(n) && n > 0 && n <= 500 ? n : 10;

    const [seq] = await db
      .insert(prospectingSequences)
      .values({
        ownerRep: userId,
        name,
        description:
          typeof payload.description === "string" ? payload.description.trim() : null,
        subject,
        targetCount,
        mode: "draft",
      })
      .returning();

    set.status = 201;
    return { sequence: seq };
  })

  // GET /api/prospecting/sequences — list the rep's sequences, newest first,
  // each with a count of prospects awaiting review (pending, cold-eligible
  // queue items across the sequence's runs) and its most recent run status.
  .get("/sequences", async ({ set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const rows = await db
      .select()
      .from(prospectingSequences)
      .where(eq(prospectingSequences.ownerRep, userId))
      .orderBy(desc(prospectingSequences.createdAt));

    // Pending-prospect count per sequence (cold-eligible items awaiting review).
    const counts = await db
      .select({
        sequenceId: prospectingBatchRuns.sequenceId,
        pending: sql<number>`count(*)::int`,
      })
      .from(prospectingQueueItems)
      .innerJoin(
        prospectingBatchRuns,
        eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId)
      )
      .where(
        and(
          eq(prospectingBatchRuns.ownerRep, userId),
          eq(prospectingQueueItems.status, "pending"),
          eq(prospectingQueueItems.eligibility, "cold_eligible")
        )
      )
      .groupBy(prospectingBatchRuns.sequenceId);
    const pendingBySeq = new Map(
      counts.map((c) => [c.sequenceId, Number(c.pending)])
    );

    const sequences = rows.map((s) => ({
      ...s,
      pendingProspects: pendingBySeq.get(s.id) ?? 0,
    }));
    return { count: sequences.length, sequences };
  })

  // GET /api/prospecting/sequences/:id — one sequence plus its prospects awaiting
  // review (the same privacy-safe, grounded projection the review inbox uses,
  // scoped to this sequence's runs).
  .get("/sequences/:id", async ({ params, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const [seq] = await db
      .select()
      .from(prospectingSequences)
      .where(
        and(
          eq(prospectingSequences.id, params.id),
          eq(prospectingSequences.ownerRep, userId)
        )
      )
      .limit(1);
    if (!seq) {
      set.status = 404;
      return { error: "Sequence not found" };
    }

    const items = await db
      .select({
        id: prospectingQueueItems.id,
        batchRunId: prospectingQueueItems.batchRunId,
        targetId: prospectingQueueItems.targetId,
        draftId: prospectingQueueItems.draftId,
        eligibility: prospectingQueueItems.eligibility,
        status: prospectingQueueItems.status,
        fitScore: prospectingQueueItems.fitScore,
        fitRationale: prospectingQueueItems.fitRationale,
        lawfulBasis: prospectingQueueItems.lawfulBasis,
        dataSource: prospectingQueueItems.dataSource,
        acquiredAt: prospectingQueueItems.acquiredAt,
        createdAt: prospectingQueueItems.createdAt,
        updatedAt: prospectingQueueItems.updatedAt,
        draftSubject: outreachDrafts.subject,
        draftBody: outreachDrafts.body,
        draftChannel: outreachDrafts.channel,
        draftLanguage: outreachDrafts.language,
        draftStatus: outreachDrafts.status,
        targetType: targets.targetType,
        targetDisplayName: targets.displayName,
        targetCompanyName: targets.companyName,
        targetTitle: targets.title,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
        targetCountry: targets.country,
        targetStatus: targets.status,
      })
      .from(prospectingQueueItems)
      .innerJoin(
        prospectingBatchRuns,
        and(
          eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId),
          eq(prospectingBatchRuns.ownerRep, userId),
          eq(prospectingBatchRuns.sequenceId, params.id)
        )
      )
      .leftJoin(outreachDrafts, eq(outreachDrafts.id, prospectingQueueItems.draftId))
      .leftJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
      .where(
        and(
          eq(prospectingQueueItems.status, "pending"),
          eq(prospectingQueueItems.eligibility, "cold_eligible")
        )
      )
      .orderBy(desc(prospectingQueueItems.createdAt));

    return { sequence: seq, count: items.length, queueItems: items };
  })

  // PATCH /api/prospecting/sequences/:id — update a sequence's name/description/
  // target count and/or toggle its `mode`. Turning it `live` enqueues a durable
  // `prospecting_batch` run linked to the sequence so the agent prospects in the
  // background; turning it `draft` simply pauses (existing prospects remain for
  // review). The run is keyed so a double-toggle never spawns a duplicate.
  .patch("/sequences/:id", async ({ params, body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const payload = (body ?? {}) as {
      name?: unknown;
      description?: unknown;
      targetCount?: unknown;
      mode?: unknown;
    };

    const [seq] = await db
      .select()
      .from(prospectingSequences)
      .where(
        and(
          eq(prospectingSequences.id, params.id),
          eq(prospectingSequences.ownerRep, userId)
        )
      )
      .limit(1);
    if (!seq) {
      set.status = 404;
      return { error: "Sequence not found" };
    }

    const updates: Partial<typeof prospectingSequences.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof payload.name === "string" && payload.name.trim()) {
      updates.name = payload.name.trim();
    }
    if (typeof payload.description === "string") {
      updates.description = payload.description.trim() || null;
    }
    if (payload.targetCount !== undefined) {
      const n = Number(payload.targetCount);
      if (Number.isInteger(n) && n > 0 && n <= 500) updates.targetCount = n;
    }
    const goingLive = payload.mode === "live" && seq.mode !== "live";
    if (payload.mode === "live" || payload.mode === "draft") {
      updates.mode = payload.mode;
    }

    const [updated] = await db
      .update(prospectingSequences)
      .set(updates)
      .where(eq(prospectingSequences.id, seq.id))
      .returning();

    // Turning live → launch a background run for this sequence (reuses the
    // durable batch machinery). Keyed by sequence id + run ordinal so repeated
    // toggles never duplicate an in-flight run but each genuine "go live" can
    // start a fresh sweep.
    let launchedRunId: string | null = null;
    if (goingLive) {
      const subject = updated.subject as BatchSubject;
      const existingRuns = await db
        .select({ id: prospectingBatchRuns.id })
        .from(prospectingBatchRuns)
        .where(eq(prospectingBatchRuns.sequenceId, seq.id));
      const rerunKey = `seq:${seq.id}:${existingRuns.length}`;
      const inserted = await db
        .insert(prospectingBatchRuns)
        .values({
          ownerRep: userId,
          sequenceId: seq.id,
          subject,
          clusterId: subject.kind === "cluster" ? subject.clusterId ?? null : null,
          targetCount: updated.targetCount,
          rerunKey,
        })
        .onConflictDoNothing({ target: prospectingBatchRuns.rerunKey })
        .returning({ id: prospectingBatchRuns.id });
      const run = inserted[0];
      if (run) {
        await enqueueJob(db, "prospecting_batch", { batchRunId: run.id }, rerunKey);
        launchedRunId = run.id;
      }
    }

    return { sequence: updated, launchedRunId };
  })

  // ── Agentic Batch_Run: batch + activity reads (task 8.2) ────────────────────

  // GET /api/prospecting/batches — list the requesting rep's Batch_Runs, newest
  // first (Req 1.3, 3.5). Scoped to `owner_rep = ctx.userId`: a rep only ever
  // sees the runs they initiated. Read-only bookkeeping, no PII (a run row
  // carries ids, subject, target count, status, and terminal reason only).
  .get("/batches", async ({ set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const rows = await db
      .select({
        id: prospectingBatchRuns.id,
        ownerRep: prospectingBatchRuns.ownerRep,
        subject: prospectingBatchRuns.subject,
        clusterId: prospectingBatchRuns.clusterId,
        targetCount: prospectingBatchRuns.targetCount,
        status: prospectingBatchRuns.status,
        reason: prospectingBatchRuns.reason,
        createdAt: prospectingBatchRuns.createdAt,
        updatedAt: prospectingBatchRuns.updatedAt,
      })
      .from(prospectingBatchRuns)
      .where(eq(prospectingBatchRuns.ownerRep, userId))
      .orderBy(desc(prospectingBatchRuns.createdAt));
    return { count: rows.length, batches: rows };
  })

  // GET /api/prospecting/batches/:id — one Batch_Run plus its queue items
  // (Req 3.5, 4.1). Scoped to the owning rep: a run not owned by the requesting
  // rep is reported as 404 (no cross-rep disclosure). The queue items are joined
  // to their Target and projected PRIVACY-SAFELY — `phoneHash` ONLY, the raw
  // phone is NEVER returned (CC-Privacy, same invariant as `selectTargets`).
  .get("/batches/:id", async ({ params, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const [run] = await db
      .select()
      .from(prospectingBatchRuns)
      .where(
        and(
          eq(prospectingBatchRuns.id, params.id),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .limit(1);
    if (!run) {
      set.status = 404;
      return { error: "Batch run not found" };
    }

    const items = await db
      .select({
        id: prospectingQueueItems.id,
        batchRunId: prospectingQueueItems.batchRunId,
        targetId: prospectingQueueItems.targetId,
        draftId: prospectingQueueItems.draftId,
        eligibility: prospectingQueueItems.eligibility,
        skipReason: prospectingQueueItems.skipReason,
        fitScore: prospectingQueueItems.fitScore,
        fitRationale: prospectingQueueItems.fitRationale,
        lawfulBasis: prospectingQueueItems.lawfulBasis,
        dataSource: prospectingQueueItems.dataSource,
        acquiredAt: prospectingQueueItems.acquiredAt,
        status: prospectingQueueItems.status,
        createdAt: prospectingQueueItems.createdAt,
        updatedAt: prospectingQueueItems.updatedAt,
        // Privacy-safe Target projection — phoneHash ONLY, never the raw phone.
        targetType: targets.targetType,
        targetDisplayName: targets.displayName,
        targetCompanyName: targets.companyName,
        targetTitle: targets.title,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
        targetCountry: targets.country,
        targetStatus: targets.status,
      })
      .from(prospectingQueueItems)
      .leftJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
      .where(eq(prospectingQueueItems.batchRunId, params.id))
      .orderBy(desc(prospectingQueueItems.createdAt));

    return { run, queueItems: items, count: items.length };
  })

  // GET /api/prospecting/batches/:id/activity — the persisted Agent_Activity_Log
  // for a Batch_Run, ordered by monotonic `seq` (Req 3.5). `readActivity`
  // returns privacy-safe rows (internal ids only — CC-Privacy). On a read
  // FAILURE the route surfaces an explicit 500 error and SHALL NOT return an
  // empty/successful result silently (Req 3.6): an empty activity log is only
  // ever a genuinely empty run, never a swallowed read error.
  .get("/batches/:id/activity", async ({ params, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    // Scope to the owning rep — a run not owned by the requester is 404.
    const [run] = await db
      .select({ id: prospectingBatchRuns.id })
      .from(prospectingBatchRuns)
      .where(
        and(
          eq(prospectingBatchRuns.id, params.id),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .limit(1);
    if (!run) {
      set.status = 404;
      return { error: "Batch run not found" };
    }

    try {
      const activity = await readActivity(db, params.id);
      return { count: activity.length, activity };
    } catch (err) {
      // Req 3.6: a log-retrieval failure SHALL surface an error, NEVER an empty
      // or silently-successful result.
      set.status = 500;
      return {
        error: "Failed to retrieve Agent_Activity_Log for this batch run.",
        code: "activity_read_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  })

  // ── Approval Queue / Review Inbox: present + edit (task 8.3) ────────────────

  // GET /api/prospecting/queue — the rep's Review Inbox: every PENDING,
  // cold-eligible Queued_Item awaiting human review (Req 4.1, 4.5). Each item is
  // presented WITH its grounded draft content (subject, body, channel,
  // language), its deterministic Fit_Score + rationale, and the lawful-basis
  // provenance (basis marker, data source, acquisition timestamp — CC-Provenance).
  //
  // Scoping: INNER-joined to `prospecting_batch_runs` filtered by
  // `owner_rep = ctx.userId`, so a rep only ever sees the items their own
  // Batch_Runs produced (no cross-rep disclosure — same invariant as the
  // batch reads). The Target is LEFT-joined and projected PRIVACY-SAFELY —
  // `phoneHash` ONLY, the raw phone is NEVER returned (CC-Privacy). Only
  // `status = 'pending'` AND `eligibility = 'cold_eligible'` rows surface here:
  // warm-path / skipped items are not part of the cold-outreach review inbox.
  .get("/queue", async ({ set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const items = await db
      .select({
        id: prospectingQueueItems.id,
        batchRunId: prospectingQueueItems.batchRunId,
        targetId: prospectingQueueItems.targetId,
        draftId: prospectingQueueItems.draftId,
        eligibility: prospectingQueueItems.eligibility,
        status: prospectingQueueItems.status,
        // Fit decision (Req 2.4) — deterministic score + which signals matched.
        fitScore: prospectingQueueItems.fitScore,
        fitRationale: prospectingQueueItems.fitRationale,
        // Lawful-basis provenance (Req 4.1, 10.1 — CC-Provenance).
        lawfulBasis: prospectingQueueItems.lawfulBasis,
        dataSource: prospectingQueueItems.dataSource,
        acquiredAt: prospectingQueueItems.acquiredAt,
        createdAt: prospectingQueueItems.createdAt,
        updatedAt: prospectingQueueItems.updatedAt,
        // Grounded draft content presented for review (Req 4.1).
        draftSubject: outreachDrafts.subject,
        draftBody: outreachDrafts.body,
        draftChannel: outreachDrafts.channel,
        draftLanguage: outreachDrafts.language,
        draftStatus: outreachDrafts.status,
        // Privacy-safe Target projection — phoneHash ONLY, never the raw phone.
        targetType: targets.targetType,
        targetDisplayName: targets.displayName,
        targetCompanyName: targets.companyName,
        targetTitle: targets.title,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
        targetCountry: targets.country,
        targetStatus: targets.status,
      })
      .from(prospectingQueueItems)
      // INNER join scopes the inbox to the requesting rep's own Batch_Runs.
      .innerJoin(
        prospectingBatchRuns,
        and(
          eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .leftJoin(outreachDrafts, eq(outreachDrafts.id, prospectingQueueItems.draftId))
      .leftJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
      .where(
        and(
          eq(prospectingQueueItems.status, "pending"),
          eq(prospectingQueueItems.eligibility, "cold_eligible")
        )
      )
      .orderBy(desc(prospectingQueueItems.createdAt));

    return { count: items.length, queueItems: items };
  })

  // PUT /api/prospecting/queue/:id — edit a Queued_Item's draft subject/body and
  // persist the change onto `outreach_drafts` (Req 4.2). The draft is resolved
  // via the queue item's `draft_id`; the queue item must belong to one of the
  // requesting rep's own Batch_Runs (else 404 — no cross-rep edit).
  //
  // CRITICAL (Req 4.2 — retain the AI original for audit): on the FIRST edit
  // ONLY, the draft's CURRENT (AI-drafted) subject/body are copied into the
  // additive `ai_original_subject` / `ai_original_body` columns BEFORE the new
  // content overwrites them. On every subsequent edit those columns are left
  // untouched so the VERY FIRST AI original is preserved verbatim — never
  // clobbered by a later edit. "First edit" is detected by `ai_original_body`
  // still being null (body is NOT NULL on a fresh draft, so a null original-body
  // means no edit has been recorded yet).
  .put("/queue/:id", async ({ params, body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }
    const payload = (body ?? {}) as { subject?: string; body?: string };

    // Load the queue item, scoped to the requesting rep's own Batch_Runs.
    const [item] = await db
      .select({
        id: prospectingQueueItems.id,
        draftId: prospectingQueueItems.draftId,
      })
      .from(prospectingQueueItems)
      .innerJoin(
        prospectingBatchRuns,
        and(
          eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .where(eq(prospectingQueueItems.id, params.id))
      .limit(1);
    if (!item) {
      set.status = 404;
      return { error: "Queue item not found" };
    }
    if (!item.draftId) {
      // A warm-path / skipped item carries no editable draft.
      set.status = 409;
      return { error: "Queue item has no editable draft" };
    }

    // Resolve the draft and read its CURRENT content + retained AI original.
    const [draft] = await db
      .select({
        status: outreachDrafts.status,
        subject: outreachDrafts.subject,
        body: outreachDrafts.body,
        aiOriginalSubject: outreachDrafts.aiOriginalSubject,
        aiOriginalBody: outreachDrafts.aiOriginalBody,
      })
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, item.draftId))
      .limit(1);
    if (!draft) {
      set.status = 404;
      return { error: "Draft not found" };
    }
    if (draft.status === "sent" || draft.status === "suppressed") {
      set.status = 409;
      return { error: `Cannot edit a ${draft.status} draft` };
    }

    // First-edit AI-original preservation (Req 4.2). `ai_original_body` is null
    // until the first edit (body is NOT NULL on a fresh draft), so a null value
    // marks "no edit recorded yet" → copy the current AI content across. On
    // subsequent edits this is skipped, preserving the very first original.
    const isFirstEdit = draft.aiOriginalBody === null;

    const [updated] = await db
      .update(outreachDrafts)
      .set({
        subject: payload.subject ?? null,
        ...(payload.body !== undefined ? { body: payload.body } : {}),
        ...(isFirstEdit
          ? {
              aiOriginalSubject: draft.subject,
              aiOriginalBody: draft.body,
            }
          : {}),
        // An edit re-opens the draft for approval (a stale token is invalidated
        // by the rep re-approving; the draft returns to `draft` state).
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(outreachDrafts.id, item.draftId))
      .returning();

    return { queueItemId: item.id, draft: updated };
  })

  // POST /api/prospecting/queue/:id/approve — approve + SEND one Queued_Item
  // under the approving rep's identity (Req 4.3, 8.1–8.4). This is the human
  // gate: NOTHING sends without it, and the send runs as the REP (`ctx.userId`),
  // never an agent.
  //
  // SEND-TIME GUARDRAIL RE-CHECK (Req 6.4, 7.2): even though the candidate
  // passed opt-out + cap when it was drafted, both are re-checked HERE, at send
  // time, against the SAME counters/opt-out store a send consults. A queued item
  // therefore never sends past the cap or to a now-opted-out prospect even if it
  // was drafted earlier. On a block the route returns a structured
  // `{ skipped: true, reason }` with NO send and leaves the item's status
  // unchanged (it does NOT become `sent`).
  //
  // On a clear gate it dispatches `approve_outreach` then `send_outreach` under
  // `{ actor: userId, userId }` (the exact pattern the /drafts routes use); the
  // `send_outreach` tool performs the channel send AND enqueues the Salesforce
  // side effect to `sf_outbox` under the draft's `job_key` (at-most-once — reused
  // verbatim, not reinvented here). After a CONFIRMED send the route increments
  // the send-cap counters EXACTLY ONCE via `recordSend` (rep + cluster scopes)
  // and flips the queue item to `sent` (Req 7.5, 7.6, 4.5).
  .post("/queue/:id/approve", async ({ params, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    // Resolve the queue item, scoped to the requesting rep's own Batch_Runs
    // (else 404 — no cross-rep send). Carry the run's `cluster_id` (cap scope)
    // and the Target's privacy-safe identity (email + phone_hash) for the
    // send-time opt-out re-check.
    const [item] = await db
      .select({
        id: prospectingQueueItems.id,
        draftId: prospectingQueueItems.draftId,
        clusterId: prospectingBatchRuns.clusterId,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
      })
      .from(prospectingQueueItems)
      .innerJoin(
        prospectingBatchRuns,
        and(
          eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .leftJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
      .where(eq(prospectingQueueItems.id, params.id))
      .limit(1);
    if (!item) {
      set.status = 404;
      return { error: "Queue item not found" };
    }
    if (!item.draftId) {
      // A warm-path / skipped item carries no sendable draft.
      set.status = 409;
      return { error: "Queue item has no draft to send" };
    }

    // ── Send-time guardrail re-check (Req 6.4, 7.2) ───────────────────────────
    // The daily period key both the cap read and the post-send increment share.
    const periodBucket = dailyPeriodBucket(new Date());

    // Opt-out re-check at send time (Req 7.3): a prospect that opted out AFTER
    // the draft was composed must not be sent to. Matched on the same
    // privacy-safe keys the party graph uses (normalized email + salted hash).
    if (
      await isOptedOut(db, {
        emailHash: item.targetEmail ?? undefined,
        phoneHash: item.targetPhoneHash ?? undefined,
      })
    ) {
      // Structured skip — NO send, status left unchanged.
      return { skipped: true, reason: "opted_out" };
    }

    // Cap re-check at send time (Req 7.2): block a send that would exceed the
    // rep's or the cluster's remaining budget for the current period.
    if (await capExhausted(db, { scopeKind: "rep", scopeId: userId, periodBucket })) {
      return { skipped: true, reason: "cap_reached" };
    }
    if (
      item.clusterId &&
      (await capExhausted(db, {
        scopeKind: "cluster",
        scopeId: item.clusterId,
        periodBucket,
      }))
    ) {
      return { skipped: true, reason: "cap_reached" };
    }

    // ── Approve under the REP's identity (Req 8 / CC-HITL) ────────────────────
    // Same dispatch pattern as POST /drafts/:id/approve — never an agent.
    const approveResult = await dispatchTool(
      db,
      "approve_outreach",
      { draftId: item.draftId },
      { actor: userId, userId }
    );
    if (!approveResult.ok) return unwrap(approveResult, set);
    const approval = approveResult.result as {
      token?: string;
      status?: string;
      reason?: string;
    };
    if (!approval.token) {
      // No token issued — the draft is already sent or suppressed; no send is
      // possible. Surface a structured skip, leave the item status unchanged.
      return {
        skipped: true,
        reason: approval.reason ?? "not_approved",
        status: approval.status,
      };
    }

    // ── Send under the REP's identity on the single-use token ─────────────────
    // `send_outreach` performs the channel send AND enqueues the Salesforce side
    // effect to `sf_outbox` under the draft's `job_key` (at-most-once) — reused
    // verbatim, not reinvented here.
    const sendResult = await dispatchTool(
      db,
      "send_outreach",
      { draftId: item.draftId, token: approval.token },
      { actor: userId, userId }
    );
    if (!sendResult.ok) return unwrap(sendResult, set);
    const send = sendResult.result as {
      sent: boolean;
      status: string;
      reason?: string;
      messageId?: string;
    };

    // A refused / suppressed send (e.g. an opt-out the tool itself caught, or a
    // token refusal) — NO counter increment, the item is NOT marked sent.
    if (!send.sent || send.status !== "sent") {
      return {
        skipped: true,
        reason: send.reason ?? "not_sent",
        status: send.status,
      };
    }

    // ── Exactly-once counter increment after a CONFIRMED send (Req 7.5, 7.6) ──
    // `recordSend` advances the rep AND cluster scopes as two independent,
    // exactly-once increments. For an ICP-subject run with no cluster, only the
    // rep scope is meaningful, so increment it directly (mirrors the cluster-cap
    // precheck above, which is cluster-scoped only when a cluster is present).
    if (item.clusterId) {
      await recordSend(db, {
        draftId: item.draftId,
        repId: userId,
        clusterId: item.clusterId,
        periodBucket,
      });
    } else {
      await incrementScope(db, "rep", userId, periodBucket, item.draftId);
    }

    // Single status field → `sent` (Req 4.5 — never two states at once).
    await db
      .update(prospectingQueueItems)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(prospectingQueueItems.id, item.id));

    await publishEvent(db, {
      type: EV_QUEUE_ITEM_SENT,
      payload: { queueItemId: item.id, draftId: item.draftId },
    });

    return {
      queueItemId: item.id,
      sent: true,
      status: "sent",
      messageId: send.messageId ?? null,
    };
  })

  // POST /api/prospecting/queue/bulk-approve — approve + SEND a SELECTED SET of
  // Queued_Items, applying the SAME per-item send-time gate the single-item
  // route uses (Req 5.1). The body is `{ ids: string[] }` (the selected queue
  // item ids). The loop NEVER aborts on a blocked/failed item: an item that
  // would exceed a Send_Cap is skipped `cap_reached` (Req 5.2) and an item
  // targeting an opted-out prospect is skipped `opted_out` (Req 5.3), and the
  // loop CONTINUES with the remaining items. Returns the counts of items
  // approved + sent and the per-item skip reasons (Req 5.4).
  //
  // The cap is re-read INSIDE the loop per item (via the shared
  // `approveAndSendQueueItem` gate, which calls `capExhausted` fresh and
  // advances the counters via `recordSend` on each confirmed send), so a send
  // earlier in the loop that consumes the last of the budget correctly causes a
  // later selected item to be skipped `cap_reached`. `approved + skipped`
  // accounts for every selected id, and `sent <= approved` (an item may be
  // approved but have its send refused).
  .post("/queue/bulk-approve", async ({ body, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    const payload = (body ?? {}) as { ids?: unknown };
    // Accept only string ids, de-duplicated while preserving the caller's
    // selection order (so the cap-consumption order is the rep's order).
    const ids = Array.isArray(payload.ids)
      ? [
          ...new Set(
            payload.ids.filter((x): x is string => typeof x === "string")
          ),
        ]
      : [];
    if (ids.length === 0) {
      set.status = 400;
      return { error: "Provide a non-empty `ids` array of queue item ids" };
    }

    // Resolve all selected items in one read, scoped to the requesting rep's own
    // Batch_Runs (the same join the single-item /queue/:id/approve route uses);
    // an id that resolves to no row is not the rep's and is skipped `not_found`.
    const rows = await db
      .select({
        id: prospectingQueueItems.id,
        draftId: prospectingQueueItems.draftId,
        clusterId: prospectingBatchRuns.clusterId,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
      })
      .from(prospectingQueueItems)
      .innerJoin(
        prospectingBatchRuns,
        and(
          eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .leftJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
      .where(inArray(prospectingQueueItems.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));

    // The daily period key the cap reads + post-send increments share.
    const periodBucket = dailyPeriodBucket(new Date());

    let approved = 0;
    let sent = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    // Loop the selection IN ORDER, applying the SAME per-item gate. Each call
    // re-reads the cap and (on a confirmed send) advances the counters, so
    // budget consumed earlier in the loop blocks later items (Req 5.2).
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) {
        skipped.push({ id, reason: "not_found" });
        continue;
      }
      const outcome = await approveAndSendQueueItem(item, userId, periodBucket);
      if (outcome.kind === "sent") {
        approved += 1;
        sent += 1;
      } else if (outcome.kind === "approved_unsent") {
        // Approved (token issued) but not sent — counts toward approved only.
        approved += 1;
      } else {
        skipped.push({ id, reason: outcome.reason });
      }
    }

    return { approved, sent, skipped };
  })

  // POST /api/prospecting/queue/:id/reject — reject one Queued_Item (Req 4.4, 6).
  // Sets the item's single status field to `rejected`, sends NOTHING, and
  // RELEASES the cross-rep claim on the Target's identity so a freed prospect
  // becomes claimable again by another rep (`releaseClaim`, Req 6.2). The item
  // must belong to one of the requesting rep's own Batch_Runs (else 404).
  .post("/queue/:id/reject", async ({ params, set, ...ctx }) => {
    const userId = (ctx as { userId?: string }).userId;
    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    // Resolve the item (rep-scoped) and load the Target identity needed to build
    // the ClaimIdentity for release: the normalized email and the transient raw
    // phone (the claim was keyed on email + salted phone hash).
    const [item] = await db
      .select({
        id: prospectingQueueItems.id,
        targetEmail: targets.email,
        targetRawPhone: targets.rawPhone,
      })
      .from(prospectingQueueItems)
      .innerJoin(
        prospectingBatchRuns,
        and(
          eq(prospectingBatchRuns.id, prospectingQueueItems.batchRunId),
          eq(prospectingBatchRuns.ownerRep, userId)
        )
      )
      .leftJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
      .where(eq(prospectingQueueItems.id, params.id))
      .limit(1);
    if (!item) {
      set.status = 404;
      return { error: "Queue item not found" };
    }

    // Single status field → `rejected` (Req 4.5). No send occurs.
    await db
      .update(prospectingQueueItems)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(prospectingQueueItems.id, item.id));

    // Release the cross-rep claim (Req 4.4, 6.2) — idempotent; uses the same
    // identity normalization the claim was taken under.
    await releaseClaim(db, {
      email: item.targetEmail ?? undefined,
      phone: item.targetRawPhone ?? undefined,
    });

    await publishEvent(db, {
      type: EV_QUEUE_ITEM_REJECTED,
      payload: { queueItemId: item.id },
    });

    return { queueItemId: item.id, status: "rejected" };
  })

  // ── Live updates (SSE) — prospecting.* / market.* events only ───────────────
  // Durable connection: effective on the Bun mount; Caddy routes /api/realtime/*
  // there. Reuses the shared SSE fan-out with a scoped filter so this stream
  // carries only the prospecting/market event family.
  .get("/events", ({ request }) =>
    streamEvents(request, undefined, {
      filter: (event) =>
        event.type.startsWith("prospecting.") || event.type.startsWith("market."),
    })
  );

// ── Send-cap period bucket (daily) ────────────────────────────────────────────
// The daily period key (`YYYY-MM-DD`) the send-cap counters are bucketed under.
// Mirrors the batch handler's `toPeriodBucket` so the start-time precheck reads
// the same counter a later send increments (Req 1.5, 7.4).
function dailyPeriodBucket(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// ── Shared per-item approve + send gate (design §5, tasks 8.4 + 8.5) ───────────
// The ONE place the send-time guardrail + approve + send sequence lives, so the
// single-item route (POST /queue/:id/approve) and the bulk route (POST
// /queue/bulk-approve) apply the EXACT same gate per item. Mirrors the 8.4
// sequence verbatim: opt-out re-check → cap re-check (rep + cluster) →
// approve_outreach → send_outreach (both under the approving REP's identity,
// `{ actor: userId, userId }`) → recordSend/incrementScope after a CONFIRMED
// send → flip the item to `sent`. Returns a structured outcome rather than
// mutating an HTTP `set`, so a caller looping a selection can tally the result
// and CONTINUE past a blocked/failed item (Req 5.1–5.4, 6.4, 7.2, 7.5, 7.6).
//
// Critically, the cap is re-read on EVERY call (via `capExhausted`) and the
// counters are advanced (via `recordSend`/`incrementScope`) on every confirmed
// send, so when the bulk route loops a selection, sends earlier in the loop
// consume budget and cause later items to be correctly skipped `cap_reached`.

/** The rep-scoped projection of a queue item needed to gate + send it. */
interface ResolvedQueueItem {
  id: string;
  draftId: string | null;
  clusterId: string | null;
  targetEmail: string | null;
  targetPhoneHash: string | null;
}

/**
 * The outcome of gating + approving + sending one queue item:
 *   - `sent` — passed the gate, approved, AND confirmed sent (approved + sent);
 *   - `approved_unsent` — approved (token issued) but the send was refused or
 *     errored, so it counts as approved but NOT sent (sent <= approved);
 *   - `skipped` — blocked by the gate (opt-out / cap / no draft) or never
 *     approved (no token / dispatch error); not approved.
 */
type ApproveSendOutcome =
  | { kind: "sent"; messageId: string | null }
  | { kind: "approved_unsent"; reason: string; status?: string }
  | { kind: "skipped"; reason: string; status?: string };

/**
 * Apply the send-time gate to one resolved queue item and, if it clears,
 * approve + send it under the rep's identity. Pure of HTTP concerns: it never
 * touches a `set`, so it is safe to call in a loop that must continue past a
 * blocked item. Identical in sequence to the inline 8.4 single-item route.
 */
async function approveAndSendQueueItem(
  item: ResolvedQueueItem,
  userId: string,
  periodBucket: string
): Promise<ApproveSendOutcome> {
  // A warm-path / skipped item carries no sendable draft — skip it.
  if (!item.draftId) {
    return { kind: "skipped", reason: "no_draft" };
  }
  const draftId = item.draftId;

  // ── Opt-out re-check at send time (Req 6.4) ───────────────────────────────
  // A prospect that opted out AFTER the draft was composed must not be sent to.
  if (
    await isOptedOut(db, {
      emailHash: item.targetEmail ?? undefined,
      phoneHash: item.targetPhoneHash ?? undefined,
    })
  ) {
    return { kind: "skipped", reason: "opted_out" };
  }

  // ── Cap re-check at send time (Req 5.2, 7.2) ──────────────────────────────
  // Re-read per item so a send earlier in a bulk loop that consumed budget
  // correctly causes this later item to be skipped `cap_reached`.
  if (await capExhausted(db, { scopeKind: "rep", scopeId: userId, periodBucket })) {
    return { kind: "skipped", reason: "cap_reached" };
  }
  if (
    item.clusterId &&
    (await capExhausted(db, {
      scopeKind: "cluster",
      scopeId: item.clusterId,
      periodBucket,
    }))
  ) {
    return { kind: "skipped", reason: "cap_reached" };
  }

  // ── Approve under the REP's identity (Req 8 / CC-HITL) ────────────────────
  const approveResult = await dispatchTool(
    db,
    "approve_outreach",
    { draftId },
    { actor: userId, userId }
  );
  if (!approveResult.ok) {
    // Dispatch was refused (RBAC / validation / OTP) — never approved → skip.
    return { kind: "skipped", reason: approveResult.error.code };
  }
  const approval = approveResult.result as {
    token?: string;
    status?: string;
    reason?: string;
  };
  if (!approval.token) {
    // No token issued — the draft is already sent or suppressed; not approved.
    return {
      kind: "skipped",
      reason: approval.reason ?? "not_approved",
      status: approval.status,
    };
  }

  // ── Send under the REP's identity on the single-use token ─────────────────
  // `send_outreach` performs the channel send AND enqueues the Salesforce side
  // effect to `sf_outbox` under the draft's `job_key` (at-most-once).
  const sendResult = await dispatchTool(
    db,
    "send_outreach",
    { draftId, token: approval.token },
    { actor: userId, userId }
  );
  if (!sendResult.ok) {
    // Approved (token issued) but the send dispatch errored — approved, unsent.
    return { kind: "approved_unsent", reason: sendResult.error.code };
  }
  const send = sendResult.result as {
    sent: boolean;
    status: string;
    reason?: string;
    messageId?: string;
  };
  if (!send.sent || send.status !== "sent") {
    // Approved but the send was refused / suppressed (e.g. a tool-caught
    // opt-out) — approved, NOT sent; no counter increment, status left as-is.
    return {
      kind: "approved_unsent",
      reason: send.reason ?? "not_sent",
      status: send.status,
    };
  }

  // ── Exactly-once counter increment after a CONFIRMED send (Req 7.5, 7.6) ──
  // For an ICP-subject run with no cluster only the rep scope is meaningful.
  if (item.clusterId) {
    await recordSend(db, {
      draftId,
      repId: userId,
      clusterId: item.clusterId,
      periodBucket,
    });
  } else {
    await incrementScope(db, "rep", userId, periodBucket, draftId);
  }

  // Single status field → `sent` (Req 4.5 — never two states at once).
  await db
    .update(prospectingQueueItems)
    .set({ status: "sent", updatedAt: new Date() })
    .where(eq(prospectingQueueItems.id, item.id));

  await publishEvent(db, {
    type: EV_QUEUE_ITEM_SENT,
    payload: { queueItemId: item.id, draftId },
  });

  return { kind: "sent", messageId: send.messageId ?? null };
}

// ── Target list projection (privacy-safe — phone hash only, never raw) ────────
async function selectTargets(where?: ReturnType<typeof eq>) {
  const base = db
    .select({
      id: targets.id,
      briefId: targets.briefId,
      targetType: targets.targetType,
      displayName: targets.displayName,
      companyName: targets.companyName,
      title: targets.title,
      email: targets.email,
      // phoneHash only — the transient raw_phone is NEVER projected (CC-Privacy).
      phoneHash: targets.phoneHash,
      country: targets.country,
      attributes: targets.attributes,
      sourceProvider: targets.sourceProvider,
      status: targets.status,
      partyId: targets.partyId,
      createdAt: targets.createdAt,
      updatedAt: targets.updatedAt,
    })
    .from(targets);
  return (where ? base.where(where) : base).orderBy(desc(targets.createdAt));
}
