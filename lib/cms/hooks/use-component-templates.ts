"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ComponentInstance } from "../../page-builder/types";

export interface ComponentTemplateRecord {
  id: string;
  name: string;
  description: string;
  scope: "block" | "page";
  thumbnail: string | null;
  content: ComponentInstance[];
  zones: Record<string, ComponentInstance[]>;
  isBuiltIn: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveComponentTemplateInput {
  name: string;
  description?: string;
  scope?: "block" | "page";
  thumbnail?: string | null;
  content: ComponentInstance[];
  zones?: Record<string, ComponentInstance[]>;
}

export const componentTemplateKeys = {
  all: ["component-templates"] as const,
  list: () => [...componentTemplateKeys.all, "list"] as const,
  detail: (id: string) => [...componentTemplateKeys.all, "detail", id] as const,
};

export function useComponentTemplates() {
  return useQuery({
    queryKey: componentTemplateKeys.list(),
    queryFn: () =>
      apiFetch<{ data: ComponentTemplateRecord[] }>(
        "/api/component-templates"
      ).then((r) => r.data),
  });
}

export function useSaveComponentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveComponentTemplateInput) =>
      apiFetch<{ data: ComponentTemplateRecord }>(
        "/api/component-templates",
        { method: "POST", body: input }
      ).then((r) => r.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: componentTemplateKeys.list() });
    },
  });
}

export function useDeleteComponentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(
        `/api/component-templates/${id}`,
        { method: "DELETE" }
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: componentTemplateKeys.list() });
    },
  });
}
