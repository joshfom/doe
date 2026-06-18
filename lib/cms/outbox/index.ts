import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { sfOutbox } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import type { SalesforceAdapter } from "@/lib/cms/tickets/crm/salesforce";
import { SalesforceObjectClient } from "@/lib/cms/tickets/crm/salesforce-objects";
import { routeOutbox } from "./object-router";

export type OutboxKind = "lead_upsert" | "task" | "event";

// ── Drainer tuning (Design §14; Requirements 8.3–8.6) ─────────────────────────

/** Max rows pulled per drain tick (Req 8.3 — batches of at most 20). */
const DRAIN_BATCH_SIZE = 20;

/** Attempts at which a row is given up on and marked `dead` (Req 8.6). */
const MAX_ATTEMPTS = 5;

/**
 * Base unit for exponential backoff between retries.
 *
 * The `sf_outbox` schema carries `attempts` + `updatedAt` but has no explicit
 * `nextRetryAt` column. We therefore derive the next-retry time on the fly:
 * a failed row's `updatedAt` is bumped on every attempt, so a row is eligible
 * to retry once `updatedAt + backoff(attempts)` has elapsed. With a 2s base the
 * schedule is 2s, 4s, 8s, 16s before the 5th attempt flips the row to `dead`.
 */
const BACKOFF_BASE_MS = 2000;

/**
 * Enqueue a Salesforce outbox row for asynchronous delivery.
 *
 * Idempotency (Req 8.2): `sf_outbox.job_key` is unique. We insert with
 * `ON CONFLICT (job_key) DO NOTHING` so re-enqueuing the same logical write
 * (e.g. a retried tool call) never produces a duplicate row — at most one row
 * exists per `jobKey`. The persisted row always starts in `status = 'pending'`
 * (Req 8.1); draining is handled separately by `drainOnce`.
 *
 * @returns the id of the outbox row for the given `jobKey` (the freshly
 * inserted row, or the existing row's id when a conflict occurred).
 */
export async function enqueueOutbox(
  db: Database,
  kind: OutboxKind,
  payload: unknown,
  jobKey: string
): Promise<string> {
  const inserted = await db
    .insert(sfOutbox)
    .values({
      kind,
      jobKey,
      payload,
      status: "pending",
    })
    .onConflictDoNothing({ target: sfOutbox.jobKey })
    .returning({ id: sfOutbox.id });

  if (inserted.length > 0) {
    return inserted[0].id;
  }

  // Conflict: a row with this jobKey already exists — return its id.
  const existing = await db
    .select({ id: sfOutbox.id })
    .from(sfOutbox)
    .where(eq(sfOutbox.jobKey, jobKey))
    .limit(1);

  return existing[0].id;
}

// ── Backoff ───────────────────────────────────────────────────────────────────

/**
 * Exponential backoff window (ms) before a row with `attempts` failures may be
 * retried. The first attempt (`attempts === 0`) is eligible immediately; each
 * subsequent failure doubles the wait: 2s, 4s, 8s, 16s.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) {
    return 0;
  }
  return BACKOFF_BASE_MS * 2 ** (attempts - 1);
}

/**
 * Whether a pending row is eligible to be (re)attempted now. Fresh rows
 * (`attempts === 0`) are always eligible; previously-failed rows must have
 * waited out their backoff window since the last attempt (`updatedAt`).
 */
function isEligible(
  row: { attempts: number; updatedAt: Date },
  now: number
): boolean {
  if (row.attempts <= 0) {
    return true;
  }
  return now - row.updatedAt.getTime() >= backoffMs(row.attempts);
}

// ── Salesforce routing ────────────────────────────────────────────────────────

/**
 * Push a single outbox row to Salesforce via the {@link routeOutbox} object
 * router and return the created-or-updated record's id (captured as
 * `sf_outbox.sfId`). Throws on failure so `drainOnce` can apply the
 * retry/backoff/dead-letter policy.
 *
 * The router switches on `kind` and the originating DOE entity carried in the
 * payload, driving the first-class {@link SalesforceObjectClient}
 * (`lead_upsert` → Lead, `task` → Task, `event` → Event) — it NEVER falls back
 * to a Salesforce Case (Design §3; Requirements 4.4–4.6). It reconciles against
 * the row's existing `sfId` (and, for a Lead, the Party's mirrored
 * `leads_mirror.sf_lead_id`) before writing, so a retry UPDATES the prior
 * Salesforce record rather than creating a duplicate — hence `db` and the row's
 * `sfId` are threaded through.
 */
async function pushToSalesforce(
  db: Database,
  sf: SalesforceObjectClient,
  kind: OutboxKind,
  payload: unknown,
  sfId: string | null
): Promise<string> {
  return routeOutbox(db, sf, { kind, payload, sfId });
}

// ── Drainer ─────────────────────────────────────────────────────────────────

/**
 * Drain a single batch of pending Salesforce outbox rows (Design §14;
 * Requirements 8.3–8.6).
 *
 * Selects up to {@link DRAIN_BATCH_SIZE} `pending` rows oldest-first, then for
 * each row that has waited out its exponential backoff window:
 *   • on success — set `status = 'sent'`, store the returned `sfId`, and publish
 *     an `outbox.sent` event (Req 8.4);
 *   • on failure — increment `attempts`, record `lastError`, and either leave the
 *     row `pending` for a later (backed-off) retry while `attempts < 5`, or mark
 *     it `dead` and publish an `outbox.dead` event at the 5th attempt (Req 8.5,
 *     8.6).
 *
 * Idempotency (Req 8.7 / Property 1): the unique `jobKey` on `sf_outbox` means a
 * logical write is enqueued at most once, so each row maps to at most one
 * Salesforce record regardless of how many times the drainer retries it.
 *
 * Rows still inside their backoff window are skipped this tick and picked up on
 * a later one; the next tick re-evaluates eligibility against the updated
 * `updatedAt`.
 *
 * @returns counts of rows transitioned to `sent` and `dead` in this batch.
 */
export async function drainOnce(
  db: Database,
  adapter: SalesforceAdapter
): Promise<{ sent: number; dead: number }> {
  // The Object_Router drives the first-class sObject client built from the same
  // adapter (it reuses the adapter's OAuth + retry transport via `requestJson`).
  const sf = new SalesforceObjectClient(adapter);

  const batch = await db
    .select()
    .from(sfOutbox)
    .where(eq(sfOutbox.status, "pending"))
    .orderBy(asc(sfOutbox.createdAt))
    .limit(DRAIN_BATCH_SIZE);

  const now = Date.now();
  let sent = 0;
  let dead = 0;

  for (const row of batch) {
    // Respect exponential backoff: skip rows whose next-retry time hasn't
    // elapsed yet (they stay `pending` and are retried on a later tick).
    if (!isEligible(row, now)) {
      continue;
    }

    try {
      const sfId = await pushToSalesforce(
        db,
        sf,
        row.kind,
        row.payload,
        row.sfId
      );

      await db
        .update(sfOutbox)
        .set({ status: "sent", sfId, lastError: null, updatedAt: new Date() })
        .where(eq(sfOutbox.id, row.id));

      await publishEvent(db, {
        type: "outbox.sent",
        payload: { id: row.id, kind: row.kind, sfId },
      });
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? "dead" : "pending";
      const lastError = err instanceof Error ? err.message : String(err);

      await db
        .update(sfOutbox)
        .set({ status, attempts, lastError, updatedAt: new Date() })
        .where(eq(sfOutbox.id, row.id));

      if (status === "dead") {
        await publishEvent(db, {
          type: "outbox.dead",
          payload: { id: row.id, kind: row.kind, attempts, lastError },
        });
        dead++;
      }
    }
  }

  return { sent, dead };
}
