/**
 * Prospecting Workspace (S7) — Apollo.io Account/Person provider (Appendix A;
 * Design §Components #4; Requirements 2.3, 2.4, 3.1, 3.2; task 4.2 **[deps]**).
 *
 * Apollo is the all-in-one search + contacts on-ramp. This adapter maps Apollo's
 * people-search and people-match payloads onto our provenanced
 * {@link ProviderResult} / {@link ProviderEnrichment}, reading its credential
 * from `APOLLO_API_KEY` (base URL overridable via `APOLLO_API_BASE_URL`). When
 * the key is absent both `search` and `enrich` return `{ unconfigured: true }`
 * WITHOUT a network call (Req 2.4) — the adapter never throws on missing creds.
 *
 * The HTTP transport is injected ({@link ProviderDeps}) so tests supply a fake
 * and the suite never hits Apollo ([deps]). The adapter self-registers into the
 * shared {@link registerProviderLazy registry} on import, so the `prospect_search`
 * fan-out picks it up whenever `APOLLO_API_KEY` is configured.
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

/** Default Apollo API base; override with `APOLLO_API_BASE_URL`. */
export const APOLLO_DEFAULT_BASE_URL = "https://api.apollo.io/v1";

/** Resolve Apollo config from env; `null` when `APOLLO_API_KEY` is absent. */
export function apolloConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  return configFromEnv(
    "APOLLO_API_KEY",
    "APOLLO_API_BASE_URL",
    APOLLO_DEFAULT_BASE_URL,
    env
  );
}

/** Shape of an Apollo person record (the subset this adapter reads). */
interface ApolloPerson {
  id?: string;
  name?: string;
  title?: string;
  email?: string;
  country?: string;
  seniority?: string;
  linkedin_url?: string;
  phone_numbers?: { raw_number?: string }[];
  organization?: {
    name?: string;
    industry?: string;
    estimated_num_employees?: number;
  };
}

const SEARCH_PII_KEYS = new Set(["email", "linkedinUrl"]);
const ENRICH_PII_KEYS = new Set(["email", "phone", "linkedinUrl"]);

/** Apollo.io {@link EnrichmentProvider} adapter. */
export class ApolloProvider extends BaseEnrichmentProvider {
  readonly id = "apollo" as const;

  constructor(
    config: ProviderConfig | null = apolloConfigFromEnv(),
    deps: ProviderDeps = {}
  ) {
    super(config, deps);
  }

  protected async fetchSearch(
    config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]> {
    const body = {
      person_titles: filter.titles,
      person_seniorities: filter.seniority,
      person_locations: filter.geography,
      organization_industry_tag_ids: filter.industries,
      organization_num_employees_ranges: numEmployeesRange(filter),
      q_keywords: filter.keywords?.join(" "),
      page: 1,
      per_page: filter.limit ?? 25,
    };

    const payload = (await this.requestJson("/mixed_people/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: JSON.stringify(body),
    })) as { people?: ApolloPerson[] };

    return (payload.people ?? []).map((person) =>
      this.mapPerson(filter, person)
    );
  }

  protected async fetchEnrich(
    config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment> {
    const body = {
      id: target.sourceRef,
      name: target.displayName,
      organization_name: target.companyName,
      email: target.email,
    };

    const payload = (await this.requestJson("/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: JSON.stringify(body),
    })) as { person?: ApolloPerson };

    const person = payload.person ?? {};
    return {
      sourceProvider: this.id,
      sourceRef: person.id,
      attributes: this.attributes(
        {
          displayName: person.name,
          title: person.title,
          email: person.email,
          phone: person.phone_numbers?.[0]?.raw_number,
          country: person.country,
          seniority: person.seniority,
          linkedinUrl: person.linkedin_url,
          companyName: person.organization?.name,
          industry: person.organization?.industry,
        },
        ENRICH_PII_KEYS
      ),
    };
  }

  /** Map one Apollo person onto a provenanced {@link ProviderResult}. */
  private mapPerson(
    filter: ProspectFilter,
    person: ApolloPerson
  ): ProviderResult {
    return {
      targetType: filter.targetType,
      displayName: person.name,
      companyName: person.organization?.name,
      title: person.title,
      email: person.email,
      phone: person.phone_numbers?.[0]?.raw_number,
      country: person.country,
      attributes: this.attributes(
        {
          title: person.title,
          email: person.email,
          seniority: person.seniority,
          linkedinUrl: person.linkedin_url,
          industry: person.organization?.industry,
          companySize: person.organization?.estimated_num_employees?.toString(),
        },
        SEARCH_PII_KEYS
      ),
      sourceProvider: this.id,
      sourceRef: person.id,
      lawfulBasis: "legitimate_interest",
    };
  }
}

/** Map an ICP company-size band to Apollo's `num_employees_ranges` form. */
function numEmployeesRange(filter: ProspectFilter): string[] | undefined {
  const size = filter.companySize;
  if (!size) return undefined;
  const min = size.min ?? 1;
  const max = size.max ?? 100000;
  return [`${min},${max}`];
}

/** Register the Apollo provider into the shared registry (resolved on first use). */
export function registerApolloProvider(): void {
  registerProviderLazy("apollo", () => new ApolloProvider());
}

// Self-register on import so the fan-out picks Apollo up when configured.
registerApolloProvider();
