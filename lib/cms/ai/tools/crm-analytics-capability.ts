// lib/cms/ai/tools/crm-analytics-capability.ts
//
// The `get_crm_analytics` Catalog_Entry — the audited boundary the Home_Agent
// (C-level twin) binds to brainstorm on LIVE Salesforce data: compare leads and
// opportunities across periods (week / month / quarter) and inspect the open
// pipeline by stage. Figures are computed by Salesforce aggregate SOQL; the
// agent only narrates them.
//
// Like every capability module this invents no new dispatcher/RBAC/OTP/audit
// path: the entry flows through the unchanged `dispatchTool`. It is spliced into
// the home catalog so the dispatcher resolves it, and its
// `home:tool:get_crm_analytics` permission is carried in the Home_Agent's static
// grant. The aggregates return only counts/sums (no personal contact data), so
// the tool is not OTP-gated.
//
// GRACEFUL DEGRADATION. The handler builds the live Salesforce client from env
// lazily. When credentials are absent or Salesforce errors, it returns
// `{ available: false, reason }` rather than throwing, so the agent can say
// "CRM analytics aren't available right now" and keep the conversation open.

import { z } from "zod";

import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";
import {
  getCrmBrainstormSnapshot,
  SalesforceAnalyticsClient,
  CRM_PERIODS,
  type AggregateRunner,
} from "../../tickets/crm/salesforce-analytics";
import { SalesforceAdapter } from "../../tickets/crm/salesforce";

// ── Identity & permission (reuses the home identity) ──────────────────────────

export const CRM_ANALYTICS_TOOL_NAME = "get_crm_analytics";

/** The audit actor recorded for a CRM-analytics dispatch. */
export const CRM_ANALYTICS_AGENT_ACTOR = "agent:home-twin";

/** The tool name(s) this module contributes to the home catalog. */
export const CRM_ANALYTICS_TOOL_NAMES = [CRM_ANALYTICS_TOOL_NAME] as const;

// ── Live client wiring (memoized; graceful when creds are absent) ─────────────

let cachedRunner: AggregateRunner | null = null;

/**
 * Build (and memoize) the live Salesforce analytics runner from env. Returns
 * `null` when the required credentials are absent, so the handler can degrade
 * gracefully instead of throwing.
 */
function resolveRunner(): AggregateRunner | null {
  if (cachedRunner) return cachedRunner;
  const clientId = process.env.SF_CLIENT_ID?.trim();
  const clientSecret = process.env.SF_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const adapter = new SalesforceAdapter({
    clientId,
    clientSecret,
    loginUrl: process.env.SF_LOGIN_URL?.trim(),
  });
  cachedRunner = new SalesforceAnalyticsClient(adapter);
  return cachedRunner;
}

/** Test seam: inject a fake runner (and reset with `null`). */
export function __setCrmAnalyticsRunner(runner: AggregateRunner | null): void {
  cachedRunner = runner;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

// LLMs frequently emit booleans as the strings "true"/"false" (or "1"/"0")
// rather than real JSON booleans. A strict `z.boolean()` then fails validation,
// the agent is told to "fix and retry", and each retry is another slow model
// round-trip (the cause of the multi-second CRM-analytics turns). Accept the
// stringified forms and normalise them to a real boolean so the first call
// validates.
const lenientBoolean = z.preprocess((v) => {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return v;
}, z.boolean());

const getCrmAnalyticsInput = z.object({
  /** Comparison granularity: current vs previous week / month / quarter. */
  granularity: z.enum(["week", "month", "quarter"]).default("quarter"),
  /** Include the open-pipeline-by-stage breakdown. */
  includePipeline: lenientBoolean.default(true),
});

const comparisonSchema = z.object({
  metric: z.string(),
  object: z.string(),
  current: z.object({
    period: z.enum(CRM_PERIODS),
    label: z.string(),
    count: z.number(),
    amount: z.number().optional(),
  }),
  previous: z.object({
    period: z.enum(CRM_PERIODS),
    label: z.string(),
    count: z.number(),
    amount: z.number().optional(),
  }),
  deltaPct: z.number().nullable(),
});

const getCrmAnalyticsOutput = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  granularity: z.enum(["week", "month", "quarter"]).optional(),
  comparisons: z.array(comparisonSchema).optional(),
  pipelineByStage: z
    .array(z.object({ stage: z.string(), count: z.number(), amount: z.number() }))
    .optional(),
  openPipelineAmount: z.number().optional(),
});

function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

/**
 * `get_crm_analytics` — live Salesforce brainstorm figures (period comparisons +
 * open pipeline). Read-only aggregates; the agent narrates the numbers. Degrades
 * to `{ available: false }` when the CRM is not configured/reachable.
 */
export const crmAnalyticsEntry: CatalogEntry = entry({
  name: CRM_ANALYTICS_TOOL_NAME,
  description:
    "Brainstorm on LIVE Salesforce CRM data: compare leads and opportunities " +
    "created this period vs the previous one (week/month/quarter), see won " +
    "opportunities and amounts, and the open pipeline by stage. Figures are " +
    "computed by Salesforce; narrate them, never invent numbers. If it returns " +
    "available=false, tell the user CRM analytics are unavailable right now.",
  inputSchema: getCrmAnalyticsInput,
  outputSchema: getCrmAnalyticsOutput,
  requiresOtp: false,
  permission: `home:tool:${CRM_ANALYTICS_TOOL_NAME}`,
  auditActor: CRM_ANALYTICS_AGENT_ACTOR,
  handler: async (_db, _ctx, input) => {
    const runner = resolveRunner();
    if (!runner) {
      return {
        available: false,
        reason:
          "Salesforce credentials are not configured (SF_CLIENT_ID / SF_CLIENT_SECRET).",
      };
    }
    try {
      const snapshot = await getCrmBrainstormSnapshot(runner, {
        granularity: input.granularity,
        includePipeline: input.includePipeline,
      });
      return { available: true, ...snapshot };
    } catch (err) {
      return {
        available: false,
        reason: `Salesforce analytics query failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  },
});

/** The CRM-analytics Catalog_Entries this module contributes. */
export const crmAnalyticsCapabilityEntries: CatalogEntry[] = [crmAnalyticsEntry];

/** Validate and assemble just the CRM-analytics capabilities (self-check). */
export function loadCrmAnalyticsCapabilities(): CatalogLoadResult {
  return loadCatalog(crmAnalyticsCapabilityEntries);
}
