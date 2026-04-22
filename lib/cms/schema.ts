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
} from "drizzle-orm/pg-core";

// ── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
    status: text("status", { enum: ["draft", "published"] })
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

// ── Site Settings ────────────────────────────────────────────────────────────
export const siteSettings = pgTable("site_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
