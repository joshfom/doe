"use client";

import { useEffect, useState } from "react";
import { Phone, Mail, Loader2, Check } from "lucide-react";
import { apiFetch } from "@/lib/cms/hooks/api";
import type { ProjectLandingData, Locale } from "./types";

function pickBilingual(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: Locale
): string {
  if (locale === "ar") return ar?.trim() || en?.trim() || "";
  return en?.trim() || "";
}

interface PublicTicketResponse {
  data?: { ticketId: string; ticketNumber: string };
  error?: string;
  details?: Record<string, string>;
}

export function ProjectInquiryCTA({
  data,
  locale,
  settings,
}: {
  data: ProjectLandingData;
  locale: Locale;
  settings: Record<string, string>;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Best-effort prefill from the active session (silent on 401).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          data?: { name?: string | null; email?: string | null };
        }>("/api/auth/session");
        if (cancelled) return;
        const sessionUser = res?.data;
        if (!sessionUser) return;
        setForm((f) => ({
          ...f,
          name: f.name || sessionUser.name || "",
          email: f.email || sessionUser.email || "",
        }));
      } catch {
        // Not signed in or auth disabled — leave fields empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectName = pickBilingual(data.project.nameEn, data.project.nameAr, locale);
  const phone = settings.phone?.trim();
  const email = settings.email?.trim();
  const company = settings.company_name?.trim();

  const heading =
    locale === "ar" ? "هل أنت مهتم بهذا المشروع؟" : "Interested in this project?";
  const intro =
    locale === "ar"
      ? `تواصل مع فريق ${company || "المبيعات"} للحصول على مزيد من المعلومات.`
      : `Get in touch with the ${company || "sales"} team for more information.`;

  const labels = {
    name: locale === "ar" ? "الاسم" : "Name",
    email: locale === "ar" ? "البريد الإلكتروني" : "Email",
    phone: locale === "ar" ? "الهاتف (اختياري)" : "Phone (optional)",
    message: locale === "ar" ? "الرسالة" : "Message",
    submit: locale === "ar" ? "إرسال الاستفسار" : "Send Inquiry",
    sending: locale === "ar" ? "جارٍ الإرسال…" : "Sending…",
    success:
      locale === "ar"
        ? "شكرًا لك. سيتواصل معك فريقنا قريبًا."
        : "Thank you. Our team will be in touch shortly.",
    fail:
      locale === "ar"
        ? "تعذر إرسال طلبك. يرجى المحاولة مرة أخرى."
        : "Could not send your inquiry. Please try again.",
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    try {
      await apiFetch<PublicTicketResponse>("/api/tickets/public", {
        method: "POST",
        body: {
          subject: `Inquiry: ${projectName}`,
          description: form.message || `Inquiry about ${projectName}`,
          contactName: form.name,
          contactEmail: form.email,
          contactPhone: form.phone || undefined,
          requestType: "general_inquiry",
          projectId: data.project.id,
          communityId: data.project.communityId,
        },
      });
      setStatus("success");
      setForm({ name: "", email: "", phone: "", message: "" });
    } catch (err) {
      const e = err as { error?: string; details?: Record<string, string> };
      const detailMsgs = e?.details ? Object.values(e.details).join(" ") : "";
      setErrorMsg(detailMsgs || e?.error || labels.fail);
      setStatus("error");
    }
  }

  return (
    <section className="bg-ora-charcoal py-16 text-ora-white">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 md:grid-cols-2 md:px-10">
        <div>
          <h2 className="font-serif text-3xl md:text-4xl">{heading}</h2>
          <p className="mt-4 text-ora-white/80">{intro}</p>
          <div className="mt-8 space-y-3 text-sm">
            {phone && (
              <a
                href={`tel:${phone.replace(/\s+/g, "")}`}
                className="flex items-center gap-3 text-ora-white hover:text-ora-gold"
              >
                <Phone className="h-4 w-4 stroke-1" />
                {phone}
              </a>
            )}
            {email && (
              <a
                href={`mailto:${email}`}
                className="flex items-center gap-3 text-ora-white hover:text-ora-gold"
              >
                <Mail className="h-4 w-4 stroke-1" />
                {email}
              </a>
            )}
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {status === "success" ? (
            <div className="flex items-start gap-3 border border-ora-gold bg-ora-gold/10 p-5">
              <Check className="mt-0.5 h-5 w-5 stroke-1 text-ora-gold" />
              <p className="text-sm">{labels.success}</p>
            </div>
          ) : (
            <>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={labels.name}
                className="h-11 w-full border border-ora-white/30 bg-transparent px-4 text-sm text-ora-white placeholder:text-ora-white/50 focus-visible:border-ora-gold focus-visible:outline-none"
              />
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={labels.email}
                className="h-11 w-full border border-ora-white/30 bg-transparent px-4 text-sm text-ora-white placeholder:text-ora-white/50 focus-visible:border-ora-gold focus-visible:outline-none"
              />
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={labels.phone}
                className="h-11 w-full border border-ora-white/30 bg-transparent px-4 text-sm text-ora-white placeholder:text-ora-white/50 focus-visible:border-ora-gold focus-visible:outline-none"
              />
              <textarea
                rows={4}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder={labels.message}
                className="w-full border border-ora-white/30 bg-transparent p-4 text-sm text-ora-white placeholder:text-ora-white/50 focus-visible:border-ora-gold focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={status === "sending"}
                className="inline-flex h-11 w-full items-center justify-center gap-2 border border-ora-gold bg-ora-gold text-sm font-medium text-ora-charcoal transition-colors hover:bg-transparent hover:text-ora-gold disabled:opacity-60"
              >
                {status === "sending" && (
                  <Loader2 className="h-4 w-4 animate-spin stroke-1" />
                )}
                {status === "sending" ? labels.sending : labels.submit}
              </button>
              {status === "error" && (
                <p className="text-xs text-ora-error">{errorMsg}</p>
              )}
            </>
          )}
        </form>
      </div>
    </section>
  );
}
