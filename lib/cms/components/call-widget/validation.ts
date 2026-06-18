/**
 * DOE Call Widget — pure pre-call form validation.
 *
 * These helpers are deliberately free of React and browser APIs so the
 * client-side validation rules (FR-W2 / Requirements 1.3, 1.4, 1.5, 1.6) can be
 * unit-tested in isolation and reused by both the form UI and any server-side
 * re-validation. The widget UI layers `intl-tel-input` on top for the country
 * selector + E.164 formatting (defaulting to +971), but the submit gate always
 * resolves through these functions.
 *
 * Design reference: §7.1 (call widget pre-call form).
 */

import type { CreateVoiceSessionInput } from "@/lib/cms/voice/contracts";

/** Default country for the phone selector — UAE (+971). (Requirement 1.3) */
export const DEFAULT_COUNTRY_ISO2 = "ae" as const;

/** Dial code matching {@link DEFAULT_COUNTRY_ISO2}. */
export const DEFAULT_DIAL_CODE = "+971" as const;

/**
 * E.164 format: a leading `+`, a non-zero country-code digit, then 6–14 more
 * digits (total 7–15 digits, per the E.164 maximum of 15). No spaces or
 * separators — the widget normalises to this canonical form before submit.
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Pragmatic RFC-compatible email pattern (the WHATWG/HTML5 email validation
 * regex). Mirrors the server-side `z.string().email()` used by
 * `createVoiceSessionInputSchema` so client and server agree. (Requirement 1.4)
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** True when `value` is a syntactically valid E.164 phone number. */
export function isValidE164(value: string): boolean {
  if (typeof value !== "string") return false;
  return E164_REGEX.test(value.trim());
}

/** True when `value` matches RFC email format. */
export function isValidEmail(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  // Guard against the regex accepting pathological lengths.
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/** Editable state of the pre-call form. */
export interface PreCallFormState {
  /** Raw E.164 value emitted by the phone input. */
  phone: string;
  /**
   * Validity reported by `intl-tel-input` (which knows per-country number
   * rules). When omitted (e.g. in pure tests) we fall back to {@link isValidE164}.
   */
  phoneValid?: boolean;
  email: string;
  /** Optional — submission is permitted when empty (Requirement 1.6). */
  name: string;
  /** Required consent (Requirement 1.5). */
  consent: boolean;
}

/** Resolve whether the phone field is acceptable for submission. */
export function isPhoneAcceptable(state: PreCallFormState): boolean {
  const libValid = state.phoneValid;
  if (typeof libValid === "boolean") {
    // The phone library validated per-country; still require E.164 shape so a
    // valid-but-unnormalised value can't slip through.
    return libValid && isValidE164(state.phone);
  }
  return isValidE164(state.phone);
}

/**
 * The submit gate. Returns true only when phone is a valid E.164 number, email
 * is RFC-valid, and consent is checked. The name is intentionally not required.
 * (Requirements 1.5, 1.6)
 */
export function canSubmitPreCall(state: PreCallFormState): boolean {
  return (
    isPhoneAcceptable(state) &&
    isValidEmail(state.email) &&
    state.consent === true
  );
}

/**
 * Build the typed `POST /api/voice/sessions` body from form state, or `null`
 * when the form is not yet submittable. The optional `page` is the widget's
 * source/utm passthrough. The shape matches `createVoiceSessionInputSchema`.
 */
export function buildSessionInput(
  state: PreCallFormState,
  page?: string,
): CreateVoiceSessionInput | null {
  if (!canSubmitPreCall(state)) return null;
  const name = state.name.trim();
  return {
    phone: state.phone.trim(),
    email: state.email.trim(),
    consent: true,
    ...(name ? { name } : {}),
    ...(page ? { page } : {}),
  };
}
