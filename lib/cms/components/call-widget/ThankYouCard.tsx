"use client";

/**
 * DOE Voice Surface — post-call thank-you card (task 13.2).
 *
 * Rendered when a call ends. Populated from `GET /api/voice/sessions/:id`
 * (Req 2.8): when a booking was made in-call it confirms the viewing with its
 * reference and schedule; otherwise it shows a warm generic acknowledgement.
 */

import React from "react";
import { CheckCircle2 } from "lucide-react";

import type { Language, GetVoiceSessionResult } from "../../voice/contracts";
import { callI18n } from "./strings";

interface ThankYouCardProps {
  locale: Language;
  result: GetVoiceSessionResult | null;
}

export function ThankYouCard({ locale, result }: ThankYouCardProps) {
  const s = callI18n[locale];
  const appointment = result?.appointment;
  const hasBooking = Boolean(appointment);

  return (
    <div
      data-testid="call-thank-you-card"
      data-has-booking={hasBooking ? "true" : "false"}
      className="flex flex-col items-center gap-4 p-6 text-center"
    >
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-ora-cream text-ora-gold-dark"
      >
        <CheckCircle2 className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ora-charcoal">
          {hasBooking ? s.bookingConfirmedTitle : s.thankYouTitle}
        </h3>
        <p className="text-sm text-ora-charcoal-light">
          {hasBooking ? s.bookingConfirmedBody : s.thankYouBody}
        </p>
      </div>

      {appointment && (
        <dl
          data-testid="call-booking-details"
          className="w-full max-w-xs space-y-2 rounded-lg border border-ora-sand bg-ora-cream-light p-4 text-start text-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ora-slate">{appointment.appointmentType}</dt>
            <dd className="font-medium text-ora-charcoal">
              {appointment.scheduledDate} · {appointment.scheduledTime}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ora-slate">{s.bookingReference}</dt>
            <dd className="font-mono text-ora-charcoal">
              {appointment.referenceNumber}
            </dd>
          </div>
        </dl>
      )}

      {/* Free-form summary is intentionally NOT shown to the caller — the
          transcript belongs to the Demo Console, not the widget (Req 2.4). */}
    </div>
  );
}
