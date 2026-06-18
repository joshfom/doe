// lib/cms/agents/gateway.ts
//
// DoeModelGateway — the adapter/shim that routes every Mastra model call through
// the EXISTING Cloudflare AI Gateway transport (see lib/cms/ai/gateway.ts), so
// Mastra does NOT get its own model transport; it borrows ours. This satisfies
// Requirement 5.1 (all agent/tool model calls route through the CF AI Gateway)
// and Requirement 5.2 (at least two Model_Tiers, each mapped to a concrete CF AI
// Gateway model string).
//
// [container-only] The Mastra runtime that consumes this gateway runs on the
// container/worker tier, never on Next.js serverless (Requirement 15.3).
//
// Native tool-calling requires an OpenAI-family, tool-capable model routed
// through the gateway — the `@cf/...` Workers AI models have inconsistent tool
// support (see docs/ai-tool-calling-pattern.md). Both tier env vars MUST point
// at tool-capable models.

import {
  MastraModelGateway,
  type ProviderConfig,
} from "@mastra/core/llm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible-v5";
import type { LanguageModelV2 } from "@ai-sdk/provider-v5";

/**
 * The two named Model_Tiers, each mapped to a concrete CF AI Gateway model
 * string (Requirement 5.2). Reuses the same env vars as lib/cms/ai/gateway.ts
 * (CF_CHAT_MODEL / CF_CHAT_MODEL_PREMIUM) so the agentic path and the existing
 * deterministic/voice paths share one model configuration.
 *
 *  - fast:    cheap, low-latency model for multi-step agent loops
 *  - premium: higher-capability model for high-stakes turns
 */
export const MODEL_TIERS = {
  fast: process.env.CF_CHAT_MODEL ?? "openai/gpt-4o-mini",
  premium: process.env.CF_CHAT_MODEL_PREMIUM ?? "openai/gpt-4.1",
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;

/** The provider id used to namespace this gateway's models (e.g. "doe/cf/..."). */
const PROVIDER_ID = "cf";

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

/**
 * Routes Mastra model calls through the existing Cloudflare AI Gateway.
 *
 * Mastra's model router resolves a `model` string ("doe/cf/<modelId>") through a
 * registered gateway. `DoeModelGateway.resolveLanguageModel` builds an
 * OpenAI-compatible client pointed at CF_AI_GATEWAY_URL authenticated with
 * CF_AI_API_TOKEN — the same transport coordinates as lib/cms/ai/gateway.ts.
 */
export class DoeModelGateway extends MastraModelGateway {
  readonly id = "doe";
  readonly name = "DOE Cloudflare AI Gateway";

  /**
   * Advertise the single Cloudflare provider and the concrete tool-capable model
   * strings backing the two tiers (Requirement 5.2). The model list is derived
   * from MODEL_TIERS so adding/retiring a tier updates the advertised models in
   * one place.
   */
  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      [PROVIDER_ID]: {
        name: "Cloudflare AI Gateway",
        models: [...new Set(Object.values(MODEL_TIERS))],
        apiKeyEnvVar: "CF_AI_API_TOKEN",
        gateway: this.id,
        url: getGatewayUrl(),
      },
    };
  }

  /** The OpenAI-compatible base URL for every model this gateway resolves. */
  buildUrl(): string {
    return getGatewayUrl();
  }

  /** The bearer token used to authenticate against the CF AI Gateway. */
  async getApiKey(): Promise<string> {
    return process.env.CF_AI_API_TOKEN ?? "";
  }

  /**
   * Build an OpenAI-compatible language model bound to the CF AI Gateway. This is
   * the single seam through which every Mastra agent/tool model call is
   * transported (Requirement 5.1).
   */
  async resolveLanguageModel({
    modelId,
    apiKey,
  }: {
    modelId: string;
    providerId: string;
    apiKey: string;
  }): Promise<LanguageModelV2> {
    return createOpenAICompatible({
      name: PROVIDER_ID,
      apiKey: apiKey || (await this.getApiKey()),
      baseURL: this.buildUrl(),
    }).chatModel(modelId);
  }
}
