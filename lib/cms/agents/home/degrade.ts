/**
 * Agent-First Home / Briefing Surface (S5) — degradation decision
 * (Design §Architecture "Degradation & the Classic_Panel"; Requirements 11.1–11.3).
 *
 * `isDegraded` is a PURE total decision function. It performs NO I/O — it does
 * not call the health endpoint, does not run a timer, and does not touch the
 * Mastra_Runtime. It only DECIDES, from an already-collected
 * `Agent_Availability_Check` result (the `probe`) and the configured timeout,
 * whether the Home_Surface must enter Degraded_Mode and present the
 * Classic_Panel navigation in place of the agent-first experience.
 *
 * The probe itself (firing `GET /home/health`, racing it against a timeout,
 * recording the round-trip latency) is performed by the surface's
 * `useAgentAvailability` hook (task 12); this module is the pure decision that
 * hook applies to the probe it gathered, which keeps the rule directly testable
 * in isolation (Property 3).
 *
 * The decision rule (Requirements 11.2, 11.3):
 *
 *   - The probe reports the Home_Agent / Mastra_Runtime UNAVAILABLE
 *     (`available === false`)                                      → degraded.
 *   - The probe's round-trip LATENCY EXCEEDS the timeout
 *     (`latencyMs > timeoutMs`), i.e. the check did not complete in
 *     time                                                          → degraded.
 *   - Otherwise (available and answered within the timeout)         → not degraded.
 *
 * Fail-closed: a missing/absent probe (the check could not produce a result at
 * all — e.g. the request threw or never resolved) is treated as UNAVAILABLE and
 * therefore degraded, never as available. Likewise a non-finite or negative
 * latency is treated as not having completed within the timeout. The surface
 * must never render the agent-first experience on an indeterminate probe.
 *
 * Design references: §Architecture (Degradation), §Error Handling.
 * Requirements: 11.1, 11.2, 11.3.
 */

/**
 * The result of an `Agent_Availability_Check` against the Home_Agent and the
 * Mastra_Runtime — the input to the degradation decision.
 *
 * This is the canonical shape `GET /home/health` returns and `isDegraded`
 * consumes; the surface hook (task 12) and the home routes (task 11) share it.
 *
 *   - `available` — whether the probe observed the Home_Agent / Mastra_Runtime
 *     as responsive.
 *   - `latencyMs` — the probe's round-trip latency in milliseconds; compared
 *     against the configured timeout to detect a check that did not complete in
 *     time (Requirement 11.3).
 */
export interface AvailabilityProbe {
  /** True when the probe observed the Home_Agent / Mastra_Runtime as responsive. */
  available: boolean;
  /** Round-trip latency of the probe, in milliseconds. */
  latencyMs: number;
}

/**
 * Default `Agent_Availability_Check` timeout: 5 seconds (Requirement 11.1).
 * The timeout is configurable; this is the value used when a caller supplies
 * none.
 */
export const DEFAULT_AGENT_PROBE_TIMEOUT_MS = 5000;

function isPositiveFinite(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Decide whether the Home_Surface must enter Degraded_Mode.
 *
 * Pure and total: every input maps to a boolean with no side effects. Returns
 * `true` when the surface must fall back to the Classic_Panel navigation, and
 * `false` only when the probe is affirmatively available and answered within
 * the timeout.
 *
 * @param probe     the `Agent_Availability_Check` result. A `null`/`undefined`
 *                  probe (the check produced no result) is treated as
 *                  unavailable → degraded (fail-closed).
 * @param timeoutMs the configured check timeout in milliseconds; defaults to
 *                  {@link DEFAULT_AGENT_PROBE_TIMEOUT_MS} (5000). A non-positive
 *                  or non-finite value falls back to the default.
 * @returns `true` if the surface must degrade to the Classic_Panel, else `false`.
 */
export function isDegraded(
  probe: AvailabilityProbe | null | undefined,
  timeoutMs: number = DEFAULT_AGENT_PROBE_TIMEOUT_MS
): boolean {
  // Fail-closed: no probe result means the check could not confirm availability.
  if (probe == null) {
    return true;
  }

  // Reported unavailable (Requirement 11.2).
  if (probe.available !== true) {
    return true;
  }

  const effectiveTimeout = isPositiveFinite(timeoutMs)
    ? timeoutMs
    : DEFAULT_AGENT_PROBE_TIMEOUT_MS;

  // A non-finite or negative latency cannot be shown to have completed in time;
  // treat it as exceeding the timeout (fail-closed).
  if (!Number.isFinite(probe.latencyMs) || probe.latencyMs < 0) {
    return true;
  }

  // Latency exceeded the timeout: the check did not complete in time (Req 11.3).
  if (probe.latencyMs > effectiveTimeout) {
    return true;
  }

  // Available and answered within the timeout.
  return false;
}
