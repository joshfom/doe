"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronDown, CheckCircle } from "lucide-react";
import IntlTelInput from "intl-tel-input/react";
import "intl-tel-input/styles";

interface RegisterInterestDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional project or page context to attach to the submission */
  source?: string;
}

const HEAR_ABOUT_OPTIONS = [
  "Social media",
  "Billboard",
  "Broker (A broker contacted me)",
  "Online Browsing",
  "Word Of Mouth",
  "Ora Employee",
];

export function RegisterInterestDialog({
  open,
  onClose,
  source,
}: RegisterInterestDialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneValid, setPhoneValid] = useState(false);
  const [hearAbout, setHearAbout] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      };
    }
  }, [open, handleKeyDown]);

  // Close custom dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneValid || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone: phoneNumber,
          hearAbout: hearAbout || null,
          marketingConsent: agreed,
          source: source ?? null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset form after animation completes
    setTimeout(() => {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhoneNumber("");
      setPhoneValid(false);
      setHearAbout("");
      setAgreed(false);
      setSubmitted(false);
      setError("");
    }, 300);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ora-charcoal/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="relative mx-4 w-full max-w-2xl bg-white p-8 sm:p-12 shadow-ora-lg max-h-[90vh] overflow-y-auto"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute top-5 right-5 flex h-10 w-10 items-center justify-center text-ora-charcoal-light hover:text-ora-charcoal transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 stroke-[1.5]" />
            </button>

            {/* Success State */}
            {submitted ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle className="h-16 w-16 text-ora-gold mb-6 stroke-[1]" />
                <h2 className="text-2xl sm:text-3xl font-light text-ora-charcoal mb-4">
                  Thank You!
                </h2>
                <p className="text-sm text-ora-charcoal-light max-w-md leading-relaxed">
                  Your interest has been registered successfully. Our team will be in touch with you shortly.
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-8 h-12 px-16 bg-ora-charcoal text-white text-sm uppercase tracking-widest hover:bg-ora-graphite transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
            <>
            <h2 className="text-2xl sm:text-3xl font-light text-ora-charcoal mb-10">
              Register your Interest
            </h2>

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Row 1: First Name / Last Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-ora-gold-dark mb-2">First Name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="w-full border-b border-ora-charcoal-light/30 bg-transparent pb-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus:border-ora-charcoal focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-ora-gold-dark mb-2">Last Name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="w-full border-b border-ora-charcoal-light/30 bg-transparent pb-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus:border-ora-charcoal focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Row 2: Email / Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-ora-gold-dark mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border-b border-ora-charcoal-light/30 bg-transparent pb-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus:border-ora-charcoal focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-ora-gold-dark mb-2">Phone</label>
                  <div className="iti-register-phone w-full">
                    <IntlTelInput
                      initialCountry="ae"
                      onChangeNumber={(number) => setPhoneNumber(number)}
                      onChangeValidity={(valid) => setPhoneValid(valid)}
                      loadUtils={() => import("intl-tel-input/utils")}
                      inputProps={{
                        className: "!w-full border-b border-ora-charcoal-light/30 bg-transparent pb-3 text-sm text-ora-charcoal focus:border-ora-charcoal focus:outline-none transition-colors",
                        required: true,
                      }}
                    />
                    {phoneNumber && !phoneValid && (
                      <p className="mt-1 text-[11px] text-ora-error">Please enter a valid phone number</p>
                    )}
                  </div>
                </div>
              </div>

              {/* How did you hear about us — custom dropdown */}
              <div className="sm:w-1/2 relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen((v) => !v)}
                  className="flex w-full items-center justify-between border-b border-ora-charcoal-light/30 pb-3 text-sm text-left transition-colors focus:outline-none"
                >
                  <span className={hearAbout ? "text-ora-charcoal" : "text-ora-muted"}>
                    {hearAbout || "How did you hear about us?"}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-ora-charcoal-light transition-transform duration-200 ${
                      dropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.ul
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute bottom-full left-0 right-0 z-10 mb-1 bg-white border border-ora-sand shadow-ora-md"
                    >
                      {HEAR_ABOUT_OPTIONS.map((option) => (
                        <li key={option} className="list-none">
                          <button
                            type="button"
                            onClick={() => {
                              setHearAbout(option);
                              setDropdownOpen(false);
                            }}
                            className={`block w-full px-4 py-3 text-sm text-left transition-colors ${
                              hearAbout === option
                                ? "bg-ora-cream font-medium text-ora-charcoal"
                                : "text-ora-charcoal-light hover:bg-ora-cream-light hover:text-ora-charcoal"
                            }`}
                          >
                            {option}
                          </button>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              {/* Consent checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 border-2 border-ora-stone appearance-none checked:bg-ora-charcoal checked:border-ora-charcoal relative
                    after:content-[''] after:absolute after:left-[5px] after:top-[1px] after:w-[6px] after:h-[10px] after:border-white after:border-r-2 after:border-b-2 after:rotate-45 after:opacity-0 checked:after:opacity-100"
                />
                <span className="text-xs text-ora-charcoal-light leading-relaxed">
                  I agree to receive marketing content, promotional offers, and updates via Email, SMS, and WhatsApp.
                </span>
              </label>

              {/* Privacy / reCAPTCHA text */}
              <div className="space-y-1.5 text-xs text-ora-charcoal-light leading-relaxed">
                <p>
                  For details on how we handle your personal data, please review our{" "}
                  <a href="/privacy" className="text-ora-gold underline hover:text-ora-gold-dark">Privacy Policy</a>.
                </p>
                <p>
                  This site is protected by reCAPTCHA and the Google{" "}
                  <a href="https://policies.google.com/privacy" className="text-ora-gold underline hover:text-ora-gold-dark" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{" "}
                  and{" "}
                  <a href="https://policies.google.com/terms" className="text-ora-gold underline hover:text-ora-gold-dark" target="_blank" rel="noopener noreferrer">The Terms of Service</a>{" "}
                  apply.
                </p>
              </div>

              {/* Submit */}
              {error && (
                <p className="text-sm text-ora-error">{error}</p>
              )}
              <button
                type="submit"
                className="w-full sm:w-auto h-12 px-16 bg-ora-charcoal text-white text-sm uppercase tracking-widest hover:bg-ora-graphite transition-colors disabled:opacity-40"
                disabled={!firstName || !lastName || !email || !phoneValid || submitting}
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </form>
            </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
