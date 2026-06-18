import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isDegraded,
  DEFAULT_AGENT_PROBE_TIMEOUT_MS,
  type AvailabilityProbe,
} from "./degrade";

// Feature: agentic-home, Property 3: When the Agent_Availability_Check reports the Home_Agent/Mastra_Runtime unavailable or exceeds the timeout, the Home_Surface enters Degraded_Mode and renders the Classic_Panel navigation.
//
// **Validates: Requirements 11.2, 11.3, 11.5**
//
// This file covers the DECISION-HALF of Property 3: the pure `isDegraded`
// decision function in `./degrade`. (The surface-rendering half — the
// `useAgentAvailability` hook applying this decision and rendering
// `ClassicFallback` — lands with the surface task.)
//
// The decision rule under test (Design §Architecture "Degradation"):
//   - probe reports unavailable (`available !== true`)           → degraded.
//   - probe latency exceeds the timeout (`latencyMs > timeoutMs`) → degraded.
//   - a missing probe, or a non-finite/negative latency           → degraded (fail-closed).
//   - otherwise (available AND answered within the timeout)       → NOT degraded.
//
// An independent oracle re-derives the verdict from the generated probe and
// timeout, and the test asserts `isDegraded` agrees on every input.

const NUM_RUNS = 100;

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** A configured timeout: a positive-finite value, or a degenerate one that
 *  must fall back to the 5000ms default. */
const timeoutArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 1, max: 60_000 }) },
  // Degenerate timeouts — `isDegraded` falls back to DEFAULT_AGENT_PROBE_TIMEOUT_MS.
  {
    weight: 1,
    arbitrary: fc.constantFrom(0, -1, -5000, Number.NaN, Infinity, -Infinity),
  },
);

/** A latency value, spanning valid, boundary, and fail-closed (non-finite/negative) cases. */
const latencyArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 60_000 }) },
  { weight: 2, arbitrary: fc.double({ min: 0, max: 60_000, noNaN: true }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(-1, -100, Number.NaN, Infinity, -Infinity),
  },
);

const probeArb: fc.Arbitrary<AvailabilityProbe> = fc.record({
  available: fc.boolean(),
  latencyMs: latencyArb,
});

/** A probe, or a missing result (null/undefined) the check could not produce. */
const maybeProbeArb: fc.Arbitrary<AvailabilityProbe | null | undefined> =
  fc.oneof(
    { weight: 8, arbitrary: probeArb },
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constant(undefined) },
  );

// ── Oracle ───────────────────────────────────────────────────────────────────

function isPositiveFinite(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Independent re-derivation of the degradation verdict. */
function oracleDegraded(
  probe: AvailabilityProbe | null | undefined,
  timeoutMs: number,
): boolean {
  if (probe == null) return true;
  if (probe.available !== true) return true;
  const effectiveTimeout = isPositiveFinite(timeoutMs)
    ? timeoutMs
    : DEFAULT_AGENT_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(probe.latencyMs) || probe.latencyMs < 0) return true;
  return probe.latencyMs > effectiveTimeout;
}

// ──────────────────────────────────────────────────────────────────────────────
// Property 3 (decision-half)
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 3: Graceful degradation (decision-half)", () => {
  it("returns true exactly when the probe is unavailable, missing, or exceeds the timeout", () => {
    fc.assert(
      fc.property(maybeProbeArb, timeoutArb, (probe, timeoutMs) => {
        expect(isDegraded(probe, timeoutMs)).toBe(
          oracleDegraded(probe, timeoutMs),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is degraded whenever the probe reports unavailable, regardless of latency or timeout", () => {
    fc.assert(
      fc.property(latencyArb, timeoutArb, (latencyMs, timeoutMs) => {
        expect(isDegraded({ available: false, latencyMs }, timeoutMs)).toBe(
          true,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is degraded for a missing probe (fail-closed) on any timeout", () => {
    fc.assert(
      fc.property(timeoutArb, (timeoutMs) => {
        expect(isDegraded(null, timeoutMs)).toBe(true);
        expect(isDegraded(undefined, timeoutMs)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("an available probe answered within a positive-finite timeout is NOT degraded", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 60_000 })
          .chain((timeoutMs) =>
            fc.record({
              timeoutMs: fc.constant(timeoutMs),
              latencyMs: fc.integer({ min: 0, max: timeoutMs }),
            }),
          ),
        ({ timeoutMs, latencyMs }) => {
          expect(isDegraded({ available: true, latencyMs }, timeoutMs)).toBe(
            false,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("an available probe whose latency strictly exceeds the timeout is degraded", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 60_000 })
          .chain((timeoutMs) =>
            fc.record({
              timeoutMs: fc.constant(timeoutMs),
              latencyMs: fc.integer({
                min: timeoutMs + 1,
                max: timeoutMs + 60_000,
              }),
            }),
          ),
        ({ timeoutMs, latencyMs }) => {
          expect(isDegraded({ available: true, latencyMs }, timeoutMs)).toBe(
            true,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("an available probe with a non-finite or negative latency is degraded (fail-closed)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(-1, -1000, Number.NaN, Infinity, -Infinity),
        timeoutArb,
        (latencyMs, timeoutMs) => {
          expect(isDegraded({ available: true, latencyMs }, timeoutMs)).toBe(
            true,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a degenerate timeout falls back to the 5000ms default for the latency comparison", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60_000 }),
        fc.constantFrom(0, -1, -5000, Number.NaN, Infinity, -Infinity),
        (latencyMs, degenerateTimeout) => {
          // With a degenerate timeout the decision must equal the decision at the default.
          expect(isDegraded({ available: true, latencyMs }, degenerateTimeout)).toBe(
            isDegraded(
              { available: true, latencyMs },
              DEFAULT_AGENT_PROBE_TIMEOUT_MS,
            ),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("uses the 5000ms default timeout when none is supplied", () => {
    expect(
      isDegraded({ available: true, latencyMs: DEFAULT_AGENT_PROBE_TIMEOUT_MS }),
    ).toBe(false);
    expect(
      isDegraded({
        available: true,
        latencyMs: DEFAULT_AGENT_PROBE_TIMEOUT_MS + 1,
      }),
    ).toBe(true);
  });
});
