import type React from "react";

/**
 * A single component instance within a page's content tree.
 * Maps to a registered component key in the Puck Config.
 */
export interface ComponentInstance {
  type: string;
  props: {
    id: string;
    [key: string]: unknown;
  };
}

/**
 * The canonical page data format produced by the Puck editor.
 * This is the JSON payload stored in the database.
 */
export interface PageData {
  root: {
    props: {
      title?: string;
      [key: string]: unknown;
    };
  };
  content: ComponentInstance[];
  zones?: Record<string, ComponentInstance[]>;
}

/**
 * Metadata for a managed page (stored separately from page data).
 */
export interface PageMeta {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/**
 * A complete page record combining metadata and page data.
 */
export interface PageRecord {
  meta: PageMeta;
  data: PageData;
}

/**
 * Theme configuration for the visual editor UI.
 */
export interface EditorTheme {
  colors: {
    primary: string;
    primaryForeground: string;
    sidebar: string;
    sidebarForeground: string;
    canvas: string;
  };
  logo?: React.ReactNode;
  fontFamily?: string;
}

/**
 * Result of a schema validation operation.
 */
export interface ValidationResult {
  success: boolean;
  errors?: Array<{ path: string; message: string }>;
}
