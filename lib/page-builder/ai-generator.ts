import type { PageData } from "./types";
import { validatePageData } from "./schema";
import { pageBuilderConfig } from "./config";

/**
 * Options for AI page generation.
 */
export interface AIGenerateOptions {
  prompt: string;
  existingData?: PageData;
  systemContext?: string;
}

/**
 * Abstract interface for AI-powered page generation.
 * Implementations can use Puck Cloud, custom LLM pipelines, or any backend.
 */
export interface AIGenerator {
  generate(options: AIGenerateOptions): Promise<PageData>;
}

/**
 * Error thrown when the AI generator produces invalid PageData.
 */
export class AIGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIGenerationError";
  }
}

/**
 * Cloud client dependency shape for PuckCloudAIGenerator.
 * Accepts any object that exposes a `generate` method, allowing
 * constructor injection without depending on `@puckeditor/cloud-client` directly.
 */
export interface CloudClient {
  generate(options: {
    prompt: string;
    config: unknown;
    existingData?: unknown;
    systemContext?: string;
  }): Promise<unknown>;
}

/**
 * Default AIGenerator implementation that delegates to a Puck Cloud–compatible
 * client. Validates the generated output against the PageData schema before
 * returning, and wraps cloud client errors with descriptive context.
 */
export class PuckCloudAIGenerator implements AIGenerator {
  constructor(private cloudClient: CloudClient) {}

  async generate(options: AIGenerateOptions): Promise<PageData> {
    let raw: unknown;

    try {
      raw = await this.cloudClient.generate({
        prompt: options.prompt,
        config: pageBuilderConfig,
        existingData: options.existingData,
        systemContext: options.systemContext,
      });
    } catch (err: unknown) {
      throw this.wrapClientError(err);
    }

    const validation = validatePageData(raw);

    if (!validation.success) {
      const details = (validation.errors ?? [])
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");
      throw new AIGenerationError(
        `AI generated invalid PageData: ${details}`,
      );
    }

    return raw as PageData;
  }

  /**
   * Wraps cloud client errors with human-readable context so callers can
   * surface meaningful messages for rate limits, auth failures, and network issues.
   */
  private wrapClientError(err: unknown): AIGenerationError {
    if (!(err instanceof Error)) {
      return new AIGenerationError(
        "AI generation failed: unexpected error",
        err,
      );
    }

    const msg = err.message.toLowerCase();

    if (msg.includes("rate limit") || msg.includes("429")) {
      return new AIGenerationError(
        "AI generation rate limit exceeded — please wait and try again",
        err,
      );
    }

    if (
      msg.includes("unauthorized") ||
      msg.includes("api key") ||
      msg.includes("401") ||
      msg.includes("403")
    ) {
      return new AIGenerationError(
        "AI generation failed: invalid or missing API key",
        err,
      );
    }

    if (
      msg.includes("network") ||
      msg.includes("fetch") ||
      msg.includes("econnrefused") ||
      msg.includes("timeout")
    ) {
      return new AIGenerationError(
        "AI generation failed: network error — check your connection and try again",
        err,
      );
    }

    return new AIGenerationError(
      `AI generation failed: ${err.message}`,
      err,
    );
  }
}
