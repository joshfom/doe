/**
 * CRM Sync Helper
 *
 * Orchestrates CRM synchronization for ticket events. Creates a crm_sync_log
 * record with status "pending" before the API call, updates to "success" or
 * "failed" based on the outcome, and updates the ticket's external_crm_id on
 * success.
 *
 * This function never throws — CRM sync failures are logged but do not block
 * ticket operations.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../../db";
import type { CrmCaseInput } from "./adapter";
import { getActiveAdapter } from "./registry";
import { crmSyncLog, tickets } from "../../schema";

/**
 * Sync a newly created ticket to the active CRM adapter.
 *
 * - If no adapter is configured, silently returns (no-op).
 * - Creates a crm_sync_log record with status "pending" before the API call.
 * - On success: updates the log to "success" with external_ref_id and
 *   completed_at, and sets the ticket's external_crm_id.
 * - On failure: updates the log to "failed" with error_message.
 * - Never throws — CRM sync failures should not block ticket operations.
 */
export async function syncTicketToCrm(
  db: Database,
  ticketId: string,
  action: "create_case" | "update_case",
  caseInput: CrmCaseInput,
  existingExternalId?: string | null
): Promise<void> {
  const adapter = getActiveAdapter();
  if (!adapter) {
    return; // No CRM configured — silently skip
  }

  // 1. Create a pending sync log record
  let logId: string;
  try {
    const [logRecord] = await db
      .insert(crmSyncLog)
      .values({
        ticketId,
        direction: "outbound",
        action,
        status: "pending",
        requestPayload: caseInput as unknown as Record<string, unknown>,
      })
      .returning();
    logId = logRecord.id;
  } catch {
    // If we can't even create the log record, bail silently
    return;
  }

  // 2. Call the CRM adapter
  try {
    let result;

    if (action === "create_case") {
      result = await adapter.createCase(caseInput);
    } else {
      // update_case — requires an existing external ID
      if (!existingExternalId) {
        throw new Error("Cannot update CRM case: no external CRM ID on ticket");
      }
      result = await adapter.updateCase(existingExternalId, caseInput);
    }

    // 3a. Success — update log and ticket
    await db
      .update(crmSyncLog)
      .set({
        status: "success",
        externalRefId: result.externalId,
        responsePayload: result as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(crmSyncLog.id, logId));

    // Update ticket's external_crm_id on create
    if (action === "create_case") {
      await db
        .update(tickets)
        .set({ externalCrmId: result.externalId })
        .where(eq(tickets.id, ticketId));
    }
  } catch (error) {
    // 3b. Failure — update log with error message
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    try {
      await db
        .update(crmSyncLog)
        .set({
          status: "failed",
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(crmSyncLog.id, logId));
    } catch {
      // If updating the log fails, swallow silently
    }
  }
}
