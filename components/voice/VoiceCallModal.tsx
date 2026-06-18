'use client';

// ── Voice call modal ──────────────────────────────────────────────────────────
// The on-demand voice experience opened from a chat composer's voice button.
// It reuses the existing call-widget pieces end to end:
//   • PreCallForm     — captures the minimal validated input (phone/email/consent)
//   • VoiceCallSession — the in-call lifecycle: Ora Aura visualizer, mute/end,
//                        and the server-side teardown on hang-up.
// This module is loaded lazily (next/dynamic) by VoiceCallButton, so the heavy
// LiveKit / framer-motion / intl-tel-input dependencies only load when a user
// actually starts a call — not on every chat render.

import { useState } from 'react';
import { PreCallForm } from '@/lib/cms/components/call-widget';
import { VoiceCallSession } from '@/lib/cms/components/call-widget/VoiceCallSession';
import type { CreateVoiceSessionInput, Language } from '@/lib/cms/voice/contracts';

export interface VoiceCallModalProps {
  locale: Language;
  /** Source tag attached to the session (analytics / attribution). */
  page?: string;
  onClose: () => void;
}

export function VoiceCallModal({ locale, page, onClose }: VoiceCallModalProps) {
  const [input, setInput] = useState<CreateVoiceSessionInput | null>(null);
  const isRtl = locale === 'ar';

  // Step 1 — collect the validated pre-call input (its own overlay modal).
  if (!input) {
    return (
      <PreCallForm
        open
        locale={locale}
        page={page}
        onClose={onClose}
        onSubmit={setInput}
      />
    );
  }

  // Step 2 — the live call. Same soft-gradient overlay as the floating widget.
  return (
    <div
      data-testid="voice-call-button-overlay"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ora-charcoal/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-[2rem] bg-gradient-to-b from-ora-cream-light via-ora-white to-ora-ocean/15 shadow-ora-lg ring-1 ring-ora-sand/40"
        onClick={(e) => e.stopPropagation()}
      >
        <VoiceCallSession input={input} locale={locale} onClose={onClose} />
      </div>
    </div>
  );
}

export default VoiceCallModal;
