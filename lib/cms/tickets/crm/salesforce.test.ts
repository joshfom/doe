import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SalesforceAdapter, withRetry } from "./salesforce";
import type { CrmCaseInput } from "./adapter";

// ── Test helpers ─────────────────────────────────────────────────────────────

const MOCK_TOKEN_RESPONSE = {
  access_token: "mock-access-token",
  instance_url: "https://mock-instance.salesforce.com",
  token_type: "Bearer",
};

const MOCK_CREATE_RESPONSE = {
  id: "5001234567890ABC",
  success: true,
  errors: [],
};

const sampleInput: CrmCaseInput = {
  ticketNumber: "ORA-000042",
  subject: "Test ticket",
  description: "Test description",
  contactName: "Jane Doe",
  contactEmail: "jane@example.com",
  contactPhone: "+1234567890",
  priority: "high",
  category: "technical",
  status: "open",
};

// ── withRetry tests ──────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on a later attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after all retries are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));

    await expect(withRetry(fn, 3, 0)).rejects.toThrow("persistent failure");
    // 1 initial + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("retries exactly maxRetries times", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(withRetry(fn, 2, 0)).rejects.toThrow("fail");
    // 1 initial + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("converts non-Error throws to Error objects", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    await expect(withRetry(fn, 0, 0)).rejects.toThrow("string error");
  });
});

// ── SalesforceAdapter tests ──────────────────────────────────────────────────

describe("SalesforceAdapter", () => {
  let adapter: SalesforceAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new SalesforceAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      loginUrl: "https://login.salesforce.com",
      retryBaseDelayMs: 0,
    });

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to mock a successful auth + API call sequence
  function mockAuthThenApi(apiResponse: unknown, apiStatus = 200) {
    fetchMock
      // First call: OAuth token
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_TOKEN_RESPONSE,
      })
      // Second call: API request
      .mockResolvedValueOnce({
        ok: apiStatus >= 200 && apiStatus < 300,
        status: apiStatus,
        json: async () => apiResponse,
        text: async () => JSON.stringify(apiResponse),
      });
  }

  describe("constructor", () => {
    it("has name 'salesforce'", () => {
      expect(adapter.name).toBe("salesforce");
    });

    it("reads config from constructor params", () => {
      const custom = new SalesforceAdapter({
        clientId: "my-id",
        clientSecret: "my-secret",
        loginUrl: "https://test.salesforce.com",
      });
      expect(custom.name).toBe("salesforce");
    });

    it("falls back to env vars when no config provided", () => {
      const original = { ...process.env };
      process.env.SF_CLIENT_ID = "env-id";
      process.env.SF_CLIENT_SECRET = "env-secret";
      process.env.SF_LOGIN_URL = "https://env.salesforce.com";

      const envAdapter = new SalesforceAdapter();
      expect(envAdapter.name).toBe("salesforce");

      // Restore
      process.env.SF_CLIENT_ID = original.SF_CLIENT_ID;
      process.env.SF_CLIENT_SECRET = original.SF_CLIENT_SECRET;
      process.env.SF_LOGIN_URL = original.SF_LOGIN_URL;
    });
  });

  describe("authenticate", () => {
    it("calls the Salesforce OAuth token endpoint", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_TOKEN_RESPONSE,
      });

      await adapter.authenticate();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://login.salesforce.com/services/oauth2/token"
      );
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded"
      );
      expect(options.body).toContain("grant_type=client_credentials");
      expect(options.body).toContain("client_id=test-client-id");
      expect(options.body).toContain("client_secret=test-client-secret");
    });

    it("throws on authentication failure", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "invalid_client",
      });

      await expect(adapter.authenticate()).rejects.toThrow(
        "Salesforce authentication failed (401): invalid_client"
      );
    });
  });

  describe("createCase", () => {
    it("creates a Salesforce Case and returns the external ID", async () => {
      mockAuthThenApi(MOCK_CREATE_RESPONSE);

      const result = await adapter.createCase(sampleInput);

      expect(result.externalId).toBe("5001234567890ABC");
      expect(result.status).toBe("created");
    });

    it("sends correct Salesforce field mappings", async () => {
      mockAuthThenApi(MOCK_CREATE_RESPONSE);

      await adapter.createCase(sampleInput);

      // Second fetch call is the API call
      const [, apiOptions] = fetchMock.mock.calls[1];
      const body = JSON.parse(apiOptions.body);

      expect(body.Subject).toBe("Test ticket");
      expect(body.Description).toBe("Test description");
      expect(body.SuppliedName).toBe("Jane Doe");
      expect(body.SuppliedEmail).toBe("jane@example.com");
      expect(body.SuppliedPhone).toBe("+1234567890");
      expect(body.Priority).toBe("High");
      expect(body.Status).toBe("New");
      expect(body.Type).toBe("technical");
    });

    it("retries on API failure", async () => {
      // Auth succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_TOKEN_RESPONSE,
      });
      // First API call fails
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });
      // Retry: re-auth (token is still cached, but ensureAuthenticated is called)
      // Second API call succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_CREATE_RESPONSE,
      });

      const result = await adapter.createCase(sampleInput);
      expect(result.externalId).toBe("5001234567890ABC");
    });

    it("throws after all retries are exhausted", async () => {
      // Auth succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_TOKEN_RESPONSE,
      });
      // All API calls fail
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(adapter.createCase(sampleInput)).rejects.toThrow(
        "Salesforce API error (500)"
      );
    });

    it("throws when Salesforce returns success: false", async () => {
      // Auth succeeds once, then all API calls return success: false
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_TOKEN_RESPONSE,
      });
      // All API calls return success: false (initial + 3 retries = 4 calls)
      const failResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          id: null,
          success: false,
          errors: [{ message: "Required field missing" }],
        }),
      };
      fetchMock
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse);

      await expect(adapter.createCase(sampleInput)).rejects.toThrow(
        "Salesforce createCase failed"
      );
    });
  });

  describe("updateCase", () => {
    it("updates a Salesforce Case by external ID", async () => {
      // Auth + 204 No Content response for PATCH
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => MOCK_TOKEN_RESPONSE,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => ({}),
        });

      const result = await adapter.updateCase("5001234567890ABC", {
        status: "resolved",
      });

      expect(result.externalId).toBe("5001234567890ABC");
      expect(result.status).toBe("updated");

      // Verify PATCH was called with correct URL
      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toContain("/sobjects/Case/5001234567890ABC");
      expect(options.method).toBe("PATCH");
    });

    it("maps status updates to Salesforce values", async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => MOCK_TOKEN_RESPONSE,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => ({}),
        });

      await adapter.updateCase("ext-123", { status: "in_progress" });

      const [, options] = fetchMock.mock.calls[1];
      const body = JSON.parse(options.body);
      expect(body.Status).toBe("Working");
    });
  });

  describe("getCaseStatus", () => {
    it("retrieves the status of a Salesforce Case", async () => {
      mockAuthThenApi({ Status: "Working" });

      const status = await adapter.getCaseStatus("5001234567890ABC");

      expect(status).toBe("Working");

      // Verify GET was called with correct URL
      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toContain("/sobjects/Case/5001234567890ABC?fields=Status");
      expect(options.method).toBe("GET");
    });
  });

  describe("token refresh on 401", () => {
    it("clears cached token on 401 and re-authenticates on retry", async () => {
      // First auth
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_TOKEN_RESPONSE,
      });
      // API returns 401 (expired token)
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Session expired",
      });
      // Re-auth on retry
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...MOCK_TOKEN_RESPONSE,
          access_token: "new-token",
        }),
      });
      // Retry API call succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_CREATE_RESPONSE,
      });

      const result = await adapter.createCase(sampleInput);
      expect(result.externalId).toBe("5001234567890ABC");

      // Should have made 4 fetch calls: auth, 401, re-auth, success
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("priority and status mapping", () => {
    it("maps 'urgent' priority to 'High'", async () => {
      mockAuthThenApi(MOCK_CREATE_RESPONSE);

      await adapter.createCase({ ...sampleInput, priority: "urgent" });

      const [, options] = fetchMock.mock.calls[1];
      const body = JSON.parse(options.body);
      expect(body.Priority).toBe("High");
    });

    it("maps 'resolved' status to 'Closed'", async () => {
      mockAuthThenApi(MOCK_CREATE_RESPONSE);

      await adapter.createCase({ ...sampleInput, status: "resolved" });

      const [, options] = fetchMock.mock.calls[1];
      const body = JSON.parse(options.body);
      expect(body.Status).toBe("Closed");
    });

    it("defaults unknown priority to 'Medium'", async () => {
      mockAuthThenApi(MOCK_CREATE_RESPONSE);

      await adapter.createCase({ ...sampleInput, priority: "unknown" });

      const [, options] = fetchMock.mock.calls[1];
      const body = JSON.parse(options.body);
      expect(body.Priority).toBe("Medium");
    });

    it("defaults unknown status to 'New'", async () => {
      mockAuthThenApi(MOCK_CREATE_RESPONSE);

      await adapter.createCase({ ...sampleInput, status: "unknown" });

      const [, options] = fetchMock.mock.calls[1];
      const body = JSON.parse(options.body);
      expect(body.Status).toBe("New");
    });
  });

  describe("CrmAdapter interface compliance", () => {
    it("implements all required CrmAdapter methods", () => {
      expect(typeof adapter.createCase).toBe("function");
      expect(typeof adapter.updateCase).toBe("function");
      expect(typeof adapter.getCaseStatus).toBe("function");
      expect(adapter.name).toBe("salesforce");
    });
  });
});
