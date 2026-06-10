"use client";

/**
 * Countdown runtime — the interactive part of the `Countdown` block (a live
 * countdown timer to an author-set date-time in an author-set time zone).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 9 — Countdown" → "CountdownRuntime ('use client'): computes the
 *   target instant from targetDateTime + timeZone … initial render outputs a
 *   stable pre-tick value … a useEffect starts the 1s interval AFTER mount …".
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10,
 *   11.3, 13.4.
 *
 * Why a runtime component:
 *   The countdown re-computes once per second on the client, so — exactly like
 *   `ImageCarouselRuntime` / `TabGroupRuntime` / `TestimonialRuntime` — that
 *   lives in a dedicated `"use client"` component, and the block's `render` in
 *   `config.ts` delegates to it via `React.createElement(CountdownRuntime, …)`
 *   wrapped in `styledRender` (wired in task 13.2). The container's
 *   typography/spacing/border/animation come from `styledRender`; this file owns
 *   only the timer logic and its accessible live region.
 *
 * Hydration safety (Req 8.6, 8.7) — this is the single critical concern:
 *   `Date.now()` differs between the server and the client, so reading it during
 *   render would make the server markup and the first client paint disagree and
 *   trigger a hydration mismatch. To avoid that:
 *     1. The target instant is derived purely from props (`targetDateTime` +
 *        `timeZone`) — deterministic on both sides, and identical for every
 *        visitor regardless of their local zone (Req 8.5).
 *     2. The initial render (server + first client paint) shows a deterministic
 *        **pre-tick placeholder** that never reads the clock. An invalid target
 *        is also detectable from props alone, so it renders the expiry message
 *        deterministically on first paint (Req 8.4 / error handling).
 *     3. A post-mount `useEffect` reads `Date.now()`, swaps in the live remaining
 *        time, and starts the 1s interval. At/after expiry it clears the interval
 *        and shows `expiryMessage` (Req 8.3, 8.4).
 *   Because the pre-tick markup is clock-independent it is byte-stable; only the
 *   post-hydration ticking is non-deterministic, which is why Countdown is the
 *   one documented exclusion in the byte-stability suite (Req 11.3, task 13.5).
 *
 * Accessibility (Req 8.8, 13.4):
 *   The live value lives in an `aria-live="polite"` `role="timer"` region so
 *   per-second updates are announced to assistive tech without stealing focus.
 */

import React, { useEffect, useRef, useState } from "react";

export interface CountdownRuntimeProps {
  /** Author-entered target date-time (ISO 8601). Interpreted in `timeZone`. */
  targetDateTime: string;
  /** IANA time-zone id (e.g. "America/New_York") the target is read in. */
  timeZone: string;
  /** Message shown at and after expiry (Req 8.4). */
  expiryMessage: string;
  /** Accessible name for the timer region. Defaults to "Countdown timer". */
  ariaLabel?: string;
}

/** A target time that fails to parse is treated as already-expired (Req 8.4). */
const INVALID = Number.NaN;

// ─── Default ORA styling ───────────────────────────────────────────────────
// The block's `render` applies spacing/border/typography via `styledRender`;
// the runtime owns only the timer chrome. Colors come from the ORA palette
// (charcoal value on a sand unit chip) and meet WCAG AA on the light surface.
const COLOR_VALUE = "#2C2C2C"; // charcoal
const COLOR_LABEL = "#6B6B6B"; // slate
const COLOR_CHIP = "#F2EDE3"; // sand

const PLACEHOLDER = "--";

/** True when the ISO string carries its own UTC designator or numeric offset. */
function hasExplicitOffset(value: string): boolean {
  return /([zZ])$|[+-]\d{2}:?\d{2}$/.test(value);
}

/**
 * The signed UTC offset (ms) of `timeZone` at the absolute instant `date`, such
 * that `wallClockComponents = utcInstant + offset`. Uses `Intl.DateTimeFormat`
 * (available on server and client) so the computation is deterministic.
 */
function zoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  // `hour` can come back as "24" at midnight in some environments.
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/**
 * Resolve the absolute target epoch (ms) from the author's date-time + zone so
 * every visitor counts down to the same instant (Req 8.5). Returns `NaN` for an
 * unparseable target, which the runtime treats as already-expired (Req 8.4).
 *
 *   - If the ISO string already carries an offset/`Z`, it is an absolute instant
 *     and `timeZone` does not change it.
 *   - Otherwise the naive wall-clock components are interpreted *in* `timeZone`.
 */
export function computeTargetEpoch(
  targetDateTime: string,
  timeZone: string,
): number {
  if (typeof targetDateTime !== "string") return INVALID;
  const trimmed = targetDateTime.trim();
  if (trimmed === "") return INVALID;

  if (hasExplicitOffset(trimmed)) {
    return new Date(trimmed).getTime();
  }

  // Interpret the components as wall-clock time in `timeZone`. First parse them
  // as if they were UTC to get nominal components, then subtract the zone's
  // offset at that approximate instant to land on the true epoch.
  const naiveUtc = new Date(`${trimmed}Z`).getTime();
  if (Number.isNaN(naiveUtc)) {
    // Fall back to a direct parse (covers space-separated / partial inputs).
    return new Date(trimmed).getTime();
  }

  if (!timeZone || typeof timeZone !== "string") {
    return naiveUtc;
  }

  try {
    const offset = zoneOffsetMs(timeZone, new Date(naiveUtc));
    return naiveUtc - offset;
  } catch {
    // Unknown/invalid IANA zone: fall back to the naive UTC interpretation
    // rather than throwing (error-handling rule in the design).
    return naiveUtc;
  }
}

interface Duration {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Split a non-negative remaining-millisecond span into d/h/m/s. */
function splitDuration(ms: number): Duration {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const UNIT_LABELS = ["Days", "Hours", "Minutes", "Seconds"] as const;

const CONTAINER_STYLE: React.CSSProperties = {
  display: "flex",
  // Logical gap + start alignment so the layout flips correctly under RTL
  // (Req 8.10) without hard-coded left/right.
  flexWrap: "wrap",
  gap: 12,
  alignItems: "flex-start",
};

const UNIT_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minWidth: 56,
  padding: "8px 12px",
  background: COLOR_CHIP,
  borderRadius: 8,
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1.1,
  color: COLOR_VALUE,
  fontVariantNumeric: "tabular-nums",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: COLOR_LABEL,
  marginTop: 4,
};

const EXPIRY_STYLE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: COLOR_VALUE,
};

export function CountdownRuntime({
  targetDateTime,
  timeZone,
  expiryMessage,
  ariaLabel = "Countdown timer",
}: CountdownRuntimeProps) {
  // Deterministic, props-only target instant (safe on server + client).
  const targetEpoch = computeTargetEpoch(targetDateTime, timeZone);
  const invalid = Number.isNaN(targetEpoch);

  // `null` = pre-tick (initial render, no clock read yet). After mount the
  // effect swaps in the live remaining time; `0` means expired.
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start ticking only AFTER mount so the server markup and first client paint
  // are byte-identical (no Date.now() during render — Req 8.6, 8.7).
  useEffect(() => {
    if (invalid) return; // expiry message is rendered deterministically below

    const tick = () => {
      const left = targetEpoch - Date.now();
      if (left <= 0) {
        setRemaining(0);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      setRemaining(left);
    };

    tick(); // immediate post-mount value (no flash to placeholder)

    // Only run the 1s interval while time remains (Req 8.3); if already past
    // the target the single tick above shows the expiry message (Req 8.4).
    if (targetEpoch - Date.now() > 0) {
      intervalRef.current = setInterval(tick, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [invalid, targetEpoch]);

  // ── Expired (or invalid target): show the configured expiry message. ───────
  const expired = invalid || remaining === 0;

  const liveRegionProps = {
    role: "timer" as const,
    "aria-live": "polite" as const,
    "aria-label": ariaLabel,
  };

  if (expired) {
    return (
      <div {...liveRegionProps} style={EXPIRY_STYLE}>
        {expiryMessage}
      </div>
    );
  }

  // Pre-tick (remaining === null) shows a deterministic placeholder; once the
  // effect has run, `remaining` is the live span. Both share the same DOM shape
  // so the swap causes no layout shift.
  const duration: Duration | null =
    remaining === null ? null : splitDuration(remaining);

  const values: string[] =
    duration === null
      ? [PLACEHOLDER, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER]
      : [
          String(duration.days),
          pad2(duration.hours),
          pad2(duration.minutes),
          pad2(duration.seconds),
        ];

  return (
    <div {...liveRegionProps} style={CONTAINER_STYLE}>
      {UNIT_LABELS.map((label, i) => (
        <div key={label} style={UNIT_STYLE}>
          <span style={VALUE_STYLE}>{values[i]}</span>
          <span style={LABEL_STYLE}>{label}</span>
        </div>
      ))}
    </div>
  );
}
