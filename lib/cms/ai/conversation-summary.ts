import type { Database } from "../db";
import { mergeHandoffState } from "./handoff-state";

interface SummaryInput {
  conversationId: string;
  identityType: "client" | "tenant" | "visitor";
  identityName?: string;
  contactEmail?: string;
  contactPhone?: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
  intent?: string;
  actionPerformed?: string;
  referenceNumber?: string;
  ticketNumber?: string;
}

/**
 * Build a short, deterministic 1–2 line summary of where the conversation is.
 * Stored in `aiConversations.handoffSummary.summary` so the admin panel and
 * any human teammate picking up the conversation can read it at a glance.
 *
 * Deterministic on purpose: cheap, predictable, no LLM call needed for the
 * demo, and we keep accuracy on factual fields (intents, ticket numbers).
 */
export function composeSummary(input: SummaryInput): string {
  const who =
    input.identityType === "visitor"
      ? input.identityName
        ? `Visitor (${input.identityName})`
        : "Anonymous visitor"
      : input.identityName
        ? `${input.identityType[0].toUpperCase()}${input.identityType.slice(1)} ${input.identityName}`
        : `${input.identityType[0].toUpperCase()}${input.identityType.slice(1)}`;

  const action = input.actionPerformed ?? input.intent;
  const actionLabel = action
    ? action
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "General chat";

  const refs: string[] = [];
  if (input.ticketNumber) refs.push(`ticket ${input.ticketNumber}`);
  if (input.referenceNumber) refs.push(input.referenceNumber);
  const refSuffix = refs.length > 0 ? ` — ${refs.join(", ")}` : "";

  // Trim user message to 120 chars to keep the summary one-line-ish
  const ask =
    input.lastUserMessage.length > 120
      ? input.lastUserMessage.slice(0, 117) + "…"
      : input.lastUserMessage;

  return `${who} · ${actionLabel}${refSuffix} · "${ask}"`;
}

export async function writeConversationSummary(
  db: Database,
  input: SummaryInput
): Promise<void> {
  const summary = composeSummary(input);
  try {
    await mergeHandoffState(db, input.conversationId, {
      summary,
      summaryUpdatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[summary] writeConversationSummary failed", err);
  }
}
