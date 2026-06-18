import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  integer,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  check,
  date,
  time,
  numeric,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Briefing } from "./agents/home/types";

// ── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  userType: text("user_type", {
    enum: ["employee", "broker", "client", "vendor"],
  })
    .notNull()
    .default("employee"),
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Employee Profiles ────────────────────────────────────────────────────────
export const employeeProfiles = pgTable("employee_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  department: text("department"),
  jobTitle: text("job_title"),
  phoneNumber: text("phone_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Broker Companies ─────────────────────────────────────────────────────────
export const brokerCompanies = pgTable("broker_companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: text("company_name").notNull(),
  tradeLicenseNumber: text("trade_license_number").notNull(),
  tradeLicenseDocumentUrl: text("trade_license_document_url"),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  status: text("status", {
    enum: ["pending", "active", "suspended", "rejected"],
  })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Broker Profiles ──────────────────────────────────────────────────────────
export const brokerProfiles = pgTable("broker_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => brokerCompanies.id),
  isCompanyAdmin: boolean("is_company_admin").notNull().default(false),
  status: text("status", {
    enum: ["active", "inactive"],
  })
    .notNull()
    .default("inactive"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Client Profiles ──────────────────────────────────────────────────────────
export const clientProfiles = pgTable("client_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Vendor Profiles ──────────────────────────────────────────────────────────
export const vendorProfiles = pgTable("vendor_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Roles ─────────────────────────────────────────────────────────────────────
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    userType: text("user_type", {
      enum: ["employee", "broker", "client", "vendor"],
    }).notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("roles_name_user_type_idx").on(table.name, table.userType),
  ]
);

// ── Permissions ──────────────────────────────────────────────────────────────
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    description: text("description"),
  },
  (table) => [
    uniqueIndex("permissions_resource_action_idx").on(
      table.resource,
      table.action
    ),
  ]
);

// ── Role Permissions (Junction) ──────────────────────────────────────────────
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("role_permissions_unique_idx").on(
      table.roleId,
      table.permissionId
    ),
  ]
);

// ── User Roles (Junction) ────────────────────────────────────────────────────
export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_roles_unique_idx").on(table.userId, table.roleId),
  ]
);

// ── Sessions ─────────────────────────────────────────────────────────────────
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Pages ────────────────────────────────────────────────────────────────────
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale", { enum: ["en", "ar"] }).notNull(),
    namespace: uuid("namespace").notNull(),
    status: text("status", { enum: ["draft", "published", "pending_review"] })
      .notNull()
      .default("draft"),
    isSystem: boolean("is_system").notNull().default(false),
    data: jsonb("data").notNull(), // PageData JSON
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    metaKeywords: text("meta_keywords"),
    ogImage: text("og_image"),
    canonicalUrl: text("canonical_url"),
    robotsDirective: text("robots_directive").default("index, follow"),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pages_slug_locale_idx").on(table.slug, table.locale),
    index("pages_namespace_idx").on(table.namespace),
    index("pages_status_idx").on(table.status),
  ]
);

// ── Revisions ────────────────────────────────────────────────────────────────
export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    data: jsonb("data").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    slugSnapshot: text("slug_snapshot").notNull(),
    action: text("action", { enum: ["save", "rollback"] })
      .notNull()
      .default("save"),
    revisionNumber: integer("revision_number").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("revisions_page_id_idx").on(table.pageId)]
);

// ── Media Items ──────────────────────────────────────────────────────────────
export const mediaItems = pgTable("media_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  altText: text("alt_text").default(""),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  width: integer("width"),
  height: integer("height"),
  storageUrl: text("storage_url").notNull(),
  storageBackend: text("storage_backend", {
    enum: ["local", "s3", "r2"],
  }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Media References ─────────────────────────────────────────────────────────
export const mediaReferences = pgTable(
  "media_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    componentId: text("component_id").notNull(),
  },
  (table) => [
    index("media_refs_media_id_idx").on(table.mediaId),
    index("media_refs_page_id_idx").on(table.pageId),
  ]
);

// ── Form Definitions ─────────────────────────────────────────────────────────
export const formDefinitions = pgTable("form_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fields: jsonb("fields").notNull(), // FormFieldConfig[]
  salesforceEndpoint: text("salesforce_endpoint"),
  webhookUrl: text("webhook_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Form Submissions ─────────────────────────────────────────────────────────
export const formSubmissions = pgTable("form_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  formId: uuid("form_id")
    .notNull()
    .references(() => formDefinitions.id),
  data: jsonb("data").notNull(),
  sourcePageSlug: text("source_page_slug"),
  sourceLocale: text("source_locale"),
  firstTouchAttribution: jsonb("first_touch_attribution"),
  lastTouchAttribution: jsonb("last_touch_attribution"),
  conversionAttributions: jsonb("conversion_attributions").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Newsletter Subscriptions ────────────────────────────────────────────────
export const newsletterSubscriptions = pgTable(
  "newsletter_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    locale: text("locale", { enum: ["en", "ar"] }),
    sourcePath: text("source_path"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("newsletter_subscriptions_email_idx").on(table.email),
    index("newsletter_subscriptions_created_at_idx").on(table.createdAt),
  ]
);

// ── Site Settings ────────────────────────────────────────────────────────────
export const siteSettings = pgTable("site_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Component Templates ──────────────────────────────────────────────────────
// Re-usable groups of nested blocks (image + heading + text + button etc.)
// that the user can drop into a page from the editor's Templates panel.
// Built-in templates are seeded with `is_built_in = true` and have no `created_by`.
export const componentTemplates = pgTable(
  "component_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    scope: text("scope", { enum: ["block", "page"] })
      .notNull()
      .default("block"),
    thumbnail: text("thumbnail"),
    // ComponentInstance[] — tree of blocks inserted at the drop point
    content: jsonb("content").notNull(),
    // Record<string, ComponentInstance[]> — additional zones referenced by content
    zones: jsonb("zones").notNull().default({}),
    isBuiltIn: boolean("is_built_in").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("component_templates_scope_idx").on(table.scope)]
);

// ── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    changes: jsonb("changes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_entity_type_idx").on(table.entityType),
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_user_id_idx").on(table.userId),
  ]
);

// ── Posts ─────────────────────────────────────────────────────────────────────
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale", { enum: ["en", "ar"] }).notNull(),
    namespace: uuid("namespace").notNull(),
    postType: text("post_type", { enum: ["blog", "news"] })
      .notNull()
      .default("blog"),
    status: text("status", { enum: ["draft", "published", "trashed", "pending_review"] })
      .notNull()
      .default("draft"),
    content: jsonb("content"), // Tiptap JSON
    excerpt: text("excerpt"),
    featuredImage: text("featured_image"),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    metaKeywords: text("meta_keywords"),
    ogImage: text("og_image"),
    canonicalUrl: text("canonical_url"),
    robotsDirective: text("robots_directive").default("index, follow"),
    featured: boolean("featured").notNull().default(false),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at"),
    trashedAt: timestamp("trashed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("posts_slug_locale_idx").on(table.slug, table.locale),
    index("posts_namespace_idx").on(table.namespace),
    index("posts_status_idx").on(table.status),
    index("posts_post_type_idx").on(table.postType),
  ]
);

// ── Categories ───────────────────────────────────────────────────────────────
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("categories_name_idx").on(table.name)]
);

// ── Tags ─────────────────────────────────────────────────────────────────────
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tags_name_idx").on(table.name)]
);

// ── Post Categories (Junction) ───────────────────────────────────────────────
export const postCategories = pgTable(
  "post_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("post_categories_unique_idx").on(table.postId, table.categoryId),
  ]
);

// ── Post Tags (Junction) ─────────────────────────────────────────────────────
export const postTags = pgTable(
  "post_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("post_tags_unique_idx").on(table.postId, table.tagId),
  ]
);

// ── Post Views ───────────────────────────────────────────────────────────────
export const postViews = pgTable("post_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  count: integer("count").notNull().default(0),
});

// ── Post Shares ──────────────────────────────────────────────────────────────
export const postShares = pgTable(
  "post_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("post_shares_unique_idx").on(table.postId, table.platform),
  ]
);

// ── Menus ────────────────────────────────────────────────────────────────────
export const menus = pgTable("menus", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  locale: text("locale").notNull().default("en"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Menu Items ───────────────────────────────────────────────────────────────
export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    label: text("label").notNull(),
    url: text("url").notNull().default("#"),
    icon: text("icon"),
    /** Translated labels per locale, e.g. { "ar": "اتصل بنا" } */
    translations: jsonb("translations").$type<Record<string, string>>(),
    itemType: text("item_type", { enum: ["link", "dropdown", "mega"] })
      .notNull()
      .default("link"),
    dropdownType: text("dropdown_type", { enum: ["simple", "mega"] }),
    megaColumns: integer("mega_columns").notNull().default(3),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("menu_items_menu_id_idx").on(table.menuId),
    index("menu_items_parent_id_idx").on(table.parentId),
  ]
);

// ── Approval Config ──────────────────────────────────────────────────────────
export const approvalConfig = pgTable(
  "approval_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentModule: text("content_module", {
      enum: ["pages", "blog", "news", "construction_updates"],
    }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("approval_config_module_idx").on(table.contentModule),
  ]
);

// ── Approval Config Approvers (Junction) ─────────────────────────────────────
export const approvalConfigApprovers = pgTable(
  "approval_config_approvers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id")
      .notNull()
      .references(() => approvalConfig.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    uniqueIndex("approval_config_approvers_unique_idx").on(
      table.configId,
      table.userId
    ),
    uniqueIndex("approval_config_approvers_position_idx").on(
      table.configId,
      table.position
    ),
  ]
);

// ── Approval Requests ────────────────────────────────────────────────────────
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: text("content_id").notNull(),
    contentModule: text("content_module", {
      enum: ["pages", "blog", "news", "construction_updates"],
    }).notNull(),
    submitterId: uuid("submitter_id")
      .notNull()
      .references(() => users.id),
    status: text("status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    pendingData: jsonb("pending_data"),
    currentStep: integer("current_step").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("approval_requests_content_idx").on(
      table.contentId,
      table.contentModule
    ),
    index("approval_requests_status_idx").on(table.status),
    index("approval_requests_submitter_idx").on(table.submitterId),
  ]
);

// ── Approval Decisions ───────────────────────────────────────────────────────
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    approverId: uuid("approver_id")
      .notNull()
      .references(() => users.id),
    decision: text("decision", {
      enum: ["approved", "rejected"],
    }).notNull(),
    comment: text("comment"),
    chainStep: integer("chain_step"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("approval_decisions_unique_idx").on(
      table.requestId,
      table.approverId,
      table.chainStep
    ),
    index("approval_decisions_request_idx").on(table.requestId),
  ]
);

// ── Tickets ──────────────────────────────────────────────────────────────────
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketNumber: text("ticket_number").notNull().unique(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    status: text("status", {
      enum: ["open", "assigned", "in_progress", "resolved", "closed"],
    })
      .notNull()
      .default("open"),
    priority: text("priority", {
      enum: ["low", "medium", "high", "urgent"],
    })
      .notNull()
      .default("medium"),
    category: text("category"),
    requestType: text("request_type", {
      enum: [
        "general_inquiry",
        "noc",
        "move_in",
        "move_out",
        "gate_pass",
        "technician_visit",
        "construction_material_delivery",
        "vendor_access",
        "maintenance_request",
        // Off-plan / pre-handover (Bayn is still under construction)
        "site_visit_booking",
        "brochure_request",
        "payment_milestone",
        "oqood_assistance",
        "mortgage_noc",
        "construction_progress_inquiry",
        "snag_submission",
        "handover_appointment",
        "hot_works_permit",
        "work_at_height_permit",
        "lift_usage_booking",
        "inspection_request",
        // Sales / lead capture
        "lead_inquiry",
      ],
    })
      .notNull()
      .default("general_inquiry"),
    communityId: uuid("community_id").references(() => communities.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    // Nullable link to a Lead (parties row). A non-null value turns this Ticket
    // into a Lead_Task (a sales activity on that Lead) without overloading the
    // request_type enum. See salesforce-lead-core design §6.1 (Req 13.4-13.6).
    leadPartyId: uuid("lead_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    unitNumber: text("unit_number"),
    requestData: jsonb("request_data").$type<Record<string, unknown> | null>(),
    scheduledStart: timestamp("scheduled_start"),
    scheduledEnd: timestamp("scheduled_end"),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone"),
    source: text("source", {
      enum: ["manual", "api", "form"],
    }).notNull(),
    assigneeId: uuid("assignee_id").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    externalCrmId: text("external_crm_id"),
    firstTouchAttribution: jsonb("first_touch_attribution"),
    lastTouchAttribution: jsonb("last_touch_attribution"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
    closedAt: timestamp("closed_at"),
  },
  (table) => [
    index("tickets_status_idx").on(table.status),
    index("tickets_assignee_id_idx").on(table.assigneeId),
    index("tickets_category_idx").on(table.category),
    index("tickets_request_type_idx").on(table.requestType),
    index("tickets_community_id_idx").on(table.communityId),
    index("tickets_project_id_idx").on(table.projectId),
    index("tickets_scheduled_start_idx").on(table.scheduledStart),
    index("tickets_created_at_idx").on(table.createdAt),
    index("tickets_contact_email_idx").on(table.contactEmail),
    index("tickets_lead_party_id_idx").on(table.leadPartyId),
  ]
);

// ── Ticket Notes ─────────────────────────────────────────────────────────────
export const ticketNotes = pgTable(
  "ticket_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: a note may attach to a Lead only (no ticket). At least one of
    // ticketId / leadPartyId is required — enforced by the CHECK below.
    // See salesforce-lead-core design §6.2 (Req 14.5, 14.8).
    ticketId: uuid("ticket_id").references(() => tickets.id, {
      onDelete: "cascade",
    }),
    // Creator attribution: ai | user | system (default user). Drizzle's enum is
    // a TS-only constraint (no DB CHECK). See design §6.2 (Req 14.1).
    actorType: text("actor_type", { enum: ["ai", "user", "system"] })
      .notNull()
      .default("user"),
    // Now nullable: an AI- or system-authored note has no human author
    // (Req 14.2, 14.4). A `user` note requires an author — enforced in the
    // note write-path (task 6.3), not at the schema level.
    authorId: uuid("author_id").references(() => users.id),
    // Nullable link to a Lead (parties row). See design §6.2 (Req 14.5).
    leadPartyId: uuid("lead_party_id").references(() => parties.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ticket_notes_ticket_id_idx").on(table.ticketId),
    index("ticket_notes_lead_party_id_idx").on(table.leadPartyId),
    // At-least-one-association guard (Req 14.8): a note must reference a Ticket
    // and/or a Lead.
    check(
      "ticket_notes_assoc_chk",
      sql`${table.ticketId} IS NOT NULL OR ${table.leadPartyId} IS NOT NULL`
    ),
  ]
);

// ── Ticket Categories ────────────────────────────────────────────────────────
export const ticketCategories = pgTable(
  "ticket_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

// ── Ticket Approvals ─────────────────────────────────────────────────────────
// Lightweight, ticket-scoped approval bridge. Distinct from the content
// approval engine (approval_requests) which is bound to pages/posts.
//
// One approval per ticket per scope (e.g. one "noc" approval per ticket).
// Decision is recorded inline (no separate decisions table) because each
// ticket-approval is single-decider.
export const ticketApprovals = pgTable(
  "ticket_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    scope: text("scope", {
      enum: [
        "noc",
        "move_in",
        "vendor_access",
        "construction_material_delivery",
        "hot_works_permit",
        "work_at_height_permit",
        "handover_appointment",
        "mortgage_noc",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending"),
    requestedBy: uuid("requested_by").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at"),
    decisionComment: text("decision_comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ticket_approvals_ticket_scope_idx").on(table.ticketId, table.scope),
    index("ticket_approvals_status_idx").on(table.status),
    index("ticket_approvals_scope_idx").on(table.scope),
  ]
);

// ── CRM Sync Log ─────────────────────────────────────────────────────────────
export const crmSyncLog = pgTable(
  "crm_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    direction: text("direction", {
      enum: ["outbound", "inbound"],
    }).notNull(),
    action: text("action").notNull(),
    status: text("status", {
      enum: ["success", "failed", "pending"],
    })
      .notNull()
      .default("pending"),
    externalRefId: text("external_ref_id"),
    errorMessage: text("error_message"),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("crm_sync_log_ticket_id_idx").on(table.ticketId),
    index("crm_sync_log_status_idx").on(table.status),
    index("crm_sync_log_external_ref_idx").on(table.externalRefId),
  ]
);

// ── Post Revisions ───────────────────────────────────────────────────────────
export const postRevisions = pgTable(
  "post_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    data: jsonb("data").notNull(), // Snapshot of content + SEO fields
    titleSnapshot: text("title_snapshot").notNull(),
    slugSnapshot: text("slug_snapshot").notNull(),
    action: text("action", { enum: ["save", "rollback"] })
      .notNull()
      .default("save"),
    revisionNumber: integer("revision_number").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("post_revisions_post_id_idx").on(table.postId)]
);

// ── AI Clients ───────────────────────────────────────────────────────────────
export const aiClients = pgTable(
  "ai_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    nationality: text("nationality"),
    preferredLanguage: text("preferred_language", {
      enum: ["en", "ar"],
    }).default("en"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_clients_phone_idx").on(table.phone),
    index("ai_clients_email_idx").on(table.email),
  ]
);

// ── AI Tenants ───────────────────────────────────────────────────────────────
export const aiTenants = pgTable(
  "ai_tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    unitId: uuid("unit_id").references((): AnyPgColumn => aiUnits.id),
    leaseStartDate: date("lease_start_date"),
    leaseEndDate: date("lease_end_date"),
    rentAmount: numeric("rent_amount", { mode: "number" }),
    paymentFrequency: text("payment_frequency"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_tenants_phone_idx").on(table.phone),
    index("ai_tenants_email_idx").on(table.email),
  ]
);

// ── AI Units ─────────────────────────────────────────────────────────────────
export const aiUnits = pgTable(
  "ai_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Legacy free-text project name. Kept during transition to the relational
    // `projectId` FK below; new records should populate both, and a future
    // migration will drop this column once backfill is complete.
    projectName: text("project_name").notNull(),
    // Relational FK to `projects` / `communities`. Nullable until backfilled.
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    communityId: uuid("community_id").references(() => communities.id, {
      onDelete: "set null",
    }),
    unitNumber: text("unit_number").notNull(),
    unitType: text("unit_type", {
      enum: ["apartment", "villa", "townhouse", "office"],
    }).notNull(),
    floorNumber: integer("floor_number"),
    areaSqm: numeric("area_sqm", { mode: "number" }),
    status: text("status", {
      enum: ["available", "sold", "reserved", "rented", "under_construction"],
    })
      .notNull()
      .default("available"),
    constructionProgress: integer("construction_progress"),
    estimatedHandoverDate: date("estimated_handover_date"),
    // Free-text cluster / sub-zone label within a project (e.g. "Views 3").
    cluster: text("cluster"),
    // Total contracted price of the unit in AED.
    purchasePrice: numeric("purchase_price", { mode: "number" }),
    clientId: uuid("client_id").references(() => aiClients.id),
    tenantId: uuid("tenant_id").references(() => aiTenants.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_units_status_idx").on(table.status),
    index("ai_units_project_id_idx").on(table.projectId),
    index("ai_units_community_id_idx").on(table.communityId),
  ]
);

// ── AI Unit Payment Plans ────────────────────────────────────────────────────
// One row per (client, unit) representing the signed payment plan contract.
// Used by the visitor-facing AI to answer payment questions for verified
// clients. Tagged demo records are removed by `resetDemo()` via the linked
// client / unit.
export const aiUnitPaymentPlans = pgTable(
  "ai_unit_payment_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => aiClients.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => aiUnits.id, { onDelete: "cascade" }),
    planName: text("plan_name").notNull(),
    totalPrice: numeric("total_price", { mode: "number" }).notNull(),
    bookingDate: date("booking_date").notNull(),
    expectedHandoverDate: date("expected_handover_date"),
    downPaymentPct: integer("down_payment_pct").notNull().default(10),
    secondPaymentPct: integer("second_payment_pct").notNull().default(10),
    handoverPct: integer("handover_pct").notNull().default(40),
    postHandoverPct: integer("post_handover_pct").notNull().default(40),
    postHandoverMonths: integer("post_handover_months").notNull().default(36),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_unit_payment_plans_client_id_idx").on(table.clientId),
    index("ai_unit_payment_plans_unit_id_idx").on(table.unitId),
  ]
);

// ── AI Unit Installments ─────────────────────────────────────────────────────
// Individual installment ledger entries belonging to a payment plan.
export const aiUnitInstallments = pgTable(
  "ai_unit_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => aiUnitPaymentPlans.id, { onDelete: "cascade" }),
    installmentNumber: integer("installment_number").notNull(),
    labelEn: text("label_en").notNull(),
    labelAr: text("label_ar"),
    dueDate: date("due_date").notNull(),
    amountAed: numeric("amount_aed", { mode: "number" }).notNull(),
    status: text("status", {
      enum: ["paid", "upcoming", "overdue"],
    })
      .notNull()
      .default("upcoming"),
    paidAt: timestamp("paid_at"),
    paymentReference: text("payment_reference"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_unit_installments_plan_id_idx").on(table.planId),
    index("ai_unit_installments_due_date_idx").on(table.dueDate),
  ]
);

// ── Knowledge Documents ──────────────────────────────────────────────────────
export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceType: text("source_type", {
      enum: [
        "manual",
        "blog_sync",
        "construction_update",
        "faq",
        "policy",
      ],
    }).notNull(),
    category: text("category"),
    locale: text("locale", { enum: ["en", "ar"] }).notNull(),
    sourceRefId: text("source_ref_id"),
    lastIndexedAt: timestamp("last_indexed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_documents_source_type_idx").on(table.sourceType),
    index("knowledge_documents_locale_idx").on(table.locale),
  ]
);

// ── Knowledge Embeddings ─────────────────────────────────────────────────────
export const knowledgeEmbeddings = pgTable("knowledge_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  embedding: vector("embedding", { dimensions: 768 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── AI Conversations ─────────────────────────────────────────────────────────
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantName: text("participant_name"),
    participantPhone: text("participant_phone"),
    participantEmail: text("participant_email"),
    participantType: text("participant_type", {
      enum: ["client", "tenant", "visitor"],
    })
      .notNull()
      .default("visitor"),
    clientId: uuid("client_id").references(() => aiClients.id),
    tenantId: uuid("tenant_id").references(() => aiTenants.id),
    // `channel` is untyped text and already accepts the voice surface's
    // "web_call" value alongside existing channels (Design §9.2).
    channel: text("channel"),
    language: text("language", { enum: ["en", "ar"] })
      .notNull()
      .default("en"),
    // Voice surface (Design §7.2, §8.1): a call is "connecting" from the moment
    // the session is created until the agent joins. The column is plain `text`
    // (Drizzle's `enum` is a TS-only constraint, no DB CHECK) so adding the
    // value needs no migration.
    status: text("status", {
      enum: ["connecting", "active", "resolved", "handed_off", "abandoned"],
    })
      .notNull()
      .default("active"),
    handoffSummary: jsonb("handoff_summary"),
    // Voice surface (Design §9.2): per-call sentiment + summary persisted on the
    // conversation instead of duplicating the spec's `conversations` table.
    sentiment: text("sentiment"),
    summary: text("summary"),
    // Nullable link to the party graph root. FK wired in task 1.2; `parties`
    // is declared later in this file so a lazy `AnyPgColumn` reference is used.
    partyId: uuid("party_id").references((): AnyPgColumn => parties.id),
    otpVerificationState: text("otp_verification_state", {
      enum: ["not_required", "pending", "verified", "expired"],
    })
      .notNull()
      .default("not_required"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("ai_conversations_status_idx").on(table.status)]
);

// ── OTP Records ──────────────────────────────────────────────────────────────
export const otpRecords = pgTable(
  "otp_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    otpHash: text("otp_hash").notNull(),
    email: text("email").notNull(),
    status: text("status", {
      enum: ["pending", "used", "expired", "invalidated"],
    })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (table) => [
    index("otp_records_conversation_status_idx").on(
      table.conversationId,
      table.status
    ),
  ]
);

// ── AI Messages ──────────────────────────────────────────────────────────────
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["user", "assistant", "system", "caller", "agent"],
    }).notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    // Voice surface (Design §9.2): per-turn timing for the latency HUD.
    // `tMs` = offset from call start; `latencyMs` = voice-to-voice latency.
    tMs: integer("t_ms"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_messages_conversation_id_idx").on(table.conversationId),
  ]
);

// ── AI Appointments ──────────────────────────────────────────────────────────
export const aiAppointments = pgTable(
  "ai_appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceNumber: text("reference_number").notNull().unique(),
    conversationId: uuid("conversation_id").references(
      () => aiConversations.id
    ),
    clientId: uuid("client_id").references(() => aiClients.id),
    tenantId: uuid("tenant_id").references(() => aiTenants.id),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    appointmentType: text("appointment_type", {
      enum: [
        "site_visit",
        "consultation",
        "payment_discussion",
        "maintenance_request",
      ],
    }).notNull(),
    scheduledDate: date("scheduled_date").notNull(),
    scheduledTime: time("scheduled_time").notNull(),
    status: text("status", {
      enum: ["confirmed", "cancelled", "rescheduled", "completed"],
    })
      .notNull()
      .default("confirmed"),
    notes: text("notes"),
    // Voice surface (Design §9.2): booking links rep + viewing slot + the
    // Salesforce Event it syncs to, plus the project being viewed.
    // FK constraints to `reps`/`viewing_slots` are wired in task 1.2 via lazy
    // `AnyPgColumn` references because those tables are declared later.
    repId: uuid("rep_id").references((): AnyPgColumn => reps.id),
    slotId: uuid("slot_id").references((): AnyPgColumn => viewingSlots.id),
    sfEventId: text("sf_event_id"),
    project: text("project"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_appointments_scheduled_date_idx").on(table.scheduledDate),
    index("ai_appointments_status_idx").on(table.status),
  ]
);

// ── AI Config ────────────────────────────────────────────────────────────────
export const aiConfig = pgTable("ai_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Communities ──────────────────────────────────────────────────────────────
// A community is the top-level real-estate entity (e.g. "Dubai Hills Estate").
// Projects belong to a community; units belong to a project.
export const communities = pgTable(
  "communities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    city: text("city"),
    region: text("region"),
    country: text("country").default("AE"),
    locationLat: numeric("location_lat", { mode: "number" }),
    locationLng: numeric("location_lng", { mode: "number" }),
    heroImageId: uuid("hero_image_id").references(() => mediaItems.id),
    logoImageId: uuid("logo_image_id").references(() => mediaItems.id),
    status: text("status", {
      enum: ["active", "inactive", "archived"],
    })
      .notNull()
      .default("active"),
    seoMeta: jsonb("seo_meta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("communities_status_idx").on(table.status),
  ]
);

// ── Projects ─────────────────────────────────────────────────────────────────
// A project sits inside a community and exposes a structured brochure model
// (gallery, floorplans, amenities, payment plans) — rendered on the public
// project landing page via the page-builder.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    shortDescriptionEn: text("short_description_en"),
    shortDescriptionAr: text("short_description_ar"),
    longDescriptionEn: text("long_description_en"),
    longDescriptionAr: text("long_description_ar"),
    status: text("status", {
      enum: [
        "planning",
        "pre_launch",
        "selling",
        "under_construction",
        "handover",
        "completed",
        "archived",
      ],
    })
      .notNull()
      .default("planning"),
    heroImageId: uuid("hero_image_id").references(() => mediaItems.id),
    logoImageId: uuid("logo_image_id").references(() => mediaItems.id),
    brochurePdfId: uuid("brochure_pdf_id").references(() => mediaItems.id),
    // Ordered list of media item ids for the brochure gallery.
    // Shape: string[]
    brochureGallery: jsonb("brochure_gallery"),
    // Shape: Array<{ unitType, areaSqm, bedrooms, bathrooms, imageId, pdfId, nameEn, nameAr }>
    floorplans: jsonb("floorplans"),
    // Shape: Array<{ icon, nameEn, nameAr, descriptionEn, descriptionAr, imageId }>
    amenities: jsonb("amenities"),
    locationLat: numeric("location_lat", { mode: "number" }),
    locationLng: numeric("location_lng", { mode: "number" }),
    // Shape: Array<{ titleEn, titleAr, distanceKm }>
    locationHighlights: jsonb("location_highlights"),
    // Shape: Array<{ nameEn, nameAr, downPaymentPct, milestones: [{ pct, labelEn, labelAr }] }>
    paymentPlans: jsonb("payment_plans"),
    expectedHandoverDate: date("expected_handover_date"),
    totalUnits: integer("total_units"),
    availableUnits: integer("available_units"),
    developer: text("developer"),
    contractor: text("contractor"),
    architect: text("architect"),
    seoMeta: jsonb("seo_meta"),
    // Custom landing page layout (Puck PageData JSON). When present, the
    // frontend renders this via the page builder instead of the auto-composed
    // ProjectLanding component.
    landingPageData: jsonb("landing_page_data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("projects_community_slug_idx").on(
      table.communityId,
      table.slug
    ),
    index("projects_status_idx").on(table.status),
    index("projects_community_id_idx").on(table.communityId),
  ]
);

// ── Admin AI Chat Sessions ───────────────────────────────────────────────────
// ChatGPT-style conversation history for the staff-facing copilot at
// /ora-panel/ai. Each authenticated user owns a list of sessions; messages
// belong to a single session. Visitor-side conversations are persisted in
// `aiConversations` separately.
export const adminChatSessions = pgTable(
  "admin_chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("admin_chat_sessions_user_id_idx").on(table.userId),
    index("admin_chat_sessions_updated_at_idx").on(table.updatedAt),
  ]
);

export const adminChatMessages = pgTable(
  "admin_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => adminChatSessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    pendingAction: jsonb("pending_action"),
    executed: jsonb("executed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("admin_chat_messages_session_id_idx").on(table.sessionId),
  ]
);

// ── Marketing Spend ──────────────────────────────────────────────────────────
export const marketingSpend = pgTable(
  "marketing_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    channel: text("channel").notNull(),
    campaignId: text("campaign_id").notNull(),
    adSetId: text("ad_set_id"),
    adId: text("ad_id"),
    spend: numeric("spend", { precision: 12, scale: 2 }).notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    // DOE Voice Surface (Design §9, Requirement 11.4): the demo's 90-day metrics
    // dataset writes synthetic spend rows here so the `metrics_*` views return
    // meaningful figures. They carry `demo = true` so the one-click voice demo
    // reset (task 18.2) can remove exactly the demo-scoped rows without touching
    // real marketing-spend data. Defaults false for all existing/real rows.
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("marketing_spend_upsert_idx").on(
      table.date,
      table.channel,
      table.campaignId,
      table.adSetId,
      table.adId
    ),
    index("marketing_spend_date_channel_idx").on(table.date, table.channel),
  ]
);

// ── UTM Links ────────────────────────────────────────────────────────────────
export const utmLinks = pgTable(
  "utm_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    destinationUrl: text("destination_url").notNull(),
    utmSource: text("utm_source").notNull(),
    utmMedium: text("utm_medium").notNull(),
    utmCampaign: text("utm_campaign").notNull(),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    taggedUrl: text("tagged_url").notNull(),
    project: text("project"),
    autoRegistered: boolean("auto_registered").notNull().default(false),
    totalHits: integer("total_hits").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("utm_links_project_idx").on(table.project),
    index("utm_links_created_at_idx").on(table.createdAt),
    uniqueIndex("utm_links_params_unique_idx").on(
      sql`LOWER(${table.utmSource})`,
      sql`LOWER(${table.utmMedium})`,
      sql`LOWER(${table.utmCampaign})`,
      sql`COALESCE(LOWER(${table.utmTerm}), '')`,
      sql`COALESCE(LOWER(${table.utmContent}), '')`
    ),
  ]
);

// ── Ad Spend Ingestion Log ───────────────────────────────────────────────────
export const adSpendIngestionLog = pgTable("ad_spend_ingestion_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  runAt: timestamp("run_at").defaultNow().notNull(),
  recordsUpserted: jsonb("records_upserted").notNull().default({}),
  skippedPlatforms: text("skipped_platforms").array().default([]),
  errors: jsonb("errors"),
});

// ── DSAR Deletion Retry Queue ────────────────────────────────────────────────
// Tracks PostHog person-delete API calls that failed and need retry.
export const dsarDeletionQueue = pgTable(
  "dsar_deletion_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    posthogDistinctId: text("posthog_distinct_id").notNull(),
    status: text("status", {
      enum: ["pending", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("dsar_deletion_queue_status_idx").on(table.status),
    index("dsar_deletion_queue_next_retry_idx").on(table.nextRetryAt),
  ]
);


// ── Custom Events ────────────────────────────────────────────────────────────
// Admin-managed events that extend the locked EVENT_VOCABULARY at runtime.
// These appear alongside the core vocabulary in the page builder's tracking
// dropdown. The core vocabulary remains the canonical set; custom events
// fill the gap where teams need bespoke tracking without a code change.
export const customEvents = pgTable(
  "custom_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("custom_events_name_idx").on(table.name),
    index("custom_events_active_idx").on(table.isActive),
  ]
);

// ── Conversion Goals ─────────────────────────────────────────────────────────
// Admin-configured PostHog events that count as "conversions" in the marketing
// dashboard. Replaces the hardcoded event list with a dynamic, queryable set.
export const conversionGoals = pgTable(
  "conversion_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventName: text("event_name").notNull().unique(),
    displayLabel: text("display_label"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversion_goals_active_idx").on(table.isActive),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// DOE Voice Surface — new tables (Design §9.3)
//
// Principle: extend existing tables before creating new ones. Every demo-scoped
// table carries a `demo` boolean (default false) so the one-click reset can
// truncate exactly the demo rows. `events` is append-only — nothing deletes
// from it except the demo reset.
// ═══════════════════════════════════════════════════════════════════════════

// ── Parties ──────────────────────────────────────────────────────────────────
// Party graph root — person/org identity above aiClients/aiTenants.
export const parties = pgTable("parties", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type", { enum: ["person", "org"] })
    .notNull()
    .default("person"),
  name: text("name"),
  language: text("language", { enum: ["en", "ar"] }).default("en"),
  // Soft links onto existing identity tables — reuse, not replace.
  clientId: uuid("client_id").references(() => aiClients.id),
  tenantId: uuid("tenant_id").references(() => aiTenants.id),
  consentAt: timestamp("consent_at"),
  demo: boolean("demo").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Party Identities ─────────────────────────────────────────────────────────
// Identity mapping: phone_hash, email, sf_lead_id, entra_oid → party.
export const partyIdentities = pgTable(
  "party_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["phone_hash", "email", "sf_lead_id", "entra_oid"],
    }).notNull(),
    value: text("value").notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (t) => [index("party_identities_value_idx").on(t.kind, t.value)]
);

// ── Reps ─────────────────────────────────────────────────────────────────────
// Routing target (project × language × capacity). Declared before `leadsMirror`
// and `viewingSlots` which reference it.
export const reps = pgTable("reps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  languages: text("languages").array(), // ["en","ar"]
  projects: text("projects").array(),
  capacity: integer("capacity").notNull().default(3),
  openHotCount: integer("open_hot_count").notNull().default(0),
  phone: text("phone"),
  teamsId: text("teams_id"),
  demo: boolean("demo").notNull().default(false),
});

// ── Leads Mirror ─────────────────────────────────────────────────────────────
// Local cache of Salesforce Lead for fast prefetch (no SF in the hot path).
export const leadsMirror = pgTable("leads_mirror", {
  partyId: uuid("party_id")
    .primaryKey()
    .references(() => parties.id, { onDelete: "cascade" }),
  sfLeadId: text("sf_lead_id"),
  stage: text("stage"),
  tier: text("tier", { enum: ["HOT", "WARM", "NURTURE"] }),
  scoreReason: text("score_reason"),
  projectInterest: text("project_interest"),
  unitInterest: text("unit_interest"),
  budgetBand: text("budget_band"),
  source: text("source"),
  campaign: text("campaign"),
  assignedRepId: uuid("assigned_rep_id").references(() => reps.id),
  lastInteractionAt: timestamp("last_interaction_at"),
  lastInteractionSummary: text("last_interaction_summary"),
  slaDueAt: timestamp("sla_due_at"),
  demo: boolean("demo").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Viewing Slots ────────────────────────────────────────────────────────────
// Seeded availability for the demo.
export const viewingSlots = pgTable(
  "viewing_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project: text("project").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    repId: uuid("rep_id").references(() => reps.id),
    taken: boolean("taken").notNull().default(false),
    demo: boolean("demo").notNull().default(false),
  },
  (t) => [index("viewing_slots_project_idx").on(t.project, t.startsAt)]
);

// ── Events ───────────────────────────────────────────────────────────────────
// Append-only event log feeding SSE. Nothing deletes except demo reset.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => [index("events_at_idx").on(t.at)]
);

// ── Salesforce Outbox ────────────────────────────────────────────────────────
// Async Salesforce outbox — evolves the synchronous crm_sync_log pattern.
export const sfOutbox = pgTable(
  "sf_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["lead_upsert", "task", "event"] }).notNull(),
    jobKey: text("job_key").notNull().unique(), // idempotency key
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "sent", "dead"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sfId: text("sf_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("sf_outbox_status_idx").on(t.status)]
);

// ── Jobs ─────────────────────────────────────────────────────────────────────
// Durable job spine — replaces Trigger.dev for the demo.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    jobKey: text("job_key").notNull().unique(), // idempotency key
    status: text("status", {
      enum: ["received", "planned", "executing", "done", "failed"],
    })
      .notNull()
      .default("received"),
    payload: jsonb("payload"),
    plan: jsonb("plan"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    partyId: uuid("party_id").references(() => parties.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("jobs_status_idx").on(t.status)]
);

// ── Report Jobs ──────────────────────────────────────────────────────────────
// Report job receipts (Act 3 — email PDF delivery).
export const reportJobs = pgTable("report_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterEmail: text("requester_email").notNull(),
  scope: text("scope").notNull(),
  period: text("period").notNull(),
  status: text("status", {
    enum: ["queued", "rendering", "sent", "failed"],
  })
    .notNull()
    .default("queued"),
  messageId: text("message_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// metrics_* : SQL views (not ORM tables) over the demo dataset — see Design §15.
// Defined in drizzle/0030_metrics_views.sql (task 16.3); the single source of
// analytics arithmetic for both `get_pipeline_summary` (voice) and
// `compile_and_email_report` (email). Views:
//   metrics_qualified_leads                  — base helper (channel/week/speed)
//   metrics_cost_per_qualified_lead          — cost per qualified lead, channel × week
//   metrics_cost_per_qualified_lead_overall  — cost per qualified lead, channel (all-time)
//   metrics_tier_funnel / _overall           — HOT/WARM/NURTURE counts
//   metrics_speed_to_lead / _overall         — median speed-to-lead (percentile_cont)
//   metrics_rep_load                         — assigned leads vs capacity per rep
//   metrics_week_over_week                   — latest-week vs prior-week deltas

// ── Agent Migration Flags ────────────────────────────────────────────────────
// Per-capability Migration_Switch state. Defaults route to the deterministic
// path; a capability is served by the Mastra agent only when `mode = "agent"`
// AND `enabled = true` (unset/false → deterministic — Req 7.2). `proven` records
// that the migrated capability has been validated (Req 7.4); `lastDivergenceAt`
// is stamped when a divergence forces fallback to deterministic (Req 14.3).
export const agentMigrationFlags = pgTable("agent_migration_flags", {
  capability: text("capability").primaryKey(), // e.g. "create_booking"
  mode: text("mode", { enum: ["deterministic", "agent"] })
    .notNull()
    .default("deterministic"),
  enabled: boolean("enabled").notNull().default(false), // unset/false → deterministic (Req 7.2)
  proven: boolean("proven").notNull().default(false), // recorded-proven gate (Req 7.4)
  lastDivergenceAt: timestamp("last_divergence_at"), // set when a divergence forces fallback (Req 14.3)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Admin Confirmations ──────────────────────────────────────────────────────
// Durable, user-bound, single-use admin confirmation tokens backing the
// Admin_Confirmation_Flow (human-in-the-loop for destructive admin actions —
// Req 9.3–9.5). A proposal issues a token bound to the requesting user with a
// short TTL (`expiresAt`); confirming executes the bound action exactly once and
// stamps `consumedAt` so the token cannot be reused.
export const adminConfirmations = pgTable(
  "admin_confirmations",
  {
    token: uuid("token").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id), // bound to requesting user (Req 9.3)
    kind: text("kind").notNull(), // which destructive action
    args: jsonb("args").notNull(),
    expiresAt: timestamp("expires_at").notNull(), // short TTL (Req 9.3)
    consumedAt: timestamp("consumed_at"), // single-use (Req 9.4)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("admin_confirmations_user_idx").on(t.userId)]
);

// ── Inbound Leads ────────────────────────────────────────────────────────────
// Lead-Engine (S3) durable intake ledger — every Inbound_Lead is recorded here
// BEFORE any parsing so no inbound lead is ever dropped (P-NoDrop). The
// `status` column is the parsed-or-queued state machine (received → parsed |
// queued → failed). `idempotency_key` is unique so at most one row exists per
// source-payload identity (CC-Idem). Phones are stored only as a salted
// `phone_hash`; `raw_phone` is a transient Salesforce-ingress copy purged ≤24h
// after forwarding (CC-Privacy). See Design §Data Models (inbound_leads).
export const inboundLeads = pgTable(
  "inbound_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source", {
      enum: ["web_form", "email", "whatsapp", "meta_lead_ads", "portal"],
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(), // unique (Req 3.3)
    status: text("status", {
      enum: ["received", "parsed", "queued", "failed"],
    })
      .notNull()
      .default("received"),
    name: text("name"),
    email: text("email"),
    phoneHash: text("phone_hash"), // salted hash only — never raw (Req 13.1)
    rawPhone: text("raw_phone"), // transient SF-ingress copy; purged ≤24h (Req 13)
    content: text("content").notNull().default(""),
    rawPayload: jsonb("raw_payload"), // retained verbatim (Req 1.3, 2.3)
    attribution: jsonb("attribution"), // from ora_attribution (Req 1.4)
    structured: jsonb("structured"), // StructuredLeadFields once parsed (Req 4)
    partyId: uuid("party_id").references(() => parties.id, {
      onDelete: "set null",
    }), // set after resolution
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("inbound_leads_idempotency_key_ux").on(t.idempotencyKey),
    index("inbound_leads_status_idx").on(t.status),
    index("inbound_leads_party_id_idx").on(t.partyId),
  ]
);

// ── Briefing Cache (S5 Agent-First Home) ─────────────────────────────────────
// The ONLY schema change introduced by S5 (Design §Data Models). Stores an
// assembled Briefing so repeat Home_Surface loads are served without re-running
// the multi-step Briefing_Workflow (CC-Cost / Req 5.1, 5.3). Keyed by the
// (userId, window, periodDate) triple — the same key the Briefing_Cache
// accessors and the scheduled `briefing_assembly` job use — so at most one
// cached Briefing exists per user / window / day (Req 5.1, 5.2, 5.3).
//
// `briefing` is the assembled Briefing JSON verbatim, already phone-redacted
// (CC-Privacy / Req 2.7, 9.4); serving it presents figures byte-identical to
// what was assembled, with no recomputation on read (Req 5.7). `expiresAt`
// carries the TTL (clamped 1–60min, default 15) and gates non-expired reads
// (Req 5.4). The (userId, periodDate) index backs invalidation of every entry
// for a user/day on a Tool_Dispatcher Stack mutation (Req 5.5). Carries no
// personal data beyond the user-id key and the already-redacted body.
export const briefingCache = pgTable(
  "briefing_cache",
  {
    userId: text("user_id").notNull(),
    window: text("window", {
      enum: ["morning", "midday", "evening"],
    }).notNull(),
    periodDate: date("period_date").notNull(), // YYYY-MM-DD (local)
    briefing: jsonb("briefing").$type<Briefing>().notNull(), // already redacted
    assembledAt: timestamp("assembled_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // TTL gate (Req 5.4)
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.window, t.periodDate] }),
    index("briefing_cache_user_period_idx").on(t.userId, t.periodDate),
  ]
);

// ── Market Catalog (S7 Prospecting Workspace) ────────────────────────────────
// External/competitor market-intelligence mirror, ingested from Property Monitor
// / Dubai Pulse via the MarketData_Adapter and kept in a dedicated `market_*`
// namespace — deliberately SEPARATE from ORA's own `communities`/`projects`/
// `ai_units` (which are brochure/landing-page bound and rendered publicly).
// Competitor rows must never leak onto the public site (Design §Decision 1,
// Requirement 11.1). Every row carries provenance — `source` + `source_ref` +
// `as_of` — and a `demo` flag (CC-Provenance / CC-Synthetic, Req 11.1, 11.6).
// A unique `(source, source_ref)` index per ingested table makes re-ingest
// field-identical (CC-Idem, Req 11.2). `find_comparables`/`market_comps` read
// ONLY these tables, so every stat shown or embedded in outreach is SQL-sourced
// and as-of-stamped, never model-computed (CC-SQL, Req 11.3, 11.4).

export const marketDevelopers = pgTable(
  "market_developers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    country: text("country"),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    asOf: timestamp("as_of"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("market_developers_source_ref_ux").on(t.source, t.sourceRef),
  ]
);

export const marketProjects = pgTable(
  "market_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    developerId: uuid("developer_id").references(() => marketDevelopers.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    communityName: text("community_name"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    locationLat: numeric("location_lat", { mode: "number" }),
    locationLng: numeric("location_lng", { mode: "number" }),
    segment: text("segment", {
      enum: ["ultra_luxury", "luxury", "premium", "mid"],
    }),
    status: text("status", {
      enum: [
        "planning",
        "off_plan",
        "under_construction",
        "completed",
        "archived",
      ],
    }),
    launchDate: date("launch_date"),
    handoverDate: date("handover_date"),
    totalUnits: integer("total_units"),
    // Shape: string[]
    unitTypes: jsonb("unit_types"),
    priceMin: numeric("price_min", { mode: "number" }),
    priceMax: numeric("price_max", { mode: "number" }),
    avgPricePerSqft: numeric("avg_price_per_sqft", { mode: "number" }),
    branded: boolean("branded").default(false),
    brandName: text("brand_name"),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    asOf: timestamp("as_of"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("market_projects_source_ref_ux").on(t.source, t.sourceRef),
    index("market_projects_segment_idx").on(t.segment),
    index("market_projects_community_idx").on(t.communityName),
  ]
);

export const marketBuildings = pgTable(
  "market_buildings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketProjectId: uuid("market_project_id").references(
      () => marketProjects.id,
      { onDelete: "cascade" }
    ),
    name: text("name").notNull(),
    floors: integer("floors"),
    totalUnits: integer("total_units"),
    completionYear: integer("completion_year"),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    asOf: timestamp("as_of"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("market_buildings_source_ref_ux").on(t.source, t.sourceRef),
  ]
);

export const marketTransactions = pgTable(
  "market_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketProjectId: uuid("market_project_id").references(
      () => marketProjects.id,
      { onDelete: "set null" }
    ),
    marketBuildingId: uuid("market_building_id").references(
      () => marketBuildings.id,
      { onDelete: "set null" }
    ),
    communityName: text("community_name"),
    areaName: text("area_name"),
    txnType: text("txn_type", {
      enum: ["sale", "rent", "off_plan"],
    }).notNull(),
    txnDate: date("txn_date").notNull(),
    unitType: text("unit_type"),
    areaSqm: numeric("area_sqm", { mode: "number" }),
    bedrooms: integer("bedrooms"),
    priceAed: numeric("price_aed", { mode: "number" }),
    pricePerSqft: numeric("price_per_sqft", { mode: "number" }),
    isCash: boolean("is_cash"),
    // AGGREGATE/segment label only — never individual buyer PII (Decision 4).
    buyerSegment: text("buyer_segment"),
    // Aggregate nationality label only — never individual buyer PII.
    buyerNationality: text("buyer_nationality"),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    asOf: timestamp("as_of"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("market_transactions_source_ref_ux").on(t.source, t.sourceRef),
    index("market_transactions_project_idx").on(t.marketProjectId),
    index("market_transactions_date_idx").on(t.txnDate),
  ]
);

export const marketPriceIndex = pgTable(
  "market_price_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaName: text("area_name").notNull(),
    segment: text("segment"),
    period: text("period").notNull(), // e.g. "2026-Q1"
    indexValue: numeric("index_value", { mode: "number" }),
    avgPricePerSqft: numeric("avg_price_per_sqft", { mode: "number" }),
    yoyPct: numeric("yoy_pct", { mode: "number" }),
    source: text("source").notNull(),
    asOf: timestamp("as_of"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("market_price_index_key_ux").on(
      t.areaName,
      t.segment,
      t.period,
      t.source
    ),
  ]
);

// Bridge: OWN project → comparable MARKET projects. Links the two catalogs so an
// own project can show "similar developments" without copying competitor data
// into the own catalog (Design §Data Models, Decision 1).
export const projectComparables = pgTable(
  "project_comparables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    marketProjectId: uuid("market_project_id")
      .notNull()
      .references(() => marketProjects.id, { onDelete: "cascade" }),
    similarityScore: numeric("similarity_score", { mode: "number" }),
    rationale: text("rationale"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("project_comparables_pair_ux").on(
      t.projectId,
      t.marketProjectId
    ),
  ]
);

// ── Prospecting domain (S7) ──────────────────────────────────────────────────
// The outbound prospecting domain: a Prospecting_Brief (what the rep wants to
// sell), the canonical Target object (a pre-qualification record distinct from a
// Lead and never a `tickets` row, Req 1.4 / Decision 3), editable grounded
// OutreachDrafts, and a do-not-contact opt-out store.
//
// Privacy (CC-Privacy / Req 1.5, 9.2): a Target's phone is persisted ONLY as a
// salted `phone_hash`; `raw_phone` is a transient Salesforce-ingress copy purged
// ≤24h after forwarding to the outbox.
//
// Provenance (CC-Provenance / Req 1.3, 9.1): every Target carries record-level
// `source_provider` + `lawful_basis`, and a per-field `attributes` provenance map
// (Record<field, {value, source, asOf, lawfulBasis}>).
//
// Grounding (CC-SQL / Req 6.2): an OutreachDraft carries a `grounding` manifest
// pinning every factual claim to a SQL source record.
//
// Idempotency (CC-Idem / Req 7.2, 8.2): a unique `job_key` on outreach_drafts
// keeps a send at-most-once across retries.
//
// See prospecting-workspace design §Data Models (Prospecting domain).
// Requirements: 1.2, 1.3, 1.5, 7.3.

export const prospectingBriefs = pgTable("prospecting_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  aiUnitId: uuid("ai_unit_id").references(() => aiUnits.id, {
    onDelete: "set null",
  }),
  spec: jsonb("spec").notNull(),
  // Editable Buyer_Hypothesis proposal the rep can adjust before search.
  buyerHypothesis: jsonb("buyer_hypothesis"),
  status: text("status", {
    enum: ["draft", "searching", "complete", "archived"],
  })
    .notNull()
    .default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id").references(() => prospectingBriefs.id, {
      onDelete: "set null",
    }),
    targetType: text("target_type", {
      enum: ["person", "company", "intermediary"],
    }).notNull(),
    displayName: text("display_name"),
    companyName: text("company_name"),
    title: text("title"),
    // Normalized; matchable identity for dedupe.
    email: text("email"),
    // Salted hash only — never a raw phone (CC-Privacy, Req 1.5).
    phoneHash: text("phone_hash"),
    // Transient Salesforce-ingress copy; purged ≤24h after outbox forwarding.
    rawPhone: text("raw_phone"),
    country: text("country"),
    // Per-field provenance map: Record<field, {value, source, asOf, lawfulBasis}>.
    attributes: jsonb("attributes"),
    // Record-acquisition provenance (Req 1.3, CC-Provenance).
    sourceProvider: text("source_provider").notNull(),
    sourceRef: text("source_ref"),
    // Record-level lawful basis (Req 9.1).
    lawfulBasis: text("lawful_basis").notNull(),
    status: text("status", {
      enum: [
        "new",
        "researching",
        "qualified",
        "promoted",
        "discarded",
        "opted_out",
      ],
    })
      .notNull()
      .default("new"),
    // Set on promotion to a Lead (Req 5).
    partyId: uuid("party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("targets_brief_idx").on(t.briefId),
    index("targets_party_idx").on(t.partyId),
    index("targets_status_idx").on(t.status),
  ]
);

export const outreachDrafts = pgTable(
  "outreach_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    briefId: uuid("brief_id").references(() => prospectingBriefs.id, {
      onDelete: "set null",
    }),
    channel: text("channel", {
      enum: ["email", "whatsapp", "message"],
    }).notNull(),
    language: text("language", { enum: ["en", "ar"] }).notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    // The grounding manifest: every factual claim → its SQL source record.
    grounding: jsonb("grounding").notNull(),
    status: text("status", {
      enum: ["draft", "approved", "sent", "suppressed"],
    })
      .notNull()
      .default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id),
    // Send idempotency key (CC-Idem, Req 7.2, 8.2).
    jobKey: text("job_key"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("outreach_drafts_target_idx").on(t.targetId),
    uniqueIndex("outreach_drafts_job_key_ux").on(t.jobKey),
  ]
);

export const prospectOptouts = pgTable(
  "prospect_optouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchKind: text("match_kind", {
      enum: ["email", "phone_hash"],
    }).notNull(),
    matchValue: text("match_value").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("prospect_optouts_match_ux").on(t.matchKind, t.matchValue),
  ]
);
