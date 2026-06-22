/**
 * Prospecting Workspace (S7) — shared base for the Account/Person enrichment
 * adapters (Design §Components #4; Requirements 2.3, 2.4, 3.1, 3.2; task 4.2).
 *
 * The four concrete providers (Apollo / PDL / Cognism / Crunchbase) differ only
 * in (a) which env credential they read, (b) the endpoint + request shape they
 * speak, and (c) how they map a raw provider payload onto our provenanced
 * {@link ProviderResult} / {@link ProviderEnrichment}. Everything else — the
 * `{ unconfigured: true }` short-circuit when credentials are absent (Req 2.4),
 * the {@link SearchCache} that serves identical ICP searches without re-billing
 * (Req 2.3), the injectable {@link HttpTransport} seam so tests never hit the
 * network ([deps]), the deterministic `asOf` clock, and the per-field provenance
 * stamping (CC-Provenance, Req 3.2) — lives here, once.
 *
 * The enrich path's idempotency-by-`jobKey` (Req 3.2 / CC-Idem) is provided by
 * {@link enrichmentJobKey} in `./cache` and wired at the job layer (task 6.3);
 * a provider's `enrich` is the unit of work that key bounds to one charge.
 */

import type { ProvenancedField } from "../target";
import { SearchCache } from "./cache";
import {
  defaultClock,
  defaultTransport,
  type Clock,
  type HttpRequestInit,
  type HttpTransport,
} from "./transport";
import type {
  EnrichmentProvider,
  ProspectFilter,
  ProviderEnrichment,
  ProviderId,
  ProviderResult,
  TargetRef,
  Unconfigured,
} from "./index";
import { ProviderRateLimitError } from "./index";

/**
 * The default lawful basis stamped onto purchased PII (B2B cold prospecting under
 * UAE PDPL / GDPR legitimate-interest posture, Req 9.1). Adapters can override
 * per field where a source carries a more specific basis.
 */
export const DEFAULT_LAWFUL_BASIS = "legitimate_interest";

/** Resolved credentials + endpoint for a provider; `null` ⇒ unconfigured. */
export interface ProviderConfig {
  /** The provider API key read from env. */
  apiKey: string;
  /** The provider API base URL (env-overridable, with a sane default). */
  baseUrl: string;
}

/** Injectable seams so the adapters are fully deterministic under test. */
export interface ProviderDeps {
  /** HTTP transport; defaults to the platform `fetch`. Tests inject a fake. */
  transport?: HttpTransport;
  /** Clock for `asOf` stamps; defaults to wall-clock. Tests inject a fixed one. */
  clock?: Clock;
  /** Search cache; defaults to a fresh per-provider TTL cache (Req 2.3). */
  cache?: SearchCache<ProviderResult[]>;
}

/**
 * Abstract base every concrete provider extends. It owns the contract-level
 * behaviour (unconfigured short-circuit, search caching, provenance helpers,
 * JSON transport) and delegates only the provider-specific request + mapping to
 * {@link fetchSearch} / {@link fetchEnrich}.
 */
export abstract class BaseEnrichmentProvider implements EnrichmentProvider {
  abstract readonly id: ProviderId;

  protected readonly config: ProviderConfig | null;
  protected readonly transport: HttpTransport;
  protected readonly clock: Clock;
  private readonly cache: SearchCache<ProviderResult[]>;

  constructor(config: ProviderConfig | null, deps: ProviderDeps = {}) {
    this.config = config;
    this.transport = deps.transport ?? defaultTransport;
    this.clock = deps.clock ?? defaultClock;
    this.cache = deps.cache ?? new SearchCache<ProviderResult[]>();
  }

  /** True when this provider's credentials are present. */
  get configured(): boolean {
    return this.config !== null;
  }

  /**
   * Fan an ICP filter to the provider. Returns `{ unconfigured: true }` WITHOUT
   * any transport call when credentials are absent (Req 2.4), and serves an
   * identical repeat within the cache window from cache rather than re-billing
   * (Req 2.3). The billable transport runs only on a cache miss.
   */
  async search(
    filter: ProspectFilter
  ): Promise<ProviderResult[] | Unconfigured> {
    const config = this.config;
    if (!config) return { unconfigured: true };
    return this.cache.getOrLoad(filter, () => this.fetchSearch(config, filter));
  }

  /**
   * Assemble intelligence for one Target. Returns `{ unconfigured: true }`
   * WITHOUT a transport call when credentials are absent (Req 3.1). The caller
   * (the `enrichment_fetch` job, task 6.3) keys this call by `enrichmentJobKey`
   * so a retry reconciles to one provider charge (Req 3.2 / CC-Idem).
   */
  async enrich(target: TargetRef): Promise<ProviderEnrichment | Unconfigured> {
    const config = this.config;
    if (!config) return { unconfigured: true };
    return this.fetchEnrich(config, target);
  }

  // ── Provenance helpers (CC-Provenance) ────────────────────────────────────

  /** Current `asOf` ISO timestamp from the injected clock. */
  protected nowIso(): string {
    return this.clock().toISOString();
  }

  /**
   * Wrap a non-PII value as a {@link ProvenancedField} stamped with this
   * provider's id as `source` and the current `asOf` (e.g. company name, title).
   */
  protected field(value: string, lawfulBasis?: string): ProvenancedField {
    return { value, source: this.id, asOf: this.nowIso(), lawfulBasis };
  }

  /**
   * Wrap a PII value as a {@link ProvenancedField} carrying a `lawfulBasis`
   * (email, phone, personal profile fields), so purchased PII is never
   * indistinguishable from first-party data (Req 9.1, CC-Provenance).
   */
  protected pii(
    value: string,
    lawfulBasis: string = DEFAULT_LAWFUL_BASIS
  ): ProvenancedField {
    return this.field(value, lawfulBasis);
  }

  /**
   * Build a provenanced attribute map from a set of `{ key → value }` pairs,
   * skipping absent values. `piiKeys` marks which keys are PII (and so carry a
   * lawful basis). Deterministic key order is preserved by insertion order.
   */
  protected attributes(
    pairs: Record<string, string | null | undefined>,
    piiKeys: ReadonlySet<string> = new Set()
  ): Record<string, ProvenancedField> {
    const out: Record<string, ProvenancedField> = {};
    for (const [key, value] of Object.entries(pairs)) {
      if (value == null || value === "") continue;
      out[key] = piiKeys.has(key) ? this.pii(value) : this.field(value);
    }
    return out;
  }

  // ── JSON transport ────────────────────────────────────────────────────────

  /**
   * Perform a JSON request against the provider through the injected transport
   * and parse the body. Throws on a non-2xx so the fan-out isolates this
   * provider into `failedProviders` rather than sinking the whole search.
   */
  protected async requestJson(
    path: string,
    init?: HttpRequestInit
  ): Promise<unknown> {
    const base = this.config?.baseUrl.replace(/\/+$/, "") ?? "";
    const url = `${base}${path}`;
    const res = await this.transport(url, init);
    if (res.status === 429) {
      // Quota exhausted — surface distinctly so the fan-out records this as a
      // RATE-LIMITED provider (rep sees "limit reached") and the demo fallback
      // carries the search, rather than a silent generic failure.
      throw new ProviderRateLimitError(this.id, res.status);
    }
    if (!res.ok) {
      throw new Error(`${this.id} request to ${path} failed (${res.status})`);
    }
    return res.json();
  }

  // ── Provider-specific seams ───────────────────────────────────────────────

  /** Map an ICP filter → provider query, call the transport, map the payload. */
  protected abstract fetchSearch(
    config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]>;

  /** Map a Target ref → provider lookup, call the transport, map the payload. */
  protected abstract fetchEnrich(
    config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment>;
}

/**
 * Read a single-key provider config from the environment: returns `null` when
 * the API key is absent (so the provider reports `{ unconfigured: true }` rather
 * than throwing, Req 2.4), else `{ apiKey, baseUrl }` with an env-overridable
 * base URL falling back to `defaultBaseUrl`.
 */
export function configFromEnv(
  apiKeyVar: string,
  baseUrlVar: string,
  defaultBaseUrl: string,
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  const apiKey = env[apiKeyVar];
  if (!apiKey) return null;
  return { apiKey, baseUrl: env[baseUrlVar] ?? defaultBaseUrl };
}
