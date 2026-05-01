"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

interface StatsOverview {
  totalPosts: number;
  totalViews: number;
  totalShares: number;
}

interface TopPost {
  postId: string;
  title: string;
  slug: string;
  locale: string;
  postType: string;
  status: string;
  publishedAt: string | null;
  viewCount: number;
}

interface ShareBreakdown {
  platform: string;
  total: number;
}

interface StatsFilters {
  postType?: "blog" | "news";
  from?: string;
  to?: string;
}

interface TopPostsFilters {
  postType?: "blog" | "news";
  limit?: number;
}

interface TrackShareInput {
  postId: string;
  platform: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const blogStatsKeys = {
  all: ["blogStats"] as const,
  overview: (filters?: StatsFilters) => [...blogStatsKeys.all, "overview", filters] as const,
  topPosts: (filters?: TopPostsFilters) => [...blogStatsKeys.all, "topPosts", filters] as const,
  shares: () => [...blogStatsKeys.all, "shares"] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Overview stats: total posts, views, shares */
export function useBlogStats(filters?: StatsFilters) {
  const params = new URLSearchParams();
  if (filters?.postType) params.set("postType", filters.postType);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const qs = params.toString();

  return useQuery({
    queryKey: blogStatsKeys.overview(filters),
    queryFn: () =>
      apiFetch<{ data: StatsOverview }>(
        `/api/stats/overview${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });
}

/** Top posts ranked by view count */
export function useTopPosts(filters?: TopPostsFilters) {
  const params = new URLSearchParams();
  if (filters?.postType) params.set("postType", filters.postType);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: blogStatsKeys.topPosts(filters),
    queryFn: () =>
      apiFetch<{ data: TopPost[] }>(
        `/api/stats/top-posts${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });
}

/** Per-platform share count breakdown */
export function useShareBreakdown() {
  return useQuery({
    queryKey: blogStatsKeys.shares(),
    queryFn: () =>
      apiFetch<{ data: ShareBreakdown[] }>("/api/stats/shares").then(
        (r) => r.data
      ),
  });
}

/** Track a view increment (fire-and-forget style) */
export function useTrackView() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/stats/view/${postId}`, {
        method: "POST",
      }),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogStatsKeys.all });
    },
  });
}

/** Track a share increment */
export function useTrackShare() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, platform }: TrackShareInput) =>
      apiFetch<{ data: { success: boolean } }>(`/api/stats/share/${postId}`, {
        method: "POST",
        body: { platform },
      }),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogStatsKeys.all });
    },
  });
}
