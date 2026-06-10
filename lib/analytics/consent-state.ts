import type { ConsentState } from "./types";

const COOKIE_NAME = "ora_consent";
const TTL_DAYS = 365;

/**
 * Validates that a parsed value has the expected ConsentState shape.
 */
function isValidConsentState(parsed: unknown): parsed is ConsentState {
  if (parsed === null || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  return (
    obj.necessary === true &&
    typeof obj.analytics === "boolean" &&
    typeof obj.marketing === "boolean" &&
    typeof obj.timestamp === "string"
  );
}

/**
 * Server-side function that reads the `ora_consent` cookie from a
 * cookies object (compatible with Next.js `cookies()` API or Elysia request).
 *
 * @param cookies - An object with a `get(name: string)` method returning
 *   `{ value: string } | undefined`
 * @returns `ConsentState | null`
 */
export function readConsentFromRequest(
  cookies: { get(name: string): { value: string } | undefined }
): ConsentState | null {
  const cookie = cookies.get(COOKIE_NAME);
  if (!cookie) return null;

  try {
    const decoded = decodeURIComponent(cookie.value);
    const parsed: unknown = JSON.parse(decoded);
    if (!isValidConsentState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Reads the ora_consent cookie from document.cookie, parses the JSON,
 * and returns the ConsentState or null if not found/malformed.
 */
export function getConsentState(): ConsentState | null {
  try {
    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.split("=");
      if (name.trim() === COOKIE_NAME) {
        const value = decodeURIComponent(valueParts.join("=").trim());
        const parsed = JSON.parse(value) as ConsentState;
        // Basic shape validation
        if (
          parsed &&
          parsed.necessary === true &&
          typeof parsed.analytics === "boolean" &&
          typeof parsed.marketing === "boolean" &&
          typeof parsed.timestamp === "string"
        ) {
          return parsed;
        }
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serializes the ConsentState to JSON and writes it to the ora_consent cookie
 * with a 365-day TTL, path=/, SameSite=Lax.
 */
export function setConsentState(state: ConsentState): void {
  const maxAge = TTL_DAYS * 24 * 60 * 60;
  const value = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${COOKIE_NAME}=${value}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

/**
 * Returns true if the ora_consent cookie exists and is parseable as a valid ConsentState.
 */
export function hasConsentBeenGiven(): boolean {
  return getConsentState() !== null;
}
