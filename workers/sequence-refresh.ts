/**
 * Sequence-refresh sweep worker — CONTAINER-ONLY (Req 4.1, 14.4).
 *
 * Long-running Bun process that fires the scheduled-refresh sweep for live
 * Prospecting Sequences on a fixed interval (default every 60 seconds — Req 4.1).
 * It is the long-lived sibling of `workers/lead-nudge.ts` / `workers/job-runner.ts`:
 * this worker owns ONLY the cadence; the sweep's logic lives in the pure,
 * testable `runSequenceRefreshSweep` workflow
 * (`lib/cms/prospecting/sequences/refresh-sweep.ts`), and the actual discovery /
 * enrollment / drafting happens later in the `prospecting_batch` job handler
 * drained by the job-runner worker.
 *
 * One tick == one `runSequenceRefreshSweep` pass: it selects every `live`
 * Sequence whose `next_refresh_at` has elapsed and, for each, enqueues exactly
 * one linked `prospecting_batch` Refresh_Run keyed idempotently by its scheduled
 * slot, then atomically advances `next_refresh_at`. The interval is owned here,
 * never inside the sweep module.
 *
 * This MUST run on the container/worker tier only — never on Next.js serverless,
 * which cannot host a long-lived interval loop (Req 14.4, CC-Next16). Like the
 * lead-nudge worker it imports only library modules (`@/lib/cms/db`, the sweep
 * workflow); it pulls in nothing from the Next.js route/page graph, so it stays
 * out of the serverless bundle.
 *
 * The sweep is idempotent per scheduled slot, so overlapping ticks or multiple
 * worker replicas are safe: a duplicate enqueue for the same slot collapses onto
 * the existing Refresh_Run / job (`prospecting_batch_runs.rerun_key` +
 * `enqueueJob` are both ON CONFLICT DO NOTHING).
 *
 * Run with: `bun workers/sequence-refresh.ts`
 */
import { db } from "@/lib/cms/db";
import type { Database } from "@/lib/cms/db";
import {
  runSequenceRefreshSweep,
  type RefreshSweepResult,
} from "@/lib/cms/prospecting/sequences/refresh-sweep";

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Default sweep cadence — fire the refresh sweep every 60 seconds (Req 4.1),
 * overridable via `SEQUENCE_REFRESH_INTERVAL_MS`. This is the SWEEP interval; a
 * Sequence's own `refresh_interval_minutes` (how often each campaign refreshes)
 * is a separate per-Sequence cadence owned by `next_refresh_at`.
 */
export const SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS = 60_000;

/**
 * Resolve the sweep cadence from `SEQUENCE_REFRESH_INTERVAL_MS`, falling back to
 * {@link SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS} when unset, non-numeric, or
 * non-positive. Pure: reads only the supplied env bag (defaults to
 * `process.env`).
 */
export function resolveSequenceRefreshIntervalMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.SEQUENCE_REFRESH_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS;
}

// ── One tick (the testable unit) ──────────────────────────────────────────────

/**
 * Run one refresh-sweep tick, wrapping {@link runSequenceRefreshSweep} so a
 * failure is LOGGED and never throws out of the loop. Overlapping ticks /
 * replicas are safe because the sweep is idempotent per scheduled slot. Returns
 * the sweep result on success, or `null` when the tick failed (and was
 * swallowed).
 */
export async function runSequenceRefreshTick(
  database: Database = db
): Promise<RefreshSweepResult | null> {
  try {
    const result = await runSequenceRefreshSweep(database);
    if (result.enqueued > 0) {
      console.log(
        `[sequence-refresh] swept: due=${result.due} enqueued=${result.enqueued}`
      );
    }
    return result;
  } catch (err) {
    // A sweep tick should never crash the loop; log and keep sweeping.
    console.error("[sequence-refresh] tick failed:", err);
    return null;
  }
}

// ── Worker loop ───────────────────────────────────────────────────────────────

let running = true;

async function loop(): Promise<void> {
  const intervalMs = resolveSequenceRefreshIntervalMs();
  console.log(
    `[sequence-refresh] starting (container-only); interval=${intervalMs}ms`
  );
  while (running) {
    await runSequenceRefreshTick(db);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.log("[sequence-refresh] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[sequence-refresh] received ${signal}, shutting down…`);
  running = false;
}

// Only auto-start when executed directly as a worker (Bun sets import.meta.main).
// Under the test runner / type-checker this stays dormant, so importing the
// module has no side effects (mirrors `workers/lead-nudge.ts`).
if ((import.meta as { main?: boolean }).main) {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  void loop();
}
