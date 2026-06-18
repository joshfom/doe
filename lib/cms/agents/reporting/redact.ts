/**
 * Agentic Reporting & C-Level Twin (S4) — phone redaction
 * (Design §Components #9 "Dispatcher boundary, audit, and phone privacy").
 *
 * This is a PURE, recursive redaction module. It performs no I/O and no
 * database access. It is the last-line, defence-in-depth guard the
 * Reporting_Agent applies to ANYTHING bound for:
 *
 *   - narration the agent is about to speak/return,
 *   - a payload it is about to publish to the SSE_Event_Bus,
 *   - a record it is about to write to the Audit_Log, and
 *   - the structured content of a Chart_Artifact or Report_Export.
 *
 * so that no raw phone number — whether a COMPLETE number or any DIGIT
 * SUBSTRING of one, including a last-four-digits fragment — ever leaves the
 * agent (Requirement 12.1, 12.3, 12.4).
 *
 * REUSE (the one rule, not reinvented): the COMPLETE-number redaction reuses
 * the proven tracing sanitiser convention verbatim — `sanitizeEvent` and its
 * `PHONE_TOKEN` matcher from `lib/cms/agents/tracing.ts`, which replaces a
 * phone-shaped token with the salted SHA-256 `phone_hash` (the same
 * `${PHONE_HASH_SALT}:${e164}` convention the voice surface uses), or with a
 * fixed `[redacted-phone]` marker when no salt is configured. S4 adds NO new
 * hashing convention; it composes the S1 one (Requirement 12.2, 16.4).
 *
 * On top of that complete-token pass, this module adds a FRAGMENT pass that
 * catches partial phone digits — most importantly a last-four-digits fragment
 * such as `…ending in 4567` — which the complete-token matcher deliberately
 * ignores (a bare 4-digit run is indistinguishable from a metric figure on its
 * own). A fragment can only be told apart from a legitimate analytics figure
 * when the source phone is known, so the fragment pass is keyed to a supplied
 * set of `knownPhones` (the raw phones present in the agent's working context,
 * if any): any digit run of `minFragmentDigits` (default 4 — the last-four) or
 * more that is a contiguous substring of a known phone's digits is redacted.
 * In normal operation the agent never holds a raw phone (records carry only the
 * salted `phone_hash`), so `knownPhones` is typically empty and the
 * complete-token guard alone is in force.
 *
 * Design references: §Components #9, §Correctness Properties (Property 12).
 * Requirements: 12.1, 12.3, 12.4 (and the privacy clauses 6.4, 7.6, 10.2 the
 * agent enforces through this module).
 */

import { sanitizeEvent } from "../tracing";

/** Fixed marker used when a fragment (or an unsalted complete number) is redacted. */
export const REDACTED_PHONE_MARKER = "[redacted-phone]";

/**
 * The minimum digit-run length treated as a redactable phone fragment. Defaults
 * to 4 so a last-four-digits fragment is always caught (Requirement 12.1, 12.3,
 * 12.4) while leaving shorter incidental digit runs untouched.
 */
export const DEFAULT_MIN_FRAGMENT_DIGITS = 4;

/**
 * Matches an already-inserted redaction token so the fragment pass never
 * re-scans the hex of a `phone_hash:` value (whose digits could coincidentally
 * look like a fragment) nor the marker itself.
 */
const PROTECTED_TOKEN = /phone_hash:[0-9a-f]+|\[redacted-phone\]/g;

/** A maximal run of decimal digits. */
const DIGIT_RUN = /\d+/g;

export interface RedactPhonesOptions {
  /**
   * Salt for the salted-hash replacement of COMPLETE phone tokens. Defaults to
   * the `PHONE_HASH_SALT` environment variable (via the reused tracing
   * sanitiser). When no salt is resolvable the token is replaced with
   * {@link REDACTED_PHONE_MARKER} so a raw number can never leak even in a
   * misconfigured environment.
   */
  salt?: string;
  /**
   * Raw phone numbers known to be present in the agent's working context. Each
   * is normalised to its digit sequence; any digit run of
   * {@link RedactPhonesOptions.minFragmentDigits} or more that is a contiguous
   * substring of one of these is redacted, catching last-four-digits and other
   * partial fragments the complete-token matcher cannot identify on its own
   * (Requirement 12.1, 12.3, 12.4). Typically empty — the agent references
   * phones only by salted `phone_hash` (Requirement 12.2).
   */
  knownPhones?: readonly string[];
  /**
   * Smallest digit-run length treated as a redactable fragment of a known
   * phone. Defaults to {@link DEFAULT_MIN_FRAGMENT_DIGITS} (4 — the last-four).
   */
  minFragmentDigits?: number;
}

/** Strip every non-digit character, yielding a phone's bare digit sequence. */
function toDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * True when `run` shares a contiguous digit window of length `minLen` with any
 * of the known phone digit sequences — i.e. `run` contains (or is contained by)
 * a fragment of a known phone of at least the last-four length. Conservative:
 * one matching window redacts the whole run.
 */
function runMatchesKnownPhone(
  run: string,
  knownDigits: readonly string[],
  minLen: number,
): boolean {
  if (run.length < minLen) return false;
  for (const digits of knownDigits) {
    for (let i = 0; i + minLen <= run.length; i++) {
      if (digits.includes(run.slice(i, i + minLen))) return true;
    }
  }
  return false;
}

/**
 * Redact known-phone digit fragments from a single string, skipping any region
 * that is already a redaction token (a `phone_hash:` value or the marker) so the
 * complete-token pass's output is never corrupted.
 */
function redactFragmentsInString(
  input: string,
  knownDigits: readonly string[],
  minLen: number,
): string {
  if (knownDigits.length === 0) return input;

  let out = "";
  let lastIndex = 0;
  PROTECTED_TOKEN.lastIndex = 0;

  const scrubGap = (gap: string): string =>
    gap.replace(DIGIT_RUN, (run) =>
      runMatchesKnownPhone(run, knownDigits, minLen) ? REDACTED_PHONE_MARKER : run,
    );

  for (let m = PROTECTED_TOKEN.exec(input); m !== null; m = PROTECTED_TOKEN.exec(input)) {
    out += scrubGap(input.slice(lastIndex, m.index));
    out += m[0]; // preserve the protected token verbatim
    lastIndex = m.index + m[0].length;
  }
  out += scrubGap(input.slice(lastIndex));
  return out;
}

/** Recursively apply a string transform across a JSON-like value, in place of shape. */
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = mapStrings(v, fn);
    }
    return out;
  }
  return value;
}

/**
 * Redact every raw phone number from a JSON-like value before the agent
 * narrates it, publishes it to the SSE bus, writes it to the audit log, or
 * embeds it in a chart/export artifact (Requirement 12.1, 12.3, 12.4).
 *
 * Two passes, in order:
 *   1. COMPLETE-number redaction via the reused tracing convention
 *      (`sanitizeEvent` / `PHONE_TOKEN`): any phone-shaped token becomes the
 *      salted `phone_hash` (or {@link REDACTED_PHONE_MARKER} with no salt).
 *   2. FRAGMENT redaction for any supplied `knownPhones`: any digit run that is
 *      a contiguous substring (≥ `minFragmentDigits`) of a known phone — a
 *      last-four-digits fragment and longer — is replaced with the marker,
 *      while already-redacted `phone_hash:` tokens are preserved verbatim.
 *
 * Pure and recursive over strings, arrays, and plain objects; numbers,
 * booleans, `null`, and `undefined` pass through unchanged. Intended for the
 * JSON-like content the agent emits (narration text, SSE payloads, audit
 * records, structured artifact data); raw binary artifact bytes are not text
 * and are handled at their source, where figures never contain phones.
 */
export function redactPhones<T>(value: T, options: RedactPhonesOptions = {}): T {
  const minLen = options.minFragmentDigits ?? DEFAULT_MIN_FRAGMENT_DIGITS;

  // Pass 1 — reuse the S1 tracing convention for complete phone tokens.
  const hashed = sanitizeEvent(value, options.salt);

  // Pass 2 — scrub residual known-phone fragments (last-four and longer).
  const knownDigits = (options.knownPhones ?? [])
    .map(toDigits)
    .filter((d) => d.length >= minLen);
  if (knownDigits.length === 0) return hashed;

  return mapStrings(hashed, (s) =>
    redactFragmentsInString(s, knownDigits, minLen),
  ) as T;
}

/**
 * Convenience string-level form of {@link redactPhones} for the common case of
 * redacting a single narration string. Equivalent to `redactPhones(text, opts)`
 * when `text` is a string.
 */
export function redactPhonesInString(
  text: string,
  options: RedactPhonesOptions = {},
): string {
  return redactPhones(text, options);
}
