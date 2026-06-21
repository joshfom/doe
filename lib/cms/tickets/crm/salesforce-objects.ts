/**
 * Salesforce First-Class Object Client
 *
 * A typed create/read/update layer for the five first-class Salesforce
 * sObjects this spec models directly — Lead, Contact, Opportunity, Task, and
 * Event — replacing the Case-only adapter surface (Requirement 1).
 *
 * The hard parts of the transport (OAuth 2.0 client-credentials, token /
 * instanceUrl caching, the single-shot 401 re-auth path, and transient-error
 * classification) already live on {@link SalesforceAdapter}. This client
 * reuses that one transport via `adapter.requestJson` and wraps every call in
 * {@link withRetry} for the bounded exponential backoff (Requirements 1.5–1.7).
 *
 * Object and field API names are read from {@link SF_OBJECT_CONFIG} so that
 * sandbox/production differences are absorbed in configuration rather than
 * code (Requirements 1.8, 12.4). A field with no configured mapping surfaces
 * an {@link SfConfigError} rather than silently writing to a default
 * object/field (Requirement 1.9).
 */

import { SalesforceAdapter, withRetry, SfHttpError } from "./salesforce";
import { SF_OBJECT_CONFIG, sobjectPath, type SfObjectName } from "./sf-config";

/** Salesforce REST API version (env-overridable), shared with the analytics reader. */
const SF_API_VERSION = process.env.SF_API_VERSION ?? "v59.0";

/**
 * Escape a string for safe inclusion inside a single-quoted SOQL literal. The
 * REST query API has no bind parameters, so values interpolated into a WHERE
 * clause MUST be escaped (backslash and single-quote) to avoid SOQL injection.
 */
export function soqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── Typed errors ─────────────────────────────────────────────────────────────

/**
 * Raised when a read references a Salesforce id that does not exist in the
 * connected org. A missing id is an ERROR, never an empty successful record
 * (Requirements 1.2, 1.3).
 */
export class SfObjectNotFoundError extends Error {
  readonly object: string;
  readonly id: string;
  constructor(object: string, id: string) {
    super(`Salesforce ${object} ${id} not found`);
    this.name = "SfObjectNotFoundError";
    this.object = object;
    this.id = id;
  }
}

/**
 * Raised when a configured sObject or field is absent from the connected org,
 * or no field mapping exists for a supplied DOE field key. The write is NOT
 * silently redirected to a default object/field (Requirement 1.9).
 */
export class SfConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SfConfigError";
  }
}

// ── Internal response shape ──────────────────────────────────────────────────

interface SfCreateResponse {
  id: string;
  success: boolean;
  errors: unknown[];
}

/**
 * Detect a Salesforce "record not found" response. A missing id surfaces from
 * the transport as a non-transient {@link SfHttpError} with HTTP status 404.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof SfHttpError && error.status === 404;
}

// ── SalesforceObjectClient ───────────────────────────────────────────────────

export class SalesforceObjectClient {
  constructor(private readonly adapter: SalesforceAdapter) {}

  /**
   * Create any first-class object and return the new Salesforce id
   * (Requirement 1.1). Checks the `success` flag and surfaces the Salesforce
   * errors when the create did not succeed.
   */
  async createObject(
    name: SfObjectName,
    doeFields: Record<string, unknown>
  ): Promise<string> {
    const body = this.mapFields(name, doeFields);
    const result = await withRetry(() =>
      this.adapter.requestJson<SfCreateResponse>(
        "POST",
        sobjectPath(this.sobjectFor(name)),
        body
      )
    );
    if (!result.success) {
      throw new Error(`create ${name} failed: ${JSON.stringify(result.errors)}`);
    }
    return result.id;
  }

  /**
   * Read an object by Salesforce id and return its fields (Requirement 1.2).
   * A missing id throws {@link SfObjectNotFoundError} rather than returning an
   * empty record as a successful result (Requirement 1.3).
   */
  async getObject<T = Record<string, unknown>>(
    name: SfObjectName,
    id: string
  ): Promise<T> {
    try {
      return await withRetry(() =>
        this.adapter.requestJson<T>(
          "GET",
          `${sobjectPath(this.sobjectFor(name))}/${id}`
        )
      );
    } catch (error) {
      if (isNotFound(error)) {
        throw new SfObjectNotFoundError(name, id);
      }
      throw error;
    }
  }

  /**
   * Update an existing record by Salesforce id (Requirement 1.4). The PATCH
   * returns 204 No Content on success.
   */
  async updateObject(
    name: SfObjectName,
    id: string,
    doeFields: Record<string, unknown>
  ): Promise<void> {
    const body = this.mapFields(name, doeFields);
    await withRetry(() =>
      this.adapter.requestJson<void>(
        "PATCH",
        `${sobjectPath(this.sobjectFor(name))}/${id}`,
        body
      )
    );
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Run a read-only SOQL query and return its records (Requirement 1.2). Used by
   * the prospecting CRM pre-check to discover whether a prospect already exists
   * as a Lead/Contact before any cold outreach. Callers MUST escape any value
   * interpolated into the SOQL via {@link soqlEscape} — there are no bind
   * parameters over the REST query API.
   */
  async query<T = Record<string, unknown>>(soql: string): Promise<T[]> {
    const path = `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
    const res = await withRetry(() =>
      this.adapter.requestJson<{ records?: T[] }>("GET", path)
    );
    return res.records ?? [];
  }

  /**
   * Resolve the configured sObject API name for a DOE object name. A name with
   * no configuration entry surfaces {@link SfConfigError} (Requirement 1.9).
   */
  private sobjectFor(name: SfObjectName): string {
    const cfg = SF_OBJECT_CONFIG[name];
    if (!cfg) {
      throw new SfConfigError(`No object mapping for ${name}`);
    }
    return cfg.sobject;
  }

  /**
   * Map DOE field keys → Salesforce field API names via {@link SF_OBJECT_CONFIG}
   * (Requirement 1.8). `undefined` values are skipped; a key with no configured
   * mapping surfaces {@link SfConfigError} rather than being silently dropped or
   * written to a default field (Requirement 1.9).
   */
  private mapFields(
    name: SfObjectName,
    doeFields: Record<string, unknown>
  ): Record<string, unknown> {
    const cfg = SF_OBJECT_CONFIG[name];
    if (!cfg) {
      throw new SfConfigError(`No object mapping for ${name}`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doeFields)) {
      if (value === undefined) continue;
      const sfField = cfg.fields[key];
      if (!sfField) {
        throw new SfConfigError(`No field mapping for ${name}.${key}`);
      }
      out[sfField] = value;
    }
    return out;
  }
}
