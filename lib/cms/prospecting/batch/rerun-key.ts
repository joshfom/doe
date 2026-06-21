/**
 * Re-run key derivation (design §1 "rerun_key"; Data Models
 * `prospecting_batch_runs`; Requirement 9.1).
 *
 * A Batch_Run is keyed by a deterministic `rerun_key` derived from the owning
 * rep plus a STABLE normalization of the Batch_Run subject (a Bayn cluster
 * reference or an ICP filter). This key is what makes a re-run idempotent: the
 * bridge upserts the `prospecting_batch_runs` row by `rerun_key`, and the
 * durable job is enqueued with `rerun_key` as its `job_key` (`ON CONFLICT
 * DO NOTHING`), so an equivalent re-run is identifiable and never duplicates a
 * run (Req 9.1, 9.2).
 *
 * Determinism is the whole contract:
 *
 *   - Equal inputs → equal keys, stable across calls and processes.
 *   - The subject is canonicalized before hashing so that two subjects that
 *     differ only in object KEY ORDER (e.g. an `icpFilter` whose properties were
 *     assembled in a different order) normalize to the same bytes and therefore
 *     the same key. Object keys are sorted recursively and `undefined`-valued
 *     keys are dropped (an absent optional field must not change the key).
 *   - Array element ORDER is preserved — an array is an ordered value (e.g. a
 *     ranked `titles` list), so reordering it is a genuinely different subject.
 *
 * The hash uses the same primitive the rest of the codebase uses for
 * content-addressed keys (`node:crypto` sha256, hex digest — cf.
 * `lib/cms/ai/tools/registry.ts`, `lib/cms/ai/otp.ts`).
 */

import { createHash } from "node:crypto";

import type { ProspectFilter } from "../providers";

/**
 * The subject of a Batch_Run: either a Bayn cluster reference or an ICP filter
 * (design §1). All fields beyond `kind` are optional so the same shape serves
 * the cluster-led and the ICP-led entry points; `kind` records which one is
 * authoritative.
 */
export interface BatchSubject {
  kind: "cluster" | "icp";
  /** Set when `kind === "cluster"` — the Bayn cluster id. */
  clusterId?: string;
  /** Optional originating Prospecting_Brief id. */
  briefId?: string;
  /** Set when `kind === "icp"` — reuses the providers' `ProspectFilter`. */
  icpFilter?: ProspectFilter;
}

/** Input to {@link deriveRerunKey}. */
export interface DeriveRerunKeyInput {
  /** The initiating rep (Batch_Run owner) — part of the key (Req 9.1). */
  ownerRep: string;
  /** The Batch_Run subject (cluster ref or ICP filter). */
  subject: BatchSubject;
}

/** Prefix on the derived key, mirroring the codebase's namespaced job keys. */
const RERUN_KEY_PREFIX = "prospecting_batch";

/**
 * Recursively canonicalize a JSON-like value into a stable form:
 *
 *   - objects → a new object with keys sorted lexicographically and every
 *     `undefined`-valued key dropped (an absent optional must not perturb the
 *     key), each value canonicalized;
 *   - arrays → element-wise canonicalized, ORDER PRESERVED;
 *   - primitives → returned unchanged.
 *
 * `JSON.stringify` then emits identical bytes for any two inputs that are equal
 * up to object key ordering.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map(canonicalize);

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue; // absent optional → no effect on the key
    out[key] = canonicalize(v);
  }
  return out;
}

/**
 * Derive the deterministic `rerun_key` for a Batch_Run from its owning rep and a
 * stable normalization of its subject (Req 9.1).
 *
 * Equal `{ ownerRep, subject }` inputs always yield the same key — including
 * when the subject differs only in object key ordering — and the result is
 * stable across calls and processes. The key is `"prospecting_batch:"` followed
 * by a sha256 hex digest of the canonical `(ownerRep, subject)` pair, so it is
 * safe to use directly as both the `prospecting_batch_runs.rerun_key` and the
 * enqueued job's `job_key`.
 */
export function deriveRerunKey(input: DeriveRerunKeyInput): string {
  const canonical = JSON.stringify({
    ownerRep: input.ownerRep,
    subject: canonicalize(input.subject),
  });

  const digest = createHash("sha256").update(canonical).digest("hex");

  return `${RERUN_KEY_PREFIX}:${digest}`;
}
