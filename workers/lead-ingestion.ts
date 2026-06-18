/**
 * Lead-engine ingestion worker — CONTAINER-ONLY (Req 16.3).
 *
 * Long-running Bun process that receives/polls the lead sources and funnels
 * every Raw_Payload through its Ingestion_Adapter into Lead_Intake's durable
 * `recordInbound`. It is the long-lived sibling of `workers/outbox-drainer.ts`
 * and `workers/sf-inbound-sync.ts`: where the drainer pushes the outbox OUT to
 * Salesforce and the inbound-sync reads Leads back IN, this worker is the front
 * door — it captures inbound leads from every channel and durably records them
 * BEFORE any parsing, so no inbound lead is ever dropped (P-NoDrop).
 *
 * This MUST run on the container/worker tier only — never on Next.js
 * serverless, which cannot host a long-lived poll loop (Req 16.3). Like the
 * drainer it imports only library/transport modules (`@/lib/cms/db`, the
 * adapter registry, Lead_Intake); it pulls in nothing from the Next.js
 * route/page graph, so it stays out of the serverless bundle.
 *
 * One tick scans every registered source. For each source it asks the
 * {@link SourcePoller} for the Raw_Payloads received since the last tick, then
 * routes each payload through that source's adapter (`adapter.normalize`):
 *   - `ok` → `recordInbound` durably captures the canonical InboundLead with
 *     status `received` (idempotent by `idempotencyKey`, so a redelivered
 *     payload acks the existing row rather than duplicating it — Req 3.2, 3.3);
 *   - `unconfigured_source` → publish `lead.source.unconfigured` and retain the
 *     payload for retry; produce no lead (Req 1.7);
 *   - `invalid_payload` → the payload could not be normalized; it is retained
 *     by the source for retry / human review and logged (Req 2.3).
 *
 * [deps] / graceful degradation: live source transports (email/WhatsApp/Meta/
 * portal) need external credentials that may be absent. The default
 * {@link SourcePoller} yields nothing for every source, so the worker runs as a
 * no-op idle loop until a real poller is wired — it NEVER blocks on, or crashes
 * for want of, live credentials. The adapters already return
 * `unconfigured_source` when their credentials are missing, so even a partially
 * wired poller degrades cleanly.
 *
 * Run with: `bun workers/lead-ingestion.ts`
 */
import { db } from "@/lib/cms/db";
import {
  adapterRegistry,
  registeredSources,
} from "@/lib/cms/leads/adapters";
import type { LeadSource } from "@/lib/cms/leads/inbound";
import { recordInbound } from "@/lib/cms/leads/intake";
import { publishEvent } from "@/lib/cms/realtime/events";

// ── Configuration ────────────────────────────────────────────────────────────

/** Poll cadence — scan the sources for new Raw_Payloads approximately every 5s. */
const POLL_INTERVAL_MS = Number(process.env.LEAD_INGESTION_INTERVAL_MS) || 5000;

// ── SourcePoller seam ─────────────────────────────────────────────────────────

/**
 * The transport seam: returns the Raw_Payloads received from a {@link LeadSource}
 * since the previous poll. Implementations own the live receive/poll mechanics
 * (mailbox fetch, WhatsApp/Meta webhook drain, portal poll) and any ack/cursor
 * bookkeeping that retains undelivered payloads for retry.
 *
 * The worker treats every returned payload as opaque `unknown` and hands it to
 * the source's adapter for normalization — it makes no assumptions about shape.
 */
export interface SourcePoller {
  poll(source: LeadSource): Promise<unknown[]>;
}

/**
 * The default poller: yields nothing for every source. Until the live source
 * transports are wired (deferred, [deps]), the worker runs as an idle loop that
 * neither blocks on nor crashes for want of source credentials. Swap this for a
 * concrete poller when a transport's credentials are available.
 */
const idleSourcePoller: SourcePoller = {
  async poll(): Promise<unknown[]> {
    return [];
  },
};

// ── Per-source ingestion ──────────────────────────────────────────────────────

/** Counts from one ingestion tick, for the worker's logs/metrics. */
interface IngestionTickResult {
  /** Raw_Payloads recorded as fresh InboundLeads. */
  recorded: number;
  /** Redelivered payloads acknowledged against an existing row (deduped). */
  deduped: number;
  /** Payloads skipped because the source is unconfigured. */
  unconfigured: number;
  /** Payloads that could not be normalized (retained for retry/review). */
  invalid: number;
}

/**
 * Route every Raw_Payload polled from one source through its adapter and into
 * Lead_Intake. Each payload is handled independently so one bad payload never
 * stalls the rest of the batch.
 */
async function ingestSource(
  source: LeadSource,
  poller: SourcePoller,
  result: IngestionTickResult
): Promise<void> {
  const adapter = adapterRegistry.get(source);
  if (!adapter) return; // No adapter registered for this source (cannot happen).

  const payloads = await poller.poll(source);
  for (const raw of payloads) {
    const normalized = adapter.normalize(raw);

    if (normalized.ok) {
      // Durably record BEFORE any parsing (Req 3.1); idempotent by key (Req 3.3).
      const { deduped } = await recordInbound(db, normalized.lead);
      if (deduped) result.deduped += 1;
      else result.recorded += 1;
      continue;
    }

    if (normalized.code === "unconfigured_source") {
      // Produce no lead; record the indication; the payload is retained by the
      // source for retry (Req 1.7). Identifiers/source only — no raw phone.
      await publishEvent(db, {
        type: "lead.source.unconfigured",
        payload: { source, message: normalized.message },
      });
      result.unconfigured += 1;
      continue;
    }

    // invalid_payload: could not be normalized into a schema-valid InboundLead.
    // The payload is retained by the source for retry / human review (Req 2.3);
    // surface it in the logs without crashing the loop.
    console.error(
      `[lead-ingestion] invalid ${source} payload retained for review: ${normalized.message}`
    );
    result.invalid += 1;
  }
}

// ── Worker loop ───────────────────────────────────────────────────────────────

/**
 * Run one ingestion pass across every registered source. Exported so the loop's
 * core is unit-testable with an injected {@link SourcePoller}.
 */
export async function ingestOnce(
  poller: SourcePoller = idleSourcePoller
): Promise<IngestionTickResult> {
  const result: IngestionTickResult = {
    recorded: 0,
    deduped: 0,
    unconfigured: 0,
    invalid: 0,
  };
  for (const source of registeredSources()) {
    // One failing source must not stop the others; isolate per source.
    try {
      await ingestSource(source, poller, result);
    } catch (err) {
      console.error(`[lead-ingestion] source "${source}" failed:`, err);
    }
  }
  return result;
}

let running = true;

async function loop(): Promise<void> {
  console.log(
    `[lead-ingestion] starting (container-only); interval=${POLL_INTERVAL_MS}ms, ` +
      `sources=[${registeredSources().join(", ")}]`
  );
  while (running) {
    try {
      const { recorded, deduped, unconfigured, invalid } = await ingestOnce();
      if (recorded > 0 || deduped > 0 || unconfigured > 0 || invalid > 0) {
        console.log(
          `[lead-ingestion] ingested: recorded=${recorded} deduped=${deduped} ` +
            `unconfigured=${unconfigured} invalid=${invalid}`
        );
      }
    } catch (err) {
      // An ingestion tick should never crash the loop; log and keep polling.
      console.error("[lead-ingestion] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.log("[lead-ingestion] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[lead-ingestion] received ${signal}, shutting down…`);
  running = false;
}

// Only auto-start when executed directly as a worker (Bun sets import.meta.main).
// Under the test runner / type-checker this stays dormant, so importing the
// module (e.g. to unit-test `ingestOnce`) has no side effects.
if ((import.meta as { main?: boolean }).main) {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  void loop();
}
