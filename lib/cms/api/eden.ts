/**
 * Eden Treaty client factory.
 *
 * One end-to-end typed client derived from the single Elysia app `type Api`,
 * reused by the voice-agent worker, the job runner, and the Demo Console.
 *
 * When a `serviceToken` is supplied, it is attached as an
 * `Authorization: Bearer <token>` header so the agent worker can authenticate
 * to the service-token-scoped `/api/tools/*` routes without a user session or
 * a client-bundled API key.
 *
 * Design references: §3 (single Elysia backbone + Eden type), §16 (client
 * setup). Requirements: 12.1 (typed end-to-end clients), 14.2 / SEC-2 (agent
 * service-token auth to tool routes).
 */
import { treaty } from "@elysiajs/eden";
import type { Api } from "./index";

/**
 * Build an Eden Treaty client typed by the Elysia app's `Api` type.
 *
 * @param baseUrl       Base URL of the API (e.g. `https://host` or `host:3001`).
 * @param serviceToken  Optional service token; when present it is sent as a
 *                       `Bearer` token on the `Authorization` header for every
 *                       request (used by the agent worker → `/api/tools/*`).
 */
export function makeApiClient(baseUrl: string, serviceToken?: string) {
  return treaty<Api>(baseUrl, {
    headers: serviceToken
      ? { Authorization: `Bearer ${serviceToken}` }
      : undefined,
  });
}

export type ApiClient = ReturnType<typeof makeApiClient>;
