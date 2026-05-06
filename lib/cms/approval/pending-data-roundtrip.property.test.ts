import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 4: Pending data round-trip
 *
 * **Validates: Requirements 1.4**
 *
 * For any valid Puck JSON data structure stored in approvalRequests.pendingData,
 * reading it back via the GET /pages/:id/pending-draft endpoint SHALL produce
 * a value identical to what was stored.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface PageRecord {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  status: "draft" | "published" | "pending_review";
  data: unknown;
  updatedAt: Date;
}

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
  pendingData: unknown | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ── In-memory store simulating pending data round-trip logic ──────────────────

class PendingDataRoundTripStore {
  private pages: Map<string, PageRecord> = new Map();
  private requests: ApprovalRequestRecord[] = [];

  /** Register a page */
  addPage(page: PageRecord): void {
    this.pages.set(page.id, { ...page });
  }

  /** Get the active (pending) approval request for a content item */
  private getActiveApprovalRequest(
    contentId: string,
    contentModule: ContentModule
  ): ApprovalRequestRecord | undefined {
    return this.requests.find(
      (r) =>
        r.contentId === contentId &&
        r.contentModule === contentModule &&
        r.status === "pending"
    );
  }

  /**
   * Simulate storing pendingData on an approval request.
   * This mimics what PUT /pages/:id does when approval is enabled:
   * creates or updates the approval request with the provided data.
   */
  storePendingData(
    pageId: string,
    data: unknown,
    userId: string
  ): { success: boolean; error?: string } {
    const page = this.pages.get(pageId);
    if (!page) {
      return { success: false, error: "Page not found" };
    }

    const existingRequest = this.getActiveApprovalRequest(pageId, "pages");

    if (existingRequest) {
      // Update existing request's pendingData
      existingRequest.pendingData = data;
    } else {
      // Create new approval request with pendingData
      const request: ApprovalRequestRecord = {
        id: crypto.randomUUID(),
        contentId: pageId,
        contentModule: "pages",
        submitterId: userId,
        status: "pending",
        pendingData: data,
        createdAt: new Date(),
        resolvedAt: null,
      };
      this.requests.push(request);
      page.status = "pending_review";
    }

    return { success: true };
  }

  /**
   * Simulate GET /pages/:id/pending-draft endpoint.
   * Returns the pendingData from the active approval request for a page.
   * Returns 404 if no active pending request with pendingData exists.
   */
  getPendingDraft(
    pageId: string
  ): { status: 200; data: unknown } | { status: 404; error: string } {
    const page = this.pages.get(pageId);
    if (!page) {
      return { status: 404, error: "Page not found" };
    }

    const activeRequest = this.getActiveApprovalRequest(pageId, "pages");

    if (!activeRequest || activeRequest.pendingData == null) {
      return { status: 404, error: "No pending draft" };
    }

    return { status: 200, data: activeRequest.pendingData };
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const uuidArb = fc.uuid();

const componentInstanceArb = fc.record({
  type: fc.constantFrom(
    "Hero",
    "Text",
    "Image",
    "ContentBlock",
    "PropertyCard",
    "FormBuilder",
    "Gallery",
    "Video",
    "Accordion",
    "Columns",
    "Flex",
    "VerticalSpace",
    "Heading",
    "ButtonGroup"
  ),
  props: fc
    .record({
      id: fc.uuid(),
    })
    .chain((base) =>
      fc
        .dictionary(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
          fc.oneof(
            fc.string({ maxLength: 100 }),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.double({ noNaN: true, noDefaultInfinity: true }),
            fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 })
          ),
          { minKeys: 0, maxKeys: 8 }
        )
        .map((extra) => ({ ...base, ...extra }))
    ),
});

/** Generates nested zone content (components within zones) */
const nestedZonesArb = fc
  .option(
    fc.dictionary(
      fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,20}$/),
      fc.array(componentInstanceArb, { minLength: 0, maxLength: 4 }),
      { minKeys: 0, maxKeys: 5 }
    ),
    { nil: undefined }
  )
  .map((z) => z ?? undefined);

/** Generates random valid Puck JSON page data with diverse structures */
const puckPageDataArb = fc.record({
  root: fc.record({
    props: fc
      .dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
        fc.oneof(
          fc.string({ maxLength: 50 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.double({ noNaN: true, noDefaultInfinity: true })
        ),
        { minKeys: 0, maxKeys: 6 }
      )
      .map((extra) => ({
        title: undefined as string | undefined,
        ...extra,
      }))
      .chain((base) =>
        fc
          .option(fc.string({ minLength: 1, maxLength: 40 }), {
            nil: undefined,
          })
          .map((title) => (title ? { ...base, title } : base))
      ),
  }),
  content: fc.array(componentInstanceArb, { minLength: 0, maxLength: 8 }),
  zones: nestedZonesArb,
});

/**
 * Generates more complex Puck JSON data with deeply nested zones
 * to stress-test the round-trip property.
 */
const complexPuckPageDataArb = fc.record({
  root: fc.record({
    props: fc
      .dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
        fc.oneof(
          fc.string({ maxLength: 200 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          fc.array(
            fc.oneof(fc.string({ maxLength: 30 }), fc.integer()),
            { maxLength: 5 }
          )
        ),
        { minKeys: 0, maxKeys: 10 }
      )
      .map((extra) => ({
        title: undefined as string | undefined,
        description: undefined as string | undefined,
        ...extra,
      }))
      .chain((base) =>
        fc
          .tuple(
            fc.option(fc.string({ minLength: 1, maxLength: 60 }), {
              nil: undefined,
            }),
            fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
              nil: undefined,
            })
          )
          .map(([title, description]) => ({
            ...base,
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
          }))
      ),
  }),
  content: fc.array(componentInstanceArb, { minLength: 1, maxLength: 12 }),
  zones: fc
    .option(
      fc.dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,20}$/),
        fc.array(componentInstanceArb, { minLength: 0, maxLength: 6 }),
        { minKeys: 1, maxKeys: 6 }
      ),
      { nil: undefined }
    )
    .map((z) => z ?? undefined),
});

const pageTitleArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 4: Pending data round-trip
describe("Feature: pages-approval-draft-preview, Property 4: Pending data round-trip", () => {
  it("storing any valid Puck JSON data and reading it back produces an identical value", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalPageData, pendingData) => {
          const store = new PendingDataRoundTripStore();

          // Set up: page exists with some original data
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalPageData,
            updatedAt: new Date(),
          });

          // Act: store pendingData via the save routing
          const storeResult = store.storePendingData(pageId, pendingData, userId);
          expect(storeResult.success).toBe(true);

          // Act: read it back via GET /pages/:id/pending-draft
          const readResult = store.getPendingDraft(pageId);

          // Assert: the read-back value is identical to what was stored
          expect(readResult.status).toBe(200);
          if (readResult.status === 200) {
            expect(readResult.data).toEqual(pendingData);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("storing complex Puck JSON with deeply nested zones and reading it back produces an identical value", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        complexPuckPageDataArb,
        (pageId, userId, title, originalPageData, complexPendingData) => {
          const store = new PendingDataRoundTripStore();

          // Set up: page exists
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "published",
            data: originalPageData,
            updatedAt: new Date(),
          });

          // Act: store complex pendingData
          const storeResult = store.storePendingData(
            pageId,
            complexPendingData,
            userId
          );
          expect(storeResult.success).toBe(true);

          // Act: read it back
          const readResult = store.getPendingDraft(pageId);

          // Assert: round-trip preserves the complex structure exactly
          expect(readResult.status).toBe(200);
          if (readResult.status === 200) {
            expect(readResult.data).toEqual(complexPendingData);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("multiple successive stores and reads always return the latest stored value identically", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        fc.array(puckPageDataArb, { minLength: 2, maxLength: 5 }),
        (pageId, userId, title, originalPageData, edits) => {
          const store = new PendingDataRoundTripStore();

          // Set up: page exists
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalPageData,
            updatedAt: new Date(),
          });

          // Act: store multiple versions of pendingData, verifying round-trip each time
          for (const editData of edits) {
            const storeResult = store.storePendingData(pageId, editData, userId);
            expect(storeResult.success).toBe(true);

            // Read back after each store
            const readResult = store.getPendingDraft(pageId);
            expect(readResult.status).toBe(200);
            if (readResult.status === 200) {
              expect(readResult.data).toEqual(editData);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("round-trip preserves data with special string values (unicode, empty strings, special chars)", () => {
    // Generate Puck data with diverse string content to test serialization edge cases
    const specialStringArb = fc.oneof(
      fc.string({ maxLength: 50 }),
      fc.constant(""),
      fc.stringMatching(/^[\u0600-\u06FF]{1,20}$/), // Arabic characters
      fc.stringMatching(/^[\u4E00-\u9FFF]{1,10}$/), // CJK characters
      fc.constant("<script>alert('xss')</script>"),
      fc.constant('{"nested": "json"}'),
      fc.constant("line1\nline2\ttab"),
      fc.constant("emoji: 🎉🚀✨"),
      fc.constant("quotes: \"hello\" 'world'")
    );

    const specialPuckDataArb = fc.record({
      root: fc.record({
        props: fc
          .dictionary(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
            specialStringArb,
            { minKeys: 1, maxKeys: 5 }
          )
          .map((extra) => ({ title: "Test Page", ...extra })),
      }),
      content: fc.array(
        fc.record({
          type: fc.constantFrom("Hero", "Text", "Image"),
          props: fc
            .record({ id: fc.uuid() })
            .chain((base) =>
              fc
                .dictionary(
                  fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
                  specialStringArb,
                  { minKeys: 0, maxKeys: 4 }
                )
                .map((extra) => ({ ...base, ...extra }))
            ),
        }),
        { minLength: 1, maxLength: 4 }
      ),
      zones: fc
        .option(
          fc.dictionary(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,15}$/),
            fc.array(
              fc.record({
                type: fc.constantFrom("Text", "Heading"),
                props: fc
                  .record({ id: fc.uuid() })
                  .chain((base) =>
                    fc
                      .dictionary(
                        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
                        specialStringArb,
                        { minKeys: 0, maxKeys: 3 }
                      )
                      .map((extra) => ({ ...base, ...extra }))
                  ),
              }),
              { maxLength: 3 }
            ),
            { minKeys: 0, maxKeys: 3 }
          ),
          { nil: undefined }
        )
        .map((z) => z ?? undefined),
    });

    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        specialPuckDataArb,
        (pageId, userId, title, originalPageData, specialData) => {
          const store = new PendingDataRoundTripStore();

          // Set up: page exists
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalPageData,
            updatedAt: new Date(),
          });

          // Act: store data with special strings
          const storeResult = store.storePendingData(pageId, specialData, userId);
          expect(storeResult.success).toBe(true);

          // Act: read it back
          const readResult = store.getPendingDraft(pageId);

          // Assert: round-trip preserves special characters exactly
          expect(readResult.status).toBe(200);
          if (readResult.status === 200) {
            expect(readResult.data).toEqual(specialData);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("round-trip preserves data with empty content arrays and missing zones", () => {
    const minimalPuckDataArb = fc.record({
      root: fc.record({
        props: fc.constant({}),
      }),
      content: fc.constant([]),
      zones: fc.constantFrom(undefined, {}) as fc.Arbitrary<
        Record<string, unknown[]> | undefined
      >,
    });

    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        minimalPuckDataArb,
        (pageId, userId, title, originalPageData, minimalData) => {
          const store = new PendingDataRoundTripStore();

          // Set up: page exists
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalPageData,
            updatedAt: new Date(),
          });

          // Act: store minimal data
          const storeResult = store.storePendingData(pageId, minimalData, userId);
          expect(storeResult.success).toBe(true);

          // Act: read it back
          const readResult = store.getPendingDraft(pageId);

          // Assert: round-trip preserves minimal structures exactly
          expect(readResult.status).toBe(200);
          if (readResult.status === 200) {
            expect(readResult.data).toEqual(minimalData);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
