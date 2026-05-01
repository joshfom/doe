import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { Database } from "../db";
import type { CrmAdapter, CrmCaseInput } from "./crm/adapter";

// Mock the CRM adapter registry
vi.mock("./crm/registry", () => ({
  getActiveAdapter: vi.fn(),
}));

import { getActiveAdapter } from "./crm/registry";
import { syncTicketToCrm } from "./crm/sync";

const mockGetActiveAdapter = vi.mocked(getActiveAdapter);

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a ticket number in ORA-XXXXXX format. */
const arbTicketNumber = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => `ORA-${String(n).padStart(6, "0")}`);

/** Generates a non-empty trimmed string. */
const arbNonEmpty = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);

/** Generates a valid email address. */
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.constantFrom("com", "org", "net", "io"),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Generates a CRM action type. */
const arbAction = fc.constantFrom("create_case" as const, "update_case" as const);

/** Generates a CrmCaseInput. */
const arbCaseInput = fc.record({
  ticketNumber: arbTicketNumber,
  subject: arbNonEmpty,
  description: arbNonEmpty,
  contactName: arbNonEmpty,
  contactEmail: arbEmail,
  priority: fc.constantFrom("low", "medium", "high", "urgent"),
  status: fc.constantFrom("open", "assigned", "in_progress", "resolved", "closed"),
});

/** Generates an external CRM ID (simulating a Salesforce Case ID). */
const arbExternalId = fc
  .stringMatching(/^[A-Z0-9]{15,18}$/)
  .filter((s) => s.length >= 15);

/** Generates an error message. */
const arbErrorMessage = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock Database that tracks insert and update calls on crmSyncLog
 * and tickets tables. Returns the mock db and tracking arrays.
 */
function createMockDb() {
  const logInserts: Array<{ values: Record<string, unknown> }> = [];
  const logUpdates: Array<{ set: Record<string, unknown>; where: unknown }> = [];
  const ticketUpdates: Array<{ set: Record<string, unknown>; where: unknown }> = [];

  // Track the generated log ID
  const logId = crypto.randomUUID();

  // Build a chainable mock for db.insert(crmSyncLog).values(...).returning()
  const insertReturning = vi.fn().mockResolvedValue([{ id: logId }]);
  const insertValues = vi.fn().mockImplementation((vals: Record<string, unknown>) => {
    logInserts.push({ values: vals });
    return { returning: insertReturning };
  });
  const insertChain = vi.fn().mockReturnValue({ values: insertValues });

  // Build a chainable mock for db.update(table).set(...).where(...)
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockImplementation((vals: Record<string, unknown>) => {
    return {
      where: vi.fn().mockImplementation((whereClause: unknown) => {
        // Determine which table is being updated based on the call context
        if (currentUpdateTable === "crmSyncLog") {
          logUpdates.push({ set: vals, where: whereClause });
        } else {
          ticketUpdates.push({ set: vals, where: whereClause });
        }
        return Promise.resolve(undefined);
      }),
    };
  });

  let currentUpdateTable = "crmSyncLog";
  const updateChain = vi.fn().mockImplementation((table: unknown) => {
    // Distinguish between crmSyncLog and tickets table updates
    // The sync function calls update on crmSyncLog first, then tickets
    // We use the table reference to distinguish
    const tableRef = table as { _: { name: string } } | undefined;
    if (tableRef && typeof tableRef === "object") {
      // Try to detect which table by checking the object identity
      currentUpdateTable =
        tableRef === ticketsTableRef ? "tickets" : "crmSyncLog";
    }
    return { set: updateSet };
  });

  // We need references to the actual schema tables to distinguish them
  let ticketsTableRef: unknown = null;

  const mockDb = {
    insert: insertChain,
    update: updateChain,
    _setTicketsRef: (ref: unknown) => {
      ticketsTableRef = ref;
    },
  } as unknown as Database;

  return {
    db: mockDb,
    logId,
    logInserts,
    logUpdates,
    ticketUpdates,
    insertValues,
    insertReturning,
    updateSet,
  };
}

/**
 * Creates a mock CRM adapter that either succeeds or fails.
 */
function createMockAdapter(
  mode: "success" | "fail",
  externalId: string,
  errorMessage: string,
): CrmAdapter {
  const adapter: CrmAdapter = {
    name: "test-crm",
    createCase: vi.fn().mockImplementation(async () => {
      if (mode === "fail") throw new Error(errorMessage);
      return { externalId, status: "created" };
    }),
    updateCase: vi.fn().mockImplementation(async () => {
      if (mode === "fail") throw new Error(errorMessage);
      return { externalId, status: "updated" };
    }),
    getCaseStatus: vi.fn().mockResolvedValue("open"),
  };
  return adapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 15: CRM sync log lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 12.2, 12.3, 12.4**
 *
 * Property 15: CRM sync log lifecycle
 *
 * For any CRM synchronization attempt, a crm_sync_log record with status
 * "pending" should be created before the external API call. On success, the
 * record should be updated to status "success" with a non-null external_ref_id
 * and completed_at. On failure (after all retries), the record should be
 * updated to status "failed" with a non-null error_message.
 */
// Feature: support-ticketing-system, Property 15: CRM sync log lifecycle
describe("Feature: support-ticketing-system, Property 15: CRM sync log lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("on successful CRM sync: log starts as 'pending', ends as 'success' with external_ref_id and completed_at (Req 12.2, 12.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        arbCaseInput,
        arbExternalId,
        arbAction,
        async (ticketId, caseInput, externalId, action) => {
          vi.clearAllMocks();

          const adapter = createMockAdapter("success", externalId, "");
          mockGetActiveAdapter.mockReturnValue(adapter);

          // Track all db operations in order
          const operations: Array<{ op: string; data: Record<string, unknown> }> = [];
          const logId = crypto.randomUUID();

          // Mock db.insert chain
          const mockInsert = vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
              operations.push({ op: "insert", data: vals });
              return {
                returning: vi.fn().mockResolvedValue([{ id: logId }]),
              };
            }),
          });

          // Mock db.update chain
          const mockUpdate = vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
              operations.push({ op: "update", data: vals });
              return {
                where: vi.fn().mockResolvedValue(undefined),
              };
            }),
          });

          const mockDb = {
            insert: mockInsert,
            update: mockUpdate,
          } as unknown as Database;

          // For update_case, we need an existing external ID
          const existingExternalId =
            action === "update_case" ? "EXISTING-ID-123" : undefined;

          await syncTicketToCrm(
            mockDb,
            ticketId,
            action,
            caseInput,
            existingExternalId,
          );

          // 1. A pending log record must be created first
          expect(operations.length).toBeGreaterThanOrEqual(1);
          const insertOp = operations[0];
          expect(insertOp.op).toBe("insert");
          expect(insertOp.data).toMatchObject({
            ticketId,
            direction: "outbound",
            action,
            status: "pending",
          });

          // 2. The CRM adapter must have been called
          if (action === "create_case") {
            expect(adapter.createCase).toHaveBeenCalledOnce();
          } else {
            expect(adapter.updateCase).toHaveBeenCalledOnce();
          }

          // 3. The log must be updated to "success" with external_ref_id and completed_at
          const successUpdate = operations.find(
            (op) => op.op === "update" && op.data.status === "success",
          );
          expect(successUpdate).toBeDefined();
          expect(successUpdate!.data.externalRefId).toBe(externalId);
          expect(successUpdate!.data.completedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("on failed CRM sync: log starts as 'pending', ends as 'failed' with error_message (Req 12.2, 12.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        arbCaseInput,
        arbErrorMessage,
        async (ticketId, caseInput, errorMessage) => {
          vi.clearAllMocks();

          const adapter = createMockAdapter("fail", "", errorMessage);
          mockGetActiveAdapter.mockReturnValue(adapter);

          const operations: Array<{ op: string; data: Record<string, unknown> }> = [];
          const logId = crypto.randomUUID();

          const mockInsert = vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
              operations.push({ op: "insert", data: vals });
              return {
                returning: vi.fn().mockResolvedValue([{ id: logId }]),
              };
            }),
          });

          const mockUpdate = vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
              operations.push({ op: "update", data: vals });
              return {
                where: vi.fn().mockResolvedValue(undefined),
              };
            }),
          });

          const mockDb = {
            insert: mockInsert,
            update: mockUpdate,
          } as unknown as Database;

          // Always use create_case for failure tests (simpler — no existing ID needed)
          await syncTicketToCrm(
            mockDb,
            ticketId,
            "create_case",
            caseInput,
          );

          // 1. A pending log record must be created first
          expect(operations.length).toBeGreaterThanOrEqual(1);
          const insertOp = operations[0];
          expect(insertOp.op).toBe("insert");
          expect(insertOp.data).toMatchObject({
            ticketId,
            direction: "outbound",
            action: "create_case",
            status: "pending",
          });

          // 2. The CRM adapter must have been called (and failed)
          expect(adapter.createCase).toHaveBeenCalledOnce();

          // 3. The log must be updated to "failed" with error_message
          const failUpdate = operations.find(
            (op) => op.op === "update" && op.data.status === "failed",
          );
          expect(failUpdate).toBeDefined();
          expect(failUpdate!.data.errorMessage).toBe(errorMessage);
          expect(failUpdate!.data.completedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("when no adapter is configured: no log record is created at all (Req 12.2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        arbCaseInput,
        arbAction,
        async (ticketId, caseInput, action) => {
          vi.clearAllMocks();

          // No adapter configured
          mockGetActiveAdapter.mockReturnValue(null);

          const insertCalled = vi.fn();
          const updateCalled = vi.fn();

          const mockDb = {
            insert: vi.fn().mockImplementation(() => {
              insertCalled();
              return {
                values: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([]),
                }),
              };
            }),
            update: vi.fn().mockImplementation(() => {
              updateCalled();
              return {
                set: vi.fn().mockReturnValue({
                  where: vi.fn().mockResolvedValue(undefined),
                }),
              };
            }),
          } as unknown as Database;

          await syncTicketToCrm(
            mockDb,
            ticketId,
            action,
            caseInput,
          );

          // No database operations should occur when no adapter is configured
          expect(insertCalled).not.toHaveBeenCalled();
          expect(updateCalled).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });
});
