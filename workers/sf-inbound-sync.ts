/**
 * Salesforce inbound-sync worker — CONTAINER-ONLY (Req 10.4, 10.5).
 *
 * Long-running Bun process that polls Salesforce for changed Leads and mirrors
 * them into DOE's party graph + `leads_mirror`. It is the long-lived sibling of
 * `workers/outbox-drainer.ts`: where the drainer pushes the outbox OUT to
 * Salesforce, this worker reads changed Leads back IN.
 *
 * The chosen Inbound_Strategy is **polling** (design §4 Decision Document). The
 * pure, testable core of one tick lives in `lib/cms/crm/inbound-sync.ts`
 * (`pollOnce`); this worker is the thin loop around it that:
 *   - holds the in-memory cursor,
 *   - refreshes the API-quota gauge, then calls `pollOnce`,
 *   - advances the cursor to the returned `next`,
 *   - sleeps `SF_POLL_INTERVAL_MS` (default 30000ms) and repeats,
 *   - never crashes the loop on a tick error (log and keep polling),
 *   - shuts down gracefully on SIGINT/SIGTERM, exactly like the drainer.
 *
 * This MUST run on the container/worker tier only — never on Next.js serverless,
 * which cannot host a long-lived poll loop (Req 10.4, 10.5). Like the drainer it
 * imports only library/transport modules (`@/lib/cms/db`, the SF adapter, the
 * inbound-sync core); it pulls in nothing from the Next.js route/page graph, so
 * it stays out of the serverless bundle.
 *
 * The poll interval (default 30s) keeps `leads_mirror` fresh within the 60s
 * bound (Req 6.8).
 *
 * Run with: `bun workers/sf-inbound-sync.ts`
 */
import { db } from "@/lib/cms/db";
import {
  pollOnce,
  type QuotaGauge,
  type SfLeadRecord,
  type SoqlRunner,
} from "@/lib/cms/crm/inbound-sync";
import { SalesforceAdapter } from "@/lib/cms/tickets/crm/salesforce";
import { SalesforceObjectClient } from "@/lib/cms/tickets/crm/salesforce-objects";
import { SF_OBJECT_CONFIG } from "@/lib/cms/tickets/crm/sf-config";

// ── Configuration ────────────────────────────────────────────────────────────

/** Poll cadence — query Salesforce for changed Leads every ~30s (Req 6.8). */
const POLL_INTERVAL_MS = Number(process.env.SF_POLL_INTERVAL_MS) || 30000;

/**
 * Initial cursor lookback window (ms). On startup there is no persisted cursor,
 * so the first tick reads Leads modified within this trailing window rather than
 * the entire Lead history. Re-mirroring is idempotent (Req 6.5), so the choice
 * is purely about bounding the first query's size / API cost; it defaults to 24h
 * and is env-overridable via `SF_POLL_INITIAL_LOOKBACK_MS`.
 */
const INITIAL_LOOKBACK_MS =
  Number(process.env.SF_POLL_INITIAL_LOOKBACK_MS) || 24 * 60 * 60 * 1000;

/**
 * Salesforce REST API version. Mirrors the default used by `sf-config.ts`'s
 * `sobjectPath`, and is overridable via the same `SF_API_VERSION` env var so the
 * query/limits paths stay in lock-step with the sObject paths.
 */
const API_VERSION = process.env.SF_API_VERSION ?? "v59.0";

// ── SoqlRunner — concrete SOQL query over the Lead object ─────────────────────

/**
 * Runs the poll's SOQL query against the Salesforce REST query endpoint.
 *
 * `SalesforceAdapter` exposes no dedicated query method, so this issues a GET to
 * `/services/data/<version>/query?q=<url-encoded SOQL>` through the shared
 * `requestJson` transport (which already owns OAuth, the single-shot 401 re-auth,
 * and transient-error classification).
 *
 * The SELECT list is built from the configured Lead field API names
 * ({@link SF_OBJECT_CONFIG}) plus the always-present `Id` and `LastModifiedDate`,
 * so sandbox/production field differences are absorbed in configuration. The
 * `LastModifiedDate > <cursor>` predicate uses an unquoted ISO-8601 datetime
 * literal (the SOQL form for datetime comparisons) and orders ascending so the
 * caller can advance the cursor to the last record's timestamp.
 */
class SalesforceSoqlRunner implements SoqlRunner {
  constructor(private readonly adapter: SalesforceAdapter) {}

  async leadsModifiedSince(cursor: Date): Promise<SfLeadRecord[]> {
    const soql =
      `SELECT ${this.selectFields()} FROM ${SF_OBJECT_CONFIG.Lead.sobject} ` +
      `WHERE LastModifiedDate > ${cursor.toISOString()} ` +
      `ORDER BY LastModifiedDate ASC`;

    const path = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
    const result = await this.adapter.requestJson<{ records?: SfLeadRecord[] }>(
      "GET",
      path
    );
    return result.records ?? [];
  }

  /** The de-duplicated SELECT field list: Id, LastModifiedDate, + configured Lead fields. */
  private selectFields(): string {
    const fields = new Set<string>(["Id", "LastModifiedDate"]);
    for (const apiName of Object.values(SF_OBJECT_CONFIG.Lead.fields)) {
      fields.add(apiName);
    }
    return [...fields].join(", ");
  }
}

// ── QuotaGauge — API quota usage from the Salesforce /limits endpoint ─────────

/**
 * Reports the current Salesforce daily-API-request usage as a fraction in
 * `[0, 1]`, used by `pollOnce` to throttle at ≥80% (Req 6.6).
 *
 * The `Sforce-Limit-Info` response header is the lightest source, but the shared
 * `requestJson` transport returns only parsed JSON bodies (not headers), so this
 * gauge instead reads `/services/data/<version>/limits`, whose
 * `DailyApiRequests: { Max, Remaining }` gives `used = (Max - Remaining) / Max`.
 *
 * `usedFraction()` is synchronous (per the {@link QuotaGauge} contract), so it
 * returns the last sampled value; the worker calls {@link refresh} once per tick
 * before `pollOnce`. The gauge is conservative on failure: if `/limits` cannot be
 * read it retains the previous sample rather than reporting 0 (which would
 * disable throttling).
 */
class SalesforceQuotaGauge implements QuotaGauge {
  private fraction = 0;

  constructor(private readonly adapter: SalesforceAdapter) {}

  usedFraction(): number {
    return this.fraction;
  }

  /** Sample the org's daily-API-request usage; retain the prior value on failure. */
  async refresh(): Promise<void> {
    try {
      const limits = await this.adapter.requestJson<{
        DailyApiRequests?: { Max?: number; Remaining?: number };
      }>("GET", `/services/data/${API_VERSION}/limits`);

      const daily = limits.DailyApiRequests;
      if (
        daily &&
        typeof daily.Max === "number" &&
        typeof daily.Remaining === "number" &&
        daily.Max > 0
      ) {
        const used = (daily.Max - daily.Remaining) / daily.Max;
        // Clamp to [0, 1] to guard against transient over/under-reporting.
        this.fraction = Math.min(1, Math.max(0, used));
      }
    } catch (err) {
      // Quota sampling is best-effort: keep the previous fraction so a failed
      // sample never silently disables throttling.
      console.error("[sf-inbound-sync] quota refresh failed:", err);
    }
  }
}

// ── Worker loop ──────────────────────────────────────────────────────────────

const adapter = new SalesforceAdapter();
const sf = new SalesforceObjectClient(adapter);
const query = new SalesforceSoqlRunner(adapter);
const quota = new SalesforceQuotaGauge(adapter);

/** In-memory cursor: the max LastModifiedDate processed so far (see INITIAL_LOOKBACK_MS). */
let cursor = new Date(Date.now() - INITIAL_LOOKBACK_MS);

let running = true;

async function loop(): Promise<void> {
  console.log(
    `[sf-inbound-sync] starting (container-only); interval=${POLL_INTERVAL_MS}ms, ` +
      `initial cursor=${cursor.toISOString()}`
  );
  while (running) {
    try {
      // Sample API quota before the tick so pollOnce can throttle at ≥80% (Req 6.6).
      await quota.refresh();
      const { next, processed } = await pollOnce({ db, sf, query, quota }, cursor);
      cursor = next;
      if (processed > 0) {
        console.log(
          `[sf-inbound-sync] polled: processed=${processed} cursor=${cursor.toISOString()}`
        );
      }
    } catch (err) {
      // A poll tick must never crash the loop; log and keep polling (resilience).
      console.error("[sf-inbound-sync] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.log("[sf-inbound-sync] stopped.");
}

function shutdown(signal: string): void {
  console.log(`[sf-inbound-sync] received ${signal}, shutting down…`);
  running = false;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void loop();
