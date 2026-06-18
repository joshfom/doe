import { describe, it, expect, vi } from "vitest";

import { routeOutbox, type OutboxRow } from "@/lib/cms/outbox/object-router";
import type { SalesforceObjectClient } from "@/lib/cms/tickets/crm/salesforce-objects";
import type { Database } from "@/lib/cms/db";

/**
 * Unit test for the internal-ticket exclusion (task 4.5).
 *
 * An Internal_Ticket is a Ticket whose `lead_party_id` is null — an internal
 * work item with no Lead link. Such a ticket must NEVER be routed to Salesforce
 * as a Lead (Requirement 4.14, Design §3).
 *
 * The router enforces this structurally: only the `lead_upsert` kind ever calls
 * `createObject("Lead", …)` / `updateObject("Lead", …)`, and only a Lead
 * originates a `lead_upsert` row. A Ticket reaches Salesforce only as a `task`
 * (when it is a Lead_Task, i.e. `lead_party_id` is non-null). An Internal_Ticket
 * therefore produces no Lead routing.
 *
 * This test asserts that exclusion two ways:
 *   1. Routing a `task` payload with no lead linkage invokes only a Task
 *      operation — never `createObject("Lead", …)` / `updateObject("Lead", …)`.
 *   2. Across every non-`lead_upsert` kind (`task`, `event`), the router never
 *      touches the Lead object at all.
 *
 * _Design §3; Requirements: 4.14_
 */

/** A `SalesforceObjectClient` whose three methods are vi.fn() stubs. */
function mockSfClient(): SalesforceObjectClient {
  return {
    // createObject returns a fresh SF id; the value is irrelevant to these
    // assertions (we only care about which object name is targeted).
    createObject: vi.fn(async (_name: string) => "sf-id-001"),
    updateObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => ({})),
  } as unknown as SalesforceObjectClient;
}

// The task/event routing paths never touch the database (only `lead_upsert`
// reconciles against leads_mirror), so a never-accessed stub is sufficient and
// makes an accidental DB read fail loudly.
const dbStub = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "Database must not be accessed when routing a non-lead_upsert kind"
      );
    },
  }
) as unknown as Database;

describe("routeOutbox — internal-ticket exclusion (Req 4.14)", () => {
  it("routes a task with no lead linkage to a Task only, never a Lead", async () => {
    const sf = mockSfClient();

    // A `task` row standing in for an Internal_Ticket-style work item: it
    // carries no Lead linkage (no partyId, no lead fields), only Task fields.
    const row: OutboxRow = {
      kind: "task",
      payload: {
        subject: "Follow up on internal request",
        description: "No lead attached",
        status: "Open",
      },
      sfId: null,
    };

    const sfId = await routeOutbox(dbStub, sf, row);

    // Exactly one create, and it targets the Task object.
    expect(sf.createObject).toHaveBeenCalledTimes(1);
    expect(sf.createObject).toHaveBeenCalledWith("Task", expect.any(Object));
    expect(sfId).toBe("sf-id-001");

    // The Lead object is never touched for a ticket-origin (`task`) row.
    expect(sf.createObject).not.toHaveBeenCalledWith(
      "Lead",
      expect.anything()
    );
    expect(sf.updateObject).not.toHaveBeenCalledWith(
      "Lead",
      expect.anything(),
      expect.anything()
    );
  });

  it("never creates or updates a Lead for any non-lead_upsert kind", async () => {
    const nonLeadRows: OutboxRow[] = [
      {
        kind: "task",
        payload: { subject: "Internal task", status: "Open" },
        sfId: null,
      },
      {
        kind: "event",
        payload: {
          subject: "Internal sync",
          startDateTime: "2025-01-01T10:00:00Z",
          endDateTime: "2025-01-01T11:00:00Z",
        },
        sfId: null,
      },
    ];

    for (const row of nonLeadRows) {
      const sf = mockSfClient();

      await routeOutbox(dbStub, sf, row);

      // No Lead create and no Lead update on any non-lead_upsert path.
      const createCalls = (sf.createObject as ReturnType<typeof vi.fn>).mock
        .calls;
      const updateCalls = (sf.updateObject as ReturnType<typeof vi.fn>).mock
        .calls;

      expect(createCalls.some(([name]) => name === "Lead")).toBe(false);
      expect(updateCalls.some(([name]) => name === "Lead")).toBe(false);
    }
  });
});
