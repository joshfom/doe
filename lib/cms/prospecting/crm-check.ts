/**
 * Prospecting CRM pre-check (S7) — "is this prospect already in Salesforce?"
 *
 * Before any COLD outreach, the workspace checks whether the prospect already
 * exists in the CRM as a Lead or Contact. If they do, we must NOT cold-approach
 * them: the rep is shown a short CRM summary (who owns them, status, last
 * activity) so they can pursue a warm follow-up through the existing
 * relationship instead. This is a READ-ONLY lookup — it never writes to
 * Salesforce.
 *
 * Matching is by EMAIL (the stable, privacy-safe key the workspace persists on a
 * Target). Phone is intentionally not used here: the workspace only keeps a
 * salted phone hash (CC-Privacy), never a raw number to match against SF.
 *
 * When Salesforce credentials are absent the check returns `configured: false`
 * WITHOUT throwing, so the workspace degrades gracefully (the rep simply
 * proceeds, with a note that the CRM could not be consulted).
 */

import { SalesforceAdapter } from "../tickets/crm/salesforce";
import { SalesforceObjectClient, soqlEscape } from "../tickets/crm/salesforce-objects";

/** A single CRM match surfaced to the rep (summary only — no bulk PII dump). */
export interface CrmMatch {
  object: "Lead" | "Contact";
  id: string;
  name: string | null;
  email: string | null;
  /** Lead status, or "Contact" for a converted/standing contact. */
  status: string | null;
  company: string | null;
  owner: string | null;
  lastActivity: string | null;
  /** True when a Lead has already been converted (a deal already exists). */
  isConverted?: boolean;
}

export interface CrmCheckResult {
  /** False when SF credentials are absent — the check could not run. */
  configured: boolean;
  /** True when at least one Lead/Contact matched. */
  found: boolean;
  matches: CrmMatch[];
  /** The email the lookup keyed on (null when the Target has none). */
  checkedEmail: string | null;
  /** Set when the check could not complete (unconfigured / error). */
  note?: string;
}

interface SfLeadRow {
  Id: string;
  Name?: string | null;
  Email?: string | null;
  Status?: string | null;
  Company?: string | null;
  IsConverted?: boolean;
  LastActivityDate?: string | null;
  Owner?: { Name?: string | null } | null;
}

interface SfContactRow {
  Id: string;
  Name?: string | null;
  Email?: string | null;
  LastActivityDate?: string | null;
  Account?: { Name?: string | null } | null;
  Owner?: { Name?: string | null } | null;
}

function sfConfigured(): boolean {
  return Boolean(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET);
}

/**
 * Look a prospect up in Salesforce by email. Returns any matching Leads and
 * Contacts as a compact summary. Read-only; never throws on missing creds.
 */
export async function checkCrmForContact(input: {
  email?: string | null;
}): Promise<CrmCheckResult> {
  const email = input.email?.trim().toLowerCase() || null;

  if (!email) {
    return {
      configured: sfConfigured(),
      found: false,
      matches: [],
      checkedEmail: null,
      note: "No email on this prospect — cannot check the CRM by email.",
    };
  }

  if (!sfConfigured()) {
    return {
      configured: false,
      found: false,
      matches: [],
      checkedEmail: email,
      note: "Salesforce is not configured — proceeding without a CRM check.",
    };
  }

  const e = soqlEscape(email);
  const client = new SalesforceObjectClient(new SalesforceAdapter());

  try {
    const [leads, contacts] = await Promise.all([
      client.query<SfLeadRow>(
        `SELECT Id, Name, Email, Status, Company, IsConverted, LastActivityDate, Owner.Name ` +
          `FROM Lead WHERE Email = '${e}' LIMIT 5`
      ),
      client.query<SfContactRow>(
        `SELECT Id, Name, Email, LastActivityDate, Account.Name, Owner.Name ` +
          `FROM Contact WHERE Email = '${e}' LIMIT 5`
      ),
    ]);

    const matches: CrmMatch[] = [
      ...leads.map((l): CrmMatch => ({
        object: "Lead",
        id: l.Id,
        name: l.Name ?? null,
        email: l.Email ?? null,
        status: l.Status ?? null,
        company: l.Company ?? null,
        owner: l.Owner?.Name ?? null,
        lastActivity: l.LastActivityDate ?? null,
        isConverted: Boolean(l.IsConverted),
      })),
      ...contacts.map((c): CrmMatch => ({
        object: "Contact",
        id: c.Id,
        name: c.Name ?? null,
        email: c.Email ?? null,
        status: "Contact",
        company: c.Account?.Name ?? null,
        owner: c.Owner?.Name ?? null,
        lastActivity: c.LastActivityDate ?? null,
      })),
    ];

    return {
      configured: true,
      found: matches.length > 0,
      matches,
      checkedEmail: email,
    };
  } catch (err) {
    return {
      configured: true,
      found: false,
      matches: [],
      checkedEmail: email,
      note: `CRM check could not complete: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
