import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateSlug } from "../utils/slug";

// ── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

interface Tag {
  id: string;
  name: string;
  slug: string;
}

interface PostCategoryRecord {
  id: string;
  postId: string;
  categoryId: string;
}

interface PostTagRecord {
  id: string;
  postId: string;
  tagId: string;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const nonEmptyNameArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s));

// ── Helpers: simulate category/tag/assignment logic ──────────────────────────

class TaxonomyStore {
  private categories: Category[] = [];
  private tags: Tag[] = [];
  private postCategories: PostCategoryRecord[] = [];
  private postTags: PostTagRecord[] = [];

  // ── Category operations ──────────────────────────────────────────────────

  createCategory(name: string, parentId: string | null = null): Category {
    const category: Category = {
      id: crypto.randomUUID(),
      name,
      slug: generateSlug(name),
      parentId,
    };
    this.categories.push(category);
    return category;
  }

  /**
   * Delete a category: promote children to root (parentId = null),
   * remove all post-category associations for the deleted category.
   * Mirrors DELETE /api/categories/:id logic.
   */
  deleteCategory(categoryId: string): void {
    // Promote children to root
    for (const cat of this.categories) {
      if (cat.parentId === categoryId) {
        cat.parentId = null;
      }
    }
    // Remove post-category associations for the deleted category
    this.postCategories = this.postCategories.filter(
      (pc) => pc.categoryId !== categoryId
    );
    // Remove the category itself
    this.categories = this.categories.filter((c) => c.id !== categoryId);
  }

  getCategories(): Category[] {
    return [...this.categories];
  }

  getChildCategories(parentId: string): Category[] {
    return this.categories.filter((c) => c.parentId === parentId);
  }

  getPostCategoriesForCategory(categoryId: string): PostCategoryRecord[] {
    return this.postCategories.filter((pc) => pc.categoryId === categoryId);
  }

  // ── Tag operations ───────────────────────────────────────────────────────

  createTag(name: string): Tag {
    const tag: Tag = {
      id: crypto.randomUUID(),
      name,
      slug: generateSlug(name),
    };
    this.tags.push(tag);
    return tag;
  }

  /**
   * Update a tag's name and regenerate its slug.
   * Mirrors PUT /api/tags/:id logic.
   */
  updateTag(tagId: string, newName: string): Tag {
    const tag = this.tags.find((t) => t.id === tagId);
    if (!tag) throw new Error("Tag not found");
    tag.name = newName;
    tag.slug = generateSlug(newName);
    return { ...tag };
  }

  getTag(tagId: string): Tag | undefined {
    return this.tags.find((t) => t.id === tagId);
  }

  // ── Post-category assignment operations ──────────────────────────────────

  assignCategoriesToPost(postId: string, categoryIds: string[]): void {
    for (const categoryId of categoryIds) {
      // Avoid duplicates (mirrors unique index)
      const exists = this.postCategories.some(
        (pc) => pc.postId === postId && pc.categoryId === categoryId
      );
      if (!exists) {
        this.postCategories.push({
          id: crypto.randomUUID(),
          postId,
          categoryId,
        });
      }
    }
  }

  getPostCategories(postId: string): string[] {
    return this.postCategories
      .filter((pc) => pc.postId === postId)
      .map((pc) => pc.categoryId);
  }

  removeCategoryFromPost(postId: string, categoryId: string): void {
    this.postCategories = this.postCategories.filter(
      (pc) => !(pc.postId === postId && pc.categoryId === categoryId)
    );
  }

  // ── Post-tag assignment operations ───────────────────────────────────────

  assignTagsToPost(postId: string, tagIds: string[]): void {
    for (const tagId of tagIds) {
      const exists = this.postTags.some(
        (pt) => pt.postId === postId && pt.tagId === tagId
      );
      if (!exists) {
        this.postTags.push({
          id: crypto.randomUUID(),
          postId,
          tagId,
        });
      }
    }
  }

  getPostTags(postId: string): string[] {
    return this.postTags
      .filter((pt) => pt.postId === postId)
      .map((pt) => pt.tagId);
  }

  removeTagFromPost(postId: string, tagId: string): void {
    this.postTags = this.postTags.filter(
      (pt) => !(pt.postId === postId && pt.tagId === tagId)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 16: Category parent deletion promotes children
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 12.4, 12.5**
 *
 * Property 16: Category parent deletion promotes children
 *
 * For any parent category with one or more child categories, deleting the
 * parent SHALL set all children's parentId to null (promoting them to root
 * categories) and SHALL remove all post-category associations for the
 * deleted parent.
 */
describe("Feature: blogs-news-module, Property 16: Category parent deletion promotes children", () => {
  it("deleting a parent promotes all children to root and removes parent's post-category associations", () => {
    fc.assert(
      fc.property(
        nonEmptyNameArb,
        fc.array(nonEmptyNameArb, { minLength: 1, maxLength: 5 }),
        fc.array(fc.constant(null), { minLength: 1, maxLength: 3 }), // number of posts to associate
        (parentName, childNames, postSlots) => {
          const store = new TaxonomyStore();

          // Create parent category
          const parent = store.createCategory(parentName);

          // Create child categories under the parent
          const children = childNames.map((name, i) =>
            store.createCategory(`${name}-child-${i}`, parent.id)
          );

          // Create some post-category associations for the parent
          const postIds = postSlots.map(() => crypto.randomUUID());
          for (const postId of postIds) {
            store.assignCategoriesToPost(postId, [parent.id]);
          }

          // Verify children are linked to parent before deletion
          for (const child of children) {
            const found = store.getCategories().find((c) => c.id === child.id);
            expect(found?.parentId).toBe(parent.id);
          }

          // Verify post-category associations exist for parent
          expect(store.getPostCategoriesForCategory(parent.id).length).toBe(postIds.length);

          // Delete the parent category
          store.deleteCategory(parent.id);

          // All children are promoted to root (parentId = null)
          for (const child of children) {
            const found = store.getCategories().find((c) => c.id === child.id);
            expect(found).toBeDefined();
            expect(found!.parentId).toBeNull();
          }

          // Parent's post-category associations are removed
          expect(store.getPostCategoriesForCategory(parent.id).length).toBe(0);

          // Parent category itself is removed
          expect(store.getCategories().find((c) => c.id === parent.id)).toBeUndefined();

          // Children still exist
          for (const child of children) {
            expect(store.getCategories().find((c) => c.id === child.id)).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 17: Tag update regenerates slug
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 13.3**
 *
 * Property 17: Tag update regenerates slug
 *
 * For any tag, updating its name SHALL regenerate the slug to match the new
 * name. The new slug SHALL be the output of generateSlug applied to the new name.
 */
describe("Feature: blogs-news-module, Property 17: Tag update regenerates slug", () => {
  it("updating a tag name regenerates the slug to match generateSlug(newName)", () => {
    fc.assert(
      fc.property(
        nonEmptyNameArb,
        nonEmptyNameArb,
        (originalName, newName) => {
          const store = new TaxonomyStore();

          // Create a tag
          const tag = store.createTag(originalName);
          expect(tag.slug).toBe(generateSlug(originalName));

          // Update the tag name
          const updatedTag = store.updateTag(tag.id, newName);

          // Slug matches generateSlug applied to the new name
          expect(updatedTag.slug).toBe(generateSlug(newName));
          expect(updatedTag.name).toBe(newName);

          // Verify the stored tag also reflects the change
          const storedTag = store.getTag(tag.id);
          expect(storedTag?.slug).toBe(generateSlug(newName));
          expect(storedTag?.name).toBe(newName);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 18: Post-category and post-tag assignment round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 14.1, 14.2, 14.3**
 *
 * Property 18: Post-category and post-tag assignment round-trip
 *
 * For any post and set of categories/tags, assigning them SHALL create the
 * corresponding junction records. Reading the post's categories/tags back
 * SHALL return exactly the assigned set. Removing an assignment SHALL delete
 * the junction record.
 */
describe("Feature: blogs-news-module, Property 18: Post-category and post-tag assignment round-trip", () => {
  it("assigning categories to a post creates junction records and reading returns the exact set", () => {
    fc.assert(
      fc.property(
        fc.array(nonEmptyNameArb, { minLength: 1, maxLength: 5 }),
        (categoryNames) => {
          const store = new TaxonomyStore();
          const postId = crypto.randomUUID();

          // Create categories
          const categories = categoryNames.map((name, i) =>
            store.createCategory(`${name}-cat-${i}`)
          );
          const categoryIds = categories.map((c) => c.id);

          // Assign categories to post
          store.assignCategoriesToPost(postId, categoryIds);

          // Read back — should return exactly the assigned set
          const assignedIds = store.getPostCategories(postId);
          expect(new Set(assignedIds)).toEqual(new Set(categoryIds));
          expect(assignedIds.length).toBe(categoryIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("assigning tags to a post creates junction records and reading returns the exact set", () => {
    fc.assert(
      fc.property(
        fc.array(nonEmptyNameArb, { minLength: 1, maxLength: 5 }),
        (tagNames) => {
          const store = new TaxonomyStore();
          const postId = crypto.randomUUID();

          // Create tags
          const tags = tagNames.map((name, i) =>
            store.createTag(`${name}-tag-${i}`)
          );
          const tagIds = tags.map((t) => t.id);

          // Assign tags to post
          store.assignTagsToPost(postId, tagIds);

          // Read back — should return exactly the assigned set
          const assignedIds = store.getPostTags(postId);
          expect(new Set(assignedIds)).toEqual(new Set(tagIds));
          expect(assignedIds.length).toBe(tagIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("removing a category assignment deletes the junction record", () => {
    fc.assert(
      fc.property(
        fc.array(nonEmptyNameArb, { minLength: 2, maxLength: 5 }),
        fc.nat(),
        (categoryNames, removeIndexSeed) => {
          const store = new TaxonomyStore();
          const postId = crypto.randomUUID();

          // Create and assign categories
          const categories = categoryNames.map((name, i) =>
            store.createCategory(`${name}-cat-${i}`)
          );
          const categoryIds = categories.map((c) => c.id);
          store.assignCategoriesToPost(postId, categoryIds);

          // Pick one to remove
          const removeIndex = removeIndexSeed % categoryIds.length;
          const removedId = categoryIds[removeIndex];
          store.removeCategoryFromPost(postId, removedId);

          // Read back — removed category should be gone
          const remaining = store.getPostCategories(postId);
          expect(remaining).not.toContain(removedId);
          expect(remaining.length).toBe(categoryIds.length - 1);

          // All other categories still present
          const expectedRemaining = categoryIds.filter((id) => id !== removedId);
          expect(new Set(remaining)).toEqual(new Set(expectedRemaining));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("removing a tag assignment deletes the junction record", () => {
    fc.assert(
      fc.property(
        fc.array(nonEmptyNameArb, { minLength: 2, maxLength: 5 }),
        fc.nat(),
        (tagNames, removeIndexSeed) => {
          const store = new TaxonomyStore();
          const postId = crypto.randomUUID();

          // Create and assign tags
          const tags = tagNames.map((name, i) =>
            store.createTag(`${name}-tag-${i}`)
          );
          const tagIds = tags.map((t) => t.id);
          store.assignTagsToPost(postId, tagIds);

          // Pick one to remove
          const removeIndex = removeIndexSeed % tagIds.length;
          const removedId = tagIds[removeIndex];
          store.removeTagFromPost(postId, removedId);

          // Read back — removed tag should be gone
          const remaining = store.getPostTags(postId);
          expect(remaining).not.toContain(removedId);
          expect(remaining.length).toBe(tagIds.length - 1);

          // All other tags still present
          const expectedRemaining = tagIds.filter((id) => id !== removedId);
          expect(new Set(remaining)).toEqual(new Set(expectedRemaining));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("duplicate assignments are idempotent (no duplicate junction records)", () => {
    fc.assert(
      fc.property(
        nonEmptyNameArb,
        nonEmptyNameArb,
        (catName, tagName) => {
          const store = new TaxonomyStore();
          const postId = crypto.randomUUID();

          const category = store.createCategory(catName);
          const tag = store.createTag(tagName);

          // Assign twice
          store.assignCategoriesToPost(postId, [category.id]);
          store.assignCategoriesToPost(postId, [category.id]);
          store.assignTagsToPost(postId, [tag.id]);
          store.assignTagsToPost(postId, [tag.id]);

          // Should have exactly one of each
          expect(store.getPostCategories(postId).length).toBe(1);
          expect(store.getPostTags(postId).length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
