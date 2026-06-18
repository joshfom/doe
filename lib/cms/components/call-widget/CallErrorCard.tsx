"use client";

/**
 * DOE Voice Surface — graceful error card (task 13.2).
 *
 * Renders a recoverable error with a retry action and a fallback message for
 * the three call-lifecycle failure classes: microphone denial (Req 2.5), token
 * request failure (Req 2.6), and agent-join timeout > 6s (Req 2.7).
 */

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import type { Language } from "../../voice/contracts";
import { callI18n, errorCopy, type CallErrorKind } from "./strings";

interface CallErrorCardProps {
  kind: CallErrorKind;
  locale: Language;
  onRetry: () => void;
}

export function CallErrorCard({ kind, locale, onRetry }: CallErrorCardProps) {
  const s = callI18n[locale];
  const { title, body } = errorCopy(kind, s);

  return (
    <div
      data-testid="call-error-card"
      data-error-kind={kind}
      role="alert"
      className="flex flex-col items-center gap-4 p-6 text-center"
    >
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-ora-cream text-ora-gold-dark"
      >
        <AlertTriangle className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ora-charcoal">{title}</h3>
        <p className="text-sm text-ora-charcoal-light">{body}</p>
      </div>
      <button
        type="button"
        data-testid="call-error-retry"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-full bg-ora-charcoal px-5 py-2 text-sm font-semibold text-ora-white transition-colors hover:bg-ora-graphite"
      >
        <RefreshCw className="h-4 w-4" />
        {s.retry}
      </button>
      <p className="text-xs text-ora-slate">{s.fallback}</p>
    </div>
  );
}
