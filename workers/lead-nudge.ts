/**
 * Lead-engine nudge sweep worker — CONTAINER-ONLY (Req 10.6, 10.8, 16.3).
 *
 * Long-running Bun process that runs the proactive stale-lead sweep on a fixed
 * interval (default every 15 minutes — Req 10.1). It is the long-lived sibling
 * of `workers/outbox-drainer.ts` and `workers/job-runner.ts`: this worker owns
 * only the cadence; the sweep's logic lives in the pure, testable
 * `runNudgeSweep` workflow (`lib/cms/agents/workflows/lead-nudge.ts`), and the
 * actual owner notification + any Salesforce side effect happen later in the
 * `lead_nudge` job handler drained by the job-runner worker.
 *
 * One tick == one `runNudgeSweep` pass: it scans `leads_mirror` for stale Leads
 * and, for each stale OWNED Lead, enqueues exactly one `lead_nudge` job keyed by
 * `nudgeJobKey` (idempotent per lead × type × window bucket — Req 11.1); each
 * stale UNOWNED Lead gets a privacy-safe indication and no job (Req 10.4). The
 * 15-minute interval is owned here, never inside the policy module.
 *
 * This MUST run on the container/worker tier only — never on Next.js serverless,
 * which cannot host a long-lived interval loop (Req 10.8, 16.3). Like the
 * drainer it imports only library modules (`@/lib/cms/db`, the sweep workflow);
 * it pulls in nothing from the Next.js route/page graph, so it stays out of the
 * serverless bundle.
 *
 * The sweep is idempotent within a window bucket, so overlapping ticks or
 * multiple worker replicas are safe: a duplicate enqueue for the same nudge
 * occasion collapses onto the existing job (`enqueueJob` is ON CONFLICT
 * (job_key) DO NOTHING).
 *
 * Run with: `bun workers/lead-nudge.ts`
 */
import { db } from "@/lib/cms/db";
import { runNudgeSweep } from "@/lib/cms/agents/workflows/lead-nudge";

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Sweep cadence — run the stale-lead sweep every 15 minutes by default
 * (Req 10.1), overridable via `LEAD_NUDGE_INTERVAL_MS`. This is the SWEEP
 * interval; the rolling rate-limit / occasion window is a separate concern owned
 * by the `NudgePolicy` (`lib/cms/leads/nudge.ts`).
 */
const SWEEP_INTERVAL_MS =
  Number(process.env.LEAD_NUDGE_INTERVAL_MS) || 15 * 60 * 1000;

// ── Worker loop ───────────────────────────────────────────────────────────────

let running = true;

async function loop(): Promise<void> {
  console.log(
    `[lead-nudge] starting (container-only); interval=${SWEEP_INTERVAL_MS}ms`
  );
  while (running) {
    try {
      const { stale, enqueued, unowned } = await runNudgeSweep(db);
      if (stale > 0) {
        console.log(
          `[lead-nudge] swept: stale=${stale} enqueued=${enqueued} unowned=${unowned}`
        );
      }
    } catch (err) {
      // A sweep tick should never crash the loop; log and keep sweeping.
      console.error("[lead-nudge] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, SWEEP_INTERVAL_MS));
  }
  console.log("[lead-nudge] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[lead-nudge] received ${signal}, shutting down…`);
  running = false;
}

// Only auto-start when executed directly as a worker (Bun sets import.meta.main).
// Under the test runner / type-checker this stays dormant, so importing the
// module has no side effects.
if ((import.meta as { main?: boolean }).main) {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  void loop();
}
