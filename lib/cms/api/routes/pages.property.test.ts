import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

/**
 * Property-based tests for Pages and Revisions API routes.
 *
 * These tests verify business logic properties by simulating the
 * database layer with in-memory stores and testing route handlers
 * through Elysia's .handle() method.
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

interface StoredRevision {
  id: string;
  pageId: string;
  userId: string;
  data: unknown;
  titleSnapshot: string;
  slugSnapshot: string;
  action: "save" | "rollback";
  revisionNumber: number;
  createdAt: Date;
}

let pageStore: StoredPage[] = [];
let revisionStore: StoredRevision[] = [];
let auditStore: Array<Record<string, unknown>> = [];

function resetStores() {
  pageStore = [];
  revisionStore = [];
  auditStore = [];
}

// ── Drizzle ORM mock ─────────────────────────────────────────────────────────
// We intercept eq/and/sql from drizzle-orm to capture filter predicates,
// then mock the db module to operate on in-memory stores.

// Track the current where-filter as a JS predicate function
let currentWherePredicate: ((item: any) => boolean) | null = null;
let currentOrderDesc = false;
let currentOrderField: string | null = null;

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...actual as any,
    eq: (col: any, value: any) => {
      const colName = col?.name;
      // Return a marker object
      return { __type: "eq", field: colName, value };
    },
    and: (...conditions: any[]) => {
      return { __type: "and", conditions: conditions.filter(Boolean) };
    },
    desc: (col: any) => {
      return { __type: "desc", field: col?.name };
    },
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) => {
        // For ORDER BY sql`revision_number DESC`
        return { __type: "sql_tag", raw: true };
      },
      { raw: (s: string) => ({ __type: "sql_raw", value: s }) }
    ),
  };
});

function resolveCondition(cond: any, item: any): boolean {
  if (!cond) return true;
  if (cond.__type === "eq") {
    return item[cond.field] === cond.value;
  }
  if (cond.__type === "and") {
    return cond.conditions.every((c: any) => resolveCondition(c, item));
  }
  return true;
}

function identifyTable(table: any): "pages" | "revisions" | "audit_log" | "unknown" {
  // Drizzle table objects have a Symbol for the table name
  // We check known column names to identify
  const cols = table ? Object.keys(table) : [];
  if (cols.includes("slug") && cols.includes("locale")) return "pages";
  if (cols.includes("pageId") && cols.includes("revisionNumber")) return "revisions";
  if (cols.includes("entityType") && cols.includes("action")) return "audit_log";
  // Fallback: check the _ property
  if (table?._?.name) {
    const name = table._.name;
    if (name === "pages") return "pages";
    if (name === "revisions") return "revisions";
    if (name === "audit_log") return "audit_log";
  }
  return "unknown";
}

function getStore(tableName: string): any[] {
  if (tableName === "pages") return pageStore;
  if (tableName === "revisions") return revisionStore;
  if (tableName === "audit_log") return auditStore;
  return [];
}

vi.mock("../../db", () => {
  const buildSelect = (fields?: Record<string, any>) => {
    let tableName = "unknown";
    let whereCond: any = null;
    let orderByArgs: any[] = [];
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
    chain.orderBy = (...args: any[]) => {
      orderByArgs = args;
      return chain;
    };
    chain.limit = (n: number) => {
      limitVal = n;
      return chain;
    };

    chain.then = (resolve: any, reject?: any) => {
      try {
        let results = [...getStore(tableName)];

        // Apply where
        if (whereCond) {
          results = results.filter((item) => resolveCondition(whereCond, item));
        }

        // Apply ordering (simple: desc by revisionNumber for revisions)
        if (orderByArgs.length > 0) {
          const arg = orderByArgs[0];
          if (arg?.__type === "desc") {
            results.sort((a, b) => (b[arg.field] ?? 0) - (a[arg.field] ?? 0));
          } else if (arg?.__type === "sql_tag") {
            // ORDER BY revision_number DESC
            results.sort((a, b) => (b.revisionNumber ?? 0) - (a.revisionNumber ?? 0));
          }
        }

        // Apply limit
        if (limitVal) {
          results = results.slice(0, limitVal);
        }

        // Project fields if specified
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
          }

          return {
            returning: () => ({
              then: (resolve: any, reject?: any) => {
                resolve([record]);
              },
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
    delete: vi.fn((table: any) => {
      const tableName = identifyTable(table);
      return {
        where: (cond: any) => {
          if (tableName === "pages") {
            const toDelete = pageStore.filter((p) => resolveCondition(cond, p));
            // Cascade delete revisions
            for (const p of toDelete) {
              revisionStore = revisionStore.filter((r) => r.pageId !== p.id);
            }
            pageStore = pageStore.filter((p) => !resolveCondition(cond, p));
          } else if (tableName === "revisions") {
            revisionStore = revisionStore.filter((r) => !resolveCondition(cond, r));
          }
          return {
            then: (resolve: any) => resolve(undefined),
          };
        },
      };
    }),
  };

  return { db: mockDb };
});

// Mock auth
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

// Mock audit
vi.mock("../../audit", () => ({
  logAudit: vi.fn(async (_db: any, entry: any) => {
    auditStore.push(entry);
  }),
}));

// Mock slug utils
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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { pagesRoutes } from "./pages";
import { revisionsRoutes } from "./revisions";
import { Elysia } from "elysia";

// ── Test app factory ─────────────────────────────────────────────────────────

function createApp() {
  return new Elysia().use(pagesRoutes).use(revisionsRoutes);
}

async function apiRequest(
  app: ReturnType<typeof createApp>,
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

const titleArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,30}$/).filter(
  (s) => s.trim().length > 0
);

const localeArb = fc.constantFrom("en" as const, "ar" as const);

const pageDataArb = fc.record({
  root: fc.record({
    props: fc.record({
      title: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    }),
  }),
  content: fc.array(
    fc.record({
      type: fc.constantFrom("Hero", "Text", "Image"),
      props: fc.record({
        id: fc.uuid(),
      }),
    }),
    { maxLength: 3 }
  ),
});

// ── Property Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
});

/**
 * **Validates: Requirements 2.4**
 *
 * Property 4: Page CRUD round-trip
 *
 * For any valid page title, slug, locale, and PageData, creating a page
 * via the API and reading it back SHALL return matching data. Updating
 * and reading again SHALL reflect updates. Deleting SHALL make it
 * non-retrievable.
 */
describe("Feature: ora-cms-platform, Property 4: Page CRUD round-trip", () => {
  it("create → read → update → read → delete → read returns expected results at each step", async () => {
    await fc.assert(
      fc.asyncProperty(titleArb, pageDataArb, async (title, data) => {
        resetStores();
        const app = createApp();

        // CREATE
        const createRes = await apiRequest(app, "POST", "/pages", {
          title,
          locale: "en",
          data,
        });
        expect(createRes.status).toBe(201);
        const created = createRes.body.data;
        expect(created.title).toBe(title.trim());
        expect(created.locale).toBe("en");
        expect(created.status).toBe("draft");

        const pageId = created.id;

        // READ
        const readRes = await apiRequest(app, "GET", `/pages/${pageId}`);
        expect(readRes.status).toBe(200);
        expect(readRes.body.data.title).toBe(title.trim());
        expect(readRes.body.data.data).toEqual(data);

        // UPDATE
        const newTitle = title.trim() + " Updated";
        const newData = { root: { props: {} }, content: [] };
        const updateRes = await apiRequest(app, "PUT", `/pages/${pageId}`, {
          title: newTitle,
          data: newData,
        });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.data.title).toBe(newTitle);

        // READ after update
        const readRes2 = await apiRequest(app, "GET", `/pages/${pageId}`);
        expect(readRes2.status).toBe(200);
        expect(readRes2.body.data.title).toBe(newTitle);
        expect(readRes2.body.data.data).toEqual(newData);

        // DELETE
        const deleteRes = await apiRequest(app, "DELETE", `/pages/${pageId}`);
        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.data.success).toBe(true);

        // READ after delete — should 404
        const readRes3 = await apiRequest(app, "GET", `/pages/${pageId}`);
        expect(readRes3.status).toBe(404);
      }),
      { numRuns: 20 }
    );
  });
});

/**
 * **Validates: Requirements 3.2, 3.3**
 *
 * Property 6: System page deletion protection
 *
 * For any page marked with isSystem = true, attempting to delete it
 * SHALL be rejected with 403, and the page SHALL remain unchanged.
 */
describe("Feature: ora-cms-platform, Property 6: System page deletion protection", () => {
  it("system pages cannot be deleted and remain unchanged after attempt", async () => {
    await fc.assert(
      fc.asyncProperty(titleArb, pageDataArb, async (title, data) => {
        resetStores();

        // Seed a system page directly into the store
        const systemPage: StoredPage = {
          id: crypto.randomUUID(),
          title: title.trim(),
          slug: "system-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          locale: "en",
          namespace: crypto.randomUUID(),
          status: "published",
          isSystem: true,
          data,
          metaTitle: null,
          metaDescription: null,
          publishedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        pageStore.push(systemPage);

        const snapshotBefore = { ...systemPage };
        const app = createApp();

        // Attempt delete
        const deleteRes = await apiRequest(app, "DELETE", `/pages/${systemPage.id}`);
        expect(deleteRes.status).toBe(403);
        expect(deleteRes.body.error).toContain("System");

        // Page should still exist and be unchanged
        const readRes = await apiRequest(app, "GET", `/pages/${systemPage.id}`);
        expect(readRes.status).toBe(200);
        expect(readRes.body.data.id).toBe(snapshotBefore.id);
        expect(readRes.body.data.title).toBe(snapshotBefore.title);
        expect(readRes.body.data.isSystem).toBe(true);
        expect(readRes.body.data.data).toEqual(snapshotBefore.data);
      }),
      { numRuns: 20 }
    );
  });
});

/**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * Property 7: Draft/publish/unpublish lifecycle
 *
 * For any newly created page, initial status SHALL be "draft" with null
 * publishedAt. Publishing SHALL change to "published" with non-null
 * publishedAt. Unpublishing SHALL change back to "draft".
 */
describe("Feature: ora-cms-platform, Property 7: Draft/publish/unpublish lifecycle", () => {
  it("newly created pages start as draft, can be published, then unpublished", async () => {
    await fc.assert(
      fc.asyncProperty(titleArb, async (title) => {
        resetStores();
        const app = createApp();

        // CREATE — should be draft
        const createRes = await apiRequest(app, "POST", "/pages", { title });
        expect(createRes.status).toBe(201);
        const page = createRes.body.data;
        expect(page.status).toBe("draft");
        expect(page.publishedAt).toBeNull();

        // PUBLISH
        const publishRes = await apiRequest(app, "POST", `/pages/${page.id}/publish`);
        expect(publishRes.status).toBe(200);
        expect(publishRes.body.data.status).toBe("published");
        expect(publishRes.body.data.publishedAt).not.toBeNull();

        // UNPUBLISH
        const unpublishRes = await apiRequest(app, "POST", `/pages/${page.id}/unpublish`);
        expect(unpublishRes.status).toBe(200);
        expect(unpublishRes.body.data.status).toBe("draft");
      }),
      { numRuns: 20 }
    );
  });
});

/**
 * **Validates: Requirements 4.4, 4.5, 8.4, 13.5**
 *
 * Property 8: Public visibility excludes draft pages
 *
 * For any set of pages with mixed statuses, the public endpoint SHALL
 * return only published pages.
 */
describe("Feature: ora-cms-platform, Property 8: Public visibility excludes draft pages", () => {
  it("public endpoint only returns published pages, never drafts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            title: titleArb,
            shouldPublish: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (pageSpecs) => {
          resetStores();
          const app = createApp();

          const createdPages: Array<{ id: string; slug: string; published: boolean }> = [];

          for (let i = 0; i < pageSpecs.length; i++) {
            const spec = pageSpecs[i];
            // Use unique title to avoid slug collisions
            const uniqueTitle = spec.title + " " + i;
            const createRes = await apiRequest(app, "POST", "/pages", {
              title: uniqueTitle,
              locale: "en",
            });
            if (createRes.status !== 201) continue;

            const page = createRes.body.data;

            if (spec.shouldPublish) {
              await apiRequest(app, "POST", `/pages/${page.id}/publish`);
            }

            createdPages.push({
              id: page.id,
              slug: page.slug,
              published: spec.shouldPublish,
            });
          }

          // Check each page via public endpoint
          for (const p of createdPages) {
            const publicRes = await apiRequest(
              app,
              "GET",
              `/pages/public/en/${p.slug}`
            );

            if (p.published) {
              expect(publicRes.status).toBe(200);
              expect(publicRes.body.data.status).toBe("published");
            } else {
              expect(publicRes.status).toBe(404);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

/**
 * **Validates: Requirements 7.3, 7.6**
 *
 * Property 12: Locale clone produces correct AR page
 *
 * For any EN page, cloning to AR SHALL produce a page with same
 * namespace, slug, locale "ar", and deeply equal PageData.
 */
describe("Feature: ora-cms-platform, Property 12: Locale clone produces correct AR page", () => {
  it("cloning an EN page to AR produces matching namespace, slug, locale, and data", async () => {
    await fc.assert(
      fc.asyncProperty(titleArb, pageDataArb, async (title, data) => {
        resetStores();
        const app = createApp();

        // Create EN page
        const createRes = await apiRequest(app, "POST", "/pages", {
          title,
          locale: "en",
          data,
        });
        expect(createRes.status).toBe(201);
        const enPage = createRes.body.data;

        // Clone to AR
        const cloneRes = await apiRequest(
          app,
          "POST",
          `/pages/${enPage.id}/clone-locale`
        );
        expect(cloneRes.status).toBe(201);
        const arPage = cloneRes.body.data;

        // Verify AR page properties
        expect(arPage.locale).toBe("ar");
        expect(arPage.namespace).toBe(enPage.namespace);
        expect(arPage.slug).toBe(enPage.slug);
        expect(arPage.data).toEqual(enPage.data);
        expect(arPage.id).not.toBe(enPage.id);
      }),
      { numRuns: 20 }
    );
  });
});

/**
 * **Validates: Requirements 5.5**
 *
 * Property 9: Rollback restores revision data and creates new revision
 *
 * For any page with 2+ revisions, rolling back SHALL replace current
 * data with revision snapshot AND create a new revision with action
 * "rollback".
 */
describe("Feature: ora-cms-platform, Property 9: Rollback restores revision data and creates new revision", () => {
  it("rollback restores page data from revision and creates a rollback revision entry", async () => {
    await fc.assert(
      fc.asyncProperty(
        titleArb,
        pageDataArb,
        pageDataArb,
        async (title, data1, data2) => {
          resetStores();
          const app = createApp();

          // Create page with initial data
          const createRes = await apiRequest(app, "POST", "/pages", {
            title,
            locale: "en",
            data: data1,
          });
          expect(createRes.status).toBe(201);
          const pageId = createRes.body.data.id;

          // Update page (creates revision #1 with original data)
          const updateRes = await apiRequest(app, "PUT", `/pages/${pageId}`, {
            title: title.trim() + " V2",
            data: data2,
          });
          expect(updateRes.status).toBe(200);

          // Update again (creates revision #2)
          const data3 = { root: { props: {} }, content: [] };
          await apiRequest(app, "PUT", `/pages/${pageId}`, {
            title: title.trim() + " V3",
            data: data3,
          });

          // Now we have at least 2 revisions. Get the first revision.
          const revisionsForPage = revisionStore.filter(
            (r) => r.pageId === pageId
          );
          expect(revisionsForPage.length).toBeGreaterThanOrEqual(2);

          const targetRevision = revisionsForPage[0]; // revision #1 (original data)
          const revisionCountBefore = revisionsForPage.length;

          // ROLLBACK to revision #1
          const rollbackRes = await apiRequest(
            app,
            "POST",
            `/revisions/${pageId}/rollback/${targetRevision.id}`
          );
          expect(rollbackRes.status).toBe(200);

          // Page data should match the target revision's snapshot
          const readRes = await apiRequest(app, "GET", `/pages/${pageId}`);
          expect(readRes.status).toBe(200);
          expect(readRes.body.data.data).toEqual(targetRevision.data);
          expect(readRes.body.data.title).toBe(targetRevision.titleSnapshot);

          // A new revision with action="rollback" should have been created
          const revisionsAfter = revisionStore.filter(
            (r) => r.pageId === pageId
          );
          expect(revisionsAfter.length).toBe(revisionCountBefore + 1);

          const rollbackRevision = revisionsAfter[revisionsAfter.length - 1];
          expect(rollbackRevision.action).toBe("rollback");
          expect(rollbackRevision.data).toEqual(targetRevision.data);
        }
      ),
      { numRuns: 20 }
    );
  });
});

/**
 * **Validates: Requirements 2.7, 5.6, 15.4**
 *
 * Property 5: Cascade delete removes all associated records
 *
 * For any page with revisions, deleting the page SHALL also delete all
 * revisions. Querying revisions by deleted page ID SHALL return empty.
 */
describe("Feature: ora-cms-platform, Property 5: Cascade delete removes all associated records", () => {
  it("deleting a page removes all its revisions", async () => {
    await fc.assert(
      fc.asyncProperty(
        titleArb,
        fc.integer({ min: 1, max: 3 }),
        async (title, updateCount) => {
          resetStores();
          const app = createApp();

          // Create page
          const createRes = await apiRequest(app, "POST", "/pages", {
            title,
            locale: "en",
          });
          expect(createRes.status).toBe(201);
          const pageId = createRes.body.data.id;

          // Perform updates to create revisions
          for (let i = 0; i < updateCount; i++) {
            await apiRequest(app, "PUT", `/pages/${pageId}`, {
              title: title.trim() + ` v${i + 2}`,
            });
          }

          // Verify revisions exist
          const revsBefore = revisionStore.filter((r) => r.pageId === pageId);
          expect(revsBefore.length).toBe(updateCount);

          // DELETE page
          const deleteRes = await apiRequest(app, "DELETE", `/pages/${pageId}`);
          expect(deleteRes.status).toBe(200);

          // Revisions should be cascade-deleted
          const revsAfter = revisionStore.filter((r) => r.pageId === pageId);
          expect(revsAfter.length).toBe(0);

          // Page should not be retrievable
          const readRes = await apiRequest(app, "GET", `/pages/${pageId}`);
          expect(readRes.status).toBe(404);
        }
      ),
      { numRuns: 20 }
    );
  });
});
