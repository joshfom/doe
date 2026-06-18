/**
 * DOE Voice Surface — call widget shared types and i18n strings.
 *
 * The in-call lifecycle (task 13.2) is modelled as an explicit phase machine so
 * the UI can render the right surface for every state and so the lifecycle is
 * unit-testable without a live LiveKit connection (the SDK is mocked in tests).
 *
 * Design references: §7.1 (call widget), §8.1 (thank-you lookup), Error
 * Handling. Requirements: 2.2–2.8.
 */

import type { Language } from "../../voice/contracts";

// ── Lifecycle phases ─────────────────────────────────────────────────────────

/**
 * The call lifecycle as a finite set of phases. The widget transitions:
 *
 *   idle
 *     → requesting-mic      (navigator.mediaDevices.getUserMedia)
 *     → creating-session    (POST /api/voice/sessions)
 *     → connecting          (livekit-client Room.connect)
 *     → waiting-for-agent   (connected; agent has ≤ 6s to join — Req 2.7)
 *     → in-call             (agent joined; controls + indicators active)
 *     → ending              (Room.disconnect + GET /api/voice/sessions/:id)
 *     → ended               (thank-you card)
 *
 * Any failing transition lands on `error` with a {@link CallErrorKind}.
 */
export type CallPhase =
  | "idle"
  | "requesting-mic"
  | "creating-session"
  | "connecting"
  | "waiting-for-agent"
  | "in-call"
  | "ending"
  | "ended"
  | "error";

/**
 * The three recoverable error classes the widget must surface as graceful cards
 * with a retry option (Req 2.5, 2.6, 2.7). A failed `Room.connect` is treated
 * as a `token-failure` (the credential could not be used to join the room).
 */
export type CallErrorKind = "mic-denied" | "token-failure" | "agent-timeout";

/** Milliseconds the agent has to join the room before the call times out. */
export const AGENT_JOIN_TIMEOUT_MS = 6000;

/** Phases during which connection feedback (spinner) is shown. */
export const CONNECTING_PHASES: ReadonlySet<CallPhase> = new Set([
  "requesting-mic",
  "creating-session",
  "connecting",
  "waiting-for-agent",
]);

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format an elapsed duration (milliseconds) as `m:ss` (or `h:mm:ss` past an
 * hour). Negative or non-finite values clamp to `0:00`.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    const mm = minutes.toString().padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

// ── i18n ─────────────────────────────────────────────────────────────────────

export interface CallStrings {
  connectingMic: string;
  connectingSession: string;
  connectingRoom: string;
  waitingForAgent: string;
  connected: string;
  reconnecting: string;
  listening: string;
  speaking: string;
  mute: string;
  unmute: string;
  endCall: string;
  retry: string;
  elapsedLabel: string;
  errorMicTitle: string;
  errorMicBody: string;
  errorTokenTitle: string;
  errorTokenBody: string;
  errorTimeoutTitle: string;
  errorTimeoutBody: string;
  fallback: string;
  thankYouTitle: string;
  thankYouBody: string;
  bookingConfirmedTitle: string;
  bookingConfirmedBody: string;
  bookingReference: string;
}

export const callI18n: Record<Language, CallStrings> = {
  en: {
    connectingMic: "Checking your microphone…",
    connectingSession: "Setting up your call…",
    connectingRoom: "Connecting…",
    waitingForAgent: "Connecting you to DOE…",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    listening: "Listening",
    speaking: "DOE is speaking",
    mute: "Mute microphone",
    unmute: "Unmute microphone",
    endCall: "End call",
    retry: "Try again",
    elapsedLabel: "Call duration",
    errorMicTitle: "Microphone access needed",
    errorMicBody:
      "We couldn't access your microphone. Please allow microphone access in your browser and try again.",
    errorTokenTitle: "Couldn't start the call",
    errorTokenBody:
      "We couldn't connect you right now. Please try again in a moment.",
    errorTimeoutTitle: "No one picked up",
    errorTimeoutBody:
      "DOE didn't join in time. Please try again, and we'll get you connected.",
    fallback:
      "If the problem continues, leave your details and the team will call you back.",
    thankYouTitle: "Thanks for calling DOE",
    thankYouBody: "We've noted your interest and a specialist will follow up.",
    bookingConfirmedTitle: "Your viewing is booked",
    bookingConfirmedBody: "We've scheduled your viewing. Details are below.",
    bookingReference: "Reference",
  },
  ar: {
    connectingMic: "جارٍ التحقق من الميكروفون…",
    connectingSession: "جارٍ إعداد مكالمتك…",
    connectingRoom: "جارٍ الاتصال…",
    waitingForAgent: "جارٍ توصيلك بـ DOE…",
    connected: "متصل",
    reconnecting: "جارٍ إعادة الاتصال…",
    listening: "يستمع",
    speaking: "DOE يتحدث",
    mute: "كتم الميكروفون",
    unmute: "إلغاء كتم الميكروفون",
    endCall: "إنهاء المكالمة",
    retry: "حاول مرة أخرى",
    elapsedLabel: "مدة المكالمة",
    errorMicTitle: "نحتاج إذن الميكروفون",
    errorMicBody:
      "تعذّر الوصول إلى الميكروفون. يرجى السماح بالوصول إلى الميكروفون في متصفحك والمحاولة مرة أخرى.",
    errorTokenTitle: "تعذّر بدء المكالمة",
    errorTokenBody: "تعذّر توصيلك الآن. يرجى المحاولة مرة أخرى بعد قليل.",
    errorTimeoutTitle: "لم يردّ أحد",
    errorTimeoutBody:
      "لم ينضمّ DOE في الوقت المناسب. يرجى المحاولة مرة أخرى وسنوصلك.",
    fallback: "إذا استمرت المشكلة، اترك بياناتك وسيتصل بك الفريق.",
    thankYouTitle: "شكراً لاتصالك بـ DOE",
    thankYouBody: "لقد سجّلنا اهتمامك وسيتواصل معك أحد المختصين.",
    bookingConfirmedTitle: "تم حجز معاينتك",
    bookingConfirmedBody: "لقد جدولنا معاينتك. التفاصيل أدناه.",
    bookingReference: "المرجع",
  },
};

/** Title + body for a given error kind. */
export function errorCopy(
  kind: CallErrorKind,
  s: CallStrings
): { title: string; body: string } {
  switch (kind) {
    case "mic-denied":
      return { title: s.errorMicTitle, body: s.errorMicBody };
    case "token-failure":
      return { title: s.errorTokenTitle, body: s.errorTokenBody };
    case "agent-timeout":
      return { title: s.errorTimeoutTitle, body: s.errorTimeoutBody };
  }
}
