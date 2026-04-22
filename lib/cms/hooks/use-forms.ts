"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { FormFieldConfig } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface FormDefinition {
  id: string;
  name: string;
  fields: FormFieldConfig[];
  salesforceEndpoint: string | null;
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FormSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  sourcePageSlug: string | null;
  sourceLocale: string | null;
  createdAt: string;
}

interface FormSubmissionGroup {
  form: FormDefinition;
  submissions: FormSubmission[];
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const formKeys = {
  all: ["forms"] as const,
  submissions: () => [...formKeys.all, "submissions"] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Submissions list grouped by form */
export function useFormSubmissions() {
  return useQuery({
    queryKey: formKeys.submissions(),
    queryFn: () =>
      apiFetch<{ data: FormSubmissionGroup[] }>("/api/submissions").then(
        (r) => r.data
      ),
  });
}
