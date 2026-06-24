/**
 * Demo Account/Person provider — Prospecting Workspace (S7).
 *
 * The commercial providers (Apollo / PDL / Cognism / Crunchbase) need a paid API
 * key; with none usable, `prospect_search` returns no candidates and the
 * "Candidate targets" panel stays empty. This synthetic provider — gated by
 * `PROSPECT_DEMO=true` — returns believable, ICP-shaped candidates entirely
 * offline (no network call), stamped with honest `source: "demo"` provenance and
 * a `legitimate_interest` lawful basis, so the full flow (search → record →
 * enrich → draft → approve) is demoable without a data subscription.
 *
 * The candidate pool is a generated dataset of ~240 personas (people, companies,
 * and intermediaries) in `demo-personas.json` — regenerate it with
 * `bun run scripts/generate-demo-personas.ts`. The provider does the actual
 * "finding" against this local data: it filters by target type and RANKS the
 * pool against the full ICP filter (geography, titles/seniority, industries,
 * funding/wealth signals, keywords, company size), so search results visibly
 * track the rep's hypothesis — no API call, run directly here.
 *
 * It is just another {@link EnrichmentProvider}: it flows through the SAME
 * audited `prospect_search` fan-out and provenance stamping as the real
 * adapters. When `PROSPECT_DEMO` is not "true" it reports `{ unconfigured: true }`
 * WITHOUT producing anything, so it is inert in production.
 */

import {
  BaseEnrichmentProvider,
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
import demoPersonasJson from "./demo-personas.json";

/** Resolve demo config from env; `null` (→ unconfigured) unless `PROSPECT_DEMO=true`. */
export function demoConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  if (env.PROSPECT_DEMO !== "true") return null;
  return { apiKey: "demo", baseUrl: "demo://local" };
}

// ── Synthetic persona pool (generated; Dubai prime-residential ICP) ─────────────

/** One generated persona — the superset record `demo-personas.json` carries. */
export interface DemoPersona {
  targetType: "person" | "company" | "intermediary";
  displayName: string;
  companyName: string;
  title: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  segment: string;
  industry: string;
  seniority: string;
  companySize: number;
  wealthSignals: string[];
  fundingSignals: string[];
  keywords: string[];
}

/** The full generated pool (~240 personas across the three target types). */
export const DEMO_PERSONAS: readonly DemoPersona[] =
  demoPersonasJson as readonly DemoPersona[];

// ── Relevance scoring (so search visibly tracks the ICP filter) ─────────────────

/** Case-insensitive "either side contains the other" token match. */
function softMatch(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** Does any needle softly match any haystack token? */
function anyMatch(needles: readonly string[], haystack: readonly string[]): boolean {
  return needles.some((n) => haystack.some((h) => softMatch(n, h)));
}

/**
 * Score a persona against the ICP filter. Higher = more relevant. Geography and
 * title carry the most weight (they are the rep's primary levers), with
 * seniority, industry, funding/wealth signals, keywords, and company-size band
 * each contributing. A persona with zero matches still scores 0 and remains
 * eligible to fill the requested `limit` (so the demo never comes back empty for
 * a valid target type).
 */
function scorePersona(persona: DemoPersona, filter: ProspectFilter): number {
  let score = 0;
  const geo = filter.geography ?? [];
  if (geo.length && (anyMatch(geo, [persona.country]) || anyMatch(geo, [persona.city]))) {
    score += 3;
  }
  const titles = filter.titles ?? [];
  if (titles.length && anyMatch(titles, [persona.title])) score += 3;

  const seniority = filter.seniority ?? [];
  if (seniority.length && anyMatch(seniority, [persona.seniority])) score += 2;

  const industries = filter.industries ?? [];
  if (industries.length && anyMatch(industries, [persona.industry])) score += 2;

  const funding = filter.fundingSignals ?? [];
  if (funding.length && anyMatch(funding, persona.fundingSignals)) score += 2;

  const wealth = filter.wealthSignals ?? [];
  if (wealth.length && (anyMatch(wealth, persona.wealthSignals) || anyMatch(wealth, [persona.segment]))) {
    score += 2;
  }

  const keywords = filter.keywords ?? [];
  if (
    keywords.length &&
    (anyMatch(keywords, persona.keywords) ||
      anyMatch(keywords, [persona.segment, persona.industry, persona.title]))
  ) {
    score += 1;
  }

  const size = filter.companySize;
  if (size && (size.min != null || size.max != null)) {
    const okMin = size.min == null || persona.companySize >= size.min;
    const okMax = size.max == null || persona.companySize <= size.max;
    if (okMin && okMax) score += 1;
  }

  return score;
}

const SENIORITY_LABEL = (seniority: string): string => {
  switch (seniority) {
    case "c_suite":
      return "c_suite";
    case "executive":
      return "executive";
    case "organization":
      return "organization";
    case "advisor":
      return "advisor";
    default:
      return "senior";
  }
};

/** The demo {@link EnrichmentProvider}. */
export class DemoProvider extends BaseEnrichmentProvider {
  readonly id = "demo" as const;

  constructor(
    config: ProviderConfig | null = demoConfigFromEnv(),
    deps: ProviderDeps = {}
  ) {
    super(config, deps);
  }

  /** Find ICP-shaped synthetic candidates from the local pool (no transport). */
  protected async fetchSearch(
    _config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]> {
    // Only personas of the requested target type are eligible (person / company
    // / intermediary are distinct prospecting modes).
    const pool = DEMO_PERSONAS.filter((p) => p.targetType === filter.targetType);
    if (pool.length === 0) return [];

    const limit = Math.min(Math.max(filter.limit ?? 8, 1), pool.length);

    // Rank by relevance to the filter; ties broken by name for determinism.
    const ranked = pool
      .map((p) => ({ p, score: scorePersona(p, filter) }))
      .sort((a, b) =>
        b.score !== a.score ? b.score - a.score : a.p.displayName < b.p.displayName ? -1 : 1
      );

    return ranked.slice(0, limit).map(({ p }) => this.mapPersona(filter, p));
  }

  /** Enrich a demo Target with a few extra provenanced attributes from the pool. */
  protected async fetchEnrich(
    _config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment> {
    const match =
      DEMO_PERSONAS.find(
        (p) =>
          (target.email && p.email === target.email) ||
          (target.displayName && p.displayName === target.displayName)
      ) ?? DEMO_PERSONAS[0];
    return {
      sourceProvider: this.id,
      sourceRef: `demo:${match.email}`,
      attributes: this.attributes(
        {
          displayName: match.displayName,
          title: match.title,
          companyName: match.companyName,
          email: match.email,
          country: match.country,
          city: match.city,
          industry: match.industry,
          seniority: SENIORITY_LABEL(match.seniority),
          wealthSignal: match.wealthSignals[0] ?? match.segment,
          companySize: String(match.companySize),
          linkedinUrl: `https://www.linkedin.com/in/${match.displayName
            .toLowerCase()
            .replace(/\s+/g, "-")}-demo`,
        },
        new Set(["email", "linkedinUrl"])
      ),
    };
  }

  private mapPersona(filter: ProspectFilter, p: DemoPersona): ProviderResult {
    return {
      targetType: filter.targetType,
      displayName: p.displayName,
      companyName: p.companyName,
      title: p.title,
      email: p.email,
      // Raw phone held transiently — `record_target` persists it only as a
      // salted hash (CC-Privacy). Surfacing it here exercises the hashing path.
      phone: p.phone,
      country: p.country,
      attributes: this.attributes(
        {
          title: p.title,
          email: p.email,
          seniority: SENIORITY_LABEL(p.seniority),
          wealthSignal: p.wealthSignals[0] ?? p.segment,
          fundingSignal: p.fundingSignals[0],
          industry: p.industry,
          city: p.city,
          companySize: String(p.companySize),
        },
        new Set(["email"])
      ),
      sourceProvider: this.id,
      sourceRef: `demo:${p.email}`,
      lawfulBasis: "legitimate_interest",
    };
  }
}

/** Register the demo provider into the shared registry (resolved on first use). */
export function registerDemoProvider(): void {
  registerProviderLazy("demo", () => new DemoProvider());
}

// Self-register on import so the fan-out picks the demo provider up when enabled.
registerDemoProvider();
