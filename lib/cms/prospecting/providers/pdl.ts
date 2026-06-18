/**
 * Prospecting Workspace (S7) — People Data Labs (PDL) Account/Person provider
 * (Appendix A; Design §Components #4; Requirements 2.3, 2.4, 3.1, 3.2; task 4.2
 * **[deps]**).
 *
 * PDL is the developer-first, raw person/company source. This adapter maps PDL's
 * `person/search` and `person/enrich` payloads onto our provenanced
 * {@link ProviderResult} / {@link ProviderEnrichment}, reading its credential
 * from `PDL_API_KEY` (base URL overridable via `PDL_API_BASE_URL`). When the key
 * is absent both `search` and `enrich` return `{ unconfigured: true }` WITHOUT a
 * network call (Req 2.4); the adapter never throws on missing creds.
 *
 * The HTTP transport is injected so tests never hit PDL ([deps]); the adapter
 * self-registers into the shared registry on import.
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

/** Default PDL API base; override with `PDL_API_BASE_URL`. */
export const PDL_DEFAULT_BASE_URL = "https://api.peopledatalabs.com/v5";

/** Resolve PDL config from env; `null` when `PDL_API_KEY` is absent. */
export function pdlConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  return configFromEnv(
    "PDL_API_KEY",
    "PDL_API_BASE_URL",
    PDL_DEFAULT_BASE_URL,
    env
  );
}

/** Shape of a PDL person record (the subset this adapter reads). */
interface PdlPerson {
  id?: string;
  full_name?: string;
  job_title?: string;
  job_title_levels?: string[];
  work_email?: string;
  mobile_phone?: string;
  job_company_name?: string;
  job_company_industry?: string;
  job_company_size?: string;
  location_country?: string;
  linkedin_url?: string;
}

const SEARCH_PII_KEYS = new Set(["workEmail", "linkedinUrl"]);
const ENRICH_PII_KEYS = new Set(["email", "phone", "linkedinUrl"]);

/** People Data Labs {@link EnrichmentProvider} adapter. */
export class PdlProvider extends BaseEnrichmentProvider {
  readonly id = "pdl" as const;

  constructor(
    config: ProviderConfig | null = pdlConfigFromEnv(),
    deps: ProviderDeps = {}
  ) {
    super(config, deps);
  }

  protected async fetchSearch(
    config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]> {
    const body = {
      // PDL accepts a structured query; we pass the ICP seeds it supports.
      sql: undefined,
      query: {
        job_title: filter.titles,
        job_title_levels: filter.seniority,
        location_country: filter.geography,
        job_company_industry: filter.industries,
      },
      size: filter.limit ?? 25,
    };

    const payload = (await this.requestJson("/person/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: JSON.stringify(body),
    })) as { data?: PdlPerson[] };

    return (payload.data ?? []).map((person) => this.mapPerson(filter, person));
  }

  protected async fetchEnrich(
    config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment> {
    const params = new URLSearchParams();
    if (target.sourceRef) params.set("pdl_id", target.sourceRef);
    if (target.displayName) params.set("name", target.displayName);
    if (target.companyName) params.set("company", target.companyName);
    if (target.email) params.set("email", target.email);

    const payload = (await this.requestJson(
      `/person/enrich?${params.toString()}`,
      {
        method: "GET",
        headers: { "X-Api-Key": config.apiKey },
      }
    )) as { data?: PdlPerson };

    const person = payload.data ?? {};
    return {
      sourceProvider: this.id,
      sourceRef: person.id,
      attributes: this.attributes(
        {
          displayName: person.full_name,
          title: person.job_title,
          email: person.work_email,
          phone: person.mobile_phone,
          country: person.location_country,
          seniority: person.job_title_levels?.[0],
          linkedinUrl: person.linkedin_url,
          companyName: person.job_company_name,
          industry: person.job_company_industry,
          companySize: person.job_company_size,
        },
        ENRICH_PII_KEYS
      ),
    };
  }

  /** Map one PDL person onto a provenanced {@link ProviderResult}. */
  private mapPerson(filter: ProspectFilter, person: PdlPerson): ProviderResult {
    return {
      targetType: filter.targetType,
      displayName: person.full_name,
      companyName: person.job_company_name,
      title: person.job_title,
      email: person.work_email,
      phone: person.mobile_phone,
      country: person.location_country,
      attributes: this.attributes(
        {
          title: person.job_title,
          workEmail: person.work_email,
          seniority: person.job_title_levels?.[0],
          linkedinUrl: person.linkedin_url,
          industry: person.job_company_industry,
          companySize: person.job_company_size,
        },
        SEARCH_PII_KEYS
      ),
      sourceProvider: this.id,
      sourceRef: person.id,
      lawfulBasis: "legitimate_interest",
    };
  }
}

/** Register the PDL provider into the shared registry (resolved on first use). */
export function registerPdlProvider(): void {
  registerProviderLazy("pdl", () => new PdlProvider());
}

// Self-register on import so the fan-out picks PDL up when configured.
registerPdlProvider();
