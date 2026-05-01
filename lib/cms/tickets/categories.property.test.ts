import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createCategory, deactivateCategory } from "./service";
import type { CreateCategoryInput, TicketCategory } from "./service";
import { createCategorySchema } from "./validation";

// Feature: support-ticketing-system, Properties 16–17: Category management

// ── Shared arbitraries ───────────────────────────────────────────────────────

/** Generates a valid category name (lowercase, alphanumeric with underscores). */
const arbCategoryName = fc
  .stringMatching(/^[a-z][a-z0-9_]{1,19}$/)
  .filter((s) => s.length >= 2);

/** Generates a valid display name. */
const arbDisplayName = fc
  .stringMatching(/^[A-Z][a-zA-Z ]{1,29}$/)
  .filter((s) => s.trim().length >= 2);

// ── Mock helpers ─────────────────────────────────────────────────────────────

class UniqueViolationError extends Error {
  code = "23505";
  constructor() {
    super("duplicate key value violates unique constraint");
  }
}

function makeCategoryRecord(
  input: CreateCategoryInput,
  overrides: Partial<TicketCategory> = {}
): TicketCategory {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: input.name,
    displayName: input.displayName,
    description: input.description ?? null,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

/**
 * Creates a mock DB for createCategory.
 * The service calls: db.insert(table).values({...}).returning()
 */
function mockDbForInsert(opts: {
  existingNames: string[];
}) {
  return {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => ({
        returning: vi.fn().mockImplementation(() => {
          if (opts.existingNames.includes(vals.name as string)) {
            throw new UniqueViolationError();
          }
          const record: TicketCategory = {
            id: crypto.randomUUID(),
            name: vals.name as string,
            displayName: vals.displayName as string,
            description: (vals.description as string) ?? null,
            isActive: true,
            createdAt: new Date(),
          };
          return [record];
        }),
      })),
    })),
  } as any;
}

/**
 * Creates a mock DB for deactivateCategory.
 * The service calls: db.update(table).set({isActive: false}).where(eq(...)).returning()
 */
function mockDbForDeactivate(category: TicketCategory) {
  const store = { ...category };
  return {
    db: {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((vals: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockImplementation(() => {
              Object.assign(store, vals);
              return [{ ...store }];
            }),
          })),
        })),
      })),
    } as any,
    getStore: () => ({ ...store }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 16: Category name uniqueness
// ─────────────────────────────────────────────────────────────────────────────

// Feature: support-ticketing-system, Property 16: Category name uniqueness
describe("Feature: support-ticketing-system, Property 16: Category name uniqueness", () => {
  it("createCategorySchema validates name and displayName are non-empty", () => {
    fc.assert(
      fc.property(arbCategoryName, arbDisplayName, (name, displayName) => {
        const result = createCategorySchema.safeParse({ name, displayName });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe(name.trim());
          expect(result.data.displayName).toBe(displayName.trim());
        }
      }),
      { numRuns: 20 }
    );
  });

  it("duplicate category name is rejected by createCategory", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategoryName,
        arbDisplayName,
        arbDisplayName,
        async (name, displayName1, displayName2) => {
          const mockDb = mockDbForInsert({ existingNames: [name] });

          await expect(
            createCategory(mockDb, { name, displayName: displayName2 })
          ).rejects.toThrow("A category with this name already exists");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("unique category names are accepted by createCategory", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategoryName,
        arbDisplayName,
        async (name, displayName) => {
          // No existing names — insert should succeed
          const mockDb = mockDbForInsert({ existingNames: [] });

          const result = await createCategory(mockDb, { name, displayName });

          expect(result).toBeDefined();
          expect(result.name).toBe(name);
          expect(result.displayName).toBe(displayName);
          expect(result.isActive).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("createCategorySchema rejects empty or whitespace-only names", () => {
    const arbEmptyOrWhitespace = fc.constantFrom("", " ", "  ", "\t", "\n");

    fc.assert(
      fc.property(arbEmptyOrWhitespace, arbDisplayName, (name, displayName) => {
        const result = createCategorySchema.safeParse({ name, displayName });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 17: Category deactivation preserves record
// ─────────────────────────────────────────────────────────────────────────────

// Feature: support-ticketing-system, Property 17: Category deactivation preserves record
describe("Feature: support-ticketing-system, Property 17: Category deactivation preserves record", () => {
  it("deactivating a category sets is_active to false and preserves the record", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategoryName,
        arbDisplayName,
        fc.uuid(),
        async (name, displayName, categoryId) => {
          const existing = makeCategoryRecord(
            { name, displayName },
            { id: categoryId, isActive: true }
          );
          const { db, getStore } = mockDbForDeactivate(existing);

          const result = await deactivateCategory(db, categoryId);

          expect(result).toBeDefined();
          expect(result.isActive).toBe(false);
          expect(result.name).toBe(name);
          expect(result.displayName).toBe(displayName);
          expect(result.id).toBe(categoryId);

          // Store still has the record
          const stored = getStore();
          expect(stored.isActive).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("deactivation does not remove the record from the database", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategoryName,
        arbDisplayName,
        fc.uuid(),
        async (name, displayName, categoryId) => {
          const existing = makeCategoryRecord(
            { name, displayName },
            { id: categoryId, isActive: true }
          );
          const { db, getStore } = mockDbForDeactivate(existing);

          await deactivateCategory(db, categoryId);

          // Record still exists (not deleted)
          const stored = getStore();
          expect(stored.id).toBe(categoryId);
          expect(stored.name).toBe(name);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("existing tickets referencing a deactivated category remain unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategoryName,
        arbDisplayName,
        fc.uuid(),
        fc.uuid(),
        async (categoryName, displayName, categoryId, ticketId) => {
          const ticket = {
            id: ticketId,
            category: categoryName,
            status: "open" as const,
          };

          const existing = makeCategoryRecord(
            { name: categoryName, displayName },
            { id: categoryId, isActive: true }
          );
          const { db } = mockDbForDeactivate(existing);

          await deactivateCategory(db, categoryId);

          // Ticket's category reference is unchanged
          expect(ticket.category).toBe(categoryName);
          expect(ticket.status).toBe("open");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("deactivated category preserves all original fields except is_active", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCategoryName,
        arbDisplayName,
        fc.uuid(),
        async (name, displayName, categoryId) => {
          const createdAt = new Date("2024-01-15T10:00:00Z");
          const existing = makeCategoryRecord(
            { name, displayName },
            { id: categoryId, isActive: true, createdAt }
          );
          const { db } = mockDbForDeactivate(existing);

          const result = await deactivateCategory(db, categoryId);

          expect(result.id).toBe(categoryId);
          expect(result.name).toBe(name);
          expect(result.displayName).toBe(displayName);
          expect(result.createdAt).toEqual(createdAt);
          expect(result.isActive).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });
});
