"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { PageNamespaceGroup, Locale, PageStatus } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface PageRecord {
  id: string;
  title: string;
  slug: string;
  locale: Locale;
  namespace: string;
  status: PageStatus;
  isSystem: boolean;
  data: unknown;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageFilters {
  locale?: Locale;
  status?: PageStatus;
}

interface CreatePageInput {
  title: string;
  locale?: Locale;
  data?: unknown;
  metaTitle?: string;
  metaDescription?: string;
}

interface UpdatePageInput {
  id: string;
  title?: string;
  slug?: string;
  data?: unknown;
  metaTitle?: string;
  metaDescription?: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const pageKeys = {
  all: ["pages"] as const,
  lists: () => [...pageKeys.all, "list"] as const,
  list: (filters?: PageFilters) => [...pageKeys.lists(), filters] as const,
  details: () => [...pageKeys.all, "detail"] as const,
  detail: (id: string) => [...pageKeys.details(), id] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List pages with optional locale/status filters, returns PageNamespaceGroup[] */
export function usePages(filters?: PageFilters) {
  const params = new URLSearchParams();
  if (filters?.locale) params.set("locale", filters.locale);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString();

  return useQuery({
    queryKey: pageKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: PageNamespaceGroup[] }>(
        `/api/pages${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });
}

/** Single page query */
export function usePage(id: string) {
  return useQuery({
    queryKey: pageKeys.detail(id),
    queryFn: () =>
      apiFetch<{ data: PageRecord }>(`/api/pages/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Create page mutation with optimistic cache update */
export function useCreatePage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePageInput) =>
      apiFetch<{ data: PageRecord }>("/api/pages", {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}

/** Update page mutation with optimistic cache update */
export function useUpdatePage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdatePageInput) =>
      apiFetch<{ data: PageRecord }>(`/api/pages/${id}`, {
        method: "PUT",
        body: input,
      }).then((r) => r.data),

    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: pageKeys.detail(variables.id) });
      const previous = qc.getQueryData<PageRecord>(
        pageKeys.detail(variables.id)
      );

      if (previous) {
        qc.setQueryData<PageRecord>(pageKeys.detail(variables.id), {
          ...previous,
          ...variables,
        });
      }

      return { previous };
    },

    onError: (_err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(pageKeys.detail(variables.id), context.previous);
      }
    },

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: pageKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}

/** Delete page mutation with optimistic removal */
export function useDeletePage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/pages/${id}`, {
        method: "DELETE",
      }),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pageKeys.lists() });
      const previousLists = qc.getQueriesData<PageNamespaceGroup[]>({
        queryKey: pageKeys.lists(),
      });

      // Optimistically remove from all list caches
      qc.setQueriesData<PageNamespaceGroup[]>(
        { queryKey: pageKeys.lists() },
        (old) =>
          old?.filter(
            (g) => g.locales.en?.id !== id && g.locales.ar?.id !== id
          )
      );

      return { previousLists };
    },

    onError: (_err, _id, context) => {
      // Rollback all list caches
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}

/** Publish page mutation */
export function usePublishPage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PageRecord }>(`/api/pages/${id}/publish`, {
        method: "POST",
      }).then((r) => r.data),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pageKeys.detail(id) });
      const previous = qc.getQueryData<PageRecord>(pageKeys.detail(id));

      if (previous) {
        qc.setQueryData<PageRecord>(pageKeys.detail(id), {
          ...previous,
          status: "published",
        });
      }

      return { previous };
    },

    onError: (_err, id, context) => {
      if (context?.previous) {
        qc.setQueryData(pageKeys.detail(id), context.previous);
      }
    },

    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: pageKeys.detail(id) });
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}

/** Unpublish page mutation */
export function useUnpublishPage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PageRecord }>(`/api/pages/${id}/unpublish`, {
        method: "POST",
      }).then((r) => r.data),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pageKeys.detail(id) });
      const previous = qc.getQueryData<PageRecord>(pageKeys.detail(id));

      if (previous) {
        qc.setQueryData<PageRecord>(pageKeys.detail(id), {
          ...previous,
          status: "draft",
        });
      }

      return { previous };
    },

    onError: (_err, id, context) => {
      if (context?.previous) {
        qc.setQueryData(pageKeys.detail(id), context.previous);
      }
    },

    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: pageKeys.detail(id) });
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}

/** Clone page to AR locale mutation */
export function useCloneLocale() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PageRecord }>(`/api/pages/${id}/clone-locale`, {
        method: "POST",
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}

/** Set a page as the home page */
export function useSetHomePage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean; homePageId: string } }>(
        `/api/pages/${id}/set-home`,
        { method: "POST" }
      ).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
