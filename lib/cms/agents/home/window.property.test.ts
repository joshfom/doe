import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveBriefingWindow,
  localMinutesOfDay,
  MORNING_START_MIN,
  MIDDAY_START_MIN,
  EVENING_START_MIN,
  type BriefingWindow,
} from "./window";

// Feature: agentic-home, Property 4: resolveBriefingWindow is a total function that maps every local instant to exactly one of three contiguous, non-overlapping windows covering the full 24-hour day.

// ── Constants ─────────────────────────────────────────────────────────────────

const MINUTES_PER_DAY = 24 * 60; // 1440
const NUM_RUNS = 500; // ≥100 iterations (Property 4 must be exhaustive over the day)

/** The three (and only three) Briefing_Window values. */
const ALL_WINDOWS: readonly BriefingWindow[] = ["morning", "midday", "evening"];

/**
 * The single source of truth for the intended partition, expressed directly
 * from the design's range table (minutes since local midnight, 0..1439):
 *
 *   morning   [300, 720)
 *   midday    [720, 1020)
 *   evening   [1020, 1440) ∪ [0, 300)   — wraps local midnight
 *
 * This is deliberately an INDEPENDENT re-derivation of the window for a given
 * minute, so the property test does not just mirror the implementation's
 * branching.
 */
function windowsContainingMinute(minute: number): BriefingWindow[] {
  const hits: BriefingWindow[] = [];
  if (minute >= MORNING_START_MIN && minute < MIDDAY_START_MIN) {
    hits.push("morning");
  }
  if (minute >= MIDDAY_START_MIN && minute < EVENING_START_MIN) {
    hits.push("midday");
  }
  if (
    (minute >= EVENING_START_MIN && minute < MINUTES_PER_DAY) ||
    (minute >= 0 && minute < MORNING_START_MIN)
  ) {
    hits.push("evening");
  }
  return hits;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** A random valid local minute-of-day in [0, 1439]. */
const minuteOfDayArb = fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 });

/** A random fractional local hour in [0, 24). */
const hourArb = fc.double({
  min: 0,
  max: 24,
  maxExcluded: true,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A random { hour, minute } local-time component pair. */
const hourMinuteArb = fc.record({
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
});

/**
 * A random local wall-clock Date. We fix a base calendar date and vary the
 * local hour/minute/second/ms so the Date's LOCAL components (which
 * resolveBriefingWindow reads) span the full day regardless of the host TZ.
 */
const localDateArb = fc
  .record({
    year: fc.integer({ min: 1971, max: 2099 }),
    month: fc.integer({ min: 0, max: 11 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
    ms: fc.integer({ min: 0, max: 999 }),
  })
  .map(
    ({ year, month, day, hour, minute, second, ms }) =>
      new Date(year, month, day, hour, minute, second, ms),
  );

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Total window partition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.3**
 *
 * Property 4: Total window partition.
 *
 * resolveBriefingWindow is a total function that maps every local instant to
 * exactly one of three contiguous, non-overlapping windows covering the full
 * 24-hour day.
 */
describe("Feature: agentic-home, Property 4: Total window partition", () => {
  it("TOTAL — every local minute resolves to exactly one of the three windows", () => {
    fc.assert(
      fc.property(minuteOfDayArb, (minute) => {
        const window = resolveBriefingWindow({
          hour: Math.floor(minute / 60),
          minute: minute % 60,
        });
        // Result is always one of exactly the three valid window values.
        expect(ALL_WINDOWS).toContain(window);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("PARTITION — the resolved window matches the independent range derivation (exactly one)", () => {
    fc.assert(
      fc.property(minuteOfDayArb, (minute) => {
        const containing = windowsContainingMinute(minute);

        // Exhaustive AND mutually exclusive: every minute is in exactly one range.
        expect(containing).toHaveLength(1);

        const window = resolveBriefingWindow({
          hour: Math.floor(minute / 60),
          minute: minute % 60,
        });
        // The implementation agrees with the independent partition.
        expect(window).toBe(containing[0]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("NON-OVERLAPPING — a minute claimed by one window is claimed by no other", () => {
    fc.assert(
      fc.property(minuteOfDayArb, (minute) => {
        const window = resolveBriefingWindow({
          hour: Math.floor(minute / 60),
          minute: minute % 60,
        });
        // For each OTHER window, the minute must not fall in that window's range.
        for (const other of ALL_WINDOWS) {
          if (other === window) continue;
          expect(windowsContainingMinute(minute)).not.toContain(other);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("TOTAL over Dates — every local wall-clock instant resolves to exactly one window", () => {
    fc.assert(
      fc.property(localDateArb, (date) => {
        const window = resolveBriefingWindow(date);
        expect(ALL_WINDOWS).toContain(window);

        // Agrees with the partition derived from the Date's local minute-of-day.
        const minute = localMinutesOfDay(date);
        const containing = windowsContainingMinute(minute);
        expect(containing).toHaveLength(1);
        expect(window).toBe(containing[0]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("TOTAL over fractional hours — every hour in [0,24) resolves to exactly one window", () => {
    fc.assert(
      fc.property(hourArb, (hour) => {
        const window = resolveBriefingWindow(hour);
        expect(ALL_WINDOWS).toContain(window);

        const minute = localMinutesOfDay(hour);
        expect(window).toBe(windowsContainingMinute(minute)[0]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("TOTAL over { hour, minute } — every component pair resolves to exactly one window", () => {
    fc.assert(
      fc.property(hourMinuteArb, ({ hour, minute }) => {
        const window = resolveBriefingWindow({ hour, minute });
        expect(ALL_WINDOWS).toContain(window);

        const m = localMinutesOfDay({ hour, minute });
        expect(window).toBe(windowsContainingMinute(m)[0]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("CONTIGUOUS — the union of the three windows covers the full 24-hour day with no gaps", () => {
    // Exhaustive walk of the whole day: every one of the 1440 minutes is covered
    // exactly once, proving the partition is both total and non-overlapping.
    const seen = new Set<BriefingWindow>();
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      const containing = windowsContainingMinute(minute);
      expect(containing).toHaveLength(1); // covered, and only once

      const window = resolveBriefingWindow({
        hour: Math.floor(minute / 60),
        minute: minute % 60,
      });
      expect(window).toBe(containing[0]);
      seen.add(window);
    }
    // All three windows are actually reached across the day (none is empty).
    expect([...seen].sort()).toEqual([...ALL_WINDOWS].sort());
  });

  it("BOUNDARIES — each contiguous range boundary lands in the correct window", () => {
    // Lower-inclusive / upper-exclusive boundaries of each contiguous range.
    const cases: Array<[number, BriefingWindow]> = [
      [0, "evening"], // local midnight — pre-dawn wrap
      [MORNING_START_MIN - 1, "evening"], // 04:59
      [MORNING_START_MIN, "morning"], // 05:00
      [MIDDAY_START_MIN - 1, "morning"], // 11:59
      [MIDDAY_START_MIN, "midday"], // 12:00
      [EVENING_START_MIN - 1, "midday"], // 16:59
      [EVENING_START_MIN, "evening"], // 17:00
      [MINUTES_PER_DAY - 1, "evening"], // 23:59
    ];
    for (const [minute, expected] of cases) {
      const window = resolveBriefingWindow({
        hour: Math.floor(minute / 60),
        minute: minute % 60,
      });
      expect(window).toBe(expected);
    }
  });
});
