import { db } from "@/lib/cms/db";
import { siteSettings } from "@/lib/cms/schema";
import { eq } from "drizzle-orm";
import type { FooterConfig } from "@/lib/cms/types/footer-config";
import {
  DEFAULT_FOOTER_CONFIG_EN,
  DEFAULT_FOOTER_CONFIG_AR,
} from "@/lib/cms/types/footer-config";

const API_BASE_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

/**
 * Fetch footer configuration for a locale from the database (server-side).
 * Used by server components for SSR rendering.
 * Falls back to default configuration if not found.
 */
export async function fetchFooterConfig(locale: "en" | "ar"): Promise<FooterConfig> {
  try {
    const key = `footer_config_${locale}`;
    const [setting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, key));

    if (!setting) {
      return locale === "ar"
        ? DEFAULT_FOOTER_CONFIG_AR
        : DEFAULT_FOOTER_CONFIG_EN;
    }

    const config: FooterConfig = JSON.parse(setting.value);
    return config;
  } catch {
    return locale === "ar"
      ? DEFAULT_FOOTER_CONFIG_AR
      : DEFAULT_FOOTER_CONFIG_EN;
  }
}

/**
 * Fetch footer configuration from the public API endpoint.
 * Used by client components and server-side data fetching with cache control.
 */
export async function fetchFooterConfigFromAPI(locale: "en" | "ar"): Promise<FooterConfig | null> {
  try {
    const url = `${API_BASE_URL}/api/footer-config/${locale}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}
