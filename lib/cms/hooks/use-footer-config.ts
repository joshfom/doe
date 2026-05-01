"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { FooterConfig } from "../types/footer-config";

// ── Query keys ───────────────────────────────────────────────────────────────

export const footerConfigKeys = {
  all: ["footer-config"] as const,
  detail: (locale: string) => [...footerConfigKeys.all, locale] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Fetch footer configuration for a locale */
export function useFooterConfig(locale: "en" | "ar") {
  return useQuery({
    queryKey: footerConfigKeys.detail(locale),
    queryFn: () =>
      apiFetch<{ data: FooterConfig }>(`/api/footer-config/${locale}`).then(
        (r) => r.data
      ),
  });
}

/** Update footer configuration for a locale */
export function useUpdateFooterConfig() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { locale: "en" | "ar"; config: Partial<FooterConfig> }) =>
      apiFetch<{ data: FooterConfig }>(
        `/api/footer-config/${input.locale}`,
        { method: "PUT", body: input.config }
      ).then((r) => r.data),

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({
        queryKey: footerConfigKeys.detail(variables.locale),
      });
    },
  });
}
