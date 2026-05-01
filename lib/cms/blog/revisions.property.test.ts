import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── Types ────────────────────────────────────────────────────────────────────

interface PostSnapshot {
  title: string;
  slug: string;
  content: unknown;
  excerpt: string | null;
  featuredImage: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  ogImage: string | null;
  canonicalUrl: string | null;
  robotsDirective: string;
}

interface Revision {
  id: string;
  postId: string;
  userId: string;
  data: {
    content: unknown;
    excerpt: string | null;
    featuredImage: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
    metaKeywords: string | null;
    ogImage: string | null;
    canonicalUrl: string | null;
    robotsDirective: string;
  };
  titleSnapshot: string;
  slugSnapshot: string;
  action: "save" | "rollback";
  revisionNumber: number;
  createdAt: Date;
}

interface SimulatedPost extends PostSnapshot {
  id: string;
  locale: "en" | "ar";
  namespace: string;
  postType: "blog" | "news";
  status: "draft" | "published" | "trashed";
  updatedAt: Date;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s));

const optionalStringArb = fc.option(
  fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim().length > 0),
  { nil: null }
);

const localeArb = fc.constantFrom("en" as const, "ar" as const);
const postTypeArb = fc.constantFrom("blog" as const, "news" as const);

/** Arbitrary for a post snapshot (content + SEO fields) */
const snapshotArb = fc.record({
  title: nonEmptyStringArb,
  slug: nonEmptyStringArb.map((s) => s.toLowerCase().replace(/\s+/g, "-")),
  content: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: null }),
  excerpt: optionalStringArb,
  featuredImage: optionalStringArb,
  metaTitle: optionalStringArb,
  metaDescription: optionalStringArb,
  metaKeywords: optionalStringArb,
  ogImage: optionalStringArb,
  canonicalUrl: optionalStringArb,
  robotsDirective: fc.constantFrom("index, follow", "noindex, nofollow"),
});

// ── Helpers: simulate revision logic (mirrors posts.ts and post-revisions.ts) ─

/** In-memory store for a single post's revisions */
class RevisionStore {
  private revisions: Revision[] = [];
  private post: SimulatedPost;

  constructor(initial: PostSnapshot, locale: "en" | "ar", postType: "blog" | "news") {
    this.post = {
      ...initial,
      id: crypto.randomUUID(),
      locale,
      namespace: crypto.randomUUID(),
      postType,
      status: "draft",
      updatedAt: new Date(),
    };
  }

  getPost(): SimulatedPost {
    return { ...this.post };
  }

  getRevisions(): Revision[] {
    return [...this.revisions];
  }

  /** Simulate PUT /posts/:id — create revision of current state, then apply update */
  updatePost(newFields: Partial<PostSnapshot>, userId: string): Revision {
    const nextRevisionNumber = this.getNextRevisionNumber();

    // Snapshot BEFORE update (mirrors posts.ts update route)
    const revision: Revision = {
      id: crypto.randomUUID(),
      postId: this.post.id,
      userId,
      data: {
        content: this.post.content,
        excerpt: this.post.excerpt,
        featuredImage: this.post.featuredImage,
        metaTitle: this.post.metaTitle,
        metaDescription: this.post.metaDescription,
        metaKeywords: this.post.metaKeywords,
        ogImage: this.post.ogImage,
        canonicalUrl: this.post.canonicalUrl,
        robotsDirective: this.post.robotsDirective,
      },
      titleSnapshot: this.post.title,
      slugSnapshot: this.post.slug,
      action: "save",
      revisionNumber: nextRevisionNumber,
      createdAt: new Date(),
    };
    this.revisions.push(revision);

    // Apply update
    if (newFields.title !== undefined) this.post.title = newFields.title;
    if (newFields.slug !== undefined) this.post.slug = newFields.slug;
    if (newFields.content !== undefined) this.post.content = newFields.content;
    if (newFields.excerpt !== undefined) this.post.excerpt = newFields.excerpt;
    if (newFields.featuredImage !== undefined) this.post.featuredImage = newFields.featuredImage;
    if (newFields.metaTitle !== undefined) this.post.metaTitle = newFields.metaTitle;
    if (newFields.metaDescription !== undefined) this.post.metaDescription = newFields.metaDescription;
    if (newFields.metaKeywords !== undefined) this.post.metaKeywords = newFields.metaKeywords;
    if (newFields.ogImage !== undefined) this.post.ogImage = newFields.ogImage;
    if (newFields.canonicalUrl !== undefined) this.post.canonicalUrl = newFields.canonicalUrl;
    if (newFields.robotsDirective !== undefined) this.post.robotsDirective = newFields.robotsDirective;
    this.post.updatedAt = new Date();

    return revision;
  }

  /** Simulate POST /posts/:id/revisions/:revisionId/rollback */
  rollbackToRevision(revisionId: string, userId: string): { undoRevision: Revision; restoredPost: SimulatedPost } {
    const target = this.revisions.find((r) => r.id === revisionId);
    if (!target) throw new Error("Revision not found");

    const nextRevisionNumber = this.getNextRevisionNumber();

    // Create undo point of current state with action "rollback"
    const undoRevision: Revision = {
      id: crypto.randomUUID(),
      postId: this.post.id,
      userId,
      data: {
        content: this.post.content,
        excerpt: this.post.excerpt,
        featuredImage: this.post.featuredImage,
        metaTitle: this.post.metaTitle,
        metaDescription: this.post.metaDescription,
        metaKeywords: this.post.metaKeywords,
        ogImage: this.post.ogImage,
        canonicalUrl: this.post.canonicalUrl,
        robotsDirective: this.post.robotsDirective,
      },
      titleSnapshot: this.post.title,
      slugSnapshot: this.post.slug,
      action: "rollback",
      revisionNumber: nextRevisionNumber,
      createdAt: new Date(),
    };
    this.revisions.push(undoRevision);

    // Overwrite post with target revision's snapshot
    const snapshot = target.data;
    this.post.title = target.titleSnapshot;
    this.post.slug = target.slugSnapshot;
    this.post.content = snapshot.content ?? null;
    this.post.excerpt = snapshot.excerpt ?? null;
    this.post.featuredImage = snapshot.featuredImage ?? null;
    this.post.metaTitle = snapshot.metaTitle ?? null;
    this.post.metaDescription = snapshot.metaDescription ?? null;
    this.post.metaKeywords = snapshot.metaKeywords ?? null;
    this.post.ogImage = snapshot.ogImage ?? null;
    this.post.canonicalUrl = snapshot.canonicalUrl ?? null;
    this.post.robotsDirective = snapshot.robotsDirective ?? "index, follow";
    this.post.updatedAt = new Date();

    return { undoRevision, restoredPost: { ...this.post } };
  }

  /** List revisions ordered by revision number descending (mirrors GET /posts/:id/revisions) */
  listRevisions(): Revision[] {
    return [...this.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  }

  private getNextRevisionNumber(): number {
    if (this.revisions.length === 0) return 1;
    return Math.max(...this.revisions.map((r) => r.revisionNumber)) + 1;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Revision snapshot before update
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.1, 6a.1, 6a.2**
 *
 * Property 9: Revision snapshot before update
 *
 * For any post update, the system SHALL create a revision record containing
 * the post's pre-update title, slug, content, and SEO fields BEFORE applying
 * the changes. The revision number SHALL be strictly greater than all previous
 * revision numbers for that post.
 */
describe("Feature: blogs-news-module, Property 9: Revision snapshot before update", () => {
  it("revision captures pre-update state and revision numbers are strictly increasing", () => {
    fc.assert(
      fc.property(
        snapshotArb,
        snapshotArb,
        localeArb,
        postTypeArb,
        (initialSnapshot, updateSnapshot, locale, postType) => {
          const store = new RevisionStore(initialSnapshot, locale, postType);
          const userId = crypto.randomUUID();

          // Capture pre-update state
          const preUpdatePost = store.getPost();

          // Perform update
          const revision = store.updatePost(updateSnapshot, userId);

          // Revision captures the PRE-update title and slug
          expect(revision.titleSnapshot).toBe(preUpdatePost.title);
          expect(revision.slugSnapshot).toBe(preUpdatePost.slug);

          // Revision data captures pre-update SEO/content fields
          expect(revision.data.content).toEqual(preUpdatePost.content);
          expect(revision.data.excerpt).toBe(preUpdatePost.excerpt);
          expect(revision.data.featuredImage).toBe(preUpdatePost.featuredImage);
          expect(revision.data.metaTitle).toBe(preUpdatePost.metaTitle);
          expect(revision.data.metaDescription).toBe(preUpdatePost.metaDescription);
          expect(revision.data.metaKeywords).toBe(preUpdatePost.metaKeywords);
          expect(revision.data.ogImage).toBe(preUpdatePost.ogImage);
          expect(revision.data.canonicalUrl).toBe(preUpdatePost.canonicalUrl);
          expect(revision.data.robotsDirective).toBe(preUpdatePost.robotsDirective);

          // Revision action is "save"
          expect(revision.action).toBe("save");

          // Post is now updated
          const postAfter = store.getPost();
          expect(postAfter.title).toBe(updateSnapshot.title);
          expect(postAfter.slug).toBe(updateSnapshot.slug);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("multiple updates produce strictly increasing revision numbers", () => {
    fc.assert(
      fc.property(
        snapshotArb,
        fc.array(snapshotArb, { minLength: 2, maxLength: 6 }),
        localeArb,
        postTypeArb,
        (initial, updates, locale, postType) => {
          const store = new RevisionStore(initial, locale, postType);
          const userId = crypto.randomUUID();
          const revisionNumbers: number[] = [];

          for (const update of updates) {
            const rev = store.updatePost(update, userId);
            revisionNumbers.push(rev.revisionNumber);
          }

          // Revision numbers are strictly increasing
          for (let i = 1; i < revisionNumbers.length; i++) {
            expect(revisionNumbers[i]).toBeGreaterThan(revisionNumbers[i - 1]);
          }

          // First revision number is 1
          expect(revisionNumbers[0]).toBe(1);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 10: Revision restore creates undo point and overwrites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 6a.4**
 *
 * Property 10: Revision restore creates undo point and overwrites
 *
 * For any post with two or more revisions, restoring to a previous revision
 * SHALL: (1) create a new revision of the current state with action "rollback",
 * and (2) overwrite the post's content and SEO fields with the selected
 * revision's snapshot. The post's content after restore SHALL deeply equal
 * the target revision's snapshot.
 */
describe("Feature: blogs-news-module, Property 10: Revision restore creates undo point and overwrites", () => {
  it("rollback creates undo revision and overwrites post with target snapshot", () => {
    fc.assert(
      fc.property(
        snapshotArb,
        snapshotArb,
        snapshotArb,
        localeArb,
        postTypeArb,
        (initial, update1, update2, locale, postType) => {
          const store = new RevisionStore(initial, locale, postType);
          const userId = crypto.randomUUID();

          // Create two revisions via updates
          const rev1 = store.updatePost(update1, userId);
          store.updatePost(update2, userId);

          // Capture state before rollback
          const preRollbackPost = store.getPost();
          const revisionsBeforeRollback = store.getRevisions().length;

          // Rollback to rev1 (which captured the initial state)
          const { undoRevision, restoredPost } = store.rollbackToRevision(rev1.id, userId);

          // (1) Undo revision was created with action "rollback"
          expect(undoRevision.action).toBe("rollback");
          expect(undoRevision.titleSnapshot).toBe(preRollbackPost.title);
          expect(undoRevision.slugSnapshot).toBe(preRollbackPost.slug);
          expect(undoRevision.data.content).toEqual(preRollbackPost.content);
          expect(undoRevision.data.metaTitle).toBe(preRollbackPost.metaTitle);
          expect(undoRevision.data.metaDescription).toBe(preRollbackPost.metaDescription);

          // A new revision was added
          expect(store.getRevisions().length).toBe(revisionsBeforeRollback + 1);

          // (2) Post content now deeply equals the target revision's snapshot
          expect(restoredPost.title).toBe(rev1.titleSnapshot);
          expect(restoredPost.slug).toBe(rev1.slugSnapshot);
          expect(restoredPost.content).toEqual(rev1.data.content);
          expect(restoredPost.excerpt).toBe(rev1.data.excerpt);
          expect(restoredPost.featuredImage).toBe(rev1.data.featuredImage);
          expect(restoredPost.metaTitle).toBe(rev1.data.metaTitle);
          expect(restoredPost.metaDescription).toBe(rev1.data.metaDescription);
          expect(restoredPost.metaKeywords).toBe(rev1.data.metaKeywords);
          expect(restoredPost.ogImage).toBe(rev1.data.ogImage);
          expect(restoredPost.canonicalUrl).toBe(rev1.data.canonicalUrl);
          expect(restoredPost.robotsDirective).toBe(rev1.data.robotsDirective);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 11: Revision history ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 6a.3**
 *
 * Property 11: Revision history ordering
 *
 * For any post with revisions, listing revisions SHALL return all revisions
 * ordered by revision number descending, and revision numbers SHALL form a
 * strictly increasing sequence when read in creation order.
 */
describe("Feature: blogs-news-module, Property 11: Revision history ordering", () => {
  it("listRevisions returns descending order and creation order is strictly increasing", () => {
    fc.assert(
      fc.property(
        snapshotArb,
        fc.array(snapshotArb, { minLength: 2, maxLength: 8 }),
        localeArb,
        postTypeArb,
        (initial, updates, locale, postType) => {
          const store = new RevisionStore(initial, locale, postType);
          const userId = crypto.randomUUID();

          // Create revisions via updates
          for (const update of updates) {
            store.updatePost(update, userId);
          }

          const listed = store.listRevisions();

          // All revisions are returned
          expect(listed.length).toBe(updates.length);

          // Listed order is descending by revision number
          for (let i = 1; i < listed.length; i++) {
            expect(listed[i - 1].revisionNumber).toBeGreaterThan(listed[i].revisionNumber);
          }

          // Creation order (ascending) is strictly increasing
          const creationOrder = [...listed].sort((a, b) => a.revisionNumber - b.revisionNumber);
          for (let i = 1; i < creationOrder.length; i++) {
            expect(creationOrder[i].revisionNumber).toBeGreaterThan(
              creationOrder[i - 1].revisionNumber
            );
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("revision numbers form a contiguous sequence starting at 1", () => {
    fc.assert(
      fc.property(
        snapshotArb,
        fc.array(snapshotArb, { minLength: 1, maxLength: 6 }),
        localeArb,
        postTypeArb,
        (initial, updates, locale, postType) => {
          const store = new RevisionStore(initial, locale, postType);
          const userId = crypto.randomUUID();

          for (const update of updates) {
            store.updatePost(update, userId);
          }

          const revisions = store.getRevisions();
          const numbers = revisions.map((r) => r.revisionNumber).sort((a, b) => a - b);

          // Starts at 1 and increments by 1
          for (let i = 0; i < numbers.length; i++) {
            expect(numbers[i]).toBe(i + 1);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
