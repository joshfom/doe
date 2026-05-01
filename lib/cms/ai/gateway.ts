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
