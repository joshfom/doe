import { eq, desc } from "drizzle-orm";
import type { Database } from "../db";
import { aiConversations, aiMessages } from "../schema";
import { getPostHogServer } from "@/lib/analytics/posthog-server";
import { hashIdentifier } from "@/lib/analytics/hash-identifier";
import type { AttributionData } from "@/lib/analytics/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  role: string;
  content: string;
}

// ── Handoff Detection ────────────────────────────────────────────────────────

const HANDOFF_PHRASES = [
  "speak to human",
  "talk to agent",
  "human agent",
  "real person",
];

/**
 * Computes word overlap ratio between two strings.
 * Returns a value between 0 and 1 representing the fraction of words shared
 * relative to the smaller set.
 */
function wordOverlap(a: string, b: string): number {
  const tokensA = a.toLowerCase().split(/\s+/).filter(Boolean);
  const tokensB = b.toLowerCase().split(/\s+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  let shared = 0;
  const uniqueA = new Set(tokensA);
  uniqueA.forEach((word) => {
    if (setB.has(word)) shared++;
  });

  const minSize = Math.min(uniqueA.size, setB.size);
  return shared / minSize;
}

/**
 * Detects whether a human handoff is needed based on message history.
 *
 * Returns true when:
 * - Any user message contains an explicit handoff request phrase
 * - 2+ consecutive user messages are similar (word overlap > 60%),
 *   indicating repeated queries on the same topic
 */
export function detectHandoffNeed(messages: Message[]): boolean {
  // Extract user messages
  const userMessages = messages.filter((m) => m.role === "user");

  // Check for explicit handoff requests in any user message
  for (const msg of userMessages) {
    const lower = msg.content.toLowerCase();
    if (HANDOFF_PHRASES.some((phrase) => lower.includes(phrase))) {
      return true;
    }
  }

  // Check last 4 user messages for repeated similar queries
  const recentUserMessages = userMessages.slice(-4);

  for (let i = 1; i < recentUserMessages.length; i++) {
    const overlap = wordOverlap(
      recentUserMessages[i - 1].content,
      recentUserMessages[i].content
    );
    if (overlap > 0.6) {
      return true;
    }
  }

  return false;
}

// ── Handoff Initiation ───────────────────────────────────────────────────────

/**
 * Initiates a human handoff for a conversation.
 *
 * 1. Loads the last 10 messages to build a handoff summary
 * 2. Updates the conversation status to "handed_off" with a summary
 * 3. Inserts a system message notifying the user of the transfer
 * 4. Captures `ai_handoff_to_human` event in PostHog
 */
export async function initiateHandoff(
  db: Database,
  conversationId: string,
  reason: string,
  options?: {
    traceId?: string;
    intent?: string;
    distinctId?: string;
    attribution?: AttributionData | null;
  }
): Promise<void> {
  // Load recent messages to build the handoff summary
  const recentMessages = await db
    .select({
      role: aiMessages.role,
      content: aiMessages.content,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt))
    .limit(10);

  // Reverse to chronological order
  const chronological = recentMessages.reverse();

  // Extract the original user query (first user message)
  const originalQuery =
    chronological.find((m) => m.role === "user")?.content ?? "";

  // Extract attempted assistant responses
  const attemptedResponses = chronological
    .filter((m) => m.role === "assistant")
    .map((m) => m.content);

  // Build handoff summary
  const handoffSummary = {
    originalQuery,
    attemptedResponses,
    reason,
    handoffAt: new Date().toISOString(),
  };

  // Update conversation status and store handoff summary
  await db
    .update(aiConversations)
    .set({
      status: "handed_off",
      handoffSummary,
      updatedAt: new Date(),
    })
    .where(eq(aiConversations.id, conversationId));

  // Insert system message notifying the user
  await db.insert(aiMessages).values({
    conversationId,
    role: "system",
    content:
      "This conversation has been transferred to a human agent. Someone from our team will follow up with you shortly.",
  });

  // Task 19.2: Capture ai_handoff_to_human event
  try {
    const posthog = getPostHogServer();
    if (posthog) {
      const messageCount = recentMessages.length;
      const attribution = options?.attribution;
      posthog.capture({
        distinctId: options?.distinctId ? hashIdentifier(options.distinctId) : conversationId,
        event: "ai_handoff_to_human",
        properties: {
          conversationId,
          ...(options?.traceId && { traceId: options.traceId }),
          messageCount,
          ...(options?.intent && { intent: options.intent }),
          reason,
          ...(attribution?.first_touch && {
            first_touch_source: attribution.first_touch.utm_source,
            first_touch_medium: attribution.first_touch.utm_medium,
            first_touch_campaign: attribution.first_touch.utm_campaign,
          }),
          ...(attribution?.last_touch && {
            last_touch_source: attribution.last_touch.utm_source,
            last_touch_medium: attribution.last_touch.utm_medium,
            last_touch_campaign: attribution.last_touch.utm_campaign,
          }),
          ...(attribution?.last_touch?.utm_campaign && {
            utm_campaign: attribution.last_touch.utm_campaign,
          }),
        },
      });
    }
  } catch (err) {
    console.error("[handoff] ai_handoff_to_human capture failed", err);
  }
}
