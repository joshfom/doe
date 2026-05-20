import type { PlatformConversionPayload } from "./index";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

/**
 * Maps internal event names to Google Ads conversion action labels.
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
 * Sends a conversion event to Google Ads Enhanced Conversions API.
 *
 * Requires env vars:
 * - GOOGLE_ADS_CONVERSION_ID: The Google Ads customer ID
 * - GOOGLE_ADS_CONVERSION_LABEL: The conversion action label
 * - GOOGLE_ADS_API_TOKEN: OAuth access token for the Google Ads API
 *
 * Includes click ID (gclid) or hashed PII, conversion value, and dedup event ID.
 * Retries 3x with exponential backoff (1s, 2s, 4s).
 */
export async function sendGoogleConversion(
  payload: PlatformConversionPayload
): Promise<void> {
  const conversionId = process.env.GOOGLE_ADS_CONVERSION_ID;
  const conversionLabel = process.env.GOOGLE_ADS_CONVERSION_LABEL;
  const apiToken = process.env.GOOGLE_ADS_API_TOKEN;

  if (!conversionId || !conversionLabel || !apiToken) {
    return; // Not configured, skip silently
  }

  const userIdentifiers: Record<string, string>[] = [];

  // Include hashed PII
  if (payload.hashedEmail) {
    userIdentifiers.push({ hashed_email: payload.hashedEmail });
  }
  if (payload.hashedPhone) {
    userIdentifiers.push({ hashed_phone_number: payload.hashedPhone });
  }

  const conversionData: Record<string, unknown> = {
    conversion_action: `customers/${conversionId}/conversionActions/${conversionLabel}`,
    conversion_date_time: payload.timestamp,
    order_id: payload.eventId,
    conversion_environment: "WEB",
    user_identifiers: userIdentifiers,
  };

  // Include click ID if available
  if (payload.clickIds.gclid) {
    conversionData.gclid = payload.clickIds.gclid;
  }

  // Include conversion value
  if (payload.conversionValue != null) {
    conversionData.conversion_value = payload.conversionValue;
    conversionData.currency_code = payload.currency;
  }

  const url = `https://googleads.googleapis.com/v15/customers/${conversionId}:uploadClickConversions`;
  const body = JSON.stringify({
    conversions: [conversionData],
    partial_failure: true,
  });

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
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
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
          `[capi/google] Failed after ${MAX_RETRIES} retries: ${response.status} ${text}`
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
