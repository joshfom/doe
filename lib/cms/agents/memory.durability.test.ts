// lib/cms/agents/memory.durability.test.ts
//
// Integration test for Agent_Memory durability (Task 2.9).
//
// Requirement 4.1: Agent_Memory persists working + long-term memory to a store
// that SURVIVES an Agent process or container restart, such that a record
// written in one Agent run is retrievable by a SUBSEQUENT Agent run for the
// SAME Memory_Entity.
//
// This is a single-execution example/integration test (NOT a property test).
//
// [deps] Mastra's real PostgresStore + PgVector need a live Postgres with the
// `pgvector` extension, and the embedder reaches the Cloudflare AI Gateway over
// the network — both block in CI/local test runs. Per the task's guidance
// ("Mastra store mocked/pg-mem-backed where live DB blocks") we mock
// `@mastra/memory` and `@mastra/pg` with a faithful stand-in that models the
// one property under test: durability keyed by the Postgres connection.
//
// The fidelity that matters: the backing store is keyed by `connectionString`
// in a module-level map that OUTLIVES any individual Memory / PostgresStore
// instance. So two Memory instances built by separate `createAgentMemory(conn)`
// calls (a "fresh runtime" after a restart) that share the same connection
// string read and write the SAME durable data — exactly the Postgres-backed
// guarantee Requirement 4.1 demands. A different connection string is a
// different database and shares nothing.
//
// Validates: Requirements 4.1.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Durable backing store, keyed by connection string ────────────────────────
// This map stands in for the persistent Postgres database. It lives at module
// scope, so it survives across Memory/PostgresStore instantiations the same way
// a real database survives an Agent process/container restart.
type WorkingMemoryTable = Map<string, unknown>;
const DURABLE_PG = new Map<string, WorkingMemoryTable>();

function tableFor(connectionString: string): WorkingMemoryTable {
  let table = DURABLE_PG.get(connectionString);
  if (!table) {
    table = new Map();
    DURABLE_PG.set(connectionString, table);
  }
  return table;
}

/** Derive the single working-memory key (resourceId XOR threadId). */
function keyOf(args: { resourceId?: string; threadId?: string }): string {
  const key = args.resourceId ?? args.threadId;
  if (!key) throw new Error("a memory operation requires a resourceId or threadId");
  return key;
}

// ── Mock @mastra/pg: PostgresStore is backed by the durable map ───────────────
vi.mock("@mastra/pg", () => {
  class PostgresStore {
    readonly connectionString: string;
    readonly table: WorkingMemoryTable;
    constructor({ connectionString }: { id?: string; connectionString: string }) {
      this.connectionString = connectionString;
      // Same connection string → same durable table (survives "restart").
      this.table = tableFor(connectionString);
    }
  }
  class PgVector {
    readonly connectionString: string;
    constructor({ connectionString }: { id?: string; connectionString: string }) {
      this.connectionString = connectionString;
    }
  }
  return { __esModule: true, PostgresStore, PgVector };
});

// ── Mock @mastra/memory: Memory reads/writes working memory via its storage ───
vi.mock("@mastra/memory", () => {
  class Memory {
    private readonly storage: { table: WorkingMemoryTable };
    constructor(config: { storage: { table: WorkingMemoryTable } }) {
      this.storage = config.storage;
    }

    /** Persist a working-memory record for an entity (resourceId/threadId). */
    async updateWorkingMemory(args: {
      resourceId?: string;
      threadId?: string;
      workingMemory: unknown;
    }): Promise<void> {
      this.storage.table.set(keyOf(args), args.workingMemory);
    }

    /** Read back the working-memory record for an entity; null when absent. */
    async getWorkingMemory(args: {
      resourceId?: string;
      threadId?: string;
    }): Promise<unknown | null> {
      return this.storage.table.get(keyOf(args)) ?? null;
    }
  }
  return { __esModule: true, Memory };
});

// Mock the embedder so importing memory.ts never reaches the live AI gateway.
vi.mock("./embedder", () => ({
  __esModule: true,
  cfEmbedder: { specificationVersion: "v2", provider: "cf", modelId: "test-embedder" },
  EMBEDDING_DIMENSIONS: 768,
}));

import {
  buildMemoryKey,
  createAgentMemory,
  type MemoryEntityRecord,
} from "./memory";

const CONNECTION = "postgres://doe:doe@localhost:5432/doe_test";
const OTHER_CONNECTION = "postgres://doe:doe@localhost:5432/doe_other";

describe("Agent_Memory durability (Requirement 4.1)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    DURABLE_PG.clear();
    process.env.DATABASE_URL = CONNECTION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    DURABLE_PG.clear();
  });

  it("retrieves a record written by one runtime from a fresh runtime against the same Postgres", async () => {
    const entity = { kind: "lead", id: "party-123" } as const;
    const key = buildMemoryKey(entity);

    const record: MemoryEntityRecord = {
      entityKind: "lead",
      displayName: "Acme Co",
      preferences: { channel: "email" },
      lastSummary: "Requested a callback about the downtown unit.",
      writtenBy: "agent:text-lead",
    };

    // ── Runtime A: write the record, then the process "exits". ──
    const runtimeA = createAgentMemory(CONNECTION);
    await runtimeA.updateWorkingMemory({ ...key, workingMemory: record });

    // ── Runtime B: a brand-new runtime instance (simulated restart) against
    //    the SAME Postgres connection. It must see the record A wrote. ──
    const runtimeB = createAgentMemory(CONNECTION);
    const recalled = await runtimeB.getWorkingMemory({ ...key });

    expect(recalled).toEqual(record);
    // Distinct instances — durability comes from the store, not a shared object.
    expect(runtimeB).not.toBe(runtimeA);
  });

  it("defaults the connection to DATABASE_URL so a subsequent runtime recalls the write", async () => {
    const entity = { kind: "conversation", id: "conv-9" } as const;
    const key = buildMemoryKey(entity);
    const record: MemoryEntityRecord = {
      entityKind: "conversation",
      lastSummary: "Greeted the visitor and offered tour scheduling.",
      writtenBy: "agent:text-lead",
    };

    // Both runtimes fall back to process.env.DATABASE_URL (= CONNECTION).
    await createAgentMemory().updateWorkingMemory({ ...key, workingMemory: record });
    const recalled = await createAgentMemory().getWorkingMemory({ ...key });

    expect(recalled).toEqual(record);
  });

  it("does not leak a record to a runtime pointed at a different Postgres", async () => {
    const entity = { kind: "user", id: "user-1" } as const;
    const key = buildMemoryKey(entity);
    const record: MemoryEntityRecord = { entityKind: "user", writtenBy: "agent:admin" };

    await createAgentMemory(CONNECTION).updateWorkingMemory({ ...key, workingMemory: record });

    // A different connection string is a different database — nothing shared.
    const recalled = await createAgentMemory(OTHER_CONNECTION).getWorkingMemory({ ...key });
    expect(recalled).toBeNull();
  });

  it("returns null (not an error) for an entity that was never written", async () => {
    const key = buildMemoryKey({ kind: "deal", id: "deal-404" });
    const recalled = await createAgentMemory(CONNECTION).getWorkingMemory({ ...key });
    expect(recalled).toBeNull();
  });
});
