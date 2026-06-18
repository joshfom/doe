"use client";

/**
 * DOE Call Widget (`@doe/call-widget`).
 *
 * A self-contained, Tailwind-scoped, single-import React client component that
 * renders the "Call DOE" entry point in two variants — a persistent floating
 * action control and an inline hero CTA — and opens the validated pre-call form
 * (phone E.164 / email / optional name / required consent).
 *
 * Scope of this implementation (§7.1, task 13.1): the CTA variants and the
 * pre-call form only. The in-call lifecycle (POST `/api/voice/sessions`, the
 * LiveKit join, in-call controls, error cards, and the thank-you card) is added
 * by task 13.2, which plugs into the {@link CallWidgetProps.onStartCall} seam
 * and extends the `phase` state below. Keeping that seam explicit lets the two
 * tasks proceed in parallel without colliding.
 *
 * Embeddable with one import:
 *   `import { CallWidget } from "@/lib/cms/components/call-widget";`
 */

import { useCallback, useState } from "react";
import { Phone } from "lucide-react";
import type { CreateVoiceSessionInput } from "@/lib/cms/voice/contracts";
import { callWidgetI18n } from "./i18n";
import { PreCallForm } from "./PreCallForm";
import { VoiceCallSession } from "./VoiceCallSession";

export interface CallWidgetProps {
  /** `floating` = persistent FAB; `hero` = inline CTA for hero sections. */
  variant: "floating" | "hero";
  /** Originating page / utm / source passthrough attached to the session. */
  page?: string;
  locale: "en" | "ar";
  /**
   * Extension seam for task 13.2: receives the validated session body when the
   * caller submits the pre-call form. When omitted, the widget simply closes
   * the form (useful for embedding the CTA before the call lifecycle is wired).
   */
  onStartCall?: (input: CreateVoiceSessionInput) => void;
}

/**
 * Widget phases. The pre-call CTA states (`idle`, `form`) plus the active call
 * (`calling`), during which the {@link VoiceCallSession} lifecycle is mounted.
 */
type WidgetPhase = "idle" | "form" | "calling";

export function CallWidget({
  variant,
  page,
  locale,
  onStartCall,
}: CallWidgetProps) {
  const strings = callWidgetI18n[locale];
  const isRtl = locale === "ar";
  const [phase, setPhase] = useState<WidgetPhase>("idle");
  const [callInput, setCallInput] = useState<CreateVoiceSessionInput | null>(
    null,
  );

  const openForm = useCallback(() => setPhase("form"), []);
  const closeForm = useCallback(() => setPhase("idle"), []);
  const endCall = useCallback(() => {
    setCallInput(null);
    setPhase("idle");
  }, []);

  const handleSubmit = useCallback(
    (input: CreateVoiceSessionInput) => {
      // If a host provided an explicit handler, defer to it (back-compat seam).
      if (onStartCall) {
        onStartCall(input);
        closeForm();
        return;
      }
      // Otherwise drive the in-call lifecycle ourselves: capture the validated
      // input and mount the VoiceCallSession, which auto-starts the call
      // (mic → POST /api/voice/sessions → LiveKit join → wait for agent).
      setCallInput(input);
      setPhase("calling");
    },
    [onStartCall, closeForm],
  );

  const cta = (
    <>
      <PreCallForm
        open={phase === "form"}
        locale={locale}
        page={page}
        onClose={closeForm}
        onSubmit={handleSubmit}
      />
      {phase === "calling" && callInput && (
        <div
          data-testid="call-widget-session-overlay"
          dir={isRtl ? "rtl" : "ltr"}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ora-charcoal/60 p-4 backdrop-blur-sm"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={strings.formTitle}
            className="relative w-full max-w-lg overflow-hidden rounded-[2rem] bg-gradient-to-b from-ora-cream-light via-ora-white to-ora-ocean/15 shadow-ora-lg ring-1 ring-ora-sand/40"
            onClick={(e) => e.stopPropagation()}
          >
            <VoiceCallSession
              input={callInput}
              locale={locale}
              onClose={endCall}
            />
          </div>
        </div>
      )}
    </>
  );

  if (variant === "hero") {
    return (
      <span dir={isRtl ? "rtl" : "ltr"} className="inline-flex">
        <button
          type="button"
          data-testid="call-widget-hero-cta"
          onClick={openForm}
          className="inline-flex h-12 items-center gap-3 bg-ora-charcoal px-8 text-sm uppercase tracking-widest text-white transition-colors hover:bg-ora-graphite"
        >
          <Phone className="h-4 w-4 stroke-[1.5]" aria-hidden />
          {strings.cta}
        </button>
        {cta}
      </span>
    );
  }

  // Floating variant — persistent FAB. Anchored to the bottom on the locale's
  // leading side, sitting above the chat bubble so the two don't overlap.
  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="fixed bottom-24 z-[60]"
      style={isRtl ? { left: "1.5rem" } : { right: "1.5rem" }}
    >
      <button
        type="button"
        data-testid="call-widget-floating-cta"
        aria-label={strings.openLabel}
        onClick={openForm}
        className="flex h-14 items-center gap-3 rounded-full bg-ora-charcoal px-5 text-sm font-medium text-white shadow-ora-lg transition-colors hover:bg-ora-graphite"
      >
        <Phone className="h-5 w-5 stroke-[1.5]" aria-hidden />
        <span className="hidden sm:inline">{strings.cta}</span>
      </button>
      {cta}
    </div>
  );
}
