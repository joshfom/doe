import type { PageData, PageMeta } from "./types";
import type { DataStore } from "./data-store";
import { validatePageData } from "./schema";

// ── PageMetaStore interface (Task 4.1) ──────────────────────────────────────

/**
 * Abstract persistence interface for PageMeta records.
 * Implementations can target any backend (database, REST API, etc.).
 */
export interface PageMetaStore {
  create(meta: PageMeta): Promise<void>;
  update(id: string, meta: Partial<PageMeta>): Promise<void>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<PageMeta | null>;
  getBySlug(slug: string): Promise<PageMeta | null>;
  list(): Promise<PageMeta[]>;
}

/**
 * In-memory PageMetaStore for testing and development.
 * Deep-clones on read/write to prevent accidental mutation.
 */
export class InMemoryPageMetaStore implements PageMetaStore {
  private store = new Map<string, PageMeta>();

  async create(meta: PageMeta): Promise<void> {
    this.store.set(meta.id, structuredClone(meta));
  }

  async update(id: string, partial: Partial<PageMeta>): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) return;
    this.store.set(id, structuredClone({ ...existing, ...partial }));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async getById(id: string): Promise<PageMeta | null> {
    const meta = this.store.get(id);
    return meta ? structuredClone(meta) : null;
  }

  async getBySlug(slug: string): Promise<PageMeta | null> {
    for (const meta of this.store.values()) {
      if (meta.slug === slug) return structuredClone(meta);
    }
    return null;
  }

  async list(): Promise<PageMeta[]> {
    return [...this.store.values()].map((m) => structuredClone(m));
  }
}

// ── Error types ─────────────────────────────────────────────────────────────

/** Thrown when a page creation is attempted with a slug that already exists. */
export class SlugConflictError extends Error {
  constructor(slug: string) {
    super(`A page with slug "${slug}" already exists`);
    this.name = "SlugConflictError";
  }
}

// ── Structured result types ─────────────────────────────────────────────────

export type PageManagerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ── PageManager dependencies & factory (Task 4.2) ──────────────────────────

export interface PageManagerDeps {
  dataStore: DataStore;
  metaStore: PageMetaStore;
}

export interface PageManager {
  createPage(
    title: string,
    slug: string,
    initialData: PageData,
  ): Promise<PageManagerResult<PageMeta>>;
  listPages(): Promise<PageMeta[]>;
  updatePage(
    id: string,
    updates: { title?: string; slug?: string; data?: PageData },
  ): Promise<PageManagerResult<PageMeta>>;
  deletePage(id: string): Promise<PageManagerResult<void>>;
  publishPage(id: string): Promise<PageManagerResult<PageMeta>>;
  unpublishPage(id: string): Promise<PageManagerResult<PageMeta>>;
}

/**
 * Creates a PageManager that orchestrates CRUD, validation, slug uniqueness,
 * and draft/published workflow over the provided stores.
 */
export function createPageManager(deps: PageManagerDeps): PageManager {
  const { dataStore, metaStore } = deps;

  return {
    async createPage(title, slug, initialData) {
      // Validate page data
      const validation = validatePageData(initialData);
      if (!validation.success) {
        return {
          ok: false,
          error: `Invalid page data: ${validation.errors?.map((e) => e.message).join(", ")}`,
        };
      }

      // Check slug uniqueness
      const existing = await metaStore.getBySlug(slug);
      if (existing) {
        throw new SlugConflictError(slug);
      }

      const now = new Date().toISOString();
      const meta: PageMeta = {
        id: crypto.randomUUID(),
        title,
        slug,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      };

      try {
        await metaStore.create(meta);
        await dataStore.save(meta.id, initialData);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      return { ok: true, value: meta };
    },

    async listPages() {
      return metaStore.list();
    },

    async updatePage(id, updates) {
      const existing = await metaStore.getById(id);
      if (!existing) {
        return { ok: false, error: `Page not found: ${id}` };
      }

      // Validate new data if provided
      if (updates.data) {
        const validation = validatePageData(updates.data);
        if (!validation.success) {
          return {
            ok: false,
            error: `Invalid page data: ${validation.errors?.map((e) => e.message).join(", ")}`,
          };
        }
      }

      const now = new Date().toISOString();
      const metaUpdates: Partial<PageMeta> = { updatedAt: now };
      if (updates.title !== undefined) metaUpdates.title = updates.title;
      if (updates.slug !== undefined) metaUpdates.slug = updates.slug;

      try {
        await metaStore.update(id, metaUpdates);
        if (updates.data) {
          await dataStore.save(id, updates.data);
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const updated = await metaStore.getById(id);
      return { ok: true, value: updated! };
    },

    async deletePage(id) {
      try {
        await metaStore.delete(id);
        await dataStore.delete(id);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      return { ok: true, value: undefined };
    },

    async publishPage(id) {
      const existing = await metaStore.getById(id);
      if (!existing) {
        return { ok: false, error: `Page not found: ${id}` };
      }

      // Idempotent: already published is a no-op
      if (existing.status === "published") {
        return { ok: true, value: existing };
      }

      const now = new Date().toISOString();
      try {
        await metaStore.update(id, {
          status: "published",
          publishedAt: now,
          updatedAt: now,
        });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const updated = await metaStore.getById(id);
      return { ok: true, value: updated! };
    },

    async unpublishPage(id) {
      const existing = await metaStore.getById(id);
      if (!existing) {
        return { ok: false, error: `Page not found: ${id}` };
      }

      // Idempotent: already draft is a no-op
      if (existing.status === "draft") {
        return { ok: true, value: existing };
      }

      const now = new Date().toISOString();
      try {
        await metaStore.update(id, {
          status: "draft",
          updatedAt: now,
        });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const updated = await metaStore.getById(id);
      return { ok: true, value: updated! };
    },
  };
}
