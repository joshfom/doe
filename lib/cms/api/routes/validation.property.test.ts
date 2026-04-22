import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

/**
 * Property-based tests for API validation.
 *
 * **Validates: Requirements 14.3**
 *
 * Property 23: API rejects invalid input with descriptive errors
 *
 * For any API endpoint that accepts a request body, sending a body that
 * violates the validation schema SHALL return a 400 response with an
 * error message describing which fields are invalid.
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

interface StoredFormDefinition {
  id: string;
  name: string;
  fields: unknown;
  salesforceEndpoint: string | null;
  webhookUrl: string | null;
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
let formDefinitionStore: StoredFormDefinition[] = [];
let formSubmissionStore: Array<Record<string, unknown>> = [];
let siteSettingStore: StoredSiteSetting[] = [];

function resetStores() {
  pageStore = [];
  revisionStore = [];
  auditStore = [];
  formDefinitionStore = [];
  formSubmissionStore = [];
  siteSettingStore = [];
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
    insert: vi.fn((table: any) => {
      const tableName = identifyTable(table);
      return {
        values: (vals: any) => {
          const record: any = {
            id: crypto.randomUUID(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...vals,
          };
          if (tableName === "pages") {
            record.status = record.status ?? "draft";
            record.isSystem = record.isSystem ?? false;
            record.publishedAt = record.publishedAt ?? null;
            pageStore.push(record);
          } else if (tableName === "revisions") {
            revisionStore.push(record);
          } else if (tableName === "audit_log") {
            auditStore.push(record);
          } else if (tableName === "form_definitions") {
            formDefinitionStore.push(record);
          } else if (tableName === "form_submissions") {
            formSubmissionStore.push(record);
          } else if (tableName === "site_settings") {
            record.value = record.value ?? "";
            siteSettingStore.push(record);
          }
          return {
            returning: () => ({
              then: (resolve: any) => resolve([record]),
            }),
            then: (resolve: any) => resolve([record]),
          };
        },
      };
    }),
    update: vi.fn((table: any) => {
      const tableName = identifyTable(table);
      return {
        set: (updates: any) => ({
          where: (cond: any) => {
            let updated: any = null;
            const store = getStore(tableName);
            for (const item of store) {
              if (resolveCondition(cond, item)) {
                Object.assign(item, updates);
                updated = item;
                break;
              }
            }
            return {
              returning: () => ({
                then: (resolve: any) => resolve(updated ? [updated] : []),
              }),
              then: (resolve: any) => resolve(updated ? [updated] : []),
            };
          },
        }),
      };
    }),
    delete: vi.fn(() => ({
      where: () => ({ then: (resolve: any) => resolve(undefined) }),
    })),
  };
  return { db: mockDb };
});

// Mock auth — provides userId for protected routes
vi.mock("../auth", async () => {
  const { Elysia } = await import("elysia");
  return {
    SESSION_COOKIE_NAME: "ora_session",
    authGuard: new Elysia({ name: "authGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: "test-user-id" })
    ),
    validateSession: vi.fn(async () => "test-user-id"),
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
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: "ora_session=test_token",
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

// Generate invalid page bodies: missing or empty title
const invalidPageBodyArb = fc.oneof(
  fc.constant({}), // missing title entirely
  fc.constant({ title: "" }), // empty title
  fc.constant({ title: "   " }) // whitespace-only title
);

// Generate invalid form bodies: missing or empty name
const invalidFormBodyArb = fc.oneof(
  fc.constant({}), // missing name
  fc.constant({ name: "" }), // empty name
  fc.constant({ name: "Valid", fields: [] }), // empty fields array
  fc.constant({ name: "Valid" }) // missing fields
);

// Generate invalid settings bodies: missing settings object
const invalidSettingsBodyArb = fc.oneof(
  fc.constant({}), // missing settings
  fc.constant({ settings: "not-an-object" }), // wrong type
  fc.constant({ settings: null }) // null
);

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
});

// ── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: ora-cms-platform, Property 23: API rejects invalid input with descriptive errors", () => {
  it("POST /pages with missing/empty title returns 400 with error message", async () => {
    await fc.assert(
      fc.asyncProperty(invalidPageBodyArb, async (body) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "POST", "/pages", body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBeTruthy();
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.toLowerCase()).toContain("title");
      }),
      { numRuns: 20 }
    );
  });

  it("POST /forms with missing/empty name or fields returns 400 with error message", async () => {
    await fc.assert(
      fc.asyncProperty(invalidFormBodyArb, async (body) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "POST", "/forms", body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBeTruthy();
        expect(typeof res.body.error).toBe("string");
      }),
      { numRuns: 20 }
    );
  });

  it("PUT /settings with missing/invalid settings returns 400 with error message", async () => {
    await fc.assert(
      fc.asyncProperty(invalidSettingsBodyArb, async (body) => {
        resetStores();
        const app = createApp();
        const res = await apiRequest(app, "PUT", "/settings", body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBeTruthy();
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.toLowerCase()).toContain("settings");
      }),
      { numRuns: 20 }
    );
  });
});
