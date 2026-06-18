/**
 * Prospecting Workspace (S7) — Cognism Account/Person provider (Appendix A;
 * Design §Components #4; Requirements 2.3, 2.4, 3.1, 3.2; task 4.2 **[deps]**).
 *
 * Cognism is the best fit for UAE/Gulf C-levels: phone-verified, GDPR-postured
 * EMEA/Gulf coverage. This adapter maps Cognism's contact-search and enrich
 * payloads onto our provenanced {@link ProviderResult} / {@link ProviderEnrichment},
 * reading its credential from `COGNISM_API_KEY` (base URL overridable via
 * `COGNISM_API_BASE_URL`). When the key is absent both `search` and `enrich`
 * return `{ unconfigured: true }` WITHOUT a network call (Req 2.4); the adapter
 * never throws on missing creds.
 *
 * Because Cognism markets phone-verified Gulf contacts, its returned phone is
 * stamped with a `verified` lawful-basis note (still held only transiently; the
 * Target persists it as a salted hash, CC-Privacy). The HTTP transport is
 * injected so tests never hit Cognism ([deps]); the adapter self-registers on import.
 */

import {
  BaseEnrichmentProvider,
  configFromEnv,
  type ProviderConfig,
  type ProviderDeps,
} from "./base";
import { registerProviderLazy } from "./index";
import type {
  ProspectFilter,
  ProviderEnrichment,
  ProviderResult,
  TargetRef,
} from "./index";

/** Default Cognism API base; override with `COGNISM_API_BASE_URL`. */
export const COGNISM_DEFAULT_BASE_URL = "https://app.cognism.com/api/v1";

/** Resolve Cognism config from env; `null` when `COGNISM_API_KEY` is absent. */
export function cognismConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  return configFromEnv(
    "COGNISM_API_KEY",
    "COGNISM_API_BASE_URL",
    COGNISM_DEFAULT_BASE_URL,
    env
  );
}

/** Shape of a Cognism contact record (the subset this adapter reads). */
interface CognismContact {
  id?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  seniority?: string;
  email?: string;
  /** Phone-verified mobile — Cognism's differentiator. */
  phone?: string;
  companyName?: string;
  industry?: string;
  employeeCount?: number;
  country?: string;
  linkedinUrl?: string;
}

const SEARCH_PII_KEYS = new Set(["email", "linkedinUrl"]);
const ENRICH_PII_KEYS = new Set(["email", "phone", "linkedinUrl"]);

/** Cognism {@link EnrichmentProvider} adapter. */
export class CognismProvider extends BaseEnrichmentProvider {
  readonly id = "cognism" as const;

  constructor(
    config: ProviderConfig | null = cognismConfigFromEnv(),
    deps: ProviderDeps = {}
  ) {
    super(config, deps);
  }

  protected async fetchSearch(
    config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]> {
    const body = {
      jobTitles: filter.titles,
      seniorities: filter.seniority,
      locations: filter.geography,
      industries: filter.industries,
      employeeCount: filter.companySize,
      keywords: filter.keywords,
      limit: filter.limit ?? 25,
    };

    const payload = (await this.requestJson("/search/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    })) as { contacts?: CognismContact[] };

    return (payload.contacts ?? []).map((contact) =>
      this.mapContact(filter, contact)
    );
  }

  protected async fetchEnrich(
    config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment> {
    const body = {
      id: target.sourceRef,
      fullName: target.displayName,
      companyName: target.companyName,
      email: target.email,
    };

    const payload = (await this.requestJson("/enrich/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    })) as { contact?: CognismContact };

    const contact = payload.contact ?? {};
    return {
      sourceProvider: this.id,
      sourceRef: contact.id,
      attributes: this.attributes(
        {
          displayName: fullName(contact),
          title: contact.jobTitle,
          email: contact.email,
          phone: contact.phone,
          country: contact.country,
          seniority: contact.seniority,
          linkedinUrl: contact.linkedinUrl,
          companyName: contact.companyName,
          industry: contact.industry,
        },
        ENRICH_PII_KEYS
      ),
    };
  }

  /** Map one Cognism contact onto a provenanced {@link ProviderResult}. */
  private mapContact(
    filter: ProspectFilter,
    contact: CognismContact
  ): ProviderResult {
    return {
      targetType: filter.targetType,
      displayName: fullName(contact),
      companyName: contact.companyName,
      title: contact.jobTitle,
      email: contact.email,
      phone: contact.phone,
      country: contact.country,
      attributes: this.attributes(
        {
          title: contact.jobTitle,
          email: contact.email,
          seniority: contact.seniority,
          linkedinUrl: contact.linkedinUrl,
          industry: contact.industry,
          companySize: contact.employeeCount?.toString(),
        },
        SEARCH_PII_KEYS
      ),
      sourceProvider: this.id,
      sourceRef: contact.id,
      lawfulBasis: "legitimate_interest",
    };
  }
}

/** Join a Cognism contact's first/last name into a display name, if present. */
function fullName(contact: CognismContact): string | undefined {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name.length > 0 ? name : undefined;
}

/** Register the Cognism provider into the shared registry (resolved on first use). */
export function registerCognismProvider(): void {
  registerProviderLazy("cognism", () => new CognismProvider());
}

// Self-register on import so the fan-out picks Cognism up when configured.
registerCognismProvider();
