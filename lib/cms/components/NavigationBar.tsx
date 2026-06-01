import { fetchActiveMenu } from "@/lib/cms/utils/fetch-menu";
import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import type { MenuItemTree } from "@/lib/cms/types";
import { getEnabledLocales } from "@/lib/cms/config/locales";
import { NavigationBarClient } from "./NavigationBarClient";

interface NavigationBarProps {
  locale?: string;
}

/**
 * Resolve translated labels for a given locale.
 * Falls back to the default label if no translation exists.
 */
function resolveMenuLabels(items: MenuItemTree[], locale: string): MenuItemTree[] {
  return items.map((item) => ({
    ...item,
    label: (locale !== "en" && item.translations?.[locale]) || item.label,
    children: resolveMenuLabels(item.children, locale),
  }));
}

/**
 * Server component wrapper for the navigation bar.
 * Fetches the active menu (for the given locale) and site settings during SSR,
 * then passes the data to the client component for interactive rendering.
 */
export async function NavigationBar({ locale = "en" }: NavigationBarProps) {
  const [menu, settings] = await Promise.all([
    fetchActiveMenu(),
    fetchSiteSettings(),
  ]);

  // Resolve translated labels for the current locale
  const items: MenuItemTree[] = resolveMenuLabels(menu?.items ?? [], locale);

  // Use locale-specific CTA label/url, falling back to the default
  const ctaLabel =
    (locale !== "en" && settings[`nav_cta_label_${locale}`]) ||
    settings.nav_cta_label ||
    "";
  const ctaUrl =
    (locale !== "en" && settings[`nav_cta_url_${locale}`]) ||
    settings.nav_cta_url ||
    "";

  const enabledLocales = getEnabledLocales(settings.enabled_locales);

  return (
    <NavigationBarClient
      items={items}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      enabledLocales={enabledLocales}
    />
  );
}
