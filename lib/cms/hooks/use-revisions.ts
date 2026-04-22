"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import { pageKeys } from "./use-pages";

// ── Types ────────────────────────────────────────────────────────────────────

interface RevisionSummary {
  id: string;
  revisionNumber: number;
  action: "save" | "rollback";
  createdAt: string;
  userId: string;
}

interface RollbackInput {
  pageId: string;
  revisionId: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const revisionKeys = {
  all: ["revisions"] as const,
  list: (pageId: string) => [...revisionKeys.all, pageId] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Revision history list for a page */
export function useRevisions(pageId: string) {
  return useQuery({
    queryKey: revisionKeys.list(pageId),
    queryFn: () =>
      apiFetch<{ data: RevisionSummary[] }>(
        `/api/revisions/${pageId}`
      ).then((r) => r.data),
    enabled: !!pageId,
  });
}

/** Rollback to a specific revision */
export function useRollback() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId, revisionId }: RollbackInput) =>
      apiFetch<{ data: unknown }>(
        `/api/revisions/${pageId}/rollback/${revisionId}`,
        { method: "POST" }
      ).then((r) => r.data),

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({
        queryKey: revisionKeys.list(variables.pageId),
      });
      qc.invalidateQueries({
        queryKey: pageKeys.detail(variables.pageId),
      });
      qc.invalidateQueries({ queryKey: pageKeys.lists() });
    },
  });
}
