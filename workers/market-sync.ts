/**
 * Market-sync worker — CONTAINER-ONLY (Req 11.2, CC-Next16).
 *
 * Long-running Bun process that keeps the `market_*` mirror fresh. It is the
 * long-lived sibling of `workers/outbox-drainer.ts` / `workers/lead-nudge.ts` /
 * `workers/job-runner.ts`: this worker owns only the cadence and the incremental
 * ingest cursor; the fetch + idempotent upsert logic lives in the testable
 * market library (`MarketDataAdapter.fetchSince` + `ingestMarketBatch`).
 *
 * One tick == one incremental fetch-then-ingest cycle (Design §Module layout,
 * §Components #2; Requirement 11.2):
 *   1. call `adapter.fetchSince(cursor)` with the cursor HELD across iterations;
 *   2. if the source is unconfigured (`{ unconfigured: true }`, or no adapter is
 *      wired), do NOT crash — record a `market.source.unconfigured` indication
 *      and back off (Requirement 11.5);
 *   3. otherwise `ingestMarketBatch` the result (idempotent by `(source,
 *      source_ref)` so re-ingest is field-identical — Req 11.2), ADVANCE the
 *      held cursor to `batch.cursor`, and emit `market.synced`.
 *
 * This MUST run on the container/worker tier only — never on Next.js serverless,
 * which cannot host a long-lived poll loop (CC-Next16). Like the drainer it
 * imports ONLY library modules (`@/lib/cms/db`, the market adapter + ingest, the
 * event bus); it pulls in nothing from the Next.js route/page graph and nothing
 * from the Mastra agent runtime, so it stays out of the serverless bundle and
 * never drags `app/api/[...slugs]/route.ts` into its import graph.
 *
 * [deps] A live run needs market-source credentials (`PROPERTY_MONITOR_API_KEY`
 * / Dubai Pulse) at runtime. Without them the worker starts cleanly and idles
 * (unconfigured), emitting `market.source.unconfigured` each tick rather than
 * failing — so the container boots green before credentials/adapters are wired.
 * The concrete `MarketDataAdapter` implementations (property-monitor /
 * dubai-pulse) land in a later [deps] task; {@link resolveMarketAdapter} is the
 * injection seam they plug into. Tests drive {@link runMarketSyncTick} directly
 * with a fake adapter and never touch the network.
 *
 * Re-ingest is idempotent and overlapping ticks are safe, so multiple worker
 * replicas converge on the same mirror state.
 *
 * Run with: `bun workers/market-sync.ts`
 */
import { db } from "@/lib/cms/db";
import type { Database } from "@/lib/cms/db";
import {
  isUnconfigured,
  type MarketDataAdapter,
} from "@/lib/cms/market/adapter";
import { DbLocationResolutionCache } from "@/lib/cms/market/adapters/location-cache";
import {
  PropertyFinderAdapter,
  type PropertyFinderDeps,
} from "@/lib/cms/market/adapters/property-finder";
import { ingestMarketBatch } from "@/lib/cms/market/ingest";
import { publishEvent } from "@/lib/cms/realtime/events";

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Default sync cadence — poll the market source every 30 minutes. Market data
 * (DLD transactions / price indices) refreshes on a daily-to-weekly cadence
 * upstream, so a half-hour poll is comfortably fresh without re-billing a
 * reseller API. Overridable via `MARKET_SYNC_INTERVAL_MS`.
 */
export const MARKET_SYNC_DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Resolve the sync cadence from `MARKET_SYNC_INTERVAL_MS`, falling back to
 * {@link MARKET_SYNC_DEFAULT_INTERVAL_MS} when unset, non-numeric, or
 * non-positive. Pure: reads only the supplied env bag (defaults to
 * `process.env`).
 */
export function resolveMarketSyncIntervalMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.MARKET_SYNC_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : MARKET_SYNC_DEFAULT_INTERVAL_MS;
}

// ── Container-tier guard ([container-only], CC-Next16) ────────────────────────

/**
 * Thrown when the market-sync worker is started on the serverless tier rather
 * than the container/worker tier (CC-Next16). A hard misconfiguration — a
 * long-lived poll loop never runs serverless. Mirrors the agents'
 * `ProspectingAgentTierError`, but defined locally so this worker does NOT
 * import the Mastra agent module (which would drag the agent runtime into the
 * worker bundle).
 */
export class MarketSyncTierError extends Error {
  readonly code = "container_tier_required";
  constructor(
    message = "market-sync worker is restricted to the container/worker tier and must not run on Next.js serverless."
  ) {
    super(message);
    this.name = "MarketSyncTierError";
  }
}

/**
 * Detect whether the current process is the serverless tier — same precedence
 * as the prospecting/home agents' `detectServerless`: an explicit `DOE_TIER`
 * override first, then known serverless platform signals / the Next.js edge
 * runtime, defaulting to not-serverless (a standalone container/worker process
 * or tests).
 */
function detectServerless(env: NodeJS.ProcessEnv = process.env): boolean {
  const tier = env.DOE_TIER?.toLowerCase();
  if (tier === "container" || tier === "worker") return false;
  if (tier === "serverless") return true;
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT) {
    return true;
  }
  if (env.NEXT_RUNTIME === "edge") return true;
  return false;
}

/**
 * Refuse, before any loop work, to run the market-sync worker on the serverless
 * tier. Throws {@link MarketSyncTierError} when serverless. Tests may force the
 * decision via `serverless`.
 */
export function assertMarketSyncContainerTier(serverless?: boolean): void {
  if (serverless ?? detectServerless()) {
    throw new MarketSyncTierError();
  }
}

// ── Adapter resolution (injection seam) ───────────────────────────────────────

/**
 * Default Dubai area set polled when `MARKET_AREAS` is unset — a single, sensible
 * starter community so a freshly-configured worker resolves one location and
 * stays well within the reseller free tier (Req 14.6). Override with a
 * comma-separated `MARKET_AREAS` list (e.g. `"Dubai Marina,Palm Jumeirah"`).
 */
export const DEFAULT_MARKET_AREAS = ["Dubai Marina"] as const;

/**
 * Parse the comma-separated `MARKET_AREAS` env var into a trimmed, de-duplicated,
 * non-empty area list, falling back to {@link DEFAULT_MARKET_AREAS} when unset or
 * empty. Pure: reads only the supplied value.
 */
export function resolveMarketAreas(raw: string | undefined): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  const deduped = [...new Set(parsed)];
  return deduped.length > 0 ? deduped : [...DEFAULT_MARKET_AREAS];
}

/**
 * Resolve the demo-stamp intent from `MARKET_DEMO`. When `"true"`, ingested rows
 * are stamped `demo = true` (Req 14.4, Decision 10) — appropriate while the
 * unofficial reseller source feeds the demo. Any other value (incl. unset) →
 * `false` (live provenance). Pure: reads only the supplied env bag.
 */
export function resolveMarketDemo(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.MARKET_DEMO === "true";
}

/**
 * Resolve the configured {@link MarketDataAdapter} from the environment, or
 * `null` when no source is wired.
 *
 * When a RapidAPI key is present (`RAPIDAPI_KEY`, falling back to
 * `UAE_REE_API_KEY`), constructs the {@link PropertyFinderAdapter} reseller
 * source (Req 14.1): host from `PROPERTY_FINDER_HOST` (adapter default
 * otherwise), areas from `MARKET_AREAS` ({@link resolveMarketAreas}), period from
 * `MARKET_PERIOD` (default `"1y"`), and the `demo` stamp from `MARKET_DEMO`. When
 * a `database` handle is supplied, the adapter is given a DB-backed
 * `location_resolutions` cache so location ids survive worker restarts (Req
 * 14.3); the free-tier page cache uses the adapter's in-memory default. The
 * adapter relies on its own `defaultTransport` + `defaultClock`.
 *
 * When no key is present, returns `null` so the worker idles cleanly as
 * unconfigured (emitting `market.source.unconfigured`) rather than crashing —
 * the existing clean idle is preserved (Req 11.5, 14.1).
 *
 * Pure aside from reading the supplied env bag; never opens a network connection
 * (the DB-backed cache lazily queries only when the adapter resolves an area).
 */
export function resolveMarketAdapter(
  env: NodeJS.ProcessEnv = process.env,
  database?: Database
): MarketDataAdapter | null {
  const apiKey = env.RAPIDAPI_KEY ?? env.UAE_REE_API_KEY;
  if (!apiKey) return null;

  const deps: PropertyFinderDeps = database
    ? { locationCache: new DbLocationResolutionCache(database) }
    : {};

  return new PropertyFinderAdapter(
    {
      apiKey,
      host: env.PROPERTY_FINDER_HOST,
      areas: resolveMarketAreas(env.MARKET_AREAS),
      period: env.MARKET_PERIOD ?? "1y",
      demo: resolveMarketDemo(env),
    },
    deps
  );
}

// ── One tick: fetch → ingest → advance cursor → emit ──────────────────────────

/** Counts of rows in a synced batch, surfaced on the `market.synced` event. */
export interface MarketSyncCounts {
  developers: number;
  projects: number;
  buildings: number;
  transactions: number;
  priceIndex: number;
}

/** The outcome of one {@link runMarketSyncTick} cycle. */
export type MarketSyncTickOutcome =
  | {
      status: "synced";
      /** The advanced cursor to hold for the next tick. */
      cursor: string;
      counts: MarketSyncCounts;
    }
  | {
      status: "unconfigured";
      /** The cursor is left unchanged when a source is unconfigured. */
      cursor: string | null;
      reason: "no_adapter" | "source_unconfigured";
    };

/**
 * Run exactly ONE market-sync cycle and return the outcome (including the cursor
 * to hold for the next tick). This is the testable unit the worker loop drives;
 * the loop owns only the cadence and the held cursor.
 *
 *   - `adapter === null` → no source wired: emit `market.source.unconfigured`
 *     (reason `no_adapter`), keep the cursor (Req 11.5).
 *   - `fetchSince` returns `{ unconfigured: true }` → credentials absent: emit
 *     `market.source.unconfigured` (reason `source_unconfigured`), keep the
 *     cursor (Req 11.5).
 *   - otherwise → `ingestMarketBatch` (idempotent, Req 11.2), then emit
 *     `market.synced` and return the ADVANCED cursor.
 *
 * Mirrors the `market_sync` job handler (`lib/cms/jobs/market-sync.ts`) but
 * returns the advanced cursor so the long-lived worker can hold it across ticks.
 *
 * `opts.demo` (default `false`) threads the worker's demo intent
 * (`MARKET_DEMO`, {@link resolveMarketDemo}) into `ingestMarketBatch` so reseller
 * rows are stamped `demo = true` while the unofficial source feeds the demo (Req
 * 14.4, Decision 10). Existing callers that pass no `opts` ingest as live.
 */
export async function runMarketSyncTick(
  database: Database,
  adapter: MarketDataAdapter | null,
  cursor: string | null,
  opts?: { demo?: boolean }
): Promise<MarketSyncTickOutcome> {
  if (!adapter) {
    await publishEvent(database, {
      type: "market.source.unconfigured",
      payload: { reason: "no_adapter" },
    });
    return { status: "unconfigured", cursor, reason: "no_adapter" };
  }

  const result = await adapter.fetchSince(cursor);

  if (isUnconfigured(result)) {
    await publishEvent(database, {
      type: "market.source.unconfigured",
      payload: { source: adapter.source },
    });
    return { status: "unconfigured", cursor, reason: "source_unconfigured" };
  }

  await ingestMarketBatch(database, adapter.source, result, {
    demo: opts?.demo ?? false,
  });

  const counts: MarketSyncCounts = {
    developers: result.developers.length,
    projects: result.projects.length,
    buildings: result.buildings.length,
    transactions: result.transactions.length,
    priceIndex: result.priceIndex.length,
  };

  await publishEvent(database, {
    type: "market.synced",
    payload: { source: adapter.source, cursor: result.cursor, counts },
  });

  return { status: "synced", cursor: result.cursor, counts };
}

// ── Worker loop ───────────────────────────────────────────────────────────────

let running = true;

async function loop(): Promise<void> {
  const intervalMs = resolveMarketSyncIntervalMs();
  const adapter = resolveMarketAdapter(process.env, db);
  const demo = resolveMarketDemo();
  console.log(
    `[market-sync] starting (container-only); interval=${intervalMs}ms; ` +
      `source=${adapter ? adapter.source : "unconfigured"}; demo=${demo}`
  );

  // The ingest cursor is HELD across iterations and advanced only on a
  // successful sync (Req 11.2). A full pull starts from `null`.
  let cursor: string | null = null;

  while (running) {
    try {
      const outcome = await runMarketSyncTick(db, adapter, cursor, { demo });
      if (outcome.status === "synced") {
        cursor = outcome.cursor;
        const c = outcome.counts;
        console.log(
          `[market-sync] synced: developers=${c.developers} projects=${c.projects} ` +
            `buildings=${c.buildings} transactions=${c.transactions} ` +
            `priceIndex=${c.priceIndex} cursor=${cursor}`
        );
      } else {
        // Unconfigured: do NOT crash; back off and keep idling (Req 11.5).
        console.warn(
          `[market-sync] source unconfigured (${outcome.reason}); idling.`
        );
      }
    } catch (err) {
      // A sync tick should never crash the loop; log and keep polling.
      console.error("[market-sync] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.log("[market-sync] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[market-sync] received ${signal}, shutting down…`);
  running = false;
}

// Only auto-start when executed directly as a worker (Bun sets import.meta.main).
// Under the test runner / type-checker this stays dormant, so importing the
// module has no side effects (mirrors `workers/lead-nudge.ts`).
if ((import.meta as { main?: boolean }).main) {
  // (0) [container-only] — refuse to start on the serverless tier (CC-Next16).
  assertMarketSyncContainerTier();
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  void loop();
}
