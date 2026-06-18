/**
 * DOE Voice Surface — voice session service.
 *
 * The request/response half of the voice surface (the durable WebRTC audio
 * leg is owned by LiveKit, not this module). {@link createVoiceSession} turns a
 * caller's pre-call form into a live call:
 *
 *   1. Normalise the phone to E.164 and resolve (or create) the caller's party
 *      via the salted-hash identity graph (`resolveParty`).
 *   2. Build the mirror-only {@link CallContext} ("ring-time lookup"), carrying
 *      the form identities so an unknown caller's lead is still attributed to
 *      the web form source — never a Salesforce call (Req 3.5).
 *   3. Provision LiveKit: a fresh `call_{ulid}` room, an ephemeral room-scoped
 *      participant token, and an explicit agent dispatch with the context as
 *      job metadata.
 *   4. Persist an `aiConversations` row (`channel = "web_call"`, resolved
 *      `partyId`, status `"connecting"`).
 *   5. Publish a privacy-safe `session.created` event (Property 9: no raw phone
 *      ever enters the event bus).
 *
 * {@link getVoiceSession} backs the widget thank-you card (FR-W6 / Req 2.8): it
 * returns the conversation status/summary plus any appointment booked in-call.
 *
 * ORDERING: LiveKit provisioning runs BEFORE the conversation row is inserted,
 * so a LiveKit failure cannot leave a dangling `connecting` conversation.
 *
 * PRIVACY (Req 14.5 / Property 9): the raw E.164 number is only ever passed as
 * transient LiveKit job metadata (via the `CallContext.formIdentities`) and
 * stored on the `aiConversations` participant columns (mirroring existing
 * channel behaviour, design §9.2). It is NEVER written into an `events`
 * payload — the `session.created` payload carries only the salted/opaque ids.
 *
 * Design references: §7.2 (session service), §8.1 (thank-you card lookup),
 * §10 (endpoint signatures). Requirements: 3.1, 3.7, 3.8, 3.9 (session
 * creation), 2.8 (thank-you card), 14.5 (phone privacy).
 */

import { desc, eq } from "drizzle-orm";

import type { Database } from "../db";
import { aiAppointments, aiConversations } from "../schema";
import { publishEvent } from "../realtime/events";
import type {
  AppointmentResultContract,
  CreateVoiceSessionInput,
  CreateVoiceSessionResult,
  GetVoiceSessionResult,
} from "./contracts";
import { normalizePhoneToE164, resolveParty } from "./identity";
import { buildCallContext } from "./prefetch";
import {
  createRoom,
  deleteRoom,
  dispatchAgent,
  generateRoomName,
  mintParticipantToken,
} from "./livekit";

/**
 * Create a voice session for a caller from their validated pre-call form.
 *
 * @param db    Drizzle database handle.
 * @param input Validated session request (`consent === true`).
 * @returns the room name, ephemeral token, LiveKit URL, and conversation id the
 *   widget needs to join the call (Req 3.7, 3.8, 3.9).
 */
export async function createVoiceSession(
  db: Database,
  input: CreateVoiceSessionInput
): Promise<CreateVoiceSessionResult> {
  // 1) Normalise + resolve the caller into the party graph (phone is hashed,
  //    never stored raw — Req 3.2, 3.3, 14.5).
  const e164 = normalizePhoneToE164(input.phone);
  const { partyId, known } = await resolveParty(db, {
    e164,
    email: input.email,
    name: input.name,
    consent: input.consent,
    demo: false,
  });

  // 2) Build the mirror-only ring-time context. The form identities are carried
  //    so an unknown caller is attributed to the web form source and the agent
  //    never re-asks for the phone number (Req 3.4, 3.5, 3.10).
  const context = await buildCallContext(db, partyId, {
    formIdentities: {
      email: input.email,
      phone: e164,
      name: input.name,
      source: input.page,
    },
  });

  // 3) Provision LiveKit BEFORE persisting the conversation, so a provisioning
  //    failure never leaves a dangling `connecting` row (Req 3.6).
  const roomName = generateRoomName();
  await createRoom(roomName);
  const token = await mintParticipantToken(roomName, partyId);
  await dispatchAgent(roomName, context);

  // 4) Persist the conversation. `channel = "web_call"`, the resolved party,
  //    and status `"connecting"` (design §7.2). Participant identities mirror
  //    existing channel behaviour (design §9.2).
  const [conversation] = await db
    .insert(aiConversations)
    .values({
      channel: "web_call",
      partyId,
      status: "connecting",
      language: context.language,
      participantName: input.name,
      participantEmail: input.email,
      participantPhone: e164,
    })
    .returning({ id: aiConversations.id });

  const conversationId = conversation.id;

  // 5) Publish a privacy-safe `session.created` event. The payload carries only
  //    opaque ids — never the raw phone number (Req 11.3, 14.5 / Property 9).
  await publishEvent(db, {
    type: "session.created",
    payload: { conversationId, partyId, known, roomName },
  });

  return {
    roomName,
    token,
    livekitUrl: process.env.LIVEKIT_URL ?? "",
    conversationId,
  };
}

/**
 * End a voice session when the caller hangs up (FR-W: clean teardown).
 *
 * The widget calls this the moment the caller ends the call so the agent is
 * killed immediately rather than lingering until LiveKit's room timeout:
 *
 *   1. Delete the LiveKit room (best-effort) — this forcibly disconnects the
 *      agent, ending its job at once. For a call where the agent connected, the
 *      worker's session-close handler then publishes `call.ended` and runs
 *      `post_call_processing` as usual.
 *   2. If the conversation never got past `connecting` (the agent never joined —
 *      the "stuck Connecting" case), finalize it here: mark it `abandoned` and
 *      publish a privacy-safe `call.ended` so the Demo Console clears it.
 *
 * Fully idempotent: a conversation already in a terminal state is left alone,
 * and a missing/zombie room delete is swallowed. The `roomName` is validated to
 * the `call_{ulid}` shape so this endpoint can never be used to delete an
 * unrelated room.
 *
 * @param db             Drizzle database handle.
 * @param conversationId The `aiConversations` row id from session create.
 * @param roomName       The `call_{ulid}` room to tear down (from the widget).
 */
export async function endVoiceSession(
  db: Database,
  input: { conversationId: string; roomName?: string | null }
): Promise<{ ok: boolean }> {
  const { conversationId, roomName } = input;

  // 1) Kill the agent immediately by deleting the room (best-effort). Guard the
  //    room name so only a real `call_…` room can ever be targeted.
  if (roomName && /^call_[0-9A-Za-z]+$/.test(roomName)) {
    try {
      await deleteRoom(roomName);
    } catch {
      /* room may already be gone (agent left / timed out) — non-fatal */
    }
  }

  // 2) Look up the conversation to decide whether we must finalize it here.
  const [conversation] = await db
    .select({
      status: aiConversations.status,
      partyId: aiConversations.partyId,
      language: aiConversations.language,
    })
    .from(aiConversations)
    .where(eq(aiConversations.id, conversationId))
    .limit(1);

  if (!conversation) return { ok: false };

  // Already finalized → nothing to do (idempotent).
  const TERMINAL = new Set(["resolved", "handed_off", "abandoned"]);
  if (TERMINAL.has(conversation.status)) return { ok: true };

  // The agent never joined (stuck "connecting"): no worker will fire a
  // close → finalize here so the row + Console don't dangle forever. For an
  // "active" call the agent DID join, so deleting the room above lets the
  // worker's close handler publish `call.ended` and run post-call processing —
  // we don't double-finalize that path.
  if (conversation.status === "connecting") {
    await db
      .update(aiConversations)
      .set({ status: "abandoned", resolvedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));

    await publishEvent(db, {
      type: "call.ended",
      payload: {
        conversationId,
        partyId: conversation.partyId,
        language: conversation.language,
      },
    });
  }

  return { ok: true };
}

/**
 * Read a voice session's status, summary, and any appointment booked in-call to
 * drive the widget thank-you card (FR-W6 / Req 2.8).
 *
 * @param db             Drizzle database handle.
 * @param conversationId The `aiConversations` row id returned at session create.
 * @returns the conversation status, optional summary, and the optional
 *   appointment mapped to the thank-you card shape.
 * @throws if no conversation matches `conversationId`.
 */
export async function getVoiceSession(
  db: Database,
  conversationId: string
): Promise<GetVoiceSessionResult> {
  const [conversation] = await db
    .select({
      status: aiConversations.status,
      summary: aiConversations.summary,
    })
    .from(aiConversations)
    .where(eq(aiConversations.id, conversationId))
    .limit(1);

  if (!conversation) {
    throw new Error(`Voice session not found: ${conversationId}`);
  }

  // Most-recent appointment booked during this call (if any) populates the card.
  const [appointment] = await db
    .select({
      id: aiAppointments.id,
      referenceNumber: aiAppointments.referenceNumber,
      appointmentType: aiAppointments.appointmentType,
      scheduledDate: aiAppointments.scheduledDate,
      scheduledTime: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contactName: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(eq(aiAppointments.conversationId, conversationId))
    .orderBy(desc(aiAppointments.createdAt))
    .limit(1);

  const mappedAppointment: AppointmentResultContract | undefined = appointment
    ? {
        id: appointment.id,
        referenceNumber: appointment.referenceNumber,
        appointmentType: appointment.appointmentType,
        scheduledDate: appointment.scheduledDate,
        scheduledTime: appointment.scheduledTime,
        status: appointment.status,
        contactName: appointment.contactName,
      }
    : undefined;

  return {
    status: conversation.status,
    summary: conversation.summary ?? undefined,
    appointment: mappedAppointment,
  };
}
