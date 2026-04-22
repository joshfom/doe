import type { PageData } from "@/lib/page-builder";

// Re-export for convenience
export type { PageData };

// Locale
export type Locale = "en" | "ar";
export const LOCALES: Locale[] = ["en", "ar"];
export const DEFAULT_LOCALE: Locale = "en";

// Page status
export type PageStatus = "draft" | "published";

// Form field types
export type FormFieldType = "text" | "email" | "phone" | "textarea" | "select" | "checkbox" | "radio";

export interface FormFieldConfig {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[]; // for select, radio
}

// Audit
export type AuditAction = "create" | "update" | "delete" | "publish" | "unpublish" | "rollback";
export type AuditEntityType = "page" | "media" | "form" | "settings";

// API response wrappers
export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  details?: Record<string, string>;
}

// Page with locale completion info for admin list
export interface PageNamespaceGroup {
  namespace: string;
  slug: string;
  isSystem: boolean;
  locales: {
    en?: { id: string; title: string; status: PageStatus };
    ar?: { id: string; title: string; status: PageStatus };
  };
}
