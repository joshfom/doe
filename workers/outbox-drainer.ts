/**
 * Salesforce outbox drainer worker — CONTAINER-ONLY (Req 12.6).
 *
 * Long-running Bun process that drains the `sf_outbox` table every ~2s via the
 * existing `SalesforceAdapter` (`lib/cms/tickets/crm/salesforce.ts`), which
 * already performs OAuth client-credentials auth and exponential backoff on the
 * wire. This MUST run on the container/worker tier only — never on Vercel
 * serverless, which cannot host a long-lived poll loop.
 *
 * Each tick hands a batch of pending rows to `drainOnce`, which owns the
 * outcome policy: success → `sent` (+ `sfId`, `outbox.sent` event); failure →
 * `attempts++` with exponential backoff, and `dead` (+ `outbox.dead` event) at
 * 5 attempts. Idempotency by unique `jobKey` keeps Salesforce records
 * at-most-once even across retries, so overlapping ticks are safe.
 *
 * Drain cadence (~2s) keeps Salesforce-sandbox visibility within the 10s NFR
 * (Req 15.4 / NFR-4).
 *
 * Run with: `bun workers/outbox-drainer.ts`
 */
import { db } from "@/lib/cms/db";
import { drainOnce } from "@/lib/cms/outbox";
import { SalesforceAdapter } from "@/lib/cms/tickets/crm/salesforce";

/** Poll cadence — drain pending rows approximately every 2 seconds (Req 8.3). */
const POLL_INTERVAL_MS = 2000;

const adapter = new SalesforceAdapter();

let running = true;

async function loop(): Promise<void> {
  console.log("[outbox-drainer] starting (container-only)…");
  while (running) {
    try {
      const { sent, dead } = await drainOnce(db, adapter);
      if (sent > 0 || dead > 0) {
        console.log(`[outbox-drainer] drained: sent=${sent} dead=${dead}`);
      }
    } catch (err) {
      // A drain tick should never crash the loop; log and keep polling.
      console.error("[outbox-drainer] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.log("[outbox-drainer] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[outbox-drainer] received ${signal}, shutting down…`);
  running = false;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void loop();
