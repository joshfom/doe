"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

interface SettingEntry {
  key: string;
  value: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const settingsKeys = {
  all: ["settings"] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Site settings query — returns all key-value pairs */
export function useSiteSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () =>
      apiFetch<{ data: SettingEntry[] }>("/api/settings").then(
        (r) => r.data
      ),
  });
}

/** Bulk update settings mutation */
export function useUpdateSettings() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (settings: Record<string, string>) =>
      apiFetch<{ data: SettingEntry[] }>("/api/settings", {
        method: "PUT",
        body: { settings },
      }).then((r) => r.data),

    onMutate: async (settings) => {
      await qc.cancelQueries({ queryKey: settingsKeys.all });
      const previous = qc.getQueryData<SettingEntry[]>(settingsKeys.all);

      // Optimistically merge updated values into the cache
      if (previous) {
        const updated = previous.map((entry) =>
          settings[entry.key] !== undefined
            ? { ...entry, value: settings[entry.key] }
            : entry
        );

        // Add any new keys not already in the cache
        const existingKeys = new Set(previous.map((e) => e.key));
        for (const [key, value] of Object.entries(settings)) {
          if (!existingKeys.has(key)) {
            updated.push({ key, value });
          }
        }

        qc.setQueryData<SettingEntry[]>(settingsKeys.all, updated);
      }

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(settingsKeys.all, context.previous);
      }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}
