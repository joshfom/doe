/**
 * Prospecting Workspace (S7) — search cache + enrichment idempotency seam
 * (Design §Components #4; Requirements 2.3, 8.2; task 4.2 **[deps]**).
 *
 * Two cost/idempotency guardrails live here, shared by all four providers:
 *
 *  1. **Search cache (Req 2.3).** Identical ICP searches within a configurable
 *     window serve cached results rather than re-billing the provider. Each
 *     provider holds a {@link SearchCache} keyed by a stable hash of the ICP
 *     filter; a fresh hit returns the prior result WITHOUT invoking the (billable)
 *     transport. The window defaults to `PROSPECT_SEARCH_CACHE_MS` (or 15 min).
 *
 *  2. **Enrichment jobKey (Req 8.2 / CC-Idem).** The enrich path runs as an
 *     `enrichment_fetch` job idempotent by `jobKey`. {@link enrichmentJobKey}
 *     derives a stable key from the provider id + the Target reference, so a
 *     retried enrichment reconciles to a single provider charge. The
 *     `enrichment_fetch` JobKind handler is registered in task 6.3; this module
 *     exposes the key derivation (and the {@link ENRICHMENT_FETCH_JOB_KIND} name)
 *     so 6.3 can wire the handler without reshaping the providers.
 *
 * Both helpers are pure/deterministic and unit-testable without a DB or network.
 */

import { createHash } from "node:crypto";
import type { ProspectFilter, ProviderId, TargetRef } from "./index";

// ── Stable hashing ──────────────────────────────────────────────────────────────

/**
 * Canonical JSON: recursively sort object keys so two structurally-equal filters
 * (regardless of key insertion order) serialize identically. Arrays preserve
 * order — element order is semantically meaningful in an ICP filter.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue; // omit undefined so {a:undefined} ≡ {}
      sorted[key] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

/** A stable SHA-256 of any JSON-serializable value, via canonical key ordering. */
export function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

/**
 * Stable hash of an ICP filter — the {@link SearchCache} key. Two filters that
 * differ only in key order (or in absent-vs-undefined optional fields) hash
 * identically, so a repeated search hits cache rather than re-billing (Req 2.3).
 */
export function stableFilterHash(filter: ProspectFilter): string {
  return stableHash(filter);
}

// ── Search cache (Requirement 2.3) ──────────────────────────────────────────────

/** Default cache window (15 minutes) when `PROSPECT_SEARCH_CACHE_MS` is unset. */
export const DEFAULT_SEARCH_CACHE_MS = 15 * 60 * 1000;

/** Resolve the configured cache window (ms), falling back to the default. */
export function resolveSearchCacheMs(): number {
  const raw = process.env.PROSPECT_SEARCH_CACHE_MS;
  if (!raw) return DEFAULT_SEARCH_CACHE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_SEARCH_CACHE_MS;
}

interface CacheEntry<V> {
  value: V;
  /** Epoch ms when this entry was stored. */
  storedAt: number;
}

/**
 * A tiny TTL cache keyed by a stable filter hash. Generic over the cached value
 * (a provider holds a `SearchCache<ProviderResult[]>`). Reads past the window are
 * misses; a miss is the ONLY path that triggers the billable transport call.
 *
 * The clock is injectable so a test can advance time deterministically and assert
 * the re-bill happens exactly when the window elapses.
 */
export class SearchCache<V> {
  private readonly store = new Map<string, CacheEntry<V>>();

  constructor(
    private readonly windowMs: number = resolveSearchCacheMs(),
    private readonly now: () => number = () => Date.now()
  ) {}

  /** The fresh cached value for `key`, or `undefined` on miss/expiry. */
  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.storedAt > this.windowMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** Store `value` under `key`, stamped at the current clock. */
  set(key: string, value: V): void {
    this.store.set(key, { value, storedAt: this.now() });
  }

  /**
   * Return the fresh cached value for `filter`, or compute it via `load` (the
   * billable transport call), cache it, and return it. The single seam every
   * provider's `search` routes through, so a repeat within the window never
   * re-bills (Req 2.3).
   */
  async getOrLoad(filter: ProspectFilter, load: () => Promise<V>): Promise<V> {
    const key = stableFilterHash(filter);
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const fresh = await load();
    this.set(key, fresh);
    return fresh;
  }

  /** Drop every entry (used by tests). */
  clear(): void {
    this.store.clear();
  }
}

// ── Enrichment idempotency (Requirement 8.2 / CC-Idem) ───────────────────────────

/**
 * The JobKind name for the enrichment fetch path. The handler is registered in
 * task 6.3 (`registerJobHandler`); exposing the constant here keeps the name in
 * one place so the providers and 6.3 agree.
 */
export const ENRICHMENT_FETCH_JOB_KIND = "enrichment_fetch" as const;

/**
 * Derive a stable `jobKey` for an enrichment fetch (Req 8.2 / CC-Idem). Keyed by
 * the provider id + the Target's stable identity (its `targetId` when present,
 * else its matchable identity keys), so retrying the same logical enrichment
 * reconciles to one provider charge under the job spine's `ON CONFLICT (job_key)`.
 *
 * The raw phone is hashed into the key shape via {@link stableHash}, never echoed,
 * so the derived key carries no raw PII.
 */
export function enrichmentJobKey(
  providerId: ProviderId,
  ref: TargetRef
): string {
  // Prefer the stable Target id; fall back to identity keys so an as-yet-unsaved
  // Target still derives a deterministic key.
  const identity = ref.targetId
    ? { targetId: ref.targetId }
    : {
        displayName: ref.displayName,
        companyName: ref.companyName,
        email: ref.email,
        phone: ref.phone,
        country: ref.country,
        sourceRef: ref.sourceRef,
      };
  return `${ENRICHMENT_FETCH_JOB_KIND}:${providerId}:${stableHash(identity)}`;
}
