/**
 * Agentic Prospecting Batch — batch run orchestration handler
 * (Design §Components #2 "Batch run handler", §Error Handling; Requirements
 * 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.1, 7.3, 9.2, 10.1, 11.1, 11.2, 12.1).
 *
 * `runProspectingBatch(db, payload, ctx)` is the durable `prospecting_batch`
 * job handler (registered in `lib/cms/jobs/register.ts`, run on the
 * container/worker tier). It drives ONE autonomous Batch_Run end to end:
 *
 *   1. Load the persisted `prospecting_batch_runs` row and publish
 *      `prospecting.batch.started` (Req 3.1).
 *   2. Resolve the Batch_Run subject to a `ProspectFilter` — an `icp` subject
 *      passes its `icpFilter` through; a `cluster` subject derives one from the
 *      own catalog (`resolveComparisonSpec`).
 *   3. Discover candidates by dispatching `prospect_search` under the
 *      `agent:prospecting` identity (Req 2.1). All-providers-unavailable
 *      degrades to a zero-item completion with an `unconfigured_providers`
 *      reason rather than erroring (Req 11.1, 11.2).
 *   4. Loop the ordered candidates until N cold-eligible items are queued, the
 *      pool is exhausted, or a send cap is reached (Req 2.7, 7.3). For each:
 *        - `evaluateCandidate` (the eligibility pipeline) classifies it as
 *          `skip` / `warm_path` / `cold_eligible` (Req 2.2, 6.x, 10.2, 11.x);
 *        - a `skip` logs its reason and streams `candidate.skipped` (Req 3.1);
 *        - a `warm_path` records the Target and queues a non-cold warm item;
 *        - a `cold_eligible` scores fit (`scoreCandidateFit`, Req 2.4), records
 *          the Target (`record_target`), drafts grounded UNSENT outreach
 *          (`draft_outreach`, Req 2.5, 2.6), and upserts a `pending` queue item
 *          carrying the fit + lawful-basis provenance (Req 10.1), streaming
 *          `queue.item.queued` + `batch.progress` (Req 3.1).
 *   5. Complete the run (`status = completed`) and publish
 *      `prospecting.batch.completed` (Req 2.7).
 *
 * THE DISPATCHER BOUNDARY (CC-Audit, Req 12.1): every prospecting effect — the
 * provider search, the personal-data Target write, and the grounded draft — goes
 * through `dispatchTool` (`../../ai/tools/dispatch.ts`). This handler NEVER
 * reads a provider or writes `targets` / `outreach_drafts` directly. The only
 * direct DB writes here are to the batch's OWN orchestration tables
 * (`prospecting_batch_runs`, `prospecting_queue_items`,
 * `prospecting_batch_activity`) — bookkeeping, not a prospecting effect.
 *
 * IDEMPOTENT RE-RUN (CC-Idem, Req 9.2): queue items are upserted on
 * `(batch_run_id, target_id)`, and before doing any work for a candidate the
 * loop checks whether the run already has a queue item for that candidate's
 * provider identity — a re-run reuses the prior result instead of recording a
 * duplicate Target / draft / queue item. The cold-eligible count is resumed from
 * the existing items so N is never exceeded across re-runs.
 *
 * DEGRADATION (CC-Degrade):
 *   - every provider unconfigured / failed → complete with zero items and an
 *     `unconfigured_providers` reason (Req 11.2);
 *   - a single failed `draft_outreach` logs a failure activity entry and
 *     continues to the next candidate — one bad candidate never sinks the batch.
 *
 * On an unexpected throw the catch path sets `prospecting_batch_runs.status =
 * failed` with the error reason (so the rep sees a terminal state) and rethrows,
 * so the job spine also marks the job `failed` and keeps it re-runnable.
 */

import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import {
  prospectingBatchRuns,
  prospectingQueueItems,
  prospectingSequences,
  targets,
  type ProspectingBatchRun,
  type ProspectingSequence,
} from "../../schema";
import type { JobContext } from "../../jobs";
import { dispatchTool, type DispatchResult } from "../../ai/tools/dispatch";
import {
  PROSPECTING_AGENT_ACTOR,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
} from "../../ai/tools/prospecting-capabilities";
import type { ToolContext } from "../../ai/tools/registry";
import type { ProspectFilter, ProviderResult } from "../providers";
import type { BriefSpec } from "../brief";
import { resolveComparisonSpec } from "../own-subject";
import { appendActivity, publishBatch } from "./activity";
import { evaluateCandidate, type EligibilityRun } from "./eligibility";
import { scoreCandidateFit, type BatchSubject } from "./fit-score";
import { capExhausted } from "./send-cap";
import {
  enrollmentIdentity,
  enrollmentRemaining,
  insertEnrollment,
  loadSequenceEnrollments,
  periodBucket as toEnrollmentPeriodBucket,
  seenKeyOf,
} from "../sequences/enrollment";

// ── Payload ──────────────────────────────────────────────────────────────────

/** The payload carried on a `prospecting_batch` job. */
export interface RunProspectingBatchPayload {
  /** The `prospecting_batch_runs` row this job drives. */
  batchRunId: string;
}

/** Parse + validate the opaque job payload into a {@link RunProspectingBatchPayload}. */
function parsePayload(payload: unknown): RunProspectingBatchPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const batchRunId = typeof p.batchRunId === "string" ? p.batchRunId : undefined;
  if (!batchRunId) {
    throw new Error("prospecting_batch: payload.batchRunId is required");
  }
  return { batchRunId };
}

// ── Dispatch result shapes (the catalog tools' typed outputs) ─────────────────

/** The `prospect_search` catalog tool's output. */
interface ProspectSearchOutput {
  candidates: ProviderResult[];
  unconfiguredProviders: string[];
  failedProviders: string[];
}

/** The `record_target` catalog tool's output. */
interface RecordTargetOutput {
  targetId: string;
  phoneHash: string | null;
}

/** The `draft_outreach` catalog tool's output. */
interface DraftOutreachOutput {
  draftId: string;
  status: string;
}

// ── The handler ────────────────────────────────────────────────────────────────

/**
 * Drive one autonomous Batch_Run (the `prospecting_batch` job handler). See the
 * module header for the full sequence. Conforms to the job spine's
 * {@link JobHandler} signature `(db, payload, ctx) => Promise<void>`.
 */
export async function runProspectingBatch(
  db: Database,
  payload: unknown,
  _ctx: JobContext
): Promise<void> {
  const { batchRunId } = parsePayload(payload);

  try {
    const run = await loadBatchRun(db, batchRunId);
    const subject = run.subject as BatchSubject;

    // ── Sequence-scoped run gating (additive; ad-hoc path untouched) ──────────
    // When this Batch_Run is a Sequence Refresh_Run (`sequence_id` set), dedupe
    // and enrollment counting span the WHOLE Sequence (not just this run) and
    // each cold enrollment is recorded in the per-Sequence ledger. When
    // `sequenceId` is null the run behaves exactly as the original one-shot /
    // agentic-batch flow.
    const sequenceId = run.sequenceId;
    const sequence = sequenceId ? await loadSequence(db, sequenceId) : null;
    // The cap period bucket for this refresh, derived from the (stable) run
    // creation date so a retried refresh reads/writes the same bucket (Req 11.3).
    const seqPeriodBucket = sequence
      ? toEnrollmentPeriodBucket(sequence.enrollmentPeriod ?? "month", run.createdAt)
      : "";

    await publishBatch(db, "prospecting.batch.started", run, {
      targetCount: run.targetCount,
    });

    // The period the send-cap counters are bucketed under for this run. Derived
    // from the (stable) run creation date so a re-run reads the same bucket.
    const periodBucket = toPeriodBucket(run.createdAt);

    const eligibilityRun: EligibilityRun = {
      id: run.id,
      ownerRep: run.ownerRep,
      clusterId: run.clusterId,
      periodBucket,
      // repCap / clusterCap omitted → `capExhausted` falls back to the cap
      // persisted on the counter row (unlimited when none is configured).
    };

    // Dispatch contexts: the search + Target write run under the prospecting
    // agent; the grounded draft runs under the Outreach_Agent (the only identity
    // granted `draft_outreach`). A send is NEVER dispatched here (CC-HITL).
    const agentCtx: ToolContext = { actor: PROSPECTING_AGENT_ACTOR };
    const outreachCtx: ToolContext = { actor: PROSPECTING_OUTREACH_AGENT_ACTOR };

    // ── Discovery (Req 2.1, CC-Audit) ─────────────────────────────────────────
    const filter = await resolveSubjectToFilter(db, subject);
    if (!filter) {
      // No searchable subject could be resolved (should be guarded at
      // initiation). Degrade to a zero-item completion rather than erroring.
      await completeBatchRun(db, run, "unconfigured_providers");
      await publishBatch(db, "prospecting.batch.completed", run, {
        queued: 0,
        reason: "unconfigured_providers",
      });
      return;
    }

    const searchDispatch = await dispatchTool(
      db,
      "prospect_search",
      { filter },
      agentCtx
    );

    const search = unwrapSearch(searchDispatch);

    // ── All-providers-unavailable degradation (Req 11.1, 11.2) ────────────────
    // A failed search, or one where every provider was unconfigured / failed and
    // produced no candidates, completes the run with zero items and an
    // `unconfigured_providers` reason rather than erroring.
    if (search === null || allProvidersUnavailable(search)) {
      await appendActivity(db, {
        batchRunId: run.id,
        action: "discovered",
        reason: "unconfigured_providers",
        payload: {
          candidates: 0,
          unconfiguredProviders: search?.unconfiguredProviders ?? [],
          failedProviders: search?.failedProviders ?? [],
        },
      });
      await completeBatchRun(db, run, "unconfigured_providers");
      await publishBatch(db, "prospecting.batch.completed", run, {
        queued: 0,
        reason: "unconfigured_providers",
      });
      return;
    }

    await appendActivity(db, {
      batchRunId: run.id,
      action: "discovered",
      payload: {
        candidates: search.candidates.length,
        unconfiguredProviders: search.unconfiguredProviders,
        failedProviders: search.failedProviders,
      },
    });

    // ── Idempotent-re-run bookkeeping (Req 9.2) ───────────────────────────────
    // Candidates already queued by a prior run of this same Batch_Run, keyed by
    // their provider identity, so the loop reuses them instead of recording a
    // duplicate Target / draft / queue item. `queued` resumes from the existing
    // cold-eligible count so N is never exceeded across re-runs.
    //
    // For a Sequence Refresh_Run the dedupe set instead spans the WHOLE Sequence:
    // `loadSequenceEnrollments` rebuilds `seenKeys` from the enrollment ledger so
    // a prospect enrolled by ANY prior refresh is skipped (Req 3.4, 5.1, 5.2).
    // The per-run cold count is still resumed from this run's own queue items so
    // the per-refresh size N is not exceeded on a retry (Req 5.3).
    const existing = await loadExistingQueue(db, run.id);
    const seenKeys = sequenceId
      ? await loadSequenceEnrollments(db, sequenceId)
      : existing.seenKeys;
    let queued = existing.coldQueued;

    // ── Per-candidate loop (Req 2.7) ──────────────────────────────────────────
    for (const candidate of orderedCandidates(search.candidates)) {
      if (queued >= run.targetCount) break; // produced N (Req 2.7)

      // The dedupe identity. For a Sequence Refresh_Run this is the privacy-safe
      // ledger identity (so it aligns byte-for-byte with the keys
      // `loadSequenceEnrollments` rebuilt); for an ad-hoc run it is the original
      // `candidateKey`. Either way a candidate already enrolled / queued is
      // skipped without recording a duplicate (Req 3.4, 5.2, 9.2).
      const identity = sequenceId ? enrollmentIdentity(candidate) : null;
      const dedupeKey = identity ? seenKeyOf(identity) : candidateKey(candidate);
      if (seenKeys.has(dedupeKey)) continue;

      // Stop drafting for a scope whose send cap is exhausted (Req 7.3).
      if (await runCapExhausted(db, eligibilityRun)) {
        await appendActivity(db, {
          batchRunId: run.id,
          action: "skipped",
          reason: "cap_reached",
        });
        await publishBatch(db, "prospecting.batch.candidate.skipped", run, {
          reason: "cap_reached",
        });
        break;
      }

      const decision = await evaluateCandidate(db, eligibilityRun, candidate);

      // ── Skip (opted-out / no lawful basis / claimed / cap) ──────────────────
      if (decision.kind === "skip") {
        await appendActivity(db, {
          batchRunId: run.id,
          action: "skipped",
          reason: decision.reason,
        });
        await publishBatch(db, "prospecting.batch.candidate.skipped", run, {
          reason: decision.reason,
        });
        continue;
      }

      // ── Enrollment cap (Sequence Refresh_Run only, Req 3.5, 11.2) ───────────
      // Before drafting a cold-eligible candidate, check the Sequence's remaining
      // enrollment budget for the current period. When exhausted, record a
      // `cap_reached` Activity_Log entry and stop enrolling for this run —
      // mirroring the `runCapExhausted` send-cap stop above. Warm-path candidates
      // do not consume the enrollment cap, so the check is gated on cold-eligible.
      if (sequence && decision.kind === "cold_eligible") {
        const remaining = await enrollmentRemaining(db, sequence, seqPeriodBucket);
        if (remaining !== null && remaining <= 0) {
          await appendActivity(db, {
            batchRunId: run.id,
            action: "skipped",
            reason: "cap_reached",
          });
          await publishBatch(db, "prospecting.batch.candidate.skipped", run, {
            reason: "cap_reached",
          });
          break;
        }
      }

      // Both warm_path and cold_eligible queue an item, which needs a Target id.
      // Recording the Target is a personal-data write → through the dispatcher.
      const recordDispatch = await dispatchTool(
        db,
        "record_target",
        toRecord(candidate, subject),
        agentCtx
      );
      if (!recordDispatch.ok) {
        // The Target write failed for this candidate — log and continue.
        await appendActivity(db, {
          batchRunId: run.id,
          action: "skipped",
          reason: "record_failed",
        });
        continue;
      }
      const targetId = (recordDispatch.result as RecordTargetOutput).targetId;

      // ── Warm path (already known → never cold-drafted, Req 2.3, 6.3) ────────
      if (decision.kind === "warm_path") {
        await upsertQueueItem(db, {
          batchRunId: run.id,
          targetId,
          eligibility: "warm_path",
          status: "skipped",
          lawfulBasis: candidate.lawfulBasis,
          dataSource: candidate.sourceProvider,
        });
        await appendActivity(db, {
          batchRunId: run.id,
          action: "warm_path",
          reason: decision.via === "crm" ? "already_in_salesforce" : "local_party",
          targetId,
        });
        await publishBatch(db, "prospecting.batch.candidate.skipped", run, {
          targetId,
          reason:
            decision.via === "crm" ? "already_in_salesforce" : "local_party",
        });
        continue;
      }

      // ── Cold-eligible: score → draft → queue (Req 2.4, 2.5, 2.6, 10.1) ──────
      const fit = scoreCandidateFit(subject, candidate);
      await appendActivity(db, {
        batchRunId: run.id,
        action: "scored",
        targetId,
        payload: { score: fit.score },
      });

      const draftDispatch = await dispatchTool(
        db,
        "draft_outreach",
        toDraft(targetId, candidate, subject, filter),
        outreachCtx
      );
      if (!draftDispatch.ok) {
        // Degradation: one failed draft logs a failure entry and continues —
        // one bad candidate never sinks the batch (Req 11, Error Handling).
        await appendActivity(db, {
          batchRunId: run.id,
          action: "drafted",
          reason: "draft_failed",
          targetId,
        });
        continue;
      }
      const draftId = (draftDispatch.result as DraftOutreachOutput).draftId;

      await upsertQueueItem(db, {
        batchRunId: run.id,
        targetId,
        eligibility: "cold_eligible",
        status: "pending",
        draftId,
        fitScore: fit.score,
        fitRationale: fit.rationale,
        lawfulBasis: decision.lawfulBasis,
        dataSource: decision.dataSource,
        acquiredAt: decision.acquiredAt,
      });

      // ── Enrollment ledger write (Sequence Refresh_Run only) ─────────────────
      // Record the per-Sequence enrollment with `ON CONFLICT DO NOTHING`. The
      // row's existence IS the enroll-at-most-once guarantee and the cap counter
      // (Req 5.1, 5.3, 11.4). Only candidates carrying a privacy-safe identity
      // (ref / email / phone hash) can be ledgered; one without falls back to the
      // per-run dedupe already applied above.
      if (sequenceId && identity) {
        await insertEnrollment(db, {
          sequenceId,
          matchKind: identity.matchKind,
          matchValue: identity.matchValue,
          targetId,
          batchRunId: run.id,
          periodBucket: seqPeriodBucket,
        });
      }

      await appendActivity(db, {
        batchRunId: run.id,
        action: "drafted",
        targetId,
        payload: { score: fit.score },
      });

      queued += 1;
      seenKeys.add(dedupeKey);
      await publishBatch(db, "prospecting.queue.item.queued", run, { targetId });
      await publishBatch(db, "prospecting.batch.progress", run, { queued });
    }

    // ── Complete (Req 2.7) ────────────────────────────────────────────────────
    await completeBatchRun(db, run, null);
    await publishBatch(db, "prospecting.batch.completed", run, { queued });
  } catch (err) {
    // Terminal failure: stamp the run `failed` with a reason so the rep sees a
    // terminal state, then rethrow so the job spine marks the job failed too
    // (and keeps it re-runnable — a re-run is idempotent, Req 9.2).
    const message = err instanceof Error ? err.message : String(err);
    await markRunFailed(db, batchRunId, message);
    throw err;
  }
}

// ── Subject → filter resolution ──────────────────────────────────────────────

/**
 * Resolve a Batch_Run subject to a `ProspectFilter` for discovery. An `icp`
 * subject (or any subject that already carries a resolved `icpFilter`) passes it
 * through; a `cluster` subject derives a filter from the own catalog via
 * `resolveComparisonSpec`. Returns `null` when no searchable filter can be
 * resolved.
 */
async function resolveSubjectToFilter(
  db: Database,
  subject: BatchSubject
): Promise<ProspectFilter | null> {
  if (subject.icpFilter) return subject.icpFilter;

  // A cluster is the most specific own subject — resolve its comparison spec.
  if (subject.clusterId) {
    const resolved = await resolveComparisonSpec(db, {
      clusterId: subject.clusterId,
    });
    return briefSpecToFilter(resolved.spec);
  }

  // No cluster chosen but a whole own PROJECT is the subject — derive the filter
  // from the project's own catalog (area / segment / unit types). This is what
  // lets a rep create a sequence by picking just a Community + Project, with the
  // cluster left optional.
  if (subject.projectId) {
    const resolved = await resolveComparisonSpec(db, {
      projectId: subject.projectId,
      ...(subject.communityId ? { communityId: subject.communityId } : {}),
    });
    return briefSpecToFilter(resolved.spec);
  }

  return null;
}

/**
 * Map a cluster-derived {@link BriefSpec} to a minimal {@link ProspectFilter}:
 * the area becomes a geography seed and the segment / unit type become keyword
 * seeds. Defaults to a `person` search (the prospecting hero flow's subject).
 */
function briefSpecToFilter(spec: BriefSpec): ProspectFilter {
  const keywords: string[] = [];
  if (spec.segment) keywords.push(spec.segment);
  if (spec.unitType) keywords.push(spec.unitType);

  return {
    targetType: "person",
    ...(spec.area ? { geography: [spec.area] } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

// ── Dispatch unwrapping + degradation detection ──────────────────────────────

/** Unwrap a `prospect_search` dispatch; `null` when the dispatch failed. */
function unwrapSearch(dispatch: DispatchResult): ProspectSearchOutput | null {
  if (!dispatch.ok) return null;
  return dispatch.result as ProspectSearchOutput;
}

/**
 * Whether a search yielded no candidates AND every provider that was attempted
 * was unconfigured or failed — the all-providers-unavailable degradation
 * (Req 11.2). A provider that ran and simply returned no matches is NOT this
 * case (it leaves neither an unconfigured nor a failed marker).
 */
function allProvidersUnavailable(search: ProspectSearchOutput): boolean {
  return (
    search.candidates.length === 0 &&
    search.unconfiguredProviders.length + search.failedProviders.length > 0
  );
}

// ── Candidate ordering + identity keying ─────────────────────────────────────

/**
 * Order the discovered candidates deterministically so a re-run processes them
 * in the same order. Sorted by their stable identity key.
 */
function orderedCandidates(candidates: ProviderResult[]): ProviderResult[] {
  return [...candidates].sort((a, b) =>
    candidateKey(a).localeCompare(candidateKey(b))
  );
}

/**
 * A stable identity key for a candidate, used to dedupe across re-runs. Prefers
 * the provider's own `sourceRef`, then the normalized email, then the display /
 * company name. Never includes a raw phone (CC-Privacy).
 */
function candidateKey(c: ProviderResult): string {
  if (c.sourceRef) return `ref:${c.sourceProvider}:${c.sourceRef}`;
  if (c.email) return `email:${c.email.trim().toLowerCase()}`;
  return `name:${(c.displayName ?? c.companyName ?? "").trim().toLowerCase()}`;
}

// ── Tool input builders ──────────────────────────────────────────────────────

/** A loose UUID v4-ish guard so an optional brief id never fails Zod validation. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuid(value: string | undefined): string | undefined {
  return value !== undefined && UUID_RE.test(value) ? value : undefined;
}

/** Build the `record_target` input from a discovered candidate. */
function toRecord(
  candidate: ProviderResult,
  subject: BatchSubject
): Record<string, unknown> {
  const briefId = asUuid(subject.briefId);
  return {
    ...(briefId ? { briefId } : {}),
    targetType: candidate.targetType,
    ...(candidate.displayName ? { displayName: candidate.displayName } : {}),
    ...(candidate.companyName ? { companyName: candidate.companyName } : {}),
    ...(candidate.title ? { title: candidate.title } : {}),
    ...(candidate.email ? { email: candidate.email } : {}),
    ...(candidate.phone ? { phone: candidate.phone } : {}),
    ...(candidate.country ? { country: candidate.country } : {}),
    attributes: candidate.attributes ?? {},
    sourceProvider: candidate.sourceProvider,
    ...(candidate.sourceRef ? { sourceRef: candidate.sourceRef } : {}),
    lawfulBasis: candidate.lawfulBasis,
  };
}

/**
 * Build the `draft_outreach` input for a cold-eligible Target. The body is
 * deterministic prose that states no figures, so the grounding manifest is empty
 * — the agent writes prose only and invents no figures (Req 2.6). The draft is
 * persisted UNSENT (Req 2.5).
 *
 * The copy is personalized from (a) what the provider actually returned about
 * the candidate (name, role, company, country) and (b) the resolved own-catalog
 * subject (`filter` — the area / segment derived from the rep's project or
 * cluster), and is framed by the candidate's `targetType`. None of these are
 * market figures, so the no-figures / empty-grounding invariant holds.
 */
function toDraft(
  targetId: string,
  candidate: ProviderResult,
  subject: BatchSubject,
  filter: ProspectFilter
): Record<string, unknown> {
  const briefId = asUuid(subject.briefId);
  const targetType = candidate.targetType;
  const name =
    candidate.displayName?.trim() || candidate.companyName?.trim() || "there";

  // Personalization drawn ONLY from provider-returned identity fields.
  const role = candidate.title?.trim();
  const company = candidate.companyName?.trim();
  const country = candidate.country?.trim();
  const roleLine =
    role && company
      ? `As ${role} at ${company}, `
      : company
        ? `Given your work at ${company}, `
        : role
          ? `As ${role}, `
          : "";

  // What this sequence is about, from the resolved own-catalog subject. `area`
  // and `segment` come from the rep's own project / cluster spec — naming them
  // is specific without quoting any price or return figure.
  const area = filter.geography?.[0]?.trim();
  const segment = filter.keywords?.[0]?.trim().replace(/_/g, " ");
  const offering =
    `${segment ? `${segment} ` : ""}residences` + (area ? ` in ${area}` : " in Dubai");

  // Frame the value by who we're talking to (the three prospecting types).
  const hook =
    targetType === "company"
      ? `a ${offering} opportunity that may suit your portfolio or principals`
      : targetType === "intermediary"
        ? `a ${offering} opportunity your clients may find compelling`
        : `a ${offering} opportunity I thought might be of personal interest`;

  const subjectLine = area
    ? `${segment ? `${segment[0].toUpperCase()}${segment.slice(1)} ` : "An "}opportunity in ${area}`
    : "An opportunity worth a conversation";

  const body =
    `Hi ${name},\n\n` +
    `${roleLine}I wanted to introduce myself — I lead prospecting for ORA, a ` +
    `Dubai-based prime-residential developer behind the Bayn master community. ` +
    `We're currently introducing ${hook}.\n\n` +
    (country
      ? `We already work with a number of ${country}-based buyers, and I'd be glad to share the details most relevant to you.\n\n`
      : `I'd be glad to share the details most relevant to you.\n\n`) +
    `Would you be open to a brief call this week?\n\nBest regards,\nORA`;

  return {
    targetId,
    ...(briefId ? { briefId } : {}),
    channel: "email",
    language: "en",
    subject: subjectLine,
    body,
    // No factual claims / figures → no grounded records to pin (Req 2.6).
    grounding: [],
  };
}

// ── Queue item upsert (idempotent on (batch_run_id, target_id), Req 9.2) ──────

/** The fields needed to upsert one queue item. */
interface UpsertQueueItemInput {
  batchRunId: string;
  targetId: string;
  eligibility: "cold_eligible" | "warm_path" | "skipped";
  status: "pending" | "approved" | "rejected" | "sent" | "skipped";
  draftId?: string;
  fitScore?: number;
  fitRationale?: unknown;
  lawfulBasis?: string;
  dataSource?: string;
  acquiredAt?: string;
}

/**
 * Insert (or, on a `(batch_run_id, target_id)` conflict, update) one queue item.
 * The unique index makes a re-run reuse the prior row rather than duplicate it
 * (Req 9.2). The lawful-basis / data-source / acquisition timestamp are copied
 * onto the item as provenance (Req 10.1).
 */
async function upsertQueueItem(
  db: Database,
  input: UpsertQueueItemInput
): Promise<void> {
  const values = {
    batchRunId: input.batchRunId,
    targetId: input.targetId,
    eligibility: input.eligibility,
    status: input.status,
    draftId: input.draftId ?? null,
    // `numeric` columns round-trip as strings in Drizzle.
    fitScore: input.fitScore !== undefined ? input.fitScore.toString() : null,
    fitRationale: input.fitRationale ?? null,
    lawfulBasis: input.lawfulBasis ?? null,
    dataSource: input.dataSource ?? null,
    acquiredAt: input.acquiredAt ? new Date(input.acquiredAt) : null,
    updatedAt: new Date(),
  };

  await db
    .insert(prospectingQueueItems)
    .values(values)
    .onConflictDoUpdate({
      target: [
        prospectingQueueItems.batchRunId,
        prospectingQueueItems.targetId,
      ],
      set: {
        eligibility: values.eligibility,
        status: values.status,
        draftId: values.draftId,
        fitScore: values.fitScore,
        fitRationale: values.fitRationale,
        lawfulBasis: values.lawfulBasis,
        dataSource: values.dataSource,
        acquiredAt: values.acquiredAt,
        updatedAt: values.updatedAt,
      },
    });
}

// ── Run lifecycle + existing-queue load ──────────────────────────────────────

/** Load the Batch_Run row, throwing when it does not exist. */
async function loadBatchRun(
  db: Database,
  batchRunId: string
): Promise<ProspectingBatchRun> {
  const [run] = await db
    .select()
    .from(prospectingBatchRuns)
    .where(eq(prospectingBatchRuns.id, batchRunId))
    .limit(1);
  if (!run) {
    throw new Error(`prospecting_batch: run "${batchRunId}" not found`);
  }
  return run;
}

/**
 * Load the candidate identity keys already queued by a prior run of this same
 * Batch_Run, plus the count of cold-eligible items (to resume the N budget).
 * Joins each queue item to its Target to reconstruct the provider identity key.
 */
async function loadExistingQueue(
  db: Database,
  batchRunId: string
): Promise<{ seenKeys: Set<string>; coldQueued: number }> {
  const rows = await db
    .select({
      eligibility: prospectingQueueItems.eligibility,
      sourceProvider: targets.sourceProvider,
      sourceRef: targets.sourceRef,
      email: targets.email,
      displayName: targets.displayName,
      companyName: targets.companyName,
    })
    .from(prospectingQueueItems)
    .innerJoin(targets, eq(targets.id, prospectingQueueItems.targetId))
    .where(eq(prospectingQueueItems.batchRunId, batchRunId));

  const seenKeys = new Set<string>();
  let coldQueued = 0;
  for (const r of rows) {
    seenKeys.add(
      candidateKey({
        sourceProvider: r.sourceProvider as ProviderResult["sourceProvider"],
        sourceRef: r.sourceRef ?? undefined,
        email: r.email ?? undefined,
        displayName: r.displayName ?? undefined,
        companyName: r.companyName ?? undefined,
      } as ProviderResult)
    );
    if (r.eligibility === "cold_eligible") coldQueued += 1;
  }

  return { seenKeys, coldQueued };
}

/** Mark the run `completed`, recording an optional terminal reason. */
async function completeBatchRun(
  db: Database,
  run: ProspectingBatchRun,
  reason: string | null
): Promise<void> {
  await db
    .update(prospectingBatchRuns)
    .set({ status: "completed", reason, updatedAt: new Date() })
    .where(eq(prospectingBatchRuns.id, run.id));

  // ── Sequence completion hook (Req 4.4) ──────────────────────────────────────
  // On any successful completion of a Sequence Refresh_Run (including a graceful
  // zero-enrollment degradation), stamp the Sequence's last refresh time. A
  // terminal FAILURE goes through `markRunFailed` instead and never touches this,
  // so a failed refresh leaves the Sequence `live` with its next slot intact
  // (Req 14.4). `next_refresh_at` was already advanced at schedule time.
  if (run.sequenceId) {
    await db
      .update(prospectingSequences)
      .set({ lastRefreshedAt: new Date(), updatedAt: new Date() })
      .where(eq(prospectingSequences.id, run.sequenceId));
  }
}

/** Load the parent Sequence row for a Refresh_Run; `null` when none exists. */
async function loadSequence(
  db: Database,
  sequenceId: string
): Promise<ProspectingSequence | null> {
  const [sequence] = await db
    .select()
    .from(prospectingSequences)
    .where(eq(prospectingSequences.id, sequenceId))
    .limit(1);
  return sequence ?? null;
}

/** Mark the run `failed` with a terminal reason (the catch path). */
async function markRunFailed(
  db: Database,
  batchRunId: string,
  reason: string
): Promise<void> {
  await db
    .update(prospectingBatchRuns)
    .set({ status: "failed", reason, updatedAt: new Date() })
    .where(eq(prospectingBatchRuns.id, batchRunId));
}

// ── Send-cap loop gate ───────────────────────────────────────────────────────

/**
 * Whether the run's rep OR cluster send-cap scope is exhausted for the period
 * (Req 7.3). A cluster scope is only checked when the run targets a cluster. The
 * configured cap is read from the counter row (omitted here → unlimited when
 * none is configured).
 */
async function runCapExhausted(
  db: Database,
  run: EligibilityRun
): Promise<boolean> {
  if (
    await capExhausted(db, {
      scopeKind: "rep",
      scopeId: run.ownerRep,
      periodBucket: run.periodBucket,
    })
  ) {
    return true;
  }
  if (run.clusterId) {
    return capExhausted(db, {
      scopeKind: "cluster",
      scopeId: run.clusterId,
      periodBucket: run.periodBucket,
    });
  }
  return false;
}

/** The daily period bucket key (`YYYY-MM-DD`) for a run's creation date. */
function toPeriodBucket(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 10);
}
