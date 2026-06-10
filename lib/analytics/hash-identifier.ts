/**
 * Hash utility for PII redaction in analytics events.
 *
 * Requirement 15.8: No raw PII (full name, email, phone) shall be stored
 * in PostHog event properties — only hashed identifiers or the PostHog
 * distinct ID shall be used for person identification in analytics.
 */

import { createHash } from "crypto";

/**
 * Hashes a PII value (email, phone, etc.) with SHA-256 to produce a
 * privacy-safe distinct ID for PostHog. The value is trimmed and
 * lowercased before hashing to ensure consistent output.
 *
 * @param value - The raw PII string (email, phone number, etc.)
 * @returns A hex-encoded SHA-256 hash of the normalised value
 */
export function hashIdentifier(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}
