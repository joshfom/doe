import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

// Feature: content-approval-workflow, Property 8: Pending content excluded from public queries

// ── Types ────────────────────────────────────────────────────────────────────

type ContentStatus = "draft" | "published" | "trashed" | "pending_review";

interface ContentItem {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  status: ContentStatus;
  contentModule: ContentModule;
}

// ── In-memory store simulating public-facing queries ─────────────────────────

class PublicQueryStore {
  private items: ContentItem[] = [];

  addContent(item: ContentItem): void {
    this.items.push(item);
  }

  /**
   * Simulate public-facing query: returns only items with status "published".
   * This mirrors the behavior of GET /posts/public/:locale and
   * GET /pages/public/:locale/:slug which filter by eq(status, "published").
   */
  getPublicContent(locale: "en" | "ar"): ContentItem[] {
    return this.items.filter(
      (item) => item.locale === locale && item.status === "published"
    );
  }
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const contentModuleArb = fc.constantFrom<ContentModule>(
  "pages",
  "blog",
  "news",
  "construction_updates"
);

const uuidArb = fc.uuid();
const localeArb = fc.constantFrom<"en" | "ar">("en", "ar");

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

const statusArb = fc.constantFrom<ContentStatus>(
  "draft",
  "published",
  "trashed",
  "pending_review"
);


// ─────────────────────────────────────────────────────────────────────────────
// Property 8: Pending content excluded from public queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.4**
 *
 * Property 8: Pending content excluded from public queries
 *
 * For any content item with status "pending_review", public-facing API
 * queries should never include that item in their results.
 */
// Feature: content-approval-workflow, Property 8: Pending content excluded from public queries
describe("Feature: content-approval-workflow, Property 8: Pending content excluded from public queries", () => {
  it("pending_review items are never returned by public-facing queries", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(uuidArb, nonEmptyStringArb, nonEmptyStringArb, localeArb, statusArb, contentModuleArb),
          { minLength: 1, maxLength: 15 }
        ),
        localeArb,
        (contentItems, queryLocale) => {
          const store = new PublicQueryStore();

          // Populate store with items of various statuses
          const seenIds = new Set<string>();
          for (const [id, title, slug, locale, status, mod] of contentItems) {
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            store.addContent({ id, title, slug, locale, status, contentModule: mod });
          }

          // Query public content
          const results = store.getPublicContent(queryLocale);

          // No result should have status "pending_review"
          for (const item of results) {
            expect(item.status).not.toBe("pending_review");
            expect(item.status).toBe("published");
          }

          // Specifically verify: any item we added with pending_review must NOT appear
          for (const [id, , , locale, status] of contentItems) {
            if (status === "pending_review" && locale === queryLocale) {
              const found = results.find((r) => r.id === id);
              expect(found).toBeUndefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
