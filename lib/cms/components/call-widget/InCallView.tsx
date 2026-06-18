"use client";

/**
 * DOE Voice Surface — in-call UI (task 13.2).
 *
 * The surface shown while a call is connected. Per Req 2.3 it displays:
 *   • connection state,
 *   • a mute / unmute control,
 *   • an end-call control,
 *   • elapsed call time, and
 *   • a listening/speaking indicator driven by agent audio activity.
 *
 * It deliberately does NOT render any transcript (Req 2.4).
 */

import React from "react";
import { ConnectionState } from "livekit-client";
import { Mic, MicOff, PhoneOff } from "lucide-react";

import type { Language } from "../../voice/contracts";
import { AuraVisualizer, type AuraState } from "@/components/voice/AuraVisualizer";
import { callI18n, formatElapsed } from "./strings";

interface InCallViewProps {
  locale: Language;
  connectionState: ConnectionState;
  elapsedMs: number;
  isMuted: boolean;
  isAgentSpeaking: boolean;
  /** The agent's live audio track, used to drive the Aura visualizer. */
  agentAudioTrack?: MediaStreamTrack | null;
  onToggleMute: () => void;
  onEndCall: () => void;
}

function connectionLabel(state: ConnectionState, s: ReturnType<typeof labels>) {
  switch (state) {
    case ConnectionState.Connected:
      return s.connected;
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return s.reconnecting;
    case ConnectionState.Connecting:
      return s.connectingRoom;
    default:
      return s.connectingRoom;
  }
}

function labels(locale: Language) {
  return callI18n[locale];
}

export function InCallView({
  locale,
  connectionState,
  elapsedMs,
  isMuted,
  isAgentSpeaking,
  agentAudioTrack,
  onToggleMute,
  onEndCall,
}: InCallViewProps) {
  const s = callI18n[locale];
  const isConnected = connectionState === ConnectionState.Connected;
  const auraState: AuraState = isAgentSpeaking
    ? "speaking"
    : isConnected
      ? "listening"
      : "connecting";

  return (
    <div
      data-testid="in-call-view"
      className="flex flex-col items-center gap-6 p-6 text-center"
    >
      {/* Connection state */}
      <div
        data-testid="connection-state"
        data-state={connectionState}
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ora-slate"
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            isConnected ? "bg-emerald-500" : "bg-ora-gold animate-pulse"
          }`}
        />
        {connectionLabel(connectionState, labels(locale))}
      </div>

      {/* Listening / speaking indicator — Ora Aura visualizer driven by the
          agent's live audio track (falls back to state when no track yet). */}
      <div
        data-testid="activity-indicator"
        data-speaking={isAgentSpeaking ? "true" : "false"}
        className="flex flex-col items-center gap-3"
      >
        <AuraVisualizer
          size="lg"
          state={auraState}
          speaking={isAgentSpeaking}
          audioTrack={agentAudioTrack ?? null}
          aria-label={isAgentSpeaking ? s.speaking : s.listening}
        />
        <span className="text-sm font-medium text-ora-charcoal">
          {isAgentSpeaking ? s.speaking : s.listening}
        </span>
      </div>

      {/* Elapsed time */}
      <div
        data-testid="elapsed-time"
        aria-label={s.elapsedLabel}
        className="font-mono text-2xl tabular-nums text-ora-charcoal"
      >
        {formatElapsed(elapsedMs)}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          data-testid="mute-button"
          aria-pressed={isMuted}
          aria-label={isMuted ? s.unmute : s.mute}
          onClick={onToggleMute}
          className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
            isMuted
              ? "border-ora-gold bg-ora-gold/10 text-ora-gold-dark"
              : "border-ora-sand bg-ora-white text-ora-charcoal hover:bg-ora-cream"
          }`}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          type="button"
          data-testid="end-call-button"
          aria-label={s.endCall}
          onClick={onEndCall}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-ora-white transition-colors hover:bg-red-700"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
