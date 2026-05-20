import type { ComponentInstance } from "../types";

/**
 * A saved composed component that can be inserted into any page as a reusable unit.
 */
export interface LibraryComponent {
  /** UUID */
  id: string;
  /** Display name, max 100 characters */
  name: string;
  /** Optional description, max 500 characters */
  description: string;
  /** Determines badge/behavior: "global" = configurable per use, "content" = content patterns */
  category: "global" | "content";
  /** "user" = My Components (user-saved), "builtin" = shipped with the application */
  scope: "user" | "builtin";
  /** Base64 data URL or null */
  thumbnail: string | null;
  /** Serialized component tree */
  content: ComponentInstance[];
  /** Nested zones belonging to the component tree */
  zones: Record<string, ComponentInstance[]>;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * Store interface for managing the component library.
 */
export interface ComponentLibraryStore {
  /** Returns all library components. */
  list(): LibraryComponent[];
  /** Returns a single component by ID, or null if not found. */
  getById(id: string): LibraryComponent | null;
  /** Saves a new component, generating id and timestamps. */
  save(
    component: Omit<LibraryComponent, "id" | "createdAt" | "updatedAt">
  ): LibraryComponent;
  /** Updates an existing component by ID with a partial patch. Returns updated component or null if not found. */
  update(
    id: string,
    patch: Partial<
      Pick<
        LibraryComponent,
        "name" | "description" | "category" | "content" | "zones" | "thumbnail"
      >
    >
  ): LibraryComponent | null;
  /** Removes a component by ID. Returns true if removed, false if not found. */
  remove(id: string): boolean;
  /** Finds a component by exact name within a given scope. Returns null if not found. */
  findByName(name: string, scope: "user" | "builtin"): LibraryComponent | null;
}
