import type { Database } from "../db";
import { crmSyncLog } from "../schema";

/**
 * One CRM synchronization attempt to record in the Sync_Ledger (`crm_sync_log`).
 *
 * `direction` distinguishes a DOE→Salesforce write (`outbound`) from a
 * Salesforce→DOE read (`inbound`). The CALLERS decide WHEN to record an entry:
 * an `outbound` entry on every write attempt (Req 8.1) and an `inbound` entry on
 * every read attempt (Req 8.2). `recordSync` itself just persists exactly one
 * row per call with the supplied direction/action/status.
 *
 * `ticketId` is optional: lead/inbound entries are not tied to a ticket
 * (the column is nullable). `externalRefId` carries the Salesforce record id
 * when it is known, and is left empty (NULL) otherwise — never a placeholder
 * id (Req 8.3, 8.4).
 */
export interface SyncEntry {
  /** Optional originating ticket. Omitted for lead/inbound entries. */
  ticketId?: string;
  /** DOE→SF write (`outbound`) or SF→DOE read (`inbound`). */
  direction: "outbound" | "inbound";
  /** The attempted SF_Object action, e.g. "lead", "task", "event". */
  action: string;
  /** `success` when Salesforce accepted / returned data, else `failed`. */
  status: "success" | "failed";
  /** Salesforce record id when known; omit when unknown (stored as NULL). */
  externalRefId?: string;
  /** Optional human-readable error detail for a `failed` entry. */
  errorMessage?: string;
}

/**
 * Record exactly one Sync_Ledger entry for a synchronization attempt.
 *
 * Best-effort: a ledger write failure (FK violation, transient DB error, etc.)
 * MUST NOT abort, roll back, or alter the calling business operation or the
 * Salesforce synchronization — it is logged and swallowed (Req 8.6).
 */
export async function recordSync(db: Database, entry: SyncEntry): Promise<void> {
  try {
    await db.insert(crmSyncLog).values({
      ticketId: entry.ticketId ?? null,
      direction: entry.direction,
      action: entry.action,
      status: entry.status,
      // SF id when known; NULL otherwise — never a placeholder id (Req 8.3, 8.4).
      externalRefId: entry.externalRefId ?? null,
      errorMessage: entry.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[crm-sync-ledger] recordSync insert failed (non-fatal)", {
      direction: entry.direction,
      action: entry.action,
      status: entry.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
