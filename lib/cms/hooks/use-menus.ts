"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";
import type {
  MenuWithItems,
  MenuItemTree,
  ItemType,
  ReorderItem,
} from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface MenuRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateMenuInput {
  name: string;
}

interface UpdateMenuInput {
  id: string;
  name: string;
}

interface CreateMenuItemInput {
  menuId: string;
  label: string;
  url?: string;
  icon?: string;
  itemType?: ItemType;
  parentId?: string | null;
  megaColumns?: number;
}

interface UpdateMenuItemInput {
  menuId: string;
  itemId: string;
  label?: string;
  url?: string;
  icon?: string;
  itemType?: ItemType;
  megaColumns?: number;
}

interface DeleteMenuItemInput {
  menuId: string;
  itemId: string;
}

interface ReorderMenuItemsInput {
  menuId: string;
  items: ReorderItem[];
}

interface SetActiveMenuInput {
  menuId: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const menuKeys = {
  all: ["menus"] as const,
  lists: () => [...menuKeys.all, "list"] as const,
  list: () => [...menuKeys.lists()] as const,
  details: () => [...menuKeys.all, "detail"] as const,
  detail: (id: string) => [...menuKeys.details(), id] as const,
  active: () => [...menuKeys.all, "active"] as const,
};

// ── Query Hooks ──────────────────────────────────────────────────────────────

/** List all menus ordered by creation date */
export function useMenus() {
  return useQuery({
    queryKey: menuKeys.list(),
    queryFn: () =>
      apiFetch<{ data: MenuRecord[] }>("/api/menus").then((r) => r.data),
  });
}

/** Single menu with hierarchical items */
export function useMenu(id: string) {
  return useQuery({
    queryKey: menuKeys.detail(id),
    queryFn: () =>
      apiFetch<{ data: MenuWithItems }>(`/api/menus/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Active menu for preview */
export function useActiveMenu() {
  return useQuery({
    queryKey: menuKeys.active(),
    queryFn: () =>
      apiFetch<{ data: MenuWithItems }>("/api/menus/active").then(
        (r) => r.data
      ),
  });
}

// ── Menu Mutations ───────────────────────────────────────────────────────────

/** Create menu mutation */
export function useCreateMenu() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMenuInput) =>
      apiFetch<{ data: MenuRecord }>("/api/menus", {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: menuKeys.lists() });
    },
  });
}

/** Update menu mutation with optimistic update */
export function useUpdateMenu() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateMenuInput) =>
      apiFetch<{ data: MenuRecord }>(`/api/menus/${id}`, {
        method: "PUT",
        body: input,
      }).then((r) => r.data),

    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: menuKeys.detail(variables.id) });
      const previous = qc.getQueryData<MenuWithItems>(
        menuKeys.detail(variables.id)
      );

      if (previous) {
        qc.setQueryData<MenuWithItems>(menuKeys.detail(variables.id), {
          ...previous,
          name: variables.name,
        });
      }

      return { previous };
    },

    onError: (_err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(menuKeys.detail(variables.id), context.previous);
      }
    },

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: menuKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: menuKeys.lists() });
      qc.invalidateQueries({ queryKey: menuKeys.active() });
    },
  });
}

/** Delete menu mutation with optimistic removal */
export function useDeleteMenu() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: { success: boolean } }>(`/api/menus/${id}`, {
        method: "DELETE",
      }),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: menuKeys.lists() });
      const previousLists = qc.getQueriesData<MenuRecord[]>({
        queryKey: menuKeys.lists(),
      });

      qc.setQueriesData<MenuRecord[]>(
        { queryKey: menuKeys.lists() },
        (old) => old?.filter((m) => m.id !== id)
      );

      return { previousLists };
    },

    onError: (_err, _id, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: menuKeys.lists() });
      qc.invalidateQueries({ queryKey: menuKeys.active() });
    },
  });
}

// ── Menu Item Mutations ──────────────────────────────────────────────────────

/** Create menu item mutation */
export function useCreateMenuItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ menuId, ...input }: CreateMenuItemInput) =>
      apiFetch<{ data: unknown }>(`/api/menus/${menuId}/items`, {
        method: "POST",
        body: input,
      }).then((r) => r.data),

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: menuKeys.detail(variables.menuId) });
      qc.invalidateQueries({ queryKey: menuKeys.active() });
    },
  });
}

/** Update menu item mutation with optimistic update */
export function useUpdateMenuItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ menuId, itemId, ...input }: UpdateMenuItemInput) =>
      apiFetch<{ data: unknown }>(`/api/menus/${menuId}/items/${itemId}`, {
        method: "PUT",
        body: input,
      }).then((r) => r.data),

    onMutate: async (variables) => {
      await qc.cancelQueries({
        queryKey: menuKeys.detail(variables.menuId),
      });
      const previous = qc.getQueryData<MenuWithItems>(
        menuKeys.detail(variables.menuId)
      );

      if (previous) {
        const updateItems = (items: MenuItemTree[]): MenuItemTree[] =>
          items.map((item) => ({
            ...item,
            ...(item.id === variables.itemId
              ? {
                  label: variables.label ?? item.label,
                  url: variables.url ?? item.url,
                  icon: variables.icon !== undefined ? variables.icon : item.icon,
                  itemType: variables.itemType ?? item.itemType,
                  megaColumns: variables.megaColumns ?? item.megaColumns,
                }
              : {}),
            children: updateItems(item.children),
          }));

        qc.setQueryData<MenuWithItems>(menuKeys.detail(variables.menuId), {
          ...previous,
          items: updateItems(previous.items),
        });
      }

      return { previous };
    },

    onError: (_err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(
          menuKeys.detail(variables.menuId),
          context.previous
        );
      }
    },

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: menuKeys.detail(variables.menuId) });
      qc.invalidateQueries({ queryKey: menuKeys.active() });
    },
  });
}

/** Delete menu item mutation */
export function useDeleteMenuItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ menuId, itemId }: DeleteMenuItemInput) =>
      apiFetch<{ data: { success: boolean } }>(
        `/api/menus/${menuId}/items/${itemId}`,
        { method: "DELETE" }
      ),

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: menuKeys.detail(variables.menuId) });
      qc.invalidateQueries({ queryKey: menuKeys.active() });
    },
  });
}

// ── Reorder & Active Mutations ───────────────────────────────────────────────

/** Reorder menu items mutation with optimistic update */
export function useReorderMenuItems() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ menuId, items }: ReorderMenuItemsInput) =>
      apiFetch<{ data: { success: boolean } }>(`/api/menus/${menuId}/reorder`, {
        method: "PUT",
        body: { items },
      }),

    onMutate: async (variables) => {
      await qc.cancelQueries({
        queryKey: menuKeys.detail(variables.menuId),
      });
      const previous = qc.getQueryData<MenuWithItems>(
        menuKeys.detail(variables.menuId)
      );

      return { previous };
    },

    onError: (_err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(
          menuKeys.detail(variables.menuId),
          context.previous
        );
      }
    },

    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: menuKeys.detail(variables.menuId) });
      qc.invalidateQueries({ queryKey: menuKeys.active() });
    },
  });
}

/** Set a menu as the active navigation menu */
export function useSetActiveMenu() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ menuId }: SetActiveMenuInput) =>
      apiFetch<{ data: { success: boolean } }>(
        `/api/menus/${menuId}/set-active`,
        { method: "POST" }
      ),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: menuKeys.active() });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
