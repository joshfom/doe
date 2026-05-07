"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ContentModule, ApprovalDecisionValue } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface ApproverRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  position: number;
}

interface ApprovalConfigRecord {
  id: string;
  contentModule: ContentModule;
  enabled: boolean;
  updatedAt: string;
  approvers: ApproverRecord[];
}

interface UpdateApprovalConfigInput {
  module: ContentModule;
  enabled?: boolean;
  approverIds?: string[];
  approvers?: { userId: string; position: number }[];
}

interface ApprovalRequestDetail {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  submitterName: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  decisions: ApprovalDecisionRecord[];
}

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  approverName: string;
  decision: ApprovalDecisionValue;
  comment: string | null;
  chainStep: number;
  createdAt: string;
}

interface PendingApprovalItem {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  submitterName: string;
  contentTitle: string;
  status: string;
  createdAt: string;
}

interface ContentApprovalStatus {
  request: {
    id: string;
    status: string;
    currentStep: number;
    createdAt: string;
    resolvedAt: string | null;
  } | null;
  currentStep: number;
  totalSteps: number;
  chain: { userId: string; userName: string; position: number }[];
  decisions: ApprovalDecisionRecord[];
  // Legacy fields for backwards compatibility
  approved: number;
  total: number;
}

interface SubmitDecisionInput {
  id: string;
  decision: ApprovalDecisionValue;
  comment?: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const approvalKeys = {
  all: ["approvals"] as const,
  config: () => [...approvalKeys.all, "config"] as const,
  pending: () => [...approvalKeys.all, "pending"] as const,
  detail: (id: string) => [...approvalKeys.all, "detail", id] as const,
  contentStatus: (module: string, contentId: string) =>
    [...approvalKeys.all, "content", module, contentId] as const,
  pendingDraft: (pageId: string) =>
    [...approvalKeys.all, "pendingDraft", pageId] as const,
  liveData: (pageId: string) =>
    [...approvalKeys.all, "liveData", pageId] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Fetch all module approval configs with assigned approvers */
export function useApprovalConfig() {
  return useQuery({
    queryKey: approvalKeys.config(),
    queryFn: () =>
      apiFetch<{ data: ApprovalConfigRecord[] }>("/api/approval-config").then(
        (r) => r.data
      ),
  });
}

/** Update approval toggle + approvers for a single module (with optimistic update) */
export function useUpdateApprovalConfig() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ module: moduleName, ...input }: UpdateApprovalConfigInput) =>
      apiFetch<{ data: ApprovalConfigRecord }>(
        `/api/approval-config/${moduleName}`,
        { method: "PUT", body: input }
      ).then((r) => r.data),

    onMutate: async (variables) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: approvalKeys.config() });

      // Snapshot previous value
      const previous = qc.getQueryData<ApprovalConfigRecord[]>(approvalKeys.config());

      // Optimistically update the cache
      if (previous) {
        const updated = previous.map((config) => {
          if (config.contentModule !== variables.module) return config;
          return {
            ...config,
            enabled: variables.enabled ?? config.enabled,
            approvers: variables.approvers
              ? variables.approvers.map((a, i) => ({
                  id: `optimistic-${i}`,
                  userId: a.userId,
                  userName: config.approvers.find((x) => x.userId === a.userId)?.userName ?? "",
                  userEmail: config.approvers.find((x) => x.userId === a.userId)?.userEmail ?? "",
                  position: a.position,
                }))
              : config.approvers,
            updatedAt: new Date().toISOString(),
          };
        });
        qc.setQueryData(approvalKeys.config(), updated);
      }

      return { previous };
    },

    onError: (_err, _variables, context) => {
      // Roll back to the previous value on error
      if (context?.previous) {
        qc.setQueryData(approvalKeys.config(), context.previous);
      }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: approvalKeys.config() });
    },
  });
}

/** List pending approval requests for the current user */
export function usePendingApprovals() {
  return useQuery({
    queryKey: approvalKeys.pending(),
    queryFn: () =>
      apiFetch<{ data: PendingApprovalItem[] }>("/api/approvals/pending").then(
        (r) => r.data
      ),
  });
}

/** Fetch a single approval request with all decisions */
export function useApprovalDetail(id: string) {
  return useQuery({
    queryKey: approvalKeys.detail(id),
    queryFn: () =>
      apiFetch<{ data: ApprovalRequestDetail }>(`/api/approvals/${id}`).then(
        (r) => r.data
      ),
    enabled: !!id,
  });
}

/** Submit an approve/reject decision on an approval request */
export function useSubmitDecision() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: SubmitDecisionInput) =>
      apiFetch<{ data: unknown }>(`/api/approvals/${id}/decide`, {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: approvalKeys.pending() });
      qc.invalidateQueries({ queryKey: approvalKeys.detail(variables.id) });
      // Also invalidate content status so the page detail view refreshes
      qc.invalidateQueries({ queryKey: approvalKeys.all });
    },
  });
}

/**
 * DEMO ONLY: reopen a resolved approval request so the presenter can re-run
 * the chain. Returns the updated request id, status, and currentStep.
 */
export function useDemoReopenApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { id: string; status: string; currentStep: number } }>(
        `/api/approvals/${id}/demo-reopen`,
        { method: "POST" }
      ).then((r) => r.data),
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: approvalKeys.pending() });
      qc.invalidateQueries({ queryKey: approvalKeys.detail(id) });
      qc.invalidateQueries({ queryKey: approvalKeys.all });
    },
  });
}

/** Get approval status and progress for a specific content item */
export function useContentApprovalStatus(
  module: string,
  contentId: string
) {
  return useQuery({
    queryKey: approvalKeys.contentStatus(module, contentId),
    queryFn: () =>
      apiFetch<{ data: ContentApprovalStatus }>(
        `/api/approvals/content/${module}/${contentId}`
      ).then((r) => r.data),
    enabled: !!module && !!contentId,
  });
}

/** Fetch the pending draft data for a page (returns undefined if no pending draft exists) */
export function usePendingDraft(pageId: string) {
  return useQuery({
    queryKey: approvalKeys.pendingDraft(pageId),
    queryFn: async () => {
      try {
        const res = await apiFetch<{ data: unknown }>(
          `/api/pages/${pageId}/pending-draft`
        );
        return res.data;
      } catch (err: unknown) {
        // 404 means no pending draft — return undefined gracefully
        if (
          err &&
          typeof err === "object" &&
          "error" in err &&
          (err as { error?: string }).error === "No pending draft"
        ) {
          return undefined;
        }
        throw err;
      }
    },
    enabled: !!pageId,
  });
}

/** Fetch the current live page data regardless of approval status */
export function useLiveData(pageId: string) {
  return useQuery({
    queryKey: approvalKeys.liveData(pageId),
    queryFn: () =>
      apiFetch<{ data: unknown }>(`/api/pages/${pageId}/live-data`).then(
        (r) => r.data
      ),
    enabled: !!pageId,
  });
}
