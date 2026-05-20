"use client";

/**
 * Custom-events store
 *
 * Lightweight subscribe/notify cache that fetches admin-managed custom
 * events once and shares them across all consumers (the tracking dropdown
 * in the page builder, validation, etc.).
 *
 * The store fetches lazily on first read and refreshes when explicitly
 * invalidated (e.g. after an admin creates a new event in the settings
 * page). Falls back to an empty list on network error so the builder
 * stays usable.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

type Listener = () => void;

interface CustomEvent {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

let names: string[] = [];
let loaded = false;
let loading = false;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

async function fetchCustomEvents(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/custom-events`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const json = (await res.json()) as { data?: CustomEvent[] };
    names = (json.data ?? [])
      .filter((e) => e.isActive)
      .map((e) => e.name)
      .sort();
    loaded = true;
    notify();
  } catch {
    // Silent fail — the dropdown will just show core events
    names = [];
    loaded = true;
    notify();
  } finally {
    loading = false;
  }
}

/**
 * Returns the cached list of custom event names. Triggers a fetch on
 * first call if not yet loaded.
 */
export function getCustomEventNames(): readonly string[] {
  if (!loaded && typeof window !== "undefined") {
    void fetchCustomEvents();
  }
  return names;
}

/**
 * Subscribe to changes in the custom-events list. Returns an unsubscribe
 * function. Useful for React components that need to re-render when
 * events are added/removed.
 */
export function subscribeCustomEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Force a refresh of the custom-events list from the server. Call this
 * after creating, updating, or deleting a custom event so all open
 * page-builder tabs see the change.
 */
export function refreshCustomEvents(): Promise<void> {
  return fetchCustomEvents();
}
