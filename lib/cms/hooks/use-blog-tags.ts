"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

interface TagRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface CreateTagInput {
  name: string;
}

interface UpdateTagInput {
  id: string;
  name?: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const blogTagKeys = {
  all: ["blogTags"] as const,
  lists: () => [...blogTagKeys.all, "list"] as const,
  list: () => [...blogTagKeys.lists()] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List all tags */
export function useBlogTags() {
  return useQuery({
    queryKey: blogTagKeys.list(),
    queryFn: () =>
      apiFetch<{ data: TagRecord[] }>("/api/tags").then((r) => r.data),
  });
}

/** Create tag mutation */
export function useCreateTag() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTagInput) =>
      apiFetch<{ data: TagRecord }>("/api/tags", {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogTagKeys.lists() });
    },
  });
}

/** Update tag mutation */
export function useUpdateTag() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTagInput) =>
      apiFetch<{ data: TagRecord }>(`/api/tags/${id}`, {
        method: "PUT",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogTagKeys.lists() });
    },
  });
}

/** Delete tag mutation */
export function useDeleteTag() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/tags/${id}`, {
        method: "DELETE",
      }),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogTagKeys.lists() });
    },
  });
}
