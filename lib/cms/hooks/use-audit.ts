"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { AuditAction, AuditEntityType } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditFilters {
  entityType?: string;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const auditKeys = {
  all: ["audit"] as const,
  list: (filters?: AuditFilters) => [...auditKeys.all, filters] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Audit log entries with optional filters */
export function useAuditLog(filters?: AuditFilters) {
  const params = new URLSearchParams();
  if (filters?.entityType) params.set("entityType", filters.entityType);
  if (filters?.action) params.set("action", filters.action);
  if (filters?.userId) params.set("userId", filters.userId);
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);
  const qs = params.toString();

  return useQuery({
    queryKey: auditKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: AuditEntry[] }>(
        `/api/audit${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });
}
