import type { AttributionData, TouchRecord } from "./types";

const COOKIE_NAME = "ora_attribution";

/**
 * Validates that a parsed value has the expected AttributionData shape:
 * - first_touch and last_touch must be objects
 * - touches must be an array
 */
function isValidAttributionData(data: unknown): data is AttributionData {
  if (data === null || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;

  if (
    obj.first_touch === null ||
    typeof obj.first_touch !== "object" ||
    Array.isArray(obj.first_touch)
  )
    return false;

  if (
    obj.last_touch === null ||
    typeof obj.last_touch !== "object" ||
    Array.isArray(obj.last_touch)
  )
    return false;

  if (!Array.isArray(obj.touches)) return false;

  return true;
}

/**
 * Parses a raw cookie value string into AttributionData, returning null
 * if the value is missing, malformed JSON, or doesn't match the expected shape.
 */
function parseAttributionValue(value: string | undefined | null): AttributionData | null {
  if (!value) return null;

  try {
    const decoded = decodeURIComponent(value);
    const parsed: unknown = JSON.parse(decoded);

    if (!isValidAttributionData(parsed)) return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Client-side function that reads the `ora_attribution` cookie from
 * `document.cookie`, parses the JSON, and validates the shape.
 *
 * Returns `AttributionData | null`.
 */
export function readAttributionCookie(): AttributionData | null {
  if (typeof document === "undefined") return null;

  const cookies = document.cookie.split(";");

  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split("=");
    if (name.trim() === COOKIE_NAME) {
      const value = rest.join("=").trim();
      return parseAttributionValue(value);
    }
  }

  return null;
}

/**
 * Server-side function that reads the `ora_attribution` cookie from a
 * cookies object (compatible with Next.js `cookies()` API).
 *
 * @param cookies - An object with a `get(name: string)` method returning
 *   `{ value: string } | undefined`
 * @returns `AttributionData | null`
 */
export function readAttributionFromRequest(
  cookies: { get(name: string): { value: string } | undefined }
): AttributionData | null {
  const cookie = cookies.get(COOKIE_NAME);
  if (!cookie) return null;

  return parseAttributionValue(cookie.value);
}
