import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { jobs } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";

// ── Durable job runner spine (Design §7.8, Error Handling) ────────────────────
// Replaces Trigger.dev for the demo. This module is the SPINE only:
//   • `enqueueJob` — idempotent insert by unique `jobKey` (ON CONFLICT DO NOTHING)
//   • `runJob`     — state machine received → executing → done | failed, with
//                    at-most-once external side effects and idempotent re-run
//   • a handler-registry dispatch keyed by `JobKind`
//
// The heavy handlers (post_call_processing, compile_and_email_report,
// morning_briefing, send_whatsapp_brief) are implemented in task group 16; here
// they are placeholders that throw "not implemented". Task 16 fills them in via
// `registerJobHandler` (or by passing an explicit registry to `runJob`).
//
// CONTAINER-ONLY: the polling worker (`workers/job-runner.ts`) and these heavy
// jobs run on the Bun/worker tier, never on Vercel serverless (Req 12.6).

/**
 * The job kinds the runner supports (Req 9.1).
 *
 * `lead_nudge` (Lead Engine S3, Req 10.3/11.2): a single proactive owner
 * notification for one stale Lead occasion. The Nudge sweep workflow enqueues
 * one `lead_nudge` job per stale lead keyed by `nudgeJobKey` (lead × type ×
 * window bucket), and this handler performs the notification + any Salesforce
 * side effect. The job spine's at-most-once claim is what bounds the external
 * nudge to one per `jobKey` (Property 8).
 *
 * `briefing_assembly` (Agent-First Home S5, Design §Components #3/#4, Req 3.5,
 * 5.1, 10.2): a scheduled pre-warm of one user's Briefing for a single
 * `(userId, window, periodDate)`. Added additively, mirroring how S3 added
 * `lead_nudge`. The handler (`./briefing-assembly.ts`) runs `assembleBriefing`
 * on the worker tier and pre-warms the `briefing_cache`; it is idempotent by
 * `briefingJobKey` (the spine's `ON CONFLICT (job_key)` bounds enqueue, and
 * `writeBriefingCache` upserts by PK so a re-run merely refreshes the entry).
 *
 * `outreach_send` / `enrichment_fetch` / `market_sync` (Prospecting Workspace
 * S7, Design §Architecture "job extensions", Req 7.2, 8.2, 11.2): the three
 * container-tier prospecting jobs, added additively (mirroring S3/S5). Each runs
 * on the worker tier behind a handler registered via `registerJobHandler`
 * (`./outreach-send.ts`, `./enrichment-fetch.ts`, `./market-sync.ts`):
 *   • `outreach_send`   — send one approved OutreachDraft via the ChannelAdapter
 *     and enqueue its CRM outbox side effect. IDEMPOTENT BY THE DRAFT `jobKey`
 *     (`outreach_send:{draftId}`): the spine's at-most-once claim bounds the
 *     external send to one, and the outbox `ON CONFLICT (job_key)` bounds the
 *     side effect to one, no matter how many times the job is retried (Req 7.2,
 *     8.2 / CC-Idem).
 *   • `enrichment_fetch` — fan a Target's enrichment out across the configured
 *     providers and persist the provenanced attributes. Idempotent by the
 *     enrichment `jobKey` so a retry yields at most one provider charge (Req 8.2).
 *   • `market_sync`     — pull one incremental MarketBatch from the configured
 *     MarketDataAdapter and ingest it idempotently into the `market_*` mirror
 *     (Req 11.2). The long-lived polling loop is the worker (task 8.3); this
 *     handler performs a single fetch→ingest→emit cycle.
 *
 * `prospecting_batch` (Agentic Prospecting Batch S?, Req 2.1): the autonomous
 * Batch_Run driver, added additively (mirroring S3/S5/S7). The handler runs one
 * Batch_Run on the worker tier — discovering candidates, running the CRM_Check,
 * scoring fit, and drafting grounded outreach for the cold-eligible ones through
 * the Tool_Dispatcher — and is idempotent by the Batch_Run's deterministic
 * re-run key (Req 9.1/9.2): the spine's `ON CONFLICT (job_key)` bounds enqueue
 * and the per-candidate idempotency keys bound the side effects on a re-run.
 */
export type JobKind =
  | "post_call_processing"
  | "compile_and_email_report"
  | "morning_briefing"
  | "send_whatsapp_brief"
  | "lead_nudge"
  | "briefing_assembly"
  | "outreach_send"
  | "enrichment_fetch"
  | "market_sync"
  | "prospecting_batch";

const JOB_KINDS: readonly JobKind[] = [
  "post_call_processing",
  "compile_and_email_report",
  "morning_briefing",
  "send_whatsapp_brief",
  "lead_nudge",
  "briefing_assembly",
  "outreach_send",
  "enrichment_fetch",
  "market_sync",
  "prospecting_batch",
];

/** True when `kind` is a supported {@link JobKind}. */
export function isJobKind(kind: string): kind is JobKind {
  return (JOB_KINDS as readonly string[]).includes(kind);
}

/**
 * Context handed to every job handler. Carries identifiers only — never a raw
 * phone number (privacy invariant, Req 14.5).
 */
export interface JobContext {
  jobId: string;
  jobKey: string;
  kind: JobKind;
  partyId: string | null;
}

/** A job handler performs the actual work for one job kind. */
export type JobHandler = (
  db: Database,
  payload: unknown,
  ctx: JobContext
) => Promise<void>;

/** A complete dispatch table mapping every {@link JobKind} to a handler. */
export type JobHandlerRegistry = Record<JobKind, JobHandler>;

/**
 * Re-runnable job states. A job in one of these states can be (re)claimed by
 * `runJob`; `executing` and `done` cannot, which is what keeps external side
 * effects at-most-once even under concurrent runners or a manual re-run racing
 * an in-flight run.
 */
const CLAIMABLE_STATES = ["received", "planned", "failed"] as const;

function notImplemented(kind: JobKind): JobHandler {
  return async () => {
    throw new Error(
      `Job handler for "${kind}" is not implemented yet (implemented in task group 16)`
    );
  };
}

/**
 * The default handler registry. Placeholder handlers throw until task group 16
 * supplies the real implementations via {@link registerJobHandler}.
 */
export const defaultJobHandlers: JobHandlerRegistry = {
  post_call_processing: notImplemented("post_call_processing"),
  compile_and_email_report: notImplemented("compile_and_email_report"),
  morning_briefing: notImplemented("morning_briefing"),
  send_whatsapp_brief: notImplemented("send_whatsapp_brief"),
  lead_nudge: notImplemented("lead_nudge"),
  briefing_assembly: notImplemented("briefing_assembly"),
  outreach_send: notImplemented("outreach_send"),
  enrichment_fetch: notImplemented("enrichment_fetch"),
  market_sync: notImplemented("market_sync"),
  prospecting_batch: notImplemented("prospecting_batch"),
};

/**
 * Register (or replace) the handler for a job kind. Used by task group 16 to
 * plug in the heavy implementations without changing the spine.
 */
export function registerJobHandler(kind: JobKind, handler: JobHandler): void {
  defaultJobHandlers[kind] = handler;
}

/**
 * Enqueue a durable job.
 *
 * Idempotency (Req 9.2): `jobs.job_key` is unique. We insert with
 * `ON CONFLICT (job_key) DO NOTHING`, so re-enqueuing the same logical job
 * (e.g. a retried tool call, or `post_call_processing` keyed `conv:{id}`) never
 * produces a duplicate row — at most one job exists per `jobKey`. A fresh insert
 * publishes `job.queued`; a duplicate enqueue is silent (no extra event).
 *
 * @returns the id of the job row for `jobKey` (freshly inserted, or the existing
 *          row's id on conflict).
 */
export async function enqueueJob(
  db: Database,
  kind: JobKind,
  payload: unknown,
  jobKey: string
): Promise<string> {
  const inserted = await db
    .insert(jobs)
    .values({ kind, jobKey, payload: payload ?? null, status: "received" })
    .onConflictDoNothing({ target: jobs.jobKey })
    .returning({ id: jobs.id });

  if (inserted.length > 0) {
    const jobId = inserted[0].id;
    await publishEvent(db, {
      type: "job.queued",
      payload: { jobId, kind, jobKey },
    });
    return jobId;
  }

  // Conflict: a job with this jobKey already exists — return its id.
  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.jobKey, jobKey))
    .limit(1);

  return existing[0].id;
}

/**
 * Run a job by id. Idempotent by `jobKey` (Req 9.3): running an already-`done`
 * job is a no-op that yields the same terminal state, and the atomic claim
 * ensures at most one execution (hence at most one external side effect) even
 * under concurrency.
 *
 * State machine: received | planned | failed ──claim──► executing ──► done
 *                                                                  └─► failed
 *
 * On handler throw (Req 9.8) the job is marked `failed`, `lastError` is recorded
 * and a `job.failed` event is published; the job stays re-runnable (a `failed`
 * job is claimable again) so a manual "Run now" re-run is idempotent. Failure is
 * captured in the job row rather than re-thrown, so a polling worker keeps going.
 *
 * @param handlers dispatch table to use; defaults to {@link defaultJobHandlers}.
 *                 Tests inject fakes (e.g. counting email/WhatsApp adapters).
 */
export async function runJob(
  db: Database,
  jobId: string,
  handlers: JobHandlerRegistry = defaultJobHandlers
): Promise<void> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`runJob: job ${jobId} not found`);
  }

  // Already-terminal success: a no-op that returns the same terminal state.
  if (job.status === "done") {
    return;
  }

  // Atomically claim the job. Only re-runnable states transition to executing;
  // if the claim updates zero rows, another runner won the race (or the job is
  // already executing/done) and we must not run the handler again.
  const claimed = await db
    .update(jobs)
    .set({
      status: "executing",
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...CLAIMABLE_STATES])))
    .returning({ id: jobs.id });

  if (claimed.length === 0) {
    return;
  }

  await publishEvent(db, {
    type: "job.running",
    payload: { jobId, kind: job.kind, jobKey: job.jobKey },
  });

  const kind = job.kind as JobKind;
  const handler = handlers[kind];

  try {
    if (!handler) {
      throw new Error(`runJob: no handler registered for kind "${job.kind}"`);
    }

    await handler(db, job.payload, {
      jobId,
      jobKey: job.jobKey,
      kind,
      partyId: job.partyId,
    });

    await db
      .update(jobs)
      .set({ status: "done", lastError: null, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    await publishEvent(db, {
      type: "job.done",
      payload: { jobId, kind: job.kind, jobKey: job.jobKey },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .update(jobs)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    await publishEvent(db, {
      type: "job.failed",
      payload: { jobId, kind: job.kind, jobKey: job.jobKey, error: message },
    });
  }
}
