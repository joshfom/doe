// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** When true, route to the premium model (CF_CHAT_MODEL_PREMIUM) for high-stakes turns. */
  premium?: boolean;
}

// ── Environment helpers ──────────────────────────────────────────────────────

const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.6;
const DEFAULT_MAX_TOKENS = 600;

function getGatewayUrl(): string {
  const url = process.env.CF_AI_GATEWAY_URL;
  if (!url) {
    throw new Error(
      "CF_AI_GATEWAY_URL environment variable is not set. " +
        "Please configure the Cloudflare AI Gateway URL."
    );
  }
  return url.replace(/\/+$/, "");
}

function getApiToken(): string {
  const token = process.env.CF_AI_API_TOKEN;
  if (!token) {
    throw new Error(
      "CF_AI_API_TOKEN environment variable is not set. " +
        "Please configure the Cloudflare AI API token."
    );
  }
  return token;
}

function getEmbeddingModel(): string {
  return process.env.CF_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

function getChatModel(premium = false): string {
  if (premium && process.env.CF_CHAT_MODEL_PREMIUM) {
    return process.env.CF_CHAT_MODEL_PREMIUM;
  }
  return process.env.CF_CHAT_MODEL || DEFAULT_CHAT_MODEL;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ── generateEmbedding ────────────────────────────────────────────────────────

/**
 * Generates a 768-dimension embedding vector for the given text using the
 * Cloudflare AI Gateway embedding endpoint.
 *
 * Uses the OpenAI-compatible API format:
 *   POST {gateway}/embeddings
 *   { model, input }
 *
 * @throws Error if the gateway URL or API token is not configured
 * @throws Error if the API request fails or returns an unexpected response
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const gatewayUrl = getGatewayUrl();
  const token = getApiToken();
  const model = getEmbeddingModel();

  const response = await fetch(`${gatewayUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Cloudflare AI Gateway embedding request failed (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();

  // OpenAI-compatible response: { data: [{ embedding: number[] }] }
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(
      "Cloudflare AI Gateway returned an unexpected embedding response format. " +
        "Expected { data: [{ embedding: number[] }] }."
    );
  }

  return embedding;
}

// ── generateCompletion ───────────────────────────────────────────────────────

/**
 * Generates a chat completion using the Cloudflare AI Gateway chat endpoint.
 *
 * Uses the OpenAI-compatible API format:
 *   POST {gateway}/chat/completions
 *   { model, messages, temperature?, max_tokens? }
 *
 * @throws Error if the gateway URL or API token is not configured
 * @throws Error if the API request fails or returns an unexpected response
 */
export async function generateCompletion(
  messages: ChatMessage[],
  options?: CompletionOptions
): Promise<string> {
  const gatewayUrl = getGatewayUrl();
  const token = getApiToken();
  const model = getChatModel(options?.premium === true);

  const temperature =
    options?.temperature ?? envNumber("ORA_AI_TEMPERATURE", DEFAULT_TEMPERATURE);
  const maxTokens =
    options?.maxTokens ?? envNumber("ORA_AI_MAX_TOKENS", DEFAULT_MAX_TOKENS);

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const response = await fetch(`${gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Cloudflare AI Gateway chat completion request failed (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();

  // OpenAI-compatible response: { choices: [{ message: { content: string } }] }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      "Cloudflare AI Gateway returned an unexpected chat completion response format. " +
        "Expected { choices: [{ message: { content: string } }] }."
    );
  }

  return content;
}

// ── Native tool-calling (voice path) ─────────────────────────────────────────
//
// The TEXT path uses deterministic intent dispatch and never touches these
// helpers (see docs/ai-tool-calling-pattern.md). The VOICE orchestrator
// (lib/cms/voice/orchestrator.ts) uses NATIVE LLM tool-calling against the typed
// tool registry. Native tool-calling requires an OpenAI-family, tool-capable
// model routed through the gateway (the `@cf/...` Workers AI models have
// inconsistent tool support) — point CF_CHAT_MODEL / CF_CHAT_MODEL_PREMIUM at a
// tool-capable model for the voice fast tier. These additions are purely
// additive: `generateCompletion`/`generateEmbedding` are unchanged.

/** A tool the model may call, described in OpenAI-compatible function form. */
export interface ToolDefinitionSpec {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments (e.g. `z.toJSONSchema(inputSchema)`). */
  parameters: Record<string, unknown>;
}

/** A single tool call requested by the model in one assistant step. */
export interface ToolFunctionCall {
  /** Provider-assigned id; echoed back on the matching `tool` result message. */
  id: string;
  /** The tool name the model wants to invoke. */
  name: string;
  /** Raw JSON arguments string exactly as emitted by the model. */
  arguments: string;
}

/**
 * A chat message that can also represent the tool-calling turns:
 *   • an assistant message that requested one or more tools (`toolCalls`), and
 *   • a `tool` result message carrying a `toolCallId` back to the model.
 */
export interface ToolChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Present on assistant turns that requested tools. */
  toolCalls?: ToolFunctionCall[];
  /** Present on `tool` result messages — the id of the call being answered. */
  toolCallId?: string;
}

/** One tool-calling step's result: either spoken content, tool calls, or both. */
export interface ToolCallCompletion {
  /** Natural-language content for TTS; may be null when only tools were called. */
  content: string | null;
  /** Tool calls the model requested this step (empty when it produced content). */
  toolCalls: ToolFunctionCall[];
}

/** Map our `ToolChatMessage` to the OpenAI-compatible wire shape. */
function toWireMessage(m: ToolChatMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId,
      content: m.content ?? "",
    };
  }
  return { role: m.role, content: m.content };
}

/**
 * One native tool-calling step against the gateway's OpenAI-compatible
 * `/chat/completions` endpoint with a `tools` array and `tool_choice: "auto"`.
 *
 * Returns the model's spoken `content` and/or the `toolCalls` it requested this
 * step. The caller (the voice orchestrator) runs the tools, appends their
 * results as `tool` messages, and calls this again until the model returns
 * content with no further tool calls.
 *
 * @throws Error if the gateway URL or API token is not configured, or the
 * request fails / returns an unexpected response.
 */
export async function generateToolCallCompletion(
  messages: ToolChatMessage[],
  tools: ToolDefinitionSpec[],
  options?: CompletionOptions
): Promise<ToolCallCompletion> {
  const gatewayUrl = getGatewayUrl();
  const token = getApiToken();
  const model = getChatModel(options?.premium === true);

  const temperature =
    options?.temperature ?? envNumber("ORA_AI_TEMPERATURE", DEFAULT_TEMPERATURE);
  const maxTokens =
    options?.maxTokens ?? envNumber("ORA_AI_MAX_TOKENS", DEFAULT_MAX_TOKENS);

  const body: Record<string, unknown> = {
    model,
    messages: messages.map(toWireMessage),
    temperature,
    max_tokens: maxTokens,
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = "auto";
  }

  const response = await fetch(`${gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Cloudflare AI Gateway tool-call completion request failed (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();

  // OpenAI-compatible response:
  //   { choices: [{ message: { content: string | null, tool_calls?: [...] } }] }
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== "object") {
    throw new Error(
      "Cloudflare AI Gateway returned an unexpected tool-call response format. " +
        "Expected { choices: [{ message: { ... } }] }."
    );
  }

  const rawToolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : [];
  const toolCalls: ToolFunctionCall[] = rawToolCalls.map(
    (tc: Record<string, unknown>, i: number) => {
      const fn = (tc.function ?? {}) as Record<string, unknown>;
      return {
        id: typeof tc.id === "string" ? tc.id : `call_${i}`,
        name: typeof fn.name === "string" ? fn.name : "",
        arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
      };
    }
  );

  const content =
    typeof message.content === "string" ? message.content : null;

  return { content, toolCalls };
}
