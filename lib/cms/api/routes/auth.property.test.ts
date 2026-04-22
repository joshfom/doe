import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

/**
 * Property-based tests for auth guard on mutating endpoints.
 *
 * **Validates: Requirements 14.4**
 *
 * Property 22: Auth required for mutating endpoints
 *
 * For any mutating API endpoint (POST, PUT, DELETE), sending a request
 * without a valid session cookie SHALL return 401 Unauthorized and
 * SHALL NOT modify any data.
 */

// ── In-memory stores ─────────────────────────────────────────────────────────

interface StoredPage {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  namespace: string;
  status: "draft" | "published";
  isSystem: boolean;
  data: unknown;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredSiteSetting {
  id: string;
  key: string;
  value: string;
  updatedAt: Date;
}

let pageStore: StoredPage[] = [];
let revisionStore: Array<Record<string, unknown>> = [];
let auditStore: Array<Record<string, unknown>> = [];
let formDefinitionStore: Array<Record<string, unknown>> = [];
let formSubmissionStore: Array<Record<string, unknown>> = [];
let siteSettingStore: StoredSiteSetting[] = [];
let mediaItemStore: Array<Record<string, unknown>> = [];

function resetStores() {
  pageStore = [];
  revisionStore = [];
  auditStore = [];
  formDefinitionStore = [];
  formSubmissionStore = [];
  siteSettingStore = [];
  mediaItemStore = [];
}

// ── Drizzle ORM mock ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...(actual as any),
    eq: (col: any, value: any) => ({ __type: "eq", field: col?.name, value }),
    and: (...conditions: any[]) => ({
      __type: "and",
      conditions: conditions.filter(Boolean),
    }),
    or: (...conditions: any[]) => ({
      __type: "or",
      conditions: conditions.filter(Boolean),
    }),
    desc: (col: any) => ({ __type: "desc", field: col?.name }),
    gt: (col: any, value: any) => ({ __type: "gt", field: col?.name, value }),
    ilike: (col: any, pattern: string) => ({
      __type: "ilike",
      field: col?.name,
      pattern,
    }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) => ({
        __type: "sql_tag",
        raw: true,
      }),
      { raw: (s: string) => ({ __type: "sql_raw", value: s }) }
    ),
  };
});

function resolveCondition(cond: any, item: any): boolean {
  if (!cond) return true;
  if (cond.__type === "eq") return item[cond.field] === cond.value;
  if (cond.__type === "and")
    return cond.conditions.every((c: any) => resolveCondition(c, item));
  if (cond.__type === "or")
    return cond.conditions.some((c: any) => resolveCondition(c, item));
  return true;
}

function identifyTable(table: any): string {
  const cols = table ? Object.keys(table) : [];
  if (cols.includes("slug") && cols.includes("locale")) return "pages";
  if (cols.includes("pageId") && cols.includes("revisionNumber"))
    return "revisions";
  if (cols.includes("entityType") && cols.includes("action"))
    return "audit_log";
  if (
    cols.includes("salesforceEndpoint") ||
    (cols.includes("fields") && cols.includes("webhookUrl"))
  )
    return "form_definitions";
  if (cols.includes("formId") && cols.includes("sourcePageSlug"))
    return "form_submissions";
  if (cols.includes("key") && cols.includes("value") && !cols.includes("action"))
    return "site_settings";
  if (cols.includes("storageUrl") && cols.includes("mimeType"))
    return "media_items";
  if (cols.includes("mediaId") && cols.includes("componentId"))
    return "media_references";
  if (cols.includes("token") && cols.includes("expiresAt")) return "sessions";
  if (cols.includes("email") && cols.includes("passwordHash")) return "users";
  if (table?._?.name) return table._.name;
  return "unknown";
}

function getStore(tableName: string): any[] {
  switch (tableName) {
    case "pages": return pageStore;
    case "revisions": return revisionStore;
    case "audit_log": return auditStore;
    case "form_definitions": return formDefinitionStore;
    case "form_submissions": return formSubmissionStore;
    case "site_settings": return siteSettingStore;
    case "media_items": return mediaItemStore;
    default: return [];
  }
}

vi.mock("../../db", () => {
  const buildSelect = (fields?: Record<string, any>) => {
    let tableName = "unknown";
    let whereCond: any = null;
    let limitVal: number | null = null;

    const chain: any = {};
    chain.from = (table: any) => {
      tableName = identifyTable(table);
      return chain;
    };
    chain.where = (cond: any) => {
      whereCond = cond;
      return chain;
    };
    chain.orderBy = (..._args: any[]) => chain;
    chain.limit = (n: number) => {
      limitVal = n;
      return chain;
    };
    chain.then = (resolve: any, reject?: any) => {
      try {
        let results = [...getStore(tableName)];
        if (whereCond)
          results = results.filter((item) => resolveCondition(whereCond, item));
        if (limitVal) results = results.slice(0, limitVal);
        if (fields && Object.keys(fields).length > 0) {
          results = results.map((item) => {
            const projected: any = {};
            for (const [alias, col] of Object.entries(fields)) {
              const colName = (col as any)?.name || alias;
              projected[alias] = item[colName];
            }
            return projected;
          });
        }
        resolve(results);
      } catch (e) {
        reject?.(e);
      }
    };
    return chain;
  };

  const mockDb = {
    select: vi.fn((fields?: any) => buildSelect(fields)),
    insert: vi.fn(() => ({
      values: () => ({
        returning: () => ({ then: (resolve: any) => resolve([]) }),
        then: (resolve: any) => resolve([]),
      }),
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => ({ then: (resolve: any) => resolve([]) }),
          then: (resolve: any) => resolve([]),
        }),
      }),
    })),
    delete: vi.fn(() => ({
      where: () => ({ then: (resolve: any) => resolve(undefined) }),
    })),
  };
  return { db: mockDb };
});

// Mock auth — this time the guard REJECTS (no valid session)
vi.mock("../auth", async () => {
  const { Elysia } = await import("elysia");
  const authGuard = new Elysia({ name: "authGuard" })
    .derive({ as: "scoped" }, async ({ set }) => {
      set.status = 401;
      return { userId: null as unknown as string };
    })
    .onBeforeHandle({ as: "scoped" }, ({ userId, set }) => {
      if (!userId) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
    });

  return {
    SESSION_COOKIE_NAME: "ora_session",
    authGuard,
    validateSession: vi.fn(async () => null),
  };
});

vi.mock("../../audit", () => ({
  logAudit: vi.fn(async () => {}),
}));

vi.mock("../../utils/slug", () => ({
  generateSlug: (title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled",
  ensureUniqueSlug: (base: string, existing: string[]) => {
    if (!existing.includes(base)) return base;
    let i = 1;
    while (existing.includes(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  },
}));

vi.mock("../../storage", () => ({
  createStorageBackend: () => ({
    upload: vi.fn(async () => "/uploads/test.jpg"),
    delete: vi.fn(async () => {}),
  }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { pagesRoutes } from "./pages";
import { formsRoutes } from "./forms";
import { settingsRoutes } from "./settings";
import { Elysia } from "elysia";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  return new Elysia().use(pagesRoutes).use(formsRoutes).use(settingsRoutes);
}

async function apiRequest(
  app: any,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  // No session cookie — unauthenticated request
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const titleArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,20}$/)
  .filter((s) => s.trim().length > 0);

const formNameArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,20}$/)
  .filter((s) => s.trim().length > 0);

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
});

// ── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: ora-cms-platform, Property 22: Auth required for mutating endpoints", () => {
  it("POST /pages without auth returns 401", async () => {
    await fc.assert(
      fc.asyncProperty(titleArb, async (title) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "POST", "/pages", { title });
        expect(res.status).toBe(401);
        expect(res.body.error).toBeTruthy();
        // No page should have been created
        expect(pageStore.length).toBe(0);
      }),
      { numRuns: 20 }
    );
  });

  it("PUT /pages/:id without auth returns 401", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), titleArb, async (id, title) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "PUT", `/pages/${id}`, { title });
        expect(res.status).toBe(401);
        expect(res.body.error).toBeTruthy();
      }),
      { numRuns: 20 }
    );
  });

  it("DELETE /pages/:id without auth returns 401", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (id) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "DELETE", `/pages/${id}`);
        expect(res.status).toBe(401);
        expect(res.body.error).toBeTruthy();
      }),
      { numRuns: 20 }
    );
  });

  it("POST /forms without auth returns 401", async () => {
    await fc.assert(
      fc.asyncProperty(formNameArb, async (name) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "POST", "/forms", {
          name,
          fields: [{ name: "email", label: "Email", type: "email", required: true }],
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toBeTruthy();
        expect(formDefinitionStore.length).toBe(0);
      }),
      { numRuns: 20 }
    );
  });

  it("PUT /settings without auth returns 401", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/).filter((s) => s.length > 0),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (key, value) => {
          resetStores();
          const app = createApp();
          const res = await apiRequest(app, "PUT", "/settings", {
            settings: { [key]: value },
          });
          expect(res.status).toBe(401);
          expect(res.body.error).toBeTruthy();
          expect(siteSettingStore.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });
});
