"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { CategoryTree } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
}

interface UpdateCategoryInput {
  id: string;
  name?: string;
  parentId?: string | null;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const blogCategoryKeys = {
  all: ["blogCategories"] as const,
  lists: () => [...blogCategoryKeys.all, "list"] as const,
  list: () => [...blogCategoryKeys.lists()] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List categories as tree structure */
export function useBlogCategories() {
  return useQuery({
    queryKey: blogCategoryKeys.list(),
    queryFn: () =>
      apiFetch<{ data: CategoryTree[] }>("/api/categories").then((r) => r.data),
  });
}

/** Create category mutation */
export function useCreateCategory() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<{ data: CategoryRecord }>("/api/categories", {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogCategoryKeys.lists() });
    },
  });
}

/** Update category mutation */
export function useUpdateCategory() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCategoryInput) =>
      apiFetch<{ data: CategoryRecord }>(`/api/categories/${id}`, {
        method: "PUT",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogCategoryKeys.lists() });
    },
  });
}

/** Delete category mutation */
export function useDeleteCategory() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/categories/${id}`, {
        method: "DELETE",
      }),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogCategoryKeys.lists() });
    },
  });
}
