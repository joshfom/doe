import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

import {
  routeOutbox,
  UnknownOutboxKindError,
  type OutboxRow,
} from "@/lib/cms/outbox/object-router";
import type { SalesforceObjectClient } from "@/lib/cms/tickets/crm/salesforce-objects";
import type { Database } from "@/lib/cms/db";

/**
 * Property test for object routing (task 4.4).
 *
 * **Feature: salesforce-lead-core, Property 4: For every OutboxKind the correct sObject operation is invoked (lead_upsert→Lead, task→Task, event→Event), no path ever calls createCase, and an unknown kind raises UnknownOutboxKindError.**
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.7, 4.10
 *
 * The router is exercised with a MOCKED {@link SalesforceObjectClient} whose
 * three methods are `vi.fn()` stubs, so the property observes exactly which
 * sObject operation each kind invokes. Generated payloads carry NO `partyId`
 * (and `sfId` is null on the create paths), so `lead_upsert` performs no
 * `leads_mirror` reconciliation read — the database is never touched and a
 * throwing `dbStub` makes any accidental DB access fail loudly.
 *
 * The `SalesforceObjectClient` has no `createCase`/`updateCase` method at all
 * (it is a first-class object client), so "no path ever calls createCase" is
 * asserted by proving `createObject` / `updateObject` are NEVER invoked with the
 * `"Case"` object name on any path.
 *
 * _Design §3; Requirements: 4.1, 4.2, 4.3, 4.7, 4.10_
 */

const NUM_RUNS = 200;

/** A `SalesforceObjectClient` whose three methods are `vi.fn()` stubs. */
function mockSfClient(): SalesforceObjectClient {
  return {
    createObject: vi.fn(async (_name: string) => "sf-id-routing-001"),
    updateObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => ({})),
  } as unknown as SalesforceObjectClient;
}

/**
 * A database that throws on ANY access. The generated routing cases never carry
 * a `partyId` and never set `sfId`, so no path performs a `leads_mirror` read;
 * touching the DB therefore signals a routing bug.
 */
const dbStub = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "Database must not be accessed for routing without partyId/sfId"
      );
    },
  }
) as unknown as Database;

/** All object-name arguments createObject/updateObject were called with. */
function objectNamesTouched(sf: SalesforceObjectClient): string[] {
  const createCalls = (sf.createObject as ReturnType<typeof vi.fn>).mock.calls;
  const updateCalls = (sf.updateObject as ReturnType<typeof vi.fn>).mock.calls;
  return [
    ...createCalls.map(([name]) => name as string),
    ...updateCalls.map(([name]) => name as string),
  ];
}

/** Generator of a `lead_upsert` payload that carries no Lead linkage (no partyId). */
const leadPayload = fc.record(
  {
    firstName: fc.string(),
    lastName: fc.string(),
    email: fc.string(),
    phone: fc.string(),
    company: fc.string(),
    status: fc.string(),
    projectInterest: fc.string(),
    source: fc.string(),
  },
  { requiredKeys: [] }
);

/** Generator of a `task` payload. */
const taskPayload = fc.record(
  {
    subject: fc.string(),
    description: fc.string(),
    status: fc.string(),
    whoId: fc.string(),
    ownerId: fc.string(),
  },
  { requiredKeys: [] }
);

/** Generator of an `event` payload. */
const eventPayload = fc.record(
  {
    subject: fc.string(),
    startDateTime: fc.string(),
    endDateTime: fc.string(),
    whoId: fc.string(),
  },
  { requiredKeys: [] }
);

describe("routeOutbox — object routing (Property 4)", () => {
  it("routes lead_upsert to Lead, never Case (Req 4.1, 4.7)", async () => {
    await fc.assert(
      fc.asyncProperty(leadPayload, async (payload) => {
        const sf = mockSfClient();
        const row: OutboxRow = { kind: "lead_upsert", payload, sfId: null };

        await routeOutbox(dbStub, sf, row);

        // A fresh lead_upsert (no sfId) creates a Lead.
        expect(sf.createObject).toHaveBeenCalledWith("Lead", expect.any(Object));

        const names = objectNamesTouched(sf);
        // Never a Case, on any sObject operation.
        expect(names).not.toContain("Case");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("routes task to Task, never Lead or Case (Req 4.2, 4.7)", async () => {
    await fc.assert(
      fc.asyncProperty(taskPayload, async (payload) => {
        const sf = mockSfClient();
        const row: OutboxRow = { kind: "task", payload, sfId: null };

        await routeOutbox(dbStub, sf, row);

        expect(sf.createObject).toHaveBeenCalledWith("Task", expect.any(Object));

        const names = objectNamesTouched(sf);
        expect(names).not.toContain("Case");
        expect(names).not.toContain("Lead");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("routes event to Event, never Lead or Case (Req 4.3, 4.7)", async () => {
    await fc.assert(
      fc.asyncProperty(eventPayload, async (payload) => {
        const sf = mockSfClient();
        const row: OutboxRow = { kind: "event", payload, sfId: null };

        await routeOutbox(dbStub, sf, row);

        expect(sf.createObject).toHaveBeenCalledWith(
          "Event",
          expect.any(Object)
        );

        const names = objectNamesTouched(sf);
        expect(names).not.toContain("Case");
        expect(names).not.toContain("Lead");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects any unknown kind with UnknownOutboxKindError and invokes no sObject op (Req 4.10, 4.7)", async () => {
    const knownKinds = new Set(["lead_upsert", "task", "event"]);

    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => !knownKinds.has(s)),
        fc.object(),
        async (kind, payload) => {
          const sf = mockSfClient();
          // Cast through unknown: the property deliberately drives a kind the
          // OutboxKind union does not contain to exercise the default branch.
          const row = {
            kind,
            payload,
            sfId: null,
          } as unknown as OutboxRow;

          await expect(routeOutbox(dbStub, sf, row)).rejects.toBeInstanceOf(
            UnknownOutboxKindError
          );

          // No sObject operation of any kind — and certainly never a Case.
          expect(sf.createObject).not.toHaveBeenCalled();
          expect(sf.updateObject).not.toHaveBeenCalled();
          expect(objectNamesTouched(sf)).not.toContain("Case");
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
