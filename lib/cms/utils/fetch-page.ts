const API_BASE_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

/**
 * Fetch a published page from the public API endpoint.
 * Used by server components in the public frontend.
 */
export async function fetchPublicPage(locale: string, slug: string) {
  try {
    const url = `${API_BASE_URL}/api/pages/public/${locale}/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

/**
 * Fetch a page by its ID from the API.
 * Used by server components when loading pages by ID (e.g. home page via site settings).
 */
export async function fetchPageById(id: string) {
  try {
    const url = `${API_BASE_URL}/api/pages/${encodeURIComponent(id)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

/**
 * Fetch all site settings from the public API endpoint.
 * Returns a key-value map.
 */
export async function fetchSiteSettings(): Promise<Record<string, string>> {
  try {
    const url = `${API_BASE_URL}/api/settings`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    const json = await res.json();
    const entries: Array<{ key: string; value: string }> = json.data ?? [];
    const map: Record<string, string> = {};
    for (const entry of entries) {
      map[entry.key] = entry.value;
    }
    return map;
  } catch {
    return {};
  }
}
