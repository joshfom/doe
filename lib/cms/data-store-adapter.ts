import type { DataStore, PageData } from "@/lib/page-builder";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "";

/**
 * DataStore implementation that delegates to the Elysia CMS API.
 * Includes credentials for auth cookie forwarding.
 */
export class ApiDataStore implements DataStore {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? API_BASE_URL;
  }

  async save(pageId: string, data: PageData): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pages/${pageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      credentials: "include",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Failed to save page ${pageId}`);
    }
  }

  async load(pageId: string): Promise<PageData | null> {
    const res = await fetch(`${this.baseUrl}/api/pages/${pageId}`, {
      credentials: "include",
    });

    if (!res.ok) return null;

    const body = await res.json();
    return body.data ?? null;
  }

  async delete(pageId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pages/${pageId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Failed to delete page ${pageId}`);
    }
  }
}
