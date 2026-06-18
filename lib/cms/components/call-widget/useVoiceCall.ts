"use client";

/**
 * DOE Voice Surface — call lifecycle hook (task 13.2).
 *
 * `useVoiceCall` owns the entire in-call lifecycle for the call widget. Given a
 * validated pre-call form (from task 13.1) it:
 *
 *   1. Requests microphone permission, surfacing a `mic-denied` error if the
 *      browser refuses (Req 2.5).
 *   2. POSTs to `/api/voice/sessions`, surfacing a `token-failure` error if the
 *      request fails (Req 2.6).
 *   3. Joins the LiveKit room with `livekit-client`, attaching the agent's
 *      audio so the caller can hear it (Req 2.2).
 *   4. Waits for the agent to join; if it does not within 6 seconds it surfaces
 *      an `agent-timeout` error (Req 2.7).
 *   5. While connected, tracks connection state, mute state, elapsed time, and
 *      a listening/speaking indicator driven by agent audio activity (Req 2.3).
 *      The transcript is never exposed (Req 2.4).
 *   6. On end, disconnects and fetches `GET /api/voice/sessions/:id` to drive
 *      the thank-you card from any booking made in-call (Req 2.8).
 *
 * The LiveKit SDK is the only browser-only dependency; tests mock
 * `livekit-client` and `navigator.mediaDevices`/`fetch` so the lifecycle runs
 * without live credentials ([creds: LiveKit]).
 *
 * Design references: §7.1, §8.1, Error Handling. Requirements: 2.1–2.8.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type Participant,
} from "livekit-client";

import type {
  CreateVoiceSessionInput,
  GetVoiceSessionResult,
  Language,
} from "../../voice/contracts";
import { AGENT_JOIN_TIMEOUT_MS, type CallErrorKind, type CallPhase } from "./strings";

// ── Public shape ─────────────────────────────────────────────────────────────

export interface UseVoiceCallOptions {
  locale: Language;
}

export interface VoiceCallState {
  phase: CallPhase;
  errorKind: CallErrorKind | null;
  /** Live LiveKit connection state, or "disconnected" before any room exists. */
  connectionState: ConnectionState;
  /** Elapsed in-call time in milliseconds (0 until the agent joins). */
  elapsedMs: number;
  isMuted: boolean;
  /** True while the agent (a remote participant) is the active speaker. */
  isAgentSpeaking: boolean;
  /**
   * The agent's live audio track, exposed so the in-call surface can drive a
   * real-amplitude visualizer. Null until the agent's audio is subscribed.
   */
  agentAudioTrack: MediaStreamTrack | null;
  /** The conversation id used for the thank-you lookup, when known. */
  conversationId: string | null;
  /** Thank-you payload from `GET /api/voice/sessions/:id`, when fetched. */
  thankYou: GetVoiceSessionResult | null;
}

export interface VoiceCallControls {
  start: (input: CreateVoiceSessionInput) => Promise<void>;
  toggleMute: () => Promise<void>;
  endCall: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

export type UseVoiceCallReturn = VoiceCallState & VoiceCallControls;

interface SessionResponse {
  roomName: string;
  token: string;
  livekitUrl: string;
  conversationId?: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useVoiceCall(_options: UseVoiceCallOptions): UseVoiceCallReturn {
  const [phase, setPhaseState] = useState<CallPhase>("idle");
  const [errorKind, setErrorKind] = useState<CallErrorKind | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [agentAudioTrack, setAgentAudioTrack] =
    useState<MediaStreamTrack | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thankYou, setThankYou] = useState<GetVoiceSessionResult | null>(null);

  // Refs mirror state for use inside SDK event callbacks (avoid stale closures).
  const phaseRef = useRef<CallPhase>("idle");
  const isMutedRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const lastInputRef = useRef<CreateVoiceSessionInput | null>(null);
  const roomRef = useRef<Room | null>(null);
  /** The `call_{ulid}` room name, so hang-up can ask the server to tear it down. */
  const roomNameRef = useRef<string | null>(null);
  const agentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef = useRef<number>(0);
  const audioElsRef = useRef<HTMLMediaElement[]>([]);
  const mountedRef = useRef(true);

  const setPhase = useCallback((next: CallPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // ── Timers ─────────────────────────────────────────────────────────────────

  const clearAgentTimeout = useCallback(() => {
    if (agentTimeoutRef.current) {
      clearTimeout(agentTimeoutRef.current);
      agentTimeoutRef.current = null;
    }
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    callStartRef.current = Date.now();
    setElapsedMs(0);
    stopElapsedTimer();
    elapsedTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      setElapsedMs(Date.now() - callStartRef.current);
    }, 500);
  }, [stopElapsedTimer]);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  const detachAudio = useCallback(() => {
    for (const el of audioElsRef.current) {
      try {
        el.remove();
      } catch {
        /* element may already be detached */
      }
    }
    audioElsRef.current = [];
    if (mountedRef.current) setAgentAudioTrack(null);
  }, []);

  const teardownRoom = useCallback(async () => {
    clearAgentTimeout();
    stopElapsedTimer();
    detachAudio();
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      // Stop the local microphone explicitly BEFORE disconnecting so the
      // browser/OS "mic in use" indicator clears immediately. `disconnect()`
      // alone does not always stop an already-published local track, which is
      // what left the mic busy after hang-up.
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* no-op */
      }
      try {
        room.localParticipant.trackPublications.forEach((pub) => {
          try {
            pub.track?.stop();
          } catch {
            /* track already stopped */
          }
        });
      } catch {
        /* no publications */
      }
      try {
        room.removeAllListeners();
      } catch {
        /* no-op */
      }
      try {
        await room.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }, [clearAgentTimeout, stopElapsedTimer, detachAudio]);

  // Ask the server to tear the call down (delete the LiveKit room → kill the
  // agent at once, and finalize a never-connected conversation). Best-effort:
  // a failure here never blocks the local hang-up.
  const endServerSession = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/voice/sessions/${encodeURIComponent(id)}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: roomNameRef.current }),
        keepalive: true,
      });
    } catch {
      /* best-effort */
    }
  }, []);

  const fail = useCallback(
    async (kind: CallErrorKind) => {
      await teardownRoom();
      void endServerSession();
      if (!mountedRef.current) return;
      setErrorKind(kind);
      setIsAgentSpeaking(false);
      setPhase("error");
    },
    [teardownRoom, setPhase, endServerSession]
  );

  // ── Agent presence ──────────────────────────────────────────────────────

  const handleAgentPresent = useCallback(() => {
    if (phaseRef.current === "in-call") return;
    clearAgentTimeout();
    if (!mountedRef.current) return;
    setPhase("in-call");
    startElapsedTimer();
  }, [clearAgentTimeout, setPhase, startElapsedTimer]);

  // ── End call ──────────────────────────────────────────────────────────────

  const endCall = useCallback(async () => {
    if (phaseRef.current === "ending" || phaseRef.current === "ended") return;
    if (phaseRef.current === "error" || phaseRef.current === "idle") return;
    setPhase("ending");
    await teardownRoom();
    // Tell the server to delete the room (kills the agent now) and finalize the
    // conversation, so hang-up actually ends the call end-to-end.
    await endServerSession();

    // Fetch the session summary for the thank-you card (Req 2.8). Best-effort:
    // if no conversation id is known or the fetch fails, fall back to a generic
    // thank-you (the card renders without a booking).
    let summary: GetVoiceSessionResult | null = null;
    const id = conversationIdRef.current;
    if (id) {
      try {
        const res = await fetch(
          `/api/voice/sessions/${encodeURIComponent(id)}`
        );
        if (res.ok) {
          summary = (await res.json()) as GetVoiceSessionResult;
        }
      } catch {
        /* keep generic thank-you */
      }
    }
    if (!mountedRef.current) return;
    setThankYou(summary);
    setIsAgentSpeaking(false);
    setPhase("ended");
  }, [setPhase, teardownRoom, endServerSession]);

  // ── Connect to LiveKit ──────────────────────────────────────────────────

  const connect = useCallback(
    async (session: SessionResponse) => {
      setPhase("connecting");
      // Defensive: never leave a prior room connected. If a previous attempt
      // created a room (e.g. a rapid retry), tear it down before opening a new
      // one so two agents can never play into the page at once (echo).
      if (roomRef.current) {
        const stale = roomRef.current;
        roomRef.current = null;
        try {
          stale.removeAllListeners();
          await stale.disconnect();
        } catch {
          /* already gone */
        }
        detachAudio();
      }
      const room = new Room();
      roomRef.current = room;
      roomNameRef.current = session.roomName ?? null;

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (mountedRef.current) setConnectionState(state);
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        handleAgentPresent();
      });
      room.on(
        RoomEvent.ActiveSpeakersChanged,
        (speakers: Participant[]) => {
          if (!mountedRef.current) return;
          // Listening/speaking indicator is driven purely by agent (remote)
          // audio activity — the local caller is excluded (Req 2.3).
          setIsAgentSpeaking(speakers.some((p) => !p.isLocal));
        }
      );
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.style.display = "none";
          document.body.appendChild(el);
          audioElsRef.current.push(el);
          // Expose the raw MediaStreamTrack so the in-call surface can run a
          // real-amplitude visualizer alongside the audio element playback.
          if (mountedRef.current) {
            setAgentAudioTrack(track.mediaStreamTrack ?? null);
          }
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio && mountedRef.current) {
          setAgentAudioTrack(null);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        // A drop while talking ends the call gracefully (not an error card).
        if (
          phaseRef.current === "in-call" ||
          phaseRef.current === "waiting-for-agent"
        ) {
          void endCall();
        }
      });

      try {
        await room.connect(session.livekitUrl, session.token);
      } catch {
        // A failed join is treated as a token failure (Req 2.6).
        await fail("token-failure");
        return;
      }

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (mountedRef.current) setIsMuted(false);
        isMutedRef.current = false;
      } catch {
        /* mic was granted above; publishing failure is non-fatal here */
      }

      // The agent may already be in the room by the time we connect.
      if (room.remoteParticipants && room.remoteParticipants.size > 0) {
        handleAgentPresent();
        return;
      }

      if (!mountedRef.current) return;
      setPhase("waiting-for-agent");
      clearAgentTimeout();
      agentTimeoutRef.current = setTimeout(() => {
        if (phaseRef.current === "waiting-for-agent") {
          void fail("agent-timeout");
        }
      }, AGENT_JOIN_TIMEOUT_MS);
    },
    [setPhase, handleAgentPresent, clearAgentTimeout, endCall, fail, detachAudio]
  );

  // ── Start ───────────────────────────────────────────────────────────────

  const start = useCallback(
    async (input: CreateVoiceSessionInput) => {
      lastInputRef.current = input;
      // Reset any prior error/thank-you so retry starts clean.
      setErrorKind(null);
      setThankYou(null);
      setElapsedMs(0);
      setIsAgentSpeaking(false);

      // 1) Microphone permission (Req 2.5). We acquire then immediately stop the
      //    probe tracks; LiveKit re-acquires the mic on connect without a second
      //    prompt because permission is already granted.
      setPhase("requesting-mic");
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch {
        await fail("mic-denied");
        return;
      }

      // 2) Create the voice session (Req 2.1, 2.6).
      setPhase("creating-session");
      let session: SessionResponse;
      try {
        const res = await fetch("/api/voice/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(`session request failed: ${res.status}`);
        session = (await res.json()) as SessionResponse;
        if (!session?.token || !session?.livekitUrl) {
          throw new Error("malformed session response");
        }
      } catch {
        await fail("token-failure");
        return;
      }

      if (session.conversationId) {
        conversationIdRef.current = session.conversationId;
        if (mountedRef.current) setConversationId(session.conversationId);
      }

      // 3) Join the room (Req 2.2) and wait for the agent (Req 2.7).
      await connect(session);
    },
    [setPhase, fail, connect]
  );

  const retry = useCallback(async () => {
    const input = lastInputRef.current;
    if (!input) return;
    await start(input);
  }, [start]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !isMutedRef.current;
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      isMutedRef.current = nextMuted;
      if (mountedRef.current) setIsMuted(nextMuted);
    } catch {
      /* leave mute state unchanged on failure */
    }
  }, []);

  const reset = useCallback(() => {
    void teardownRoom();
    conversationIdRef.current = null;
    lastInputRef.current = null;
    isMutedRef.current = false;
    if (!mountedRef.current) return;
    setConversationId(null);
    setThankYou(null);
    setErrorKind(null);
    setElapsedMs(0);
    setIsMuted(false);
    setIsAgentSpeaking(false);
    setConnectionState(ConnectionState.Disconnected);
    setPhase("idle");
  }, [teardownRoom, setPhase]);

  // Cleanup on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAgentTimeout();
      stopElapsedTimer();
      detachAudio();
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        try {
          room.localParticipant.trackPublications.forEach((pub) => {
            try {
              pub.track?.stop();
            } catch {
              /* already stopped */
            }
          });
        } catch {
          /* no publications */
        }
        try {
          room.removeAllListeners();
        } catch {
          /* no-op */
        }
        void room.disconnect();
      }
      // If the widget unmounts mid-call (tab close / navigate away) without an
      // explicit hang-up, still tell the server to tear the room down so the
      // agent isn't orphaned. `sendBeacon`/keepalive survives the unload.
      const id = conversationIdRef.current;
      if (id) {
        const url = `/api/voice/sessions/${encodeURIComponent(id)}/end`;
        const payload = JSON.stringify({ roomName: roomNameRef.current });
        try {
          if (typeof navigator !== "undefined" && navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
          } else {
            void fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              keepalive: true,
            }).catch(() => {
              /* best-effort; ignore (e.g. no base URL under test) */
            });
          }
        } catch {
          /* best-effort */
        }
      }
    };
  }, [clearAgentTimeout, stopElapsedTimer, detachAudio]);

  return {
    phase,
    errorKind,
    connectionState,
    elapsedMs,
    isMuted,
    isAgentSpeaking,
    agentAudioTrack,
    conversationId,
    thankYou,
    start,
    toggleMute,
    endCall,
    retry,
    reset,
  };
}
