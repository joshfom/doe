/**
 * Prospecting Workspace (S7) — injectable HTTP transport for the Account/Person
 * enrichment adapters (Design §Components #4; task 4.2 **[deps]**).
 *
 * The four concrete providers (Apollo / PDL / Cognism / Crunchbase) never call
 * `fetch` directly. They take an {@link HttpTransport} in their factory/constructor
 * so a test can inject a fake that returns canned payloads and asserts on the
 * request — the suite NEVER hits the network (the task is [deps]). In production
 * the {@link defaultTransport} wraps the platform `fetch`.
 *
 * The transport surface is deliberately minimal (a structural subset of the
 * `fetch`/`Response` shapes) so `globalThis.fetch` satisfies it and a test mock
 * is a one-liner — no need to construct a real `Response`.
 */

/** A minimal request init the adapters need (method, headers, JSON body). */
export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** A minimal response the adapters read (status + JSON body). */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * A `fetch`-like transport. `globalThis.fetch` is assignable to this (its
 * `Response` is a structural superset of {@link HttpResponse}); tests pass a
 * fake `(url, init) => Promise<HttpResponse>`.
 */
export type HttpTransport = (
  url: string,
  init?: HttpRequestInit
) => Promise<HttpResponse>;

/**
 * The default transport — a thin wrapper over the platform `fetch`. Adapters
 * default to this when no transport is injected; tests inject a fake instead.
 */
export const defaultTransport: HttpTransport = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<HttpResponse>;

/** A clock seam so `asOf` timestamps are deterministic under test. */
export type Clock = () => Date;

/** The default wall clock; tests inject a fixed clock for stable `asOf` stamps. */
export const defaultClock: Clock = () => new Date();
