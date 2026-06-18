// lib/cms/agents/embedder.ts
//
// cfEmbedder — a thin AI SDK v5 EmbeddingModel that routes Agent_Memory's
// semantic-recall embeddings through the EXISTING Cloudflare AI Gateway
// transport (`generateEmbedding` in lib/cms/ai/gateway.ts). Mastra's Memory
// (PgStore + PgVector) consumes this embedder so vector recall reuses the same
// 768-dim BGE model already used by `knowledgeEmbeddings`, rather than wiring a
// second embedding transport.
//
// Design §Components #3 (Agent memory): "embedder reusing gateway.ts"; the
// cfEmbedder is "a thin EmbeddingModel over gateway.ts generateEmbedding
// (768-dim BGE)". Requirement 4.1 (durable memory store), 5.1 (all model calls
// route through the CF AI Gateway).
//
// [container-only] Consumed by the Mastra runtime, which runs on the
// container/worker tier only, never on Next.js serverless (Requirement 15.3).

import type { EmbeddingModelV2 } from "@ai-sdk/provider-v5";
import { generateEmbedding } from "../ai/gateway";

/**
 * Dimensionality of the Cloudflare BGE embedding model
 * (`@cf/baai/bge-base-en-v1.5`). Recorded here for documentation and for the
 * PgVector index that Agent_Memory creates from this embedder.
 */
export const EMBEDDING_DIMENSIONS = 768;

/** The concrete embedding model string, mirroring lib/cms/ai/gateway.ts. */
const EMBEDDING_MODEL_ID =
  process.env.CF_EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5";

/**
 * An AI SDK v5 `EmbeddingModelV2<string>` whose `doEmbed` delegates to the CF
 * AI Gateway via `generateEmbedding`. The gateway's OpenAI-compatible
 * `/embeddings` endpoint embeds one input per request, so `maxEmbeddingsPerCall`
 * is 1; Mastra batches accordingly. `doEmbed` still maps over `values` so it is
 * correct for any batch size the framework may pass.
 *
 * Embeddings are returned in the same order as the input `values`, as required
 * by the embedding-model contract.
 */
export const cfEmbedder: EmbeddingModelV2<string> = {
  specificationVersion: "v2",
  provider: "cf",
  modelId: EMBEDDING_MODEL_ID,
  // The CF gateway embeds a single `input` string per call (see gateway.ts).
  maxEmbeddingsPerCall: 1,
  supportsParallelCalls: true,
  async doEmbed({ values }) {
    const embeddings = await Promise.all(
      values.map((value) => generateEmbedding(value))
    );
    return { embeddings };
  },
};
