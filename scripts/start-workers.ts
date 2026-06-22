/**
 * One-command launcher for the container-tier workers.
 *
 * Spawns each worker as its own subprocess so they stay isolated (one crashing
 * never takes down the others) and each keeps its own SIGINT/SIGTERM handling.
 * Worker logs already self-prefix (e.g. "[outbox-drainer] …") so output stays
 * readable when interleaved.
 *
 *   bun run --env-file=.env scripts/start-workers.ts            # start ALL workers
 *   bun run --env-file=.env scripts/start-workers.ts core       # infra only (no voice)
 *   bun run --env-file=.env scripts/start-workers.ts outbox sf  # a custom subset
 *
 * Ctrl-C (SIGINT) / SIGTERM cleanly stops every child before exiting.
 *
 * NOTE: container/worker tier only — these are long-lived loops and must NEVER
 * run on Vercel serverless (Req 12.6).
 */

// name → worker entrypoint. Order is start order (cheap infra first).
// A worker can be ["entrypoint", ...extraArgs] when it needs a subcommand.
const WORKERS: Record<string, string | string[]> = {
  outbox: "workers/outbox-drainer.ts", // DOE → Salesforce drain
  sf: "workers/sf-inbound-sync.ts", // Salesforce → leads_mirror poll
  jobs: "workers/job-runner.ts", // durable jobs (reports, post-call, briefings)
  lead: "workers/lead-ingestion.ts", // multi-source inbound capture
  nudge: "workers/lead-nudge.ts", // proactive stale-lead follow-ups
  // LiveKit Agents entrypoint — its CLI needs a `start` (prod) / `dev` subcommand.
  voice: ["workers/voice-agent-livekit.ts", "start"], // genuine live voice pipeline
};

/** "core" = everything except the creds-heavy voice worker. */
const CORE = ["outbox", "sf", "jobs", "lead", "nudge"];

function resolveSelection(args: string[]): string[] {
  if (args.length === 0) return Object.keys(WORKERS);
  if (args.length === 1 && args[0] === "core") return CORE;

  const unknown = args.filter((a) => !(a in WORKERS));
  if (unknown.length > 0) {
    console.error(
      `Unknown worker(s): ${unknown.join(", ")}.\n` +
        `Valid names: ${Object.keys(WORKERS).join(", ")} (or "core", or no args for all).`
    );
    process.exit(1);
  }
  return args;
}

const selection = resolveSelection(process.argv.slice(2));

console.log(
  `[workers] starting ${selection.length} worker(s): ${selection.join(", ")}`
);

const children = selection.map((name) => {
  const spec = WORKERS[name];
  const [entry, ...extraArgs] = Array.isArray(spec) ? spec : [spec];
  const proc = Bun.spawn(["bun", entry, ...extraArgs], {
    // Inherit env (so --env-file values pass through) and stdio so each
    // worker's own prefixed logs stream straight to this terminal.
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  console.log(`[workers] ▶ ${name} (${entry}) pid=${proc.pid}`);
  return { name, proc };
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[workers] received ${signal}, stopping ${children.length} worker(s)…`);
  for (const { name, proc } of children) {
    try {
      proc.kill(); // SIGTERM → each worker's own graceful shutdown handler
    } catch (err) {
      console.error(`[workers] failed to stop ${name}:`, err);
    }
  }
  // Give children a moment to exit cleanly, then force-exit.
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// If every child exits on its own (e.g. all unconfigured), exit too.
await Promise.all(children.map(({ proc }) => proc.exited));
if (!shuttingDown) {
  console.log("[workers] all workers exited.");
  process.exit(0);
}
