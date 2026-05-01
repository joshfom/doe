/**
 * Salesforce CRM Adapter
 *
 * Implements the CrmAdapter interface for synchronizing ticket data
 * to Salesforce as Cases. Authenticates via OAuth 2.0 client credentials
 * flow and retries failed API calls with exponential backoff.
 *
 * Environment variables:
 *   SF_CLIENT_ID     — Salesforce Connected App client ID
 *   SF_CLIENT_SECRET — Salesforce Connected App client secret
 *   SF_LOGIN_URL     — Salesforce login endpoint (e.g. https://login.salesforce.com)
 */

import type { CrmAdapter, CrmCaseInput, CrmCaseResult } from "./adapter";

// ── Types ────────────────────────────────────────────────────────────────────

interface SalesforceTokenResponse {
  access_token: string;
  instance_url: string;
  token_type: string;
}

interface SalesforceCreateResponse {
  id: string;
  success: boolean;
  errors: unknown[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s with exponential backoff
const TOKEN_ENDPOINT_PATH = "/services/oauth2/token";
const CASE_SOBJECT_PATH = "/services/data/v59.0/sobjects/Case";

// ── Priority mapping ─────────────────────────────────────────────────────────

/**
 * Map internal ticket priorities to Salesforce Case priority values.
 */
const PRIORITY_MAP: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "High", // Salesforce doesn't have "Urgent" by default
};

/**
 * Map internal ticket statuses to Salesforce Case status values.
 */
const STATUS_MAP: Record<string, string> = {
  open: "New",
  assigned: "New",
  in_progress: "Working",
  resolved: "Closed",
  closed: "Closed",
};

// ── Helper: sleep ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helper: retry with exponential backoff ───────────────────────────────────

/**
 * Execute an async function with retry logic.
 * Retries up to `maxRetries` times with exponential backoff (1s, 2s, 4s).
 * Throws the last error if all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelayMs: number = BASE_DELAY_MS
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        await sleep(delayMs);
      }
    }
  }

  throw lastError!;
}

// ── SalesforceAdapter ────────────────────────────────────────────────────────

export class SalesforceAdapter implements CrmAdapter {
  readonly name = "salesforce";

  private accessToken: string | null = null;
  private instanceUrl: string | null = null;

  // Allow injection for testing
  private clientId: string;
  private clientSecret: string;
  private loginUrl: string;

  /** Base delay for exponential backoff (ms). Override in tests. */
  private retryBaseDelayMs: number;

  constructor(config?: {
    clientId?: string;
    clientSecret?: string;
    loginUrl?: string;
    /** Override base retry delay (ms). Useful for testing. */
    retryBaseDelayMs?: number;
  }) {
    this.clientId = config?.clientId ?? process.env.SF_CLIENT_ID ?? "";
    this.clientSecret =
      config?.clientSecret ?? process.env.SF_CLIENT_SECRET ?? "";
    this.loginUrl =
      config?.loginUrl ?? process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
    this.retryBaseDelayMs = config?.retryBaseDelayMs ?? BASE_DELAY_MS;
  }

  // ── Authentication ───────────────────────────────────────────────────────

  /**
   * Authenticate with Salesforce using OAuth 2.0 client credentials flow.
   * Caches the access token and instance URL for subsequent API calls.
   */
  async authenticate(): Promise<void> {
    const tokenUrl = `${this.loginUrl}${TOKEN_ENDPOINT_PATH}`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Salesforce authentication failed (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as SalesforceTokenResponse;
    this.accessToken = data.access_token;
    this.instanceUrl = data.instance_url;
  }

  /**
   * Ensure we have a valid access token. Re-authenticates if needed.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || !this.instanceUrl) {
      await this.authenticate();
    }
  }

  // ── API helpers ──────────────────────────────────────────────────────────

  /**
   * Make an authenticated request to the Salesforce REST API.
   * Throws on non-2xx responses.
   */
  private async sfRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureAuthenticated();

    const url = `${this.instanceUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // If we get a 401, clear token and re-throw so retry logic can re-auth
    if (response.status === 401) {
      this.accessToken = null;
      this.instanceUrl = null;
      throw new Error("Salesforce session expired or invalid");
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Salesforce API error (${response.status}): ${errorText}`
      );
    }

    // PATCH/DELETE may return 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  // ── CrmAdapter implementation ────────────────────────────────────────────

  /**
   * Create a Case in Salesforce from ticket data.
   * Retries up to 3 times with exponential backoff on failure.
   */
  async createCase(input: CrmCaseInput): Promise<CrmCaseResult> {
    return withRetry(async () => {
      const sfCase = this.mapToSalesforceCase(input);

      const result = await this.sfRequest<SalesforceCreateResponse>(
        "POST",
        CASE_SOBJECT_PATH,
        sfCase
      );

      if (!result.success) {
        throw new Error(
          `Salesforce createCase failed: ${JSON.stringify(result.errors)}`
        );
      }

      return {
        externalId: result.id,
        status: "created",
      };
    }, MAX_RETRIES, this.retryBaseDelayMs);
  }

  /**
   * Update an existing Case in Salesforce.
   * Retries up to 3 times with exponential backoff on failure.
   */
  async updateCase(
    externalId: string,
    updates: Partial<CrmCaseInput>
  ): Promise<CrmCaseResult> {
    return withRetry(async () => {
      const sfUpdates = this.mapToSalesforceCase(updates);

      await this.sfRequest<void>(
        "PATCH",
        `${CASE_SOBJECT_PATH}/${externalId}`,
        sfUpdates
      );

      return {
        externalId,
        status: "updated",
      };
    }, MAX_RETRIES, this.retryBaseDelayMs);
  }

  /**
   * Retrieve the current status of a Case from Salesforce.
   * Retries up to 3 times with exponential backoff on failure.
   */
  async getCaseStatus(externalId: string): Promise<string> {
    return withRetry(async () => {
      const result = await this.sfRequest<{ Status: string }>(
        "GET",
        `${CASE_SOBJECT_PATH}/${externalId}?fields=Status`
      );

      return result.Status;
    }, MAX_RETRIES, this.retryBaseDelayMs);
  }

  // ── Field mapping ────────────────────────────────────────────────────────

  /**
   * Map generic CrmCaseInput fields to Salesforce Case field names.
   */
  private mapToSalesforceCase(
    input: Partial<CrmCaseInput>
  ): Record<string, unknown> {
    const sfCase: Record<string, unknown> = {};

    if (input.subject !== undefined) {
      sfCase.Subject = input.subject;
    }
    if (input.description !== undefined) {
      sfCase.Description = input.description;
    }
    if (input.contactName !== undefined) {
      sfCase.SuppliedName = input.contactName;
    }
    if (input.contactEmail !== undefined) {
      sfCase.SuppliedEmail = input.contactEmail;
    }
    if (input.contactPhone !== undefined) {
      sfCase.SuppliedPhone = input.contactPhone;
    }
    if (input.priority !== undefined) {
      sfCase.Priority = PRIORITY_MAP[input.priority] ?? "Medium";
    }
    if (input.status !== undefined) {
      sfCase.Status = STATUS_MAP[input.status] ?? "New";
    }
    if (input.category !== undefined) {
      sfCase.Type = input.category;
    }
    if (input.ticketNumber !== undefined) {
      sfCase.CaseNumber = input.ticketNumber;
    }

    return sfCase;
  }
}
