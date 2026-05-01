"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";

interface UserRecord {
  id: string;
  name: string;
  email: string;
}

export const userKeys = {
  all: ["users"] as const,
  list: () => [...userKeys.all, "list"] as const,
};

/** Fetch all users (id, name, email) for pickers */
export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: () =>
      apiFetch<{ data: UserRecord[] }>("/api/users").then((r) => r.data),
  });
}
