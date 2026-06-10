// @vitest-environment jsdom
/**
 * Hydration / behavior test for the Countdown runtime (task 13.4).
 *
 * Scope (per the implementation plan, task 13.4 and design "Block 9 — Countdown"):
 *   - The initial (server / first-paint) markup contains a deterministic
 *     pre-tick placeholder ("--") and is byte-identical regardless of the wall
 *     clock — i.e. `Date.now()` is never read during render, so the server
 *     markup and first client paint cannot disagree (Req 8.6, 8.7).
 *   - The 1s interval starts only AFTER the mount effect: under fake timers the
 *     post-mount value reflects the (fake) clock, and advancing time by one
 *     second decrements the live value (Req 8.3).
 *   - At/after expiry the configured `expiryMessage` is shown, both for a target
 *     already in the past and for a target reached while ticking (Req 8.4).
 *   - An unparseable `targetDateTime` is treated as already-expired and renders
 *     the `expiryMessage` deterministically on first paint (Req 8.4).
 *   - The live value lives in an `aria-live="polite"` `role="timer"` region so
 *     updates are announced without stealing focus (Req 8.8, 13.4).
 *
 * Conventions mirror `TabGroupRuntime.test.tsx`: jsdom environment, Testing
 * Library `render` + `cleanup`, queries scoped to the returned `container`. The
 * runtime is a self-contained `"use client"` component with no Next.js
 * dependency, so it is imported and exercised directly. The truest test of the
 * "server markup does not read the clock" guarantee is `renderToStaticMarkup`
 * (which never runs effects), so the pre-tick assertions use it; the ticking
 * assertions use jsdom + `vi.useFakeTimers()` to drive the interval.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 9 — Countdown".
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10,
 *   11.3, 13.4.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, cleanup, act } from "@testing-library/react";
import { CountdownRuntime } from "./CountdownRuntime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PLACEHOLDER = "--";
const EXPIRY = "This offer has ended";

/** An absolute instant used as the fake "now" in ticking tests. */
const NOW = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01T00:00:00Z

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Read the four countdown unit values out of a rendered timer region, keyed by
 * their visible label ("Days"/"Hours"/"Minutes"/"Seconds"). Each unit is a div
 * whose first span is the value and whose second span is the label.
 */
function getUnitValues(container: HTMLElement): Record<string, string> {
  const region = container.querySelector('[role="timer"]')!;
  const units = Array.from(region.querySelectorAll(":scope > div"));
  const out: Record<string, string> = {};
  for (const unit of units) {
    const spans = unit.querySelectorAll("span");
    if (spans.length >= 2) {
      out[spans[1].textContent ?? ""] = spans[0].textContent ?? "";
    }
  }
  return out;
}

describe("CountdownRuntime — pre-tick / server markup (Req 8.6, 8.7)", () => {
  it("renders the deterministic '--' placeholder for all four units on first paint", () => {
    const markup = renderToStaticMarkup(
      <CountdownRuntime
        targetDateTime="2999-01-01T00:00:00Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    // Four unit values, each the placeholder — no clock-derived digits.
    expect(countOccurrences(markup, PLACEHOLDER)).toBe(4);
    // Unit labels are present (stable, props-independent chrome).
    expect(markup).toContain("Days");
    expect(markup).toContain("Hours");
    expect(markup).toContain("Minutes");
    expect(markup).toContain("Seconds");
    // The expiry message is NOT shown for a future target on first paint.
    expect(markup).not.toContain(EXPIRY);
  });

  it("produces identical first-paint markup regardless of Date.now() (no clock leakage)", () => {
    const props = {
      targetDateTime: "2999-01-01T00:00:00Z",
      timeZone: "UTC",
      expiryMessage: EXPIRY,
    };

    // Render the server markup at two very different wall-clock instants.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    const first = renderToStaticMarkup(<CountdownRuntime {...props} />);
    vi.setSystemTime(new Date("2025-12-31T23:59:59Z"));
    const second = renderToStaticMarkup(<CountdownRuntime {...props} />);
    vi.useRealTimers();

    // Clock-independent: the pre-tick markup is byte-identical across renders.
    expect(first).toBe(second);
    expect(countOccurrences(first, PLACEHOLDER)).toBe(4);
  });

  it("exposes an aria-live=polite timer region in the server markup (Req 8.8)", () => {
    const markup = renderToStaticMarkup(
      <CountdownRuntime
        targetDateTime="2999-01-01T00:00:00Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    expect(markup).toContain('role="timer"');
    expect(markup).toContain('aria-live="polite"');
  });
});

describe("CountdownRuntime — interval starts only after the mount effect (Req 8.3)", () => {
  it("shows the placeholder pre-tick and the live value only after effects run", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // Pre-tick: server markup (no effects) holds the placeholder.
    const serverMarkup = renderToStaticMarkup(
      <CountdownRuntime
        targetDateTime="2025-01-03T03:04:05Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );
    expect(countOccurrences(serverMarkup, PLACEHOLDER)).toBe(4);

    // After mount the effect swaps in the live remaining time: 2025-01-03T03:04:05Z
    // is 2 days, 03:04:05 ahead of NOW (2025-01-01T00:00:00Z).
    const { container } = render(
      <CountdownRuntime
        targetDateTime="2025-01-03T03:04:05Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    const values = getUnitValues(container);
    expect(values).toEqual({
      Days: "2",
      Hours: "03",
      Minutes: "04",
      Seconds: "05",
    });
  });

  it("decrements the live value once per second as the interval ticks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { container } = render(
      <CountdownRuntime
        targetDateTime="2025-01-03T03:04:05Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    expect(getUnitValues(container).Seconds).toBe("05");

    // Advance one second: the interval fires and the live value decrements.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getUnitValues(container).Seconds).toBe("04");

    // Advance two more seconds.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(getUnitValues(container).Seconds).toBe("02");
  });

  it("switches to the expiry message when the target is reached while ticking (Req 8.4)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // Target is 3 seconds in the future.
    const { container } = render(
      <CountdownRuntime
        targetDateTime="2025-01-01T00:00:03Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    // Still counting at mount.
    expect(container.textContent).not.toContain(EXPIRY);
    expect(getUnitValues(container).Seconds).toBe("03");

    // Cross the target instant: the interval clears and the expiry message shows.
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(container.textContent).toContain(EXPIRY);
    expect(container.querySelector('[role="timer"]')?.textContent).toBe(EXPIRY);
  });
});

describe("CountdownRuntime — expiry and invalid target (Req 8.4)", () => {
  it("renders the expiry message for a target already in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { container } = render(
      <CountdownRuntime
        targetDateTime="2020-01-01T00:00:00Z"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    expect(container.textContent).toContain(EXPIRY);
    // No countdown units are rendered once expired.
    expect(container.querySelector(":scope div div")).toBeNull();
  });

  it("renders the expiry message deterministically for an unparseable date on first paint", () => {
    // Pre-tick (server) markup already shows the expiry message — an invalid
    // target is detectable from props alone, so no clock read is needed.
    const markup = renderToStaticMarkup(
      <CountdownRuntime
        targetDateTime="not-a-real-date"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );
    expect(markup).toContain(EXPIRY);
    expect(countOccurrences(markup, PLACEHOLDER)).toBe(0);

    // And in jsdom the rendered output matches.
    const { container } = render(
      <CountdownRuntime
        targetDateTime="not-a-real-date"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );
    expect(container.textContent).toContain(EXPIRY);
  });

  it("keeps the aria-live=polite timer region in the expiry state", () => {
    const { container } = render(
      <CountdownRuntime
        targetDateTime="not-a-real-date"
        timeZone="UTC"
        expiryMessage={EXPIRY}
      />,
    );

    const region = container.querySelector('[role="timer"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });
});
