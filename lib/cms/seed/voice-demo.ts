/**
 * DOE Voice Surface — demo seed (task 18.1).
 *
 * Seeds the synthetic dataset the voice demo + Demo Console rehearse against:
 *
 *   • reps           — Sara (EN/AR, Bayn) and Omar (EN, investment desk).
 *   • parties        — a headline KNOWN WARM caller (Khalid, deliberately left
 *                      UNASSIGNED so routing happens live on stage) plus a
 *                      ~90-day spread of synthetic leads across channels.
 *   • partyIdentities— salted `phone_hash` + `email` for every party. The raw
 *                      phone is NEVER persisted — only the salted hash, exactly
 *                      as `lib/cms/voice/identity.ts` computes it (Req 14.5).
 *   • leadsMirror    — tier / source(channel) / campaign / speed-to-lead /
 *                      assigned-rep, shaped so the `metrics_*` views return a
 *                      clear "best cost-per-qualified-lead" answer with one
 *                      narratable anomaly (events overspends, converts poorly).
 *   • viewingSlots   — Bayn viewings on Thu/Fri/Sat, mixed reps.
 *   • marketingSpend — a 90-day spend spread by channel so the metrics views
 *                      have spend to divide qualified-lead counts by.
 *
 * EVERY row written here carries `demo = true` so the voice demo reset
 * (task 18.2 `resetVoiceDemo` / `POST /api/demo/reset`) removes exactly this
 * scope and nothing else (Requirements 11.4, 11.5; Design §9, spec §7).
 *
 * The dataset is fully deterministic (a seeded LCG, fixed clock anchor) so the
 * narrated figures are stable every rehearsal. All data is synthetic (Req 14.8).
 *
 * Implementation note: the row builders are pure functions (no DB) so they can
 * be unit-tested directly; `seedVoiceDemo` / `clearVoiceDemo` do the IO.
 */
import { eq, inArray } from "drizzle-orm";

import type { Database } from "../db";
import {
  leadsMirror,
  marketingSpend,
  parties,
  partyIdentities,
  reps,
  viewingSlots,
} from "../schema";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Demo dataset window: leads + spend spread across the last 90 days. */
const WINDOW_DAYS = 90;

/**
 * Marketing channels for the demo. `source` on a `leads_mirror` row equals
 * `channel` on a `marketing_spend` row — that join is how the metrics views
 * compute cost-per-qualified-lead (drizzle/0030_metrics_views.sql).
 *
 * The shape is intentional and narratable:
 *   • `Google`  — efficient: modest spend, high qualified yield → BEST CPQL.
 *   • `Meta`    — high volume, solid yield → strong runner-up.
 *   • `Bayut` / `PropertyFinder` — portal spend, mid yield.
 *   • `events`  — THE ANOMALY: heavy sponsorship spend, very few qualified
 *                 leads → worst CPQL, the thing the exec is meant to spot.
 *   • `web`     — organic, no spend row → leads attributed but not "bought".
 */
interface ChannelProfile {
  channel: string;
  campaign: string;
  /** Total qualified leads to generate for this channel over the window. */
  qualifiedLeads: number;
  /** AED spent per week for this channel (0 = organic, no spend rows). */
  weeklySpend: number;
  /** Relative tier mix [HOT, WARM, NURTURE] weights. */
  tierMix: [number, number, number];
}

const CHANNELS: readonly ChannelProfile[] = [
  { channel: "Google", campaign: "demo-google-search-q1", qualifiedLeads: 34, weeklySpend: 4200, tierMix: [5, 4, 2] },
  { channel: "Meta", campaign: "demo-meta-prospecting-q1", qualifiedLeads: 30, weeklySpend: 6000, tierMix: [3, 4, 4] },
  { channel: "Bayut", campaign: "demo-bayut-listing-q1", qualifiedLeads: 18, weeklySpend: 3500, tierMix: [3, 4, 3] },
  { channel: "PropertyFinder", campaign: "demo-pf-listing-q1", qualifiedLeads: 16, weeklySpend: 3800, tierMix: [3, 3, 4] },
  { channel: "web", campaign: "demo-web-organic-q1", qualifiedLeads: 12, weeklySpend: 0, tierMix: [4, 4, 3] },
  // The anomaly: large spend, almost no qualified leads.
  { channel: "events", campaign: "demo-events-sponsorship-q1", qualifiedLeads: 5, weeklySpend: 9000, tierMix: [1, 2, 4] },
] as const;

const TIERS = ["HOT", "WARM", "NURTURE"] as const;
type Tier = (typeof TIERS)[number];

/** Bayn projects callers express interest in (drives routing + viewing slots). */
const BAYN_PROJECTS = ["Bayn", "Bayn Marina", "Bayn Hills", "Bayn Coast"] as const;

const BUDGET_BANDS = ["1.5M-2.0M", "2.0M-2.5M", "2.5M-3.0M", "3.0M-4.0M"] as const;

/** Demo phone-hash salt fallback so the seed runs even without env configured. */
const DEMO_PHONE_HASH_SALT = "doe-voice-demo-salt";

// ── Deterministic helpers ──────────────────────────────────────────────────────

/** A fixed clock anchor would drift the metrics window; we anchor to "now". */
function now(): Date {
  return new Date();
}

function daysAgo(days: number, hour = 10): Date {
  const d = now();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  // Clamp so a seed `createdAt` can never land in the future: for `days = 0`
  // the chosen hour (9–16) can be ahead of the wall clock when the seed runs
  // earlier in the day. Lead arrival timestamps must be in the past, so cap at
  // "now" (downstream metrics windows + the 18.1 unit test rely on age ≥ 0).
  const nowMs = Date.now();
  return d.getTime() > nowMs ? new Date(nowMs) : d;
}

/** A `YYYY-MM-DD` date string `days` before today (for `date`-typed columns). */
function dateStrDaysAgo(days: number): string {
  const d = now();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Small deterministic LCG so the dataset is identical across rehearsals. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG constants.
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Pick a tier by weighted mix [HOT, WARM, NURTURE]. */
function pickTier(rng: () => number, mix: [number, number, number]): Tier {
  const total = mix[0] + mix[1] + mix[2];
  const r = rng() * total;
  if (r < mix[0]) return "HOT";
  if (r < mix[0] + mix[1]) return "WARM";
  return "NURTURE";
}

/** Resolve the salt used to hash demo phones (env first, demo fallback). */
function demoSalt(): string {
  const envSalt = process.env.PHONE_HASH_SALT;
  return envSalt && envSalt.trim().length > 0 ? envSalt : DEMO_PHONE_HASH_SALT;
}

// ── Row builders (pure) ────────────────────────────────────────────────────────

export interface RepSeed {
  /** Stable local key so other builders can reference a rep before its UUID. */
  key: string;
  name: string;
  languages: string[];
  projects: string[];
  capacity: number;
  openHotCount: number;
  phone: string;
  demo: true;
}

/**
 * The two demo reps (spec §7): Sara handles Bayn in EN/AR; Omar runs the
 * investment desk in EN. Both have capacity 3; Sara already carries 2 open hot
 * leads, Omar 1 — so live routing has a visible load story.
 */
export function buildReps(): RepSeed[] {
  return [
    {
      key: "sara",
      name: "Sara Haddad",
      languages: ["en", "ar"],
      projects: ["Bayn", "Bayn Marina", "Bayn Hills", "Bayn Coast"],
      capacity: 3,
      openHotCount: 2,
      phone: "+971501000001",
      demo: true,
    },
    {
      key: "omar",
      name: "Omar Khalil",
      languages: ["en"],
      projects: ["Investment Desk", "Bayn Marina"],
      capacity: 3,
      openHotCount: 1,
      phone: "+971501000002",
      demo: true,
    },
  ];
}

export interface PartySeed {
  key: string;
  name: string;
  language: "en" | "ar";
  /** Raw phone — hashed into an identity, NEVER persisted raw (Req 14.5). */
  phone: string;
  email: string;
  consent: boolean;
  createdAt: Date;
  demo: true;
}

export interface LeadSeed {
  /** References a `PartySeed.key`. */
  partyKey: string;
  tier: Tier;
  source: string;
  campaign: string;
  projectInterest: string;
  unitInterest: string | null;
  budgetBand: string;
  /** References a `RepSeed.key`, or null for an unassigned (route-live) lead. */
  assignedRepKey: string | null;
  lastInteractionAt: Date;
  lastInteractionSummary: string;
  demo: true;
}

/** The headline known caller's stable identity (documented for the demo run). */
export const KNOWN_WARM_CALLER = {
  key: "khalid",
  name: "Khalid Al Rashid",
  /** Dial-in / form phone the presenter uses to be recognised at ring time. */
  phone: "+971501112233",
  email: "khalid.demo@ora-voice-demo.test",
  language: "en" as const,
} as const;

/**
 * Build the full party + lead dataset.
 *
 * Returns the headline known caller first (Khalid: KNOWN, WARM, UNASSIGNED →
 * satisfies both "known WARM caller" and "unassigned routing case"), then the
 * ~90-day synthetic spread per channel. Roughly a third of the spread is also
 * left unassigned so rep-load metrics and live routing both have material.
 */
export function buildPartiesAndLeads(seed = 1337): {
  parties: PartySeed[];
  leads: LeadSeed[];
} {
  const rng = makeRng(seed);
  const repKeys = buildReps().map((r) => r.key);

  const partySeeds: PartySeed[] = [];
  const leadSeeds: LeadSeed[] = [];

  // 1) Headline known caller — WARM, Bayn 2BR, ~2.5–3.0M, EN, brochure in the
  //    March campaign, deliberately UNASSIGNED so routing happens on stage.
  partySeeds.push({
    key: KNOWN_WARM_CALLER.key,
    name: KNOWN_WARM_CALLER.name,
    language: KNOWN_WARM_CALLER.language,
    phone: KNOWN_WARM_CALLER.phone,
    email: KNOWN_WARM_CALLER.email,
    consent: true,
    createdAt: daysAgo(28), // arrived ~4 weeks ago in the March campaign.
    demo: true,
  });
  leadSeeds.push({
    partyKey: KNOWN_WARM_CALLER.key,
    tier: "WARM",
    source: "Meta",
    campaign: "demo-meta-march-brochure",
    projectInterest: "Bayn",
    unitInterest: "2BR",
    budgetBand: "2.5M-3.0M",
    assignedRepKey: null, // unassigned → live routing on stage.
    lastInteractionAt: daysAgo(26),
    lastInteractionSummary: "Asked for the Bayn 2BR brochure (March Meta campaign).",
    demo: true,
  });

  // 2) The ~90-day synthetic spread, channel by channel.
  let n = 0;
  for (const ch of CHANNELS) {
    for (let i = 0; i < ch.qualifiedLeads; i++) {
      n++;
      const key = `lead-${ch.channel.toLowerCase()}-${i + 1}`;
      const createdDaysAgo = Math.floor(rng() * WINDOW_DAYS);
      const createdAt = daysAgo(createdDaysAgo, 9 + (n % 8));
      const tier = pickTier(rng, ch.tierMix);
      const language: "en" | "ar" = rng() < 0.25 ? "ar" : "en";

      // ~1/3 of leads unassigned; the rest round-robin across reps.
      const assigned = rng() > 0.34;
      const assignedRepKey = assigned ? repKeys[n % repKeys.length] : null;

      // Speed-to-lead: minutes→hours after arrival (HOT contacted fastest).
      const baseMinutes = tier === "HOT" ? 8 : tier === "WARM" ? 45 : 180;
      const jitter = Math.floor(rng() * baseMinutes);
      const lastInteractionAt = new Date(
        createdAt.getTime() + (baseMinutes + jitter) * 60_000
      );

      partySeeds.push({
        key,
        name: `Demo Lead ${n}`,
        language,
        phone: `+9715${String(2_000_0000 + n).padStart(8, "0")}`,
        email: `lead${n}@ora-voice-demo.test`,
        consent: true,
        createdAt,
        demo: true,
      });
      leadSeeds.push({
        partyKey: key,
        tier,
        source: ch.channel,
        campaign: ch.campaign,
        projectInterest: pick(rng, BAYN_PROJECTS),
        unitInterest: pick(rng, ["1BR", "2BR", "3BR", "Villa", null] as const),
        budgetBand: pick(rng, BUDGET_BANDS),
        assignedRepKey,
        lastInteractionAt,
        lastInteractionSummary: `${ch.channel} enquiry — qualified ${tier}.`,
        demo: true,
      });
    }
  }

  return { parties: partySeeds, leads: leadSeeds };
}

export interface SpendSeed {
  date: string;
  channel: string;
  campaignId: string;
  spend: string;
  impressions: number;
  clicks: number;
  currency: "AED";
  demo: true;
}

/**
 * Build ~90 days of weekly marketing spend per paid channel. Organic channels
 * (weeklySpend 0, e.g. `web`) emit no rows — leads still attribute to them, so
 * their cost-per-qualified-lead is null/zero, which the views handle.
 */
export function buildMarketingSpend(seed = 7): SpendSeed[] {
  const rng = makeRng(seed);
  const rows: SpendSeed[] = [];
  const weeks = Math.ceil(WINDOW_DAYS / 7);

  for (const ch of CHANNELS) {
    if (ch.weeklySpend <= 0) continue;
    for (let w = 0; w < weeks; w++) {
      const date = dateStrDaysAgo(w * 7 + 1); // one row per week, mid-window.
      // ±15% deterministic wobble so charts look real, not flat.
      const wobble = 0.85 + rng() * 0.3;
      const spendVal = Math.round(ch.weeklySpend * wobble);
      const clicks = 40 + Math.floor(rng() * 120);
      rows.push({
        date,
        channel: ch.channel,
        campaignId: ch.campaign,
        spend: spendVal.toFixed(2),
        impressions: clicks * (20 + Math.floor(rng() * 30)),
        clicks,
        currency: "AED",
        demo: true,
      });
    }
  }

  return rows;
}

export interface SlotSeed {
  project: string;
  startsAt: Date;
  repKey: string;
  taken: boolean;
  demo: true;
}

/**
 * Build Bayn viewing slots on the next Thu/Fri/Sat, mixed reps (spec §7).
 * A couple are pre-taken so `check_viewing_slots` has a realistic availability
 * picture and `book_viewing` has open slots to claim.
 */
export function buildViewingSlots(): SlotSeed[] {
  const repKeys = buildReps().map((r) => r.key);
  const slots: SlotSeed[] = [];

  // Find the next Thursday (JS getDay: Thu = 4) from today.
  const base = now();
  base.setHours(0, 0, 0, 0);
  const daysUntilThu = (4 - base.getDay() + 7) % 7 || 7;
  const thursday = new Date(base);
  thursday.setDate(base.getDate() + daysUntilThu);

  const dayOffsets = [0, 1, 2]; // Thu, Fri, Sat
  const times = [10, 13, 16]; // three viewing windows per day
  let idx = 0;
  for (const off of dayOffsets) {
    for (const hour of times) {
      const startsAt = new Date(thursday);
      startsAt.setDate(thursday.getDate() + off);
      startsAt.setHours(hour, 0, 0, 0);
      slots.push({
        project: "Bayn",
        startsAt,
        repKey: repKeys[idx % repKeys.length],
        taken: idx % 4 === 0, // ~1 in 4 already booked
        demo: true,
      });
      idx++;
    }
  }

  return slots;
}

// ── DB IO ──────────────────────────────────────────────────────────────────────

export interface VoiceDemoSummary {
  reps: number;
  parties: number;
  identities: number;
  leads: number;
  viewingSlots: number;
  marketingSpend: number;
  knownWarmCallerPhoneHash: string;
}

/**
 * Remove exactly the voice-demo-scoped rows (`demo = true`) in FK-safe order.
 *
 * Deleting demo parties cascades to their `party_identities` and `leads_mirror`
 * rows (both declared `onDelete: "cascade"`), but `viewing_slots` and
 * `leads_mirror.assigned_rep_id` reference `reps` without cascade, so reps are
 * deleted last. This is the same scope `resetVoiceDemo` (task 18.2) will own; it
 * lives here so the seed itself stays idempotent across re-runs.
 */
export async function clearVoiceDemo(db: Database): Promise<void> {
  // leads_mirror first (FK → reps via assigned_rep_id); also cascades from
  // parties, but deleting explicitly keeps the order independent of cascade.
  await db.delete(leadsMirror).where(eq(leadsMirror.demo, true));
  await db.delete(viewingSlots).where(eq(viewingSlots.demo, true));

  // Demo parties — cascades to party_identities (and any residual leads_mirror).
  const demoParties = await db
    .select({ id: parties.id })
    .from(parties)
    .where(eq(parties.demo, true));
  const ids = demoParties.map((p) => p.id);
  if (ids.length > 0) {
    await db.delete(partyIdentities).where(inArray(partyIdentities.partyId, ids));
    await db.delete(parties).where(inArray(parties.id, ids));
  }

  await db.delete(reps).where(eq(reps.demo, true));
  await db.delete(marketingSpend).where(eq(marketingSpend.demo, true));
}

/**
 * Summary of what a {@link resetVoiceDemo} run removed.
 *
 * Counts are captured BEFORE deletion, so they report exactly the demo-scoped
 * rows this run cleared. Running reset a second time finds nothing left and
 * returns all-zero counts — the observable proof that reset is idempotent
 * (running twice equals once; Req 11.7 / Property 10).
 */
export interface VoiceDemoResetSummary {
  reps: number;
  parties: number;
  identities: number;
  leads: number;
  viewingSlots: number;
  marketingSpend: number;
  /** Total demo-scoped rows removed across every voice-surface table. */
  total: number;
  /** Wall-clock duration of the reset (must stay ≤ 60s; Req 11.6 / NFR-6). */
  durationMs: number;
}

/**
 * Reset the voice demo to a clean slate by removing exactly the demo-scoped
 * (`demo = true`) voice-surface rows — and nothing else.
 *
 * Backs `POST /api/demo/reset` (task 18.2, `demoAdminRoutes`). The destructive
 * work is delegated to {@link clearVoiceDemo} so the demo seed and the reset
 * service share ONE definition of "the demo scope" (the same FK-safe deletion
 * over `demo = true` rows). `resetVoiceDemo` wraps that with measurement:
 *
 *   • It counts the demo-scoped rows in each table BEFORE clearing, so the
 *     caller (and the Demo Console) can report precisely what was removed.
 *   • It is idempotent (Req 11.7): a second run finds nothing flagged `demo`,
 *     so `clearVoiceDemo` is a no-op and every count comes back zero.
 *   • Non-demo rows are never touched — every delete is filtered on
 *     `demo = true` (Req 11.6), and only the voice-surface tables the seed
 *     writes are in scope.
 *
 * The demo dataset is small (low hundreds of rows), so the whole reset
 * completes well within the 60-second budget (Req 11.6 / NFR-6); `durationMs`
 * is returned so the bound can be observed in the Console / rehearsal.
 */
export async function resetVoiceDemo(
  db: Database
): Promise<VoiceDemoResetSummary> {
  const startedAt = Date.now();

  // Count the demo-scoped rows before removal. `leads_mirror` is keyed by
  // `party_id` (no surrogate `id`), so it is counted on that column.
  const demoParties = await db
    .select({ id: parties.id })
    .from(parties)
    .where(eq(parties.demo, true));
  const partyIds = demoParties.map((p) => p.id);

  const [repRows, leadRows, slotRows, spendRows] = await Promise.all([
    db.select({ id: reps.id }).from(reps).where(eq(reps.demo, true)),
    db
      .select({ partyId: leadsMirror.partyId })
      .from(leadsMirror)
      .where(eq(leadsMirror.demo, true)),
    db
      .select({ id: viewingSlots.id })
      .from(viewingSlots)
      .where(eq(viewingSlots.demo, true)),
    db
      .select({ id: marketingSpend.id })
      .from(marketingSpend)
      .where(eq(marketingSpend.demo, true)),
  ]);

  // Identities belong to demo parties (they carry no `demo` flag of their own;
  // they are removed via the cascade from `parties`). Count the ones attached
  // to the demo parties so the summary reflects what the cascade clears.
  const identityRows = partyIds.length
    ? await db
        .select({ id: partyIdentities.id })
        .from(partyIdentities)
        .where(inArray(partyIdentities.partyId, partyIds))
    : [];

  // Delegate the actual deletion to the shared demo-scope clearer.
  await clearVoiceDemo(db);

  const reps_ = repRows.length;
  const parties_ = partyIds.length;
  const identities_ = identityRows.length;
  const leads_ = leadRows.length;
  const viewingSlots_ = slotRows.length;
  const marketingSpend_ = spendRows.length;

  return {
    reps: reps_,
    parties: parties_,
    identities: identities_,
    leads: leads_,
    viewingSlots: viewingSlots_,
    marketingSpend: marketingSpend_,
    total:
      reps_ +
      parties_ +
      identities_ +
      leads_ +
      viewingSlots_ +
      marketingSpend_,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Seed the full voice demo dataset. Clears any prior demo-scoped rows first so
 * it is safe to run repeatedly (mirrors `seedDemo`'s idempotent contract).
 */
export async function seedVoiceDemo(db: Database): Promise<VoiceDemoSummary> {
  await clearVoiceDemo(db);

  const salt = demoSalt();

  // 1) Reps — insert and capture the generated UUIDs by stable key.
  const repSeeds = buildReps();
  const insertedReps = await db
    .insert(reps)
    .values(
      repSeeds.map((r) => ({
        name: r.name,
        languages: r.languages,
        projects: r.projects,
        capacity: r.capacity,
        openHotCount: r.openHotCount,
        phone: r.phone,
        demo: r.demo,
      }))
    )
    .returning({ id: reps.id, name: reps.name });
  const repIdByKey = new Map<string, string>();
  repSeeds.forEach((r, i) => repIdByKey.set(r.key, insertedReps[i].id));

  // 2) Parties + leads.
  const { parties: partySeeds, leads: leadSeeds } = buildPartiesAndLeads();
  const insertedParties = await db
    .insert(parties)
    .values(
      partySeeds.map((p) => ({
        type: "person" as const,
        name: p.name,
        language: p.language,
        consentAt: p.consent ? p.createdAt : null,
        createdAt: p.createdAt,
        demo: p.demo,
      }))
    )
    .returning({ id: parties.id });
  const partyIdByKey = new Map<string, string>();
  partySeeds.forEach((p, i) => partyIdByKey.set(p.key, insertedParties[i].id));

  // 3) Identities — salted phone_hash + email per party (NEVER the raw phone).
  const identityRows = partySeeds.flatMap((p) => {
    const partyId = partyIdByKey.get(p.key)!;
    const e164 = normalizePhoneToE164(p.phone);
    return [
      {
        partyId,
        kind: "phone_hash" as const,
        value: computePhoneHash(e164, salt),
        verifiedAt: p.createdAt,
      },
      {
        partyId,
        kind: "email" as const,
        value: p.email.toLowerCase(),
        verifiedAt: p.createdAt,
      },
    ];
  });
  await db.insert(partyIdentities).values(identityRows);

  // 4) Leads mirror.
  const knownWarmHash = computePhoneHash(
    normalizePhoneToE164(KNOWN_WARM_CALLER.phone),
    salt
  );
  await db.insert(leadsMirror).values(
    leadSeeds.map((l) => ({
      partyId: partyIdByKey.get(l.partyKey)!,
      tier: l.tier,
      stage: "qualified",
      source: l.source,
      campaign: l.campaign,
      projectInterest: l.projectInterest,
      unitInterest: l.unitInterest ?? undefined,
      budgetBand: l.budgetBand,
      assignedRepId: l.assignedRepKey ? repIdByKey.get(l.assignedRepKey)! : null,
      lastInteractionAt: l.lastInteractionAt,
      lastInteractionSummary: l.lastInteractionSummary,
      demo: l.demo,
    }))
  );

  // 5) Viewing slots.
  const slotSeeds = buildViewingSlots();
  await db.insert(viewingSlots).values(
    slotSeeds.map((s) => ({
      project: s.project,
      startsAt: s.startsAt,
      repId: repIdByKey.get(s.repKey)!,
      taken: s.taken,
      demo: s.demo,
    }))
  );

  // 6) Marketing spend (90-day spread).
  const spendSeeds = buildMarketingSpend();
  await db.insert(marketingSpend).values(
    spendSeeds.map((s) => ({
      date: s.date,
      channel: s.channel,
      campaignId: s.campaignId,
      spend: s.spend,
      impressions: s.impressions,
      clicks: s.clicks,
      currency: s.currency,
      demo: s.demo,
    }))
  );

  return {
    reps: repSeeds.length,
    parties: partySeeds.length,
    identities: identityRows.length,
    leads: leadSeeds.length,
    viewingSlots: slotSeeds.length,
    marketingSpend: spendSeeds.length,
    knownWarmCallerPhoneHash: knownWarmHash,
  };
}
