/**
 * Salesforce Object / Field Configuration
 *
 * Object and field API names are CONFIG, not hard-coded, so that sandbox and
 * production org differences are absorbed in configuration rather than code
 * (Requirements 1.7, 1.8, 12.4). Every value is environment-overridable:
 *
 *   SF_OBJ_<OBJECT>           — override an sObject API name
 *                               (e.g. SF_OBJ_LEAD, SF_OBJ_CONTACT)
 *   SF_FIELD_<OBJECT>_<KEY>   — override a single field API name, where KEY is
 *                               the DOE field key upper-cased
 *                               (e.g. SF_FIELD_LEAD_PROJECTINTEREST)
 *   SF_API_VERSION            — override the REST API version (default v59.0)
 *
 * Defaults target a standard Salesforce org.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SfObjectName = "Lead" | "Contact" | "Opportunity" | "Task" | "Event";

export interface SfObjectConfig {
  /** API name of the sObject in the connected org (sandbox/prod may differ). */
  sobject: string;
  /** DOE field key → Salesforce field API name. Absorbs sandbox/prod differences. */
  fields: Record<string, string>;
}

// ── Env-override helpers ─────────────────────────────────────────────────────

/**
 * Resolve an sObject API name, honoring an `SF_OBJ_<OBJECT>` env override.
 */
function sobjectName(object: SfObjectName, fallback: string): string {
  return process.env[`SF_OBJ_${object.toUpperCase()}`] ?? fallback;
}

/**
 * Build a field map, honoring per-field `SF_FIELD_<OBJECT>_<KEY>` env overrides.
 * KEY is the DOE field key upper-cased (e.g. `projectInterest` → `PROJECTINTEREST`).
 */
function fieldMap(
  object: SfObjectName,
  defaults: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    out[key] = process.env[`SF_FIELD_${object.toUpperCase()}_${key.toUpperCase()}`] ?? fallback;
  }
  return out;
}

// ── Object / field configuration ─────────────────────────────────────────────

export const SF_OBJECT_CONFIG: Record<SfObjectName, SfObjectConfig> = {
  Lead: {
    sobject: sobjectName("Lead", "Lead"),
    fields: fieldMap("Lead", {
      firstName: "FirstName",
      lastName: "LastName",
      email: "Email",
      phone: "Phone",
      company: "Company",
      status: "Status",
      projectInterest: "Project_Interest__c",
      source: "LeadSource",
    }),
  },
  Contact: {
    sobject: sobjectName("Contact", "Contact"),
    fields: fieldMap("Contact", {
      firstName: "FirstName",
      lastName: "LastName",
      email: "Email",
      phone: "Phone",
    }),
  },
  Opportunity: {
    sobject: sobjectName("Opportunity", "Opportunity"),
    fields: fieldMap("Opportunity", {
      name: "Name",
      stage: "StageName",
      closeDate: "CloseDate",
      amount: "Amount",
    }),
  },
  Task: {
    sobject: sobjectName("Task", "Task"),
    fields: fieldMap("Task", {
      subject: "Subject",
      description: "Description",
      status: "Status",
      whoId: "WhoId",
      ownerId: "OwnerId",
    }),
  },
  Event: {
    sobject: sobjectName("Event", "Event"),
    fields: fieldMap("Event", {
      subject: "Subject",
      startDateTime: "StartDateTime",
      endDateTime: "EndDateTime",
      whoId: "WhoId",
    }),
  },
};

// ── REST API paths ─────────────────────────────────────────────────────────

const API_VERSION = process.env.SF_API_VERSION ?? "v59.0";

/**
 * Build the REST sObject path for a given sObject API name, e.g.
 * `/services/data/v59.0/sobjects/Lead`.
 */
export const sobjectPath = (name: string): string =>
  `/services/data/${API_VERSION}/sobjects/${name}`;
