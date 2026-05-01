import type { PageData, ComponentInstance } from "../types";
import { validatePageData } from "../schema";
import {
  componentTemplates,
  instantiate,
  type ComponentTemplate,
} from "./component-templates";

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tpl(id: string): ComponentTemplate {
  const t = componentTemplates.find((c) => c.id === id);
  if (!t) throw new Error(`Built-in template "${id}" not found`);
  return t;
}

/**
 * Compose a page from a list of built-in component template IDs by
 * materialising each one and concatenating their content + zones.
 */
function composePage(
  rootProps: Record<string, unknown>,
  templateIds: string[]
): PageData {
  const content: ComponentInstance[] = [];
  const zones: Record<string, ComponentInstance[]> = {};

  for (const id of templateIds) {
    const inst = instantiate(tpl(id));
    content.push(...inst.content);
    Object.assign(zones, inst.zones);
  }

  return { root: { props: rootProps }, content, zones };
}

// ─── Built-in Page Templates (reset) ─────────────────────────────────────────

function makeStarterHeroPage(): PageTemplate {
  return {
    id: "starter-hero-page",
    name: "Starter Hero Page",
    description: "Initial rebuild template: full-screen hero with centered title/subtitle and scroll indicator.",
    thumbnailId: "tpl-starter-hero",
    data: composePage({ title: "Why Bayn" }, ["tpl-starter-hero"]),
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

function builtInPageTemplates(): PageTemplate[] {
  return [makeStarterHeroPage()];
}

export function createTemplateRegistry(): TemplateRegistry {
  const templates: PageTemplate[] = [];

  function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  function register(template: PageTemplate): void {
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
