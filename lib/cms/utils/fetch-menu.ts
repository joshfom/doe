import type { MenuWithItems } from "@/lib/cms/types";

const API_BASE_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

/**
 * Fetch the active menu from the public API endpoint.
 * Used by server components (e.g. NavigationBar) for SSR rendering.
 * Returns null on error or when no active menu is set (graceful degradation).
 *
 * Note: Always fetches the same active menu regardless of locale.
 * Locale-based label resolution happens in NavigationBar after fetching.
 */
export async function fetchActiveMenu(): Promise<MenuWithItems | null> {
  try {
    const url = `${API_BASE_URL}/api/menus/active`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}
