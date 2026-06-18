'use client';

// ── Demo Console: live voice Aura ─────────────────────────────────────────────
// The C-level Demo Console is a read-only second screen fed only by the SSE
// event stream — there is no audio track here. So we drive the shared Ora Aura
// visualizer from the event log instead: it pulses "speaking" briefly each time
// a new `turn.appended` arrives, shows "listening" while a call is connected,
// and rests otherwise. It sits beside the live Transcript so a non-technical
// viewer can watch the conversation breathe in real time. (Design §7.6)

import { useEffect, useMemo, useState } from 'react';
import { AuraVisualizer, type AuraState } from '@/components/voice/AuraVisualizer';
import type { DoeEvent } from './types';

/** How long the orb stays in the "speaking" state after a turn arrives. */
const SPEAKING_HOLD_MS = 2600;

export function ConsoleAura({ events }: { events: DoeEvent[] }) {
  // Id of the most recent transcript turn — changes whenever the agent speaks.
  const lastTurnId = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === 'turn.appended') return events[i]!.id;
    }
    return null;
  }, [events]);

  // Whether a call is currently in progress (connected and not yet ended).
  const callActive = useMemo(() => {
    let active = false;
    for (const e of events) {
      if (e.type === 'call.connected' || e.type === 'session.created') active = true;
      else if (e.type === 'call.ended') active = false;
    }
    return active;
  }, [events]);

  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!lastTurnId) return;
    setSpeaking(true);
    const timer = setTimeout(() => setSpeaking(false), SPEAKING_HOLD_MS);
    return () => clearTimeout(timer);
  }, [lastTurnId]);

  const state: AuraState = !callActive
    ? 'connecting'
    : speaking
      ? 'speaking'
      : 'listening';

  const label = !callActive ? 'Idle' : speaking ? 'Agent speaking' : 'Listening';

  return (
    <div
      data-testid="console-aura"
      data-state={state}
      className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-ora-cream-light to-ora-ocean/15 px-3 py-1.5 ring-1 ring-ora-sand/40"
    >
      <AuraVisualizer size="sm" state={state} speaking={speaking} aria-label={label} />
      <div className="leading-tight">
        <p className="text-xs font-medium uppercase tracking-wide text-ora-charcoal">
          Live Voice
        </p>
        <p className="text-xs text-ora-charcoal-light">{label}</p>
      </div>
    </div>
  );
}

export default ConsoleAura;
