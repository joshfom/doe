// lib/cms/ai/tools/executive-capabilities.ts
//
// The executive (C-Level) data tools — audited `CatalogEntry`s the Home/twin
// agent invokes through the UNCHANGED `dispatchTool` (Zod → RBAC → OTP → audit →
// execute). They answer the leadership asks: all leads (incl. Lead Engine),
// leads grouped by owning user, a specific user's pipeline, a comparison of two
// users' pipelines, and the total user count.
//
// THE GATE (the single load-bearing invariant). Each entry's `permission` is
// `home:tool:<name>`, matched only by the `home:*` wildcard (held by `c_level`)
// and `*:*` (held by `super_admin`). These permissions are DELIBERATELY EXCLUDED
// from the Home agent's static grant (`AGENT_HOME_PERMISSIONS`), so a delegated
// dispatch can only be authorized through the REQUESTING USER's RBAC — never the
// agent's. A non-C-Level caller is denied at the dispatcher (and that denial is
// audited). See home-capabilities.ts for the assembly + the exclusion.
//
// FIGURES ARE GROUNDED, NEVER INVENTED. Every count/sum/group-by is computed in
// SQL over the canonical lead source (`leads_mirror`, demo rows excluded — the
// same source as the `metrics_leads` view) and the `users`/`reps` tables. The
// comparison diffs are deterministic arithmetic (`a − b`) over the fetched SQL
// figures, never model-derived. Handlers only shape the result object.
//
// Design references: §Components #4 (executive data tools), §Data Models,
// Property 12 (grounding), Property 14 (gate), Property 15 (disambiguation),
// Property 18 (catalog assembly).

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";

import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";
import { leadsMirror, reps, users } from "../../schema";
import type { Database } from "../../db";

// ── Identity & tool names ─────────────────────────────────────────────────────

/** The audit/catalog actor the executive tools are bound under (the home twin). */
export const EXECUTIVE_AGENT_ACTOR = "agent:home-twin";

export const GET_ALL_LEADS_TOOL = "get_all_leads";
export const GET_LEADS_BY_USER_TOOL = "get_leads_by_user";
export const GET_USER_PIPELINE_TOOL = "get_user_pipeline";
export const COMPARE_USER_PIPELINES_TOOL = "compare_user_pipelines";
export const GET_USER_COUNT_TOOL = "get_user_count";

/** The tool names this module contributes to the home catalog. */
export const EXECUTIVE_TOOL_NAMES = [
  GET_ALL_LEADS_TOOL,
  GET_LEADS_BY_USER_TOOL,
  GET_USER_PIPELINE_TOOL,
  COMPARE_USER_PIPELINES_TOOL,
  GET_USER_COUNT_TOOL,
] as const;

/** The RBAC permission an executive tool requires (`home:tool:<name>`). */
export function executiveToolPermission(name: string): string {
  return `home:tool:${name}`;
}

// ── Zod schemas (per design §Data Models) ─────────────────────────────────────

const countRow = z.object({ count: z.number() });

const getAllLeadsInput = z.object({}).strict();
const getAllLeadsOutput = z.object({
  totalLeads: z.number(),
  byTier: z.array(z.object({ tier: z.string(), count: z.number() })).optional(),
  bySource: z
    .array(z.object({ source: z.string(), count: z.number() }))
    .optional(),
});

const getLeadsByUserInput = z.object({}).strict();
const getLeadsByUserOutput = z.object({
  users: z.array(
    z.object({ repId: z.string(), name: z.string(), leadCount: z.number() }),
  ),
});

const getUserPipelineInput = z.object({ userName: z.string().min(1) });
const pipelineFigures = z.object({
  totalLeads: z.number(),
  byTier: z.array(z.object({ tier: z.string(), count: z.number() })),
  byStage: z.array(z.object({ stage: z.string(), count: z.number() })),
  salesforce: z
    .object({ available: z.boolean(), reason: z.string().optional() })
    .optional(),
});
const candidate = z.object({ repId: z.string(), name: z.string() });
const getUserPipelineOutput = z.discriminatedUnion("matched", [
  z.object({
    matched: z.literal(true),
    repId: z.string(),
    name: z.string(),
    pipeline: pipelineFigures,
  }),
  z.object({
    matched: z.literal(false),
    reason: z.string(),
    candidates: z.array(candidate).optional(),
  }),
]);

const compareInput = z.object({
  userNameA: z.string().min(1),
  userNameB: z.string().min(1),
});
const matchedPipeline = z.object({
  repId: z.string(),
  name: z.string(),
  pipeline: pipelineFigures,
});
const compareOutput = z.discriminatedUnion("matched", [
  z.object({
    matched: z.literal(true),
    a: matchedPipeline,
    b: matchedPipeline,
    diffs: z.object({ totalLeads: z.number() }),
  }),
  z.object({
    matched: z.literal(false),
    reason: z.string(),
    candidates: z.array(candidate).optional(),
  }),
]);

const getUserCountInput = z.object({}).strict();
const getUserCountOutput = z.object({ userCount: z.number() });

void countRow; // (kept for symmetry with the SQL row shapes below)

// ── Rep name resolver (disambiguation — Req 8.4, 9.4; Property 15) ─────────────

export type RepMatch =
  | { kind: "unique"; repId: string; name: string }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: Array<{ repId: string; name: string }> };

/**
 * Resolve a human rep name to a single rep, NEVER guessing. Case-insensitive:
 * an exact name match is preferred; failing that, a `contains` match. Exactly
 * one row → `unique`; zero → `none`; two or more → `ambiguous` (candidate names
 * returned so the agent can ask the user to clarify).
 */
export async function resolveRepByName(
  db: Database,
  name: string,
): Promise<RepMatch> {
  const needle = name.trim().toLowerCase();
  if (!needle) return { kind: "none" };

  const exact = await db
    .select({ repId: reps.id, name: reps.name })
    .from(reps)
    .where(and(eq(reps.demo, false), sql`lower(${reps.name}) = ${needle}`));
  if (exact.length === 1) {
    return { kind: "unique", repId: exact[0].repId, name: exact[0].name };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", candidates: exact };
  }

  const contains = await db
    .select({ repId: reps.id, name: reps.name })
    .from(reps)
    .where(
      and(eq(reps.demo, false), sql`lower(${reps.name}) like ${`%${needle}%`}`),
    );
  if (contains.length === 1) {
    return { kind: "unique", repId: contains[0].repId, name: contains[0].name };
  }
  if (contains.length === 0) return { kind: "none" };
  return { kind: "ambiguous", candidates: contains };
}

// ── Shared pipeline aggregate (figures in SQL only) ───────────────────────────

type PipelineFigures = z.infer<typeof pipelineFigures>;

/** Aggregate a single rep's pipeline from `leads_mirror` (demo excluded). */
async function repPipeline(
  db: Database,
  repId: string,
): Promise<PipelineFigures> {
  const where = and(
    eq(leadsMirror.assignedRepId, repId),
    eq(leadsMirror.demo, false),
  );

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leadsMirror)
    .where(where);
  const totalLeads = totalRows[0]?.count ?? 0;

  const tierRows = await db
    .select({
      tier: sql<string>`coalesce(${leadsMirror.tier}, 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(leadsMirror)
    .where(where)
    .groupBy(sql`coalesce(${leadsMirror.tier}, 'unknown')`);

  const stageRows = await db
    .select({
      stage: sql<string>`coalesce(${leadsMirror.stage}, 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(leadsMirror)
    .where(where)
    .groupBy(sql`coalesce(${leadsMirror.stage}, 'unknown')`);

  return {
    totalLeads,
    byTier: tierRows.map((r) => ({ tier: r.tier, count: r.count })),
    byStage: stageRows.map((r) => ({ stage: r.stage, count: r.count })),
  };
}

function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

// ── get_all_leads ─────────────────────────────────────────────────────────────

export const getAllLeadsEntry: CatalogEntry = entry({
  name: GET_ALL_LEADS_TOOL,
  description:
    "Total leads across EVERY source (including Lead Engine inbound leads), " +
    "computed in SQL over the canonical lead mirror. Returns the overall total " +
    "plus optional breakdowns by tier and by source. Narrate the figures; " +
    "never invent a number.",
  inputSchema: getAllLeadsInput,
  outputSchema: getAllLeadsOutput,
  requiresOtp: false,
  permission: executiveToolPermission(GET_ALL_LEADS_TOOL),
  auditActor: EXECUTIVE_AGENT_ACTOR,
  handler: async (db, _ctx, _input) => {
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadsMirror)
      .where(eq(leadsMirror.demo, false));
    const totalLeads = totalRows[0]?.count ?? 0;

    const tierRows = await db
      .select({
        tier: sql<string>`coalesce(${leadsMirror.tier}, 'unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(leadsMirror)
      .where(eq(leadsMirror.demo, false))
      .groupBy(sql`coalesce(${leadsMirror.tier}, 'unknown')`);

    const sourceRows = await db
      .select({
        source: sql<string>`coalesce(${leadsMirror.source}, 'unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(leadsMirror)
      .where(eq(leadsMirror.demo, false))
      .groupBy(sql`coalesce(${leadsMirror.source}, 'unknown')`);

    return {
      totalLeads,
      byTier: tierRows.map((r) => ({ tier: r.tier, count: r.count })),
      bySource: sourceRows.map((r) => ({ source: r.source, count: r.count })),
    };
  },
});

// ── get_user_count ────────────────────────────────────────────────────────────

export const getUserCountEntry: CatalogEntry = entry({
  name: GET_USER_COUNT_TOOL,
  description:
    "How many platform users (the size of the team / RBAC principals) exist, " +
    "computed in SQL as a count over the users table. This counts PLATFORM " +
    "USERS — distinct from sales reps who own leads. Narrate the figure.",
  inputSchema: getUserCountInput,
  outputSchema: getUserCountOutput,
  requiresOtp: false,
  permission: executiveToolPermission(GET_USER_COUNT_TOOL),
  auditActor: EXECUTIVE_AGENT_ACTOR,
  handler: async (db, _ctx, _input) => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    return { userCount: rows[0]?.count ?? 0 };
  },
});

// ── get_leads_by_user ─────────────────────────────────────────────────────────

export const getLeadsByUserEntry: CatalogEntry = entry({
  name: GET_LEADS_BY_USER_TOOL,
  description:
    "Leads grouped by their owning rep, computed in SQL. Returns every rep " +
    "with their lead count, INCLUDING reps that own zero leads. Here a 'user' " +
    "is the owning sales rep. Narrate the per-user counts; never invent one.",
  inputSchema: getLeadsByUserInput,
  outputSchema: getLeadsByUserOutput,
  requiresOtp: false,
  permission: executiveToolPermission(GET_LEADS_BY_USER_TOOL),
  auditActor: EXECUTIVE_AGENT_ACTOR,
  handler: async (db, _ctx, _input) => {
    // LEFT JOIN reps → leads_mirror so zero-count reps are preserved; the
    // demo-exclusion lives in the JOIN condition (not WHERE) to keep them.
    const rows = await db
      .select({
        repId: reps.id,
        name: reps.name,
        leadCount: sql<number>`count(${leadsMirror.partyId})::int`,
      })
      .from(reps)
      .leftJoin(
        leadsMirror,
        and(
          eq(leadsMirror.assignedRepId, reps.id),
          eq(leadsMirror.demo, false),
        ),
      )
      .where(eq(reps.demo, false))
      .groupBy(reps.id, reps.name);

    return {
      users: rows.map((r) => ({
        repId: r.repId,
        name: r.name,
        leadCount: r.leadCount,
      })),
    };
  },
});

// ── get_user_pipeline ─────────────────────────────────────────────────────────

export const getUserPipelineEntry: CatalogEntry = entry({
  name: GET_USER_PIPELINE_TOOL,
  description:
    "A specific rep's pipeline by tier and stage, computed in SQL. Pass the " +
    "rep's name as userName. If the name matches no rep or more than one, the " +
    "tool returns matched=false with the candidate names — ask the user to " +
    "clarify rather than guessing. Narrate the returned figures only.",
  inputSchema: getUserPipelineInput,
  outputSchema: getUserPipelineOutput,
  requiresOtp: true,
  permission: executiveToolPermission(GET_USER_PIPELINE_TOOL),
  auditActor: EXECUTIVE_AGENT_ACTOR,
  handler: async (db, _ctx, input) => {
    const match = await resolveRepByName(db, input.userName);
    if (match.kind === "none") {
      return {
        matched: false as const,
        reason: `No rep matches "${input.userName}".`,
      };
    }
    if (match.kind === "ambiguous") {
      return {
        matched: false as const,
        reason: `More than one rep matches "${input.userName}". Ask which one.`,
        candidates: match.candidates,
      };
    }
    const pipeline = await repPipeline(db, match.repId);
    return {
      matched: true as const,
      repId: match.repId,
      name: match.name,
      pipeline,
    };
  },
});

// ── compare_user_pipelines ────────────────────────────────────────────────────

export const compareUserPipelinesEntry: CatalogEntry = entry({
  name: COMPARE_USER_PIPELINES_TOOL,
  description:
    "Compare two reps' pipelines side by side, computed in SQL. Pass both rep " +
    "names (userNameA, userNameB). The difference (a − b) in total leads is " +
    "computed deterministically from the fetched figures. If either name is " +
    "unresolved or ambiguous, returns matched=false with candidates — ask the " +
    "user to clarify. Narrate the figures only.",
  inputSchema: compareInput,
  outputSchema: compareOutput,
  requiresOtp: true,
  permission: executiveToolPermission(COMPARE_USER_PIPELINES_TOOL),
  auditActor: EXECUTIVE_AGENT_ACTOR,
  handler: async (db, _ctx, input) => {
    const [matchA, matchB] = await Promise.all([
      resolveRepByName(db, input.userNameA),
      resolveRepByName(db, input.userNameB),
    ]);

    const unresolved = (
      label: string,
      query: string,
      m: RepMatch,
    ): { reason: string; candidates?: Array<{ repId: string; name: string }> } | null => {
      if (m.kind === "none") {
        return { reason: `No rep matches "${query}" (${label}).` };
      }
      if (m.kind === "ambiguous") {
        return {
          reason: `More than one rep matches "${query}" (${label}). Ask which one.`,
          candidates: m.candidates,
        };
      }
      return null;
    };

    const problemA = unresolved("A", input.userNameA, matchA);
    const problemB = unresolved("B", input.userNameB, matchB);
    if (problemA || problemB) {
      const problem = problemA ?? problemB!;
      return {
        matched: false as const,
        reason: problem.reason,
        candidates: problem.candidates,
      };
    }

    // Both unique here.
    const repA = matchA as Extract<RepMatch, { kind: "unique" }>;
    const repB = matchB as Extract<RepMatch, { kind: "unique" }>;
    const [pipelineA, pipelineB] = await Promise.all([
      repPipeline(db, repA.repId),
      repPipeline(db, repB.repId),
    ]);

    return {
      matched: true as const,
      a: { repId: repA.repId, name: repA.name, pipeline: pipelineA },
      b: { repId: repB.repId, name: repB.name, pipeline: pipelineB },
      // Deterministic arithmetic over the fetched SQL figures (never model-derived).
      diffs: { totalLeads: pipelineA.totalLeads - pipelineB.totalLeads },
    };
  },
});

// ── Catalog contributor set ───────────────────────────────────────────────────

/** The executive Catalog_Entries this module contributes to the home catalog. */
export const executiveCapabilityEntries: CatalogEntry[] = [
  getAllLeadsEntry,
  getLeadsByUserEntry,
  getUserPipelineEntry,
  compareUserPipelinesEntry,
  getUserCountEntry,
];

/** Validate and assemble just the executive capabilities (self-check). */
export function loadExecutiveCapabilities(): CatalogLoadResult {
  return loadCatalog(executiveCapabilityEntries);
}
