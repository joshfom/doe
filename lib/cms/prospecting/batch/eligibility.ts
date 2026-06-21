/**
 * Agentic Prospecting Batch — candidate eligibility pipeline
 * (Design §Components #3 "Candidate eligibility pipeline"; Requirements 6.1,
 * 6.2, 6.3, 6.5, 10.2, 11.3, 11.4, 11.5).
 *
 * `evaluateCandidate(db, run, candidate)` is the single decision point that
 * classifies a discovered candidate (`ProviderResult`) as `cold_eligible`,
 * `warm_path`, or `skip`. It runs a FIXED sequence of gates and returns the
 * first decisive outcome. The order is chosen so the cheapest, most-decisive
 * COMPLIANCE gates run first and the EXTERNAL CRM call runs late:
 *
 *   1. **Opt-out** (`isOptedOut`, local) → skip `opted_out` (Req 6.1).
 *   2. **Lawful-basis present?** (the candidate's provider record carries a
 *      non-empty `lawfulBasis`) → skip `missing_lawful_basis` (Req 10.2).
 *   3. **Cross-rep claim** (`claimTarget`, local, reuses the party-identity
 *      space) → skip `claimed_by_other_rep` when a DIFFERENT rep already holds
 *      the candidate's identity (Req 6.2).
 *   4. **CRM_Check** (`checkCrmForContact`, external Salesforce existence
 *      pre-check). The result is interpreted by its degradation semantics:
 *        - `configured && found` → `warm_path` via `crm` (Req 2.3, 6.3).
 *        - `configured && !found` (the check actually RAN) → continue (cold).
 *        - `configured:false` (SF unconfigured) → CRM-unverified; do NOT
 *          warm-route on the unrun check (Req 11.3), but a LOCAL party /
 *          `leads_mirror` match still warm-routes via `local_party` (Req 11.5).
 *        - `configured:true` with a `note` (transient error / no email) →
 *          treat as transient: CRM-unverified for this pass, NOT unconfigured
 *          (Req 11.4); the same local fallback applies.
 *   5. **Send-cap budget** (`capExhausted`, local counters) → skip
 *      `cap_reached` when the rep or cluster scope is exhausted for the period
 *      (Req 7.3).
 *
 * A candidate that passes 1–5 without a `warm_path`/`skip` is **cold-eligible**
 * (Req 6.5): not in Salesforce, not opted out, not claimed by another rep, and
 * carrying a lawful basis.
 *
 * Every external read goes through an existing helper — `isOptedOut`
 * (`../optout.ts`), `checkCrmForContact` (`../crm-check.ts`),
 * `resolveLeadByMatchKeys` (`../../tickets/crm/dedupe.ts`), `claimTarget`
 * (`./claim.ts`), and `capExhausted` (`./send-cap.ts`). This function never
 * touches the DB or a provider directly for a prospecting effect (CC-Audit,
 * CC-Reuse); it only composes those audited / dedicated seams.
 */

import type { Database } from "../../db";
import { checkCrmForContact } from "../crm-check";
import { isOptedOut, type OptoutKeys } from "../optout";
import type { ProviderResult } from "../providers";
import { resolveLeadByMatchKeys } from "../../tickets/crm/dedupe";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import { claimTarget, releaseClaim, type ClaimIdentity } from "./claim";
import { capExhausted } from "./send-cap";

// ── The run context the gates read ─────────────────────────────────────────────

/**
 * The Batch_Run fields the eligibility gates need. This is a structural subset
 * of the persisted `prospecting_batch_runs` row (see `ProspectingBatchRun` in
 * `lib/cms/schema.ts`) augmented with the runtime cap context the orchestrator
 * resolves before the loop:
 *
 *   - `ownerRep` — the owning rep; the cross-rep claim's owner (Req 6.2) and the
 *     `rep` send-cap scope's `scope_id`.
 *   - `clusterId` — the targeted cluster; the `cluster` send-cap scope's
 *     `scope_id` (absent for a pure ICP run with no cluster).
 *   - `periodBucket` — the period key the send-cap counters are bucketed under
 *     (design §6; e.g. a daily key or a per-batch key).
 *   - `repCap` / `clusterCap` — the configured caps for this period, or `null`
 *     (unlimited) when none is configured. Passed through to `capExhausted`.
 *
 * A full `ProspectingBatchRun & { periodBucket; repCap?; clusterCap? }` satisfies
 * this shape directly, so the orchestrator can pass its loaded run row plus the
 * resolved period/caps without adaptation.
 */
export interface EligibilityRun {
  /** Batch_Run id — recorded on the claim row for cascade cleanup. */
  id: string;
  /** The owning rep — claim owner + `rep` send-cap scope. */
  ownerRep: string;
  /** The targeted cluster — `cluster` send-cap scope (null for a pure ICP run). */
  clusterId: string | null;
  /** The period key the send-cap counters are bucketed under (design §6). */
  periodBucket: string;
  /** The configured `rep`-scope cap for this period (null = unlimited). */
  repCap?: number | null;
  /** The configured `cluster`-scope cap for this period (null = unlimited). */
  clusterCap?: number | null;
}

// ── The decision union ──────────────────────────────────────────────────────────

/**
 * The taxonomy of reasons a candidate is excluded from cold outreach. Mirrors
 * the skip reasons surfaced in the Agent_Activity_Log (Req 3.3).
 *
 * `already_in_salesforce` is reserved for the CRM-found exclusion; this pipeline
 * routes a CRM-found candidate to `warm_path` rather than skipping it (Req 2.3,
 * 6.3), so the eligibility gates here never emit `already_in_salesforce` — it is
 * part of the union for completeness and for the activity-log writer.
 */
export type SkipReason =
  | "opted_out"
  | "missing_lawful_basis"
  | "claimed_by_other_rep"
  | "already_in_salesforce"
  | "cap_reached";

/**
 * The outcome of evaluating one candidate (Design §Components #3).
 *
 *   - `cold_eligible` — clear for autonomous cold-outreach drafting; carries the
 *     lawful-basis marker, data source, and acquisition timestamp the queue item
 *     records for provenance (Req 10.1).
 *   - `warm_path` — the candidate is already known (CRM-found, or a local party /
 *     `leads_mirror` match) and must be routed to a warm, non-cold approach
 *     instead of being cold-drafted (Req 2.3, 6.3, 11.5). `via` records how it
 *     was matched.
 *   - `skip` — the candidate is excluded; `reason` is the taxonomy value.
 */
export type Decision =
  | {
      kind: "cold_eligible";
      lawfulBasis: string;
      dataSource: string;
      acquiredAt: string;
    }
  | { kind: "warm_path"; via: "crm" | "local_party" }
  | { kind: "skip"; reason: SkipReason };

// ── The pipeline ────────────────────────────────────────────────────────────────

/**
 * Evaluate one candidate against the fixed eligibility gate sequence and return
 * the first decisive {@link Decision} (Design §Components #3).
 *
 * The gates run in the order documented at the top of this module: opt-out →
 * lawful-basis → cross-rep claim → CRM_Check (with its degradation semantics) →
 * send-cap budget. A candidate that clears every gate without a `warm_path` or
 * `skip` is `cold_eligible`.
 *
 * Side effects are confined to the cross-rep claim (gate 3), which records a
 * claim row when this rep takes the candidate's identity. If a LATER gate
 * (the send-cap budget) excludes the candidate after the claim was taken, the
 * freshly-acquired claim is released so the identity is not stranded and remains
 * claimable. A `warm_path` keeps the claim (the orchestrator anchors it to the
 * warm queue item); a `cold_eligible` keeps the claim (it anchors the cold queue
 * item).
 */
export async function evaluateCandidate(
  db: Database,
  run: EligibilityRun,
  candidate: ProviderResult
): Promise<Decision> {
  const identity = candidateIdentity(candidate);

  // ── Gate 1: opt-out / do-not-contact (Req 6.1) ──────────────────────────────
  if (await isOptedOut(db, optoutKeys(candidate))) {
    return { kind: "skip", reason: "opted_out" };
  }

  // ── Gate 2: lawful-basis present? (Req 10.2) ─────────────────────────────────
  const lawfulBasis = candidate.lawfulBasis?.trim();
  if (!lawfulBasis) {
    return { kind: "skip", reason: "missing_lawful_basis" };
  }

  // ── Gate 3: cross-rep claim (Req 6.2) ────────────────────────────────────────
  const claim = await claimTarget(db, identity, {
    ownerRep: run.ownerRep,
    batchRunId: run.id,
  });
  if (claim.kind === "claimed_by_other_rep") {
    return { kind: "skip", reason: "claimed_by_other_rep" };
  }
  // `held` or `no_identity` → the candidate may proceed. A `no_identity`
  // candidate took no claim, so there is nothing to release on a later skip.
  const claimHeld = claim.kind === "held";

  // ── Gate 4: CRM existence pre-check, with degradation semantics ──────────────
  const crm = await checkCrmForContact({ email: candidate.email ?? null });
  // The check is AUTHORITATIVE only when SF is configured AND the call
  // completed (no `note`). A `note` means it could not complete — unconfigured
  // (`configured:false`) or transient (`configured:true` + `note`, Req 11.4) —
  // so the candidate is CRM-unverified for this pass either way.
  const crmRan = crm.configured && crm.note === undefined;

  if (crmRan) {
    if (crm.found) {
      // Already in Salesforce → warm, never cold (Req 2.3, 6.3).
      return { kind: "warm_path", via: "crm" };
    }
    // CRM ran and did not find them → genuinely cold; continue.
  } else {
    // CRM-unverified: do NOT warm-route on the unrun check (Req 11.3). A LOCAL
    // party / `leads_mirror` match is independent grounds and still warm-routes
    // (Req 11.5).
    if (await hasLocalMatch(db, candidate)) {
      return { kind: "warm_path", via: "local_party" };
    }
    // No local match → treat as cold (CRM-unverified); continue.
  }

  // ── Gate 5: send-cap budget (Req 7.3) ────────────────────────────────────────
  if (await sendCapExhausted(db, run)) {
    // The candidate was otherwise cold-eligible but there is no budget this
    // period. Release the claim we took in gate 3 so the identity is not
    // stranded and another (budgeted) rep can work it later.
    if (claimHeld) await releaseClaim(db, identity);
    return { kind: "skip", reason: "cap_reached" };
  }

  // ── Cold-eligible (Req 6.5) ──────────────────────────────────────────────────
  return {
    kind: "cold_eligible",
    lawfulBasis,
    dataSource: candidate.sourceProvider,
    acquiredAt: acquisitionTimestamp(candidate),
  };
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * The candidate's claim/match identity. The raw phone is held transiently here
 * only — `claimTarget` / `resolveLeadByMatchKeys` salt-hash it before any
 * persistence, and a raw number never reaches a claim, opt-out, or party row
 * (CC-Privacy).
 */
function candidateIdentity(candidate: ProviderResult): ClaimIdentity {
  return { email: candidate.email, phone: candidate.phone };
}

/**
 * The opt-out match keys for a candidate. `emailHash` is the normalized email
 * (the opt-out store normalizes it on lookup); `phoneHash` is the salted phone
 * hash — computed from the raw phone here and never persisted raw (CC-Privacy).
 * An unnormalizable phone yields no hash key (never a raw number).
 */
function optoutKeys(candidate: ProviderResult): OptoutKeys {
  const keys: OptoutKeys = {};
  if (candidate.email) keys.emailHash = candidate.email;
  if (candidate.phone) {
    try {
      keys.phoneHash = computePhoneHash(normalizePhoneToE164(candidate.phone));
    } catch {
      // Unnormalizable phone → no phone_hash key (CC-Privacy).
    }
  }
  return keys;
}

/**
 * Whether a candidate resolves to an existing local Party / `leads_mirror`
 * record (Req 11.5). Reuses the dedupe lookup over the shared party-identity
 * space; a `match` is independent grounds for a warm route even when the CRM
 * check could not run. A `new`/`conflict`/`error` result is NOT a warm route.
 */
async function hasLocalMatch(
  db: Database,
  candidate: ProviderResult
): Promise<boolean> {
  const result = await resolveLeadByMatchKeys(db, {
    email: candidate.email,
    phone: candidate.phone,
  });
  return result.kind === "match";
}

/**
 * Whether the rep OR cluster send-cap scope is exhausted for the run's period
 * (Req 7.3). A cluster scope is only checked when the run targets a cluster.
 */
async function sendCapExhausted(
  db: Database,
  run: EligibilityRun
): Promise<boolean> {
  const repExhausted = await capExhausted(db, {
    scopeKind: "rep",
    scopeId: run.ownerRep,
    periodBucket: run.periodBucket,
    cap: run.repCap,
  });
  if (repExhausted) return true;

  if (run.clusterId) {
    return capExhausted(db, {
      scopeKind: "cluster",
      scopeId: run.clusterId,
      periodBucket: run.periodBucket,
      cap: run.clusterCap,
    });
  }

  return false;
}

/**
 * The acquisition timestamp for the candidate's contact data (Req 10.1).
 * Prefers the provenance `asOf` of the contact fields (email, then phone), then
 * any provenanced attribute's `asOf`, falling back to the current time when the
 * provider stamped none.
 */
function acquisitionTimestamp(candidate: ProviderResult): string {
  const attrs = candidate.attributes;
  const preferred = attrs.email?.asOf ?? attrs.phone?.asOf;
  if (preferred) return preferred;

  for (const field of Object.values(attrs)) {
    if (field?.asOf) return field.asOf;
  }

  return new Date().toISOString();
}
