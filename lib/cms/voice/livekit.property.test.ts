/**
 * @vitest-environment node
 *
 * The LiveKit SDK signs JWTs with `jose`, which requires real Node
 * `Uint8Array`s. The repo-wide default jsdom environment supplies a
 * cross-realm `Uint8Array` that fails jose's `instanceof` check, so this file
 * opts into the node environment.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import {
  mintParticipantToken,
  generateRoomName,
  ulid,
  TOKEN_TTL_SECONDS,
} from "@/lib/cms/voice/livekit";

/**
 * Property test for LiveKit token scoping (task 7.2).
 *
 * Property 11: LiveKit token scoping — every minted participant token carries
 * identity `caller:{partyId}`, a video grant scoped to exactly the
 * `call_{ulid}` room (`roomJoin: true`), and a TTL of at most 10 minutes.
 *
 * **Validates: Requirements 3.6, 14.4**
 *
 * Approach (no mocking): `mintParticipantToken` produces a real JWT via the
 * installed `livekit-server-sdk` `AccessToken`. Rather than mock the SDK, we
 * sign with dummy credentials set in `beforeAll` and DECODE the resulting JWT
 * (split on '.', base64url-decode the payload, `JSON.parse`). This verifies the
 * actual SDK output — `sub` (identity), the `video` grant, and the `exp` / `iat`
 * (or `nbf`) timestamps — against the security invariant directly.
 */

// Reduced fast-check budget per the performance directive: signing is real work
// (HMAC over JWT), so keep run counts small for speed.
const NUM_RUNS = 25;

interface DecodedTokenPayload {
  sub?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  video?: {
    roomJoin?: boolean;
    room?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Decode the payload (middle segment) of a JWT without verifying its signature. */
function decodeJwtPayload(jwt: string): DecodedTokenPayload {
  const parts = jwt.split(".");
  expect(parts).toHaveLength(3);
  const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payloadJson) as DecodedTokenPayload;
}

beforeAll(() => {
  // Dummy credentials so the real AccessToken can sign without external creds.
  // The secret must be reasonably long for the underlying HMAC key. `getLiveKitConfig`
  // also requires LIVEKIT_URL even though token minting itself does not use it.
  process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = "devsecretdevsecretdevsecret32chars";
});

describe("Feature: doe-voice-surface, Property 11: LiveKit token scoping", () => {
  it("minted tokens carry identity caller:{partyId}, a grant scoped to the room, and TTL <= 10 min", async () => {
    // partyIds are uuids in practice, but allow arbitrary non-empty strings too.
    const partyIdArb = fc.oneof(
      fc.uuid(),
      fc.string({ minLength: 1, maxLength: 64 }),
    );

    // Room names follow `call_{ulid}`; generate via the real helpers so we test
    // the exact shape the session service produces.
    const roomNameArb = fc.oneof(
      fc.constant(null).map(() => generateRoomName()),
      fc.integer({ min: 0, max: 2_000_000_000_000 }).map((t) => `call_${ulid(t)}`),
    );

    await fc.assert(
      fc.asyncProperty(partyIdArb, roomNameArb, async (partyId, roomName) => {
        const jwt = await mintParticipantToken(roomName, partyId);
        const payload = decodeJwtPayload(jwt);

        // Identity is `caller:{partyId}`.
        expect(payload.sub).toBe(`caller:${partyId}`);

        // Grant scoped to exactly the supplied room, join-only.
        expect(payload.video).toBeDefined();
        expect(payload.video?.room).toBe(roomName);
        expect(payload.video?.roomJoin).toBe(true);

        // TTL = exp - (iat ?? nbf) is positive and at most 10 minutes.
        const start = payload.iat ?? payload.nbf;
        expect(typeof payload.exp).toBe("number");
        expect(typeof start).toBe("number");
        const ttl = (payload.exp as number) - (start as number);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(TOKEN_TTL_SECONDS);
        expect(TOKEN_TTL_SECONDS).toBeLessThanOrEqual(600);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
