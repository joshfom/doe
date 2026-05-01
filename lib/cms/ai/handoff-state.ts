import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { aiConversations } from "../schema";

/**
 * Persistent per-conversation buffer stored in `aiConversations.handoffSummary`
 * (jsonb). Holds short-lived state the assistant needs to remember across
 * turns — pending confirmations, deferred queries, running summary, etc.
 *
 * Single jsonb column is used (rather than separate columns) to keep schema
 * migrations minimal and to make the buffer cheap to read/write atomically.
 */
export interface HandoffState {
  /** Personal question buffered while we ran the OTP gate. */
  pendingQuery?: string;
  /** A booking awaiting "yes/confirm" before we hit the database. */
  pendingBooking?: {
    appointmentType:
      | "site_visit"
      | "consultation"
      | "payment_discussion"
      | "maintenance_request";
    scheduledDate: string; // YYYY-MM-DD
    scheduledTime: string; // HH:MM
    contactName: string | null;
    contactEmail: string | null;
    contactPhone?: string | null;
    onBehalfOf?: {
      name?: string;
      email?: string;
      phone?: string;
      relationship?: string;
    };
    notes?: string;
  };
  /** A cancel awaiting "yes" confirmation. */
  pendingCancel?: {
    referenceNumber: string;
    scheduledDate: string;
    scheduledTime: string;
    appointmentType: string;
  };
  /** A reschedule awaiting new date/time + confirmation. */
  pendingReschedule?: {
    referenceNumber: string;
    fromDate: string;
    fromTime: string;
    newDate?: string;
    newTime?: string;
  };
  /** Short rolling summary of the conversation for admin panel + handover. */
  summary?: string;
  summaryUpdatedAt?: string;
}

export async function loadHandoffState(
  db: Database,
  conversationId: string
): Promise<HandoffState> {
  try {
    const [row] = await db
      .select({ s: aiConversations.handoffSummary })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);
    return (row?.s as HandoffState | null) ?? {};
  } catch {
    return {};
  }
}

export async function mergeHandoffState(
  db: Database,
  conversationId: string,
  patch: Partial<HandoffState>
): Promise<void> {
  const current = await loadHandoffState(db, conversationId);
  const next: HandoffState = { ...current, ...patch };
  // Strip undefined keys so we don't write {key: undefined} into jsonb
  for (const k of Object.keys(next) as (keyof HandoffState)[]) {
    if (next[k] === undefined) delete next[k];
  }
  await db
    .update(aiConversations)
    .set({ handoffSummary: next, updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId));
}

/**
 * Remove specific keys from the handoff state without clobbering the rest.
 * Used after a pending action is consumed (booking confirmed, OTP verified).
 */
export async function clearHandoffFields(
  db: Database,
  conversationId: string,
  keys: Array<keyof HandoffState>
): Promise<void> {
  const current = await loadHandoffState(db, conversationId);
  for (const k of keys) delete current[k];
  await db
    .update(aiConversations)
    .set({ handoffSummary: current, updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId));
}
