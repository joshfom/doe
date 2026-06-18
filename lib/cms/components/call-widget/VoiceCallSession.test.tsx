import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { CreateVoiceSessionInput } from "../../voice/contracts";

// ── Mock livekit-client with a controllable fake Room ─────────────────────────
//
// [creds: LiveKit] — the SDK is fully mocked so the lifecycle runs without live
// credentials. Tests grab the most-recent FakeRoom from `roomInstances` and
// drive transitions by emitting RoomEvents.

const { roomInstances, FakeRoom, RoomEvent, ConnectionState, Track } =
  vi.hoisted(() => {
    type Handler = (...args: unknown[]) => void;
    const instances: FakeRoomT[] = [];

    class FakeRoomT {
      handlers: Record<string, Handler[]> = {};
      remoteParticipants = new Map<string, unknown>();
      localParticipant = { setMicrophoneEnabled: vi.fn(async () => {}) };
      connect = vi.fn(async () => {});
      disconnect = vi.fn(async () => {});
      removeAllListeners = vi.fn(() => {
        this.handlers = {};
      });
      constructor() {
        instances.push(this);
      }
      on(event: string, cb: Handler) {
        (this.handlers[event] ||= []).push(cb);
        return this;
      }
      emit(event: string, ...args: unknown[]) {
        (this.handlers[event] || []).forEach((cb) => cb(...args));
      }
    }

    const RoomEventLocal = {
      ParticipantConnected: "participantConnected",
      ActiveSpeakersChanged: "activeSpeakersChanged",
      ConnectionStateChanged: "connectionStateChanged",
      Disconnected: "disconnected",
      TrackSubscribed: "trackSubscribed",
    };
    const ConnectionStateLocal = {
      Disconnected: "disconnected",
      Connecting: "connecting",
      Connected: "connected",
      Reconnecting: "reconnecting",
      SignalReconnecting: "signalReconnecting",
    };
    const TrackLocal = { Kind: { Audio: "audio", Video: "video" } };

    return {
      roomInstances: instances,
      FakeRoom: FakeRoomT,
      RoomEvent: RoomEventLocal,
      ConnectionState: ConnectionStateLocal,
      Track: TrackLocal,
    };
  });

vi.mock("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent,
  ConnectionState,
  Track,
}));

// Import AFTER the mock is registered.
import { VoiceCallSession } from "./VoiceCallSession";

// ── Test helpers ─────────────────────────────────────────────────────────────

const INPUT: CreateVoiceSessionInput = {
  phone: "+971500000000",
  email: "caller@example.com",
  name: "Sara",
  consent: true,
  page: "/projects",
};

function mockMic(granted: boolean) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (!granted) throw new Error("Permission denied");
        return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
      }),
    },
  });
}

interface FetchOpts {
  sessionStatus?: number;
  getResult?: unknown;
}

function mockFetch({ sessionStatus = 200, getResult }: FetchOpts = {}) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/api/voice/sessions") && method === "POST") {
        if (sessionStatus !== 200) {
          return new Response("error", { status: sessionStatus });
        }
        return new Response(
          JSON.stringify({
            roomName: "call_x",
            token: "tok-123",
            livekitUrl: "wss://livekit.test",
            conversationId: "conv_1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (u.includes("/api/voice/sessions/")) {
        return new Response(JSON.stringify(getResult ?? { status: "completed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
}

/** Drive the room to the connected/in-call state. */
function room() {
  return roomInstances[roomInstances.length - 1];
}

beforeEach(() => {
  roomInstances.length = 0;
  vi.restoreAllMocks();
  mockMic(true);
});

afterEach(() => {
  // Always restore real timers so a fake-timer test that throws cannot leak
  // into the next test (which would break `waitFor`).
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("VoiceCallSession lifecycle", () => {
  it("posts the form and joins the room, reaching the in-call UI when the agent joins", async () => {
    const fetchSpy = mockFetch();

    render(<VoiceCallSession input={INPUT} locale="en" />);

    // A room is created during connect.
    await waitFor(() => expect(roomInstances.length).toBe(1));

    // The session was created via POST with the form fields (Req 2.1).
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/voice/sessions",
      expect.objectContaining({ method: "POST" })
    );
    expect(room().connect).toHaveBeenCalledWith("wss://livekit.test", "tok-123");

    // Agent joins → in-call UI (Req 2.2, 2.3).
    await act(async () => {
      room().emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected);
      room().emit(RoomEvent.ParticipantConnected, { isLocal: false });
    });

    await waitFor(() =>
      expect(screen.getByTestId("in-call-view")).toBeDefined()
    );
    expect(screen.getByTestId("mute-button")).toBeDefined();
    expect(screen.getByTestId("end-call-button")).toBeDefined();
    expect(screen.getByTestId("elapsed-time")).toBeDefined();
    expect(screen.getByTestId("connection-state")).toBeDefined();

    // No transcript is ever shown to the caller (Req 2.4).
    expect(screen.queryByTestId("transcript")).toBeNull();
  });

  it("drives the listening/speaking indicator from agent audio activity", async () => {
    mockFetch();
    render(<VoiceCallSession input={INPUT} locale="en" />);
    await waitFor(() => expect(roomInstances.length).toBe(1));

    await act(async () => {
      room().emit(RoomEvent.ParticipantConnected, { isLocal: false });
    });
    await waitFor(() => expect(screen.getByTestId("in-call-view")).toBeDefined());

    // Agent (remote, non-local) becomes the active speaker → "speaking".
    await act(async () => {
      room().emit(RoomEvent.ActiveSpeakersChanged, [{ isLocal: false }]);
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("activity-indicator").getAttribute("data-speaking")
      ).toBe("true")
    );

    // Only the local caller speaking → back to "listening".
    await act(async () => {
      room().emit(RoomEvent.ActiveSpeakersChanged, [{ isLocal: true }]);
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("activity-indicator").getAttribute("data-speaking")
      ).toBe("false")
    );
  });

  it("toggles mute through the LiveKit local participant", async () => {
    mockFetch();
    render(<VoiceCallSession input={INPUT} locale="en" />);
    await waitFor(() => expect(roomInstances.length).toBe(1));
    await act(async () => {
      room().emit(RoomEvent.ParticipantConnected, { isLocal: false });
    });
    await waitFor(() => expect(screen.getByTestId("mute-button")).toBeDefined());

    const setMic = room().localParticipant.setMicrophoneEnabled;
    setMic.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByTestId("mute-button"));
    });

    // Muting disables the microphone.
    expect(setMic).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(
        screen.getByTestId("mute-button").getAttribute("aria-pressed")
      ).toBe("true")
    );
  });

  it("ends the call and renders a thank-you card with the booking from GET /sessions/:id", async () => {
    mockFetch({
      getResult: {
        status: "completed",
        summary: "Discussed 2BR options.",
        appointment: {
          id: "appt_1",
          referenceNumber: "DOE-1234",
          appointmentType: "Viewing",
          scheduledDate: "2026-05-10",
          scheduledTime: "14:00",
          status: "confirmed",
          contactName: "Sara",
        },
      },
    });

    render(<VoiceCallSession input={INPUT} locale="en" />);
    await waitFor(() => expect(roomInstances.length).toBe(1));
    await act(async () => {
      room().emit(RoomEvent.ParticipantConnected, { isLocal: false });
    });
    await waitFor(() => expect(screen.getByTestId("end-call-button")).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByTestId("end-call-button"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("call-thank-you-card")).toBeDefined()
    );
    expect(room().disconnect).toHaveBeenCalled();
    const card = screen.getByTestId("call-thank-you-card");
    expect(card.getAttribute("data-has-booking")).toBe("true");
    expect(screen.getByTestId("call-booking-details")).toBeDefined();
    expect(screen.getByText("DOE-1234")).toBeDefined();
  });

  it("shows a mic-denied error card with retry when microphone permission is refused", async () => {
    mockMic(false);
    mockFetch();

    render(<VoiceCallSession input={INPUT} locale="en" />);

    await waitFor(() =>
      expect(screen.getByTestId("call-error-card")).toBeDefined()
    );
    expect(
      screen.getByTestId("call-error-card").getAttribute("data-error-kind")
    ).toBe("mic-denied");
    // No session is created when the mic is denied.
    expect(roomInstances.length).toBe(0);
    expect(screen.getByTestId("call-error-retry")).toBeDefined();
  });

  it("shows a token-failure error card with retry when the session request fails", async () => {
    mockFetch({ sessionStatus: 500 });

    render(<VoiceCallSession input={INPUT} locale="en" />);

    await waitFor(() =>
      expect(screen.getByTestId("call-error-card")).toBeDefined()
    );
    expect(
      screen.getByTestId("call-error-card").getAttribute("data-error-kind")
    ).toBe("token-failure");
    // The room is never joined when the token request fails.
    expect(roomInstances.length).toBe(0);
  });

  it("shows an agent-timeout error card when the agent does not join within 6s", async () => {
    vi.useFakeTimers();
    try {
      mockMic(true);
      mockFetch();

      render(<VoiceCallSession input={INPUT} locale="en" />);

      // Flush the async mic → POST → connect chain under fake timers. `waitFor`
      // relies on timers, so we advance manually instead.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      expect(roomInstances.length).toBe(1);

      // No agent joins; advance past the 6s join timeout (Req 2.7).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6001);
      });

      expect(
        screen.getByTestId("call-error-card").getAttribute("data-error-kind")
      ).toBe("agent-timeout");
      expect(room().disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries from an error card by re-running the lifecycle", async () => {
    // First attempt fails (token), retry succeeds.
    let attempt = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        if (u.includes("/api/voice/sessions") && method === "POST") {
          attempt += 1;
          if (attempt === 1) return new Response("error", { status: 500 });
          return new Response(
            JSON.stringify({
              roomName: "call_x",
              token: "tok-123",
              livekitUrl: "wss://livekit.test",
              conversationId: "conv_1",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("nf", { status: 404 });
      }
    );

    render(<VoiceCallSession input={INPUT} locale="en" />);
    await waitFor(() =>
      expect(screen.getByTestId("call-error-card")).toBeDefined()
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("call-error-retry"));
    });

    await waitFor(() => expect(roomInstances.length).toBe(1));
    await act(async () => {
      room().emit(RoomEvent.ParticipantConnected, { isLocal: false });
    });
    await waitFor(() => expect(screen.getByTestId("in-call-view")).toBeDefined());
  });
});
