import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { AttributionData, ConsentState } from "../types";
import { sendMetaConversion } from "./meta";
import { sendGoogleConversion } from "./google";
import { sendTikTokConversion } from "./tiktok";
import { sendBingConversion } from "./bing";

/**
 * Data passed to the CAPI dispatcher for a server-side conversion event.
 */
export interface ConversionData {
  event: string; // e.g., "lead_qualified"
  email?: string;
  phone?: string;
  attribution?: AttributionData | null;
  conversionValue?: number;
  currency?: string;
}

/**
 * Normalised payload sent to each platform module.
 */
export interface PlatformConversionPayload {
  event: string;
  eventId: string; // UUID for deduplication
  hashedEmail?: string; // SHA-256 lowercase hex
  hashedPhone?: string; // SHA-256 lowercase hex
  clickIds: {
    gclid?: string;
    fbclid?: string;
    ttclid?: string;
    msclkid?: string;
  };
  conversionValue?: number;
  currency: string;
  timestamp: string; // ISO 8601
}

/**
 * Hashes a string with SHA-256 (lowercase, trimmed).
 */
export function hashPii(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

/**
 * Checks whether CAPI is enabled via environment variable or feature flag.
 */
function isCapiEnabled(): boolean {
  return process.env.CAPI_ENABLED === "true";
}

/**
 * Sends a server-side conversion event to all configured ad platforms.
 *
 * - Checks if CAPI is enabled (env var / feature flag)
 * - Checks marketing consent from the provided consent state
 * - Fans out to all configured platform modules in parallel
 * - Logs errors but does not throw (fire-and-forget)
 *
 * @param data - The conversion event data
 * @param consent - The visitor's consent state (null means no consent given)
 */
export async function sendConversion(
  data: ConversionData,
  consent: ConsentState | null
): Promise<void> {
  // Check feature flag / env var
  if (!isCapiEnabled()) {
    return;
  }

  // Check marketing consent — requirement 14.6
  if (!consent || consent.marketing !== true) {
    return;
  }

  // Build normalised payload
  const eventId = randomUUID();
  const clickIds: PlatformConversionPayload["clickIds"] = {};

  if (data.attribution) {
    const lastTouch = data.attribution.last_touch;
    if (lastTouch.gclid) clickIds.gclid = lastTouch.gclid;
    if (lastTouch.fbclid) clickIds.fbclid = lastTouch.fbclid;
    if (lastTouch.ttclid) clickIds.ttclid = lastTouch.ttclid;
    if (lastTouch.msclkid) clickIds.msclkid = lastTouch.msclkid;
  }

  const payload: PlatformConversionPayload = {
    event: data.event,
    eventId,
    hashedEmail: data.email ? hashPii(data.email) : undefined,
    hashedPhone: data.phone ? hashPii(data.phone) : undefined,
    clickIds,
    conversionValue: data.conversionValue,
    currency: data.currency ?? "AED",
    timestamp: new Date().toISOString(),
  };

  // Fan out to all platforms in parallel — fire-and-forget
  const platforms = [
    sendMetaConversion(payload),
    sendGoogleConversion(payload),
    sendTikTokConversion(payload),
    sendBingConversion(payload),
  ];

  const results = await Promise.allSettled(platforms);

  // Log any failures but don't throw
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[capi] Platform delivery failed:", result.reason);
    }
  }
}
