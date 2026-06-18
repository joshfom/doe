/**
 * DOE Voice Surface — LiveKit integration.
 *
 * Server-side bridge to LiveKit Cloud: mints ephemeral room-scoped participant
 * tokens, creates rooms, and dispatches the voice agent into a room with the
 * prefetched {@link CallContext} as job metadata. LiveKit owns hard real-time
 * audio (WebRTC) and never touches Elysia — this module only talks to the
 * LiveKit HTTP APIs over the SDK.
 *
 * SECURITY (design §22, SEC-3 / Requirement 14.4, Property 11):
 *   - Tokens carry identity `caller:{partyId}`.
 *   - The video grant is scoped to exactly the `call_{ulid}` room (roomJoin only,
 *     no room create/admin/list), so a leaked token cannot reach other rooms.
 *   - TTL is capped at 10 minutes ({@link TOKEN_TTL_SECONDS}).
 *   - The widget receives only this room-scoped token — never an API key
 *     (SEC-2). The API key/secret live in env on the server/container tier only.
 *
 * CONTAINER-ONLY (design §5 / Requirement 12.6): {@link dispatchAgent} drives the
 * LiveKit Agents dispatch API and is invoked from the container tier (the Bun
 * mount / voice session service), never from Vercel serverless.
 *
 * LAZY CONSTRUCTION: clients are built per-call from environment variables so
 * importing this module never fails when LiveKit credentials are absent (e.g.
 * during tests or in environments that do not run the voice surface). Tests mock
 * `livekit-server-sdk` per design (creds-gated task).
 *
 * Design references: §7.4 (signatures), §22 (security & env vars).
 * Requirements: 3.6 (room/token/dispatch), 14.4 (token scoping & TTL).
 */

import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  type VideoGrant,
} from "livekit-server-sdk";

import type { CallContext } from "./contracts";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum lifetime of a minted participant token, in seconds (10 minutes).
 * Enforced as an upper bound by SEC-3 / Requirement 14.4 / Property 11.
 */
export const TOKEN_TTL_SECONDS = 600;

/** Default explicit-dispatch agent name when `LIVEKIT_AGENT_NAME` is unset. */
const DEFAULT_AGENT_NAME = "doe-voice-agent";

/** Crockford Base32 alphabet used for ULID encoding (no I, L, O, U). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ── Environment ──────────────────────────────────────────────────────────────

interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Reads LiveKit credentials from the environment at call time (never at import
 * time). Throws a descriptive error if a required value is missing so misconfig
 * surfaces clearly rather than as an opaque SDK failure.
 */
function getLiveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  const missing: string[] = [];
  if (!url) missing.push("LIVEKIT_URL");
  if (!apiKey) missing.push("LIVEKIT_API_KEY");
  if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `LiveKit is not configured: missing ${missing.join(", ")}. ` +
        "Set these on the server/container tier (never in a client bundle).",
    );
  }

  return { url: url!, apiKey: apiKey!, apiSecret: apiSecret! };
}

// ── Room naming ──────────────────────────────────────────────────────────────

/**
 * Generates a lexicographically-sortable ULID (26-char Crockford Base32:
 * 48-bit millisecond timestamp + 80 bits of crypto randomness). Implemented
 * inline because the project ships no ULID/nanoid dependency and its id
 * convention (`crypto.randomUUID`) does not match the spec's `call_{ulid}`
 * room-name format (design §7.4).
 */
export function ulid(now: number = Date.now()): string {
  let timePart = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }

  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  let randomPart = "";
  for (let i = 0; i < 16; i++) {
    randomPart += CROCKFORD[randomBytes[i] % 32];
  }

  return timePart + randomPart;
}

/**
 * Builds a fresh room name of the form `call_{ulid}` (design §7.4, FR-S2).
 */
export function generateRoomName(): string {
  return `call_${ulid()}`;
}

// ── Token mint ───────────────────────────────────────────────────────────────

/**
 * Mints an ephemeral, room-scoped LiveKit participant token for the caller.
 *
 * The token's identity is `caller:{partyId}`, the grant permits joining only
 * the supplied `roomName` (with audio publish/subscribe), and the TTL is capped
 * at {@link TOKEN_TTL_SECONDS} (10 minutes). It is a standard JWT — decode it to
 * verify identity, the room-scoped grant, and the TTL (Property 11 / task 7.2).
 *
 * Note: the underlying SDK signs asynchronously, so this returns a `Promise`.
 *
 * @param roomName - the `call_{ulid}` room the token grants access to
 * @param partyId  - resolved party id; becomes identity `caller:{partyId}`
 * @returns the signed JWT string
 */
export async function mintParticipantToken(
  roomName: string,
  partyId: string,
): Promise<string> {
  const { apiKey, apiSecret } = getLiveKitConfig();

  const token = new AccessToken(apiKey, apiSecret, {
    identity: `caller:${partyId}`,
    ttl: TOKEN_TTL_SECONDS,
  });

  const grant: VideoGrant = {
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };
  token.addGrant(grant);

  return token.toJwt();
}

// ── Room creation ────────────────────────────────────────────────────────────

/**
 * Explicitly creates the LiveKit room ahead of the caller joining so room
 * settings (participant cap, idle timeouts) are deterministic for the call.
 *
 * @param roomName - the `call_{ulid}` room to create
 */
export async function createRoom(roomName: string): Promise<void> {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const client = new RoomServiceClient(url, apiKey, apiSecret);

  await client.createRoom({
    name: roomName,
    // A voice call is exactly the caller + the agent.
    maxParticipants: 2,
    // Keep the room open briefly before anyone joins (agent dispatch race) and
    // after the last participant leaves (grace for reconnect).
    emptyTimeout: 60,
    departureTimeout: 20,
  });
}

/**
 * Explicitly deletes a LiveKit room, forcibly disconnecting every participant
 * (the caller and the dispatched agent) and ending the room immediately. Used
 * when the caller hangs up so the agent job is killed at once rather than
 * lingering until the room's `departureTimeout` elapses.
 *
 * @param roomName - the `call_{ulid}` room to delete
 */
export async function deleteRoom(roomName: string): Promise<void> {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const client = new RoomServiceClient(url, apiKey, apiSecret);
  await client.deleteRoom(roomName);
}

// ── Agent dispatch ───────────────────────────────────────────────────────────

/**
 * Dispatches the voice agent into a room via the LiveKit Agents explicit
 * dispatch API, passing the prefetched {@link CallContext} as JSON-stringified
 * job metadata so the agent has the "ring-time" context the instant it joins.
 *
 * The agent must be registered with the matching `agentName`
 * (`LIVEKIT_AGENT_NAME`, default `doe-voice-agent`) for explicit dispatch to
 * resolve. Container-only (Requirement 12.6).
 *
 * @param roomName - the `call_{ulid}` room to dispatch the agent into
 * @param context  - the mirror-only call context, serialised as job metadata
 */
export async function dispatchAgent(
  roomName: string,
  context: CallContext,
): Promise<void> {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const client = new AgentDispatchClient(url, apiKey, apiSecret);

  const agentName = process.env.LIVEKIT_AGENT_NAME || DEFAULT_AGENT_NAME;

  await client.createDispatch(roomName, agentName, {
    metadata: JSON.stringify(context),
  });
}
