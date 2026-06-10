import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendConversion, hashPii } from "./index";
import type { ConsentState, AttributionData } from "../types";

// Mock all platform modules
vi.mock("./meta", () => ({
  sendMetaConversion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./google", () => ({
  sendGoogleConversion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./tiktok", () => ({
  sendTikTokConversion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./bing", () => ({
  sendBingConversion: vi.fn().mockResolvedValue(undefined),
}));

import { sendMetaConversion } from "./meta";
import { sendGoogleConversion } from "./google";
import { sendTikTokConversion } from "./tiktok";
import { sendBingConversion } from "./bing";

describe("CAPI Dispatcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CAPI_ENABLED: "true" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validConsent: ConsentState = {
    necessary: true,
    analytics: true,
    marketing: true,
    timestamp: "2024-01-01T00:00:00Z",
  };

  const noMarketingConsent: ConsentState = {
    necessary: true,
    analytics: true,
    marketing: false,
    timestamp: "2024-01-01T00:00:00Z",
  };

  const attribution: AttributionData = {
    first_touch: {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "marina_q1_buyers",
      referrer: "https://google.com",
      landing_path: "/marina",
      timestamp: "2024-01-01T00:00:00Z",
      gclid: "test-gclid-123",
    },
    last_touch: {
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "marina_q1_retarget",
      referrer: "https://facebook.com",
      landing_path: "/marina/units",
      timestamp: "2024-01-15T00:00:00Z",
      fbclid: "test-fbclid-456",
    },
    touches: [],
  };

  it("should not send when CAPI is disabled", async () => {
    process.env.CAPI_ENABLED = "false";

    await sendConversion(
      { event: "lead_qualified", email: "test@example.com" },
      validConsent
    );

    expect(sendMetaConversion).not.toHaveBeenCalled();
    expect(sendGoogleConversion).not.toHaveBeenCalled();
    expect(sendTikTokConversion).not.toHaveBeenCalled();
    expect(sendBingConversion).not.toHaveBeenCalled();
  });

  it("should not send when CAPI_ENABLED env var is not set", async () => {
    delete process.env.CAPI_ENABLED;

    await sendConversion(
      { event: "lead_qualified", email: "test@example.com" },
      validConsent
    );

    expect(sendMetaConversion).not.toHaveBeenCalled();
  });

  it("should not send when consent is null", async () => {
    await sendConversion(
      { event: "lead_qualified", email: "test@example.com" },
      null
    );

    expect(sendMetaConversion).not.toHaveBeenCalled();
  });

  it("should not send when marketing consent is false", async () => {
    await sendConversion(
      { event: "lead_qualified", email: "test@example.com" },
      noMarketingConsent
    );

    expect(sendMetaConversion).not.toHaveBeenCalled();
  });

  it("should fan out to all platforms when enabled and consent granted", async () => {
    await sendConversion(
      {
        event: "lead_qualified",
        email: "test@example.com",
        phone: "+971501234567",
        attribution,
        conversionValue: 50000,
        currency: "AED",
      },
      validConsent
    );

    expect(sendMetaConversion).toHaveBeenCalledTimes(1);
    expect(sendGoogleConversion).toHaveBeenCalledTimes(1);
    expect(sendTikTokConversion).toHaveBeenCalledTimes(1);
    expect(sendBingConversion).toHaveBeenCalledTimes(1);
  });

  it("should include hashed email and phone in payload", async () => {
    await sendConversion(
      {
        event: "lead_qualified",
        email: "Test@Example.com",
        phone: "+971501234567",
        attribution,
      },
      validConsent
    );

    const payload = (sendMetaConversion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.hashedEmail).toBe(hashPii("Test@Example.com"));
    expect(payload.hashedPhone).toBe(hashPii("+971501234567"));
  });

  it("should extract click IDs from last touch attribution", async () => {
    await sendConversion(
      {
        event: "lead_qualified",
        email: "test@example.com",
        attribution,
      },
      validConsent
    );

    const payload = (sendMetaConversion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.clickIds.fbclid).toBe("test-fbclid-456");
  });

  it("should include conversion value and currency", async () => {
    await sendConversion(
      {
        event: "reservation_completed",
        email: "test@example.com",
        conversionValue: 1500000,
        currency: "AED",
      },
      validConsent
    );

    const payload = (sendMetaConversion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.conversionValue).toBe(1500000);
    expect(payload.currency).toBe("AED");
  });

  it("should default currency to AED", async () => {
    await sendConversion(
      {
        event: "lead_qualified",
        email: "test@example.com",
      },
      validConsent
    );

    const payload = (sendMetaConversion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.currency).toBe("AED");
  });

  it("should include a unique event ID for deduplication", async () => {
    await sendConversion(
      { event: "lead_qualified", email: "test@example.com" },
      validConsent
    );

    const payload = (sendMetaConversion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("should not throw when a platform fails", async () => {
    (sendMetaConversion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Meta API error")
    );

    // Should not throw
    await expect(
      sendConversion(
        { event: "lead_qualified", email: "test@example.com" },
        validConsent
      )
    ).resolves.toBeUndefined();
  });
});

describe("hashPii", () => {
  it("should hash email to SHA-256 lowercase hex", () => {
    const hash = hashPii("Test@Example.com");
    // SHA-256 of "test@example.com" (lowercased, trimmed)
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should normalize by trimming and lowercasing", () => {
    expect(hashPii("  Test@Example.com  ")).toBe(hashPii("test@example.com"));
  });
});
