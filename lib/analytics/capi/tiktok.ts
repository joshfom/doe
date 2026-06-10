import type { PlatformConversionPayload } from "./index";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

/**
 * Maps internal event names to TikTok Events API event names.
 */
function mapEventName(event: string): string {
  switch (event) {
    case "lead_qualified":
      return "SubmitForm";
    case "viewing_confirmed":
      return "Schedule";
    case "reservation_completed":
      return "CompletePayment";
    default:
      return event;
  }
}

/**
 * Sends a conversion event to TikTok Events API.
 *
 * Requires env vars:
 * - TIKTOK_PIXEL_ID: The TikTok Pixel ID
 * - TIKTOK_EVENTS_API_TOKEN: The TikTok Events API access token
 *
 * Includes click ID (ttclid) or hashed PII, conversion value, and dedup event ID.
 * Retries 3x with exponential backoff (1s, 2s, 4s).
 */
export async function sendTikTokConversion(
  payload: PlatformConversionPayload
): Promise<void> {
  const pixelId = process.env.TIKTOK_PIXEL_ID;
  const accessToken = process.env.TIKTOK_EVENTS_API_TOKEN;

  if (!pixelId || !accessToken) {
    return; // Not configured, skip silently
  }

  const userData: Record<string, string | string[]> = {};

  // Include click ID if available
  if (payload.clickIds.ttclid) {
    userData.ttclid = payload.clickIds.ttclid;
  }

  // Include hashed PII
  if (payload.hashedEmail) {
    userData.email = [payload.hashedEmail];
  }
  if (payload.hashedPhone) {
    userData.phone = [payload.hashedPhone];
  }

  const eventData: Record<string, unknown> = {
    event: mapEventName(payload.event),
    event_id: payload.eventId,
    event_time: Math.floor(new Date(payload.timestamp).getTime() / 1000),
    user: userData,
  };

  // Include conversion value in properties
  if (payload.conversionValue != null) {
    eventData.properties = {
      value: payload.conversionValue,
      currency: payload.currency,
    };
  }

  const url = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
  const body = JSON.stringify({
    pixel_code: pixelId,
    data: [eventData],
  });

  await retryWithBackoff(url, body, accessToken);
}

async function retryWithBackoff(
  url: string,
  body: string,
  accessToken: string
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": accessToken,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return;
      }

      if (attempt === MAX_RETRIES) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `[capi/tiktok] Failed after ${MAX_RETRIES} retries: ${response.status} ${text}`
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
