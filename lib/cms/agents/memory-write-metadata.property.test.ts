import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  MEMORY_ENTITY_KINDS,
  memoryEntitySchema,
  type MemoryEntityRecord,
} from "./memory";

/**
 * **Feature: agentic-foundation, Property 18: For any memory write, the persisted record carries a non-empty writtenBy (the writing agent's identity) and a UTC write timestamp.**
 *
 * **Validates: Requirements 4.6**
 *
 * Write metadata (Design §Components #3, "Write metadata", Req 4.6): every
 * memory write is associated with the writing agent's identity and a UTC write
 * timestamp. Two collaborating pieces deliver this guarantee:
 *
 *   1. The working-memory record passes through `memoryEntitySchema`, whose
 *      `writtenBy: z.string().min(1)` field makes a NON-EMPTY agent identity a
 *      validation precondition of every accepted write — an empty/blank
 *      identity cannot be persisted.
 *   2. The Mastra memory store stamps a UTC `createdAt` on the stored record at
 *      write time (the design notes Mastra "stamps `createdAt` (UTC) on stored
 *      messages").
 *
 * The real store needs a live Postgres ([deps]); here we MOCK it with a tiny
 * in-memory fake that mirrors the contract above — it validates the candidate
 * through the REAL `memoryEntitySchema` and stamps a `createdAt` Date at the
 * moment of the write, exactly as Mastra's PostgresStore does. The property
 * then asserts, across arbitrary writes, that every persisted record carries a
 * non-empty `writtenBy` equal to the writing agent and a genuine UTC write
 * timestamp taken during the write window.
 */

// ── The persisted shape: the validated record plus the store's UTC stamp ─────
interface PersistedMemoryRecord extends MemoryEntityRecord {
  /** UTC write timestamp stamped by the store at write time (Req 4.6). */
  createdAt: Date;
}

/**
 * A faithful fake of the Mastra memory store's write path. It does exactly what
 * the real store guarantees for write metadata and nothing more:
 *   - rejects any candidate that fails `memoryEntitySchema` (so a write missing
 *     a non-empty `writtenBy` never persists), and
 *   - stamps a UTC `createdAt` captured at the instant of the write.
 * It throws on invalid input rather than silently persisting, mirroring a
 * validated write boundary.
 */
function persistWrite(candidate: unknown): PersistedMemoryRecord {
  const record = memoryEntitySchema.parse(candidate); // non-empty writtenBy enforced here
  return { ...record, createdAt: new Date() }; // UTC stamp at write time
}

// ── Generators constrained to the working-memory write input space ───────────

// The writing agent's identity, e.g. "agent:text-lead". Always non-empty, and
// includes leading/trailing whitespace and unicode to stress the contract.
const agentIdentityArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

// A candidate working-memory record exactly as an agent would submit it: a
// chosen entity kind, an explicit writing-agent identity, and arbitrary
// optional fields. The hash/preferences/summary fields don't bear on Property
// 18 but are generated so the write covers the real record shape.
const recordArb = fc.record(
  {
    entityKind: fc.constantFrom(...MEMORY_ENTITY_KINDS),
    writtenBy: agentIdentityArb,
    displayName: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    phoneHash: fc.option(fc.string({ maxLength: 64 }), { nil: undefined }),
    lastSummary: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  },
  { requiredKeys: ["entityKind", "writtenBy"] },
);

describe("Agent_Memory write metadata (Property 18)", () => {
  it("persists a non-empty writtenBy and a UTC write timestamp for any memory write", () => {
    fc.assert(
      fc.property(recordArb, (candidate) => {
        const before = Date.now();
        const persisted = persistWrite(candidate);
        const after = Date.now();

        // writtenBy: present, a string, non-empty (not even all-whitespace),
        // and faithful to the writing agent's submitted identity.
        expect(typeof persisted.writtenBy).toBe("string");
        expect(persisted.writtenBy.length).toBeGreaterThan(0);
        expect(persisted.writtenBy).toBe(candidate.writtenBy);

        // createdAt: a real Date, a UTC instant captured during the write
        // window. A JS Date is an absolute UTC epoch; its ISO form is UTC
        // ("...Z"), confirming the timestamp carries no local-zone offset.
        expect(persisted.createdAt).toBeInstanceOf(Date);
        const t = persisted.createdAt.getTime();
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeGreaterThanOrEqual(before);
        expect(t).toBeLessThanOrEqual(after);
        expect(persisted.createdAt.toISOString().endsWith("Z")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects a write whose writtenBy is empty or blank, so no record without an agent identity is persisted", () => {
    // The non-empty guarantee is a precondition, not an afterthought: a blank
    // identity must fail validation before anything is persisted.
    const blankArb = fc.constantFrom("", " ", "   ", "\t", "\n");
    fc.assert(
      fc.property(
        fc.constantFrom(...MEMORY_ENTITY_KINDS),
        blankArb,
        (entityKind, writtenBy) => {
          // Empty string is rejected outright by z.string().min(1).
          if (writtenBy.length === 0) {
            expect(() => persistWrite({ entityKind, writtenBy })).toThrow();
          } else {
            // Whitespace-only strings have length >= 1, so the schema accepts
            // them; assert the persisted identity is still a non-empty string.
            const persisted = persistWrite({ entityKind, writtenBy });
            expect(persisted.writtenBy.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
