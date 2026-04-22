import type { PageData } from "./types";

/**
 * Abstract persistence interface for saving and retrieving PageData JSON.
 * Different storage backends (REST API, database, localStorage) can implement
 * this interface without changing Editor or Renderer code.
 */
export interface DataStore {
  save(pageId: string, data: PageData): Promise<void>;
  load(pageId: string): Promise<PageData | null>;
  delete(pageId: string): Promise<void>;
}

/**
 * In-memory DataStore implementation for testing and development.
 * Deep-clones data on save and load to ensure round-trip integrity.
 */
export class InMemoryDataStore implements DataStore {
  private store = new Map<string, PageData>();

  async save(pageId: string, data: PageData): Promise<void> {
    this.store.set(pageId, structuredClone(data));
  }

  async load(pageId: string): Promise<PageData | null> {
    const data = this.store.get(pageId);
    if (!data) return null;
    return structuredClone(data);
  }

  async delete(pageId: string): Promise<void> {
    this.store.delete(pageId);
  }
}
