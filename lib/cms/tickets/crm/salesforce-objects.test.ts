import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SalesforceAdapter, SfAuthError, SfHttpError } from "./salesforce";
import {
  SalesforceObjectClient,
  SfObjectNotFoundError,
  SfConfigError,
} from "./salesforce-objects";

/**
 * Unit tests for the first-class Salesforce object client (Task 2.4).
 *
 * The transport is mocked at the `fetch` boundary (the same pattern the
 * adapter's own tests use), so these tests exercise the REAL
 * `SalesforceAdapter.requestJson` / `withRetry` paths — including the
 * single-shot 401 re-auth, transient-error classification, and 404 handling —
 * end-to-end through `SalesforceObjectClient`.
 *
 * Covers Requirements 1.1, 1.3, 1.4, 1.6, 1.7, 1.9.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_TOKEN_RESPONSE = {
  access_token: "mock-access-token",
  instance_url: "https://mock-instance.salesforce.com",
  token_type: "Bearer",
};

const MOCK_CREATE_RESPONSE = {
  id: "00Q1234567890ABCDE",
  success: true,
  errors: [],
};

// ── Fetch response builders ──────────────────────────────────────────────────

function tokenOk(accessToken = "mock-access-token") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ...MOCK_TOKEN_RESPONSE, access_token: accessToken }),
  };
}

function apiJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function apiNoContent() {
  return { ok: true, status: 204, json: async () => ({}) };
}

function apiError(status: number, text = "error") {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  };
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("SalesforceObjectClient", () => {
  let adapter: SalesforceAdapter;
  let client: SalesforceObjectClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new SalesforceAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      loginUrl: "https://login.salesforce.com",
      retryBaseDelayMs: 0,
    });
    client = new SalesforceObjectClient(adapter);

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── createObject (Req 1.1) ─────────────────────────────────────────────────

  describe("createObject", () => {
    it("returns the Salesforce id on a successful create (Req 1.1)", async () => {
      fetchMock
        .mockResolvedValueOnce(tokenOk())
        .mockResolvedValueOnce(apiJson(MOCK_CREATE_RESPONSE));

      const id = await client.createObject("Lead", {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      });

      expect(id).toBe("00Q1234567890ABCDE");

      // The API call (2nd fetch) is a POST to the Lead sObject path with the
      // DOE field keys mapped to Salesforce field API names.
      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toContain("/sobjects/Lead");
      expect(options.method).toBe("POST");
      const body = JSON.parse(options.body);
      expect(body).toEqual({
        FirstName: "Jane",
        LastName: "Doe",
        Email: "jane@example.com",
      });
    });

    it("throws when Salesforce reports the create did not succeed", async () => {
      fetchMock
        .mockResolvedValueOnce(tokenOk())
        .mockResolvedValueOnce(
          apiJson({
            id: null,
            success: false,
            errors: [{ message: "Required field missing" }],
          })
        );

      await expect(
        client.createObject("Lead", { firstName: "Jane", lastName: "Doe" })
      ).rejects.toThrow("create Lead failed");
    });
  });

  // ── getObject not-found (Req 1.3) ──────────────────────────────────────────

  describe("getObject", () => {
    it("throws SfObjectNotFoundError for a missing id, not an empty success (Req 1.3)", async () => {
      fetchMock
        .mockResolvedValueOnce(tokenOk())
        .mockResolvedValueOnce(apiError(404, "Provided external ID field does not exist"));

      const error = await client
        .getObject("Lead", "00Q000000000000XXX")
        .catch((e) => e);

      expect(error).toBeInstanceOf(SfObjectNotFoundError);
      expect(error.object).toBe("Lead");
      expect(error.id).toBe("00Q000000000000XXX");

      // A 404 is terminal — it must NOT be retried.
      const apiCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes("/sobjects/Lead/")
      );
      expect(apiCalls).toHaveLength(1);
    });

    it("returns the record fields on success (Req 1.2)", async () => {
      fetchMock
        .mockResolvedValueOnce(tokenOk())
        .mockResolvedValueOnce(
          apiJson({ Id: "00Q1", FirstName: "Jane", LastName: "Doe" })
        );

      const record = await client.getObject("Lead", "00Q1");
      expect(record).toEqual({ Id: "00Q1", FirstName: "Jane", LastName: "Doe" });
    });
  });

  // ── updateObject (Req 1.4) ─────────────────────────────────────────────────

  describe("updateObject", () => {
    it("issues a PATCH against the existing record (Req 1.4)", async () => {
      fetchMock
        .mockResolvedValueOnce(tokenOk())
        .mockResolvedValueOnce(apiNoContent());

      await client.updateObject("Lead", "00Q1234567890ABCDE", {
        status: "Working",
      });

      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toContain("/sobjects/Lead/00Q1234567890ABCDE");
      expect(options.method).toBe("PATCH");
      const body = JSON.parse(options.body);
      expect(body).toEqual({ Status: "Working" });
    });
  });

  // ── 401 re-auth behavior (Req 1.6) ─────────────────────────────────────────

  describe("authentication failures", () => {
    it("re-authenticates once on a single 401 then succeeds (Req 1.6)", async () => {
      fetchMock
        // initial auth
        .mockResolvedValueOnce(tokenOk("token-1"))
        // API → 401 (token cleared, single-shot re-auth triggered)
        .mockResolvedValueOnce(apiError(401, "Session expired"))
        // re-auth
        .mockResolvedValueOnce(tokenOk("token-2"))
        // API retry succeeds
        .mockResolvedValueOnce(apiJson(MOCK_CREATE_RESPONSE));

      const id = await client.createObject("Lead", {
        firstName: "Jane",
        lastName: "Doe",
      });

      expect(id).toBe("00Q1234567890ABCDE");
      // auth, 401, re-auth, success → exactly 4 fetches (re-auth happens once).
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("surfaces SfAuthError when two consecutive 401s occur (Req 1.6)", async () => {
      fetchMock
        // initial auth
        .mockResolvedValueOnce(tokenOk("token-1"))
        // API → 401
        .mockResolvedValueOnce(apiError(401, "Session expired"))
        // re-auth
        .mockResolvedValueOnce(tokenOk("token-2"))
        // API retry → 401 again
        .mockResolvedValueOnce(apiError(401, "Session expired"));

      const error = await client
        .createObject("Lead", { firstName: "Jane", lastName: "Doe" })
        .catch((e) => e);

      expect(error).toBeInstanceOf(SfAuthError);
      // No looping beyond the single re-auth retry.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  // ── Transient retry (Req 1.7) ──────────────────────────────────────────────

  describe("transient error retry", () => {
    it("retries a transient 500 and succeeds on a later attempt (Req 1.7)", async () => {
      vi.useFakeTimers();

      fetchMock
        .mockResolvedValueOnce(tokenOk())
        // two transient failures...
        .mockResolvedValueOnce(apiError(500, "Internal Server Error"))
        .mockResolvedValueOnce(apiError(503, "Service Unavailable"))
        // ...then success
        .mockResolvedValueOnce(apiJson(MOCK_CREATE_RESPONSE));

      const promise = client.createObject("Lead", {
        firstName: "Jane",
        lastName: "Doe",
      });
      await vi.runAllTimersAsync();
      const id = await promise;

      expect(id).toBe("00Q1234567890ABCDE");
    });

    it("retries a 429 then surfaces SfHttpError after exhausting attempts (Req 1.7)", async () => {
      vi.useFakeTimers();

      // Auth once, then every API attempt returns a transient 429.
      fetchMock.mockResolvedValueOnce(tokenOk());
      fetchMock.mockResolvedValue(apiError(429, "Too Many Requests"));

      const promise = client
        .createObject("Lead", { firstName: "Jane", lastName: "Doe" })
        .catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;

      expect(error).toBeInstanceOf(SfHttpError);
      expect(error.status).toBe(429);
      expect(error.transient).toBe(true);

      // withRetry attempts the API call 1 + 3 retries = 4 times (plus 1 auth).
      const apiCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes("/sobjects/Lead")
      );
      expect(apiCalls).toHaveLength(4);
    });

    it("retries a network-layer failure as transient (Req 1.7)", async () => {
      vi.useFakeTimers();

      fetchMock
        .mockResolvedValueOnce(tokenOk())
        // network error on first API attempt...
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        // ...then success
        .mockResolvedValueOnce(apiJson(MOCK_CREATE_RESPONSE));

      const promise = client.createObject("Lead", {
        firstName: "Jane",
        lastName: "Doe",
      });
      await vi.runAllTimersAsync();
      const id = await promise;

      expect(id).toBe("00Q1234567890ABCDE");
    });
  });

  // ── Missing field mapping (Req 1.9) ────────────────────────────────────────

  describe("field mapping", () => {
    it("throws SfConfigError for a DOE field key with no mapping (Req 1.9)", async () => {
      // mapFields runs before any transport call — no fetch should occur.
      await expect(
        client.createObject("Lead", {
          firstName: "Jane",
          notAConfiguredField: "value",
        })
      ).rejects.toThrow(SfConfigError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips undefined values without erroring", async () => {
      fetchMock
        .mockResolvedValueOnce(tokenOk())
        .mockResolvedValueOnce(apiJson(MOCK_CREATE_RESPONSE));

      const id = await client.createObject("Lead", {
        firstName: "Jane",
        lastName: "Doe",
        email: undefined,
      });

      expect(id).toBe("00Q1234567890ABCDE");
      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body).not.toHaveProperty("Email");
    });
  });
});
