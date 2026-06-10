import type { LibraryComponent, ComponentLibraryStore } from "./types";

/**
 * In-memory ComponentLibraryStore for development and testing.
 * Follows the same Map-based pattern as InMemoryDataStore and InMemoryPageMetaStore.
 */
export class InMemoryComponentLibraryStore implements ComponentLibraryStore {
  private components: Map<string, LibraryComponent> = new Map();

  constructor(builtins: LibraryComponent[]) {
    for (const component of builtins) {
      this.components.set(component.id, component);
    }
  }

  list(): LibraryComponent[] {
    return [...this.components.values()];
  }

  getById(id: string): LibraryComponent | null {
    return this.components.get(id) ?? null;
  }

  save(
    component: Omit<LibraryComponent, "id" | "createdAt" | "updatedAt">
  ): LibraryComponent {
    const now = new Date().toISOString();
    const record: LibraryComponent = {
      ...component,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.components.set(record.id, record);
    return record;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        LibraryComponent,
        "name" | "description" | "category" | "content" | "zones" | "thumbnail"
      >
    >
  ): LibraryComponent | null {
    const existing = this.components.get(id);
    if (!existing) return null;

    const updated: LibraryComponent = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.components.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.components.delete(id);
  }

  findByName(name: string, scope: "user" | "builtin"): LibraryComponent | null {
    const lowerName = name.toLowerCase();
    for (const component of this.components.values()) {
      if (
        component.scope === scope &&
        component.name.toLowerCase() === lowerName
      ) {
        return component;
      }
    }
    return null;
  }
}
