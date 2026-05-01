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
  date,
  time,
  numeric,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

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
  },
  (table) => [
    uniqueIndex("approval_config_approvers_unique_idx").on(
      table.configId,
      table.userId
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("approval_decisions_unique_idx").on(
      table.requestId,
      table.approverId
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
  ]
);

// ── Ticket Notes ─────────────────────────────────────────────────────────────
export const ticketNotes = pgTable(
  "ticket_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ticket_notes_ticket_id_idx").on(table.ticketId),
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
      enum: ["noc", "move_in", "vendor_access", "construction_material_delivery"],
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
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
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
    channel: text("channel"),
    language: text("language", { enum: ["en", "ar"] })
      .notNull()
      .default("en"),
    status: text("status", {
      enum: ["active", "resolved", "handed_off", "abandoned"],
    })
      .notNull()
      .default("active"),
    handoffSummary: jsonb("handoff_summary"),
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
      enum: ["user", "assistant", "system"],
    }).notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
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

