import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../db";
import {
  resolveIdentityByPhone,
  resolveIdentityByEmail,
  resolveIdentityBySession,
} from "./identity";

// ── Mock DB helper ───────────────────────────────────────────────────────────

/**
 * Creates a mock database that returns predefined results for select queries.
 * Each call to db.select() consumes the next result in the queue.
 */
function createMockDb(queryResults: unknown[][]) {
  let callIndex = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = queryResults[callIndex] ?? [];
      callIndex++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
            then: (resolve: (v: unknown[]) => void) => resolve(result),
            [Symbol.toStringTag]: "Promise",
          }),
          then: (resolve: (v: unknown[]) => void) => resolve(result),
          [Symbol.toStringTag]: "Promise",
        }),
        then: (resolve: (v: unknown[]) => void) => resolve(result),
        [Symbol.toStringTag]: "Promise",
      };
    }),
  };

  return mockDb as unknown as Database;
}

/**
 * Creates a mock db where select().from().where() returns a thenable (Promise-like).
 * Supports both chained .limit() and direct await on .where().
 */
function createSelectMockDb(queryResults: unknown[][]) {
  let callIndex = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = queryResults[callIndex] ?? [];
      callIndex++;

      const whereMock: any = Object.assign(Promise.resolve(result), {
        limit: vi.fn().mockResolvedValue(result),
      });

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(whereMock),
        }),
      };
    }),
  };

  return mockDb as unknown as Database;
}

// ── Sample data ──────────────────────────────────────────────────────────────

const sampleUnit = {
  id: "unit-1",
  projectName: "ORA Tower",
  unitNumber: "A-101",
  unitType: "apartment",
  floorNumber: 10,
  areaSqm: 120,
  status: "sold",
  constructionProgress: 75,
  estimatedHandoverDate: "2025-12-01",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolveIdentityByPhone", () => {
  it("returns visitor when no client or tenant matches", async () => {
    // Query 1: aiClients by phone → empty
    // Query 2: aiTenants by phone → empty
    const db = createSelectMockDb([[], []]);

    const result = await resolveIdentityByPhone(db, "+971501234567");

    expect(result.type).toBe("visitor");
    expect(result.units).toEqual([]);
    expect(result.clientId).toBeUndefined();
    expect(result.tenantId).toBeUndefined();
  });

  it("returns client identity when a single client matches", async () => {
    // Query 1: aiClients by phone → one match
    // Query 2: aiTenants by phone → empty
    // Query 3: aiUnits for client → one unit
    const db = createSelectMockDb([
      [{ id: "client-1", firstName: "John" }],
      [],
      [sampleUnit],
    ]);

    const result = await resolveIdentityByPhone(db, "+971501234567");

    expect(result.type).toBe("client");
    expect(result.clientId).toBe("client-1");
    expect(result.firstName).toBe("John");
    expect(result.units).toHaveLength(1);
    expect(result.units[0].projectName).toBe("ORA Tower");
  });

  it("returns tenant identity when a single tenant matches", async () => {
    // Query 1: aiClients by phone → empty
    // Query 2: aiTenants by phone → one match
    // Query 3: aiUnits for tenant → one unit
    const db = createSelectMockDb([
      [],
      [{ id: "tenant-1", firstName: "Sara" }],
      [sampleUnit],
    ]);

    const result = await resolveIdentityByPhone(db, "+971509876543");

    expect(result.type).toBe("tenant");
    expect(result.tenantId).toBe("tenant-1");
    expect(result.firstName).toBe("Sara");
    expect(result.units).toHaveLength(1);
  });

  it("returns disambiguation flag when multiple records match", async () => {
    // Query 1: aiClients by phone → one match
    // Query 2: aiTenants by phone → one match (same phone on both tables)
    const db = createSelectMockDb([
      [{ id: "client-1", firstName: "John" }],
      [{ id: "tenant-1", firstName: "John" }],
    ]);

    const result = await resolveIdentityByPhone(db, "+971501234567");

    expect(result.type).toBe("visitor");
    expect(result.needsDisambiguation).toBe(true);
    expect(result.units).toEqual([]);
  });

  it("returns disambiguation flag when multiple clients match", async () => {
    // Query 1: aiClients by phone → two matches
    // Query 2: aiTenants by phone → empty
    const db = createSelectMockDb([
      [
        { id: "client-1", firstName: "John" },
        { id: "client-2", firstName: "Jane" },
      ],
      [],
    ]);

    const result = await resolveIdentityByPhone(db, "+971501234567");

    expect(result.needsDisambiguation).toBe(true);
  });
});

describe("resolveIdentityByEmail", () => {
  it("returns visitor when no match found", async () => {
    const db = createSelectMockDb([[], []]);

    const result = await resolveIdentityByEmail(db, "unknown@example.com");

    expect(result.type).toBe("visitor");
    expect(result.units).toEqual([]);
  });

  it("returns client identity for a single client email match", async () => {
    const db = createSelectMockDb([
      [{ id: "client-1", firstName: "Ahmed" }],
      [],
      [sampleUnit],
    ]);

    const result = await resolveIdentityByEmail(db, "ahmed@example.com");

    expect(result.type).toBe("client");
    expect(result.clientId).toBe("client-1");
    expect(result.firstName).toBe("Ahmed");
    expect(result.units).toHaveLength(1);
  });

  it("returns tenant identity for a single tenant email match", async () => {
    const db = createSelectMockDb([
      [],
      [{ id: "tenant-1", firstName: "Fatima" }],
      [sampleUnit],
    ]);

    const result = await resolveIdentityByEmail(db, "fatima@example.com");

    expect(result.type).toBe("tenant");
    expect(result.tenantId).toBe("tenant-1");
    expect(result.firstName).toBe("Fatima");
  });

  it("returns disambiguation flag for multiple email matches", async () => {
    const db = createSelectMockDb([
      [{ id: "client-1", firstName: "Ahmed" }],
      [{ id: "tenant-1", firstName: "Ahmed" }],
    ]);

    const result = await resolveIdentityByEmail(db, "ahmed@example.com");

    expect(result.needsDisambiguation).toBe(true);
  });
});

describe("resolveIdentityBySession", () => {
  it("returns visitor when user ID not found in users table", async () => {
    // Query 1: users by id → empty (limit returns [])
    const db = createSelectMockDb([[]]);

    const result = await resolveIdentityBySession(db, "nonexistent-user-id");

    expect(result.type).toBe("visitor");
    expect(result.units).toEqual([]);
  });

  it("resolves identity via user email when session user exists", async () => {
    // Query 1: users by id → user with email
    // Query 2: aiClients by email → one match
    // Query 3: aiTenants by email → empty
    // Query 4: aiUnits for client → one unit
    const db = createSelectMockDb([
      [{ email: "john@example.com" }],
      [{ id: "client-1", firstName: "John" }],
      [],
      [sampleUnit],
    ]);

    const result = await resolveIdentityBySession(db, "user-1");

    expect(result.type).toBe("client");
    expect(result.clientId).toBe("client-1");
    expect(result.firstName).toBe("John");
    expect(result.units).toHaveLength(1);
  });

  it("returns visitor when user exists but email has no client/tenant match", async () => {
    // Query 1: users by id → user with email
    // Query 2: aiClients by email → empty
    // Query 3: aiTenants by email → empty
    const db = createSelectMockDb([
      [{ email: "admin@example.com" }],
      [],
      [],
    ]);

    const result = await resolveIdentityBySession(db, "admin-user-id");

    expect(result.type).toBe("visitor");
    expect(result.units).toEqual([]);
  });
});
