// lib/cms/agents/home/jobkey.ts
//
// PURE jobKey derivation for the Home_Surface (Design §Components #4, #5).
//
// Two idempotency keys live here, and NOTHING else — no DB, no I/O, no clock:
//
//   • `combinedReportJobKey(userId, periodType, periodDate)` →
//        `report:{userId}:{periodType}:{periodDate}`
//     The key the Home_Agent assigns when it enqueues exactly one
//     `compile_and_email_report` job for a daily/weekly Combined_Report. The
//     caller passes the ALREADY-DERIVED `periodDate` — the calendar day for a
//     daily report, or the week's first calendar day for a weekly report
//     (Requirement 4.2). `resolveReportPeriodDate` below performs that pure
//     derivation when a caller needs it.
//
//   • `briefingJobKey(userId, window, periodDate)` →
//        `briefing:{userId}:{window}:{periodDate}`
//     The key the scheduled `briefing_assembly` job uses to pre-warm the
//     Briefing_Cache idempotently (Design §Components #3, #4). It mirrors the
//     Briefing_Cache key `(user_id, window, period_date)` so a re-run for the
//     same user/window/day is a no-op.
//
// Both functions are total and deterministic: the SAME inputs always produce
// the SAME key (the key-half of Property 6), and any empty/missing component is
// rejected up front (Requirement 10.6) so a malformed enqueue can never collapse
// into another logical job's key. Rejection throws an `Error`, matching the
// project's pure-validation convention (e.g. `lib/cms/ai/actions.ts`).
//
// Design references: §Components #4 (Briefing_Cache key), #5 (Combined_Report
// jobKey). Requirements: 4.2, 10.6.

/**
 * The time-of-day class of a Briefing (Design §Data Models). Defined here as a
 * local structural alias of `"morning" | "midday" | "evening"`; once
 * `lib/cms/agents/home/window.ts` lands, prefer importing `BriefingWindow` from
 * there (string-literal unions are structural, so the two are interchangeable).
 */
export type BriefingWindow = "morning" | "midday" | "evening";

/** A Combined_Report period type (Requirement 4.2). */
export type ReportPeriodType = "daily" | "weekly";

/**
 * Guard: a jobKey component must be a present, non-empty, non-whitespace string.
 * An empty/missing component is rejected (Requirement 10.6) so a malformed
 * enqueue never silently maps onto another job's key.
 */
function requireComponent(label: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`jobKey component "${label}" must be a non-empty string`);
  }
  return value;
}

/**
 * Derive the idempotency `jobKey` for a daily/weekly Combined_Report:
 * `report:{userId}:{periodType}:{periodDate}` (Requirement 4.2).
 *
 * Pure over its inputs — the caller supplies the already-derived `periodDate`
 * (the calendar day for `"daily"`, the week's first calendar day for
 * `"weekly"`; see {@link resolveReportPeriodDate}). The same
 * (userId, periodType, periodDate) always yields the same key, and
 * `enqueueJob`'s `ON CONFLICT (job_key) DO NOTHING` then guarantees at most one
 * job and one report side effect per logical period (Requirement 4.3, 10.3).
 *
 * @throws Error if any component is empty or missing (Requirement 10.6).
 */
export function combinedReportJobKey(
  userId: string,
  periodType: ReportPeriodType,
  periodDate: string
): string {
  const u = requireComponent("userId", userId);
  const p = requireComponent("periodType", periodType);
  const d = requireComponent("periodDate", periodDate);
  return `report:${u}:${p}:${d}`;
}

/**
 * Derive the idempotency `jobKey` for a scheduled Briefing pre-warm:
 * `briefing:{userId}:{window}:{periodDate}` (Design §Components #3, #4).
 *
 * Mirrors the Briefing_Cache key `(user_id, window, period_date)` so the
 * `briefing_assembly` job is idempotent per user/window/day — a re-run for the
 * same key writes no second job row (Requirement 10.2).
 *
 * @throws Error if any component is empty or missing (Requirement 10.6).
 */
export function briefingJobKey(
  userId: string,
  window: BriefingWindow,
  periodDate: string
): string {
  const u = requireComponent("userId", userId);
  const w = requireComponent("window", window);
  const d = requireComponent("periodDate", periodDate);
  return `briefing:${u}:${w}:${d}`;
}

/**
 * Pure derivation of a Combined_Report's `periodDate` from a reference calendar
 * day (Requirement 4.2):
 *   • `"daily"`  → the reference day itself.
 *   • `"weekly"` → the week's first calendar day (ISO week start, Monday).
 *
 * The reference is a `YYYY-MM-DD` calendar day (local to the requesting user);
 * the result is the same `YYYY-MM-DD` form, suitable to pass straight into
 * {@link combinedReportJobKey}. Computed in UTC over the date-only value so it
 * carries no time-of-day or timezone drift.
 *
 * @throws Error if `referenceDay` is empty or not a `YYYY-MM-DD` calendar day.
 */
export function resolveReportPeriodDate(
  periodType: ReportPeriodType,
  referenceDay: string
): string {
  requireComponent("referenceDay", referenceDay);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDay.trim());
  if (!match) {
    throw new Error(
      `resolveReportPeriodDate: referenceDay "${referenceDay}" must be a YYYY-MM-DD calendar day`
    );
  }
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Reject calendar-invalid days (e.g. 2024-02-31 rolling over).
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(m) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    throw new Error(
      `resolveReportPeriodDate: referenceDay "${referenceDay}" is not a valid calendar day`
    );
  }

  if (periodType === "daily") {
    return formatUtcDay(date);
  }

  // Weekly: roll back to the ISO week's first day (Monday). getUTCDay() is
  // 0 (Sun)..6 (Sat); the Monday offset is 0 for Mon, 6 for Sun.
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return formatUtcDay(date);
}

/** Format a UTC `Date` as a `YYYY-MM-DD` calendar day. */
function formatUtcDay(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
