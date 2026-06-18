import type { Database } from "@/lib/cms/db";
import { publishEvent } from "@/lib/cms/realtime/events";
import {
  isUnconfigured,
  type MarketDataAdapter,
} from "@/lib/cms/market/adapter";
import { ingestMarketBatch } from "@/lib/cms/market/ingest";
import type { JobContext, JobHandler } from "./index";

// ── market_sync (Prospecting Workspace S7) — Design §Architecture (job
// extensions), §Module layout; Requirement 11.2 ──────────────────────────────
//
// One `market_sync` job == ONE incremental fetch-then-ingest cycle against a
// configured MarketDataAdapter. The long-lived polling LOOP (holding the ingest
// cursor, sleeping `MARKET_SYNC_INTERVAL_MS`) is the worker `workers/market-sync.ts`
// (task 8.3); THIS handler is the single unit of work that loop drives, kept here
// so the spine owns the job-state machine and the worker owns only scheduling.
//
// CONTAINER-ONLY: registered + run on the worker tier ([container-only], Req 11.2).
//
// IDEMPOTENCY (Req 11.2 / CC-Idem): `ingestMarketBatch` upserts every row by
// `(source, source_ref)` (price index: `(area_name, segment, period, source)`),
// so re-ingesting the same batch is field-identical — re-running a `market_sync`
// job never duplicates a mirror row. The spine's at-most-once claim additionally
// bounds the (network) fetch to one per jobKey.
//
// UNCONFIGURED (Req 11.5): when the adapter has no credentials it returns
// `{ unconfigured: true }`; the handler records a `market.source.unconfigured`
// indication and returns without failing, mirroring the market readers.

/** Payload carried on a `market_sync` job. */
export interface MarketSyncPayload {
  /** Opaque incremental cursor from the prior poll (`null` for a full pull). */
  cursor?: string | null;
}

function parsePayload(payload: unknown): { cursor: string | null } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const cursor = typeof p.cursor === "string" ? p.cursor : null;
  return { cursor };
}

/**
 * Build a {@link JobHandler} for `market_sync`, injecting the
 * {@link MarketDataAdapter}. There is no env-resolved default — the long-lived
 * worker (task 8.3) constructs the configured adapter and injects it. Tests pass
 * a fake adapter (and an unconfigured one) to drive the ingest / unconfigured
 * paths offline.
 *
 * @param adapter the market source to pull from. When omitted the handler treats
 *   the source as unconfigured (no credentials wired) and records the indication.
 */
export function createMarketSyncHandler(
  adapter?: MarketDataAdapter
): JobHandler {
  return async (db: Database, payload: unknown, _ctx: JobContext) => {
    if (!adapter) {
      await publishEvent(db, {
        type: "market.source.unconfigured",
        payload: { reason: "no_adapter" },
      });
      return;
    }

    const { cursor } = parsePayload(payload);
    const batch = await adapter.fetchSince(cursor);

    if (isUnconfigured(batch)) {
      await publishEvent(db, {
        type: "market.source.unconfigured",
        payload: { source: adapter.source },
      });
      return;
    }

    await ingestMarketBatch(db, adapter.source, batch);

    await publishEvent(db, {
      type: "market.synced",
      payload: {
        source: adapter.source,
        cursor: batch.cursor,
        counts: {
          developers: batch.developers.length,
          projects: batch.projects.length,
          buildings: batch.buildings.length,
          transactions: batch.transactions.length,
          priceIndex: batch.priceIndex.length,
        },
      },
    });
  };
}

/**
 * Default handler instance. No adapter is wired here (the worker injects the
 * configured one, task 8.3), so the default treats the source as unconfigured
 * and records the indication rather than failing.
 */
export const marketSyncHandler: JobHandler = createMarketSyncHandler();
