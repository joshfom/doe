/**
 * Agent-First Home / Briefing Surface (S5) — phone redaction
 * (Design §Components #9 "OTP, permission & privacy"; Requirements 2.7, 9.4, 13.4).
 *
 * This is the home surface's last-line, defence-in-depth privacy guard. It is
 * the PURE, recursive scrub the Home_Agent and Briefing_Workflow apply to
 * ANYTHING bound for:
 *
 *   - Briefing content presented on the Home_Surface — a Stack_Item that
 *     references a lead or person must carry no raw phone, full or partial
 *     (Requirement 2.7),
 *   - a chat answer or Briefing narration the Home_Agent is about to return,
 *     and the SSE_Event_Bus payloads the surface publishes (Requirement 13.4),
 *   - any record bound for the Audit_Log (Requirement 9.4),
 *
 * so that no raw phone number — whether a COMPLETE number or any DIGIT
 * SUBSTRING of one, including a last-four-digits fragment — ever leaves the
 * home surface.
 *
 * REUSE (the one rule, not reinvented): S5 introduces NO new redaction or
 * hashing convention. It composes the proven S1/S4 phone-redaction helper
 * verbatim — `redactPhones` from `lib/cms/agents/reporting/redact.ts`, which
 * itself reuses the S1 tracing sanitiser (`sanitizeEvent` / `PHONE_TOKEN`,
 * `lib/cms/agents/tracing.ts`) for COMPLETE phone-shaped tokens (replaced with
 * the salted SHA-256 `phone_hash`, the same `${PHONE_HASH_SALT}:${e164}`
 * convention the voice surface uses, or a fixed `[redacted-phone]` marker when
 * no salt is configured) and adds a FRAGMENT pass that catches a last-four (or
 * longer) digit substring of any known raw phone. The home surface re-exports
 * that single shared helper so the Briefing, SSE, and audit paths all share one
 * audited redaction convention with the reporting twin.
 *
 * Design references: §Components #9, §Correctness Properties (Property 8).
 * Requirements: 2.7, 9.4, 13.4.
 */

import { redactPhones, redactPhonesInString } from "../reporting/redact";

export {
  /** Recursive, pure phone redaction for any JSON-like value (the shared S1/S4 helper). */
  redactPhones,
  /** String-level convenience form of {@link redactPhones} for a single narration string. */
  redactPhonesInString,
  /** Fixed marker substituted for a redacted fragment (or an unsalted complete number). */
  REDACTED_PHONE_MARKER,
  /** Default minimum digit-run length treated as a redactable fragment (4 — the last-four). */
  DEFAULT_MIN_FRAGMENT_DIGITS,
} from "../reporting/redact";

export type { RedactPhonesOptions } from "../reporting/redact";

/**
 * Redact every raw phone number from a piece of Briefing content, an SSE
 * payload, or an audit record before it leaves the home surface
 * (Requirements 2.7, 9.4, 13.4).
 *
 * This is the home surface's named entry point onto the shared S1/S4 redaction
 * convention: a thin, intention-revealing alias of {@link redactPhones} that
 * documents the three home egress points (Briefing, SSE, audit) at the call
 * site. It adds no behaviour of its own — it IS the reused helper — so the
 * privacy guarantee proven for the reporting twin holds identically here.
 *
 * Pure and recursive over strings, arrays, and plain objects; numbers,
 * booleans, `null`, and `undefined` pass through unchanged.
 */
export function redactHomeContent<T>(
  value: T,
  options: import("../reporting/redact").RedactPhonesOptions = {},
): T {
  return redactPhones(value, options);
}
