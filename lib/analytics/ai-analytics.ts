/**
 * AI Analytics Wrapper
 *
 * Wraps LLM calls (generateCompletion) with PostHog AI analytics tracking.
 * Captures token usage, latency, and conversation context as $ai_generation
 * events via posthog-node. Falls back to the raw gateway call if tracking fails.
 *
 * Uses the manual capture approach recommended by PostHog for custom gateways
 * (Cloudflare AI Gateway with raw fetch), capturing $ai_generation events
 * with standard PostHog AI properties.
 */
import { getPostHogServer } from "./posthog-server";
import {
  generateCompletion,
  type ChatMessage,
  type CompletionOptions,
} from "../cms/ai/gateway";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AIAnalyticsContext {
  /** PostHog distinct ID for the visitor/user */
  distinctId: string;
  /** Trace ID grouping related AI events (typically conversationId) */
  traceId: string;
  /** Conversation ID for session grouping */
  conversationId: string;
  /** Page context: project identifier */
  projectId?: string;
  /** Page context: unit type */
  unitType?: string;
}

// ── Wrapper ──────────────────────────────────────────────────────────────────

/**
 * Wraps `generateCompletion()` with PostHog AI analytics tracking.
 * Captures token usage and latency as a `$ai_generation` event.
 *
 * If the wrapper or PostHog capture fails for any reason, the error is logged
 * and the function falls through to the raw gateway call — the conversation
 * is never interrupted by analytics failures.
 */
export async function generateCompletionWithAnalytics(
  messages: ChatMessage[],
  context: AIAnalyticsContext,
  options?: CompletionOptions
): Promise<string> {
  let startTime: number;

  try {
    startTime = Date.now();
  } catch {
    // Extremely unlikely, but if even Date.now() fails, fall through
    return generateCompletion(messages, options);
  }

  let response: string;
  try {
    response = await generateCompletion(messages, options);
  } catch (err) {
    // LLM call itself failed — re-throw so the caller handles it.
    // Do NOT swallow gateway errors.
    throw err;
  }

  // Capture analytics — best-effort, never interrupts the conversation
  try {
    captureAIGeneration(messages, response, context, options, startTime);
  } catch (err) {
    console.error("[ai-analytics] Failed to capture AI generation event:", err);
  }

  return response;
}

// ── Internal capture ─────────────────────────────────────────────────────────

function captureAIGeneration(
  messages: ChatMessage[],
  response: string,
  context: AIAnalyticsContext,
  options: CompletionOptions | undefined,
  startTime: number
): void {
  const posthog = getPostHogServer();
  if (!posthog) return;

  const latencyMs = Date.now() - startTime;
  const latencySeconds = latencyMs / 1000;

  // Determine model from env (mirrors gateway.ts logic)
  const model =
    options?.premium && process.env.CF_CHAT_MODEL_PREMIUM
      ? process.env.CF_CHAT_MODEL_PREMIUM
      : process.env.CF_CHAT_MODEL || "openai/gpt-4o-mini";

  // Format input messages for PostHog
  const aiInput = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Format output for PostHog
  const aiOutputChoices = [
    { role: "assistant" as const, content: response },
  ];

  // Estimate token counts from character length (rough approximation:
  // ~4 chars per token for English text). The gateway response may include
  // actual usage data, but since we use raw fetch we estimate here.
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const outputChars = response.length;
  const estimatedInputTokens = Math.ceil(inputChars / 4);
  const estimatedOutputTokens = Math.ceil(outputChars / 4);

  posthog.capture({
    distinctId: context.distinctId,
    event: "$ai_generation",
    properties: {
      $ai_trace_id: context.traceId,
      $ai_session_id: context.conversationId,
      $ai_model: model,
      $ai_provider: "cloudflare",
      $ai_input: aiInput,
      $ai_output_choices: aiOutputChoices,
      $ai_input_tokens: estimatedInputTokens,
      $ai_output_tokens: estimatedOutputTokens,
      $ai_latency: latencySeconds,
      $ai_base_url: process.env.CF_AI_GATEWAY_URL || undefined,
      // Custom properties for page context
      project_id: context.projectId || undefined,
      unit_type: context.unitType || undefined,
      conversation_id: context.conversationId,
    },
  });
}
