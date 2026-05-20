"use client";

import { useState, useEffect, useCallback } from "react";
import posthog from "posthog-js";

import { getConsentState, setConsentState, hasConsentBeenGiven } from "./consent-state";
import type { ConsentState } from "./types";

interface ConsentBannerProps {
  consentMode: "strict" | "balanced" | "off";
  locale?: "en" | "ar";
}

/**
 * Cookie consent banner with three category toggles, accept-all/reject-all/save buttons,
 * and a persistent access point (shield icon) for reopening after dismissal.
 *
 * Consent modes:
 * - strict: all optional categories default to off
 * - balanced: analytics pre-checked, marketing off
 * - off: banner hidden, no consent UI rendered
 *
 * Supports RTL layout when locale="ar".
 */
export function ConsentBanner({ consentMode, locale = "en" }: ConsentBannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [analytics, setAnalytics] = useState(consentMode === "balanced");
  const [marketing, setMarketing] = useState(false);

  const isRtl = locale === "ar";

  // Task 8.2: If consentMode is "off", render nothing
  if (consentMode === "off") {
    return null;
  }

  // On mount, check if consent has already been given
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (hasConsentBeenGiven()) {
      setDismissed(true);
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  }, []);

  // Task 8.3: Apply consent choices — opt in/out of PostHog
  const applyConsent = useCallback((analyticsAccepted: boolean, marketingAccepted: boolean) => {
    const state: ConsentState = {
      necessary: true,
      analytics: analyticsAccepted,
      marketing: marketingAccepted,
      timestamp: new Date().toISOString(),
    };

    setConsentState(state);

    if (analyticsAccepted) {
      posthog.opt_in_capturing();
      posthog.set_config({ persistence: "localStorage+cookie" });
    } else {
      posthog.opt_out_capturing();
    }

    setIsOpen(false);
    setDismissed(true);
  }, []);

  const handleAcceptAll = useCallback(() => {
    setAnalytics(true);
    setMarketing(true);
    applyConsent(true, true);
  }, [applyConsent]);

  const handleRejectAll = useCallback(() => {
    setAnalytics(false);
    setMarketing(false);
    applyConsent(false, false);
  }, [applyConsent]);

  const handleSave = useCallback(() => {
    applyConsent(analytics, marketing);
  }, [analytics, marketing, applyConsent]);

  // Task 8.4: Reopen banner from persistent access point
  const handleReopen = useCallback(() => {
    // Load current state into toggles
    const current = getConsentState();
    if (current) {
      setAnalytics(current.analytics);
      setMarketing(current.marketing);
    } else {
      setAnalytics(consentMode === "balanced");
      setMarketing(false);
    }
    setIsOpen(true);
  }, [consentMode]);

  return (
    <>
      {/* Task 8.4: Persistent access point — shield icon */}
      {dismissed && !isOpen && (
        <button
          type="button"
          onClick={handleReopen}
          aria-label={isRtl ? "إعدادات الخصوصية" : "Privacy settings"}
          className={`fixed bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-gray-800 text-white shadow-lg transition-colors hover:bg-gray-700 ${
            isRtl ? "right-4" : "left-4"
          }`}
        >
          {/* Shield icon SVG */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 00-.722-.516 11.209 11.209 0 01-7.877-3.08z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}

      {/* Consent banner */}
      {isOpen && (
        <div
          dir={isRtl ? "rtl" : "ltr"}
          role="dialog"
          aria-label={isRtl ? "إعدادات ملفات تعريف الارتباط" : "Cookie consent settings"}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white p-4 shadow-lg sm:p-6"
        >
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              {isRtl ? "إعدادات الخصوصية" : "Privacy Settings"}
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              {isRtl
                ? "نستخدم ملفات تعريف الارتباط لتحسين تجربتك. يمكنك اختيار الفئات التي تريد السماح بها."
                : "We use cookies to improve your experience. Choose which categories you'd like to allow."}
            </p>

            {/* Category toggles */}
            <div className="mb-4 space-y-3">
              {/* Necessary — always on, not toggleable */}
              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {isRtl ? "ضرورية" : "Necessary"}
                </span>
                <input
                  type="checkbox"
                  checked={true}
                  disabled
                  aria-label={isRtl ? "ملفات تعريف الارتباط الضرورية (مفعّلة دائمًا)" : "Necessary cookies (always on)"}
                  className="h-5 w-5 cursor-not-allowed rounded border-gray-300 text-gray-400"
                />
              </label>

              {/* Analytics — toggleable */}
              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {isRtl ? "التحليلات" : "Analytics"}
                </span>
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  aria-label={isRtl ? "ملفات تعريف الارتباط التحليلية" : "Analytics cookies"}
                  className="h-5 w-5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </label>

              {/* Marketing — toggleable, always starts off */}
              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {isRtl ? "التسويق" : "Marketing"}
                </span>
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  aria-label={isRtl ? "ملفات تعريف الارتباط التسويقية" : "Marketing cookies"}
                  className="h-5 w-5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAcceptAll}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {isRtl ? "قبول الكل" : "Accept All"}
              </button>
              <button
                type="button"
                onClick={handleRejectAll}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {isRtl ? "رفض الكل" : "Reject All"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {isRtl ? "حفظ التفضيلات" : "Save Preferences"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
