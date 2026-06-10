import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readAttributionCookie, readAttributionFromRequest } from "./attribution";
import type { AttributionData } from "./types";

const validAttribution: AttributionData = {
  first_touch: {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "marina_q1_awareness",
    referrer: "https://google.com",
    landing_path: "/projects/marina",
    timestamp: "2024-01-15T10:30:00.000Z",
  },
  last_touch: {
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "marina_q1_retargeting",
    referrer: "https://facebook.com",
    landing_path: "/projects/marina/units",
    timestamp: "2024-01-20T14:00:00.000Z",
  },
  touches: [
    {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "marina_q1_awareness",
      referrer: "https://google.com",
      landing_path: "/projects/marina",
      timestamp: "2024-01-15T10:30:00.000Z",
    },
    {
      utm_source: "facebook",
      utm_medium: "paid_social",
      utm_campaign: "marina_q1_retargeting",
      referrer: "https://facebook.com",
      landing_path: "/projects/marina/units",
      timestamp: "2024-01-20T14:00:00.000Z",
    },
  ],
};

describe("readAttributionCookie", () => {
  beforeEach(() => {
    // Set up document.cookie as a writable property
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
    });
  });

  it("returns null when no ora_attribution cookie exists", () => {
    document.cookie = "other_cookie=value; another=test";
    expect(readAttributionCookie()).toBeNull();
  });

  it("returns null when document.cookie is empty", () => {
    document.cookie = "";
    expect(readAttributionCookie()).toBeNull();
  });

  it("parses a valid attribution cookie", () => {
    const encoded = encodeURIComponent(JSON.stringify(validAttribution));
    document.cookie = `ora_attribution=${encoded}`;
    const result = readAttributionCookie();
    expect(result).toEqual(validAttribution);
  });

  it("parses attribution cookie among other cookies", () => {
    const encoded = encodeURIComponent(JSON.stringify(validAttribution));
    document.cookie = `session=abc123; ora_attribution=${encoded}; theme=dark`;
    const result = readAttributionCookie();
    expect(result).toEqual(validAttribution);
  });

  it("returns null for malformed JSON", () => {
    document.cookie = "ora_attribution=not-valid-json";
    expect(readAttributionCookie()).toBeNull();
  });

  it("returns null when first_touch is missing", () => {
    const invalid = { last_touch: validAttribution.last_touch, touches: [] };
    document.cookie = `ora_attribution=${encodeURIComponent(JSON.stringify(invalid))}`;
    expect(readAttributionCookie()).toBeNull();
  });

  it("returns null when last_touch is missing", () => {
    const invalid = { first_touch: validAttribution.first_touch, touches: [] };
    document.cookie = `ora_attribution=${encodeURIComponent(JSON.stringify(invalid))}`;
    expect(readAttributionCookie()).toBeNull();
  });

  it("returns null when touches is not an array", () => {
    const invalid = {
      first_touch: validAttribution.first_touch,
      last_touch: validAttribution.last_touch,
      touches: "not-an-array",
    };
    document.cookie = `ora_attribution=${encodeURIComponent(JSON.stringify(invalid))}`;
    expect(readAttributionCookie()).toBeNull();
  });

  it("returns null when first_touch is null", () => {
    const invalid = {
      first_touch: null,
      last_touch: validAttribution.last_touch,
      touches: [],
    };
    document.cookie = `ora_attribution=${encodeURIComponent(JSON.stringify(invalid))}`;
    expect(readAttributionCookie()).toBeNull();
  });

  it("returns null when first_touch is an array", () => {
    const invalid = {
      first_touch: [],
      last_touch: validAttribution.last_touch,
      touches: [],
    };
    document.cookie = `ora_attribution=${encodeURIComponent(JSON.stringify(invalid))}`;
    expect(readAttributionCookie()).toBeNull();
  });

  it("handles cookie value with equals signs in JSON", () => {
    // JSON with base64-like values containing =
    const data: AttributionData = {
      first_touch: {
        gclid: "abc123==",
        referrer: "",
        landing_path: "/",
        timestamp: "2024-01-15T10:30:00.000Z",
      },
      last_touch: {
        gclid: "abc123==",
        referrer: "",
        landing_path: "/",
        timestamp: "2024-01-15T10:30:00.000Z",
      },
      touches: [],
    };
    const encoded = encodeURIComponent(JSON.stringify(data));
    document.cookie = `ora_attribution=${encoded}`;
    expect(readAttributionCookie()).toEqual(data);
  });
});

describe("readAttributionFromRequest", () => {
  it("returns null when cookie is not present", () => {
    const cookies = { get: () => undefined };
    expect(readAttributionFromRequest(cookies)).toBeNull();
  });

  it("parses a valid attribution cookie value", () => {
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution"
          ? { value: JSON.stringify(validAttribution) }
          : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toEqual(validAttribution);
  });

  it("handles URI-encoded cookie values", () => {
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution"
          ? { value: encodeURIComponent(JSON.stringify(validAttribution)) }
          : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toEqual(validAttribution);
  });

  it("returns null for malformed JSON", () => {
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution" ? { value: "{invalid" } : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toBeNull();
  });

  it("returns null when parsed value is not an object", () => {
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution" ? { value: '"just a string"' } : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toBeNull();
  });

  it("returns null when touches is missing", () => {
    const invalid = {
      first_touch: validAttribution.first_touch,
      last_touch: validAttribution.last_touch,
    };
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution"
          ? { value: JSON.stringify(invalid) }
          : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toBeNull();
  });

  it("returns valid data with empty touches array", () => {
    const data: AttributionData = {
      first_touch: validAttribution.first_touch,
      last_touch: validAttribution.last_touch,
      touches: [],
    };
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution"
          ? { value: JSON.stringify(data) }
          : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toEqual(data);
  });

  it("returns null for empty string value", () => {
    const cookies = {
      get: (name: string) =>
        name === "ora_attribution" ? { value: "" } : undefined,
    };
    expect(readAttributionFromRequest(cookies)).toBeNull();
  });
});
