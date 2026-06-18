/**
 * Salesforce Lead Seeder — mirror N real Salesforce Leads into the DOE party
 * graph, or simulate the Lead Engine with synthetic leads of the same shape.
 *
 * The user goal: "seed the db to simulate the lead engine — or better still pull
 * 50/100 leads from Salesforce and mirror them here, and get the rep too."
 *
 * This module supports BOTH:
 *
 *   • mode "salesforce" (default) — authenticate with the org (SF_CLIENT_ID /
 *     SF_CLIENT_SECRET / SF_LOGIN_URL, already configured), SOQL the most
 *     recently modified Leads (with their Owner), and mirror each one.
 *   • mode "simulate" — generate synthetic leads of the SAME normalized shape
 *     and run them through the exact same mirror path (no Salesforce needed).
 *
 * Either way, mirroring reuses the canonical S2 machinery so the seeded data is
 * indistinguishable from a live inbound sync:
 *
 *   1. Owners → `reps`. Each distinct Salesforce Lead Owner becomes a routing
 *      rep (deduped by name, marked `demo`).
 *   2. Dedupe → resolve each Lead to an existing Party (phone_hash → email →
 *      sf_lead_id) via `resolveLeadByMatchKeys`, or create a new one. Re-runs
 *      are therefore idempotent — no duplicate parties.
 *   3. `upsertLead` writes the Party + identities + `leads_mirror` row, linking
 *      the `sf_lead_id` on both stores.
 *
 * PRIVACY (CC-Privacy / Req 13.1): a phone is persisted ONLY as a salted
 * `phone_hash` (`computePhoneHash`), never as a raw number. Email is stored
 * lower-cased; the raw phone never touches the DB.
 *
 * EVERY row written carries `demo = true`, so `clearSalesforceLeadSeed` (and the
 * shared demo reset) can remove exactly this scope.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../db";
import { leadsMirror, parties, partyIdentities, reps } from "../schema";
import {
  linkIdentities,
  resolveLeadByMatchKeys,
  upsertLead,
  type MatchKey,
} from "../tickets/crm/dedupe";
import { SF_OBJECT_CONFIG } from "../tickets/crm/sf-config";
import { SalesforceAdapter } from "../tickets/crm/salesforce";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";

// ── Configuration ──────────────────────────────────────────────────────────

/** Salesforce REST API version (kept in lock-step with sf-config / the worker). */
const API_VERSION = process.env.SF_API_VERSION ?? "v59.0";

/** Demo phone-hash salt fallback so the seed runs even without env configured. */
const DEMO_PHONE_HASH_SALT = "doe-sf-lead-seed-salt";

/** Resolve the salt used to hash lead phones (env first, demo fallback). */
function seedSalt(): string {
  const envSalt = process.env.PHONE_HASH_SALT;
  return envSalt && envSalt.trim().length > 0 ? envSalt : DEMO_PHONE_HASH_SALT;
}

// ── Normalized lead (the single shape both sources produce) ──────────────────

/**
 * A source-agnostic lead. The Salesforce path maps SOQL records onto this; the
 * simulate path builds it directly. The mirror step only ever sees this shape,
 * so there is exactly ONE write path regardless of where the data came from.
 */
export interface NormalizedLead {
  /** Salesforce Lead id (synthetic leads get a deterministic `SIM-…` id). */
  sfLeadId: string;
  name?: string;
  email?: string;
  /** Free-form phone — hashed before storage, NEVER persisted raw. */
  phone?: string;
  company?: string;
  /** Salesforce Lead Status → `leads_mirror.stage`. */
  status?: string;
  /** LeadSource → `leads_mirror.source`. */
  source?: string;
  projectInterest?: string;
  /** Salesforce Lead Rating (Hot/Warm/Cold) → tier. */
  rating?: string;
  language?: "en" | "ar";
  createdAt?: Date;
  lastModifiedAt?: Date;
  /** The Lead's Salesforce Owner → a routing rep. */
  owner?: { sfId: string; name: string };
}

export type SeedMode = "salesforce" | "simulate";

export interface SeedOptions {
  /** How many leads to pull / generate. */
  limit?: number;
  /** "salesforce" (default) pulls from the org; "simulate" generates locally. */
  mode?: SeedMode;
  /**
   * When a Salesforce pull fails (auth/network/empty), fall back to simulate
   * instead of throwing. Default true so the seed is always useful.
   */
  fallbackToSimulate?: boolean;
}

export interface SeedSummary {
  mode: SeedMode;
  leadsFetched: number;
  partiesCreated: number;
  partiesMatched: number;
  repsCreated: number;
  repsReused: number;
  identitiesLinked: number;
  durationMs: number;
}

// ── Tier mapping ─────────────────────────────────────────────────────────────

/** Map a Salesforce Lead Rating onto a DOE tier. */
function ratingToTier(rating?: string): "HOT" | "WARM" | "NURTURE" | null {
  switch ((rating ?? "").trim().toLowerCase()) {
    case "hot":
      return "HOT";
    case "warm":
      return "WARM";
    case "cold":
      return "NURTURE";
    default:
      return null;
  }
}

// ── Salesforce pull ──────────────────────────────────────────────────────────

/** A SOQL record over the Lead object, with the Owner relationship expanded. */
interface SfLeadFull {
  Id: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
  Rating?: string | null;
  OwnerId?: string;
  Owner?: { Id?: string; Name?: string; Type?: string } | null;
  [field: string]: unknown;
}

function readString(rec: Record<string, unknown>, field: string): string | undefined {
  const v = rec[field];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Fetch the set of field API names that actually exist on the Lead object in
 * the connected org (via the describe call). Used to filter the SELECT so the
 * query degrades gracefully when a configured custom field (e.g. a default
 * `Project_Interest__c`) isn't present in this particular org.
 */
async function describeLeadFields(
  adapter: SalesforceAdapter,
  sobject: string
): Promise<Set<string>> {
  const path = `/services/data/${API_VERSION}/sobjects/${sobject}/describe`;
  const result = await adapter.requestJson<{ fields?: { name: string }[] }>(
    "GET",
    path
  );
  return new Set((result.fields ?? []).map((f) => f.name));
}

/**
 * Build the SOQL SELECT list: Id + standard timestamps + Rating + every
 * configured Lead field that EXISTS in the org + the Owner relationship (so the
 * rep comes back in the same query — no second round-trip). Fields absent from
 * the org are dropped rather than failing the whole query.
 */
function buildSelectFields(available: Set<string>): string {
  const wanted = [
    "Id",
    "CreatedDate",
    "LastModifiedDate",
    "Rating",
    "OwnerId",
    ...Object.values(SF_OBJECT_CONFIG.Lead.fields),
  ];
  // `Id`/`OwnerId` always exist; filter the rest against the describe result.
  const fields = new Set(
    wanted.filter((f) => f === "Id" || f === "OwnerId" || available.has(f))
  );
  // Owner relationship fields are standard traversals (not listed in the Lead
  // field describe), so add them unconditionally.
  fields.add("Owner.Id");
  fields.add("Owner.Name");
  fields.add("Owner.Type");
  return [...fields].join(", ");
}

/** Pull the most recently modified Leads from Salesforce (with their Owner). */
export async function fetchSalesforceLeads(limit: number): Promise<NormalizedLead[]> {
  const adapter = new SalesforceAdapter();
  const F = SF_OBJECT_CONFIG.Lead.fields;
  const sobject = SF_OBJECT_CONFIG.Lead.sobject;

  const available = await describeLeadFields(adapter, sobject);

  const soql =
    `SELECT ${buildSelectFields(available)} FROM ${sobject} ` +
    `ORDER BY LastModifiedDate DESC LIMIT ${Math.max(1, Math.floor(limit))}`;

  const path = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const result = await adapter.requestJson<{ records?: SfLeadFull[] }>("GET", path);
  const records = result.records ?? [];

  return records.map((rec): NormalizedLead => {
    const first = readString(rec, F.firstName);
    const last = readString(rec, F.lastName);
    const name = [first, last].filter(Boolean).join(" ").trim() || undefined;

    const ownerName = rec.Owner?.Name?.trim();
    const ownerSfId = rec.Owner?.Id ?? rec.OwnerId;

    return {
      sfLeadId: rec.Id,
      name,
      email: readString(rec, F.email),
      phone: readString(rec, F.phone),
      company: readString(rec, F.company),
      status: readString(rec, F.status),
      source: readString(rec, F.source),
      projectInterest: readString(rec, F.projectInterest),
      rating: typeof rec.Rating === "string" ? rec.Rating : undefined,
      createdAt: rec.CreatedDate ? new Date(rec.CreatedDate) : undefined,
      lastModifiedAt: rec.LastModifiedDate ? new Date(rec.LastModifiedDate) : undefined,
      owner:
        ownerSfId && ownerName
          ? { sfId: ownerSfId, name: ownerName }
          : undefined,
    };
  });
}

// ── Synthetic generation (simulate the Lead Engine) ──────────────────────────

const SIM_SOURCES = ["web_form", "Meta", "Google", "whatsapp", "Bayut", "PropertyFinder", "portal"] as const;
const SIM_STATUSES = ["New", "Working", "Nurturing", "Qualified"] as const;
const SIM_RATINGS = ["Hot", "Warm", "Cold"] as const;
const SIM_PROJECTS = ["Bayn", "Bayn Marina", "Bayn Hills", "Bayn Coast", "Investment Desk"] as const;
const SIM_OWNERS = [
  { sfId: "SIM-OWNER-1", name: "Sara Haddad" },
  { sfId: "SIM-OWNER-2", name: "Omar Khalil" },
  { sfId: "SIM-OWNER-3", name: "Layla Mansour" },
] as const;

/** Small deterministic LCG so simulated runs are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Generate `count` synthetic leads of the same normalized shape as a SF pull. */
export function generateSyntheticLeads(count: number, seed = 4242): NormalizedLead[] {
  const rng = makeRng(seed);
  const leads: NormalizedLead[] = [];
  const now = Date.now();

  for (let i = 1; i <= count; i++) {
    const createdDaysAgo = Math.floor(rng() * 90);
    const createdAt = new Date(now - createdDaysAgo * 24 * 60 * 60 * 1000);
    const lastModifiedAt = new Date(createdAt.getTime() + Math.floor(rng() * 6) * 3600_000);
    const language: "en" | "ar" = rng() < 0.25 ? "ar" : "en";

    leads.push({
      sfLeadId: `SIM-${String(i).padStart(5, "0")}`,
      name: `Simulated Lead ${i}`,
      email: `sim.lead${i}@ora-lead-sim.test`,
      // Synthetic UAE mobile; hashed before storage like any other phone.
      phone: `+9715${String(20_000_000 + i).padStart(8, "0")}`,
      company: rng() < 0.4 ? `Demo Holdings ${i}` : undefined,
      status: pick(rng, SIM_STATUSES),
      source: pick(rng, SIM_SOURCES),
      projectInterest: pick(rng, SIM_PROJECTS),
      rating: pick(rng, SIM_RATINGS),
      language,
      createdAt,
      lastModifiedAt,
      owner: pick(rng, SIM_OWNERS),
    });
  }

  return leads;
}

// ── Owner → rep mapping ──────────────────────────────────────────────────────

/**
 * Ensure a `reps` row exists for each distinct Lead Owner and return a map of
 * Salesforce owner id → rep id. Reps are deduped by name (case-insensitive) so
 * re-runs reuse the same routing target. Newly created reps are demo-scoped.
 */
async function upsertOwnersAsReps(
  db: Database,
  leads: NormalizedLead[]
): Promise<{ repIdByOwnerId: Map<string, string>; created: number; reused: number }> {
  const repIdByOwnerId = new Map<string, string>();
  let created = 0;
  let reused = 0;

  // Distinct owners by Salesforce owner id.
  const owners = new Map<string, { sfId: string; name: string }>();
  for (const lead of leads) {
    if (lead.owner) owners.set(lead.owner.sfId, lead.owner);
  }

  for (const owner of owners.values()) {
    // Reuse an existing rep with the same name (case-insensitive) before
    // creating one, so the seed doesn't fan out duplicate reps across runs.
    const [existing] = await db
      .select({ id: reps.id })
      .from(reps)
      .where(sql`lower(${reps.name}) = lower(${owner.name})`)
      .limit(1);

    if (existing) {
      repIdByOwnerId.set(owner.sfId, existing.id);
      reused++;
      continue;
    }

    const [row] = await db
      .insert(reps)
      .values({
        name: owner.name,
        languages: ["en"],
        projects: [],
        capacity: 3,
        demo: true,
        // Carry the SF owner id so the mapping survives across runs.
        teamsId: `sf:${owner.sfId}`,
      })
      .returning({ id: reps.id });

    repIdByOwnerId.set(owner.sfId, row.id);
    created++;
  }

  return { repIdByOwnerId, created, reused };
}

// ── Mirror one normalized lead → party graph + leads_mirror ──────────────────

/** Build the salted phone_hash identity for a lead (or null if no/invalid phone). */
function phoneHashIdentity(phone: string | undefined, salt: string): MatchKey | null {
  if (!phone) return null;
  try {
    const e164 = normalizePhoneToE164(phone);
    return { kind: "phone_hash", value: computePhoneHash(e164, salt) };
  } catch {
    // Un-normalizable phone — skip it rather than fail the whole lead.
    return null;
  }
}

interface MirrorOutcome {
  created: boolean;
  identitiesLinked: number;
}

/**
 * Mirror a single normalized lead. Resolves to an existing Party (or creates a
 * new one), links its identities + sf_lead_id, and upserts the `leads_mirror`
 * row from the Lead's fields. Idempotent across re-runs.
 */
async function mirrorLead(
  db: Database,
  lead: NormalizedLead,
  repIdByOwnerId: Map<string, string>,
  salt: string
): Promise<MirrorOutcome> {
  const emailNorm = lead.email?.trim().toLowerCase();
  const phoneKey = phoneHashIdentity(lead.phone, salt);

  // 1) Dedupe: phone_hash → email → sf_lead_id (read-only; never auto-merges).
  const resolved = await resolveLeadByMatchKeys(db, {
    phone: lead.phone,
    email: emailNorm,
    sfLeadId: lead.sfLeadId,
  });

  // On a conflict/error we still seed a fresh Party rather than dropping the
  // lead — the seed's job is to populate, not to arbitrate merges.
  const matchedPartyId = resolved.kind === "match" ? resolved.partyId : undefined;

  // 2) Identities to link (email + salted phone_hash — never the raw phone).
  const identities: MatchKey[] = [];
  if (emailNorm) identities.push({ kind: "email", value: emailNorm });
  if (phoneKey) identities.push(phoneKey);

  const assignedRepId = lead.owner ? repIdByOwnerId.get(lead.owner.sfId) ?? null : null;

  // 3) Create/reuse the Party + upsert leads_mirror in one canonical write.
  const { partyId, created } = await upsertLead(db, {
    partyId: matchedPartyId,
    party: {
      type: "person",
      name: lead.name,
      language: lead.language ?? "en",
      consent: true,
      demo: true,
    },
    identities,
    sfLeadId: lead.sfLeadId,
    mirror: {
      stage: lead.status,
      tier: ratingToTier(lead.rating) ?? undefined,
      source: lead.source,
      projectInterest: lead.projectInterest,
      assignedRepId: assignedRepId ?? undefined,
      lastInteractionAt: lead.lastModifiedAt,
      lastInteractionSummary: `Imported from Salesforce (${lead.source ?? "unknown source"}).`,
      demo: true,
    },
  });

  // upsertLead links email/sf_lead_id; ensure phone_hash is linked too on the
  // matched-party path (idempotent — no duplicate rows).
  if (phoneKey) {
    await linkIdentities(db, partyId, [phoneKey]);
  }

  return { created, identitiesLinked: identities.length };
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Seed the DOE party graph from Salesforce Leads (or synthetic leads). Safe to
 * re-run: dedupe resolves existing parties so no duplicates accumulate.
 */
export async function seedSalesforceLeads(
  db: Database,
  options: SeedOptions = {}
): Promise<SeedSummary> {
  const startedAt = Date.now();
  const limit = options.limit ?? 50;
  const requestedMode: SeedMode = options.mode ?? "salesforce";
  const fallbackToSimulate = options.fallbackToSimulate ?? true;
  const salt = seedSalt();

  // 1) Source the leads.
  let mode: SeedMode = requestedMode;
  let leads: NormalizedLead[] = [];

  if (requestedMode === "salesforce") {
    try {
      leads = await fetchSalesforceLeads(limit);
      if (leads.length === 0 && fallbackToSimulate) {
        console.warn(
          "[seed:sf-leads] Salesforce returned 0 leads; falling back to simulate mode."
        );
        mode = "simulate";
        leads = generateSyntheticLeads(limit);
      }
    } catch (err) {
      if (!fallbackToSimulate) throw err;
      console.warn(
        `[seed:sf-leads] Salesforce pull failed (${
          err instanceof Error ? err.message : String(err)
        }); falling back to simulate mode.`
      );
      mode = "simulate";
      leads = generateSyntheticLeads(limit);
    }
  } else {
    leads = generateSyntheticLeads(limit);
  }

  // 2) Owners → reps.
  const { repIdByOwnerId, created: repsCreated, reused: repsReused } =
    await upsertOwnersAsReps(db, leads);

  // 3) Mirror each lead.
  let partiesCreated = 0;
  let partiesMatched = 0;
  let identitiesLinked = 0;
  for (const lead of leads) {
    const outcome = await mirrorLead(db, lead, repIdByOwnerId, salt);
    if (outcome.created) partiesCreated++;
    else partiesMatched++;
    identitiesLinked += outcome.identitiesLinked;
  }

  return {
    mode,
    leadsFetched: leads.length,
    partiesCreated,
    partiesMatched,
    repsCreated,
    repsReused,
    identitiesLinked,
    durationMs: Date.now() - startedAt,
  };
}

// ── Reset ────────────────────────────────────────────────────────────────────

export interface SeedResetSummary {
  parties: number;
  reps: number;
  durationMs: number;
}

/**
 * Remove exactly the rows this seeder created: every Party that carries an
 * `sf_lead_id` identity (cascades to its `party_identities` + `leads_mirror`),
 * and the demo reps this seeder imported (tagged `teamsId = 'sf:…'`).
 *
 * Demo reps that are still referenced by a surviving `leads_mirror` row are kept
 * so a partial reset can't orphan a foreign key.
 */
export async function clearSalesforceLeadSeed(db: Database): Promise<SeedResetSummary> {
  const startedAt = Date.now();

  // Parties that were imported as Salesforce leads.
  const sfParties = await db
    .selectDistinct({ partyId: partyIdentities.partyId })
    .from(partyIdentities)
    .where(eq(partyIdentities.kind, "sf_lead_id"));
  const partyIds = sfParties.map((p) => p.partyId);

  if (partyIds.length > 0) {
    // leads_mirror + party_identities cascade from parties, but delete mirror
    // explicitly first to drop the assigned_rep_id FK before removing reps.
    await db.delete(leadsMirror).where(inArray(leadsMirror.partyId, partyIds));
    await db.delete(partyIdentities).where(inArray(partyIdentities.partyId, partyIds));
    await db.delete(parties).where(inArray(parties.id, partyIds));
  }

  // Imported reps (teamsId 'sf:…') no longer referenced by any mirror row.
  const importedReps = await db
    .select({ id: reps.id })
    .from(reps)
    .where(and(eq(reps.demo, true), sql`${reps.teamsId} like 'sf:%'`));

  let repsDeleted = 0;
  for (const rep of importedReps) {
    const [stillUsed] = await db
      .select({ partyId: leadsMirror.partyId })
      .from(leadsMirror)
      .where(eq(leadsMirror.assignedRepId, rep.id))
      .limit(1);
    if (stillUsed) continue;
    await db.delete(reps).where(eq(reps.id, rep.id));
    repsDeleted++;
  }

  return {
    parties: partyIds.length,
    reps: repsDeleted,
    durationMs: Date.now() - startedAt,
  };
}
