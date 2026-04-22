import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { InMemoryDataStore } from "./data-store";
import {
  InMemoryPageMetaStore,
  createPageManager,
  SlugConflictError,
} from "./page-manager";
import type { PageData } from "./types";

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates a valid URL slug: lowercase alphanumeric + hyphens, non-empty, no leading/trailing hyphens */
const slugArb = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/, { minLength: 1, maxLength: 30 })
  .filter((s) => s.length > 0);

/** Generates a non-empty page title */
const titleArb = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0);

/** Generates a valid ComponentInstance */
const componentInstanceArb = fc.record({
  type: fc.string({ minLength: 1, maxLength: 20 }),
  props: fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 20 }),
    })
    .map((p) => ({ ...p })),
});

/** Generates a valid PageData object */
const pageDataArb: fc.Arbitrary<PageData> = fc.record({
  root: fc.record({
    props: fc.constant({}),
  }),
  content: fc.array(componentInstanceArb, { minLength: 0, maxLength: 3 }),
});

/** Helper: create fresh stores + manager for each test iteration */
function freshManager() {
  const dataStore = new InMemoryDataStore();
  const metaStore = new InMemoryPageMetaStore();
  const manager = createPageManager({ dataStore, metaStore });
  return { dataStore, metaStore, manager };
}

// ── Property 3: PageManager CRUD integrity ──────────────────────────────────

/**
 * Feature: puck-visual-page-builder, Property 3: PageManager CRUD integrity
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 *
 * For any valid page title, slug, and PageData, creating a page via the
 * PageManager and then retrieving it by ID SHALL return a page with matching
 * title, slug, and data. Updating the page with new valid values and
 * retrieving again SHALL reflect the updates. Deleting the page SHALL make
 * it no longer retrievable.
 */
describe("PageManager CRUD integrity", () => {
  it("create → read → update → read → delete → not found", async () => {
    await fc.assert(
      fc.asyncProperty(
        titleArb,
        slugArb,
        pageDataArb,
        titleArb,
        pageDataArb,
        async (title, slug, data, newTitle, newData) => {
          const { manager, metaStore, dataStore } = freshManager();

          // CREATE
          const createResult = await manager.createPage(title, slug, data);
          expect(createResult.ok).toBe(true);
          if (!createResult.ok) return;

          const id = createResult.value.id;

          // READ after create — meta matches
          const meta = await metaStore.getById(id);
          expect(meta).not.toBeNull();
          expect(meta!.title).toBe(title);
          expect(meta!.slug).toBe(slug);
          expect(meta!.status).toBe("draft");

          // READ after create — data matches
          const loadedData = await dataStore.load(id);
          expect(loadedData).toEqual(data);

          // UPDATE
          const updateResult = await manager.updatePage(id, {
            title: newTitle,
            data: newData,
          });
          expect(updateResult.ok).toBe(true);

          // READ after update — meta reflects new title
          const updatedMeta = await metaStore.getById(id);
          expect(updatedMeta!.title).toBe(newTitle);

          // READ after update — data reflects new data
          const updatedData = await dataStore.load(id);
          expect(updatedData).toEqual(newData);

          // DELETE
          const deleteResult = await manager.deletePage(id);
          expect(deleteResult.ok).toBe(true);

          // READ after delete — not found
          const deletedMeta = await metaStore.getById(id);
          expect(deletedMeta).toBeNull();
          const deletedData = await dataStore.load(id);
          expect(deletedData).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ── Property 4: Publish/unpublish round-trip ────────────────────────────────

/**
 * Feature: puck-visual-page-builder, Property 4: Publish/unpublish round-trip
 *
 * Validates: Requirements 6.5, 6.6
 *
 * For any draft page, publishing it SHALL change its status to "published"
 * and set a non-null publishedAt timestamp. Subsequently unpublishing it
 * SHALL change its status back to "draft".
 */
describe("Publish/unpublish round-trip", () => {
  it("draft → publish → published with publishedAt → unpublish → draft", async () => {
    await fc.assert(
      fc.asyncProperty(
        titleArb,
        slugArb,
        pageDataArb,
        async (title, slug, data) => {
          const { manager, metaStore } = freshManager();

          // Create a draft page
          const createResult = await manager.createPage(title, slug, data);
          expect(createResult.ok).toBe(true);
          if (!createResult.ok) return;

          const id = createResult.value.id;
          expect(createResult.value.status).toBe("draft");
          expect(createResult.value.publishedAt).toBeNull();

          // PUBLISH
          const publishResult = await manager.publishPage(id);
          expect(publishResult.ok).toBe(true);
          if (!publishResult.ok) return;

          expect(publishResult.value.status).toBe("published");
          expect(publishResult.value.publishedAt).not.toBeNull();
          expect(typeof publishResult.value.publishedAt).toBe("string");

          // Verify via store
          const publishedMeta = await metaStore.getById(id);
          expect(publishedMeta!.status).toBe("published");
          expect(publishedMeta!.publishedAt).not.toBeNull();

          // UNPUBLISH
          const unpublishResult = await manager.unpublishPage(id);
          expect(unpublishResult.ok).toBe(true);
          if (!unpublishResult.ok) return;

          expect(unpublishResult.value.status).toBe("draft");

          // Verify via store
          const draftMeta = await metaStore.getById(id);
          expect(draftMeta!.status).toBe("draft");
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ── Property 5: Slug uniqueness invariant ───────────────────────────────────

/**
 * Feature: puck-visual-page-builder, Property 5: Slug uniqueness invariant
 *
 * Validates: Requirements 6.7
 *
 * For any two page creation requests with the same URL slug, the PageManager
 * SHALL accept the first and reject the second with an error (SlugConflictError).
 */
describe("Slug uniqueness invariant", () => {
  it("second create with same slug throws SlugConflictError", async () => {
    await fc.assert(
      fc.asyncProperty(
        titleArb,
        titleArb,
        slugArb,
        pageDataArb,
        pageDataArb,
        async (title1, title2, slug, data1, data2) => {
          const { manager } = freshManager();

          // First creation succeeds
          const first = await manager.createPage(title1, slug, data1);
          expect(first.ok).toBe(true);

          // Second creation with same slug throws SlugConflictError
          await expect(
            manager.createPage(title2, slug, data2),
          ).rejects.toThrow(SlugConflictError);
        },
      ),
      { numRuns: 20 },
    );
  });
});
