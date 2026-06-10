"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { SitemapConfig, SitemapEntryType } from "../sitemap/config";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SitemapCandidate {
  key: string;
  type: SitemapEntryType;
  id: string;
  slug: string;
  label: string;
  noIndex: boolean;
  updatedAt: string | null;
}

export interface SitemapManagerData {
  config: SitemapConfig;
  candidates: Record<SitemapEntryType, SitemapCandidate[]>;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const sitemapKeys = {
  all: ["sitemap"] as const,
  robots: ["sitemap", "robots"] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Load the sitemap config + every candidate URL for the manager. */
export function useSitemapManager() {
  return useQuery({
    queryKey: sitemapKeys.all,
    queryFn: () =>
      apiFetch<{ data: SitemapManagerData }>("/api/sitemap").then(
        (r) => r.data
      ),
  });
}

/** Persist the sitemap configuration. */
export function useUpdateSitemapConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: SitemapConfig) =>
      apiFetch<{ data: SitemapConfig }>("/api/sitemap/config", {
        method: "PUT",
        body: config,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sitemapKeys.all });
    },
  });
}

/** Load the stored robots.txt text (null if never customized). */
export function useRobotsTxt() {
  return useQuery({
    queryKey: sitemapKeys.robots,
    queryFn: () =>
      apiFetch<{ data: { text: string | null } }>("/api/sitemap/robots").then(
        (r) => r.data.text
      ),
  });
}

/** Persist the exact robots.txt text. */
export function useUpdateRobotsTxt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<{ data: { text: string } }>("/api/sitemap/robots", {
        method: "PUT",
        body: { text },
      }).then((r) => r.data.text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sitemapKeys.robots });
    },
  });
}
