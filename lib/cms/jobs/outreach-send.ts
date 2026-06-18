import { eq } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { outreachDrafts, targets } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import { enqueueOutbox } from "@/lib/cms/outbox";
import { isOptedOut } from "@/lib/cms/prospecting/optout";
import {
  type ChannelAdapter,
  defaultChannelAdapter,
} from "./channel-adapter";
import type { JobContext, JobHandler } from "./index";

// ── outreach_send (Prospecting Workspace S7) — Design §Architecture (job
// extensions), §Components #7; Requirements 7.2, 7.3, 8.2 ─────────────────────
//
// One `outreach_send` job == one external send of ONE approved OutreachDraft,
// plus its single CRM outbox side effect. The human Approval_Flow gate lives on
// the `send_outreach` CatalogEntry (task 6.2); by the time a draft reaches THIS
// job it has already been approved by a rep. This handler performs the actual
// (billable, irreversible) external send off the request path.
//
// CONTAINER-ONLY: registered + run on the worker tier (Req 12.6 / [container-only]).
//
// IDEMPOTENCY BY THE DRAFT jobKey (Req 7.2, 8.2 / CC-Idem) — the property this
// job exists to guarantee. The draft's stable jobKey is `outreach_send:{draftId}`
// and the job row is enqueued under it, so:
//
//   • the job spine's atomic claim (`runJob`) lets at most ONE run execute the
//     handler per jobKey — every retry of an already-`done` job short-circuits,
//     and concurrent runs race on the conditional UPDATE so only one wins. Hence
//     AT MOST ONE external `ChannelAdapter.send` per jobKey.
//   • the CRM side effect is enqueued via `enqueueOutbox` under a DETERMINISTIC
//     jobKey derived from the job's jobKey, so `ON CONFLICT (job_key) DO NOTHING`
//     collapses any retry to a single outbox row — AT MOST ONE side effect.
//   • a belt-and-braces handler-level guard treats an already-`sent` draft as a
//     no-op, so even a re-enqueue under a fresh job row never re-sends.
//
// PRIVACY (Req 9.2 / CC-Privacy): the recipient address is handed to the
// ChannelAdapter for the external send ONLY. No raw phone enters the outbox
// payload, the SSE event payload, or any failure record — the outbox carries the
// target id + salted phone hash, never the raw number.

/** Payload carried on an `outreach_send` job. */
export interface OutreachSendPayload {
  /** The approved draft to send. */
  draftId: string;
  /** The approving rep, recorded on the sent draft + event (no raw phone). */
  approvedBy?: string;
}

function parsePayload(payload: unknown): OutreachSendPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const draftId = typeof p.draftId === "string" ? p.draftId : undefined;
  if (!draftId) {
    throw new Error("outreach_send: payload.draftId is required");
  }
  const approvedBy =
    typeof p.approvedBy === "string" && p.approvedBy.length > 0
      ? p.approvedBy
      : undefined;
  return { draftId, approvedBy };
}

/**
 * Build a {@link JobHandler} for `outreach_send`, injecting the
 * {@link ChannelAdapter} (defaults to the env-resolved adapter). Tests pass a
 * fake counting adapter to assert the external send happens AT MOST ONCE per
 * jobKey across repeated / concurrent re-runs.
 */
export function createOutreachSendHandler(
  adapter: ChannelAdapter = defaultChannelAdapter()
): JobHandler {
  return async (db: Database, payload: unknown, ctx: JobContext) => {
    const { draftId, approvedBy } = parsePayload(payload);

    // Load the draft + its Target's privacy-safe identity (email, phone_hash)
    // and the transient raw phone used only as the send recipient.
    const [draft] = await db
      .select({
        id: outreachDrafts.id,
        targetId: outreachDrafts.targetId,
        channel: outreachDrafts.channel,
        body: outreachDrafts.body,
        status: outreachDrafts.status,
        targetEmail: targets.email,
        targetPhoneHash: targets.phoneHash,
        targetRawPhone: targets.rawPhone,
      })
      .from(outreachDrafts)
      .leftJoin(targets, eq(targets.id, outreachDrafts.targetId))
      .where(eq(outreachDrafts.id, draftId))
      .limit(1);

    if (!draft) {
      throw new Error(`outreach_send: draft "${draftId}" not found`);
    }

    // Handler-level idempotency guard: an already-sent draft never re-sends,
    // even if somehow re-enqueued under a fresh job row (CC-Idem, Req 8.2).
    if (draft.status === "sent") {
      return;
    }

    // ── Opt-out gate (Req 7.3) ────────────────────────────────────────────────
    // Refuse an opted-out Target — matched on the same privacy-preserving keys
    // the party graph uses (normalized email + salted phone hash). No send.
    const optedOut = await isOptedOut(db, {
      emailHash: draft.targetEmail ?? undefined,
      phoneHash: draft.targetPhoneHash ?? undefined,
    });
    if (optedOut) {
      await db
        .update(outreachDrafts)
        .set({ status: "suppressed", updatedAt: new Date() })
        .where(eq(outreachDrafts.id, draftId));

      await publishEvent(db, {
        type: "prospecting.outreach.suppressed",
        // No raw phone in the payload (CC-Privacy, Req 9.2).
        payload: { draftId, targetId: draft.targetId, reason: "opted_out" },
      });
      return;
    }

    // ── Send (Req 7.2) ────────────────────────────────────────────────────────
    // Resolve the provider-addressable recipient: email for the email channel,
    // else the transient raw phone. Handed to the ChannelAdapter for the external
    // send ONLY — it never enters an event / outbox / failure payload.
    const recipient =
      draft.channel === "email"
        ? draft.targetEmail ?? undefined
        : draft.targetRawPhone ?? undefined;
    if (!recipient) {
      throw new Error(
        `outreach_send: no ${draft.channel} recipient resolvable for draft "${draftId}"`
      );
    }

    // The external (billable) send. The spine's at-most-once claim bounds this
    // to one call per jobKey; on failure we throw and the spine flips the row to
    // `failed` (re-runnable) so a manual re-run can complete it exactly once.
    const sendResult = await adapter.send({ to: recipient, body: draft.body });

    // CRM side effect → outbox under a DETERMINISTIC jobKey derived from the
    // job's own jobKey, so retries reconcile to one row (ON CONFLICT DO NOTHING).
    // Privacy-safe payload: target id + salted phone hash only, never raw phone.
    await enqueueOutbox(
      db,
      "task",
      {
        kind: "outreach_sent",
        draftId,
        targetId: draft.targetId,
        channel: draft.channel,
        phoneHash: draft.targetPhoneHash ?? null,
        messageId: sendResult.messageId,
        provider: sendResult.provider,
      },
      `${ctx.jobKey}:sf-task`
    );

    // Mark sent, stamping the idempotency key (the job's jobKey) on the draft.
    await db
      .update(outreachDrafts)
      .set({
        status: "sent",
        ...(approvedBy ? { approvedBy } : {}),
        jobKey: ctx.jobKey,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(outreachDrafts.id, draftId));

    await publishEvent(db, {
      type: "prospecting.outreach.sent",
      // No raw phone in the payload (CC-Privacy, Req 9.2).
      payload: {
        draftId,
        targetId: draft.targetId,
        channel: draft.channel,
        ...(approvedBy ? { approvedBy } : {}),
      },
    });
  };
}

/** Default handler instance wired to the env-resolved channel adapter. */
export const outreachSendHandler: JobHandler = createOutreachSendHandler();
