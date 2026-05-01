"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { PostNamespaceGroup, Locale, PostStatus, PostType } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface PostRecord {
  id: string;
  title: string;
  slug: string;
  locale: Locale;
  namespace: string;
  postType: PostType;
  status: PostStatus;
  content: unknown;
  excerpt: string | null;
  featuredImage: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  ogImage: string | null;
  canonicalUrl: string | null;
  robotsDirective: string | null;
  authorId: string;
  publishedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  categories?: { id: string; name: string; slug: string }[];
  tags?: { id: string; name: string; slug: string }[];
}

interface PostFilters {
  locale?: Locale;
  status?: "draft" | "published";
  postType?: PostType;
}

interface CreatePostInput {
  title: string;
  postType?: PostType;
  locale?: Locale;
  content?: unknown;
  excerpt?: string;
  featuredImage?: string;
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  ogImage?: string;
  canonicalUrl?: string;
  robotsDirective?: string;
}

interface UpdatePostInput {
  id: string;
  title?: string;
  slug?: string;
  content?: unknown;
  excerpt?: string;
  featuredImage?: string;
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  ogImage?: string;
  canonicalUrl?: string;
  robotsDirective?: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const postKeys = {
  all: ["posts"] as const,
  lists: () => [...postKeys.all, "list"] as const,
  list: (filters?: PostFilters) => [...postKeys.lists(), filters] as const,
  details: () => [...postKeys.all, "detail"] as const,
  detail: (id: string) => [...postKeys.details(), id] as const,
  trash: () => [...postKeys.all, "trash"] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List posts with optional filters, returns PostNamespaceGroup[] */
export function usePosts(filters?: PostFilters) {
  const params = new URLSearchParams();
  if (filters?.locale) params.set("locale", filters.locale);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.postType) params.set("postType", filters.postType);
  const qs = params.toString();

  return useQuery({
    queryKey: postKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: PostNamespaceGroup[] }>(
        `/api/posts${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });
}

/** Single post query */
export function usePost(id: string) {
  return useQuery({
    queryKey: postKeys.detail(id),
    queryFn: () =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** List trashed posts */
export function useTrashedPosts() {
  return useQuery({
    queryKey: postKeys.trash(),
    queryFn: () =>
      apiFetch<{ data: (PostRecord & { daysRemaining: number })[] }>(
        "/api/posts/trash"
      ).then((r) => r.data),
  });
}

/** Create post mutation */
export function useCreatePost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) =>
      apiFetch<{ data: PostRecord }>("/api/posts", {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}

/** Update post mutation with optimistic cache update */
export function useUpdatePost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdatePostInput) =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}`, {
        method: "PUT",
        body: input,
      }).then((r) => r.data),

    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: postKeys.detail(variables.id) });
      const previous = qc.getQueryData<PostRecord>(
        postKeys.detail(variables.id)
      );

      if (previous) {
        qc.setQueryData<PostRecord>(postKeys.detail(variables.id), {
          ...previous,
          ...variables,
        });
      }

      return { previous };
    },

    onError: (_err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(postKeys.detail(variables.id), context.previous);
      }
    },

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: postKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}

/** Soft delete (trash) post mutation */
export function useDeletePost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}`, {
        method: "DELETE",
      }).then((r) => r.data),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: postKeys.lists() });
      const previousLists = qc.getQueriesData<PostNamespaceGroup[]>({
        queryKey: postKeys.lists(),
      });

      qc.setQueriesData<PostNamespaceGroup[]>(
        { queryKey: postKeys.lists() },
        (old) =>
          old?.filter(
            (g) => g.locales.en?.id !== id && g.locales.ar?.id !== id
          )
      );

      return { previousLists };
    },

    onError: (_err, _id, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: postKeys.lists() });
      qc.invalidateQueries({ queryKey: postKeys.trash() });
    },
  });
}

/** Publish post mutation with optimistic update */
export function usePublishPost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}/publish`, {
        method: "POST",
      }).then((r) => r.data),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: postKeys.detail(id) });
      const previous = qc.getQueryData<PostRecord>(postKeys.detail(id));

      if (previous) {
        qc.setQueryData<PostRecord>(postKeys.detail(id), {
          ...previous,
          status: "published",
        });
      }

      return { previous };
    },

    onError: (_err, id, context) => {
      if (context?.previous) {
        qc.setQueryData(postKeys.detail(id), context.previous);
      }
    },

    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: postKeys.detail(id) });
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}

/** Unpublish post mutation with optimistic update */
export function useUnpublishPost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}/unpublish`, {
        method: "POST",
      }).then((r) => r.data),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: postKeys.detail(id) });
      const previous = qc.getQueryData<PostRecord>(postKeys.detail(id));

      if (previous) {
        qc.setQueryData<PostRecord>(postKeys.detail(id), {
          ...previous,
          status: "draft",
        });
      }

      return { previous };
    },

    onError: (_err, id, context) => {
      if (context?.previous) {
        qc.setQueryData(postKeys.detail(id), context.previous);
      }
    },

    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: postKeys.detail(id) });
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}

/** Clone post to AR locale mutation */
export function useClonePostLocale() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}/clone-locale`, {
        method: "POST",
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}

/** Restore post from trash mutation */
export function useRestorePost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: PostRecord }>(`/api/posts/${id}/restore`, {
        method: "POST",
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: postKeys.lists() });
      qc.invalidateQueries({ queryKey: postKeys.trash() });
    },
  });
}

/** Permanent delete post mutation */
export function usePermanentDeletePost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/posts/${id}/permanent`, {
        method: "DELETE",
      }),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: postKeys.trash() });
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}
