import { fetchActiveMenu } from "@/lib/cms/utils/fetch-menu";
import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import type { MenuItemTree } from "@/lib/cms/types";
import { NavigationBarClient } from "./NavigationBarClient";

/**
 * Server component wrapper for the navigation bar.
 * Fetches the active menu and site settings during SSR,
 * then passes the data to the client component for interactive rendering.
 */
export async function NavigationBar() {
  const [menu, settings] = await Promise.all([
    fetchActiveMenu(),
    fetchSiteSettings(),
  ]);

  const items: MenuItemTree[] = menu?.items ?? [];
  const ctaLabel = settings.nav_cta_label ?? "";
  const ctaUrl = settings.nav_cta_url ?? "";

  return (
    <NavigationBarClient
      items={items}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
    />
  );
}
