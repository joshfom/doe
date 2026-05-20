"use client";

import { useRef } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

import { getConsentState } from "./consent-state";
import { readAttributionCookie } from "./attribution";

interface PostHogProviderProps {
  /**
   * PII redaction settings sourced from `site_settings`.
   */
  piiRedaction: { maskInputs: boolean; maskText: boolean };
  /**
   * Consent mode from site_settings. When "off", the SDK opts in
   * immediately without waiting for the consent cookie.
   */
  consentMode?: "strict" | "balanced" | "off";
  children: React.ReactNode;
}

/**
 * PostHog client provider.
 *
 * Reads the project key and reverse-proxy path from environment variables
 * (NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_REVERSE_PROXY).
 *
 * Consent logic:
 * - "off" → opt in immediately, full persistence
 * - "strict"/"balanced" → start with memory persistence, opt in only
 *   after the visitor grants analytics consent via the banner
 */
export function PostHogProvider({
  piiRedaction,
  consentMode = "strict",
  children,
}: PostHogProviderProps) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
  const reverseProxyPath =
    process.env.NEXT_PUBLIC_POSTHOG_REVERSE_PROXY || "/ingest";
  const initRef = useRef(false);

  // Skip initialisation entirely if PostHog key is empty/null/undefined
  if (!posthogKey) {
    return <>{children}</>;
  }

  // Initialise posthog-js once
  if (!initRef.current && typeof window !== "undefined") {
    // TODO(production): Re-enable consent gating for production.
    // In development, we skip consent entirely so events flow without
    // needing to interact with the consent banner. For production,
    // set consentMode to "strict" or "balanced" in site_settings.
    const isDev = process.env.NODE_ENV === "development";
    const skipConsent = consentMode === "off" || isDev;

    posthog.init(posthogKey, {
      api_host: reverseProxyPath,
      ui_host: "https://us.posthog.com",
      persistence: skipConsent ? "localStorage+cookie" : "memory",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      session_recording: {
        maskAllInputs: piiRedaction.maskInputs,
        maskTextSelector: piiRedaction.maskText ? "*" : undefined,
      },
      loaded: (ph) => {
        if (skipConsent) {
          // Consent mode is "off" — tracking is unconditionally active
          ph.opt_in_capturing();
        } else {
          // Check if the visitor previously granted consent
          const consent = getConsentState();
          if (consent?.analytics) {
            ph.opt_in_capturing();
            ph.set_config({ persistence: "localStorage+cookie" });
          }
        }

        // Read attribution cookie and register super-properties
        const attribution = readAttributionCookie();
        if (attribution) {
          ph.register({
            first_touch_source: attribution.first_touch.utm_source ?? null,
            first_touch_medium: attribution.first_touch.utm_medium ?? null,
            first_touch_campaign: attribution.first_touch.utm_campaign ?? null,
            first_touch_timestamp: attribution.first_touch.timestamp,
            last_touch_source: attribution.last_touch.utm_source ?? null,
            last_touch_medium: attribution.last_touch.utm_medium ?? null,
            last_touch_campaign: attribution.last_touch.utm_campaign ?? null,
            last_touch_timestamp: attribution.last_touch.timestamp,
          });
        }
      },
    });

    initRef.current = true;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
