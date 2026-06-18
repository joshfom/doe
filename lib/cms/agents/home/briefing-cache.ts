// lib/cms/agents/home/briefing-cache.ts
//
// Briefing_Cache read / write / invalidate accessors for the Agent-First Home
// surface (Design §Components #4). The Briefing_Cache is a small Postgres table
// (`briefing_cache`, the ONLY schema change S5 introduces) keyed by the
// (user_id, window, period_date) triple. It stores an assembled Briefing JSON
// verbatim so repeat Home_Surface loads are served fast, without re-running the
// expensive multi-step Briefing_Workflow on every visit (CC-Cost / Req 5.1–5.3).
//
// THE ONE RULE still holds here: this module performs no Briefing assembly and
// reads no `metrics_*`/`leads_mirror` data. It touches ONLY the dedicated
// `briefing_cache` table, whose body carries no personal data beyond the
// user-id key and the already-redacted Briefing (CC-Privacy / Req 2.7, 9.4).
//
// Behaviours (Design §Components #4):
//   • readBriefingCache       — returns a cached Briefing ONLY if it is
//                               non-expired relative to `now`; expired/missing
//                               → null (Req 5.2, 5.4).
//   • writeBriefingCache      — upserts by the (user, window, periodDate) PK;
//                               expires_at = assembledAt + clamp(ttlMinutes,
//                               1, 60), default 15 when not provided (Req 5.1,
//                               5.3, 5.4). Fail-safe: a write failure never
//                               throws to the caller (so the route can still
//                               serve the assembled Briefing for the current
//                               request) and stores no partial entry (Req 5.6).
//   • invalidateBriefingCache — deletes every entry for (userId, periodDate),
//                               backed by `briefing_cache_user_period_idx`, so
//                               the next request reflects a Stack mutation
//                               (Req 5.5).
//
// Figure parity (Req 5.7) is structural: the cached JSON *is* the assembled
// Briefing, so a served cached Briefing presents figures byte-identical to what
// was assembled — there is no recomputation on read.
//
// Design references: §Components #4; §Data Models. Requirements: 5.1, 5.2, 5.3,
// 5.4, 5.5, 5.6, 5.7.

import { and, eq, gt } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { briefingCache } from "@/lib/cms/schema";
import type { Briefing, BriefingWindow } from "./types";

/**
 * The cache key for a single assembled Briefing — the same triple that forms the
 * `briefing_cache` primary key, so at most one cached Briefing exists per user /
 * window / day (Req 5.1, 5.2, 5.3).
 */
export interface CacheKey {
  userId: string;
  window: BriefingWindow;
  /** YYYY-MM-DD (local). */
  periodDate: string;
}

/** Default time-to-live in minutes when a caller does not specify one (Req 5.4). */
const DEFAULT_TTL_MINUTES = 15;
/** Minimum configurable TTL in minutes (Req 5.4). */
const MIN_TTL_MINUTES = 1;
/** Maximum configurable TTL in minutes (Req 5.4). */
const MAX_TTL_MINUTES = 60;

/**
 * Clamp a requested TTL into the configurable [1, 60]-minute range, defaulting
 * to 15 minutes when the value is missing or not a finite number (Req 5.4).
 */
function clampTtlMinutes(ttlMinutes?: number): number {
  const requested =
    typeof ttlMinutes === "number" && Number.isFinite(ttlMinutes)
      ? ttlMinutes
      : DEFAULT_TTL_MINUTES;
  return Math.min(MAX_TTL_MINUTES, Math.max(MIN_TTL_MINUTES, requested));
}

/**
 * Read the cached Briefing for `k`, returning it ONLY when the entry is
 * non-expired relative to `now` (defaults to the current instant). An expired
 * or missing entry yields `null`, signalling a cache miss to the caller so it
 * runs the Briefing_Workflow instead (Req 5.2, 5.4).
 *
 * The `expires_at > now` predicate is applied in SQL so an expired row is never
 * returned even if it has not yet been swept.
 */
export async function readBriefingCache(
  db: Database,
  k: CacheKey,
  now: Date = new Date()
): Promise<Briefing | null> {
  const [row] = await db
    .select({ briefing: briefingCache.briefing })
    .from(briefingCache)
    .where(
      and(
        eq(briefingCache.userId, k.userId),
        eq(briefingCache.window, k.window),
        eq(briefingCache.periodDate, k.periodDate),
        gt(briefingCache.expiresAt, now)
      )
    )
    .limit(1);

  return row?.briefing ?? null;
}

/**
 * Store the assembled Briefing `b` for `k`, upserting by the
 * (user, window, periodDate) primary key so a re-assembly for the same
 * user/window/day refreshes the single cached row (Req 5.1, 5.3).
 *
 * `expires_at` is set to `assembledAt + clamp(ttlMinutes, 1, 60)` (default 15),
 * where `assembledAt` is the write instant captured here so the TTL is measured
 * from the moment the entry is cached (Req 5.4).
 *
 * Fail-safe (Req 5.6): the write is a single atomic upsert — there is no path
 * that leaves a partial row — and any failure is swallowed (logged non-fatally)
 * rather than thrown, so the route that assembled the Briefing can still serve
 * it for the current request.
 */
export async function writeBriefingCache(
  db: Database,
  k: CacheKey,
  b: Briefing,
  ttlMinutes?: number
): Promise<void> {
  const assembledAt = new Date();
  const ttlMs = clampTtlMinutes(ttlMinutes) * 60_000;
  const expiresAt = new Date(assembledAt.getTime() + ttlMs);

  try {
    await db
      .insert(briefingCache)
      .values({
        userId: k.userId,
        window: k.window,
        periodDate: k.periodDate,
        briefing: b,
        assembledAt,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          briefingCache.userId,
          briefingCache.window,
          briefingCache.periodDate,
        ],
        set: { briefing: b, assembledAt, expiresAt },
      });
  } catch (err) {
    // Write-failure must never lose the assembled Briefing for the current
    // request, and the atomic upsert above stores no partial entry (Req 5.6).
    console.error("[briefing-cache] write failed (non-fatal)", err);
  }
}

/**
 * Invalidate every cached Briefing for `(userId, periodDate)` — across all three
 * Briefing_Windows — so the next request re-assembles and reflects a Stack
 * change made through a Tool_Dispatcher mutation (Req 5.5). Backed by
 * `briefing_cache_user_period_idx`.
 */
export async function invalidateBriefingCache(
  db: Database,
  userId: string,
  periodDate: string
): Promise<void> {
  await db
    .delete(briefingCache)
    .where(
      and(
        eq(briefingCache.userId, userId),
        eq(briefingCache.periodDate, periodDate)
      )
    );
}
