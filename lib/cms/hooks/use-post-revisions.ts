"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import { postKeys } from "./use-posts";

// ── Types ────────────────────────────────────────────────────────────────────

interface PostRevisionSummary {
  id: string;
  revisionNumber: number;
  action: "save" | "rollback";
  titleSnapshot: string;
  createdAt: string;
  userId: string;
}

interface RollbackPostInput {
  postId: string;
  revisionId: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const postRevisionKeys = {
  all: ["postRevisions"] as const,
  list: (postId: string) => [...postRevisionKeys.all, postId] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** List revisions for a post */
export function usePostRevisions(postId: string) {
  return useQuery({
    queryKey: postRevisionKeys.list(postId),
    queryFn: () =>
      apiFetch<{ data: PostRevisionSummary[] }>(
        `/api/posts/${postId}/revisions`
      ).then((r) => r.data),
    enabled: !!postId,
  });
}

/** Rollback post to a specific revision */
export function useRollbackPost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, revisionId }: RollbackPostInput) =>
      apiFetch<{ data: unknown }>(
        `/api/posts/${postId}/revisions/${revisionId}/rollback`,
        { method: "POST" }
      ).then((r) => r.data),

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({
        queryKey: postRevisionKeys.list(variables.postId),
      });
      qc.invalidateQueries({
        queryKey: postKeys.detail(variables.postId),
      });
      qc.invalidateQueries({ queryKey: postKeys.lists() });
    },
  });
}
