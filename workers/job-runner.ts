/**
 * Job runner worker — CONTAINER-ONLY (Req 12.6).
 *
 * Long-running Bun process that polls the `jobs` table for queued work and runs
 * it via the durable job-runner spine (`lib/cms/jobs`). This MUST run on the
 * container/worker tier only — never on Vercel serverless, which cannot host a
 * long-lived poll loop.
 *
 * Each tick claims a small batch of pending jobs and hands them to `runJob`,
 * which owns the state machine (received → executing → done | failed), the
 * at-most-once claim, and failure handling. Job-level idempotency is guaranteed
 * by `runJob`, so overlapping ticks or multiple worker replicas are safe.
 *
 * Run with: `bun workers/job-runner.ts`
 */
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/cms/db";
import { jobs } from "@/lib/cms/schema";
import { runJob } from "@/lib/cms/jobs";
import {
  registerVoiceJobHandlers,
  registerProspectingJobHandlers,
} from "@/lib/cms/jobs/register";

// Plug the real (non-placeholder) job handlers into the default registry before
// the poll loop runs (Design §7.8; the spine ships placeholders that throw).
// Voice-surface jobs (post-call, briefings, reports) AND the prospecting durable
// jobs (`prospecting_batch`, `outreach_send`, `enrichment_fetch`, `market_sync`)
// both run on this general durable-jobs worker. Without the prospecting
// registration an enqueued `prospecting_batch` job is claimed here, finds no
// handler, and fails — so the autonomous batch never produces prospects. The
// `market_sync` default handler idles cleanly when no adapter is wired (the
// dedicated market-sync worker owns the live cadence), so registering it here is
// safe.
registerVoiceJobHandlers();
registerProspectingJobHandlers();

/** Poll cadence and per-tick batch size. */
const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;

/** States the worker will pick up. `failed` is left for explicit manual re-run. */
const PENDING_STATES = ["received", "planned"] as const;

let running = true;

/** Claim and run one batch of pending jobs, oldest first. */
async function tick(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.status, [...PENDING_STATES]))
    .orderBy(asc(jobs.createdAt))
    .limit(BATCH_SIZE);

  for (const job of pending) {
    // runJob never throws on handler failure (it records `failed` + emits
    // `job.failed`), so one bad job cannot stall the loop.
    await runJob(db, job.id);
  }
}

async function loop(): Promise<void> {
  console.log("[job-runner] starting (container-only)…");
  while (running) {
    try {
      await tick();
    } catch (err) {
      console.error("[job-runner] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.log("[job-runner] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[job-runner] received ${signal}, shutting down…`);
  running = false;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void loop();
