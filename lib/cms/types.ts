import type { PageData } from "@/lib/page-builder";

// Re-export for convenience
export type { PageData };

// Locale
export type Locale = "en" | "ar";
export const LOCALES: Locale[] = ["en", "ar"];
export const DEFAULT_LOCALE: Locale = "en";

// Content modules
export type ContentModule = "pages" | "blog" | "news" | "construction_updates";

// Approval
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalDecisionValue = "approved" | "rejected";

// Page status
export type PageStatus = "draft" | "published" | "pending_review";

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

// Ticket
export type TicketStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketSource = "manual" | "api" | "form";

// AI — Conversations
export type ConversationStatus = "active" | "resolved" | "handed_off" | "abandoned";

// AI — Appointments
export type AppointmentType = "site_visit" | "consultation" | "payment_discussion" | "maintenance_request";
export type AppointmentStatus = "confirmed" | "cancelled" | "rescheduled" | "completed";

// AI — Units
export type UnitStatus = "available" | "sold" | "reserved" | "rented" | "under_construction";
export type UnitType = "apartment" | "villa" | "townhouse" | "office";

// AI — Knowledge Base
export type KnowledgeSourceType = "manual" | "blog_sync" | "construction_update" | "faq" | "policy";

// AI — Messages
export type MessageRole = "user" | "assistant" | "system";

// Communities & Projects
export type CommunityStatus = "active" | "inactive" | "archived";
export type ProjectStatus =
  | "planning"
  | "pre_launch"
  | "selling"
  | "under_construction"
  | "handover"
  | "completed"
  | "archived";

export interface ProjectFloorplan {
  unitType: string;
  nameEn?: string;
  nameAr?: string;
  areaSqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  imageId?: string;
  pdfId?: string;
}

export interface ProjectAmenity {
  icon?: string;
  nameEn: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  imageId?: string;
}

export interface ProjectLocationHighlight {
  titleEn: string;
  titleAr?: string;
  distanceKm?: number;
}

export interface ProjectPaymentMilestone {
  pct: number;
  labelEn: string;
  labelAr?: string;
}

export interface ProjectPaymentPlan {
  nameEn: string;
  nameAr?: string;
  downPaymentPct?: number;
  milestones: ProjectPaymentMilestone[];
}

// Tickets — request types
export type TicketRequestType =
  | "general_inquiry"
  | "noc"
  | "move_in"
  | "move_out"
  | "gate_pass"
  | "technician_visit"
  | "construction_material_delivery"
  | "vendor_access"
  | "maintenance_request"
  // Off-plan / pre-handover (Bayn is still under construction)
  | "site_visit_booking"
  | "brochure_request"
  | "payment_milestone"
  | "oqood_assistance"
  | "mortgage_noc"
  | "construction_progress_inquiry"
  | "snag_submission"
  | "handover_appointment"
  | "hot_works_permit"
  | "work_at_height_permit"
  | "lift_usage_booking"
  | "inspection_request"
  // Sales / lead capture (Ora AI converts visitor interest into a tracked lead)
  | "lead_inquiry";

// Tickets — approval scopes
export type TicketApprovalScope =
  | "noc"
  | "move_in"
  | "vendor_access"
  | "construction_material_delivery"
  | "hot_works_permit"
  | "work_at_height_permit"
  | "handover_appointment"
  | "mortgage_noc";

export type TicketApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

// Audit
export type AuditAction = "create" | "update" | "delete" | "publish" | "unpublish" | "rollback" | "trash" | "restore" | "auto_purge" | "approval_submit" | "approval_decide" | "approval_auto_resolve" | "approve" | "reject" | "assign" | "revoke" | "add" | "remove" | "deny" | "ticket_create" | "ticket_assign" | "ticket_status_change" | "ticket_note_add" | "ticket_request_update" | "ticket_approval_request" | "ticket_approval_decide" | "ticket_approval_cancel" | "ai_conversation_create" | "ai_handoff" | "ai_appointment_create" | "ai_appointment_cancel" | "ai_kb_create" | "ai_kb_update" | "ai_kb_delete" | "ai_client_create" | "ai_client_update" | "ai_tenant_create" | "ai_tenant_update" | "ai_unit_create" | "ai_unit_update" | "community_create" | "community_update" | "community_archive" | "project_create" | "project_update" | "project_archive";
export type AuditEntityType = "page" | "media" | "form" | "settings" | "component_template" | "post" | "category" | "tag" | "menu" | "approval_request" | "notification" | "role_assignment" | "permission_change" | "access_denial" | "company_status_change" | "ticket" | "ticket_status_change" | "ticket_note" | "ticket_approval" | "ai_conversation" | "ai_appointment" | "ai_knowledge_document" | "ai_client" | "ai_tenant" | "ai_unit" | "community" | "project";

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

// Post types
export type PostType = "blog" | "news";
export type PostStatus = "draft" | "published" | "trashed" | "pending_review";

// Post with locale completion info for admin list (same pattern as PageNamespaceGroup)
export interface PostNamespaceGroup {
  namespace: string;
  slug: string;
  postType: PostType;
  locales: {
    en?: { id: string; title: string; status: PostStatus };
    ar?: { id: string; title: string; status: PostStatus };
  };
}

// Category with children for tree display
export interface CategoryTree {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  children: CategoryTree[];
}

// Share platforms
export type SharePlatform = "twitter" | "facebook" | "linkedin" | "whatsapp" | "copy_link";

// Menu item types
export type ItemType = "link" | "dropdown" | "mega";
export type DropdownType = "simple" | "mega";

// Menu item tree node (API response)
export interface MenuItemTree {
  id: string;
  menuId: string;
  parentId: string | null;
  label: string;
  url: string;
  icon: string | null;
  /** Translated labels per locale, e.g. { "ar": "اتصل بنا" } */
  translations?: Record<string, string> | null;
  itemType: ItemType;
  dropdownType: DropdownType | null;
  megaColumns: number;
  position: number;
  children: MenuItemTree[];
}

// Menu with nested items (API response)
export interface MenuWithItems {
  id: string;
  name: string;
  slug: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  items: MenuItemTree[];
}

// Flat menu item (database record)
export interface MenuItemRecord {
  id: string;
  menuId: string;
  parentId: string | null;
  label: string;
  url: string;
  icon: string | null;
  itemType: ItemType;
  dropdownType: DropdownType | null;
  megaColumns: number;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// Reorder payload
export interface ReorderItem {
  id: string;
  position: number;
  parentId: string | null;
}
