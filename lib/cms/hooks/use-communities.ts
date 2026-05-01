"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type {
  CommunityStatus,
  ProjectStatus,
  ProjectFloorplan,
  ProjectAmenity,
  ProjectLocationHighlight,
  ProjectPaymentPlan,
} from "../types";

// ── Records ──────────────────────────────────────────────────────────────────

export interface CommunityRecord {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  locationLat: number | null;
  locationLng: number | null;
  heroImageId: string | null;
  logoImageId: string | null;
  status: CommunityStatus;
  seoMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  communityId: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  shortDescriptionEn: string | null;
  shortDescriptionAr: string | null;
  longDescriptionEn: string | null;
  longDescriptionAr: string | null;
  status: ProjectStatus;
  heroImageId: string | null;
  logoImageId: string | null;
  brochurePdfId: string | null;
  brochureGallery: string[] | null;
  floorplans: ProjectFloorplan[] | null;
  amenities: ProjectAmenity[] | null;
  locationLat: number | null;
  locationLng: number | null;
  locationHighlights: ProjectLocationHighlight[] | null;
  paymentPlans: ProjectPaymentPlan[] | null;
  expectedHandoverDate: string | null;
  totalUnits: number | null;
  availableUnits: number | null;
  developer: string | null;
  contractor: string | null;
  architect: string | null;
  seoMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse<T> {
  data: T[];
}
interface ItemResponse<T> {
  data: T;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const communityKeys = {
  all: ["communities"] as const,
  list: (includeArchived?: boolean) =>
    ["communities", { includeArchived: !!includeArchived }] as const,
  detail: (id: string) => ["communities", id] as const,
};

export const projectKeys = {
  all: ["projects"] as const,
  list: (filters?: { communityId?: string; status?: string; includeArchived?: boolean }) =>
    ["projects", filters ?? {}] as const,
  detail: (id: string) => ["projects", id] as const,
};

// ── Communities hooks ────────────────────────────────────────────────────────

export function useCommunities(opts: { includeArchived?: boolean } = {}) {
  const params = new URLSearchParams();
  if (opts.includeArchived) params.set("includeArchived", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";

  return useQuery({
    queryKey: communityKeys.list(opts.includeArchived),
    queryFn: () =>
      apiFetch<ListResponse<CommunityRecord>>(`/api/communities${qs}`).then(
        (r) => r.data
      ),
  });
}

export function useCommunity(id: string | null | undefined) {
  return useQuery({
    queryKey: communityKeys.detail(id ?? ""),
    queryFn: () =>
      apiFetch<ItemResponse<CommunityRecord>>(`/api/communities/${id}`).then(
        (r) => r.data
      ),
    enabled: !!id,
  });
}

export function useCreateCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CommunityRecord> & { slug: string; nameEn: string }) =>
      apiFetch<ItemResponse<CommunityRecord>>(`/api/communities`, {
        method: "POST",
        body: input,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: communityKeys.all });
    },
  });
}

export function useUpdateCommunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CommunityRecord>) =>
      apiFetch<ItemResponse<CommunityRecord>>(`/api/communities/${id}`, {
        method: "PATCH",
        body: input,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: communityKeys.all });
      qc.invalidateQueries({ queryKey: communityKeys.detail(id) });
    },
  });
}

export function useArchiveCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/communities/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: communityKeys.all });
    },
  });
}

// ── Projects hooks ───────────────────────────────────────────────────────────

export function useProjects(
  filters: { communityId?: string; status?: string; includeArchived?: boolean } = {}
) {
  const params = new URLSearchParams();
  if (filters.communityId) params.set("communityId", filters.communityId);
  if (filters.status) params.set("status", filters.status);
  if (filters.includeArchived) params.set("includeArchived", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";

  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () =>
      apiFetch<ListResponse<ProjectRecord>>(`/api/projects${qs}`).then(
        (r) => r.data
      ),
  });
}

export function useProject(id: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ""),
    queryFn: () =>
      apiFetch<ItemResponse<ProjectRecord>>(`/api/projects/${id}`).then(
        (r) => r.data
      ),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Partial<ProjectRecord> & {
        communityId: string;
        slug: string;
        nameEn: string;
      }
    ) =>
      apiFetch<ItemResponse<ProjectRecord>>(`/api/projects`, {
        method: "POST",
        body: input,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProjectRecord>) =>
      apiFetch<ItemResponse<ProjectRecord>>(`/api/projects/${id}`, {
        method: "PATCH",
        body: input,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
      qc.invalidateQueries({ queryKey: projectKeys.detail(id) });
    },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}
