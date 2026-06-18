// lib/cms/agents/gateway.test.ts
//
// Integration test for the gateway transport (Task 2.3).
//
// Asserts that DoeModelGateway.resolveLanguageModel builds an OpenAI-compatible
// client whose `baseURL` equals the configured CF_AI_GATEWAY_URL. The model SDK
// (@ai-sdk/openai-compatible-v5 `createOpenAICompatible`) is mocked so the test
// exercises only the gateway's transport wiring, never a live model call.
//
// Validates: Requirements 5.1 (all agent/tool model calls route through the
// Cloudflare AI Gateway transport).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the model SDK ───────────────────────────────────────────────────────
// Capture the config passed to createOpenAICompatible so we can assert on the
// baseURL the gateway resolves a client against. The returned stub exposes a
// `chatModel` factory matching the real SDK's shape.
const createOpenAICompatibleMock = vi.fn((config: { name: string; apiKey: string; baseURL: string }) => ({
  __config: config,
  chatModel: (modelId: string) => ({ __modelId: modelId, __baseURL: config.baseURL }),
}));

vi.mock("@ai-sdk/openai-compatible-v5", () => ({
  __esModule: true,
  createOpenAICompatible: (config: { name: string; apiKey: string; baseURL: string }) =>
    createOpenAICompatibleMock(config),
}));

import { DoeModelGateway } from "./gateway";

const GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/acct/doe/openai";
const API_TOKEN = "test-cf-api-token";

describe("DoeModelGateway transport", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
    process.env.CF_AI_GATEWAY_URL = GATEWAY_URL;
    process.env.CF_AI_API_TOKEN = API_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves a language model whose baseURL equals CF_AI_GATEWAY_URL", async () => {
    const gateway = new DoeModelGateway();

    const model = await gateway.resolveLanguageModel({
      modelId: "openai/gpt-4o-mini",
      providerId: "cf",
      apiKey: API_TOKEN,
    });

    // The SDK client must have been built exactly once, pointed at the gateway URL.
    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    const passedConfig = createOpenAICompatibleMock.mock.calls[0][0];
    expect(passedConfig.baseURL).toBe(GATEWAY_URL);

    // The resolved model carries the same baseURL through to the chat model.
    expect((model as { __baseURL: string }).__baseURL).toBe(GATEWAY_URL);
  });

  it("strips any trailing slash from the configured gateway URL", async () => {
    process.env.CF_AI_GATEWAY_URL = `${GATEWAY_URL}/`;
    const gateway = new DoeModelGateway();

    await gateway.resolveLanguageModel({
      modelId: "openai/gpt-4.1",
      providerId: "cf",
      apiKey: API_TOKEN,
    });

    const passedConfig = createOpenAICompatibleMock.mock.calls[0][0];
    expect(passedConfig.baseURL).toBe(GATEWAY_URL);
    expect(gateway.buildUrl()).toBe(GATEWAY_URL);
  });

  it("falls back to the CF_AI_API_TOKEN env var when no apiKey is supplied", async () => {
    const gateway = new DoeModelGateway();

    await gateway.resolveLanguageModel({
      modelId: "openai/gpt-4o-mini",
      providerId: "cf",
      apiKey: "",
    });

    const passedConfig = createOpenAICompatibleMock.mock.calls[0][0];
    expect(passedConfig.apiKey).toBe(API_TOKEN);
    expect(passedConfig.baseURL).toBe(GATEWAY_URL);
  });
});
