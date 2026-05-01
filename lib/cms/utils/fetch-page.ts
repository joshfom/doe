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

/**
 * Fetch a published project (and its resolved media URLs) from the public API.
 * Returns null if the project is missing or archived.
 */
export interface PublicProjectMedia {
  url: string;
  alt: string;
}

export interface PublicProjectResponse {
  project: Record<string, unknown>;
  community: Record<string, unknown> | null;
  media: Record<string, PublicProjectMedia>;
}

export async function fetchPublicProject(
  slug: string
): Promise<PublicProjectResponse | null> {
  try {
    const url = `${API_BASE_URL}/api/projects/public/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data as PublicProjectResponse;
  } catch {
    return null;
  }
}

export interface PublicProjectListResponse {
  projects: Array<Record<string, unknown>>;
  media: Record<string, PublicProjectMedia>;
  communities?: Array<{
    id: string;
    slug: string;
    nameEn: string;
    nameAr?: string | null;
  }>;
}

export async function fetchPublicProjects(
  communityId?: string
): Promise<PublicProjectListResponse> {
  try {
    const qs = communityId ? `?communityId=${encodeURIComponent(communityId)}` : "";
    const url = `${API_BASE_URL}/api/projects/public${qs}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { projects: [], media: {}, communities: [] };
    const json = await res.json();
    return (
      (json.data as PublicProjectListResponse) ?? {
        projects: [],
        media: {},
        communities: [],
      }
    );
  } catch {
    return { projects: [], media: {}, communities: [] };
  }
}

// ── Communities ──────────────────────────────────────────────────────────────

export interface PublicCommunityListResponse {
  communities: Array<Record<string, unknown>>;
  media: Record<string, PublicProjectMedia>;
  projectCounts: Record<string, number>;
}

export async function fetchPublicCommunities(): Promise<PublicCommunityListResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/communities/public`, {
      cache: "no-store",
    });
    if (!res.ok) return { communities: [], media: {}, projectCounts: {} };
    const json = await res.json();
    return (
      (json.data as PublicCommunityListResponse) ?? {
        communities: [],
        media: {},
        projectCounts: {},
      }
    );
  } catch {
    return { communities: [], media: {}, projectCounts: {} };
  }
}

export interface PublicCommunityDetailResponse {
  community: Record<string, unknown>;
  projects: Array<Record<string, unknown>>;
  media: Record<string, PublicProjectMedia>;
}

export async function fetchPublicCommunity(
  slug: string
): Promise<PublicCommunityDetailResponse | null> {
  try {
    const url = `${API_BASE_URL}/api/communities/public/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data as PublicCommunityDetailResponse) ?? null;
  } catch {
    return null;
  }
}
