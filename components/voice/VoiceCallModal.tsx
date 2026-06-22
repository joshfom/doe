'use client';

// ── Voice call modal ──────────────────────────────────────────────────────────
// The on-demand voice experience opened from a chat composer's voice button.
//
// Two entry paths:
//   • lead  — PreCallForm captures the minimal validated input
//             (phone/email/consent) before the call starts.
//   • staff — an authenticated operator talking to their twin. There is no
//             lead to capture, so the form is skipped: we read the signed-in
//             identity from `GET /api/auth/session` and connect directly.
//
// Both paths then hand a typed `CreateVoiceSessionInput` to VoiceCallSession,
// which owns the in-call lifecycle (Ora Aura visualizer, mute/end, teardown).
// This module is loaded lazily (next/dynamic) by VoiceCallButton, so the heavy
// LiveKit / framer-motion / intl-tel-input dependencies only load when a user
// actually starts a call — not on every chat render.

import { useEffect, useState } from 'react';
import { Loader2, Phone, Sparkles } from 'lucide-react';
import { PreCallForm } from '@/lib/cms/components/call-widget';
import { VoiceCallSession } from '@/lib/cms/components/call-widget/VoiceCallSession';
import type { CreateVoiceSessionInput, Language } from '@/lib/cms/voice/contracts';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface VoiceCallModalProps {
  locale: Language;
  /** Source tag attached to the session (analytics / attribution). */
  page?: string;
  /** `lead` opens the pre-call form; `staff` connects directly. */
  mode?: 'lead' | 'staff';
  /** Optional heading shown above the intro notice / connecting state. */
  title?: string;
  /**
   * A short prototype/recording-style notice shown FIRST (staff mode only).
   * The operator reads it and taps "Start" before the call connects.
   */
  introNotice?: string;
  onClose: () => void;
}

export function VoiceCallModal({
  locale,
  page,
  mode = 'lead',
  title,
  introNotice,
  onClose,
}: VoiceCallModalProps) {
  const [input, setInput] = useState<CreateVoiceSessionInput | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  // When an intro notice is set, the staff call waits for the operator to
  // acknowledge it before we resolve the session and connect.
  const [acknowledged, setAcknowledged] = useState(!introNotice);
  const isRtl = locale === 'ar';
  const isStaff = mode === 'staff';

  // Staff path: once any intro notice is acknowledged, resolve the signed-in
  // identity and build the session input directly — no form. Failures surface
  // a small retry-able error overlay.
  useEffect(() => {
    if (!isStaff || input || !acknowledged) return;
    let cancelled = false;
    setStaffError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/session`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('not authenticated');
        const json = (await res.json()) as { data?: { email?: string; name?: string } } | null;
        const email = json?.data?.email?.trim();
        const name = json?.data?.name?.trim();
        if (!email) throw new Error('no session email');
        if (cancelled) return;
        setInput({
          email,
          consent: true,
          staff: true,
          page: page ?? 'ora-panel-staff',
          ...(name ? { name } : {}),
        });
      } catch {
        if (!cancelled) {
          setStaffError("We couldn't start your call. Please make sure you're signed in.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff, input, page, acknowledged]);

  // Step 0 (staff + intro) — the prototype notice, shown before we connect.
  if (isStaff && introNotice && !acknowledged) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-ora-charcoal/60 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="relative w-full max-w-lg overflow-hidden rounded-[2rem] bg-gradient-to-b from-ora-cream-light via-ora-white to-ora-ocean/15 p-8 shadow-ora-lg ring-1 ring-ora-sand/40 sm:p-10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ora-gold/15 text-ora-gold-dark">
              <Sparkles className="h-5 w-5 stroke-[1.5]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ora-charcoal">
                {title ?? 'Voice agent'}
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ora-gold-dark">
                Prototype preview
              </span>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-ora-charcoal-light">{introNotice}</p>
          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-ora-charcoal-light transition-colors hover:text-ora-charcoal"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => setAcknowledged(true)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-ora-charcoal px-5 text-sm font-medium text-ora-white transition-colors hover:bg-[#1f1f1f]"
            >
              <Phone className="h-4 w-4 stroke-[1.5]" />
              Start talking
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1 (lead only) — collect the validated pre-call input.
  if (!input && !isStaff) {
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

  // Step 1 (staff) — a brief connecting / error overlay while we resolve the
  // signed-in identity, shown in the same soft-gradient shell as the live call.
  if (!input && isStaff) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-ora-charcoal/60 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="relative w-full max-w-lg overflow-hidden rounded-[2rem] bg-gradient-to-b from-ora-cream-light via-ora-white to-ora-ocean/15 p-10 text-center shadow-ora-lg ring-1 ring-ora-sand/40"
          onClick={(e) => e.stopPropagation()}
        >
          {staffError ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ora-sand/40 text-ora-charcoal">
                <Phone className="h-5 w-5 stroke-[1.5]" />
              </div>
              <p className="text-sm text-ora-charcoal">{staffError}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 text-sm font-medium text-ora-gold-dark underline underline-offset-2 hover:text-ora-charcoal"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-ora-gold" aria-hidden />
              <p className="text-sm font-medium text-ora-charcoal">
                {title ? `Connecting you to ${title.toLowerCase()}…` : 'Connecting you to your twin…'}
              </p>
            </>
          )}
        </div>
      </div>
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
        <VoiceCallSession input={input!} locale={locale} onClose={onClose} />
      </div>
    </div>
  );
}

export default VoiceCallModal;
