"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaItem {
  id: string;
  filename: string;
  altText: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  storageUrl: string;
  storageBackend: "local" | "s3" | "r2";
  createdAt: string;
}

interface UploadMediaInput {
  file: File;
  altText?: string;
}

interface UpdateMediaAltInput {
  id: string;
  altText: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const mediaKeys = {
  all: ["media"] as const,
  lists: () => [...mediaKeys.all, "list"] as const,
  list: (search?: string, mimeType?: string) =>
    [...mediaKeys.lists(), { search, mimeType }] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Media list with optional search and MIME type filter */
export function useMedia(search?: string, mimeType?: string) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (mimeType) params.set("mimeType", mimeType);
  const qs = params.toString();

  return useQuery({
    queryKey: mediaKeys.list(search, mimeType),
    queryFn: () =>
      apiFetch<{ data: MediaItem[] }>(
        `/api/media${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });
}

/** Upload media mutation (multipart form data) */
export function useUploadMedia() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ file, altText }: UploadMediaInput) => {
      const formData = new FormData();
      formData.append("file", file);
      if (altText) formData.append("altText", altText);

      return apiFetch<{ data: MediaItem }>("/api/media", {
        method: "POST",
        body: formData,
      }).then((r) => r.data);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: mediaKeys.lists() });
    },
  });
}

/** Delete media with reference check */
export function useDeleteMedia() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/media/${id}`, {
        method: "DELETE",
      }),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: mediaKeys.lists() });
      const previousLists = qc.getQueriesData<MediaItem[]>({
        queryKey: mediaKeys.lists(),
      });

      // Optimistically remove from all list caches
      qc.setQueriesData<MediaItem[]>(
        { queryKey: mediaKeys.lists() },
        (old) => old?.filter((item) => item.id !== id)
      );

      return { previousLists };
    },

    onError: (_err, _id, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: mediaKeys.lists() });
    },
  });
}

/** Update media alt text */
export function useUpdateMediaAlt() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, altText }: UpdateMediaAltInput) =>
      apiFetch<{ data: MediaItem }>(`/api/media/${id}`, {
        method: "PUT",
        body: { altText },
      }).then((r) => r.data),

    onMutate: async ({ id, altText }) => {
      await qc.cancelQueries({ queryKey: mediaKeys.lists() });
      const previousLists = qc.getQueriesData<MediaItem[]>({
        queryKey: mediaKeys.lists(),
      });

      // Optimistically update alt text in all list caches
      qc.setQueriesData<MediaItem[]>(
        { queryKey: mediaKeys.lists() },
        (old) =>
          old?.map((item) =>
            item.id === id ? { ...item, altText } : item
          )
      );

      return { previousLists };
    },

    onError: (_err, _vars, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: mediaKeys.lists() });
    },
  });
}
