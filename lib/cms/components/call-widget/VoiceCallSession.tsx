"use client";

/**
 * DOE Voice Surface — in-call session container (task 13.2).
 *
 * Wires the {@link useVoiceCall} lifecycle hook to the connecting / in-call /
 * error / thank-you surfaces. The pre-call form (task 13.1) renders this once
 * the caller submits a valid form, passing the captured fields as `input`; the
 * session auto-starts on mount (POST → join → wait for agent).
 *
 * Design references: §7.1, §8.1, Error Handling. Requirements: 2.1–2.8.
 */

import React, { useEffect, useRef } from "react";
import { Loader } from "lucide-react";

import type { CreateVoiceSessionInput, Language } from "../../voice/contracts";
import { useVoiceCall } from "./useVoiceCall";
import { CONNECTING_PHASES, callI18n } from "./strings";
import { InCallView } from "./InCallView";
import { CallErrorCard } from "./CallErrorCard";
import { ThankYouCard } from "./ThankYouCard";

export interface VoiceCallSessionProps {
  /** The validated pre-call form fields (from task 13.1). */
  input: CreateVoiceSessionInput;
  locale: Language;
  /** Optional callback invoked when the caller dismisses the ended/error view. */
  onClose?: () => void;
}

function connectingLabel(phase: string, locale: Language): string {
  const s = callI18n[locale];
  switch (phase) {
    case "requesting-mic":
      return s.connectingMic;
    case "creating-session":
      return s.connectingSession;
    case "waiting-for-agent":
      return s.waitingForAgent;
    case "connecting":
    default:
      return s.connectingRoom;
  }
}

export function VoiceCallSession({
  input,
  locale,
  onClose,
}: VoiceCallSessionProps) {
  const call = useVoiceCall({ locale });
  const { start } = call;

  // Auto-start the lifecycle exactly once on mount (the form has already
  // validated and submitted the input). The `startedRef` guard is essential:
  // `start` is async (it awaits mic permission and the POST before a Room is
  // created), and React StrictMode double-invokes mount effects in development.
  // Without the guard the second invocation would race the first and create a
  // SECOND voice session — two agents would join, and the caller would hear the
  // AI twice with a slight offset (an echo). The guard makes start idempotent.
  const startedRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start(input);
  }, []);

  const isRtl = locale === "ar";

  return (
    <div
      data-testid="voice-call-session"
      data-phase={call.phase}
      dir={isRtl ? "rtl" : "ltr"}
      className="flex min-h-[26rem] w-full flex-col justify-center bg-transparent"
    >
      {CONNECTING_PHASES.has(call.phase) && (
        <div
          data-testid="call-connecting"
          className="flex flex-col items-center gap-4 p-8 text-center"
        >
          <Loader className="h-8 w-8 animate-spin text-ora-gold" aria-hidden />
          <p className="text-sm font-medium text-ora-charcoal">
            {connectingLabel(call.phase, locale)}
          </p>
        </div>
      )}

      {call.phase === "in-call" && (
        <InCallView
          locale={locale}
          connectionState={call.connectionState}
          elapsedMs={call.elapsedMs}
          isMuted={call.isMuted}
          isAgentSpeaking={call.isAgentSpeaking}
          agentAudioTrack={call.agentAudioTrack}
          onToggleMute={() => void call.toggleMute()}
          onEndCall={() => void call.endCall()}
        />
      )}

      {call.phase === "ending" && (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <Loader className="h-8 w-8 animate-spin text-ora-gold" aria-hidden />
        </div>
      )}

      {call.phase === "error" && call.errorKind && (
        <CallErrorCard
          kind={call.errorKind}
          locale={locale}
          onRetry={() => void call.retry()}
        />
      )}

      {call.phase === "ended" && (
        <div className="flex flex-col items-center gap-2">
          <ThankYouCard locale={locale} result={call.thankYou} />
          {onClose && (
            <button
              type="button"
              data-testid="call-close-button"
              onClick={onClose}
              className="mb-4 text-sm font-medium text-ora-gold-dark underline underline-offset-2 hover:text-ora-charcoal"
            >
              {locale === "ar" ? "إغلاق" : "Close"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
