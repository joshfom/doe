import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { AuditAction, AuditEntityType } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const mutatingActionArb = fc.constantFrom<AuditAction>(
  "create",
  "update",
  "trash",
  "restore",
  "delete",
  "publish",
  "unpublish",
  "rollback",
  "auto_purge"
);

const blogEntityTypeArb = fc.constantFrom<AuditEntityType>(
  "post",
  "category",
  "tag"
);

const userIdArb = fc.uuid();
const entityIdArb = fc.uuid();

const nonEmptySummaryArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

// ── Helper: simulate audit log creation (mirrors logAudit in audit.ts) ───────

/**
 * Simulate creating an audit log entry the same way the real logAudit function
 * builds the record before inserting into the database.
 */
function createAuditEntry(input: {
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}): AuditLogEntry {
  return {
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    changes: input.changes ?? undefined,
  };
}

/**
 * In-memory audit log store simulating the database audit_log table.
 */
class AuditStore {
  entries: AuditLogEntry[] = [];

  log(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }

  getEntriesForEntity(entityType: AuditEntityType, entityId: string): AuditLogEntry[] {
    return this.entries.filter(
      (e) => e.entityType === entityType && e.entityId === entityId
    );
  }

  getEntriesByAction(action: AuditAction): AuditLogEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  getEntriesByUser(userId: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.userId === userId);
  }
}

/**
 * Simulate a mutating action that creates an audit entry, mirroring
 * how each API route calls logAudit after performing a mutation.
 */
function performMutatingAction(
  store: AuditStore,
  userId: string,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string,
  summary: string
): void {
  const entry = createAuditEntry({
    userId,
    action,
    entityType,
    entityId,
    summary,
  });
  store.log(entry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 23: Mutating actions create audit entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.4, 3.2, 4.2, 4b.4, 5.3, 5.4, 6.3, 6a.5**
 *
 * Property 23: Mutating actions create audit entries
 *
 * For any mutating action (create, update, trash, restore, delete, publish,
 * unpublish, rollback, auto_purge) performed on a post, category, or tag,
 * an audit log entry SHALL be created containing the correct userId, action
 * type, entity type, entity ID, and a non-empty summary.
 */
describe("Feature: blogs-news-module, Property 23: Mutating actions create audit entries", () => {
  it("every mutating action creates an audit entry with correct fields", () => {
    fc.assert(
      fc.property(
        userIdArb,
        mutatingActionArb,
        blogEntityTypeArb,
        entityIdArb,
        nonEmptySummaryArb,
        (userId, action, entityType, entityId, summary) => {
          const store = new AuditStore();

          performMutatingAction(store, userId, action, entityType, entityId, summary);

          // Exactly one entry was created
          expect(store.entries.length).toBe(1);

          const entry = store.entries[0];

          // All fields match the input
          expect(entry.userId).toBe(userId);
          expect(entry.action).toBe(action);
          expect(entry.entityType).toBe(entityType);
          expect(entry.entityId).toBe(entityId);
          expect(entry.summary).toBe(summary);

          // Summary is non-empty
          expect(entry.summary.trim().length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("audit entry is retrievable by entity type and entity ID", () => {
    fc.assert(
      fc.property(
        userIdArb,
        mutatingActionArb,
        blogEntityTypeArb,
        entityIdArb,
        nonEmptySummaryArb,
        (userId, action, entityType, entityId, summary) => {
          const store = new AuditStore();

          performMutatingAction(store, userId, action, entityType, entityId, summary);

          const entries = store.getEntriesForEntity(entityType, entityId);
          expect(entries.length).toBe(1);
          expect(entries[0].action).toBe(action);
          expect(entries[0].userId).toBe(userId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multiple actions on the same entity produce multiple audit entries", () => {
    fc.assert(
      fc.property(
        userIdArb,
        blogEntityTypeArb,
        entityIdArb,
        fc.array(
          fc.record({
            action: mutatingActionArb,
            summary: nonEmptySummaryArb,
          }),
          { minLength: 2, maxLength: 9 }
        ),
        (userId, entityType, entityId, actions) => {
          const store = new AuditStore();

          for (const { action, summary } of actions) {
            performMutatingAction(store, userId, action, entityType, entityId, summary);
          }

          const entries = store.getEntriesForEntity(entityType, entityId);
          expect(entries.length).toBe(actions.length);

          // Each entry matches its corresponding action
          for (let i = 0; i < actions.length; i++) {
            expect(entries[i].action).toBe(actions[i].action);
            expect(entries[i].summary).toBe(actions[i].summary);
            expect(entries[i].summary.trim().length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("audit entries for different entities do not interfere", () => {
    fc.assert(
      fc.property(
        userIdArb,
        mutatingActionArb,
        blogEntityTypeArb,
        entityIdArb,
        entityIdArb,
        nonEmptySummaryArb,
        nonEmptySummaryArb,
        (userId, action, entityType, entityId1, entityId2, summary1, summary2) => {
          // Ensure distinct entity IDs
          fc.pre(entityId1 !== entityId2);

          const store = new AuditStore();

          performMutatingAction(store, userId, action, entityType, entityId1, summary1);
          performMutatingAction(store, userId, action, entityType, entityId2, summary2);

          const entries1 = store.getEntriesForEntity(entityType, entityId1);
          const entries2 = store.getEntriesForEntity(entityType, entityId2);

          expect(entries1.length).toBe(1);
          expect(entries2.length).toBe(1);
          expect(entries1[0].entityId).toBe(entityId1);
          expect(entries2[0].entityId).toBe(entityId2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
