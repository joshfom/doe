'use client';

// ── Voice call button ─────────────────────────────────────────────────────────
// A compact, composer-friendly button that opens the voice call experience.
// The modal (and its LiveKit/framer-motion/intl-tel-input deps) is code-split
// via next/dynamic, so it loads only when the user actually clicks to talk.

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Language } from '@/lib/cms/voice/contracts';

const VoiceCallModal = dynamic(
  () => import('./VoiceCallModal').then((m) => m.VoiceCallModal),
  { ssr: false },
);

export interface VoiceCallButtonProps {
  /** Call language; defaults to English (the panel surfaces). */
  locale?: Language;
  /** Source tag attached to the session. */
  page?: string;
  /** Visual size to match the host composer. */
  size?: 'sm' | 'md';
  className?: string;
  /**
   * Who is calling:
   *  • `lead`  — public visitor; opens the pre-call form (phone/email/consent).
   *  • `staff` — signed-in operator talking to their twin; skips the form and
   *    connects directly using the authenticated session identity.
   */
  mode?: 'lead' | 'staff';
  /**
   * When set, render a labelled pill button (icon + text) instead of the bare
   * icon — used for prominent entry points like "Ask voice agent".
   */
  label?: string;
  /** Heading shown at the top of the call modal (e.g. "Voice prospecting"). */
  title?: string;
  /**
   * A short prototype/recording-style notice shown FIRST (staff mode only),
   * before the call connects. The operator reads it and taps to start.
   */
  introNotice?: string;
}

export function VoiceCallButton({
  locale = 'en',
  page,
  size = 'md',
  className,
  mode = 'lead',
  label,
  title,
  introNotice,
}: VoiceCallButtonProps) {
  const [open, setOpen] = useState(false);

  const isStaff = mode === 'staff';
  const defaultAria = isStaff ? 'Talk to your twin' : 'Start a voice call';
  const defaultTitle = isStaff ? 'Talk to your twin' : 'Talk by voice';

  return (
    <>
      {label ? (
        <button
          type="button"
          data-testid="voice-call-button"
          onClick={() => setOpen(true)}
          aria-label={label}
          title={title ?? defaultTitle}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 rounded-full border border-ora-gold/50 bg-ora-white px-4 text-sm font-medium text-ora-charcoal transition-colors hover:border-ora-gold hover:bg-ora-cream-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60',
            size === 'md' ? 'h-11' : 'h-10',
            className,
          )}
        >
          <Phone className="h-4 w-4 stroke-[1.5] text-ora-gold-dark" />
          {label}
        </button>
      ) : (
        <button
          type="button"
          data-testid="voice-call-button"
          onClick={() => setOpen(true)}
          aria-label={defaultAria}
          title={defaultTitle}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full border border-ora-sand/70 bg-ora-white text-ora-charcoal transition-colors hover:border-ora-gold hover:bg-ora-cream-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60',
            size === 'md' ? 'h-11 w-11' : 'h-10 w-10',
            className,
          )}
        >
          <Phone className={size === 'md' ? 'h-5 w-5 stroke-[1.5]' : 'h-4 w-4 stroke-[1.5]'} />
        </button>
      )}

      {open && (
        <VoiceCallModal
          locale={locale}
          page={page}
          mode={mode}
          title={title}
          introNotice={introNotice}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default VoiceCallButton;
