"use client";

/**
 * DOE Call Widget — pre-call form modal.
 *
 * Renders the validated pre-call form (phone E.164 with a +971-default country
 * selector, RFC email, optional name, required consent) inside a Tailwind-scoped
 * modal. Submission is blocked until {@link canSubmitPreCall} passes, and the
 * consent checkbox is a hard gate (Requirements 1.2–1.6). On a valid submit it
 * hands the typed `CreateVoiceSessionInput` to `onSubmit` — the call lifecycle
 * (POST + LiveKit join) is wired by a later task (§7.1, task 13.2).
 *
 * All styling uses Tailwind utility classes plus `intl-tel-input`'s own
 * `.iti`-namespaced stylesheet, so the component leaks no global CSS.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import IntlTelInput from "intl-tel-input/react";
import "intl-tel-input/styles";
import type { CreateVoiceSessionInput } from "@/lib/cms/voice/contracts";
import { callWidgetI18n } from "./i18n";
import {
  DEFAULT_COUNTRY_ISO2,
  buildSessionInput,
  canSubmitPreCall,
  isValidEmail,
  type PreCallFormState,
} from "./validation";

export interface PreCallFormProps {
  open: boolean;
  locale: "en" | "ar";
  /** Source / utm passthrough attached to the submission. */
  page?: string;
  onClose: () => void;
  /** Invoked with the validated body when the form is submitted. */
  onSubmit: (input: CreateVoiceSessionInput) => void;
}

const EMPTY_STATE: PreCallFormState = {
  phone: "",
  phoneValid: false,
  email: "",
  name: "",
  consent: false,
};

export function PreCallForm({
  open,
  locale,
  page,
  onClose,
  onSubmit,
}: PreCallFormProps) {
  const strings = callWidgetI18n[locale];
  const isRtl = locale === "ar";

  const [form, setForm] = useState<PreCallFormState>(EMPTY_STATE);
  const [emailTouched, setEmailTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  // Set when the caller attempts to submit; reveals every field's error at once
  // (including still-empty required fields) so they see exactly what's missing
  // before any call is initiated.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  // Close on Escape and lock body scroll while open.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  // Reset the form shortly after the modal closes (after exit animation).
  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(() => {
      setForm(EMPTY_STATE);
      setEmailTouched(false);
      setPhoneTouched(false);
      setAttemptedSubmit(false);
    }, 300);
    return () => window.clearTimeout(id);
  }, [open]);

  const submittable = canSubmitPreCall(form);
  // Reveal field errors once the field is blurred OR the caller has tried to
  // submit. On an attempted submit we also flag empty required fields.
  const showEmailError =
    (emailTouched || attemptedSubmit) && !isValidEmail(form.email);
  const showPhoneError =
    (phoneTouched || attemptedSubmit) && !(form.phoneValid ?? false);
  const showConsentError = attemptedSubmit && !form.consent;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Surface every problem at once, then gate hard. No call is initiated
    // unless phone (valid E.164), email (RFC + TLD) and consent all pass.
    setAttemptedSubmit(true);
    setEmailTouched(true);
    setPhoneTouched(true);
    const input = buildSessionInput(form, page);
    if (!input) return;
    onSubmit(input);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="call-widget-precall-overlay"
          dir={isRtl ? "rtl" : "ltr"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ora-charcoal/60 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={strings.formTitle}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-md bg-ora-white p-7 shadow-ora-lg sm:p-9"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={strings.close}
              className="absolute top-4 flex h-9 w-9 items-center justify-center text-ora-charcoal-light transition-colors hover:text-ora-charcoal"
              style={isRtl ? { left: "1rem" } : { right: "1rem" }}
            >
              <X className="h-5 w-5 stroke-[1.5]" />
            </button>

            <h2 className="mb-2 text-2xl font-light text-ora-charcoal">
              {strings.formTitle}
            </h2>
            <p className="mb-7 text-[15px] leading-relaxed text-ora-charcoal-light">
              {strings.formSubtitle}
            </p>

            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              {/* Phone — E.164 with +971-default country selector */}
              <div>
                <label className="mb-2 block text-xs uppercase tracking-wider text-ora-gold-dark">
                  {strings.phoneLabel}
                </label>
                <div className="call-widget-phone w-full">
                  <IntlTelInput
                    initialCountry={DEFAULT_COUNTRY_ISO2}
                    onChangeNumber={(number) =>
                      setForm((s) => ({ ...s, phone: number }))
                    }
                    onChangeValidity={(valid) =>
                      setForm((s) => ({ ...s, phoneValid: valid }))
                    }
                    loadUtils={() => import("intl-tel-input/utils")}
                    inputProps={{
                      "aria-label": strings.phoneLabel,
                      onBlur: () => setPhoneTouched(true),
                      className:
                        "!w-full border-b border-ora-charcoal-light/30 bg-transparent py-3 text-base leading-normal text-ora-charcoal focus:border-ora-charcoal focus:outline-none transition-colors",
                    }}
                  />
                  {showPhoneError && (
                    <p
                      data-testid="call-widget-phone-error"
                      className="mt-1 text-[11px] text-ora-error"
                    >
                      {strings.invalidPhone}
                    </p>
                  )}
                </div>
              </div>

              {/* Email — RFC validated */}
              <div>
                <label className="mb-2 block text-xs uppercase tracking-wider text-ora-gold-dark">
                  {strings.emailLabel}
                </label>
                <input
                  type="email"
                  inputMode="email"
                  data-testid="call-widget-email-input"
                  value={form.email}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, email: e.target.value }))
                  }
                  onBlur={() => setEmailTouched(true)}
                  aria-invalid={showEmailError}
                  className="w-full border-b border-ora-charcoal-light/30 bg-transparent py-3 text-base text-ora-charcoal placeholder:text-ora-muted focus:border-ora-charcoal focus:outline-none transition-colors"
                />
                {showEmailError && (
                  <p
                    data-testid="call-widget-email-error"
                    className="mt-1 text-[11px] text-ora-error"
                  >
                    {strings.invalidEmail}
                  </p>
                )}
              </div>

              {/* Name — optional */}
              <div>
                <label className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-ora-gold-dark">
                  {strings.nameLabel}
                  <span className="font-normal normal-case text-ora-muted">
                    ({strings.nameOptional})
                  </span>
                </label>
                <input
                  type="text"
                  data-testid="call-widget-name-input"
                  value={form.name}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, name: e.target.value }))
                  }
                  className="w-full border-b border-ora-charcoal-light/30 bg-transparent py-3 text-base text-ora-charcoal placeholder:text-ora-muted focus:border-ora-charcoal focus:outline-none transition-colors"
                />
              </div>

              {/* Consent — required gate */}
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  data-testid="call-widget-consent-checkbox"
                  checked={form.consent}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, consent: e.target.checked }))
                  }
                  className="relative mt-0.5 h-5 w-5 shrink-0 appearance-none border-2 border-ora-stone after:absolute after:left-[5px] after:top-[1px] after:h-[10px] after:w-[6px] after:rotate-45 after:border-b-2 after:border-r-2 after:border-white after:opacity-0 checked:border-ora-charcoal checked:bg-ora-charcoal checked:after:opacity-100"
                />
                <span className="text-sm leading-relaxed text-ora-charcoal-light">
                  {strings.consentLabel}
                </span>
              </label>
              {showConsentError && (
                <p
                  data-testid="call-widget-consent-error"
                  className="text-[11px] text-ora-error"
                >
                  {strings.consentRequired}
                </p>
              )}

              <p className="text-sm leading-relaxed text-ora-charcoal-light">
                {strings.privacyNote}{" "}
                <a
                  href={isRtl ? "/ar/privacy" : "/privacy"}
                  className="text-ora-gold underline hover:text-ora-gold-dark"
                >
                  {strings.privacyLinkLabel}
                </a>
                .
              </p>

              <button
                type="submit"
                data-testid="call-widget-submit"
                disabled={!submittable}
                className="h-12 w-full bg-ora-charcoal text-sm uppercase tracking-widest text-white transition-colors hover:bg-ora-graphite disabled:cursor-not-allowed disabled:opacity-40"
              >
                {strings.submit}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
