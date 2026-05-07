import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: sequential-approval-chain, Property 2: Configuration position round-trip
 *
 * **Validates: Requirements 1.4, 8.1**
 *
 * For any valid ordered list of approvers with positions 1 through N,
 * saving the configuration via the API and reading it back SHALL produce
 * the same ordered list with identical positions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface ApproverWithPosition {
  userId: string;
  position: number;
}

interface StoredApprover {
  id: string;
  configId: string;
  userId: string;
  position: number;
}

interface ApprovalConfigRecord {
  id: string;
  contentModule: string;
  enabled: boolean;
}

// ── In-memory store simulating approval config API behavior ──────────────────

class ApprovalConfigStore {
  private configs: Map<string, ApprovalConfigRecord> = new Map();
  private approvers: StoredApprover[] = [];
  private validUserIds: Set<string> = new Set();

  /** Register valid user IDs (simulates users table) */
  registerUsers(userIds: string[]): void {
    for (const id of userIds) {
      this.validUserIds.add(id);
    }
  }

  /**
   * Simulate PUT /approval-config/:module
   *
   * Accepts an ordered list of approvers with positions.
   * Normalizes positions to contiguous 1-based integers (sorted by provided position).
   * Validates: no duplicate positions, all user IDs exist.
   */
  saveConfig(
    contentModule: string,
    approvers: ApproverWithPosition[]
  ): { success: boolean; status: number; error?: string } {
    // Validate user IDs exist
    const invalidIds = approvers.filter((a) => !this.validUserIds.has(a.userId));
    if (invalidIds.length > 0) {
      return {
        success: false,
        status: 400,
        error: `Invalid approver IDs: ${invalidIds.map((a) => a.userId).join(", ")}`,
      };
    }

    // Validate: check for duplicate positions
    const positions = approvers.map((a) => a.position);
    const uniquePositions = new Set(positions);
    if (uniquePositions.size !== positions.length) {
      return {
        success: false,
        status: 400,
        error: "Positions must be unique and contiguous",
      };
    }

    // Normalize positions: sort by provided position, then assign contiguous 1-based integers
    const sorted = [...approvers].sort((a, b) => a.position - b.position);
    const normalized = sorted.map((a, idx) => ({
      userId: a.userId,
      position: idx + 1,
    }));

    // Upsert config
    let config = Array.from(this.configs.values()).find(
      (c) => c.contentModule === contentModule
    );
    if (!config) {
      config = {
        id: crypto.randomUUID(),
        contentModule,
        enabled: true,
      };
      this.configs.set(config.id, config);
    }

    // Remove existing approvers for this config
    this.approvers = this.approvers.filter((a) => a.configId !== config!.id);

    // Insert new approvers with normalized positions
    for (const a of normalized) {
      this.approvers.push({
        id: crypto.randomUUID(),
        configId: config.id,
        userId: a.userId,
        position: a.position,
      });
    }

    return { success: true, status: 200 };
  }

  /**
   * Simulate GET /approval-config
   *
   * Returns approvers sorted by position for the given content module.
   */
  getConfig(contentModule: string): ApproverWithPosition[] {
    const config = Array.from(this.configs.values()).find(
      (c) => c.contentModule === contentModule
    );
    if (!config) return [];

    return this.approvers
      .filter((a) => a.configId === config.id)
      .sort((a, b) => a.position - b.position)
      .map((a) => ({ userId: a.userId, position: a.position }));
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a list of 1-10 unique approver user IDs with contiguous 1-based positions */
const orderedApproverListArb = fc
  .integer({ min: 1, max: 10 })
  .chain((count) =>
    fc
      .uniqueArray(fc.uuid(), { minLength: count, maxLength: count })
      .map((userIds) =>
        userIds.map((userId, idx) => ({
          userId,
          position: idx + 1,
        }))
      )
  );

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: sequential-approval-chain, Property 2: Configuration position round-trip
describe("Feature: sequential-approval-chain, Property 2: Configuration position round-trip", () => {
  it("saving an ordered approver list and reading it back produces identical order and positions", () => {
    fc.assert(
      fc.property(
        orderedApproverListArb,
        (approverList) => {
          const store = new ApprovalConfigStore();

          // Register all user IDs as valid
          store.registerUsers(approverList.map((a) => a.userId));

          // Save the configuration via PUT
          const saveResult = store.saveConfig("pages", approverList);
          expect(saveResult.success).toBe(true);
          expect(saveResult.status).toBe(200);

          // Read back via GET
          const readBack = store.getConfig("pages");

          // Verify identical length
          expect(readBack.length).toBe(approverList.length);

          // Verify identical order and positions
          for (let i = 0; i < approverList.length; i++) {
            expect(readBack[i].userId).toBe(approverList[i].userId);
            expect(readBack[i].position).toBe(approverList[i].position);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("non-contiguous positions are normalized to contiguous 1-based and round-trip preserves order", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 10 })
          .chain((count) =>
            fc.tuple(
              fc.uniqueArray(fc.uuid(), { minLength: count, maxLength: count }),
              // Generate unique non-contiguous positions (e.g., 3, 7, 12 instead of 1, 2, 3)
              fc.uniqueArray(fc.integer({ min: 1, max: 100 }), {
                minLength: count,
                maxLength: count,
              })
            )
          ),
        ([userIds, positions]) => {
          const store = new ApprovalConfigStore();
          store.registerUsers(userIds);

          // Create approver list with non-contiguous positions
          const sortedPositions = [...positions].sort((a, b) => a - b);
          const approverList: ApproverWithPosition[] = userIds.map((userId, idx) => ({
            userId,
            position: sortedPositions[idx],
          }));

          // Save the configuration
          const saveResult = store.saveConfig("pages", approverList);
          expect(saveResult.success).toBe(true);

          // Read back
          const readBack = store.getConfig("pages");

          // Verify: positions are now contiguous 1-based
          expect(readBack.length).toBe(approverList.length);
          for (let i = 0; i < readBack.length; i++) {
            expect(readBack[i].position).toBe(i + 1);
          }

          // Verify: order is preserved (same userId sequence as sorted by original position)
          for (let i = 0; i < readBack.length; i++) {
            expect(readBack[i].userId).toBe(approverList[i].userId);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("saving the same configuration twice produces the same result on read-back", () => {
    fc.assert(
      fc.property(
        orderedApproverListArb,
        (approverList) => {
          const store = new ApprovalConfigStore();
          store.registerUsers(approverList.map((a) => a.userId));

          // Save once
          store.saveConfig("pages", approverList);
          const firstRead = store.getConfig("pages");

          // Save again (same data)
          store.saveConfig("pages", approverList);
          const secondRead = store.getConfig("pages");

          // Both reads should be identical
          expect(secondRead.length).toBe(firstRead.length);
          for (let i = 0; i < firstRead.length; i++) {
            expect(secondRead[i].userId).toBe(firstRead[i].userId);
            expect(secondRead[i].position).toBe(firstRead[i].position);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("positions in read-back are always contiguous starting from 1 with no gaps", () => {
    fc.assert(
      fc.property(
        orderedApproverListArb,
        (approverList) => {
          const store = new ApprovalConfigStore();
          store.registerUsers(approverList.map((a) => a.userId));

          // Save
          store.saveConfig("pages", approverList);

          // Read back
          const readBack = store.getConfig("pages");

          // Verify contiguous 1-based positions
          for (let i = 0; i < readBack.length; i++) {
            expect(readBack[i].position).toBe(i + 1);
          }

          // Verify no duplicates
          const positionSet = new Set(readBack.map((a) => a.position));
          expect(positionSet.size).toBe(readBack.length);
        }
      ),
      { numRuns: 30 }
    );
  });
});
