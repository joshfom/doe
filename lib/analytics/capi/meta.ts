import type { PlatformConversionPayload } from "./index";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

/**
 * Maps internal event names to Meta CAPI standard event names.
 */
function mapEventName(event: string): string {
  switch (event) {
    case "lead_qualified":
      return "Lead";
    case "viewing_confirmed":
      return "Schedule";
    case "reservation_completed":
      return "Purchase";
    default:
      return event;
  }
}

/**
 * Sends a conversion event to Meta Conversions API.
 *
 * Requires env vars:
 * - META_PIXEL_ID: The Meta Pixel ID
 * - META_CAPI_ACCESS_TOKEN: The Meta CAPI access token
 *
 * Includes click ID (fbclid) or hashed PII, conversion value, and dedup event ID.
 * Retries 3x with exponential backoff (1s, 2s, 4s).
 */
export async function sendMetaConversion(
  payload: PlatformConversionPayload
): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return; // Not configured, skip silently
  }

  const userData: Record<string, string | string[]> = {};

  // Include click ID if available
  if (payload.clickIds.fbclid) {
    userData.fbc = `fb.1.${Date.now()}.${payload.clickIds.fbclid}`;
  }

  // Include hashed PII
  if (payload.hashedEmail) {
    userData.em = [payload.hashedEmail];
  }
  if (payload.hashedPhone) {
    userData.ph = [payload.hashedPhone];
  }

  const eventData = {
    event_name: mapEventName(payload.event),
    event_time: Math.floor(new Date(payload.timestamp).getTime() / 1000),
    event_id: payload.eventId,
    action_source: "website" as const,
    user_data: userData,
    ...(payload.conversionValue != null && {
      custom_data: {
        value: payload.conversionValue,
        currency: payload.currency,
      },
    }),
  };

  const url = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`;
  const body = JSON.stringify({ data: [eventData] });

  await retryWithBackoff(url, body);
}

async function retryWithBackoff(url: string, body: string): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return;
      }

      // On last attempt, throw with details
      if (attempt === MAX_RETRIES) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `[capi/meta] Failed after ${MAX_RETRIES} retries: ${response.status} ${text}`
        );
      }
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
