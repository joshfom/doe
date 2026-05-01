/**
 * CRM Adapter Interface and DTOs
 *
 * Defines a generic, CRM-agnostic interface for synchronizing ticket data
 * to external CRM systems. Concrete adapters (Salesforce, HubSpot, Zoho, etc.)
 * implement this interface.
 */

// ── Data Transfer Objects ────────────────────────────────────────────────────

/**
 * Generic input for creating or describing a CRM case.
 * Not coupled to any specific CRM's API schema.
 */
export interface CrmCaseInput {
  ticketNumber: string;
  subject: string;
  description: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  priority: string;
  category?: string;
  status: string;
}

/**
 * Generic result returned after a CRM operation (create or update).
 */
export interface CrmCaseResult {
  externalId: string;
  status: string;
}

// ── Adapter Interface ────────────────────────────────────────────────────────

/**
 * Interface that all CRM adapters must implement.
 *
 * - `createCase`    — create a new case/ticket in the external CRM
 * - `updateCase`    — update an existing case in the external CRM
 * - `getCaseStatus` — retrieve the current status of a case from the external CRM
 */
export interface CrmAdapter {
  readonly name: string;
  createCase(input: CrmCaseInput): Promise<CrmCaseResult>;
  updateCase(
    externalId: string,
    updates: Partial<CrmCaseInput>
  ): Promise<CrmCaseResult>;
  getCaseStatus(externalId: string): Promise<string>;
}
