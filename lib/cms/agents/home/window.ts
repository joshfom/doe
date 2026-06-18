/**
 * Agent-First Home / Briefing Surface (S5) — Briefing_Window resolution
 * (Design §Components #3 "The Briefing_Workflow", §Data Models).
 *
 * `resolveBriefingWindow` is a PURE, TOTAL function that classifies a requesting
 * user's local time of day as exactly one Briefing_Window — `morning`,
 * `midday`, or `evening` (Requirement 3.3). It performs NO database access, no
 * dispatcher call, and no I/O of any kind: it only partitions the local
 * 24-hour day.
 *
 * THE PARTITION (Requirement 3.3): the three windows map to contiguous,
 * non-overlapping local-time ranges that together cover the FULL 24-hour local
 * day, so every valid local instant resolves to exactly one window and no
 * instant resolves to two. Measured in minutes since local midnight (0..1439):
 *
 *   morning   [05:00, 12:00)            →  [ 300, 720)
 *   midday    [12:00, 17:00)            →  [ 720, 1020)
 *   evening   [17:00, 24:00) ∪ [00:00, 05:00)  →  [1020, 1440) ∪ [0, 300)
 *
 * `evening` wraps across local midnight so the late-evening and pre-dawn hours
 * (when the user is winding down or has not yet started the day) share the
 * wrap-up window. The three ranges are mutually exclusive and jointly
 * exhaustive over [0, 1440), which is what makes the function total: there is
 * no local minute that falls into zero windows or into more than one.
 *
 * Totality is over VALID local times. Resolving whether a user even HAS a
 * determinable local time (e.g. an unknown timezone) is the Briefing_Workflow's
 * concern — it returns `window_unresolved` and assembles no Briefing
 * (Requirement 3.6) BEFORE calling this function. Accordingly this function
 * rejects an invalid input (an `Invalid Date`, or an out-of-range hour) with a
 * `RangeError` rather than inventing a window, so a bad call can never silently
 * yield a bogus Briefing_Window.
 *
 * Design references: §Components #3, §Data Models, §Correctness Properties
 * (Property 4 "window partition is total and non-overlapping").
 * Requirements: 3.3.
 */

import type { BriefingWindow } from "./types";

export type { BriefingWindow } from "./types";

// ── Window boundaries (minutes since local midnight) ──────────────────────────

/** Number of minutes in a full local day. */
const MINUTES_PER_DAY = 24 * 60; // 1440

/** Start of the `morning` window — 05:00 local. */
export const MORNING_START_MIN = 5 * 60; // 300

/** Start of the `midday` window (and end of `morning`) — 12:00 local. */
export const MIDDAY_START_MIN = 12 * 60; // 720

/** Start of the `evening` window (and end of `midday`) — 17:00 local. */
export const EVENING_START_MIN = 17 * 60; // 1020

/**
 * The accepted input forms for a local time of day:
 *
 *   - `Date`   — a local wall-clock instant; its local hour/minute are read.
 *   - `number` — an hour of the day in `[0, 24)` (fractional hours allowed,
 *                e.g. `12.5` for 12:30).
 *   - `{ hour, minute? }` — explicit local hour/minute components.
 */
export type LocalTime =
  | Date
  | number
  | { hour: number; minute?: number };

// ── Local-minute derivation ───────────────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalize any accepted {@link LocalTime} to minutes since local midnight in
 * `[0, 1440)`. Throws a `RangeError` for an unresolvable input (an
 * `Invalid Date`, a non-finite or out-of-range hour/minute) so the caller never
 * receives a window for a time that could not be determined.
 *
 * Pure; reads only the supplied value (a `Date`'s LOCAL wall-clock components
 * via {@link Date.getHours}/{@link Date.getMinutes}).
 */
export function localMinutesOfDay(localTime: LocalTime): number {
  if (localTime instanceof Date) {
    const ms = localTime.getTime();
    if (Number.isNaN(ms)) {
      throw new RangeError("resolveBriefingWindow: received an Invalid Date");
    }
    return localTime.getHours() * 60 + localTime.getMinutes();
  }

  if (isFiniteNumber(localTime)) {
    if (localTime < 0 || localTime >= 24) {
      throw new RangeError(
        `resolveBriefingWindow: hour ${localTime} is out of range [0, 24)`,
      );
    }
    return Math.floor(localTime * 60) % MINUTES_PER_DAY;
  }

  if (localTime && typeof localTime === "object") {
    const { hour, minute = 0 } = localTime;
    if (!isFiniteNumber(hour) || hour < 0 || hour >= 24) {
      throw new RangeError(
        `resolveBriefingWindow: hour ${hour} is out of range [0, 24)`,
      );
    }
    if (!isFiniteNumber(minute) || minute < 0 || minute >= 60) {
      throw new RangeError(
        `resolveBriefingWindow: minute ${minute} is out of range [0, 60)`,
      );
    }
    return (hour * 60 + Math.floor(minute)) % MINUTES_PER_DAY;
  }

  throw new RangeError(
    "resolveBriefingWindow: unresolvable local time of day",
  );
}

// ── resolveBriefingWindow ─────────────────────────────────────────────────────

/**
 * Classify a requesting user's local time of day as exactly one
 * {@link BriefingWindow} (Requirement 3.3).
 *
 * Total over valid local times: every minute of the local day falls into
 * exactly one of the three contiguous, non-overlapping ranges (see module
 * docs). An unresolvable input throws a `RangeError`.
 *
 * Pure; no DB, no dispatcher, no I/O.
 *
 * @param localTime the user's local time of day (a `Date`, an hour in `[0,24)`,
 *                   or `{ hour, minute }`).
 * @returns the single Briefing_Window the local time falls into.
 */
export function resolveBriefingWindow(localTime: LocalTime): BriefingWindow {
  const minutes = localMinutesOfDay(localTime);

  if (minutes >= MORNING_START_MIN && minutes < MIDDAY_START_MIN) {
    return "morning";
  }
  if (minutes >= MIDDAY_START_MIN && minutes < EVENING_START_MIN) {
    return "midday";
  }
  // [EVENING_START_MIN, 1440) ∪ [0, MORNING_START_MIN) — evening wraps midnight.
  return "evening";
}
