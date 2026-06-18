import type { Database } from "@/lib/cms/db";
import { dispatchTool } from "@/lib/cms/ai/tools/dispatch";
import { HOME_AGENT_ACTOR } from "@/lib/cms/ai/tools/home-capabilities";
import {
  assembleBriefing,
  type BriefingInput,
  type BriefingResult,
} from "@/lib/cms/agents/workflows/briefing-workflow";
import type { StackDispatch } from "@/lib/cms/agents/home/stack";
import {
  writeBriefingCache,
  type CacheKey,
} from "@/lib/cms/agents/home/briefing-cache";
import { briefingJobKey } from "@/lib/cms/agents/home/jobkey";
import type { Briefing, BriefingWindow } from "@/lib/cms/agents/home/types";
import type { JobContext, JobHandler } from "./index";

// ── briefing_assembly (Agent-First Home S5) — Design §Components #3, #4, §Arch ─
//
// A scheduled PRE-WARM of one user's Briefing. The Briefing_Workflow's
// `assembleBriefing` is expensive (a multi-step, dispatched assembly); running
// it ahead of the user's next Home_Surface load and caching the result keeps
// repeat home loads fast and off the multi-step agent loop (CC-Cost / Req 5.1).
//
// THE ONE RULE, preserved (Req 2.2, 7, 14): this handler reads NO `metrics_*` /
// `leads_mirror` / Stack data itself. It composes the already-built
// Briefing_Workflow over the AUDITED dispatcher — every Stack read and every
// figure read flows through `dispatchTool` (Zod → RBAC → OTP → audit → execute)
// under the home identity `agent:home-twin`. The only table this handler writes
// is the dedicated `briefing_cache` (via `writeBriefingCache`), whose body
// carries no personal data beyond the user-id key and the already-redacted
// Briefing (CC-Privacy / Req 2.7, 9.4).
//
// DISPATCH CONSTRUCTION (reuse, don't reinvent — Design §"Dispatcher binding").
// The `BriefingDeps.dispatch` is the SAME `callTool`-over-`dispatchTool` seam
// every co-located agent/workflow uses, just bound to the job's `db` handle and
// the home RBAC identity. We bind `dispatchTool` IN-PROCESS (the job runs on the
// container/worker tier alongside the `db` handle), so the assembly inherits the
// identical audited guarantees as the on-demand `GET /home/briefing` path. No
// new dispatcher, RBAC, OTP, or audit logic is introduced here.
//
// IDEMPOTENCY (Req 5.1, 10.2). Enqueue idempotency is the spine's
// `ON CONFLICT (job_key) DO NOTHING` keyed by `briefingJobKey(userId, window,
// periodDate)` — at most one job row per user/window/day. The HANDLER is safe to
// re-run because `writeBriefingCache` upserts by the `(user_id, window,
// period_date)` primary key: a re-run merely refreshes the single cached row
// (and its TTL), never duplicating or partially writing it.
//
// FAILURE (Req 3.6, 3.7). On `assembleBriefing` `{ ok: false }`
// (`window_unresolved` / `assembly_failed`) the handler writes NO cache entry —
// it must never pre-warm a partial or fabricated Briefing — and THROWS so the
// job spine records the job `failed` (re-runnable) and publishes `job.failed`,
// exactly as the sibling `compile_and_email_report` / `lead_nudge` handlers
// signal a genuine failure. Only an `{ ok: true }` assembly pre-warms the cache.
//
// [container-only] (Req 3.5, 15.5). Registered + run on the worker tier; the job
// runs there anyway, and `assembleBriefing` additionally calls
// `assertBriefingContainerTier`, refusing a serverless invocation.
//
// Design references: §Components #3 (Briefing_Workflow), #4 (Briefing_Cache),
// §Architecture (scheduled pre-warm). Requirements: 3.5, 5.1, 10.2.

/** The payload carried on a `briefing_assembly` job — the {@link BriefingInput} shape. */
export interface BriefingAssemblyPayload {
  /** The user the Briefing is assembled and cached for. */
  userId: string;
  /** The Briefing_Window to pre-warm (`morning` | `midday` | `evening`). */
  window: BriefingWindow;
  /** The local calendar day the Briefing covers, `YYYY-MM-DD`. */
  periodDate: string;
  /** The requesting user's RBAC roles, forwarded to the read context. */
  roles?: string[];
  /** Optional cache TTL override in minutes (clamped 1–60 by the cache writer). */
  ttlMinutes?: number;
}

const VALID_WINDOWS: ReadonlySet<string> = new Set<BriefingWindow>([
  "morning",
  "midday",
  "evening",
]);

/**
 * Parse + validate the job payload into a {@link BriefingInput} plus an optional
 * TTL. A malformed payload throws (the spine records the job failed); the
 * scheduler that enqueues the job supplies a well-formed payload.
 */
function parsePayload(payload: unknown): {
  input: BriefingInput;
  ttlMinutes?: number;
} {
  const p = (payload ?? {}) as Record<string, unknown>;

  const userId = typeof p.userId === "string" ? p.userId.trim() : "";
  if (!userId) {
    throw new Error("briefing_assembly: payload.userId is required");
  }

  const window = typeof p.window === "string" ? p.window : "";
  if (!VALID_WINDOWS.has(window)) {
    throw new Error(
      `briefing_assembly: payload.window must be morning|midday|evening (got "${window}")`
    );
  }

  const periodDate = typeof p.periodDate === "string" ? p.periodDate.trim() : "";
  if (!periodDate) {
    throw new Error("briefing_assembly: payload.periodDate is required");
  }

  const roles = Array.isArray(p.roles)
    ? p.roles.filter((r): r is string => typeof r === "string")
    : [];

  const ttlMinutes =
    typeof p.ttlMinutes === "number" && Number.isFinite(p.ttlMinutes)
      ? p.ttlMinutes
      : undefined;

  return {
    input: { userId, window: window as BriefingWindow, periodDate, roles },
    ttlMinutes,
  };
}

/**
 * Build the audited dispatcher the Briefing assembly reads through, bound to the
 * job's `db` handle and the home RBAC identity. This is the in-process
 * `callTool`-over-`dispatchTool` seam (reused, not reinvented): every dispatched
 * Stack/figure read still runs Zod → RBAC → OTP → audit → execute. Resolves to
 * the same {@link import("@/lib/cms/ai/tools/dispatch").DispatchResult} union and
 * never throws.
 */
function homeDispatch(db: Database): StackDispatch {
  return (toolName, input) =>
    dispatchTool(db, toolName, input, { actor: HOME_AGENT_ACTOR });
}

/** Injectable dependencies for the handler (all defaulted to live impls). */
export interface BriefingAssemblyDeps {
  /** Build the audited dispatcher bound to the job's `db` + home identity. */
  makeDispatch?: (db: Database) => StackDispatch;
  /** The Briefing assembler (defaults to {@link assembleBriefing}). */
  assemble?: (input: BriefingInput) => Promise<BriefingResult>;
  /** The cache pre-warm writer (defaults to {@link writeBriefingCache}). */
  writeCache?: (
    db: Database,
    key: CacheKey,
    briefing: Briefing,
    ttlMinutes?: number
  ) => Promise<void>;
  /** Clock injection point, forwarded into the assembly. */
  now?: () => Date;
}

/**
 * Build a `briefing_assembly` {@link JobHandler}, injecting the dispatcher
 * factory, assembler, and cache writer (all default to the live
 * implementations). Tests inject fakes to drive the full pre-warm + idempotency
 * flow over `pg-mem` with no real catalog dispatch.
 */
export function createBriefingAssemblyHandler(
  deps: BriefingAssemblyDeps = {}
): JobHandler {
  const makeDispatch = deps.makeDispatch ?? homeDispatch;
  const writeCache = (deps.writeCache ?? writeBriefingCache) as typeof writeBriefingCache;
  const now = deps.now;

  return async (db: Database, payload: unknown, _ctx: JobContext) => {
    const { input, ttlMinutes } = parsePayload(payload);

    // Run the Briefing_Workflow over the audited, in-process dispatcher (Stack +
    // figures both flow through `dispatchTool`). The default assembler is
    // `assembleBriefing` bound to the job's db-backed dispatch; a test may inject
    // its own assembler. `assembleBriefing` self-guards the container tier.
    const assemble =
      deps.assemble ??
      ((i: BriefingInput) =>
        assembleBriefing(i, { dispatch: makeDispatch(db), now }));

    const result = await assemble(input);

    // FAILURE (Req 3.6, 3.7): never pre-warm a partial/absent Briefing. Throw so
    // the spine records the job failed (re-runnable) and publishes `job.failed`.
    if (!result.ok) {
      throw new Error(
        `briefing_assembly: assembly failed for ` +
          `${input.userId}/${input.window}/${input.periodDate} (reason=${result.reason})`
      );
    }

    // PRE-WARM (Req 5.1): upsert the assembled, already-redacted Briefing into
    // `briefing_cache` keyed by the same (userId, window, periodDate) triple the
    // enqueue is idempotent on. A re-run refreshes the single row (idempotent).
    const key: CacheKey = {
      userId: input.userId,
      window: input.window,
      periodDate: input.periodDate,
    };
    await writeCache(db, key, result.briefing, ttlMinutes);
  };
}

/** Default handler instance wired to the live audited dispatch + cache writer. */
export const briefingAssemblyHandler: JobHandler = createBriefingAssemblyHandler();

/**
 * Re-export the idempotency key derivation so the scheduler enqueuing a
 * `briefing_assembly` job keys it consistently with the cache PK (Req 10.2).
 */
export { briefingJobKey };
