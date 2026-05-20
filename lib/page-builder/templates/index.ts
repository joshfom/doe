import type { PageData } from "../types";
import { validatePageData } from "../schema";
import {
  oraProjectPageTemplate,
  whyBaynTemplate,
  lifeAtBaynTemplate,
  aboutOraTemplate,
} from "./ora";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  thumbnailId: string;
  data: PageData;
}

export interface TemplateRegistry {
  list(): PageTemplate[];
  getById(id: string): PageTemplate | null;
  register(template: PageTemplate): void;
}

// ─── Built-in Page Templates ─────────────────────────────────────────────────

function builtInPageTemplates(): PageTemplate[] {
  return [
    oraProjectPageTemplate(),
    whyBaynTemplate(),
    lifeAtBaynTemplate(),
    aboutOraTemplate(),
  ];
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createTemplateRegistry(): TemplateRegistry {
  const templates: PageTemplate[] = [];

  function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  function register(template: PageTemplate): void {
    if (templates.some((t) => t.id === template.id)) {
      throw new Error(
        `Template with id "${template.id}" already exists in the registry (attempted to register "${template.name}")`
      );
    }

    const validation = validatePageData(template.data);
    if (!validation.success) {
      const msgs = (validation.errors ?? [])
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");
      throw new Error(
        `Invalid template data for "${template.name}": ${msgs}`
      );
    }
    templates.push(deepClone(template));
  }

  for (const t of builtInPageTemplates()) {
    register(t);
  }

  return {
    list(): PageTemplate[] {
      return templates.map(deepClone);
    },
    getById(id: string): PageTemplate | null {
      const found = templates.find((t) => t.id === id);
      return found ? deepClone(found) : null;
    },
    register,
  };
}
