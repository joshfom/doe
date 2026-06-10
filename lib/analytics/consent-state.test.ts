import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getConsentState, setConsentState, hasConsentBeenGiven } from "./consent-state";
import type { ConsentState } from "./types";

describe("consent-state", () => {
  let cookieStore: string;

  beforeEach(() => {
    cookieStore = "";
    Object.defineProperty(document, "cookie", {
      get: () => cookieStore,
      set: (value: string) => {
        // Parse the cookie name=value (ignore attributes for storage)
        const [nameValue] = value.split(";");
        const [name, ...rest] = nameValue.split("=");
        const cookieName = name.trim();
        const cookieValue = rest.join("=");

        // Remove existing cookie with same name
        const cookies = cookieStore
          .split(";")
          .filter((c) => c.trim() && !c.trim().startsWith(`${cookieName}=`));

        cookies.push(`${cookieName}=${cookieValue}`);
        cookieStore = cookies.filter(Boolean).join("; ");
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getConsentState", () => {
    it("returns null when no ora_consent cookie exists", () => {
      expect(getConsentState()).toBeNull();
    });

    it("returns parsed ConsentState when cookie is valid", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: "2024-01-15T10:30:00.000Z",
      };
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(state))}`;

      const result = getConsentState();
      expect(result).toEqual(state);
    });

    it("returns null for malformed JSON", () => {
      cookieStore = `ora_consent=${encodeURIComponent("{not valid json")}`;
      expect(getConsentState()).toBeNull();
    });

    it("returns null when necessary is not true", () => {
      const invalid = {
        necessary: false,
        analytics: true,
        marketing: true,
        timestamp: "2024-01-15T10:30:00.000Z",
      };
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(invalid))}`;
      expect(getConsentState()).toBeNull();
    });

    it("returns null when analytics is not a boolean", () => {
      const invalid = {
        necessary: true,
        analytics: "yes",
        marketing: true,
        timestamp: "2024-01-15T10:30:00.000Z",
      };
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(invalid))}`;
      expect(getConsentState()).toBeNull();
    });

    it("returns null when marketing is not a boolean", () => {
      const invalid = {
        necessary: true,
        analytics: true,
        marketing: "no",
        timestamp: "2024-01-15T10:30:00.000Z",
      };
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(invalid))}`;
      expect(getConsentState()).toBeNull();
    });

    it("returns null when timestamp is not a string", () => {
      const invalid = {
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: 12345,
      };
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(invalid))}`;
      expect(getConsentState()).toBeNull();
    });

    it("handles cookie among multiple cookies", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: false,
        marketing: false,
        timestamp: "2024-06-01T00:00:00.000Z",
      };
      cookieStore = `other_cookie=abc; ora_consent=${encodeURIComponent(JSON.stringify(state))}; another=xyz`;

      const result = getConsentState();
      expect(result).toEqual(state);
    });

    it("handles cookie value containing equals signs", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: "2024-01-01T00:00:00.000Z",
      };
      // Encoded JSON may contain = in base64-like scenarios; test robustness
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(state))}`;
      expect(getConsentState()).toEqual(state);
    });
  });

  describe("setConsentState", () => {
    it("writes the ora_consent cookie with correct attributes", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: "2024-03-20T12:00:00.000Z",
      };

      // Spy on document.cookie setter
      let writtenCookie = "";
      Object.defineProperty(document, "cookie", {
        get: () => cookieStore,
        set: (value: string) => {
          writtenCookie = value;
        },
        configurable: true,
      });

      setConsentState(state);

      expect(writtenCookie).toContain("ora_consent=");
      expect(writtenCookie).toContain("max-age=31536000"); // 365 * 24 * 60 * 60
      expect(writtenCookie).toContain("path=/");
      expect(writtenCookie).toContain("SameSite=Lax");
    });

    it("serializes state as JSON in the cookie value", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: false,
        marketing: true,
        timestamp: "2024-07-04T08:00:00.000Z",
      };

      let writtenCookie = "";
      Object.defineProperty(document, "cookie", {
        get: () => cookieStore,
        set: (value: string) => {
          writtenCookie = value;
        },
        configurable: true,
      });

      setConsentState(state);

      const [nameValue] = writtenCookie.split(";");
      const [, ...valueParts] = nameValue.split("=");
      const decoded = JSON.parse(decodeURIComponent(valueParts.join("=")));
      expect(decoded).toEqual(state);
    });

    it("can be read back by getConsentState", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: "2024-12-25T00:00:00.000Z",
      };

      setConsentState(state);
      expect(getConsentState()).toEqual(state);
    });
  });

  describe("hasConsentBeenGiven", () => {
    it("returns false when no cookie exists", () => {
      expect(hasConsentBeenGiven()).toBe(false);
    });

    it("returns true when valid consent cookie exists", () => {
      const state: ConsentState = {
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: "2024-01-01T00:00:00.000Z",
      };
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify(state))}`;
      expect(hasConsentBeenGiven()).toBe(true);
    });

    it("returns false when cookie contains malformed JSON", () => {
      cookieStore = `ora_consent=${encodeURIComponent("not-json")}`;
      expect(hasConsentBeenGiven()).toBe(false);
    });

    it("returns false when cookie has invalid shape", () => {
      cookieStore = `ora_consent=${encodeURIComponent(JSON.stringify({ foo: "bar" }))}`;
      expect(hasConsentBeenGiven()).toBe(false);
    });
  });
});
