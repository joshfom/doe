/**
 * Lead Engine (S3) — lead-engine capabilities as unified Catalog_Entries
 * (Design §Components #4 "Resolution — dedupe + Salesforce lookup", #5
 * "Distribution_Agent — routing with rationale", #8 "Catalog binding and the
 * dispatcher boundary").
 *
 * These entries expose the mutations and the single gated personal-data read
 * the lead-engine agents (Parse / Distribution / Enrichment) need, as
 * `CatalogEntry` objects in the single canonical Tool_Catalog (`./catalog.ts`):
 *
 *   - `record_inbound_lead`  — resolve a parsed lead's identity via the reused
 *                              S2 `resolveLeadByMatchKeys`, then create-or-attach
 *                              the DOE Lead via `upsertLead`. A `conflict`
 *                              attaches nothing and records a `lead.conflict`
 *                              event; an `error` attaches nothing; otherwise the
 *                              Lead is created/attached and `lead.resolved` is
 *                              published (Req 5.2, 5.3, 5.4, 5.5).
 *   - `attach_inbound_lead`  — attach an inbound ledger row to an existing,
 *                              already-resolved Lead (Req 5.2).
 *   - `assign_lead_owner`    — select the owning rep with the reused `selectRep`
 *                              (project × language × capacity, deterministic
 *                              tie-break), persist `leads_mirror.assigned_rep_id`,
 *                              and record the routing rationale to the SSE bus —
 *                              `lead.routed` on success (owner id, matched
 *                              project, matched language, SQL-sourced capacity
 *                              figure) or `lead.unrouted` with the excluding rule
 *                              (Req 6.1, 6.2, 6.5, 6.6, 6.7, 7.1, 7.2).
 *   - `enrich_lead_read`     — the OTP/permission-gated personal-data read the
 *                              Enrichment_Agent uses; phones only ever leave as a
 *                              salted hash (Req 8.2, 8.5, 12.6, 13.x).
 *   - `flag_lead_conflict`   — record a conflict for human resolution (Req 5.4).
 *
 * The one rule, preserved: **every handler is the only place DB access happens**
 * — agents reason and plan, but never touch the database directly. Resolution
 * reuses the S2 dedupe/link helpers (`resolveLeadByMatchKeys`, `upsertLead`) and
 * routing reuses `selectRep`; the qualification/scoring capabilities are NOT
 * redefined here — they REFERENCE the existing `update_qualification` /
 * `score_lead` handlers from `registry.ts`, re-exposed under the lead-engine
 * RBAC identity so the Parse_Agent can bind them (Design §Architecture, agent
 * identities). Each entry still flows through `dispatchTool` (Zod → RBAC → OTP →
 * audit → execute) when invoked — the handlers here are the "execute" step only.
 *
 * Design references: §Components #4, #5, #8; §Architecture (agent identities and
 * RBAC). Requirements: 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5, 6.6, 6.7, 7.1, 7.2,
 * 8.2, 8.5, 12.1, 12.2, 12.6.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";

import { inboundLeads, leadsMirror, parties, partyIdentities, reps } from "../../schema";
import { publishEvent, type DoeEventType } from "../../realtime/events";
import {
  resolveLeadByMatchKeys,
  upsertLead,
  type MatchKey,
} from "../../tickets/crm/dedupe";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import {
  selectRep,
  toolRegistry,
  type RepRoutingRow,
} from "./registry";
import { type Language } from "../../voice/contracts";
import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";

// ── Lead-engine agent identities & permissions ───────────────────────────────

/**
 * The RBAC identities (and audit actors) the lead-engine agents dispatch under
 * (Design §Architecture, "Agent identities and RBAC"). Each is seeded as an
 * RBAC role granting exactly its catalog permissions (task 3.1); no agent holds
 * a wildcard.
 */
export const LEAD_PARSE_AGENT_ACTOR = "agent:lead-parse";
export const LEAD_DISTRIBUTION_AGENT_ACTOR = "agent:lead-distribution";
export const LEAD_ENRICHMENT_AGENT_ACTOR = "agent:lead-enrichment";

/** Prefix for per-tool RBAC permission strings, e.g. `lead:tool:assign_lead_owner`. */
export const LEAD_TOOL_PERMISSION_PREFIX = "lead:tool";

/** The RBAC permission string a given lead capability requires (Req 12.1, 12.2). */
export function leadToolPermission(name: string): string {
  return `${LEAD_TOOL_PERMISSION_PREFIX}:${name}`;
}

// ── Lead-lifecycle event types (cast until task 6.6) ─────────────────────────
//
// TODO(task 6.6): `lead.conflict`, `lead.resolved`, `lead.routed`, and
// `lead.unrouted` are added to the `DoeEventType` union in
// `lib/cms/realtime/events.ts` by task 6.6. `events.type` is plain `text`, so
// these are safe at runtime and need no migration; until 6.6 lands we cast at
// the publish sites rather than modifying events.ts from here.
const LEAD_CONFLICT_EVENT = "lead.conflict" as DoeEventType;
const LEAD_RESOLVED_EVENT = "lead.resolved" as DoeEventType;
const LEAD_ROUTED_EVENT = "lead.routed" as DoeEventType;
const LEAD_UNROUTED_EVENT = "lead.unrouted" as DoeEventType;

// ── entry() helper (mirrors text-capabilities.ts) ────────────────────────────

/**
 * Keep per-entry input/output typing intact (the handler is checked against the
 * entry's Zod schemas) while collecting heterogeneous entries into one
 * `CatalogEntry[]` for {@link loadCatalog}.
 */
function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

// ── Match-key helpers ────────────────────────────────────────────────────────

/**
 * Build the {@link MatchKey}s to link onto a resolved Party from the resolution
 * input. The phone is linked ONLY as its salted `phone_hash`, never raw
 * (CC-Privacy); the email is normalized (lower-cased + trimmed) the same way
 * `resolveLeadByMatchKeys` normalizes it so the linked identity matches what was
 * resolved. An un-normalizable phone is skipped here (resolution would already
 * have returned `error` for it before we reach the create/attach branch).
 */
function buildMatchKeys(input: {
  phone?: string;
  email?: string;
}): MatchKey[] {
  const keys: MatchKey[] = [];
  if (input.phone !== undefined) {
    try {
      keys.push({
        kind: "phone_hash",
        value: computePhoneHash(normalizePhoneToE164(input.phone)),
      });
    } catch {
      // Un-normalizable phone — skip; resolution short-circuits before here.
    }
  }
  if (input.email !== undefined) {
    keys.push({ kind: "email", value: input.email.trim().toLowerCase() });
  }
  return keys;
}

// ── record_inbound_lead ──────────────────────────────────────────────────────

const recordInboundLeadInput = z.object({
  /** The `inbound_leads.id` of the parsed lead being resolved. */
  inboundId: z.string(),
  /** Raw phone; hashed before any match/link (never persisted raw here). */
  phone: z.string().optional(),
  email: z.string().optional(),
  sfLeadId: z.string().optional(),
});
const recordInboundLeadOutput = z.object({
  resolution: z.enum(["match", "new", "conflict", "error"]),
  partyId: z.string().nullable(),
});

const recordInboundLeadEntry = entry({
  name: "record_inbound_lead",
  description:
    "Resolve an inbound lead's contact identity against the party graph and " +
    "create or attach the DOE Lead. On a conflict, attach nothing and record a " +
    "conflict for human resolution; on an error, attach nothing; otherwise " +
    "create (new) or attach (match) the Lead and publish lead.resolved.",
  inputSchema: recordInboundLeadInput,
  outputSchema: recordInboundLeadOutput,
  requiresOtp: false,
  permission: leadToolPermission("record_inbound_lead"),
  auditActor: LEAD_DISTRIBUTION_AGENT_ACTOR,
  // Reuses the S2 dedupe + link helpers (resolveLeadByMatchKeys / upsertLead) —
  // never re-implements identity resolution. The handler is the only DB access.
  handler: async (db, _ctx, input) => {
    const r = await resolveLeadByMatchKeys(db, {
      phone: input.phone,
      email: input.email,
      sfLeadId: input.sfLeadId,
    });

    // conflict → attach nothing, record a conflict indication (Req 5.4).
    if (r.kind === "conflict") {
      await publishEvent(db, {
        type: LEAD_CONFLICT_EVENT,
        payload: {
          inboundId: input.inboundId,
          candidatePartyIds: r.candidatePartyIds,
        },
      });
      return { resolution: "conflict" as const, partyId: null };
    }

    // error → create no Lead, attach nothing (Req 5.5). The intake workflow
    // queues + retains the lead; we surface no party here.
    if (r.kind === "error") {
      return { resolution: "error" as const, partyId: null };
    }

    // match → attach to the resolved Party; new → create a Party + mirror row
    // (Req 5.2, 5.3). Identities are linked idempotently by upsertLead.
    const up = await upsertLead(db, {
      partyId: r.kind === "match" ? r.partyId : undefined,
      identities: buildMatchKeys(input),
      sfLeadId: input.sfLeadId,
      mirror: {},
    });

    // Link the inbound ledger row to the resolved Party (schema: party_id is
    // "set after resolution").
    await db
      .update(inboundLeads)
      .set({ partyId: up.partyId, updatedAt: new Date() })
      .where(eq(inboundLeads.id, input.inboundId));

    await publishEvent(db, {
      type: LEAD_RESOLVED_EVENT,
      payload: {
        inboundId: input.inboundId,
        partyId: up.partyId,
        created: up.created,
      },
    });

    return { resolution: r.kind, partyId: up.partyId };
  },
});

// ── attach_inbound_lead ──────────────────────────────────────────────────────

const attachInboundLeadInput = z.object({
  /** The `inbound_leads.id` to attach. */
  inboundId: z.string(),
  /** The existing resolved Lead's Party id to attach the inbound row to. */
  partyId: z.string(),
});
const attachInboundLeadOutput = z.object({
  attached: z.literal(true),
  partyId: z.string(),
});

const attachInboundLeadEntry = entry({
  name: "attach_inbound_lead",
  description:
    "Attach an inbound lead ledger row to an existing, already-resolved DOE " +
    "Lead by its Party id, without creating a new Lead.",
  inputSchema: attachInboundLeadInput,
  outputSchema: attachInboundLeadOutput,
  requiresOtp: false,
  permission: leadToolPermission("attach_inbound_lead"),
  auditActor: LEAD_DISTRIBUTION_AGENT_ACTOR,
  handler: async (db, _ctx, input) => {
    await db
      .update(inboundLeads)
      .set({ partyId: input.partyId, updatedAt: new Date() })
      .where(eq(inboundLeads.id, input.inboundId));

    await publishEvent(db, {
      type: LEAD_RESOLVED_EVENT,
      payload: {
        inboundId: input.inboundId,
        partyId: input.partyId,
        attached: true,
      },
    });

    return { attached: true as const, partyId: input.partyId };
  },
});

// ── assign_lead_owner ────────────────────────────────────────────────────────

const assignLeadOwnerInput = z.object({
  /** The resolved Lead's Party id. */
  partyId: z.string(),
});
const assignLeadOwnerOutput = z.object({
  repId: z.string().nullable(),
  rationale: z.string(),
});

/**
 * Determine which rule (language, then project) excluded every candidate when
 * {@link selectRep} returns no eligible rep (Req 6.6). `selectRep` only returns
 * `null` when no rep matches the language (or, with a project of interest, no
 * language-matching rep also serves the project), so the excluding rule is
 * derivable from the same SQL-read rep rows.
 */
function exclusionReason(
  repRows: RepRoutingRow[],
  language: Language,
  projectInterest: string | undefined
): string {
  const languageMatches = repRows.filter((r) =>
    (r.languages ?? []).includes(language)
  );
  if (languageMatches.length === 0) {
    return `language: no rep speaks "${language}"`;
  }
  if (projectInterest != null) {
    const projectMatches = languageMatches.filter((r) =>
      (r.projects ?? []).includes(projectInterest)
    );
    if (projectMatches.length === 0) {
      return `project: no "${language}"-speaking rep serves "${projectInterest}"`;
    }
  }
  return "capacity: no eligible rep for project × language × capacity";
}

const assignLeadOwnerEntry = entry({
  name: "assign_lead_owner",
  description:
    "Select and persist the owning rep for a Lead by project × language × " +
    "capacity (deterministic tie-break), record the routing rationale, and " +
    "publish lead.routed (owner, matched project/language, SQL capacity) or " +
    "lead.unrouted (excluding rule) to the event bus.",
  inputSchema: assignLeadOwnerInput,
  outputSchema: assignLeadOwnerOutput,
  requiresOtp: false,
  permission: leadToolPermission("assign_lead_owner"),
  auditActor: LEAD_DISTRIBUTION_AGENT_ACTOR,
  // Reuses selectRep (project × language × capacity, deterministic tie-break);
  // the rep-capacity figure is read from SQL (the reps rows) — never computed in
  // the model (Req 6.7). The handler is the only DB access.
  handler: async (db, _ctx, { partyId }) => {
    // Routing profile: language from the Party, project interest from the mirror.
    const [profile] = await db
      .select({
        language: parties.language,
        projectInterest: leadsMirror.projectInterest,
      })
      .from(parties)
      .leftJoin(leadsMirror, eq(leadsMirror.partyId, parties.id))
      .where(eq(parties.id, partyId))
      .limit(1);

    const language: Language = profile?.language === "ar" ? "ar" : "en";
    const projectInterest = profile?.projectInterest ?? undefined;

    // Capacity figures come from SQL (the reps table), never the model (Req 6.7).
    const repRows: RepRoutingRow[] = await db
      .select({
        id: reps.id,
        name: reps.name,
        languages: reps.languages,
        projects: reps.projects,
        capacity: reps.capacity,
        openHotCount: reps.openHotCount,
      })
      .from(reps);

    const selection = selectRep(repRows, { language, projectInterest });

    // No eligible rep → assign no owner, record which rule excluded all (Req 6.6).
    if (!selection) {
      const reason = exclusionReason(repRows, language, projectInterest);
      await publishEvent(db, {
        type: LEAD_UNROUTED_EVENT,
        payload: {
          partyId,
          reason,
          matchedLanguage: language,
          matchedProject: projectInterest ?? null,
        },
      });
      return { repId: null, rationale: reason };
    }

    // Persist the owner — single column, so a reassignment replaces the owner
    // and the upsert by the party_id PK converges concurrent attempts to exactly
    // one owner (Req 7.1, 7.2). One audit row is written by the dispatcher.
    await db
      .insert(leadsMirror)
      .values({ partyId, assignedRepId: selection.rep.id })
      .onConflictDoUpdate({
        target: leadsMirror.partyId,
        set: { assignedRepId: selection.rep.id, updatedAt: new Date() },
      });

    // Routing rationale to the SSE bus: owner id, matched project, matched
    // language, and the SQL-sourced capacity figure used in the decision (Req
    // 6.5, 6.7).
    await publishEvent(db, {
      type: LEAD_ROUTED_EVENT,
      payload: {
        partyId,
        repId: selection.rep.id,
        matchedProject: projectInterest ?? null,
        matchedLanguage: language,
        capacity: `${selection.rep.openHotCount}/${selection.rep.capacity}`,
        rationale: selection.routing,
      },
    });

    return { repId: selection.rep.id, rationale: selection.routing };
  },
});

// ── enrich_lead_read (OTP-gated personal-data read) ──────────────────────────

const enrichLeadReadInput = z.object({
  /** The Lead's Party id whose profile is being read for enrichment. */
  partyId: z.string(),
});
const enrichLeadReadOutput = z.object({
  partyId: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  tier: z.string().nullable(),
  projectInterest: z.string().nullable(),
  unitInterest: z.string().nullable(),
  budgetBand: z.string().nullable(),
  lastInteractionAt: z.string().nullable(),
  lastInteractionSummary: z.string().nullable(),
  /** Phone is returned only as a salted hash, never raw (Req 8.5, 13.x). */
  phoneHash: z.string().nullable(),
});

const enrichLeadReadEntry = entry({
  name: "enrich_lead_read",
  description:
    "Read a Lead's personal profile (name, language, tier, interests, last " +
    "interaction) for enrichment. Gated personal-data read: the caller must be " +
    "OTP-verified and permitted. Phone is returned only as a salted hash.",
  inputSchema: enrichLeadReadInput,
  outputSchema: enrichLeadReadOutput,
  requiresOtp: true, // gated personal-data read (Req 8.2, 12.6)
  permission: leadToolPermission("enrich_lead_read"),
  auditActor: LEAD_ENRICHMENT_AGENT_ACTOR,
  // The only DB access for the Enrichment_Agent's personal-data read. Phones
  // never leave as a raw number — only the salted phone_hash identity is read.
  handler: async (db, _ctx, { partyId }) => {
    const [profile] = await db
      .select({
        name: parties.name,
        language: parties.language,
        tier: leadsMirror.tier,
        projectInterest: leadsMirror.projectInterest,
        unitInterest: leadsMirror.unitInterest,
        budgetBand: leadsMirror.budgetBand,
        lastInteractionAt: leadsMirror.lastInteractionAt,
        lastInteractionSummary: leadsMirror.lastInteractionSummary,
      })
      .from(parties)
      .leftJoin(leadsMirror, eq(leadsMirror.partyId, parties.id))
      .where(eq(parties.id, partyId))
      .limit(1);

    // Resolve the phone_hash identity (kind === "phone_hash"), never the raw
    // number, to keep the privacy guarantee (Req 8.5, 13.x).
    const phoneRows = await db
      .select({ kind: partyIdentities.kind, value: partyIdentities.value })
      .from(partyIdentities)
      .where(eq(partyIdentities.partyId, partyId));
    const phoneHash =
      phoneRows.find((row) => row.kind === "phone_hash")?.value ?? null;

    const lastInteractionAt =
      profile?.lastInteractionAt instanceof Date
        ? profile.lastInteractionAt.toISOString()
        : (profile?.lastInteractionAt ?? null);

    return {
      partyId,
      name: profile?.name ?? null,
      language: profile?.language ?? null,
      tier: profile?.tier ?? null,
      projectInterest: profile?.projectInterest ?? null,
      unitInterest: profile?.unitInterest ?? null,
      budgetBand: profile?.budgetBand ?? null,
      lastInteractionAt,
      lastInteractionSummary: profile?.lastInteractionSummary ?? null,
      phoneHash,
    };
  },
});

// ── flag_lead_conflict ───────────────────────────────────────────────────────

const flagLeadConflictInput = z.object({
  /** The `inbound_leads.id` whose resolution conflicted. */
  inboundId: z.string(),
  /** The candidate Party ids that distinct match keys resolved to. */
  candidatePartyIds: z.array(z.string()).optional(),
  /** A human-readable reason for the conflict. */
  reason: z.string().optional(),
});
const flagLeadConflictOutput = z.object({
  flagged: z.literal(true),
});

const flagLeadConflictEntry = entry({
  name: "flag_lead_conflict",
  description:
    "Record a dedupe conflict on an inbound lead for human resolution: stamp " +
    "the ledger row's last error and publish a lead.conflict event. Attaches " +
    "the inbound lead to no Lead.",
  inputSchema: flagLeadConflictInput,
  outputSchema: flagLeadConflictOutput,
  requiresOtp: false,
  permission: leadToolPermission("flag_lead_conflict"),
  auditActor: LEAD_DISTRIBUTION_AGENT_ACTOR,
  handler: async (db, _ctx, input) => {
    const reason =
      input.reason?.trim() ||
      `Dedupe conflict — ${input.candidatePartyIds?.length ?? 0} candidate parties`;

    // Record the conflict indication on the ledger row (lastError is not the
    // status column — the intake state machine owns status writes).
    await db
      .update(inboundLeads)
      .set({ lastError: reason, updatedAt: new Date() })
      .where(eq(inboundLeads.id, input.inboundId));

    await publishEvent(db, {
      type: LEAD_CONFLICT_EVENT,
      payload: {
        inboundId: input.inboundId,
        candidatePartyIds: input.candidatePartyIds ?? [],
        reason,
      },
    });

    return { flagged: true as const };
  },
});

// ── Reused qualification/scoring capabilities (REFERENCED, not redefined) ─────
//
// The Parse_Agent records qualification facts via `update_qualification` and
// tiers via `score_lead` (Design §Architecture: agent:lead-parse may call
// `lead:tool:update_qualification`, `lead:tool:score_lead`). We do NOT
// re-implement those handlers — we REFERENCE the existing ones from
// `registry.ts` (the same function objects the voice surface uses), re-exposing
// them as catalog entries under the lead-parse RBAC identity and permission so
// the lead-parse agent can bind them through the audited dispatcher.

const updateQualificationEntry = entry({
  name: "update_qualification",
  description:
    "Persist partial qualification facts (budget band, unit type) onto the " +
    "Lead's mirror as they emerge during parsing. Upserts by party id; a " +
    "partial update never clobbers a previously-captured fact.",
  inputSchema: toolRegistry.update_qualification.inputSchema,
  outputSchema: toolRegistry.update_qualification.outputSchema,
  requiresOtp: toolRegistry.update_qualification.requiresOtp,
  permission: leadToolPermission("update_qualification"),
  auditActor: LEAD_PARSE_AGENT_ACTOR,
  // Reference the existing registry handler — no logic redefined here.
  handler: toolRegistry.update_qualification.handler,
});

const scoreLeadEntry = entry({
  name: "score_lead",
  description:
    "Score a Lead's tier (HOT/WARM/NURTURE) from the qualification signals on " +
    "its mirror via deterministic thresholds, with an LLM-written rationale " +
    "stored for the Console only.",
  inputSchema: toolRegistry.score_lead.inputSchema,
  outputSchema: toolRegistry.score_lead.outputSchema,
  requiresOtp: toolRegistry.score_lead.requiresOtp,
  permission: leadToolPermission("score_lead"),
  auditActor: LEAD_PARSE_AGENT_ACTOR,
  // Reference the existing registry handler — no logic redefined here.
  handler: toolRegistry.score_lead.handler,
});

// ── The lead-engine catalog contributor set ──────────────────────────────────

/**
 * The lead-engine Catalog_Entries contributed to the single canonical
 * Tool_Catalog (Design §Components #8). Consumed by {@link loadLeadCapabilities}
 * and, in later tasks, bound to the lead-engine Mastra agents via `bindCatalog`
 * (one Mastra tool per name, each dispatching through `dispatchTool`).
 *
 * Ordering groups the five new entries first, then the two referenced
 * qualification/scoring capabilities the Parse_Agent reuses.
 */
export const leadCapabilityEntries: CatalogEntry[] = [
  recordInboundLeadEntry,
  attachInboundLeadEntry,
  assignLeadOwnerEntry,
  enrichLeadReadEntry,
  flagLeadConflictEntry,
  updateQualificationEntry,
  scoreLeadEntry,
];

/** The names of the lead-engine capabilities exposed by this module. */
export const LEAD_CAPABILITY_NAMES = leadCapabilityEntries.map((e) => e.name);

/**
 * Validate and assemble just the lead-engine capabilities through
 * {@link loadCatalog}. Surfaces `incomplete_entry`/`duplicate_name` errors the
 * same way the full catalog load does, so this module can be self-checked in
 * isolation and the lead-engine agents can fail fast rather than bind a partial
 * tool set.
 */
export function loadLeadCapabilities(): CatalogLoadResult {
  return loadCatalog(leadCapabilityEntries);
}
