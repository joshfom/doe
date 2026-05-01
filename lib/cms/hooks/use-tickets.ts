"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TicketRecord {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  requestType: string;
  communityId: string | null;
  projectId: string | null;
  unitNumber: string | null;
  requestData: Record<string, unknown> | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  source: string;
  assigneeId: string | null;
  createdBy: string | null;
  externalCrmId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface TicketFilters {
  status?: string;
  priority?: string;
  category?: string;
  assigneeId?: string;
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  requestType?: string;
  communityId?: string;
  projectId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface TicketListResponse {
  data: TicketRecord[];
  total: number;
  statusCounts: Record<string, number>;
}

interface TicketCategoryRecord {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface TicketNoteRecord {
  id: string;
  ticketId: string;
  authorId: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
}

export interface AuditTrailRecord {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

export interface TicketDetailResponse {
  ticket: TicketRecord;
  notes: TicketNoteRecord[];
  auditTrail: AuditTrailRecord[];
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const ticketKeys = {
  all: ["tickets"] as const,
  list: (filters?: TicketFilters) => [...ticketKeys.all, "list", filters] as const,
  detail: (id: string) => [...ticketKeys.all, "detail", id] as const,
  categories: () => [...ticketKeys.all, "categories"] as const,
  approvals: (ticketId: string) =>
    [...ticketKeys.all, "approvals", ticketId] as const,
  pendingApprovals: (scope?: string) =>
    [...ticketKeys.all, "pending-approvals", scope] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Paginated ticket list with filtering, search, and status counts */
export function useTickets(filters?: TicketFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.priority) params.set("priority", filters.priority);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.requestType) params.set("requestType", filters.requestType);
  if (filters?.communityId) params.set("communityId", filters.communityId);
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.search) params.set("search", filters.search);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString();

  return useQuery({
    queryKey: ticketKeys.list(filters),
    queryFn: () =>
      apiFetch<TicketListResponse>(
        `/api/tickets${qs ? `?${qs}` : ""}`
      ),
  });
}

/** Fetch active ticket categories for filter dropdowns */
export function useTicketCategories() {
  return useQuery({
    queryKey: ticketKeys.categories(),
    queryFn: () =>
      apiFetch<{ data: TicketCategoryRecord[] }>("/api/ticket-categories").then(
        (r) => r.data
      ),
  });
}

/** Fetch a single ticket with notes and audit trail */
export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: () =>
      apiFetch<{ data: TicketDetailResponse }>(`/api/tickets/${id}`).then(
        (r) => r.data
      ),
    enabled: !!id,
  });
}

/** Mutation: transition ticket status */
export function useTransitionStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, newStatus, assigneeId }: { id: string; newStatus: string; assigneeId?: string }) =>
      apiFetch<{ data: TicketRecord }>(`/api/tickets/${id}/status`, {
        method: "PATCH",
        body: { newStatus, assigneeId },
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ticketKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

/** Mutation: assign/reassign ticket */
export function useAssignTicket() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string }) =>
      apiFetch<{ data: TicketRecord }>(`/api/tickets/${id}/assign`, {
        method: "PATCH",
        body: { assigneeId },
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ticketKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

/** Mutation: create a new ticket */
export function useCreateTicket() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      subject: string;
      description: string;
      contactName: string;
      contactEmail: string;
      contactPhone?: string;
      priority?: string;
      category?: string;
      source: string;
      requestType?: string;
      communityId?: string | null;
      projectId?: string | null;
      unitNumber?: string | null;
      requestData?: unknown;
      scheduledStart?: string | null;
      scheduledEnd?: string | null;
    }) =>
      apiFetch<{ data: { ticketId: string; ticketNumber: string } }>("/api/tickets", {
        method: "POST",
        body: input,
      }).then((r) => r.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

/** Mutation: update ticket request (type / community / project / unit / requestData / scheduling) */
export function useUpdateTicketRequest(ticketId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      requestType?: string;
      communityId?: string | null;
      projectId?: string | null;
      unitNumber?: string | null;
      requestData?: unknown;
      scheduledStart?: string | null;
      scheduledEnd?: string | null;
      priority?: string;
      category?: string | null;
    }) =>
      apiFetch<{ data: TicketRecord }>(`/api/tickets/${ticketId}/request`, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

/** Mutation: add a note to a ticket */
export function useAddNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, content, isInternal }: { id: string; content: string; isInternal?: boolean }) =>
      apiFetch<{ data: TicketNoteRecord }>(`/api/tickets/${id}/notes`, {
        method: "POST",
        body: { content, isInternal },
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ticketKeys.detail(variables.id) });
    },
  });
}

// ── Ticket approval hooks ────────────────────────────────────────────────────

export type TicketApprovalScope =
  | "noc"
  | "move_in"
  | "vendor_access"
  | "construction_material_delivery";

export type TicketApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface TicketApprovalRecord {
  id: string;
  ticketId: string;
  scope: TicketApprovalScope;
  status: TicketApprovalStatus;
  requestedBy: string | null;
  requestedByName: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Query: approvals for a ticket */
export function useTicketApprovals(ticketId: string) {
  return useQuery({
    queryKey: ticketKeys.approvals(ticketId),
    queryFn: () =>
      apiFetch<{ data: TicketApprovalRecord[] }>(
        `/api/tickets/${ticketId}/approvals`
      ).then((r) => r.data),
    enabled: Boolean(ticketId),
  });
}

/** Query: pending approvals across tickets (optionally filtered by scope) */
export function usePendingTicketApprovals(scope?: TicketApprovalScope) {
  return useQuery({
    queryKey: ticketKeys.pendingApprovals(scope),
    queryFn: () => {
      const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
      return apiFetch<{ data: TicketApprovalRecord[] }>(
        `/api/tickets/approvals/pending${qs}`
      ).then((r) => r.data);
    },
  });
}

/** Mutation: open (or reopen) an approval request */
export function useRequestTicketApproval(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: TicketApprovalScope }) =>
      apiFetch<{ data: TicketApprovalRecord }>(
        `/api/tickets/${ticketId}/approvals`,
        { method: "POST", body: input }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.approvals(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

/** Mutation: approve or reject an approval */
export function useDecideTicketApproval(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      approvalId,
      decision,
      comment,
    }: {
      approvalId: string;
      decision: "approved" | "rejected";
      comment?: string;
    }) =>
      apiFetch<{ data: TicketApprovalRecord }>(
        `/api/tickets/approvals/${approvalId}`,
        { method: "PATCH", body: { decision, comment } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.approvals(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

/** Mutation: cancel a pending approval */
export function useCancelTicketApproval(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      approvalId,
      reason,
    }: {
      approvalId: string;
      reason?: string;
    }) =>
      apiFetch<{ data: TicketApprovalRecord }>(
        `/api/tickets/approvals/${approvalId}`,
        { method: "DELETE", body: { reason } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.approvals(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}
