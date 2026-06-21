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

/** Resolve demo config from env; `null` (→ unconfigured) unless `PROSPECT_DEMO=true`. */
export function demoConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig | null {
  if (env.PROSPECT_DEMO !== "true") return null;
  return { apiKey: "demo", baseUrl: "demo://local" };
}

// ── Synthetic person pool (Dubai prime-residential ICP) ─────────────────────────

interface DemoPerson {
  name: string;
  title: string;
  company: string;
  country: string;
  segment: string; // maps to a Buyer_Hypothesis segment label
  email: string;
}

const DEMO_PEOPLE: readonly DemoPerson[] = [
  { name: "Arjun Mehta", title: "Founder & CEO", company: "Meridian Capital Partners", country: "India", segment: "International investor", email: "a.mehta@meridiancap.example" },
  { name: "Priya Raghunathan", title: "Managing Director", company: "Sterling Family Office", country: "India", segment: "Family office", email: "priya.r@sterlingfo.example" },
  { name: "James Whitmore", title: "Chief Investment Officer", company: "Albion Wealth", country: "United Kingdom", segment: "HNW individual", email: "j.whitmore@albionwealth.example" },
  { name: "Olga Petrova", title: "Principal", company: "Nevsky Holdings", country: "Russia", segment: "HNW individual", email: "o.petrova@nevsky.example" },
  { name: "Khalid Al-Rashid", title: "Chairman", company: "Rashid Investments LLC", country: "Saudi Arabia", segment: "Family office", email: "k.alrashid@rashidinv.example" },
  { name: "Mei Lin Chen", title: "Founder", company: "Pacific Crest Ventures", country: "China", segment: "International investor", email: "m.chen@pacificcrest.example" },
  { name: "Daniel Hofmann", title: "Managing Partner", company: "Rhein Private Equity", country: "Germany", segment: "International investor", email: "d.hofmann@rheinpe.example" },
  { name: "Sara Haddad", title: "CEO", company: "Levant Growth Capital", country: "United Arab Emirates", segment: "Golden visa holder", email: "s.haddad@levantgc.example" },
  { name: "Vikram Anand", title: "Investor & Board Member", company: "Anand Industries", country: "India", segment: "HNW individual", email: "v.anand@anandind.example" },
  { name: "Charlotte Bennett", title: "Partner", company: "Thames Asset Management", country: "United Kingdom", segment: "Family office", email: "c.bennett@thamesam.example" },
] as const;

const SENIORITY_FROM_TITLE = (title: string): string => {
  const t = title.toLowerCase();
  if (t.includes("chair") || t.includes("ceo") || t.includes("founder") || t.includes("principal"))
    return "c_suite";
  if (t.includes("managing") || t.includes("partner") || t.includes("chief"))
    return "executive";
  return "senior";
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

  /** Generate ICP-shaped synthetic candidates offline (no transport call). */
  protected async fetchSearch(
    _config: ProviderConfig,
    filter: ProspectFilter
  ): Promise<ProviderResult[]> {
    const limit = Math.min(Math.max(filter.limit ?? 8, 1), DEMO_PEOPLE.length);

    // Light relevance ranking: prefer people whose country is in the ICP
    // geography and whose title overlaps the requested titles — purely cosmetic
    // ordering so the demo reflects the filter.
    const geo = (filter.geography ?? []).map((g) => g.toLowerCase());
    const titles = (filter.titles ?? []).map((t) => t.toLowerCase());
    const scored = DEMO_PEOPLE.map((p) => {
      let score = 0;
      if (geo.some((g) => p.country.toLowerCase().includes(g) || g.includes(p.country.toLowerCase())))
        score += 2;
      if (titles.some((t) => p.title.toLowerCase().includes(t) || t.includes(p.title.toLowerCase().split(" ")[0])))
        score += 1;
      return { p, score };
    }).sort((a, b) => (b.score !== a.score ? b.score - a.score : a.p.name < b.p.name ? -1 : 1));

    return scored.slice(0, limit).map(({ p }) => this.mapPerson(filter, p));
  }

  /** Enrich a demo Target with a couple of extra provenanced attributes. */
  protected async fetchEnrich(
    _config: ProviderConfig,
    target: TargetRef
  ): Promise<ProviderEnrichment> {
    const match =
      DEMO_PEOPLE.find(
        (p) => p.email === target.email || p.name === target.displayName
      ) ?? DEMO_PEOPLE[0];
    return {
      sourceProvider: this.id,
      sourceRef: `demo:${match.email}`,
      attributes: this.attributes(
        {
          displayName: match.name,
          title: match.title,
          companyName: match.company,
          email: match.email,
          country: match.country,
          seniority: SENIORITY_FROM_TITLE(match.title),
          wealthSignal: match.segment,
          linkedinUrl: `https://www.linkedin.com/in/${match.name.toLowerCase().replace(/\s+/g, "-")}-demo`,
        },
        new Set(["email", "linkedinUrl"])
      ),
    };
  }

  private mapPerson(filter: ProspectFilter, p: DemoPerson): ProviderResult {
    return {
      targetType: filter.targetType,
      displayName: p.name,
      companyName: p.company,
      title: p.title,
      email: p.email,
      country: p.country,
      attributes: this.attributes(
        {
          title: p.title,
          email: p.email,
          seniority: SENIORITY_FROM_TITLE(p.title),
          wealthSignal: p.segment,
          industry: "Investment Management",
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
