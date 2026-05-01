"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mail, Download, ChevronUp } from "lucide-react";
import { useSiteSettings } from "../contexts/SiteSettingsContext";
import { useFooterConfig } from "../hooks/use-footer-config";
import type {
  FooterConfig,
  FooterLink,
  FooterLinkGroup,
  FooterSection,
} from "../types/footer-config";
import {
  DEFAULT_FOOTER_CONFIG_EN,
  DEFAULT_FOOTER_CONFIG_AR,
  DEFAULT_FOOTER_THEME,
} from "../types/footer-config";

type FooterLocale = "en" | "ar";

interface GlobalFooterProps {
  locale: FooterLocale;
}

interface NoticeState {
  kind: "success" | "info" | "error";
  message: string;
}

function SocialIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  const cls = "h-5 w-5";
  if (p === "facebook") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cls}
        aria-hidden="true"
      >
        <path d="M13.5 8H16V5h-2.5C10.46 5 9 6.76 9 9.62V12H7v3h2v4h3v-4h2.5l.5-3H12V9.7c0-.9.26-1.7 1.5-1.7Z" />
      </svg>
    );
  }
  if (p === "instagram") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={cls}
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (p === "youtube") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cls}
        aria-hidden="true"
      >
        <path d="M21.6 7.2a2.9 2.9 0 0 0-2-2C17.8 4.7 12 4.7 12 4.7s-5.8 0-7.6.5a2.9 2.9 0 0 0-2 2A30 30 0 0 0 2 12a30 30 0 0 0 .4 4.8 2.9 2.9 0 0 0 2 2c1.8.5 7.6.5 7.6.5s5.8 0 7.6-.5a2.9 2.9 0 0 0 2-2A30 30 0 0 0 22 12a30 30 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z" />
      </svg>
    );
  }
  if (p === "x" || p === "twitter") {
    // Minimal X mark — lucide-react does not export Twitter/X in this version
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cls}
        aria-hidden="true"
      >
        <path d="M18.244 2H21l-6.53 7.46L22 22h-6.84l-4.77-6.24L4.8 22H2l7.01-8.01L2 2h6.99l4.32 5.72L18.244 2Zm-1.2 18h1.73L7.02 4H5.2l11.843 16Z" />
      </svg>
    );
  }
  if (p === "linkedin") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cls}
        aria-hidden="true"
      >
        <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.7h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1V21h-4v-5.3c0-1.27-.02-2.9-1.77-2.9-1.77 0-2.04 1.38-2.04 2.81V21H10V9Z" />
      </svg>
    );
  }
  return <span className="text-xs font-semibold">{platform.slice(0, 2).toUpperCase()}</span>;
}

function FooterAnchor({
  link,
  className,
}: {
  link: FooterLink;
  className?: string;
}) {
  const target = link.target ?? "_self";
  const rel =
    link.rel ?? (target === "_blank" ? "noopener noreferrer" : undefined);

  if (target === "_blank" || /^(https?:|mailto:|tel:)/i.test(link.url)) {
    return (
      <a href={link.url} target={target} rel={rel} className={className}>
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.url} className={className}>
      {link.label}
    </Link>
  );
}

function FlatLinks({ links }: { links: FooterLink[] }) {
  return (
    <ul className="space-y-3 text-sm font-light leading-tight">
      {links.map((link, idx) => (
        <li key={idx}>
          <FooterAnchor
            link={link}
            className="transition-colors hover:text-[var(--footer-link-hover)]"
          />
        </li>
      ))}
    </ul>
  );
}

function GroupBlock({ group }: { group: FooterLinkGroup }) {
  return (
    <div>
      {group.name ? (
        <h4 className="mb-3 text-sm font-medium uppercase tracking-[0.12em] text-[var(--footer-accent)]">
          {group.name}
        </h4>
      ) : null}
      <FlatLinks links={group.links} />
    </div>
  );
}

function SectionColumn({ section }: { section: FooterSection }) {
  return (
    <div>
      <h3 className="mb-5 border-b border-[var(--footer-border)] pb-3 text-sm font-normal uppercase tracking-[0.14em] text-[var(--footer-section-heading)]">
        {section.name}
      </h3>

      {section.groups && section.groups.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          {section.groups.map((g, i) => (
            <GroupBlock key={i} group={g} />
          ))}
        </div>
      ) : section.links && section.links.length > 0 ? (
        <FlatLinks links={section.links} />
      ) : null}
    </div>
  );
}

export function GlobalFooter({ locale }: GlobalFooterProps) {
  const settings = useSiteSettings();
  const { data: footerConfig } = useFooterConfig(locale);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const config: FooterConfig =
    footerConfig ||
    (locale === "ar" ? DEFAULT_FOOTER_CONFIG_AR : DEFAULT_FOOTER_CONFIG_EN);

  const recruitmentEmail =
    config.recruitment.email ||
    settings.footer_recruitment_email ||
    "careers@example.com";
  const brochureUrl =
    config.brochureUrl || settings.footer_brochure_url || "#";

  const theme = { ...DEFAULT_FOOTER_THEME, ...(config.theme || {}) };
  const themeVars: React.CSSProperties & Record<string, string> = {
    "--footer-bg": theme.background,
    "--footer-text": theme.text,
    "--footer-accent": theme.accent,
    "--footer-section-heading": theme.sectionHeading,
    "--footer-border": theme.border,
    "--footer-link-hover": theme.linkHover,
  };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function handleNewsletterSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setNotice({ kind: "error", message: "Please enter your email address." });
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          locale,
          sourcePath: window.location.pathname,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNotice({
          kind: "error",
          message: json?.error || "Unable to subscribe right now. Please try again.",
        });
        return;
      }

      if (json?.data?.status === "already_subscribed") {
        setNotice({ kind: "info", message: "You are already in our list." });
      } else {
        setNotice({ kind: "success", message: "Thanks. You are now on our newsletter list." });
      }

      setEmail("");
    } catch {
      setNotice({ kind: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <footer
      style={themeVars}
      className="mt-auto text-[color:var(--footer-text)]"
    >
      <div
        style={{
          background: "var(--footer-bg)",
          borderTop: "1px solid var(--footer-border)",
        }}
      >
      <div className="w-full px-6 py-14 md:px-10 lg:px-16 xl:px-24">
        <div className="grid grid-cols-1 gap-x-12 gap-y-12 lg:grid-cols-[1fr_2fr_2fr_1.5fr]">

          {config.sections.map((section, idx) => (
            <SectionColumn key={idx} section={section} />
          ))}

          {/* Right column: recruitment, newsletter, brochure */}
          <div className="space-y-8">
            {/* Recruitment */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--footer-accent)]">
                {config.recruitment.text}
              </h3>
              <a
                href={`mailto:${recruitmentEmail}`}
                className="inline-flex items-center gap-2 text-sm font-light hover:text-[var(--footer-link-hover)]"
              >
                <Mail className="h-4 w-4 stroke-[1.5]" />
                {recruitmentEmail}
              </a>
            </div>

            {/* Newsletter */}
            {config.newsletter.enabled && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--footer-accent)]">
                  {config.newsletter.label}
                </h3>

                <form onSubmit={handleNewsletterSubmit} className="space-y-3">
                  <div className="flex items-end gap-3">
                    <div
                      className="flex-1"
                      style={{ borderBottom: "1px solid var(--footer-text)" }}
                    >
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={config.newsletter.placeholder}
                        className="w-full bg-transparent py-2 text-sm font-light placeholder:text-[#8a8a8a] outline-none"
                        aria-label="Email"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      style={{ borderColor: "var(--footer-text)" }}
                      className="inline-flex h-9 items-center justify-center rounded-full border px-5 text-xs font-medium uppercase tracking-widest transition hover:bg-[color:var(--footer-text)] hover:text-white disabled:opacity-60"
                    >
                      {submitting ? "…" : "Submit"}
                    </button>
                  </div>

                  <p className="text-[11px] font-light leading-snug opacity-70">
                    This site is protected by reCAPTCHA and the Google{" "}
                    <a
                      href="https://policies.google.com/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--footer-accent)] underline"
                    >
                      Privacy Policy
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://policies.google.com/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--footer-accent)] underline"
                    >
                      Terms of Service
                    </a>{" "}
                    apply.
                  </p>
                </form>
              </div>
            )}

            {/* Brochure download */}
            {config.showBrochureButton !== false ? (
              <div>
                <a
                  href={brochureUrl}
                  style={{ borderColor: "var(--footer-text)" }}
                  className="inline-flex h-10 items-center gap-3 rounded-full border px-5 text-xs font-medium uppercase tracking-[0.12em] transition hover:bg-[color:var(--footer-text)] hover:text-white"
                >
                  {config.brochureLabel || "Download Brochure"}
                  <Download className="h-4 w-4 stroke-[1.5]" />
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ borderTop: "1px solid var(--footer-border)" }}>
        <div className="flex w-full flex-col items-center justify-between gap-4 px-6 py-5 text-xs font-light md:flex-row md:px-10 lg:px-16 xl:px-24">
          <p>{config.legal}</p>

          {config.legalLinks && config.legalLinks.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-x-8 gap-y-2">
              {config.legalLinks.map((link, idx) => (
                <li key={idx}>
                  <FooterAnchor
                    link={link}
                    className="hover:text-[var(--footer-link-hover)]"
                  />
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-5">
            {config.socials.map((social, idx) => (
              <a
                key={idx}
                href={social.url}
                target={social.target ?? "_blank"}
                rel="noreferrer"
                aria-label={social.platform}
                className="hover:text-[var(--footer-link-hover)]"
              >
                <SocialIcon platform={social.icon || social.platform} />
              </a>
            ))}
            <button
              type="button"
              onClick={() =>
                window.scrollTo({ top: 0, behavior: "smooth" })
              }
              aria-label={config.backToTopLabel}
              style={{ borderColor: "var(--footer-text)" }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border hover:text-[var(--footer-link-hover)]"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Notice */}
      {notice ? (
        <div className="fixed bottom-6 right-6 z-70 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[#D8D8D8] bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <p
              className={`text-sm font-light ${
                notice.kind === "error" ? "text-[#9F1D1D]" : "text-ora-charcoal"
              }`}
            >
              {notice.message}
            </p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-base text-[#666] hover:text-black"
              aria-label="Close message"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </footer>
  );
}
