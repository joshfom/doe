/**
 * Send-cap counters + idempotency ledger (design §6 "Send caps";
 * Requirements 7.1–7.6).
 *
 * Outbound volume is capped **per rep and per cluster, per period**. Two
 * additive tables back the guardrail:
 *
 *   - `prospecting_send_counters` — the consumed count, keyed by
 *     `(scope_kind, scope_id, period_bucket)`. A new period is simply a new
 *     `period_bucket` whose `consumed` starts at zero, so the cap "resets" with
 *     no scheduled reset job (Req 7.4).
 *   - `prospecting_send_ledger` — an idempotency ledger keyed UNIQUE on
 *     `(draft_id, scope_kind)` so each scope counts **at most once per send**,
 *     and the rep-scope and cluster-scope increments are **independent**
 *     operations (Req 7.5, 7.6).
 *
 * The exactly-once contract is the whole point of the ledger: a send may be
 * retried (the approve / send path is itself retried under an idempotency key),
 * but the consumed counter for each scope must advance by exactly one per send.
 * The ledger insert (guarded by its unique index, `ON CONFLICT DO NOTHING`)
 * gates the counter upsert — the first writer for a `(draft_id, scope_kind)`
 * pair performs the `+1`; every subsequent writer no-ops.
 *
 * Independence is the other half (Req 7.6): {@link recordSend} drives the rep
 * and cluster increments as two separate operations, each in its own `try`, so
 * one scope's failure never blocks the other. Each remains exactly-once on its
 * own ledger row.
 *
 * Drizzle conflict primitives mirror the rest of the repo
 * (`lib/cms/jobs/index.ts`): `onConflictDoNothing({ target })` for the ledger
 * guard, and `onConflictDoUpdate({ target, set: { consumed: sql\`… + 1\` } })`
 * for the counter increment.
 */

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/lib/cms/db";
import {
  prospectingSendCounters,
  prospectingSendLedger,
} from "@/lib/cms/schema";

/** A cap scope: the rep who owns the send, or the cluster it targets. */
export type SendScopeKind = "rep" | "cluster";

/** Input to {@link recordSend} — one completed send to be counted. */
export interface RecordSendInput {
  /** The sent draft; the ledger's idempotency anchor (Req 7.5). */
  draftId: string;
  /** The approving rep — the `rep` scope's `scope_id`. */
  repId: string;
  /** The targeted cluster — the `cluster` scope's `scope_id`. */
  clusterId: string;
  /** The period key both increments are bucketed under (Req 7.4). */
  periodBucket: string;
}

/** Identifies one counter row: a scope within a period. */
export interface SendScopeRef {
  scopeKind: SendScopeKind;
  scopeId: string;
  periodBucket: string;
}

/** Outcome of {@link incrementScope} for one scope of a send. */
export interface IncrementResult {
  /** The scope that was (or was not) advanced. */
  scopeKind: SendScopeKind;
  /**
   * `true` when this call performed the `+1` (it owned the ledger row);
   * `false` when the send was already counted for this scope (no double count).
   */
  applied: boolean;
}

/** Result of {@link recordSend}: the independent outcome of each scope. */
export interface RecordSendResult {
  rep: IncrementResult | { scopeKind: "rep"; applied: false; error: unknown };
  cluster:
    | IncrementResult
    | { scopeKind: "cluster"; applied: false; error: unknown };
}

/** A budget read for one scope within a period (Req 7.2, 7.3). */
export interface BudgetReading {
  scopeKind: SendScopeKind;
  scopeId: string;
  periodBucket: string;
  /** Sends already consumed in this period (0 when no row exists yet). */
  consumed: number;
  /**
   * The configured cap for this scope/period, or `null` when no cap is
   * configured (treated as unlimited).
   */
  cap: number | null;
  /**
   * Sends still allowed: `cap - consumed` floored at 0, or `null` (unlimited)
   * when no cap is configured.
   */
  remaining: number | null;
}

/**
 * Record one completed send against the rep and cluster caps as **two
 * independent, exactly-once** increments (Req 7.5, 7.6).
 *
 * Each scope is incremented in its own `try`, so a failure incrementing one
 * scope (e.g. a transient DB error on the rep counter) never prevents the other
 * scope (the cluster counter) from being incremented. Each increment is
 * idempotent on its own `(draft_id, scope_kind)` ledger row, so retrying a send
 * advances each counter by at most one.
 *
 * The per-scope error is captured and returned rather than thrown, so the
 * caller can observe a partial outcome without the first failure short-circuiting
 * the second increment.
 */
export async function recordSend(
  db: Database,
  { draftId, repId, clusterId, periodBucket }: RecordSendInput
): Promise<RecordSendResult> {
  // Two INDEPENDENT operations — one scope failing must not block the other
  // (Req 7.6). Each is wrapped in its own try so a throw is contained.
  let rep: RecordSendResult["rep"];
  try {
    rep = await incrementScope(db, "rep", repId, periodBucket, draftId);
  } catch (error) {
    rep = { scopeKind: "rep", applied: false, error };
  }

  let cluster: RecordSendResult["cluster"];
  try {
    cluster = await incrementScope(
      db,
      "cluster",
      clusterId,
      periodBucket,
      draftId
    );
  } catch (error) {
    cluster = { scopeKind: "cluster", applied: false, error };
  }

  return { rep, cluster };
}

/**
 * Increment a single scope's consumed counter **exactly once per send**
 * (Req 7.5).
 *
 * The unique `(draft_id, scope_kind)` ledger insert is the guard: the first
 * caller for this pair inserts the ledger row and returns its id, then performs
 * the counter `+1`; a duplicate/retried call hits `ON CONFLICT DO NOTHING`,
 * gets back an empty result, and returns without touching the counter. This is
 * the same `INSERT … ON CONFLICT` idempotency pattern the job spine uses
 * (`lib/cms/jobs/index.ts`).
 */
export async function incrementScope(
  db: Database,
  scopeKind: SendScopeKind,
  scopeId: string,
  periodBucket: string,
  draftId: string
): Promise<IncrementResult> {
  // Idempotency guard: claim the (draft_id, scope_kind) ledger row. If it
  // already exists, this send was already counted for this scope — no-op so the
  // counter is never double-incremented (Req 7.5).
  const ledgered = await db
    .insert(prospectingSendLedger)
    .values({ draftId, scopeKind, scopeId, periodBucket })
    .onConflictDoNothing({
      target: [prospectingSendLedger.draftId, prospectingSendLedger.scopeKind],
    })
    .returning({ id: prospectingSendLedger.id });

  if (ledgered.length === 0) {
    return { scopeKind, applied: false };
  }

  // We own the ledger row → perform the single, authoritative increment. Upsert
  // so the first send in a period seeds the row (consumed = 1) and subsequent
  // sends add one to the existing count.
  await db
    .insert(prospectingSendCounters)
    .values({ scopeKind, scopeId, periodBucket, consumed: 1 })
    .onConflictDoUpdate({
      target: [
        prospectingSendCounters.scopeKind,
        prospectingSendCounters.scopeId,
        prospectingSendCounters.periodBucket,
      ],
      set: {
        consumed: sql`${prospectingSendCounters.consumed} + 1`,
        updatedAt: new Date(),
      },
    });

  return { scopeKind, applied: true };
}

/**
 * Read a scope's remaining send budget for a period (Req 7.2, 7.3).
 *
 * Reads the `prospecting_send_counters` row keyed by
 * `(scope_kind, scope_id, period_bucket)`. When no row exists yet the period is
 * fresh: `consumed` is 0. An optional `cap` overrides the row's configured cap
 * (useful when the cap is supplied by config rather than persisted on the row);
 * when neither a `cap` argument nor a row cap is present the scope is treated as
 * unlimited (`cap`/`remaining` are `null`).
 */
export async function remainingBudget(
  db: Database,
  ref: SendScopeRef & { cap?: number | null }
): Promise<BudgetReading> {
  const rows = await db
    .select({
      consumed: prospectingSendCounters.consumed,
      cap: prospectingSendCounters.cap,
    })
    .from(prospectingSendCounters)
    .where(
      and(
        eq(prospectingSendCounters.scopeKind, ref.scopeKind),
        eq(prospectingSendCounters.scopeId, ref.scopeId),
        eq(prospectingSendCounters.periodBucket, ref.periodBucket)
      )
    )
    .limit(1);

  const consumed = rows[0]?.consumed ?? 0;
  // An explicit cap argument wins; otherwise fall back to the persisted cap.
  const cap = ref.cap !== undefined ? ref.cap : (rows[0]?.cap ?? null);
  const remaining = cap === null ? null : Math.max(0, cap - consumed);

  return {
    scopeKind: ref.scopeKind,
    scopeId: ref.scopeId,
    periodBucket: ref.periodBucket,
    consumed,
    cap,
    remaining,
  };
}

/**
 * Whether a scope's send cap is exhausted for a period (Req 7.2, 7.3).
 *
 * `true` when a finite cap is configured and no budget remains
 * (`remaining <= 0`). An unconfigured (unlimited) cap is never exhausted.
 */
export async function capExhausted(
  db: Database,
  ref: SendScopeRef & { cap?: number | null }
): Promise<boolean> {
  const { remaining } = await remainingBudget(db, ref);
  return remaining !== null && remaining <= 0;
}
