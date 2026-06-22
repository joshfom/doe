/**
 * One-process launcher for the ENTIRE DOE stack in a single container.
 *
 * Use this when DOE is deployed as ONE Dokploy application (Nixpacks or a
 * single Dockerfile/Procfile) rather than the multi-service compose. It is the
 * "one push → everything up" path: it runs DB migrations once, then spawns the
 * site, the standalone API, the background workers AND the voice agent as
 * isolated subprocesses so a single deploy serves the frontend AND answers
 * voice calls.
 *
 *   bun scripts/start-all.ts            # migrate → web + api + workers + voice
 *
 * Env toggles:
 *   RUN_MIGRATIONS=false   skip the migration step (default: run it)
 *   START_VOICE=false      do not start the voice agent (default: start it)
 *   START_API=false        do not start the standalone SSE API (default: start)
 *   PORT                   web port (default 3000); API_PORT for the API (3001)
 *
 * Process model: each role is its own subprocess (Bun.spawn) so one crashing
 * does not take the others down. If a CRITICAL role (web) exits, the launcher
 * tears everything down and exits non-zero so the platform restarts the
 * container. The workers launcher (`start-workers.ts`) already isolates each
 * individual worker, so e.g. a misconfigured voice worker never kills the rest.
 *
 * NOTE: this couples all tiers into one container. It is the simplest deploy
 * for a single-host test box; for production prefer docker-compose.dokploy.yml,
 * which runs each role as its own restartable service.
 */

const RUN_MIGRATIONS = process.env.RUN_MIGRATIONS !== "false";
const START_VOICE = process.env.START_VOICE !== "false";
const START_API = process.env.START_API !== "false";

// ── 1) Migrations (idempotent; the web tier traditionally owns these) ────────
if (RUN_MIGRATIONS) {
  if (!process.env.DATABASE_URL) {
    console.warn("[start-all] DATABASE_URL is not set — skipping migrations");
  } else {
    console.log("[start-all] running database migrations…");
    const maxAttempts = Number(process.env.MIGRATE_MAX_ATTEMPTS ?? "30");
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const proc = Bun.spawn(["bun", "run", "scripts/migrate-direct.ts"], {
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code === 0) {
        ok = true;
        break;
      }
      console.warn(
        `[start-all] migration attempt ${attempt}/${maxAttempts} failed (exit ${code}); retrying in 2s…`
      );
      await Bun.sleep(2000);
    }
    if (!ok) {
      console.error("[start-all] migrations failed after all attempts");
      process.exit(1);
    }
    console.log("[start-all] migrations complete");
  }
}

// ── 2) Process table ─────────────────────────────────────────────────────────
// `critical` roles, when they exit, bring the whole container down (→ restart).
interface RoleSpec {
  name: string;
  cmd: string[];
  critical: boolean;
}

const roles: RoleSpec[] = [
  // The site + api.handle. Critical: if Next dies, the deploy is down.
  { name: "web", cmd: ["bun", "run", "start"], critical: true },
];

if (START_API) {
  // The standalone Bun/Elysia mount for durable SSE. Migrations already ran.
  roles.push({
    name: "api",
    cmd: ["bun", "run", "api:start"],
    critical: false,
  });
}

// All background workers. `start-workers.ts` with no extra arg starts the core
// loops; append "voice" so the voice agent is included. Each worker is itself
// an isolated subprocess inside this launcher, so one failing never stops the
// others.
roles.push({
  name: "workers",
  cmd: ["bun", "scripts/start-workers.ts", ...(START_VOICE ? [] : ["core"])],
  critical: false,
});

console.log(
  `[start-all] starting ${roles.length} role(s): ${roles.map((r) => r.name).join(", ")}` +
    (START_VOICE ? " (voice ON)" : " (voice OFF)")
);

const children = roles.map((role) => {
  // Per-role API_PORT default so the standalone API does not collide with web.
  const env = { ...process.env };
  if (role.name === "api" && !env.API_PORT) env.API_PORT = "3001";
  const proc = Bun.spawn(role.cmd, {
    env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  console.log(`[start-all] ▶ ${role.name} (${role.cmd.join(" ")}) pid=${proc.pid}`);
  return { role, proc };
});

// ── 3) Lifecycle ──────────────────────────────────────────────────────────────
let shuttingDown = false;

function shutdown(signal: string, code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[start-all] ${signal} → stopping ${children.length} role(s)…`);
  for (const { role, proc } of children) {
    try {
      proc.kill();
    } catch (err) {
      console.error(`[start-all] failed to stop ${role.name}:`, err);
    }
  }
  setTimeout(() => process.exit(code), 2000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Watch each child: a CRITICAL role exiting tears the whole container down so
// the platform restarts it; a non-critical role exiting is logged only.
for (const { role, proc } of children) {
  void proc.exited.then((code) => {
    if (shuttingDown) return;
    if (role.critical) {
      console.error(`[start-all] critical role "${role.name}" exited (${code}); shutting down`);
      shutdown("child-exit", code ?? 1);
    } else {
      console.warn(`[start-all] role "${role.name}" exited (${code}); leaving the rest running`);
    }
  });
}
