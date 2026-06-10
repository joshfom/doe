import type { PlatformConversionPayload } from "./index";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

/**
 * Maps internal event names to Bing UET goal names.
 */
function mapEventName(event: string): string {
  switch (event) {
    case "lead_qualified":
      return "submit_lead_form";
    case "viewing_confirmed":
      return "book_appointment";
    case "reservation_completed":
      return "purchase";
    default:
      return event;
  }
}

/**
 * Sends a conversion event to Bing UET (Microsoft Advertising) server events.
 *
 * Requires env vars:
 * - BING_UET_TAG_ID: The Bing UET tag ID
 * - BING_UET_API_TOKEN: The Microsoft Advertising API access token
 *
 * Includes click ID (msclkid) or hashed PII, conversion value, and dedup event ID.
 * Retries 3x with exponential backoff (1s, 2s, 4s).
 */
export async function sendBingConversion(
  payload: PlatformConversionPayload
): Promise<void> {
  const tagId = process.env.BING_UET_TAG_ID;
  const apiToken = process.env.BING_UET_API_TOKEN;

  if (!tagId || !apiToken) {
    return; // Not configured, skip silently
  }

  const eventData: Record<string, unknown> = {
    event_type: "custom",
    event_category: mapEventName(payload.event),
    event_label: payload.event,
    event_id: payload.eventId,
    tag_id: tagId,
    timestamp: payload.timestamp,
  };

  // Include click ID if available
  if (payload.clickIds.msclkid) {
    eventData.msclkid = payload.clickIds.msclkid;
  }

  // Include hashed PII for enhanced conversions
  const hashedData: Record<string, string> = {};
  if (payload.hashedEmail) {
    hashedData.hashed_email = payload.hashedEmail;
  }
  if (payload.hashedPhone) {
    hashedData.hashed_phone = payload.hashedPhone;
  }
  if (Object.keys(hashedData).length > 0) {
    eventData.enhanced_conversions = hashedData;
  }

  // Include conversion value
  if (payload.conversionValue != null) {
    eventData.revenue_value = payload.conversionValue;
    eventData.revenue_currency = payload.currency;
  }

  const url = "https://bat.bing.com/api/conversions";
  const body = JSON.stringify({ events: [eventData] });

  await retryWithBackoff(url, body, apiToken);
}

async function retryWithBackoff(
  url: string,
  body: string,
  apiToken: string
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
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
          `[capi/bing] Failed after ${MAX_RETRIES} retries: ${response.status} ${text}`
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
