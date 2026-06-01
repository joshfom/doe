/**
 * Locale configuration for the language switcher.
 *
 * To control which languages appear in the switcher, set the `enabled_locales`
 * site setting to a comma-separated list of locale codes (e.g. "en,ar").
 * If not set, all locales defined here will be shown.
 */

export interface LocaleConfig {
  code: string;
  /** Display label shown in the switcher */
  label: string;
  /** Short label (used as compact icon/text) */
  shortLabel: string;
  /** Path prefix — empty string for default locale */
  prefix: string;
  /** Text direction */
  dir: "ltr" | "rtl";
}

export const SUPPORTED_LOCALES: LocaleConfig[] = [
  {
    code: "en",
    label: "English",
    shortLabel: "EN",
    prefix: "",
    dir: "ltr",
  },
  {
    code: "ar",
    label: "العربية",
    shortLabel: "ع",
    prefix: "/ar",
    dir: "rtl",
  },
];

/**
 * Filter locales based on a comma-separated string from site settings.
 * If enabledStr is empty/undefined, returns all supported locales.
 */
export function getEnabledLocales(enabledStr?: string): LocaleConfig[] {
  if (!enabledStr) return SUPPORTED_LOCALES;
  const codes = enabledStr.split(",").map((s) => s.trim().toLowerCase());
  return SUPPORTED_LOCALES.filter((l) => codes.includes(l.code));
}

/**
 * Derive the current locale from a pathname.
 */
export function getLocaleFromPathname(pathname: string): string {
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.prefix && pathname.startsWith(locale.prefix + "/")) {
      return locale.code;
    }
    if (locale.prefix && pathname === locale.prefix) {
      return locale.code;
    }
  }
  // Default locale (no prefix)
  return SUPPORTED_LOCALES.find((l) => l.prefix === "")?.code ?? "en";
}

/**
 * Build the path for switching to another locale.
 */
export function buildLocalePath(
  pathname: string,
  currentLocale: string,
  targetLocale: string
): string {
  const currentConfig = SUPPORTED_LOCALES.find((l) => l.code === currentLocale);
  const targetConfig = SUPPORTED_LOCALES.find((l) => l.code === targetLocale);
  if (!currentConfig || !targetConfig) return pathname;

  // Strip current prefix
  let path = pathname;
  if (currentConfig.prefix && path.startsWith(currentConfig.prefix)) {
    path = path.slice(currentConfig.prefix.length) || "/";
  }

  // Add target prefix
  if (targetConfig.prefix) {
    return targetConfig.prefix + (path === "/" ? "" : path);
  }
  return path || "/";
}
