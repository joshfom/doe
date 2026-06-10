"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";
import {
  getLocaleFromPathname,
  buildLocalePath,
  type LocaleConfig,
} from "@/lib/cms/config/locales";

interface LanguageSwitcherProps {
  /** Filtered list of enabled locales (from server via site settings) */
  locales: LocaleConfig[];
}

/**
 * Language switcher displayed in the navigation bar.
 * Shows a globe icon followed by the target language label.
 * When only 2 locales exist it renders a single toggle link.
 * When more exist it could be extended to a dropdown.
 */
export function LanguageSwitcher({ locales }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const currentLocale = getLocaleFromPathname(pathname);

  // Don't render if only one (or zero) locale is enabled
  if (locales.length <= 1) return null;

  // For a two-language setup, show a direct toggle to the other language
  if (locales.length === 2) {
    const target = locales.find((l) => l.code !== currentLocale) ?? locales[0];
    const targetPath = buildLocalePath(pathname, currentLocale, target.code);

    return (
      <Link
        href={targetPath}
        className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-[13px] uppercase tracking-widest text-white/80 hover:text-white transition-colors duration-200"
        aria-label={`Switch to ${target.label}`}
        title={`Switch to ${target.label}`}
      >
        <Globe className="h-4 w-4 stroke-[1.5]" />
        <span>{target.shortLabel}</span>
      </Link>
    );
  }

  // For 3+ languages, render a simple list (can be upgraded to dropdown)
  return (
    <div className="hidden sm:flex items-center gap-1">
      <Globe className="h-4 w-4 stroke-[1.5] text-white/80" />
      {locales
        .filter((l) => l.code !== currentLocale)
        .map((target) => {
          const targetPath = buildLocalePath(
            pathname,
            currentLocale,
            target.code
          );
          return (
            <Link
              key={target.code}
              href={targetPath}
              className="px-2 py-1 text-[12px] uppercase tracking-widest text-white/80 hover:text-white transition-colors duration-200"
              aria-label={`Switch to ${target.label}`}
              title={`Switch to ${target.label}`}
            >
              {target.shortLabel}
            </Link>
          );
        })}
    </div>
  );
}
