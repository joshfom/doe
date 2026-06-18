/**
 * Prospecting Workspace (S7) — Crunchbase Account/Funding provider (Appendix A;
 * Design §Components #4; Requirements 2.3, 2.4, 3.1, 3.2; task 4.2 **[deps]**).
 *
 * Crunchbase is the funding / liquidity-trigger source — the "why now" for
 * person-mode buying power (a founder's Series C or acquisition is *evidence of
 * buying power*, Appendix A / requirements §person-mode). This adapter maps
 * Crunchbase's organization-search and entity payloads onto our provenanced
 * {@link ProviderResult} / {@link ProviderEnrichment}, reading its credential
 * from `CRUNCHBASE_API_KEY` (base URL overridable via `CRUNCHBASE_API_BASE_URL`).
 * When the key is absent both `search` and `enrich` return `{ unconfigured: true }`
 * WITHOUT a network call (Req 2.4); the adapter never throws on missing creds.
 *
 * Crunchbase returns firmographic + funding signals, not individual PII, so the
 * mapped attributes (funding stage/total, employee count, founded year, website)
 * are non-PII provenanced fields — the funding signal is what feeds the
 * Buyer_Hypothesis. The HTTP transport is injected so tests never hit Crunchbase
 * ([deps]); the adapter self-registers into the shared registry on import.
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

/** Default Crunchbase API base; override with `CRUNCHBASE_API_BASE_URL`. */
export const CRUNCHBASE_DEFAULT_BASE_URL = "https://api.crunchbase.com/api/v4";

/** Resolve Crunchbase config from env; `null` when `CRUNCHBASE_API_KEY` is absent. */
export function crunchbaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  return configFromEnv(
    "CRUNCHBASE_API_KEY",
    "CRUNCHBASE_API_BASE_URL",
    CRUNCHBASE_DEFAULT_BASE_URL,
    env
  );
}

/**
 * Shape of a Crunchbase organization record (the subset this adapter reads).
 * Crunchbase v4 nests values under `properties`; this adapter reads the flattened
 * subset our mapping needs.
 */
interface CrunchbaseOrganization {
  uuid?: string;
  name?: string;
  /** Funding/liquidity signals — the "why now". */
  last_funding_type?: string;
  num_funding_rounds?: number;
  total_funding_usd?: number;
  /** Firmographic context. */
  categories?: string[];
  num_employees_enum?: string;
  founded_on?: string;
  website_url?: string;
  location_identifiers?: string[];
  country_code?: string;
}

/** A Crunchbase search row wraps the org under `properties`. */
interface CrunchbaseSearchEntity {
  uuid?: string;
  properties?: CrunchbaseOrganization;
}

/** Crunchbase {@link EnrichmentProvider} adapter (funding/liquidity signals). */
export class CrunchbaseProvider extends BaseEnrichmentProvider {
  readonly id = "crunchbase" as const;

  constructor(
    config: ProviderConfig | null = crunchbaseConfigFromEnv(),
    deps: ProviderDeps = {}
  ) {
    super(config, deps);
  }

  protected async fetchSearch(
    config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]> {
    // Crunchbase v4 search: POST /searches/organizations with a field/query body.
    // We translate the ICP seeds Crunchbase supports — industries, geography,
    // and funding signals (its differentiator).
    const body = {
      field_ids: [
        "identifier",
        "name",
        "last_funding_type",
        "num_funding_rounds",
        "funding_total",
        "categories",
        "num_employees_enum",
        "founded_on",
        "website_url",
        "location_identifiers",
      ],
      query: buildSearchQuery(filter),
      limit: filter.limit ?? 25,
    };

    const payload = (await this.requestJson("/searches/organizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-cb-user-key": config.apiKey,
      },
      body: JSON.stringify(body),
    })) as { entities?: CrunchbaseSearchEntity[] };

    return (payload.entities ?? []).map((entity) =>
      this.mapOrganization(filter, {
        uuid: entity.uuid ?? entity.properties?.uuid,
        ...(entity.properties ?? {}),
      })
    );
  }

  protected async fetchEnrich(
    config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment> {
    // Entity lookup by Crunchbase uuid (sourceRef) when known, else by name.
    const entityId = target.sourceRef ?? target.companyName ?? "";
    const payload = (await this.requestJson(
      `/entities/organizations/${encodeURIComponent(entityId)}`,
      {
        method: "GET",
        headers: { "X-cb-user-key": config.apiKey },
      }
    )) as { properties?: CrunchbaseOrganization };

    const org = payload.properties ?? {};
    return {
      sourceProvider: this.id,
      sourceRef: org.uuid ?? target.sourceRef,
      // Funding/firmographic signals only — Crunchbase returns no individual PII,
      // so none of these attributes carry a lawful-basis PII marker.
      attributes: this.attributes({
        companyName: org.name,
        lastFundingType: org.last_funding_type,
        numFundingRounds: org.num_funding_rounds?.toString(),
        totalFundingUsd: org.total_funding_usd?.toString(),
        industry: org.categories?.join(", "),
        companySize: org.num_employees_enum,
        foundedOn: org.founded_on,
        website: org.website_url,
        country: org.country_code ?? org.location_identifiers?.[0],
      }),
    };
  }

  /** Map one Crunchbase organization onto a provenanced {@link ProviderResult}. */
  private mapOrganization(
    filter: ProspectFilter,
    org: CrunchbaseOrganization
  ): ProviderResult {
    return {
      targetType: filter.targetType,
      companyName: org.name,
      country: org.country_code ?? org.location_identifiers?.[0],
      // No individual PII from Crunchbase — funding/firmographic signals only.
      attributes: this.attributes({
        companyName: org.name,
        lastFundingType: org.last_funding_type,
        numFundingRounds: org.num_funding_rounds?.toString(),
        totalFundingUsd: org.total_funding_usd?.toString(),
        industry: org.categories?.join(", "),
        companySize: org.num_employees_enum,
        foundedOn: org.founded_on,
        website: org.website_url,
      }),
      sourceProvider: this.id,
      sourceRef: org.uuid,
      lawfulBasis: "legitimate_interest",
    };
  }
}

/**
 * Build the Crunchbase v4 search `query` array from the ICP filter — only the
 * seeds Crunchbase supports (funding signals, industries, geography). Absent
 * seeds contribute no predicate.
 */
function buildSearchQuery(filter: ProspectFilter): Array<{
  type: "predicate";
  field_id: string;
  operator_id: string;
  values: string[];
}> {
  const query: Array<{
    type: "predicate";
    field_id: string;
    operator_id: string;
    values: string[];
  }> = [];

  if (filter.fundingSignals?.length) {
    query.push({
      type: "predicate",
      field_id: "last_funding_type",
      operator_id: "includes",
      values: filter.fundingSignals,
    });
  }
  if (filter.industries?.length) {
    query.push({
      type: "predicate",
      field_id: "categories",
      operator_id: "includes",
      values: filter.industries,
    });
  }
  if (filter.geography?.length) {
    query.push({
      type: "predicate",
      field_id: "location_identifiers",
      operator_id: "includes",
      values: filter.geography,
    });
  }

  return query;
}

/** Register the Crunchbase provider into the shared registry (resolved on first use). */
export function registerCrunchbaseProvider(): void {
  registerProviderLazy("crunchbase", () => new CrunchbaseProvider());
}

// Self-register on import so the fan-out picks Crunchbase up when configured.
registerCrunchbaseProvider();
