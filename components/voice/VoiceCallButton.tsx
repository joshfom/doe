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
}

export function VoiceCallButton({
  locale = 'en',
  page,
  size = 'md',
  className,
}: VoiceCallButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="voice-call-button"
        onClick={() => setOpen(true)}
        aria-label="Start a voice call"
        title="Talk by voice"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border border-ora-sand/70 bg-ora-white text-ora-charcoal transition-colors hover:border-ora-gold hover:bg-ora-cream-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold/60',
          size === 'md' ? 'h-11 w-11' : 'h-10 w-10',
          className,
        )}
      >
        <Phone className={size === 'md' ? 'h-5 w-5 stroke-[1.5]' : 'h-4 w-4 stroke-[1.5]'} />
      </button>

      {open && (
        <VoiceCallModal locale={locale} page={page} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export default VoiceCallButton;
