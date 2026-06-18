import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { aiConversations, aiMessages, leadsMirror } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import { enqueueOutbox } from "@/lib/cms/outbox";
import { generateCompletion, type ChatMessage } from "@/lib/cms/ai/gateway";
import type { JobContext, JobHandler } from "./index";

// ── post_call_processing (W4) — Design §8.4; Requirements 9.4 ─────────────────
//
// When a call ends, the agent enqueues `post_call_processing` keyed
// `conv:{conversationId}` (Req 4.11). This handler:
//   1. pulls the conversation turns from `aiMessages`,
//   2. produces a summary, facts diff, sentiment, and next-best-action (via the
//      AI gateway, abstracted behind {@link PostCallSummarizer} so it is
//      testable without a network call),
//   3. persists the summary + sentiment on `aiConversations`,
//   4. updates the lead mirror fields (`leadsMirror`) from the facts diff,
//   5. enqueues a Salesforce task (call log + summary) and lead field updates to
//      the Salesforce outbox via `enqueueOutbox`, and
//   6. publishes a privacy-safe `call.processed` event.
//
// CONTAINER-ONLY: runs on the job-runner worker tier (Req 12.6).
//
// Idempotency (Property 7 / Req 9.3): the job spine (`runJob`) guarantees
// at-most-once execution per `jobKey`. The outbox enqueues additionally use
// deterministic, conversation-scoped `jobKey`s (`task:conv:{id}`,
// `lead:conv:{id}`) so even a manual re-run of a `failed` job never produces a
// duplicate Salesforce record (`sf_outbox.job_key` is unique).

/** Payload carried on a `post_call_processing` job. */
export interface PostCallProcessingPayload {
  /** The `aiConversations` row id for the ended call. */
  conversationId: string;
  /** The resolved party, when known (mirrors `JobContext.partyId`). */
  partyId?: string | null;
}

/** A single conversation turn handed to the summarizer. */
export interface PostCallTurn {
  role: string;
  content: string;
}

/**
 * Lead facts that may have changed over the call. Only the fields the summarizer
 * is confident about are present; absent fields leave the mirror untouched.
 */
export interface LeadFactsDiff {
  tier?: "HOT" | "WARM" | "NURTURE";
  stage?: string;
  projectInterest?: string;
  unitInterest?: string;
  budgetBand?: string;
  scoreReason?: string;
}

/** Structured result of analysing a call transcript. */
export interface PostCallAnalysis {
  /** Short natural-language recap of the call. */
  summary: string;
  /** Coarse caller sentiment (e.g. "positive" | "neutral" | "negative"). */
  sentiment: string;
  /** Changed lead facts to apply to the mirror. */
  factsDiff: LeadFactsDiff;
  /** Recommended next action for the assigned rep. */
  nextBestAction: string;
}

/**
 * Abstraction over the LLM summarization step so the handler is testable without
 * a live AI gateway call. The default implementation
 * ({@link defaultPostCallSummarizer}) routes through the existing gateway.
 */
export type PostCallSummarizer = (
  turns: PostCallTurn[],
  opts: { language: string }
) => Promise<PostCallAnalysis>;

const TIERS = new Set(["HOT", "WARM", "NURTURE"]);

/** Coerce free-form gateway JSON into a safe {@link PostCallAnalysis}. */
function coerceAnalysis(raw: unknown): PostCallAnalysis {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const diffRaw = (o.factsDiff ?? {}) as Record<string, unknown>;
  const tier = str(diffRaw.tier)?.toUpperCase();

  const factsDiff: LeadFactsDiff = {};
  if (tier && TIERS.has(tier)) {
    factsDiff.tier = tier as LeadFactsDiff["tier"];
  }
  if (str(diffRaw.stage)) factsDiff.stage = str(diffRaw.stage);
  if (str(diffRaw.projectInterest))
    factsDiff.projectInterest = str(diffRaw.projectInterest);
  if (str(diffRaw.unitInterest))
    factsDiff.unitInterest = str(diffRaw.unitInterest);
  if (str(diffRaw.budgetBand)) factsDiff.budgetBand = str(diffRaw.budgetBand);
  if (str(diffRaw.scoreReason))
    factsDiff.scoreReason = str(diffRaw.scoreReason);

  return {
    summary: str(o.summary) ?? "",
    sentiment: str(o.sentiment) ?? "neutral",
    factsDiff,
    nextBestAction: str(o.nextBestAction) ?? "Follow up with the lead.",
  };
}

const SUMMARY_SYSTEM_PROMPT = [
  "You are a CRM analyst summarising a real-estate sales call between a caller",
  "and the DOE voice agent. Read the transcript and return STRICT JSON only,",
  "with no prose and no code fences, matching exactly this shape:",
  "{",
  '  "summary": string,            // 2-3 sentence recap of the call',
  '  "sentiment": "positive" | "neutral" | "negative",',
  '  "factsDiff": {                // ONLY include fields you are confident about',
  '    "tier"?: "HOT" | "WARM" | "NURTURE",',
  '    "stage"?: string,',
  '    "projectInterest"?: string,',
  '    "unitInterest"?: string,',
  '    "budgetBand"?: string,',
  '    "scoreReason"?: string',
  "  },",
  '  "nextBestAction": string      // one concrete next step for the rep',
  "}",
].join("\n");

/**
 * Default summarizer: routes the transcript through the existing AI gateway and
 * parses the structured JSON result. Robust to non-JSON / fenced responses; on a
 * parse failure it falls back to a minimal, safe analysis rather than throwing,
 * so a flaky model never dead-letters the job.
 */
export const defaultPostCallSummarizer: PostCallSummarizer = async (
  turns,
  opts
) => {
  const transcript = turns
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Call language: ${opts.language}\n\nTranscript:\n${transcript}`,
    },
  ];

  const completion = await generateCompletion(messages, {
    temperature: 0.2,
    maxTokens: 500,
  });

  try {
    // Tolerate code fences / surrounding prose by extracting the first JSON object.
    const start = completion.indexOf("{");
    const end = completion.lastIndexOf("}");
    const json =
      start >= 0 && end > start ? completion.slice(start, end + 1) : completion;
    return coerceAnalysis(JSON.parse(json));
  } catch {
    return coerceAnalysis({ summary: completion.trim() });
  }
};

function parsePayload(payload: unknown): PostCallProcessingPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const conversationId =
    typeof p.conversationId === "string" ? p.conversationId : undefined;
  if (!conversationId) {
    throw new Error(
      "post_call_processing: payload.conversationId is required"
    );
  }
  const partyId =
    typeof p.partyId === "string" ? p.partyId : undefined;
  return { conversationId, partyId };
}

/**
 * Build a {@link JobHandler} for `post_call_processing`, injecting the
 * summarizer (defaults to the live gateway implementation). Tests pass a fake
 * summarizer to run the full persistence + outbox + event flow offline.
 */
export function createPostCallProcessingHandler(
  summarize: PostCallSummarizer = defaultPostCallSummarizer
): JobHandler {
  return async (db: Database, payload: unknown, ctx: JobContext) => {
    const { conversationId, partyId: payloadPartyId } = parsePayload(payload);

    // 1) Load the conversation (language + the party link) and its turns.
    const [conversation] = await db
      .select({
        language: aiConversations.language,
        partyId: aiConversations.partyId,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      throw new Error(
        `post_call_processing: conversation ${conversationId} not found`
      );
    }

    const partyId = ctx.partyId ?? payloadPartyId ?? conversation.partyId ?? null;

    const turnRows = await db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.tMs), asc(aiMessages.createdAt));

    const turns: PostCallTurn[] = turnRows.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    // 2) Summary + facts diff + sentiment + next-best-action.
    const analysis = await summarize(turns, {
      language: conversation.language ?? "en",
    });

    // 3) Persist the summary + sentiment on the conversation.
    await db
      .update(aiConversations)
      .set({
        summary: analysis.summary,
        sentiment: analysis.sentiment,
        updatedAt: new Date(),
      })
      .where(eq(aiConversations.id, conversationId));

    // 4) Update the lead mirror from the facts diff (when the caller is known).
    if (partyId) {
      const mirrorUpdate: Partial<typeof leadsMirror.$inferInsert> = {
        lastInteractionAt: new Date(),
        lastInteractionSummary: analysis.summary,
        updatedAt: new Date(),
      };
      const { factsDiff } = analysis;
      if (factsDiff.tier) mirrorUpdate.tier = factsDiff.tier;
      if (factsDiff.stage) mirrorUpdate.stage = factsDiff.stage;
      if (factsDiff.projectInterest)
        mirrorUpdate.projectInterest = factsDiff.projectInterest;
      if (factsDiff.unitInterest)
        mirrorUpdate.unitInterest = factsDiff.unitInterest;
      if (factsDiff.budgetBand) mirrorUpdate.budgetBand = factsDiff.budgetBand;
      if (factsDiff.scoreReason)
        mirrorUpdate.scoreReason = factsDiff.scoreReason;

      // Upsert: known callers already have a mirror row (seeded / created on
      // qualification); fall back to insert for a first-touch lead.
      await db
        .insert(leadsMirror)
        .values({ partyId, ...mirrorUpdate })
        .onConflictDoUpdate({ target: leadsMirror.partyId, set: mirrorUpdate });
    }

    // 5) Enqueue the Salesforce task (call log + summary) and the lead field
    //    updates. Deterministic, conversation-scoped jobKeys keep these
    //    idempotent across re-runs (sf_outbox.job_key is unique — Req 8.2 / P1).
    await enqueueOutbox(
      db,
      "task",
      {
        subject: `Call summary — ${conversationId}`,
        description: analysis.summary,
        nextBestAction: analysis.nextBestAction,
        sentiment: analysis.sentiment,
        partyId,
        conversationId,
      },
      `task:conv:${conversationId}`
    );

    await enqueueOutbox(
      db,
      "lead_upsert",
      {
        partyId,
        conversationId,
        ...analysis.factsDiff,
        lastInteractionSummary: analysis.summary,
      },
      `lead:conv:${conversationId}`
    );

    // 6) Publish a privacy-safe `call.processed` event (no raw phone — P9).
    await publishEvent(db, {
      type: "call.processed",
      payload: {
        conversationId,
        partyId,
        sentiment: analysis.sentiment,
        tier: analysis.factsDiff.tier ?? null,
        nextBestAction: analysis.nextBestAction,
      },
    });
  };
}

/** Default handler instance wired to the live gateway summarizer. */
export const postCallProcessingHandler: JobHandler =
  createPostCallProcessingHandler();
